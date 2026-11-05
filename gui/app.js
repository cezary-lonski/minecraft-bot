// Logika okna centrum sterowania (wiele botow).
const $ = id => document.getElementById(id)
const B = window.bridge

let profiles = []
let running = new Set()
let selected = null // id wybranego bota (panel, budowanie, komendy)
const statuses = new Map() // id -> ostatni stan
const logs = new Map() // id -> [{kind, text}]

const pretty = n => (n || '').replace(/_/g, ' ')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const profile = id => profiles.find(p => p.id === id)
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')

function toast(text, kind = '') {
  const t = $('toast')
  t.textContent = text
  t.className = 'toast ' + kind
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3500)
}

async function send(cmd, id = selected) {
  if (!id) { toast('Najpierw wybierz bota w zakładce Graj.', 'err'); return false }
  const res = await B.command(id, cmd)
  if (!res.ok) toast(res.error, 'err')
  return res.ok
}

// ---------- nawigacja ----------
function showView(name) {
  document.querySelectorAll('.nav').forEach(x => x.classList.toggle('active', x.dataset.view === name))
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name))
  if (name === 'play') renderBots()
}
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)))

// ---------- lista botow (Graj) ----------
const COLORS = ['#5fbf4a', '#6aa8ff', '#e5b84a', '#b48cff', '#e0524f', '#4ac6c6']
const colorFor = name => COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length]

async function renderBots() {
  profiles = await B.profiles()
  const mem = {}
  await Promise.all(profiles.map(async p => { mem[p.id] = await B.memory(p.id) }))
  $('botGrid').innerHTML = profiles.map(p => {
    const m = mem[p.id] || {}
    const on = running.has(p.id)
    const s = statuses.get(p.id)
    const where = p.mode === 'lan' ? `🖥 LAN, port ${esc(p.port) || '?'}` : `🌐 ${esc(p.host) || '?'}`
    const wp = Object.keys(m.waypoints || {}).length
    const memLine = [
      m.waypoints?.baza ? '🚩 ma bazę' : '',
      wp ? `📍 ${wp} punktów` : '',
      (m.builds || []).length ? `🏰 ${m.builds.length} budowli` : '',
      m.lastTask ? `⏸ przerwane: „${esc(m.lastTask.cmd)}”` : ''
    ].filter(Boolean).join(' · ') || 'Jeszcze nic nie zbudował.'
    return `<div class="bot-card ${on ? 'on' : ''} ${p.id === selected ? 'sel' : ''}" data-id="${p.id}">
      ${p.skin ? '<canvas class="avatar skin-avatar" width="64" height="64"></canvas>' : `<div class="avatar" style="background:${colorFor(p.name)}">${esc(p.name[0].toUpperCase())}</div>`}
      <div class="bot-info">
        <div class="bot-name">${esc(p.name)} ${on ? `<span class="badge">${s?.connected ? 'w grze' : 'łączy…'}</span>` : ''}</div>
        <div class="muted">${where}</div>
        <div class="bot-mem">${memLine}</div>
        ${on && s?.task ? `<div class="bot-task">⚒ ${esc(s.task)}</div>` : ''}
      </div>
      <div class="bot-btns">
        <button class="btn ${on ? 'danger' : 'primary'} small" data-act="${on ? 'stop' : 'play'}">${on ? '⏹ Stop' : '▶ Graj'}</button>
        <button class="btn ghost small" data-act="edit" title="Nick, świat, port, ustawienia">📝 Edytuj</button>
        <button class="btn ghost small danger-text" data-act="del" title="Usuwa bota i jego pamięć">🗑 Usuń</button>
      </div>
    </div>`
  }).join('') + `<div class="bot-card new" data-act="new"><div class="avatar plus">＋</div><div class="bot-info"><div class="bot-name">Nowy bot</div>
    <div class="muted">Stwórz zupełnie nowego bota z własnym nickiem i światem</div></div></div>`
  $('btnStopAll').classList.toggle('hidden', running.size < 2)
  // glowy ze skinow na kartach
  document.querySelectorAll('#botGrid .bot-card').forEach(card => {
    const p = profile(card.dataset.id)
    const c = card.querySelector('canvas.skin-avatar')
    if (p?.skin && c) drawSkinHead(c, p.skin)
  })
}

