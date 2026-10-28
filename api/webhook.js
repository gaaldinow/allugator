// POST /api/webhook  — a Velani avisa aqui quando um pagamento muda de status.
// Cadastre em Desenvolvedores > Webhooks da Velani:  https://SEU-DOMINIO/api/webhook
// (a URL também vai automaticamente em cada cobrança via postbackUrl, se PUBLIC_BASE_URL estiver definida)
const { send, rawBody } = require('./_lib');
const velani = require('./_velani');

// O que fazer quando um pedido é pago (avisar no WhatsApp/Slack, e-mail, planilha, CRM...).
// A marcação da venda no Facebook é feita pela própria Velani (via UTMs enviadas na cobrança).
async function onPaid(data) {
  console.log('[webhook] PAGO:', data.id, 'pedido', data.externalId, 'R$', (data.amount / 100).toFixed(2));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Método não permitido.' }); }
  let raw;
  try { raw = await rawBody(req); } catch (e) { return send(res, 413, { error: 'Payload grande demais.' }); }
  let p;
  try { p = JSON.parse(raw || '{}'); } catch (e) { return send(res, 400, { error: 'JSON inválido.' }); }
  if (!p || typeof p !== 'object' || !p.data) return send(res, 400, { error: 'Evento inválido.' });

  const sig = velani.verifySignature(p);
  if (sig === false) return send(res, 401, { error: 'Assinatura inválida.' });
  if (sig === null) console.warn('[webhook] VELANI_WEBHOOK_SECRET ausente: assinatura não verificada (confirmando pela API).');

  try {
    if (p.event === 'transaction.paid' && p.data.id) {
      // Defesa extra: só age depois de confirmar na API da Velani que está mesmo pago.
      const real = await velani.getCharge(String(p.data.id));
      if (real.status === 'paid') await onPaid(p.data);
      else console.warn('[webhook] evento "paid" mas a API diz', real.status, '— ignorado.');
    }
  } catch (e) { console.error('[webhook] erro:', e.message); return send(res, 500, { error: 'Erro ao processar.' }); }
  return send(res, 200, { received: true });         // 200 sempre que recebido (a Velani reenvia se não for 200)
};
// Desliga o parser automático: lemos o corpo cru.
module.exports.config = { api: { bodyParser: false } };
