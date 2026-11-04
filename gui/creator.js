// Kreator budowli (opis -> podglad 3D -> zapis dla bota), asystent AI i wlasne komendy.
// Korzysta z app.js: $, B, esc, toast, send, selected, profile, showView.
/* global Designer, COMMANDS, $, B, esc, toast, send, selected, profile, showView */

// ---------- podglad izometryczny ----------
// rot: obrot o 90 stopni; domyslnie 2 - front budowli (drzwi, z = 0) w strone patrzacego
function drawIso(canvas, cells, { rot = 2, maxY = Infinity } = {}) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  const turn = (x, z) => rot === 0 ? [x, z] : rot === 1 ? [-z, x] : rot === 2 ? [-x, -z] : [z, -x]
  const pts = []
  for (const c of cells) {
    if (c.block === 'air' || c.temp || c.y > maxY) continue
    const [x, z] = turn(c.x, c.z)
    pts.push({ x, y: c.y, z, b: c.block })
  }
  if (!pts.length) {
    ctx.fillStyle = '#6b7080'
    ctx.font = '16px Segoe UI, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Opisz budowlę i kliknij „Stwórz”', W / 2, H / 2)
    return
  }
  const solidAt = new Set(pts.filter(p => !Designer.isGlass(p.b) && !Designer.isThin(p.b)).map(p => p.x + ',' + p.y + ',' + p.z))
  const proj = (x, y, z) => [(x - z) * 0.866, (x + z) * 0.5 - y]
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxYY = -Infinity
  for (const p of pts) {
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0], [1, 1, 1]]) {
      const [sx, sy] = proj(p.x + dx, p.y + dy, p.z + dz)
      if (sx < minX) minX = sx
      if (sx > maxX) maxX = sx
      if (sy < minY) minY = sy
      if (sy > maxYY) maxYY = sy
    }
  }
  const a = Math.min((W - 30) / (maxX - minX), (H - 30) / (maxYY - minY), 40)
  const ox = (W - (maxX - minX) * a) / 2 - minX * a
  const oy = (H - (maxYY - minY) * a) / 2 - minY * a
  const P = (x, y, z) => { const [sx, sy] = proj(x, y, z); return [ox + sx * a, oy + sy * a] }
  pts.sort((p, q) => (p.x + p.z) - (q.x + q.z) || p.y - q.y || p.x - q.x)
  const face = (poly, fill, alpha) => {
    ctx.globalAlpha = alpha
    ctx.fillStyle = fill
    ctx.beginPath()
    poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    ctx.closePath()
    ctx.fill()
    if (a > 6) { ctx.globalAlpha = alpha * 0.25; ctx.strokeStyle = '#000'; ctx.lineWidth = 0.6; ctx.stroke() }
  }
  for (const p of pts) {
    const col = Designer.blockColor(p.b)
    const glass = Designer.isGlass(p.b)
    const thin = Designer.isThin(p.b)
    const alpha = glass ? 0.45 : 1
    const s = thin ? 0.32 : 0
    const x0 = p.x + s; const x1 = p.x + 1 - s; const z0 = p.z + s; const z1 = p.z + 1 - s
    const y0 = p.y; const y1 = p.y + (thin && /lantern|candle|campfire/.test(p.b) ? 0.6 : 1)
    const has = (dx, dy, dz) => !thin && solidAt.has((p.x + dx) + ',' + (p.y + dy) + ',' + (p.z + dz))
    if (!has(0, 1, 0)) face([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], Designer.shade(col, 1.0), alpha)
    if (!has(1, 0, 0)) face([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], Designer.shade(col, 0.78), alpha)
    if (!has(0, 0, 1)) face([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], Designer.shade(col, 0.6), alpha)
  }
  ctx.globalAlpha = 1
}