// glowa ze skina (twarz 8x8 + warstwa czapki), powiekszona bez rozmywania; zwraca, czy skin ma szczuple rece
function drawSkinHead(canvas, dataUrl) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, canvas.width, canvas.height)
      // szczuply skin (Alex): rece maja 3 piksele - kolumny 54-55 przy prawej rece sa przezroczyste
      let slim = false
      try {
        const t = document.createElement('canvas')
        t.width = 64; t.height = 64
        const tc = t.getContext('2d', { willReadFrequently: true })
        tc.drawImage(img, 0, 0)
        slim = img.height === 64 && tc.getImageData(54, 20, 1, 1).data[3] === 0 && tc.getImageData(55, 20, 1, 1).data[3] === 0
      } catch {}
      resolve({ slim })
    }
    img.onerror = () => resolve({ slim: false })
    img.src = dataUrl
  })
}

$('botGrid').addEventListener('click', async e => {
  const card = e.target.closest('.bot-card')
  if (!card) return
  const act = e.target.closest('[data-act]')?.dataset.act
  const id = card.dataset.id
  if (act === 'new' || card.classList.contains('new')) return openModal(null)
  if (act === 'edit') return openModal(profile(id))
  if (act === 'del') return deleteBot(id)
  if (act === 'stop') return B.stop(id)
  if (act === 'play') return playBot(id)
  selectBot(id)
  renderBots()
})
$('botGrid').addEventListener('dblclick', e => {
  const card = e.target.closest('.bot-card')
  if (card && card.dataset.id && !e.target.closest('button')) playBot(card.dataset.id)
})
$('btnStopAll').addEventListener('click', () => running.forEach(id => B.stop(id)))

// usuwa bota (dzialajacego najpierw wylacza) razem z jego pamiecia
async function deleteBot(id) {
  const p = profile(id)
  if (!p) return
  const on = running.has(id)
  if (!confirm(`Usunąć bota ${p.name}?${on ? ' Najpierw zostanie wyłączony.' : ''}\nZniknie też jego pamięć (baza, punkty, budowle). Projekty i własne komendy zostają.`)) return
  await B.deleteProfile(id)
  running.delete(id)
  statuses.delete(id)
  logs.delete(id)
  closeModal()
  profiles = await B.profiles()
  if (selected === id) selectBot(profiles.find(x => running.has(x.id))?.id || profiles[0]?.id || null)
  await renderBots()
  renderTabs()
  toast(`Usunięto bota ${p.name}`, 'ok')
}

async function playBot(id) {
  selectBot(id)
  if (!running.has(id)) {
    const res = await B.start(id)
    if (!res.ok) { toast(res.error, 'err'); openModal(profile(id)); return }
  }
  showView('panel')
}

// ---------- wybor bota ----------
function selectBot(id) {
  selected = id
  const p = profile(id)
  $('buildBotName').textContent = p ? p.name : '-'
  renderTabs()
  renderLog()
  renderStatus()
  renderQuick()
  renderTeam()
}

function renderTabs() {
  const ids = [...new Set([...running, ...(selected ? [selected] : [])])]
  $('botTabs').innerHTML = ids.map(id => {
    const p = profile(id)
    if (!p) return ''
    const s = statuses.get(id)
    return `<button class="tab ${id === selected ? 'active' : ''}" data-id="${id}"><span class="dot ${running.has(id) ? (s?.connected ? 'on' : 'wait') : 'off'}"></span>${esc(p.name)}</button>`
  }).join('') + '<button class="tab add" data-add="1">＋ bot</button>'
  $('runningList').innerHTML = running.size
    ? [...running].map(id => `<button class="run-item" data-id="${id}"><span class="dot ${statuses.get(id)?.connected ? 'on' : 'wait'}"></span>${esc(profile(id)?.name)}</button>`).join('')
    : '<span class="muted">żaden</span>'
}
$('botTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab')
  if (!t) return
  if (t.dataset.add) return showView('play')
  selectBot(t.dataset.id)
})
$('runningList').addEventListener('click', e => {
  const t = e.target.closest('.run-item')
  if (t) { selectBot(t.dataset.id); showView('panel') }
})

