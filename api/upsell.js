// POST /api/upsell  — gera a cobrança Pix da regularização fiscal (upsell da página /nf/).
// Mesmo gateway do checkout (Velani), mas com valor fixo definido no servidor.
const crypto = require('crypto');
const { send, jsonBody, digits } = require('./_lib');
const velani = require('./_velani');
const utmify = require('./_utmify');
const vtrack = require('./_vtrack');

// Valores SEMPRE do servidor (nunca confiar no navegador). O "kind" escolhe o produto/valor.
const PRODUCTS = {
  nf:    { amountCents: Number(process.env.UPSELL_AMOUNT_CENTS || 1870), name: 'Regularização fiscal do pedido', slug: 'upsell-nf',    desc: 'allu · regularização fiscal do pedido' },
  frete: { amountCents: Number(process.env.FRETE_AMOUNT_CENTS || 2790),  name: 'Frete do pedido',               slug: 'upsell-frete', desc: 'allu · frete do pedido' },
};
const TRACK_KEYS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'src', 'sck'];

const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 12;
}
function cleanTracking(t) {
  const s = t || {}, o = {};
  TRACK_KEYS.forEach((k) => { if (typeof s[k] === 'string' && s[k]) o[k] = s[k].slice(0, 200); });
  return o;
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Método não permitido.' }); }
  if (velani.isMock && process.env.VERCEL_ENV === 'production' && process.env.ALLOW_MOCK !== '1') {
    console.error('[upsell] VELANI_API_KEY não configurada em produção.');
    return send(res, 503, { error: 'Pagamento temporariamente indisponível. Tente novamente em instantes.' });
  }
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });

  let body;
  try { body = await jsonBody(req); } catch (e) { return send(res, 400, { error: 'Requisição inválida.' }); }

  const c = (body && body.customer) || {};
  const prod = PRODUCTS[String((body && body.kind) || 'nf')] || PRODUCTS.nf;
  const idem = /^[\w-]{8,80}$/.test(String((body && body.idempotencyKey) || '')) ? body.idempotencyKey : uuid();
  const order = {
    method: 'pix',
    amountCents: prod.amountCents,
    productName: prod.name,
    product: prod.slug,
    externalId: 'allu-' + prod.slug + '-' + idem,
    description: prod.desc,
    idempotencyKey: idem,
    customer: {
      name: String(c.name || '').trim().replace(/\s+/g, ' ').slice(0, 120) || 'Cliente Allugator',
      email: (String(c.email || '').trim().toLowerCase().slice(0, 120)) || undefined,
      phone: digits(c.phone) || undefined,
      cpf: digits(c.cpf) || undefined,
    },
    tracking: cleanTracking(body && body.tracking),
  };

  try {
    const out = await velani.createCharge(order);
    vtrack.sendUtms(out.orderId, order.tracking, { isTest: velani.isMock });   // VTrack (sem await)
    await utmify.trackPending(order, out, { ip, isTest: velani.isMock });
    return send(res, 200, { orderId: out.orderId, status: out.status, amountCents: order.amountCents, pix: out.pix });
  } catch (e) {
    console.error('[upsell] falha na Velani:', e.message, e.data ? JSON.stringify(e.data).slice(0, 400) : '');
    if (e.status === 429) return send(res, 503, { error: 'Muitas pessoas pagando agora. Tente novamente em alguns segundos.' });
    return send(res, 502, { error: 'Não foi possível gerar o Pix agora. Tente novamente em instantes.' });
  }
};
