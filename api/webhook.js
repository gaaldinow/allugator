// POST /api/webhook  — a ClownPay avisa aqui quando um pagamento muda de status.
// A URL vai automaticamente em cada cobrança (postback_url), se PUBLIC_BASE_URL estiver definida.
// Opcional: cadastre também no portal da ClownPay (Configurações e API):  https://SEU-DOMINIO/api/webhook?token=SEU_TOKEN
// A ClownPay não assina o webhook: defina CLOWNPAY_WEBHOOK_TOKEN (vai como ?token= na URL) e, além disso,
// só agimos depois de confirmar o pagamento na API.
const { send, rawBody } = require('./_lib');
const clownpay = require('./_clownpay');
const meta = require('./_meta');

// O que fazer quando um pedido é pago (avisar no WhatsApp/Slack, e-mail, planilha, CRM...).
// Aqui também sai o Purchase para a Meta (API de Conversões), com o mesmo event_id do Pixel.
async function onPaid(data) {
  console.log('[webhook] PAGO:', data.transaction_id, 'pedido', data.external_id, 'R$', (data.amount / 100).toFixed(2));
  try { await meta.sendPurchase(data); }
  catch (e) { console.error('[meta] falha ao enviar Purchase:', e.message); }   // não derruba o webhook
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Método não permitido.' }); }

  let token = '';
  try { token = new URL(req.url, 'http://x').searchParams.get('token') || ''; } catch (e) { /* ignora */ }
  const auth = clownpay.verifyToken(token);
  if (auth === false) return send(res, 401, { error: 'Token inválido.' });
  if (auth === null) console.warn('[webhook] CLOWNPAY_WEBHOOK_TOKEN ausente: webhook sem token (confirmando pela API).');

  let raw;
  try { raw = await rawBody(req); } catch (e) { return send(res, 413, { error: 'Payload grande demais.' }); }
  let p;
  try { p = JSON.parse(raw || '{}'); } catch (e) { return send(res, 400, { error: 'JSON inválido.' }); }
  if (!p || typeof p !== 'object' || !p.status) return send(res, 400, { error: 'Evento inválido.' });

  const ref = String(p.external_id || p.store_reference || '');
  try {
    if (clownpay.mapStatus(p.status) === 'paid' && ref) {
      // Defesa extra: só age depois de confirmar na API da ClownPay que está mesmo pago.
      const real = await clownpay.getCharge(ref);
      if (real.status === 'paid') await onPaid(p);
      else console.warn('[webhook] evento "approved" mas a API diz', real.status, '— ignorado.');
    }
  } catch (e) { console.error('[webhook] erro:', e.message); return send(res, 500, { error: 'Erro ao processar.' }); }
  return send(res, 200, { received: true });         // 200 sempre que recebido (a ClownPay espera 200)
};
// Desliga o parser automático: lemos o corpo cru.
module.exports.config = { api: { bodyParser: false } };
