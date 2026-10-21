// Registro do pedido. A Velani NÃO guarda endereço de entrega nem o aceite do contrato,
// então guardamos aqui. Configure ORDER_WEBHOOK_URL (Make/Zapier/Apps Script/Slack/Discord...)
// para receber cada pedido como JSON. Sem isso, o pedido completo vai para os Logs da Vercel.
async function saveOrder(record) {
  const url = process.env.ORDER_WEBHOOK_URL;
  if (url) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return;
    } catch (e) { console.error('[orders] ORDER_WEBHOOK_URL falhou:', e.message); }
  }
  console.log('[ORDER]', JSON.stringify(record));            // fallback: não perder o endereço
}
module.exports = { saveOrder };