// ---------- kreator ----------
const MAT_CHOICES = [
  ['oak', 'dąb'], ['spruce', 'świerk'], ['birch', 'brzoza'], ['dark_oak', 'ciemny dąb'], ['cherry', 'wiśnia'], ['acacia', 'akacja'],
  ['jungle', 'dżungla'], ['mangrove', 'namorzyn'], ['pale_oak', 'blady dąb'], ['cobblestone', 'bruk'], ['stone_bricks', 'kamienne cegły'],
  ['mossy_stone_bricks', 'omszałe cegły'], ['bricks', 'cegła'], ['sandstone', 'piaskowiec'], ['cut_sandstone', 'cięty piaskowiec'],
  ['quartz', 'kwarc'], ['deepslate_bricks', 'cegły łupka'], ['deepslate_tiles', 'płytki łupka'], ['blackstone', 'czernit'],
  ['nether_bricks', 'cegły Netheru'], ['red_nether_bricks', 'czerwone cegły Netheru'], ['prismarine_bricks', 'pryzmaryn'],
  ['dark_prismarine', 'ciemny pryzmaryn'], ['purpur', 'purpur'], ['end_stone_bricks', 'kamień Endu'], ['mud_bricks', 'cegły z błota'],
  ['oxidized_copper', 'zielona miedź'], ['white_concrete', 'biały beton'], ['light_gray_concrete', 'jasnoszary beton'],
  ['red_concrete', 'czerwony beton'], ['blue_concrete', 'niebieski beton'], ['yellow_concrete', 'żółty beton'], ['white_terracotta', 'biała terakota'],
  ['snow', 'śnieg'], ['glass', 'szkło'], ['gold', 'złoto']
]
const NUM_FIELDS = [['w', 'szerokość', 5, 41], ['d', 'głębokość', 5, 41], ['floors', 'piętra', 1, 12], ['h', 'wysokość', 4, 60], ['size', 'rozmiar', 3, 41], ['r', 'promień', 2, 20], ['length', 'długość', 5, 101]]
const ROOF_TYPES = [['gable', 'dwuspadowy'], ['hip', 'czterospadowy'], ['pyramid', 'piramidalny'], ['flat', 'płaski'], ['dome', 'kopuła'], ['none', 'brak']]
const TOWER_ROOFS = [['battlements', 'blanki'], ['cone', 'stożek'], ['pyramid', 'piramida'], ['spire', 'iglica'], ['dome', 'kopuła'], ['flat', 'płaski']]

const cr = { spec: null, result: null, rot: 2, seed: 1, understood: [] }

