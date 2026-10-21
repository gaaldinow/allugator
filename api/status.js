// GET /api/status?id=PEDIDO  — usado pelo site para saber se o Pix foi pago.
const { send } = require('./_lib');
const velani = require('./_velani');

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'Método não permitido.' }); }
  if (velani.isMock && process.env.VERCEL_ENV === 'production' && process.env.ALLOW_MOCK !== '1') return send(res, 503, { error: 'Indisponível.' });
  const id = String((req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id') || '');
  if (!/^[\w.-]{3,100}$/.test(id)) return send(res, 400, { error: 'Pedido inválido.' });
  try { return send(res, 200, await velani.getCharge(id)); }
  catch (e) { console.error('[status]', e.message); return send(res, 502, { error: 'Falha ao consultar o pagamento.' }); }
};
