/**
 * Envia as UTMs do pedido para a VTrack. Totalmente isolado: nunca lança erro e nunca atrasa o Pix.
 *
 * Variável de ambiente (Vercel > Settings > Environment Variables):
 *   VTRACK_URL   URL completa do endpoint, incluindo o ?token=... (fica só no servidor)
 * Sem ela, o envio é ignorado.
 */
const TRACK_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'sck'];
const TIMEOUT_MS = 3000;

function pickUtms(t) {
  const s = t || {}, o = {};
  let any = false;
  TRACK_KEYS.forEach((k) => {
    const ok = typeof s[k] === 'string' && s[k];
    o[k] = ok ? s[k].slice(0, 200) : null;
    if (ok) any = true;
  });
  return any ? o : null;
}

// Retorna uma Promise que NUNCA rejeita. Não precisa de await.
function sendUtms(orderId, tracking, extra) {
  try {
    const url = process.env.VTRACK_URL;
    if (!url || !orderId) return Promise.resolve();
    if (extra && extra.isTest) return Promise.resolve();        // não polui a VTrack com pedidos de teste
    const utms = pickUtms(tracking);
    if (!utms) return Promise.resolve();                        // sem UTM, não há o que atribuir

    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
    return fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: String(orderId), utms }),
    })
      .then(async (r) => {
        if (!r.ok) console.error('[vtrack] HTTP', r.status, (await r.text().catch(() => '')).slice(0, 200));
      })
      .catch((e) => console.error('[vtrack] falha:', e && e.message))   // não loga a URL (tem token)
      .finally(() => clearTimeout(to));
  } catch (e) {
    console.error('[vtrack] erro:', e && e.message);
    return Promise.resolve();
  }
}

module.exports = { sendUtms };