function matSelect(id, value) {
  const opts = MAT_CHOICES.some(([k]) => k === value) ? MAT_CHOICES : [[value, value.replace(/_/g, ' ')], ...MAT_CHOICES]
  return `<select data-mat="${id}">${opts.map(([k, l]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
}

function renderTweak() {
  const p = cr.spec?.parts?.[0]
  if (!p) { $('crTweak').innerHTML = ''; return }
  const rows = []
  for (const [k, label, min, max] of NUM_FIELDS) {
    if (p[k] == null) continue
    rows.push(`<label>${label} <b>${p[k]}</b><input type="range" data-num="${k}" min="${min}" max="${max}" value="${p[k]}"></label>`)
  }
  const wallKey = p.wall != null ? 'wall' : p.mat != null ? 'mat' : null
  if (wallKey) rows.push(`<label>ściany ${matSelect(wallKey, String(p[wallKey]))}</label>`)
  if (p.wall2 != null && p.wall2 !== p.wall) rows.push(`<label>piętro ${matSelect('wall2', String(p.wall2))}</label>`)
  if (p.roof?.mat) rows.push(`<label>dach ${matSelect('roof.mat', String(p.roof.mat))}</label>`)
  else if (p.roofMat) rows.push(`<label>dach ${matSelect('roofMat', String(p.roofMat))}</label>`)
  if (p.kind === 'house' && p.roof) rows.push(`<label>kształt dachu <select data-roof="1">${ROOF_TYPES.map(([k, l]) => `<option value="${k}" ${k === p.roof.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`)
  if (p.kind === 'tower' && p.roof) rows.push(`<label>dach wieży <select data-troof="1">${TOWER_ROOFS.map(([k, l]) => `<option value="${k}" ${k === p.roof.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`)
  if (p.kind === 'castle') rows.push(`<label>wieże <b>${p.towers}</b><input type="range" data-num="towers" min="0" max="8" value="${p.towers}"></label>`)
  $('crTweak').innerHTML = rows.length ? `<h4>Dopasuj</h4><div class="tweak-grid">${rows.join('')}</div>` : ''
}

$('crTweak').addEventListener('input', e => {
  const p = cr.spec?.parts?.[0]
  if (!p) return
  const t = e.target
  if (t.dataset.num) { p[t.dataset.num] = Number(t.value); t.previousElementSibling.textContent = t.value }
  if (t.dataset.mat) {
    const [a, b] = t.dataset.mat.split('.')
    if (b) p[a] = { ...(p[a] || {}), [b]: t.value }
    else { p[a] = t.value; if (a === 'wall' && p.corner && MAT_CHOICES.some(([k]) => k === p.corner)) p.corner = t.value }
  }
  if (t.dataset.roof) p.roof = { ...p.roof, type: t.value }
  if (t.dataset.troof) p.roof = { ...p.roof, type: t.value }
  regenerate(false)
})

function regenerate(resetLayer = true) {
  if (!cr.spec) return
  cr.spec.seed = cr.seed
  cr.result = Designer.generate(cr.spec)
  const r = cr.result
  const solid = r.cells.filter(c => c.block !== 'air' && !c.temp).length
  $('crSize').textContent = `${r.size.w} × ${r.size.d} × ${r.size.h} (szer. × głęb. × wys.) · ${solid} bloków`
  const L = $('crLayer')
  L.min = r.bounds.y1
  L.max = r.bounds.y2
  if (resetLayer || Number(L.value) > r.bounds.y2) L.value = r.bounds.y2
  draw()
  const hard = r.materials.filter(([b]) => !Designer.isEasy(b))
  $('crMats').innerHTML = r.materials.slice(0, 24).map(([b, n]) =>
    `<span class="mat-chip ${Designer.isEasy(b) ? '' : 'hard'}" title="${Designer.isEasy(b) ? 'bot zdobędzie sam' : 'trudne – daj botowi albo graj w kreatywnym'}"><i style="background:${Designer.blockColor(b)}"></i>${esc(b.replace(/_/g, ' '))} <b>${n}</b></span>`).join('')
  const warn = [...r.warnings]
  if (hard.length) warn.push(`W survivalu bot sam nie zdobędzie: ${hard.slice(0, 6).map(([b]) => b.replace(/_/g, ' ')).join(', ')}${hard.length > 6 ? '…' : ''} – daj mu je albo przełącz go w tryb kreatywny.`)
  $('crWarn').textContent = warn.join(' ')
  renderTweak()
}
function draw() { if (cr.result) drawIso($('crCanvas'), cr.result.cells, { rot: cr.rot, maxY: Number($('crLayer').value) }) }

function fitCanvas() {
  const c = $('crCanvas')
  const w = c.parentElement.clientWidth - 4
  if (w > 100 && Math.abs(c.width - w) > 4) { c.width = w; c.height = Math.round(w * 0.62) }
  draw()
}
window.addEventListener('resize', fitCanvas)

function createFromText() {
  const text = $('crText').value.trim()
  if (!text) { toast('Opisz budowlę', 'err'); return }
  const p = Designer.parse(text, cr.seed)
  cr.spec = p.spec
  cr.understood = p.understood
  $('crUnderstood').innerHTML = `<b>Zrozumiałem:</b> ${p.understood.map(u => `<span class="tag">${esc(u)}</span>`).join(' ')}`
  if (!$('crName').dataset.touched) $('crName').value = p.spec.name
  regenerate()
}
$('crGen').addEventListener('click', () => { cr.seed = 1; createFromText() })
$('crText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); cr.seed = 1; createFromText() } })
$('crVariant').addEventListener('click', () => { cr.seed++; if (cr.spec) regenerate(false); else createFromText() })
$('crName').addEventListener('input', () => { $('crName').dataset.touched = '1' })
$('crRotL').addEventListener('click', () => { cr.rot = (cr.rot + 3) % 4; draw() })
$('crRotR').addEventListener('click', () => { cr.rot = (cr.rot + 1) % 4; draw() })
$('crLayer').addEventListener('input', draw)
const SHORT_EXAMPLES = ['domek z kominem i ogrodem', 'średniowieczny dom z balkonem', 'nowoczesna willa z tarasem', 'zamek z okrągłymi wieżami', 'japońska pagoda', 'wieża czarodzieja z iglicą', 'latarnia morska', 'gotycki kościół', 'wiatrak', 'piramida']
$('crExamples').innerHTML = SHORT_EXAMPLES.map(x => `<button class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')
$('crExamples').addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (b) { $('crText').value = b.dataset.ex; delete $('crName').dataset.touched; cr.seed = 1; createFromText() } })

async function saveCurrent() {
  if (!cr.spec) { toast('Najpierw stwórz budowlę', 'err'); return null }
  const name = $('crName').value.trim()
  if (!name) { toast('Podaj nazwę budowli', 'err'); $('crName').focus(); return null }
  const res = await B.saveDesign({ ...cr.spec, name, description: $('crText').value.trim() || cr.spec.description || '' })
  if (!res.ok) { toast(res.error, 'err'); return null }
  toast(`Zapisano „${res.name}” – bot zbuduje to komendą: buduj ${res.name}`, 'ok')
  return res
}
$('crSave').addEventListener('click', saveCurrent)
$('crBuild').addEventListener('click', async () => {
  const res = await saveCurrent()
  if (res && await send(`buduj ${res.name}`)) toast(`${profile(selected)?.name}: buduj ${res.name}`, 'ok')
})
$('crAi').addEventListener('click', async () => {
  const text = $('crText').value.trim()
  if (!text) { toast('Opisz, co AI ma zaprojektować', 'err'); return }
  if (!await B.aiHasKey()) { toast('Asystent AI potrzebuje klucza API (zakładka Asystent AI)', 'err'); showView('ai'); showKeyBox(true); return }
  showView('ai')
  askAi(`Zaprojektuj i zapisz budowlę${$('crName').dataset.touched ? ` o nazwie "${$('crName').value.trim()}"` : ''}: ${text}`)
})

// lista zapisanych projektow
let designs = []
async function loadDesigns() {
  designs = await B.designs()
  $('crList').innerHTML = designs.length ? designs.map(d => `
    <div class="proj" data-key="${esc(d.key)}">
      <canvas width="220" height="140"></canvas>
      <div class="proj-name">${esc(d.name)}</div>
      <div class="muted small">${d.size ? `${d.size.w}×${d.size.d}×${d.size.h}` : ''} · ${d.blocks || '?'} bloków${d.spec?.source === 'ai' ? ' · 🤖 AI' : ''}</div>
      <div class="bbtns">
        <button class="btn primary small" data-act="build">Buduj</button>
        <button class="btn small" data-act="edit">Edytuj</button>
        <button class="btn ghost small danger-text" data-act="del">🗑</button>
      </div>
    </div>`).join('') : '<p class="muted">Nie masz jeszcze projektów. Opisz budowlę powyżej i kliknij „Zapisz”.</p>'
  document.querySelectorAll('#crList .proj').forEach(el => {
    const d = designs.find(x => x.key === el.dataset.key)
    if (d?.spec) drawIso(el.querySelector('canvas'), Designer.generate(d.spec).cells)
  })
  refreshCommandHints()
}
$('crList').addEventListener('click', async e => {
  const el = e.target.closest('.proj')
  const act = e.target.closest('[data-act]')?.dataset.act
  if (!el || !act) return
  const d = designs.find(x => x.key === el.dataset.key)
  if (!d) return
  if (act === 'build') { if (await send(`buduj ${d.name}`)) toast(`${profile(selected)?.name}: buduj ${d.name}`, 'ok') }
  if (act === 'edit') openInCreator(d.spec, d.name)
  if (act === 'del') { if (confirm(`Usunąć projekt „${d.name}”?`)) { await B.deleteDesign(d.key); loadDesigns() } }
})
function openInCreator(spec, name) {
  cr.spec = JSON.parse(JSON.stringify(spec))
  cr.seed = spec.seed || 1
  $('crText').value = spec.description || ''
  $('crName').value = name || spec.name || ''
  $('crName').dataset.touched = '1'
  $('crUnderstood').innerHTML = ''
  showView('creator')
  setTimeout(() => { fitCanvas(); regenerate() }, 30)
}
B.on('designs-changed', loadDesigns)

// ---------- wlasne komendy ----------
let macros = []
async function loadMacros() {
  macros = await B.commands()
  $('mcList').innerHTML = macros.length ? macros.map(m => `
    <div class="macro" data-key="${esc(m.key)}">
      <div class="macro-head"><code>${esc(m.name)}</code><span class="muted">${esc(m.description || '')}</span></div>
      <ol>${m.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="bbtns">
        <button class="btn primary small" data-act="run">▶ Uruchom</button>
        <button class="btn small" data-act="edit">Edytuj</button>
        <button class="btn ghost small danger-text" data-act="del">🗑</button>
      </div>
    </div>`).join('') : '<p class="muted">Brak własnych komend. Ułóż pierwszą powyżej albo poproś asystenta AI.</p>'
  refreshCommandHints()
}
async function saveMacroForm() {
  const res = await B.saveCommand({ name: $('mcName').value.trim(), description: $('mcDesc').value.trim(), steps: $('mcSteps').value.split('\n') })
  if (!res.ok) { toast(res.error, 'err'); return null }
  toast(`Zapisano komendę „${res.name}”`, 'ok')
  return res
}
$('mcSave').addEventListener('click', saveMacroForm)
$('mcRun').addEventListener('click', async () => { const r = await saveMacroForm(); if (r) send(r.name) })
$('mcClear').addEventListener('click', () => { $('mcName').value = ''; $('mcDesc').value = ''; $('mcSteps').value = '' })
$('mcAi').addEventListener('click', async () => {
  const what = [$('mcName').value.trim() && `nazwa: ${$('mcName').value.trim()}`, $('mcDesc').value.trim() || $('mcSteps').value.trim()].filter(Boolean).join(', ')
  if (!what) { toast('Napisz nazwę i co komenda ma robić', 'err'); return }
  if (!await B.aiHasKey()) { toast('Asystent AI potrzebuje klucza API (zakładka Asystent AI)', 'err'); showView('ai'); showKeyBox(true); return }
  showView('ai')
  askAi(`Stwórz nową komendę bota (${what}).`)
})
$('mcList').addEventListener('click', async e => {
  const el = e.target.closest('.macro')
  const act = e.target.closest('[data-act]')?.dataset.act
  if (!el || !act) return
  const m = macros.find(x => x.key === el.dataset.key)
  if (!m) return
  if (act === 'run') send(m.name)
  if (act === 'edit') { $('mcName').value = m.name; $('mcDesc').value = m.description || ''; $('mcSteps').value = m.steps.join('\n'); $('mcName').focus() }
  if (act === 'del') { if (confirm(`Usunąć komendę „${m.name}”?`)) { await B.deleteCommand(m.key); loadMacros() } }
})
B.on('commands-changed', loadMacros)

// podpowiedzi w polu komend: wlasne projekty i komendy
function refreshCommandHints() {
  for (let i = COMMANDS.length - 1; i >= 0; i--) if (COMMANDS[i].mine) COMMANDS.splice(i, 1)
  for (const d of designs) COMMANDS.push({ cat: 'Moje projekty', cmd: `buduj ${d.name}`, desc: d.description || 'projekt z kreatora', mine: true })
  for (const m of macros) COMMANDS.push({ cat: 'Moje komendy', cmd: m.name, desc: m.description || m.steps.join(' → '), mine: true })
}

// ---------- asystent AI ----------
const aiMsgs = $('aiMsgs')
let aiBusy = false
function mdLite(t) {
  return esc(t)
    .replace(/```([\s\S]*?)```/g, (m, c) => `<pre>${c.trim()}</pre>`)
    .replace(/`([^`]+)`/g, '<code class="cmd-code" title="Kliknij, żeby wstawić">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>')
}
function aiAdd(kind, html) {
  const el = document.createElement('div')
  el.className = 'ai-msg ' + kind
  el.innerHTML = html
  aiMsgs.appendChild(el)
  aiMsgs.scrollTop = aiMsgs.scrollHeight
  return el
}
function aiWelcome() {
  aiMsgs.innerHTML = ''
  aiAdd('bot', mdLite('Cześć! Jestem asystentem botów. Mogę:\n• podpowiedzieć komendy (np. „jak zdobyć diamenty?”),\n• **zaprojektować budowlę** – nawet posąg czy zwierzę – i zapisać ją dla bota,\n• **stworzyć nową komendę** z kilku kroków,\n• wysłać polecenie do działającego bota.'))
}
const AI_EXAMPLES = ['jak zdobyć diamentowy set?', 'dodaj budowlę kurczak – ma wyglądać jak mały kurczak z Minecrafta', 'stwórz komendę „owce”: znajdź owcę i ją ogródź', 'zaprojektuj statek piracki', 'co ma zrobić bot, żeby przejść Minecrafta?']
$('aiExamples').innerHTML = AI_EXAMPLES.map(x => `<button class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')
$('aiExamples').addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (b) { $('aiText').value = b.dataset.ex; $('aiText').focus() } })
aiMsgs.addEventListener('click', e => {
  const c = e.target.closest('.cmd-code')
  if (c) { $('cmdInput').value = c.textContent; showView('panel'); $('cmdInput').focus(); return }
  const b = e.target.closest('[data-ai-act]')
  if (!b) return
  if (b.dataset.aiAct === 'build') send(`buduj ${b.dataset.name}`).then(ok => ok && toast(`Bot buduje: ${b.dataset.name}`, 'ok'))
  if (b.dataset.aiAct === 'open') { const d = designs.find(x => x.key === b.dataset.key); if (d) openInCreator(d.spec, d.name) }
  if (b.dataset.aiAct === 'run') send(b.dataset.name)
})

