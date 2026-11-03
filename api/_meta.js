/**
 * META — API de Conversões (envio do Purchase pelo servidor).
 *
 * Variáveis de ambiente (NUNCA no index.html):
 *   META_PIXEL_ID          ID do Pixel
 *   META_CAPI_TOKEN        Token de acesso da API de Conversões
 *   META_TEST_EVENT_CODE   opcional: código da aba "Testar eventos" (remova depois dos testes)
 *   META_API_VERSION       opcional; padrão abaixo
 *
 * O Purchase do servidor usa o MESMO event_id do Purchase do navegador (o orderId/reference do pedido),
 * então a Meta conta a venda uma vez só, mesmo que os dois cheguem.
 */
const crypto = require('crypto');

const VERSION = process.env.META_API_VERSION || 'v22.0';
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const clean = (v) => String(v == null ? '' : v).trim().toLowerCase();
const noAccents = (v) => clean(v).normalize('NFD').replace(/[̀-ͯ]/g, '');
const digits = (v) => String(v || '').replace(/\D/g, '');

const hashed = (v, fn) => { const x = fn ? fn(v) : clean(v); return x ? [sha(x)] : undefined; };

function phone(v) {
  const d = digits(v);
  if (!d) return '';
  return d.length === 10 || d.length === 11 ? '55' + d : d;
}

function buildUserData(p) {
  const c = p.customer || {}, a = p.address || {}, t = p.tracking || {};
  const parts = clean(c.name).split(/\s+/).filter(Boolean);
  const u = {
    em: hashed(c.email),
    ph: hashed(c.phone, phone),
    fn: hashed(parts[0]),
    ln: hashed(parts.length > 1 ? parts[parts.length - 1] : ''),
    ct: hashed(a.city, (x) => noAccents(x).replace(/[^a-z]/g, '')),
    st: hashed(a.state, (x) => noAccents(x).replace(/[^a-z]/g, '')),
    zp: hashed(a.zipcode, digits),
    country: [sha('br')],
    external_id: hashed(c.document, digits),
    fbp: typeof t.fbp === 'string' && t.fbp ? t.fbp : undefined,
    fbc: typeof t.fbc === 'string' && t.fbc ? t.fbc : undefined,
    client_ip_address: typeof t.client_ip === 'string' && t.client_ip ? t.client_ip : undefined,
    client_user_agent: typeof t.client_ua === 'string' && t.client_ua ? t.client_ua : undefined,
  };
  Object.keys(u).forEach((k) => u[k] === undefined && delete u[k]);
  return u;
}

// Envia o Purchase de um pedido pago. `p` = payload do webhook da ClownPay.
async function sendPurchase(p) {
  const pixel = process.env.META_PIXEL_ID, token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token) { console.warn('[meta] META_PIXEL_ID/META_CAPI_TOKEN ausentes: Purchase não enviado.'); return { skipped: true }; }

  const ref = String(p.external_id || p.store_reference || '');
  const user = buildUserData(p);
  // Eventos "website" exigem IP e user-agent do navegador; sem eles, enviamos como evento do sistema.
  const website = !!(user.client_ip_address && user.client_user_agent);

  const event = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: ref,                                           // = event_id do Pixel => deduplica
    action_source: website ? 'website' : 'system_generated',
    ...(website && process.env.PUBLIC_BASE_URL ? { event_source_url: process.env.PUBLIC_BASE_URL } : {}),
    user_data: user,
    custom_data: {
      currency: 'BRL',
      value: Number(p.amount) / 100,
      order_id: ref,
      content_type: 'product',
      ...(p.product && p.product.name ? { content_name: String(p.product.name) } : {}),
    },
  };
  const body = { data: [event], access_token: token };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;

  const res = await fetch('https://graph.facebook.com/' + VERSION + '/' + encodeURIComponent(pixel) + '/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Meta HTTP ' + res.status + ': ' + text.slice(0, 300));
  console.log('[meta] Purchase enviado:', ref, website ? 'website' : 'system_generated', text.slice(0, 120));
  return { ok: true };
}

module.exports = { sendPurchase, buildUserData };