// ---------- start / stop (pasek gorny) ----------
function renderTop() {
  const p = profile(selected)
  const on = running.has(selected)
  const s = statuses.get(selected)
  $('btnStart').textContent = on ? '⏹ Wyłącz' : '▶ Uruchom'
  $('btnStart').classList.toggle('danger', on)
  $('btnStart').classList.toggle('primary', !on)
  $('btnStart').disabled = !p
  $('btnEdit').disabled = !p
  if (!p) { $('connDot').className = 'dot off'; $('connText').textContent = 'Wybierz bota'; $('taskText').textContent = ''; return }
  $('connDot').className = 'dot ' + (!on ? 'off' : s?.connected ? 'on' : 'wait')
  $('connText').textContent = `${p.name}: ` + (!on ? 'wyłączony' : s?.connected ? 'w grze' : 'łączy…')
  $('taskText').textContent = s?.task ? `⚒ ${s.task}${s.step ? ' — ' + s.step : ''}` : (s?.question ? '❓ czeka na odpowiedź (tak / nie)' : 'brak zadania')
}
$('btnStart').addEventListener('click', async () => {
  if (!selected) return
  if (running.has(selected)) { B.stop(selected); return }
  playBot(selected)
})
$('btnStop').addEventListener('click', () => send('stop'))
$('btnEdit').addEventListener('click', () => { if (selected) openModal(profile(selected)) })

B.on('bot-state', s => {
  if (s.running) running.add(s.id)
  else { running.delete(s.id); statuses.delete(s.id) }
  renderTabs()
  renderTop()
  renderTeam()
  if (document.getElementById('view-play').classList.contains('active')) renderBots()
})

// ---------- stan wybranego bota ----------
function setBar(id, valId, v) {
  $(id).style.width = v == null ? '0%' : Math.max(0, Math.min(100, (v / 20) * 100)) + '%'
  $(valId).textContent = v == null ? '-' : `${Math.round(v)}/20`
}

function renderStatus() {
  renderTop()
  const s = statuses.get(selected) || {}
  setBar('hpBar', 'hpVal', s.health)
  setBar('foodBar', 'foodVal', s.food)
  $('posVal').textContent = s.pos ? `${s.pos.x}  ${s.pos.y}  ${s.pos.z}` : '-'
  $('dimVal').textContent = pretty(s.dim) || '-'
  $('gmVal').textContent = s.gameMode || '-'
  $('heldVal').textContent = s.connected ? (pretty(s.held) || 'nic') : '-'
  const armor = (s.armor || []).filter(Boolean)
  $('armorVal').textContent = s.connected ? (armor.length ? armor.map(pretty).join(', ') : 'brak') : '-'
  $('stepVal').textContent = s.step || '-'
  const items = Object.entries(s.inventory || {}).sort((a, b) => b[1] - a[1])
  $('invCount').textContent = items.length ? `(${items.length} rodzajów)` : ''
  $('invList').innerHTML = items.length
    ? items.map(([n, c]) => `<div class="item" title="${esc(n)}"><span>${esc(pretty(n))}</span><b>${c}</b></div>`).join('')
    : `<span class="muted">${s.connected ? 'Pusty ekwipunek.' : 'Bot nie jest w grze.'}</span>`
}

B.on('status', s => {
  statuses.set(s.id, s)
  if (s.id === selected) renderStatus()
  renderTeam()
  // co jakis czas odswiezamy kropki w zakladkach
  if (!renderTabs.last || Date.now() - renderTabs.last > 3000) { renderTabs.last = Date.now(); renderTabs() }
})

