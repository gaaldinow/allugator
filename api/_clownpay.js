/**
 * ADAPTADOR DA CLOWNPAY (Pix)  —  único arquivo que conversa com a API da ClownPay.
 * Documentação: https://app.clownspay.com/documentation
 *
 * Variáveis de ambiente (NUNCA no index.html):
 *   CLOWNPAY_API_KEY        Chave Secreta (clownpay_...)  <- obrigatória em produção
 *                           (Portal da loja > Configurações e API)
 *   CLOWNPAY_API_URL        opcional; padrão abaixo
 *   CLOWNPAY_WEBHOOK_TOKEN  opcional, mas recomendado: segredo que vai na URL do webhook
 *                           (a ClownPay não assina o webhook; o token + confirmação na API protegem)
 *   PUBLIC_BASE_URL         https://seu-dominio.com  (a ClownPay chama /api/webhook)
 *
 * Sem CLOWNPAY_API_KEY roda em MODO TESTE (simulado, sem cobrança real).
 * Em produção (Vercel) o modo teste é BLOQUEADO para ninguém pagar um Pix falso.
 *
 * Contrato interno (o site só enxerga isso):
 *   createCharge(order) -> { orderId, status, method:'pix', pix:{copyPaste,qrImage,expiresAt} }
 *   getCharge(orderId)  -> { status }      status: pending | paid | refused | expired | canceled
 *
 * O orderId é a própria "reference" enviada à ClownPay (order.externalId). A ClownPay devolve o
 * mesmo valor em "id" e em "external_id" nas consultas e no webhook, então o webhook e o polling
 * do site usam a mesma chave.
 */
const crypto = require('crypto');

const BASE = (process.env.CLOWNPAY_API_URL || 'https://pagamento-processador.org.ua/api/v1').replace(/\/$/, '');
const MOCK = !process.env.CLOWNPAY_API_KEY;
const TEST_DELAY_MS = 8000;

// Status da ClownPay -> status internos
const STATUS_MAP = {
  approved: 'paid',
  pending: 'pending', processing: 'pending', under_review: 'pending',
  failed: 'refused',
  refunded: 'canceled', chargeback: 'canceled',
};
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
async function clown(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': process.env.CLOWNPAY_API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
  if (!res.ok || (data && (data.success === false || data.status === 'error'))) {
    const msg = data && (data.message || (data.error && data.error.message) || (typeof data.error === 'string' && data.error));
    const err = new Error('ClownPay HTTP ' + res.status + (msg ? ': ' + msg : ''));
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

const TRACK_KEYS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'src', 'sck'];
// Dados extras para a Meta (API de Conversões): vão junto no tracking e voltam no webhook.
const META_KEYS = ['fbp', 'fbc', 'client_ip', 'client_ua'];
const pick = (t, keys) => Object.fromEntries(keys.filter((k) => typeof (t || {})[k] === 'string' && t[k]).map((k) => [k, t[k].slice(0, 200)]));
const pickTracking = (t) => pick(t, TRACK_KEYS);

// "2025-08-22 21:30:00" (horário de Brasília, sem fuso) -> ISO com fuso.
function toIso(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : '-03:00'));
  return isNaN(d) ? null : d.toISOString();
}

/* ---------------- Criar cobrança Pix ---------------- */
async function liveCreate(order) {
  if (order.method !== 'pix') throw new Error('A ClownPay só aceita Pix.');
  const base = process.env.PUBLIC_BASE_URL;
  const token = process.env.CLOWNPAY_WEBHOOK_TOKEN;
  const a = order.address;
  const body = {
    amount: order.amountCents,                                   // centavos
    description: order.productName,                              // "Nome do Produto"
    reference: order.externalId,                                 // nosso id único (vira o orderId)
    source: 'api_externa',                                       // produtos não cadastrados na ClownPay
    customer: {
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone,
      document: order.customer.cpf,
    },
    ...(a ? { address: {
      street: a.street, number: a.number, complement: a.complement || undefined,
      neighborhood: a.district, city: a.city, state: a.uf, zipcode: a.cep,
    } } : {}),
    tracking: { ...pickTracking(order.tracking), ...pick(order.tracking, META_KEYS) },
    ...(base && /^https:\/\//.test(base)
      ? { postback_url: base.replace(/\/$/, '') + '/api/webhook' + (token ? '?token=' + encodeURIComponent(token) : '') }
      : {}),
  };
  let d;
  try {
    d = await clown('POST', '/transaction', body);
  } catch (e) {
    // Se a ClownPay recusar os campos extras da Meta, repete só com as UTMs (a venda não pode parar).
    if ((e.status === 400 || e.status === 422) && Object.keys(pick(order.tracking, META_KEYS)).length) {
      console.warn('[clownpay] recusou o tracking da Meta, repetindo só com UTMs:', e.message);
      d = await clown('POST', '/transaction', { ...body, tracking: pickTracking(order.tracking) });
    } else throw e;
  }
  if (!d || !d.qr_code) throw new Error('Resposta da ClownPay sem código Pix.');
  return {
    orderId: String(d.id || order.externalId), method: 'pix', status: 'pending',
    pix: { copyPaste: d.qr_code, qrImage: d.qr_code_base64 || null, expiresAt: toIso(d.expires_at) || new Date(Date.now() + 30 * 60000).toISOString() },
  };
}

/* ---------------- Consultar status (com cache para não sobrecarregar a API) ---------------- */
const cache = new Map();
async function liveStatus(id) {
  const hit = cache.get(id);
  if (hit && Date.now() < hit.until) return hit.value;
  let value;
  try {
    const d = await clown('GET', '/query?action=list_transactions&external_id=' + encodeURIComponent(id));
    const list = Array.isArray(d) ? d : [];
    const tx = list.find((t) => mapStatus(t.status) === 'paid') || list[0];
    value = { status: tx ? mapStatus(tx.status) : 'pending' };
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
// A ClownPay não assina o webhook. Autenticamos pelo token na URL (CLOWNPAY_WEBHOOK_TOKEN).
// Retorna true/false, ou null se não há token configurado (aí só vale a confirmação pela API).
function verifyToken(provided) {
  const secret = process.env.CLOWNPAY_WEBHOOK_TOKEN;
  if (!secret) return null;
  const a = Buffer.from(String(provided || '')), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  isMock: MOCK,
  createCharge: (o) => (MOCK ? Promise.resolve(mockCreate()) : liveCreate(o)),
  getCharge: (id) => (MOCK ? Promise.resolve(mockStatus(id)) : liveStatus(id)),
  verifyToken, mapStatus,
};
