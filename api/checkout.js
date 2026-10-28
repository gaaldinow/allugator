// POST /api/checkout  — cria a cobrança Pix na Velani.
const { validateOrder, send, jsonBody } = require('./_lib');
const catalog = require('./_catalog');
const velani = require('./_velani');
const { saveOrder } = require('./_orders');

// Limite simples por IP (melhor esforço; em serverless é por instância).
const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 12;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Método não permitido.' }); }
  // Segurança: em produção, nunca rodar o modo teste (geraria um Pix falso para clientes reais).
  if (velani.isMock && process.env.VERCEL_ENV === 'production' && process.env.ALLOW_MOCK !== '1') {
    console.error('[checkout] VELANI_API_KEY não configurada em produção.');
    return send(res, 503, { error: 'Pagamento temporariamente indisponível. Tente novamente em instantes.' });
  }
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });

  let body;
  try { body = await jsonBody(req); } catch (e) { return send(res, 400, { error: 'Requisição inválida.' }); }

  const v = validateOrder(body || {});
  if (!v.ok) return send(res, 422, { error: v.fields.method || 'Confira os campos destacados.', fields: v.fields });

  const item = catalog[v.clean.product];
  if (!item) return send(res, 422, { error: 'Produto inválido.' });

  const order = {
    ...v.clean,
    amountCents: item.amountCents,                       // preço SEMPRE do servidor
    productName: item.name,
    externalId: 'allu-' + v.clean.idempotencyKey,
    description: 'allu · ' + item.name + ' · 1ª parcela',
  };
  try {
    const out = await velani.createCharge(order);
    await saveOrder({
      at: new Date().toISOString(), orderId: out.orderId, externalId: order.externalId, status: out.status,
      product: order.product, productName: item.name, amountCents: order.amountCents, plan: '1ª parcela hoje',
      customer: order.customer, address: order.address, contractSignedBy: order.signature,
      tracking: order.tracking, ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    });
    return send(res, 200, out);
  } catch (e) {
    console.error('[checkout] falha na Velani:', e.message, e.data ? JSON.stringify(e.data).slice(0, 400) : '');
    if (e.status === 429) return send(res, 503, { error: 'Muitas pessoas pagando agora. Tente novamente em alguns segundos.' });
    return send(res, 502, { error: 'Não foi possível gerar o Pix agora. Tente novamente em instantes.' });
  }
};
