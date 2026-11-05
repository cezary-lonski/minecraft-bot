// Zakladka Znajomi: launchery w sieci lokalnej, zaproszenia i czat.
// Korzysta z app.js: $, B, esc, toast.
/* global $, B, esc, toast */

let fr = { enabled: false, friends: [], others: [], requests: [] }
let frOpen = null // id znajomego, z ktorym rozmawiamy

function frRender() {
  $('frSetup').classList.toggle('hidden', fr.enabled)
  $('frMain').classList.toggle('hidden', !fr.enabled)
  if (!fr.enabled && fr.nick && !$('frNick').value) $('frNick').value = fr.nick
  $('frMeNick').textContent = fr.nick
  $('frRequests').innerHTML = fr.requests.map(r => `
    <div class="fr-req"><span>📨 <b>${esc(r.nick)}</b> chce być Twoim znajomym</span>
      <span><button class="btn primary small" data-acc="${esc(r.id)}">Akceptuj</button>
      <button class="btn ghost small" data-rej="${esc(r.id)}">Odrzuć</button></span></div>`).join('')
  const friends = [...fr.friends].sort((a, b) => b.online - a.online || a.nick.localeCompare(b.nick))
  $('frFriends').innerHTML = friends.length
    ? friends.map(f => `<button class="fr-item ${f.id === frOpen ? 'sel' : ''}" data-open="${esc(f.id)}">
        <span class="dot ${f.online ? 'on' : 'off'}"></span>${esc(f.nick)}${f.unread ? ` <span class="badge">${f.unread}</span>` : ''}</button>`).join('')
    : '<p class="muted small">Brak znajomych. Zaproś kogoś z listy poniżej.</p>'
  $('frOthers').innerHTML = fr.others.length
    ? fr.others.map(o => `<div class="fr-item"><span class="dot on"></span>${esc(o.nick)}
        ${o.invited ? '<span class="muted small">zaproszony</span>' : `<button class="btn small" data-inv="${esc(o.id)}">＋ Dodaj</button>`}</div>`).join('')
    : '<p class="muted small">Nikogo więcej w sieci. Inni muszą mieć włączony launcher i „Znajomi” w tej samej sieci.</p>'
  const unread = fr.friends.reduce((s, f) => s + f.unread, 0) + fr.requests.length
  $('friendsDot').classList.toggle('hidden', !unread)
  const f = fr.friends.find(x => x.id === frOpen)
  $('frChatTitle').innerHTML = f ? `<span class="dot ${f.online ? 'on' : 'off'}"></span> ${esc(f.nick)}${f.online ? '' : ' <span class="muted small">(offline)</span>'}` : 'Wybierz znajomego'
  $('frRemove').classList.toggle('hidden', !f)
  $('frText').disabled = !f
  $('frSend').disabled = !f
}

async function frLoadChat() {
  const list = frOpen ? await B.friendHistory(frOpen) : []
  const box = $('frMsgs')
  box.innerHTML = list.length ? '' : '<p class="muted">Jeszcze nic nie napisaliście.</p>'
  for (const m of list) {
    const el = document.createElement('div')
    el.className = 'ai-msg ' + (m.me ? 'me' : 'bot')
    el.innerHTML = esc(m.text) + `<div class="muted small fr-time">${new Date(m.at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</div>`
    box.appendChild(el)
  }
  box.scrollTop = box.scrollHeight
}

async function frRefresh() { fr = await B.friends(); frRender() }

$('frOn').addEventListener('click', async () => {
  const n = await B.friendsNick($('frNick').value)
  if (!n.ok) { toast(n.error, 'err'); return }
  const r = await B.friendsStart()
  if (!r.ok) toast(r.error, 'err')
  frRefresh()
})
$('frNick').addEventListener('keydown', e => { if (e.key === 'Enter') $('frOn').click() })
$('frOff').addEventListener('click', async () => { await B.friendsStop(); frRefresh() })
$('view-friends').addEventListener('click', async e => {
  const t = e.target.closest('[data-inv],[data-acc],[data-rej],[data-open]')
  if (!t) return
  if (t.dataset.inv) { const r = await B.friendInvite(t.dataset.inv); toast(r.ok ? 'Zaproszenie wysłane' : r.error, r.ok ? 'ok' : 'err') }
  if (t.dataset.acc) { const r = await B.friendAccept(t.dataset.acc); if (!r.ok) toast(r.error, 'err') }
  if (t.dataset.rej) await B.friendReject(t.dataset.rej)
  if (t.dataset.open) { frOpen = t.dataset.open; await frLoadChat(); $('frText').focus() }
  frRefresh()
})
$('frRemove').addEventListener('click', async () => {
  const f = fr.friends.find(x => x.id === frOpen)
  if (!f || !confirm(`Usunąć ${f.nick} ze znajomych?`)) return
  await B.friendRemove(frOpen)
  frOpen = null
  frLoadChat()
  frRefresh()
})
async function frSend() {
  const text = $('frText').value.trim()
  if (!text || !frOpen) return
  const r = await B.friendChat(frOpen, text)
  if (!r.ok) { toast(r.error, 'err'); return }
  $('frText').value = ''
  frLoadChat()
}
$('frSend').addEventListener('click', frSend)
$('frText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); frSend() } })

B.on('friends', ev => {
  if (ev.type === 'state') { fr = ev.state; frRender(); return }
  const viewing = document.getElementById('view-friends').classList.contains('active')
  if (ev.type === 'chat') {
    if (viewing && ev.id === frOpen) frLoadChat()
    else toast(`💬 ${ev.nick}: ${ev.text.slice(0, 60)}`, 'ok')
  }
  if (ev.type === 'invite') toast(`📨 ${ev.nick} chce być Twoim znajomym – zakładka Znajomi`, 'ok')
  if (ev.type === 'accepted') toast(`🤝 ${ev.nick} przyjął zaproszenie`, 'ok')
})
document.querySelectorAll('.nav[data-view="friends"]').forEach(b => b.addEventListener('click', () => { frRefresh(); if (frOpen) frLoadChat() }))
frRefresh()
