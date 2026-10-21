/**
 * RASTREAMENTO DE VENDAS NA UTMIFY (Orders API) — único arquivo que conversa com a UTMify.
 * Documentação: https://api.utmify.com.br  (Integrações > API de pedidos)
 *
 * Variáveis de ambiente (NUNCA no index.html — o token fica só no servidor):
 *   UTMIFY_API_TOKEN   token da UTMify (Integrações > Credenciais de API). Sem ele, o rastreamento é ignorado.
 *   UTMIFY_PLATFORM    nome da plataforma mostrado na UTMify (padrão "allu").
 *
 * Dispara em dois momentos:
 *   trackPending()  quando o Pix é gerado        -> status "waiting_payment"  (atribui a venda à UTM)
 *   trackPaid()     quando o pagamento é confirmado -> status "paid"           (marca a venda como paga)
 * A UTMify casa os dois eventos pelo mesmo orderId (id da transação na Velani).
 */
const URL = 'https://api.utmify.com.br/api-credentials/orders';
const ENABLED = !!process.env.UTMIFY_API_TOKEN;
const PLATFORM = process.env.UTMIFY_PLATFORM || 'allu';
const TRACK_KEYS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'src', 'sck'];

// Evita reenviar o mesmo "paid" várias vezes na mesma instância (webhook + reenvios da Velani).
const reportedPaid = new Set();

// Data em UTC no formato que a UTMify exige: "YYYY-MM-DD HH:MM:SS".
const utc = (d = new Date()) => (isNaN(d) ? new Date() : d).toISOString().replace('T', ' ').slice(0, 19);

// Todas as chaves de tracking presentes; null quando vazias (formato que a UTMify espera).
function tracking(t) {
  const s = t || {}, o = {};
  TRACK_KEYS.forEach((k) => { o[k] = (typeof s[k] === 'string' && s[k]) ? s[k].slice(0, 200) : null; });
  return o;
}

async function post(payload) {
  if (!ENABLED) return;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(URL, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-token': process.env.UTMIFY_API_TOKEN },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[utmify] HTTP', r.status, t.slice(0, 300));
    }
  } catch (e) {
    console.error('[utmify] falha:', e.message);     // nunca derruba o checkout
  } finally {
    clearTimeout(to);
  }
}

/* ---- Pix gerado -> waiting_payment (traz cliente + UTMs) ---- */
function trackPending(order, out, extra) {
  const cents = order.amountCents;
  return post({
    orderId: String(out.orderId),
    platform: PLATFORM,
    paymentMethod: 'pix',
    status: 'waiting_payment',
    createdAt: utc(),
    approvedDate: null,
    refundedAt: null,
    customer: {
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone || null,
      document: order.customer.cpf || null,
      country: 'BR',
      ip: (extra && extra.ip) || null,
    },
    products: [{ id: order.product, name: order.productName, planId: null, planName: null, quantity: 1, priceInCents: cents }],
    trackingParameters: tracking(order.tracking),
    commission: { totalPriceInCents: cents, gatewayFeeInCents: 0, userCommissionInCents: cents, currency: 'BRL' },
    isTest: !!(extra && extra.isTest),
  });
}

/* ---- Pagamento confirmado -> paid (atualiza o pedido pelo orderId) ---- */
// `data` é o objeto da transação que a Velani manda no webhook (id, amount, externalId, customer...).
function trackPaid(data, extra) {
  const id = String(data.id || '');
  if (!id || reportedPaid.has(id)) return;
  reportedPaid.add(id);
  if (reportedPaid.size > 5000) reportedPaid.clear();
  const cents = Number(data.amount) || 0;
  return post({
    orderId: id,
    platform: PLATFORM,
    paymentMethod: 'pix',
    status: 'paid',
    createdAt: data.createdAt ? utc(new Date(data.createdAt)) : utc(),
    approvedDate: utc(),
    refundedAt: null,
    customer: {
      name: data.customerName || data.customer?.name || 'Cliente',
      email: data.customerEmail || data.customer?.email || null,
      phone: data.customerPhone || data.customer?.phone || null,
      document: data.customerDocument || data.customer?.document?.number || null,
      country: 'BR',
    },
    products: [{ id: 'allu', name: data.description || data.productName || 'Pedido Allu', planId: null, planName: null, quantity: 1, priceInCents: cents }],
    trackingParameters: tracking(data.tracking),
    commission: { totalPriceInCents: cents, gatewayFeeInCents: 0, userCommissionInCents: cents, currency: 'BRL' },
    isTest: !!(extra && extra.isTest),
  });
}

module.exports = { enabled: ENABLED, trackPending, trackPaid };