// ---------- zespol ----------
function renderTeam() {
  const others = [...running].filter(id => id !== selected)
  if (!selected || !others.length) {
    $('teamList').innerHTML = '<span class="muted">Uruchom drugiego bota, żeby mogły współpracować: pomagać w budowie, burzeniu i walce oraz wymieniać się przedmiotami.</span>'
    return
  }
  const me = profile(selected)?.name
  $('teamList').innerHTML = others.map(id => {
    const p = profile(id)
    const s = statuses.get(id) || {}
    const top = Object.entries(s.inventory || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${pretty(n)} ×${c}`).join(', ')
    return `<div class="mate">
      <div class="mate-head"><span class="dot ${s.connected ? 'on' : 'wait'}"></span><b>${esc(p?.name)}</b>
        <span class="muted">${s.task ? '⚒ ' + esc(s.task) : 'wolny'}</span></div>
      <div class="muted small">${esc(top) || 'pusty ekwipunek'}</div>
      <div class="mate-btns">
        <button class="btn small" data-team="pomoz ${esc(p?.name)}" title="${esc(me)} dołącza do pracy ${esc(p?.name)}">🤝 ${esc(me)} pomaga</button>
        <button class="btn small ghost" data-team-other="${id}" data-cmd="pomoz ${esc(me)}">↩ ${esc(p?.name)} pomaga</button>
        <button class="btn small ghost" data-ask="${esc(p?.name)}">📦 Poproś o…</button>
      </div>
    </div>`
  }).join('')
}
$('teamList').addEventListener('click', e => {
  const t = e.target.closest('button')
  if (!t) return
  if (t.dataset.team) send(t.dataset.team)
  if (t.dataset.teamOther) send(t.dataset.cmd, t.dataset.teamOther)
  if (t.dataset.ask) {
    $('cmdInput').value = `popros ${t.dataset.ask} o <co> <ile>`
    const m = $('cmdInput').value.match(/<[^>]+>/)
    $('cmdInput').focus()
    $('cmdInput').setSelectionRange(m.index, m.index + m[0].length)
  }
})

// ---------- log ----------
const logEl = $('log')
const shown = { server: true, bot: true, team: true, info: false, error: true, me: true, gui: true }
document.querySelectorAll('.filters input').forEach(cb => cb.addEventListener('change', () => {
  shown[cb.dataset.kind] = cb.checked
  renderLog()
}))
$('btnClear').addEventListener('click', () => { if (selected) logs.set(selected, []); renderLog() })

function lineEl(m) {
  const line = document.createElement('div')
  line.className = 'line ' + m.kind
  let text = m.text.replace(/^\[(bot|serwer)\]\s*/, '')
  if (m.kind === 'server') text = '💬 ' + text
  if (m.kind === 'bot') text = '🤖 ' + text
  if (m.kind === 'team') text = '🤝 ' + text
  line.textContent = text
  return line
}
function renderLog() {
  logEl.innerHTML = ''
  for (const m of logs.get(selected) || []) if (shown[m.kind]) logEl.appendChild(lineEl(m))
  logEl.scrollTop = logEl.scrollHeight
}
function addLog(id, m) {
  if (!logs.has(id)) logs.set(id, [])
  const arr = logs.get(id)
  arr.push(m)
  if (arr.length > 800) arr.shift()
  if (id !== selected || !shown[m.kind]) return
  const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 30
  logEl.appendChild(lineEl(m))
  while (logEl.children.length > 800) logEl.firstChild.remove()
  if (atBottom) logEl.scrollTop = logEl.scrollHeight
}
B.on('log', m => addLog(m.id, m))
B.on('team', m => {
  // prosby i odpowiedzi miedzy botami: w logu nadawcy
  const what = m.type === 'help' ? `prosi o pomoc${m.job?.kind ? ' (' + ({ build: 'budowa', decor: 'wystrój', demolish: 'burzenie', fight: 'walka' }[m.job.kind] || m.job.kind) + ')' : ''}`
    : m.type === 'request' ? `prosi ${m.to} o ${m.count} × ${pretty(m.item)}`
      : m.type === 'reply' ? `→ ${m.to}: ${m.text}` : m.text || m.type
  addLog(m.id, { kind: 'team', text: `${m.from} ${what}` })
})

// ---------- komendy z podpowiedziami ----------
const input = $('cmdInput')
const sugg = $('suggest')
const history = []
let histPos = -1
let suggIdx = 0
let suggItems = []

function updateSuggest() {
  const q = norm(input.value.trim())
  if (!q) { sugg.classList.add('hidden'); suggItems = []; return }
  suggItems = COMMANDS.filter(c => norm(c.cmd).startsWith(q) || norm(c.cmd).includes(q) || norm(c.desc).includes(q)).slice(0, 7)
  if (!suggItems.length) { sugg.classList.add('hidden'); return }
  suggIdx = Math.min(suggIdx, suggItems.length - 1)
  sugg.innerHTML = suggItems.map((c, i) => `<div class="s-item ${i === suggIdx ? 'sel' : ''}" data-i="${i}"><code>${esc(c.cmd)}</code><span>${esc(c.desc)}</span></div>`).join('')
  sugg.classList.remove('hidden')
}
function acceptSuggest(i) {
  const c = suggItems[i]
  if (!c) return
  input.value = c.cmd
  const m = c.cmd.match(/<[^>]+>/)
  input.focus()
  if (m) input.setSelectionRange(m.index, m.index + m[0].length)
  sugg.classList.add('hidden')
}
async function submit() {
  const text = input.value.trim()
  if (!text) return
  if (/<[^>]+>/.test(text)) { toast('Uzupełnij pola w nawiasach < >', 'err'); return }
  if (await send(text)) {
    history.unshift(text)
    histPos = -1
    input.value = ''
    sugg.classList.add('hidden')
  }
}
input.addEventListener('input', () => { suggIdx = 0; updateSuggest() })
input.addEventListener('keydown', e => {
  const open = !sugg.classList.contains('hidden')
  if (e.key === 'Tab') { e.preventDefault(); if (open) acceptSuggest(suggIdx); return }
  if (e.key === 'Enter') { e.preventDefault(); submit(); return }
  if (e.key === 'Escape') { sugg.classList.add('hidden'); return }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (open) { suggIdx = (suggIdx + 1) % suggItems.length; updateSuggest() } else if (histPos > 0) { histPos--; input.value = history[histPos] } else { histPos = -1; input.value = '' }
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (open && input.value) { suggIdx = (suggIdx - 1 + suggItems.length) % suggItems.length; updateSuggest() } else if (histPos < history.length - 1) { histPos++; input.value = history[histPos] }
  }
})
sugg.addEventListener('mousedown', e => {
  const it = e.target.closest('.s-item')
  if (it) { e.preventDefault(); acceptSuggest(Number(it.dataset.i)) }
})
input.addEventListener('blur', () => setTimeout(() => sugg.classList.add('hidden'), 150))
$('btnSend').addEventListener('click', submit)

// ---------- szybkie akcje ----------
function renderQuick() {
  const p = profile(selected)
  const who = p && (p.player || p.owner)
  $('quickGrid').innerHTML = QUICK.map(q => `<button class="qbtn" data-cmd="${q.cmd}" ${q.needsPlayer && !who ? 'disabled title="Ustaw swój nick w ustawieniach bota"' : ''}>${q.label}</button>`).join('')
  $('playerHint').textContent = !p ? '' : who
    ? `„Do mnie”, „Za mną” i „Daj” działają dla gracza: ${who}`
    : 'Wpisz swój nick w ustawieniach bota (⚙ w zakładce Graj), żeby działały „Do mnie”, „Za mną” i „Daj”.'
}
$('quickGrid').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) send(b.dataset.cmd) })

// ---------- budowanie ----------
function renderBuild() {
  $('buildGrid').innerHTML = BUILDINGS.map(b => `
    <div class="bcard">
      <div class="bicon">${b.icon}</div>
      <h4>${b.name}</h4>
      <p>${b.desc}</p>
      <div class="mat">📦 ${b.mat}</div>
      <div class="bbtns">
        <button class="btn primary small" data-cmd="buduj ${b.id}">Buduj</button>
        ${b.decor ? `<button class="btn ghost small danger-text" data-cmd="zburz ${b.id}">Zburz</button>` : ''}
      </div>
    </div>`).join('')
  $('farmChips').innerHTML = FARMS.map(f => `<button class="chip" data-cmd="${f.cmd}">${f.label}</button>`).join('')
}
$('view-build').addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]')
  if (b) send(b.dataset.cmd).then(ok => ok && toast(`${profile(selected)?.name}: ${b.dataset.cmd}`))
})
$('btnSign').addEventListener('click', () => {
  const text = $('signText').value.trim()
  if (!text) return toast('Wpisz tekst napisu', 'err')
  const mat = $('signMat').value
  send(mat ? `buduj napis z ${mat}: ${text}` : `buduj napis: ${text}`).then(ok => ok && toast('Wysłano napis'))
})

// ---------- lista komend ----------
function renderCommands() {
  const q = norm($('cmdSearch').value.trim())
  const list = COMMANDS.filter(c => !q || norm(c.cmd + ' ' + c.desc + ' ' + c.cat).includes(q))
  const cats = [...new Set(list.map(c => c.cat))]
  $('cmdList').innerHTML = cats.map(cat => `
    <div class="card"><h3>${cat}</h3>
      ${list.filter(c => c.cat === cat).map(c => `
        <div class="crow">
          <code>${esc(c.cmd)}</code><span>${esc(c.desc)}</span>
          <button class="btn ghost small" data-insert="${esc(c.cmd)}">Wstaw</button>
          ${/<[^>]+>/.test(c.cmd) ? '<span></span>' : `<button class="btn small" data-send="${esc(c.cmd)}">Wyślij</button>`}
        </div>`).join('')}
    </div>`).join('') || '<p class="muted">Nic nie pasuje.</p>'
}
$('cmdSearch').addEventListener('input', renderCommands)
$('cmdList').addEventListener('click', e => {
  const ins = e.target.closest('[data-insert]')
  const snd = e.target.closest('[data-send]')
  if (snd) send(snd.dataset.send).then(ok => ok && toast('Wysłano: ' + snd.dataset.send))
  if (ins) {
    showView('panel')
    input.value = ins.dataset.insert
    const m = input.value.match(/<[^>]+>/)
    input.focus()
    if (m) input.setSelectionRange(m.index, m.index + m[0].length)
  }
})

// ---------- okno nowego / edycji bota ----------
const form = $('botForm')
function setMode(mode) {
  form.dataset.mode = mode
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode))
  form.querySelectorAll('.lan-only').forEach(el => el.classList.toggle('hidden', mode !== 'lan'))
  form.querySelectorAll('.srv-only').forEach(el => el.classList.toggle('hidden', mode === 'lan'))
}
document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)))

function openModal(p) {
  const d = p || { name: '', mode: 'lan', port: '', host: '', player: '', owner: '', password: '', version: '', loot: 'auto', rtp: true, chatDelay: '', eatBelow: 8, autoHelp: true }
  $('modalTitle').textContent = p ? `Ustawienia: ${p.name}` : 'Nowy bot'
  for (const el of form.elements) {
    if (!el.name) continue
    if (el.name === 'aiChat') el.checked = !!d.aiChat // domyslnie wylaczone (zapytania do AI maja limit albo kosztuja)
    else if (el.type === 'checkbox') el.checked = d[el.name] !== false && !!(d[el.name] ?? true)
    else el.value = d[el.name] ?? ''
  }
  $('formAiKey').value = ''
  B.aiKeys().then(k => { $('formAiKey').placeholder = k.gemini || k.claude ? `zapisany ✓ (${k.provider === 'claude' ? 'Claude' : 'Gemini'}) – zostaw puste albo wklej nowy` : 'AQ.… / AIza… (Gemini) albo sk-ant-… (Claude)' })
  form.elements.id.value = p ? p.id : ''
  $('btnDelete').classList.toggle('hidden', !p)
  renderSkin(p ? p.id : null)
  $('btnSavePlay').textContent = p && running.has(p.id) ? 'Zapisz i uruchom ponownie' : 'Zapisz i graj'
  setMode(d.mode || 'lan')
  $('formMsg').textContent = ''
  $('modal').classList.remove('hidden')
  form.elements.name.focus()
}
const closeModal = () => $('modal').classList.add('hidden')

// ---------- skin bota ----------
const MODEL_PL = { slim: 'szczupły (ręce 3 px, jak Alex)', wide: 'klasyczny (ręce 4 px, jak Steve)' }
async function renderSkin(id) {
  const head = $('skinHead')
  head.getContext('2d').clearRect(0, 0, head.width, head.height)
  $('btnSkin').disabled = !id
  $('btnSkinDel').classList.add('hidden')
  if (!id) { $('skinInfo').textContent = 'Zapisz bota, żeby dodać mu skin.'; return }
  const info = await B.skinInfo(id)
  if (!info.ok) return
  const lines = [`W grze ten nick ma model ${MODEL_PL[info.slot.model]} – domyślnie wygląda jak ${info.slot.skin[0].toUpperCase() + info.slot.skin.slice(1)}.`]
  if (info.skin) {
    const { slim } = await drawSkinHead(head, info.skin)
    $('btnSkinDel').classList.remove('hidden')
    lines.push(`Skin jest w paczce zasobów „${info.packName}”. W grze włącz ją raz: Opcje → Paczki zasobów; po zmianie skina wciśnij F3+T.`)
    if (slim !== (info.slot.model === 'slim')) lines.push(`⚠ Ten skin ma ${slim ? 'szczupłe' : 'szerokie'} ręce, a bot ${slim ? 'szerokie' : 'szczupłe'} – ręce mogą wyglądać trochę dziwnie.`)
    if (info.clash.length) lines.push(`⚠ ${info.clash.join(', ')} ma ten sam domyślny skin – w grze oba boty będą wyglądać tak samo.`)
  } else {
    lines.push('Zaimportuj plik PNG skina (64×64), np. pobrany ze strony ze skinami.')
  }
  $('skinInfo').innerHTML = lines.map(esc).join('<br>')
}
$('btnSkin').addEventListener('click', async () => {
  const id = form.elements.id.value
  const r = await B.skinImport(id)
  if (r.canceled) return
  if (!r.ok) { toast(r.error, 'err'); return }
  toast('Skin zaimportowany – w grze włącz paczkę zasobów „MinecraftBot-skiny”', 'ok')
  renderSkin(id)
  renderBots()
})
$('btnSkinDel').addEventListener('click', async () => { const id = form.elements.id.value; await B.skinRemove(id); renderSkin(id); renderBots() })
$('btnSkinPacks').addEventListener('click', () => B.skinOpenPacks())
$('btnCancel').addEventListener('click', closeModal)
$('modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal() })

async function saveForm() {
  const p = { mode: form.dataset.mode }
  for (const el of form.elements) {
    if (!el.name) continue
    p[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim()
  }
  if (!p.id) delete p.id
  // klucz AI nie jest czescia profilu - trafia zaszyfrowany do ustawien programu
  const aiKey = $('formAiKey').value.trim()
  if (aiKey) {
    const k = await B.aiSetKey(aiKey)
    if (!k.ok) { $('formMsg').textContent = k.error; return null }
    if (typeof updateKeyState === 'function') updateKeyState()
  }
  if (p.aiChat && !aiKey && !(await B.aiHasKey())) { $('formMsg').textContent = 'AI w grze potrzebuje klucza – wklej klucz Gemini albo Claude.'; return null }
  const res = await B.saveProfile(p)
  if (!res.ok) { $('formMsg').textContent = res.error; return null }
  closeModal()
  await renderBots()
  if (running.has(res.id)) toast('Zapisano. Zmiany połączenia zadziałają po ponownym uruchomieniu bota.', 'ok')
  return res.id
}
form.addEventListener('submit', async e => { e.preventDefault(); const id = await saveForm(); if (id) selectBot(id) })
$('btnSavePlay').addEventListener('click', async () => {
  const wasOn = running.has(form.elements.id.value)
  const id = await saveForm()
  if (!id) return
  if (wasOn) {
    // nowe ustawienia polaczenia dzialaja dopiero po ponownym uruchomieniu bota
    await B.stop(id)
    for (let i = 0; i < 30 && running.has(id); i++) await new Promise(r => setTimeout(r, 100))
  }
  playBot(id)
})
$('btnDelete').addEventListener('click', () => { const id = form.elements.id.value; if (id) deleteBot(id) })

// ---------- aktualizacje ----------
B.on('update', u => {
  $('updText').textContent = u.text
  $('updProg').classList.toggle('hidden', u.state !== 'downloading')
  if (u.percent != null) $('updFill').style.width = u.percent + '%'
  $('btnInstall').classList.toggle('hidden', u.state !== 'ready')
  $('updDot').classList.toggle('hidden', u.state !== 'ready')
  if (u.state === 'ready') toast(`Nowa wersja ${u.version} jest gotowa – zakładka Aktualizacje`, 'ok')
})
$('btnCheck').addEventListener('click', async () => { const r = await B.checkUpdate(); if (!r.ok) toast(r.error, 'err') })
$('btnInstall').addEventListener('click', () => B.installUpdate())
$('autoUpdate').addEventListener('change', e => B.saveAppSettings({ autoUpdate: e.target.checked }))
$('btnData').addEventListener('click', () => B.openDataDir(null))

// ---------- start ----------
;(async () => {
  const v = await B.version()
  $('version').textContent = 'wersja ' + v
  $('verBig').textContent = v
  $('autoUpdate').checked = (await B.appSettings()).autoUpdate
  running = new Set(await B.running())
  await renderBots()
  renderBuild()
  renderCommands()
  selectBot(profiles.find(p => running.has(p.id))?.id || profiles[0]?.id || null)
  if (!profiles.length) openModal(null)
})()
