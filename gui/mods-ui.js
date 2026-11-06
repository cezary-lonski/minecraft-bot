// Zakladka "Mody": karty modow z przelacznikiem. Korzysta z app.js ($, B, esc, toast) i gui/mods.js (ModsLib).
/* global ModsLib, $, B, esc, toast */
let modsOn = new Set()

function modCard(m) {
  const on = modsOn.has(m.id)
  const items = (m.items || []).map(i => `<li><code>daj ${esc(i.key)}</code>${i.name ? ` – ${esc(i.name)}` : ''}${i.parts ? ` (${i.parts.length} części)` : ''}</li>`).join('')
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
  $('modsItems').innerHTML = ModsLib.MODS.filter(m => m.kind === 'items').map(modCard).join('')
  $('modsBehavior').innerHTML = ModsLib.MODS.filter(m => m.kind === 'behavior').map(modCard).join('')
}

async function loadMods() {
  modsOn = new Set(await B.mods())
  renderMods()
}

for (const id of ['modsItems', 'modsBehavior']) {
  $(id).addEventListener('change', async e => {
    const card = e.target.closest('.mod-card')
    if (!card) return
    const m = ModsLib.MODS.find(x => x.id === card.dataset.id)
    if (e.target.checked) modsOn.add(m.id); else modsOn.delete(m.id)
    await B.setMods([...modsOn])
    renderMods()
    toast(`${m.name}: ${e.target.checked ? 'włączony' : 'wyłączony'}`, 'ok')
  })
}

loadMods()
