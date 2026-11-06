// Zakladka "Mody": karty modow z przelacznikiem. Korzysta z app.js ($, B, esc, toast) i gui/mods.js (ModsLib).
/* global ModsLib, $, B, esc, toast */
let modsOn = new Set()

function modCard(m) {
  const on = modsOn.has(m.id)
  const items = (m.items || []).map(i => `<li><code>daj ${esc(i.key)}</code>${i.name ? ` – ${esc(i.name)}` : ''}${i.parts ? ` (${i.parts.length} części)` : ''}</li>`).join('') +
    (m.builds || []).map(b => `<li><code>${esc(b.cmd)}</code> – ${esc(b.name)}</li>`).join('')
  return `
    <div class="mod-card ${on ? 'on' : ''}" data-id="${esc(m.id)}">
      <div class="mod-head">
        <span class="mod-icon">${m.icon}</span>
        <b>${esc(m.name)}</b>
        <label class="switch" title="${on ? 'Wyłącz' : 'Włącz'}"><input type="checkbox" ${on ? 'checked' : ''}><span></span></label>
      </div>
      <p class="muted small">${esc(m.desc)}</p>
      ${items ? `<ul class="mod-items">${items}</ul>` : ''}
    </div>`
}

function renderMods() {
  $('modsBuildings').innerHTML = ModsLib.MODS.filter(m => m.kind === 'buildings').map(modCard).join('')
  $('modsItems').innerHTML = ModsLib.MODS.filter(m => m.kind === 'items').map(modCard).join('')
  $('modsBehavior').innerHTML = ModsLib.MODS.filter(m => m.kind === 'behavior').map(modCard).join('')
}

async function loadMods() {
  modsOn = new Set(await B.mods())
  renderMods()
}

for (const id of ['modsBuildings', 'modsItems', 'modsBehavior']) {
  $(id).addEventListener('change', async e => {
    const card = e.target.closest('.mod-card')
    if (!card) return
    const m = ModsLib.MODS.find(x => x.id === card.dataset.id)
    if (e.target.checked) modsOn.add(m.id); else modsOn.delete(m.id)
    // mody z budowlami tworza projekty (chwile to trwa - np. skin z internetu)
    if (m.kind === 'buildings' && e.target.checked) toast(`${m.name}: tworzę budowle…`)
    const r = await B.setMods([...modsOn])
    renderMods()
    if (r?.errors?.length) toast(r.errors.join(' '), 'err')
    toast(`${m.name}: ${e.target.checked ? 'włączony' : 'wyłączony'}${r?.made ? ` – ${r.made} budowli w Kreatorze` : ''}`, 'ok')
  })
}

// postacie Hogwartu jako boty
/* global selected */
$('npcCreate').addEventListener('click', async () => {
  const r = await B.createNpc(selected)
  if (!r.ok) { toast(r.error, 'err'); return }
  if (r.added.length) toast(`Dodano: ${r.added.join(', ')} – uruchom je w zakładce Graj`, 'ok')
  else toast(`Już są: ${r.skipped.join(', ')}`, 'ok')
})

loadMods()