// bez klucza: podpowiedzi z listy komend
function offlineAnswer(q) {
  const words = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').split(/\W+/).filter(w => w.length > 2)
  const score = c => { const t = (c.cmd + ' ' + c.desc + ' ' + c.cat).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l'); return words.reduce((s, w) => s + (t.includes(w.slice(0, Math.max(4, w.length - 2))) ? 1 : 0), 0) }
  const hits = COMMANDS.map(c => [c, score(c)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const list = hits.length ? hits.map(([c]) => `\`${c.cmd}\` – ${c.desc}`).join('\n') : 'Nic nie pasuje – zajrzyj do zakładki Komendy.'
  return `Bez klucza API podpowiadam tylko z listy komend:\n${list}\n\nBudowle bez AI zrobisz w zakładce **Kreator budowli**. Żeby asystent rozumiał wszystko i tworzył posągi czy komendy, dodaj klucz API (🔑).`
}

async function askAi(text) {
  if (aiBusy) return
  const q = String(text || '').trim()
  if (!q) return
  aiAdd('me', esc(q))
  $('aiText').value = ''
  if (!await B.aiHasKey()) { aiAdd('bot', mdLite(offlineAnswer(q))); return }
  aiBusy = true
  $('aiSend').disabled = true
  const wait = aiAdd('bot wait', '<span class="spinner"></span> Myślę…')
  const res = await B.aiChat(q, selected)
  wait.remove()
  aiBusy = false
  $('aiSend').disabled = false
  if (!res.ok) { aiAdd('bot err', esc(res.error)); return }
  aiAdd('bot', mdLite(res.text))
}
$('aiSend').addEventListener('click', () => askAi($('aiText').value))
$('aiText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAi($('aiText').value) } })
$('aiReset').addEventListener('click', async () => { await B.aiReset(); aiWelcome() })

// zdarzenia z narzedzi asystenta: postep i karty utworzonych rzeczy
const TOOL_PL = { create_building: '🧱 Projektuję budowlę…', create_command: '⚡ Tworzę komendę…', run_bot_command: '🤖 Wysyłam polecenie do bota…', get_state: '🔎 Sprawdzam boty i projekty…' }
B.on('ai-event', ev => {
  if (ev.type === 'tool') {
    const extra = ev.name === 'run_bot_command' ? `: <code>${esc(ev.input?.command)}</code>` : ''
    aiAdd('tool', (TOOL_PL[ev.name] || ev.name) + extra)
  }
  if (ev.type === 'design') {
    const el = aiAdd('card', `<canvas width="360" height="220"></canvas><div><b>${esc(ev.name)}</b> – zapisana w Kreatorze.
      <div class="bbtns"><button class="btn primary small" data-ai-act="build" data-name="${esc(ev.name)}">🏗 Zbuduj</button>
      <button class="btn small" data-ai-act="open" data-key="${esc(ev.key)}">Pokaż w kreatorze</button></div></div>`)
    drawIso(el.querySelector('canvas'), Designer.generate(ev.spec).cells)
  }
  if (ev.type === 'command') {
    aiAdd('card', `<div><b>Nowa komenda:</b> <code>${esc(ev.name)}</code><ol>${(ev.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="bbtns"><button class="btn primary small" data-ai-act="run" data-name="${esc(ev.name)}">▶ Uruchom</button></div></div>`)
  }
})

// klucz API
function showKeyBox(show) { $('aiKeyBox').classList.toggle('hidden', !show) }
$('aiKeyBtn').addEventListener('click', () => showKeyBox($('aiKeyBox').classList.contains('hidden')))
$('aiKeySave').addEventListener('click', async () => {
  const r = await B.aiSetKey($('aiKey').value)
  if (!r.ok) { toast(r.error, 'err'); return }
  $('aiKey').value = ''
  showKeyBox(false)
  updateKeyState()
  toast('Klucz zapisany', 'ok')
})
$('aiKeyDel').addEventListener('click', async () => { await B.aiSetKey(''); updateKeyState(); toast('Klucz usunięty') })
async function updateKeyState() {
  const has = await B.aiHasKey()
  $('aiModel').textContent = has ? 'Claude Opus 5.5 · połączony' : 'bez klucza – tylko podpowiedzi z listy'
  $('aiKeyBtn').textContent = has ? '🔑 Klucz API ✓' : '🔑 Dodaj klucz API'
  if (!has) showKeyBox(true)
}

// ---------- start ----------
;(async () => {
  Designer.setBlocks(await B.blocks())
  aiWelcome()
  updateKeyState()
  await loadDesigns()
  await loadMacros()
  drawIso($('crCanvas'), [])
})()
document.querySelectorAll('.nav[data-view="creator"]').forEach(b => b.addEventListener('click', () => setTimeout(fitCanvas, 30)))
