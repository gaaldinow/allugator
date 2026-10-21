// Utilidades compartilhadas (validação no servidor, respostas JSON).
const digits = (v) => String(v || '').replace(/\D/g, '');

function isValidCPF(raw) {
  const c = digits(raw);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== +c[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === +c[10];
}

const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

// Valida o pedido vindo do navegador. Retorna { ok, fields, clean }.
function validateOrder(b) {
  const f = {};
  const c = b.customer || {}, a = b.address || {};
  const name = String(c.name || '').trim().replace(/\s+/g, ' ');
  if (name.split(' ').filter((w) => w.length > 1).length < 2) f.name = 'Informe seu nome completo.';
  if (!isValidCPF(c.cpf)) f.cpf = 'CPF inválido.';
  const email = String(c.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) f.email = 'Informe um e-mail válido.';
  const phone = digits(c.phone);
  if (!(phone.length === 10 || phone.length === 11)) f.phone = 'Informe um celular válido com DDD.';
  if (digits(a.cep).length !== 8) f.cep = 'CEP inválido.';
  if (!UFS.has(a.uf)) f.uf = 'UF inválida.';
  if (String(a.street || '').trim().length < 3) f.street = 'Informe a rua.';
  if (!String(a.number || '').trim()) f.number = 'Informe o número.';
  if (String(a.district || '').trim().length < 2) f.district = 'Informe o bairro.';
  if (String(a.city || '').trim().length < 2) f.city = 'Informe a cidade.';
  if (b.method !== 'pix') f.method = 'Pagamento disponível apenas via Pix.';
  if (!/^[\w-]{8,80}$/.test(String(b.idempotencyKey || ''))) f.idempotencyKey = 'Requisição inválida.';
  if (Object.keys(f).length) return { ok: false, fields: f };
  return {
    ok: true,
    clean: {
      product: String(b.product || ''), method: b.method, idempotencyKey: b.idempotencyKey,
      customer: { name, cpf: digits(c.cpf), email, phone },
      address: { cep: digits(a.cep), street: a.street.trim(), number: String(a.number).trim(), complement: String(a.complement || '').trim(), district: a.district.trim(), city: a.city.trim(), uf: a.uf },
      signature: String(b.signature || '').trim().slice(0, 120),
      tracking: b.tracking && typeof b.tracking === 'object' ? b.tracking : {},
    },
  };
}

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Lê o corpo cru (necessário para validar assinatura de webhook).
function rawBody(req) {
  return new Promise((resolve, reject) => {
    let d = '', n = 0;
    req.on('data', (c) => { n += c.length; if (n > 100_000) { reject(new Error('payload too large')); req.destroy(); } else d += c; });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

async function jsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel já parseou
  const raw = typeof req.body === 'string' ? req.body : await rawBody(req);
  return raw ? JSON.parse(raw) : {};
}

module.exports = { digits, isValidCPF, validateOrder, send, rawBody, jsonBody };
