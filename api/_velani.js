/**
 * ADAPTADOR DA VELANI (Pix)  —  único arquivo que conversa com a API da Velani.
 * Documentação: https://velanipagamentos.com.br/docs/api/
 *
 * Variáveis de ambiente (NUNCA no index.html):
 *   VELANI_API_KEY         Secret Key (sk_live_...)   <- obrigatória em produção
 *   VELANI_WEBHOOK_SECRET  Segredo do webhook (whsec_...), em Desenvolvedores > Webhooks
 *   VELANI_API_URL         opcional; padrão abaixo
 *   PUBLIC_BASE_URL        https://seu-dominio.com  (a Velani chama /api/webhook)
 *
 * Sem VELANI_API_KEY roda em MODO TESTE (simulado, sem cobrança real).
 * Em produção (Vercel) o modo teste é BLOQUEADO para ninguém pagar um Pix falso.
 *
 * Contrato interno (o site só enxerga isso):
 *   createCharge(order) -> { orderId, status, method:'pix', pix:{copyPaste,qrImage,expiresAt} }
 *   getCharge(orderId)  -> { status }      status: pending | paid | refused | expired | canceled
 */
const crypto = require('crypto');

const BASE = (process.env.VELANI_API_URL || 'https://api.velanipagamentos.com.br/api/v1/api-gateway').replace(/\/$/, '');
const MOCK = !process.env.VELANI_API_KEY;
const TEST_DELAY_MS = 8000;

// Status da Velani -> status internos
const STATUS_MAP = { paid: 'paid', pending: 'pending', processing: 'pending', failed: 'refused', expired: 'expired', refunded: 'canceled' };
const mapStatus = (s) => STATUS_MAP[String(s || '').toLowerCase()] || 'pending';

/* ---------------- MODO TESTE ---------------- */
function mockCreate() {
  const id = 'TESTE-' + Date.now().toString(36).toUpperCase();
  return { orderId: id, method: 'pix', status: 'pending',
    pix: { copyPaste: '00020126580014br.gov.bcb.pix0136TESTE' + id + '5204000053039865802BR5905ALLU6009SAO PAULO6304TEST', qrImage: null, expiresAt: new Date(Date.now() + 30 * 60000).toISOString() } };
}
function mockStatus(id) {
  const ts = parseInt(String(id).replace('TESTE-', ''), 36);
  return { status: Date.now() - ts > TEST_DELAY_MS ? 'paid' : 'pending' };
}

/* ---------------- HTTP ---------------- */
async function velani(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': process.env.VELANI_API_KEY, ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
  if (!res.ok || data.success === false) {
    const err = new Error('Velani HTTP ' + res.status + (data.error && data.error.message ? ': ' + data.error.message : ''));
    err.status = res.status; err.data = data; throw err;
  }
  return data.data;
}

const TRACK_KEYS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'src', 'sck'];
const pickTracking = (t) => Object.fromEntries(TRACK_KEYS.filter((k) => typeof (t || {})[k] === 'string' && t[k]).map((k) => [k, t[k].slice(0, 200)]));

/* ---------------- Criar cobrança Pix ---------------- */
async function liveCreate(order) {
  if (order.method !== 'pix') throw new Error('A Velani só aceita Pix.');
  const base = process.env.PUBLIC_BASE_URL;
  const body = {
    paymentMethod: 'pix',
    amount: order.amountCents,                                   // centavos (mínimo 100)
    customer: {
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone,
      ...(order.customer.cpf ? { document: { type: 'cpf', number: order.customer.cpf } } : {}),
    },
    items: [{ title: order.productName, unitPrice: order.amountCents, quantity: 1 }],
    externalId: order.externalId,
    description: order.description,
    tracking: pickTracking(order.tracking),
    ...(base && /^https:\/\//.test(base) ? { postbackUrl: base.replace(/\/$/, '') + '/api/webhook' } : {}),
  };
  const d = await velani('POST', '/v1/transactions', body, { 'x-idempotency-key': order.idempotencyKey });
  if (!d || !d.id || !d.pixQrCode) throw new Error('Resposta da Velani sem id/código Pix.');
  return {
    orderId: String(d.id), method: 'pix', status: mapStatus(d.status),
    pix: { copyPaste: d.pixQrCode, qrImage: d.pixQrCodeImage || null, expiresAt: d.expiresAt || new Date(Date.now() + 30 * 60000).toISOString() },
  };
}

/* ---------------- Consultar status (com cache p/ respeitar 5 req/s) ---------------- */
const cache = new Map();
async function liveStatus(id) {
  const hit = cache.get(id);
  if (hit && Date.now() < hit.until) return hit.value;
  let value;
  try {
    const d = await velani('GET', '/v1/transactions/' + encodeURIComponent(id));
    value = { status: mapStatus(d.status) };
  } catch (e) {
    if (e.status === 429 || e.status >= 500) return { status: 'pending' };   // tenta de novo no próximo poll
    throw e;
  }
  const final = value.status !== 'pending';
  cache.set(id, { value, until: Date.now() + (final ? 600000 : 3000) });
  if (cache.size > 2000) cache.clear();
  return value;
}

/* ---------------- Webhook ---------------- */
// Assinatura = HMAC-SHA256(hex) de JSON.stringify(payload.data) com o segredo whsec_...
function verifySignature(payload) {
  const secret = process.env.VELANI_WEBHOOK_SECRET;
  if (!secret) return null;                                   // sem segredo: não dá para verificar
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload.data)).digest('hex');
  const a = Buffer.from(String(payload.signature || '')), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  isMock: MOCK,
  createCharge: (o) => (MOCK ? Promise.resolve(mockCreate()) : liveCreate(o)),
  getCharge: (id) => (MOCK ? Promise.resolve(mockStatus(id)) : liveStatus(id)),
  verifySignature, mapStatus,
};
