// Znajomi i czat miedzy launcherami w tej samej sieci (np. na kolku, w domu na jednym Wi-Fi) - bez serwera w internecie.
// Wykrywanie: co kilka sekund rozglaszamy po UDP "jestem" (nick, id). Wiadomosci, zaproszenia: krotkie polaczenie TCP.
// Widoczny w sieci jest tylko ten, kto sam to wlaczy. Pisac mozna tylko ze znajomymi (zaproszenie trzeba zaakceptowac).
const dgram = require('dgram')
const net = require('net')
const os = require('os')
const crypto = require('crypto')

const DISCOVERY_PORT = 47777
const HELLO_EVERY = 4000
const PEER_TIMEOUT = 15000
const MAX_HISTORY = 300

// adresy rozgloszeniowe wszystkich sieci komputera (np. 192.168.1.255) + ogolny 255.255.255.255
function broadcastAddresses() {
  const out = new Set(['255.255.255.255'])
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue
      const ip = a.address.split('.').map(Number)
      const mask = a.netmask.split('.').map(Number)
      out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join('.'))
    }
  }
  return [...out]
}

// store: { get(), set(patch) } - trwale ustawienia (nick, id, znajomi, zaproszenia, historia czatu)
// emit(event) - zdarzenia do okna
function createFriends({ store, emit, version }) {
  let udp = null
  let server = null
  let tcpPort = 0
  let helloTimer = null
  const peers = new Map() // id -> { id, nick, address, port, seen }

  const me = () => {
    const s = store.get()
    if (!s.id) store.set({ id: crypto.randomUUID() })
    return store.get()
  }
  const isFriend = id => (store.get().friends || []).some(f => f.id === id)
  const online = id => { const p = peers.get(id); return !!p && Date.now() - p.seen < PEER_TIMEOUT }

  function state() {
    const s = me()
    const now = Date.now()
    const friends = (s.friends || []).map(f => ({ ...f, online: online(f.id), nick: peers.get(f.id)?.nick || f.nick, unread: (s.unread || {})[f.id] || 0 }))
    const others = [...peers.values()].filter(p => now - p.seen < PEER_TIMEOUT && !isFriend(p.id)).map(p => ({ id: p.id, nick: p.nick, invited: (s.sent || []).includes(p.id) }))
    return { enabled: !!s.enabled, nick: s.nick || '', id: s.id, friends, others, requests: s.requests || [] }
  }
  const changed = () => emit({ type: 'state', state: state() })

  // ---------- wysylanie (TCP, jedna wiadomosc na polaczenie) ----------
  function sendTo(id, msg) {
    const p = peers.get(id)
    if (!p || !online(id)) return Promise.resolve({ ok: false, error: 'Ten znajomy jest teraz offline.' })
    return new Promise(resolve => {
      const sock = net.connect({ host: p.address, port: p.port, timeout: 5000 })
      const done = r => { try { sock.destroy() } catch {} resolve(r) }
      sock.on('connect', () => sock.end(JSON.stringify({ ...msg, from: me().id, nick: me().nick }) + '\n', () => done({ ok: true })))
      sock.on('timeout', () => done({ ok: false, error: 'Nie udało się połączyć (zapora sieciowa?).' }))
      sock.on('error', e => done({ ok: false, error: 'Nie udało się wysłać: ' + e.code }))
    })
  }

  // ---------- odbieranie ----------
  function onMessage(m, address) {
    if (!m || typeof m.from !== 'string' || m.from === me().id) return
    const nick = String(m.nick || '?').slice(0, 24)
    const s = store.get()
    if (m.t === 'invite') {
      if (isFriend(m.from)) return sendTo(m.from, { t: 'accept' })
      if ((s.sent || []).includes(m.from)) return acceptInvite(m.from, nick) // obaj zaprosili sie nawzajem
      const requests = (s.requests || []).filter(r => r.id !== m.from)
      store.set({ requests: [...requests, { id: m.from, nick, at: Date.now() }] })
      emit({ type: 'invite', id: m.from, nick })
      return changed()
    }
    if (m.t === 'accept') {
      if (!(s.sent || []).includes(m.from) && !isFriend(m.from)) return
      addFriend(m.from, nick)
      emit({ type: 'accepted', id: m.from, nick })
      return changed()
    }
    if (m.t === 'remove') {
      store.set({ friends: (s.friends || []).filter(f => f.id !== m.from) })
      return changed()
    }
    if (m.t === 'chat') {
      if (!isFriend(m.from)) return // od obcych wiadomosci nie przyjmujemy
      const text = String(m.text || '').slice(0, 500)
      if (!text.trim()) return
      pushHistory(m.from, { me: false, text, at: Date.now() })
      const unread = { ...(store.get().unread || {}) }
      unread[m.from] = (unread[m.from] || 0) + 1
      store.set({ unread })
      emit({ type: 'chat', id: m.from, nick, text })
      changed()
    }
    void address
  }
  function pushHistory(id, entry) {
    const history = { ...(store.get().history || {}) }
    history[id] = [...(history[id] || []), entry].slice(-MAX_HISTORY)
    store.set({ history })
  }
  function addFriend(id, nick) {
    const s = store.get()
    const friends = (s.friends || []).filter(f => f.id !== id)
    store.set({
      friends: [...friends, { id, nick, since: Date.now() }],
      sent: (s.sent || []).filter(x => x !== id),
      requests: (s.requests || []).filter(r => r.id !== id)
    })
  }

  // ---------- akcje z okna ----------
  async function invite(id) {
    const s = store.get()
    store.set({ sent: [...new Set([...(s.sent || []), id])] })
    const r = await sendTo(id, { t: 'invite' })
    changed()
    return r
  }
  async function acceptInvite(id, nick) {
    const req = (store.get().requests || []).find(r => r.id === id)
    addFriend(id, nick || req?.nick || peers.get(id)?.nick || '?')
    changed()
    return sendTo(id, { t: 'accept' })
  }
  function rejectInvite(id) {
    store.set({ requests: (store.get().requests || []).filter(r => r.id !== id) })
    changed()
    return { ok: true }
  }
  async function removeFriend(id) {
    store.set({ friends: (store.get().friends || []).filter(f => f.id !== id) })
    changed()
    if (online(id)) await sendTo(id, { t: 'remove' })
    return { ok: true }
  }
  async function chat(id, text) {
    const t = String(text || '').trim().slice(0, 500)
    if (!t) return { ok: false, error: 'Pusta wiadomość.' }
    if (!isFriend(id)) return { ok: false, error: 'Pisać można tylko do znajomych.' }
    const r = await sendTo(id, { t: 'chat', text: t })
    if (r.ok) { pushHistory(id, { me: true, text: t, at: Date.now() }); changed() }
    return r
  }
  function history(id) {
    const unread = { ...(store.get().unread || {}) }
    if (unread[id]) { delete unread[id]; store.set({ unread }); changed() }
    return (store.get().history || {})[id] || []
  }

  // ---------- wlaczanie / wylaczanie widocznosci ----------
  function hello() {
    if (!udp) return
    const msg = Buffer.from(JSON.stringify({ app: 'minecraft-bot', t: 'hello', id: me().id, nick: me().nick, port: tcpPort, v: version }))
    for (const addr of broadcastAddresses()) udp.send(msg, DISCOVERY_PORT, addr, () => {})
  }
  async function start() {
    if (udp) return { ok: true }
    if (!me().nick) return { ok: false, error: 'Najpierw wpisz swój nick.' }
    server = net.createServer(sock => {
      let buf = ''
      sock.setTimeout(5000, () => sock.destroy())
      sock.on('data', d => {
        buf += d
        if (buf.length > 4096) return sock.destroy()
        const i = buf.indexOf('\n')
        if (i >= 0) { try { onMessage(JSON.parse(buf.slice(0, i)), sock.remoteAddress) } catch {} sock.destroy() }
      })
      sock.on('error', () => {})
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve) })
    tcpPort = server.address().port
    udp = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    udp.on('message', (data, rinfo) => {
      try {
        const m = JSON.parse(data.toString('utf8'))
        if (m.app !== 'minecraft-bot' || m.t !== 'hello' || !m.id || m.id === me().id) return
        const known = peers.get(m.id)
        peers.set(m.id, { id: m.id, nick: String(m.nick || '?').slice(0, 24), address: rinfo.address, port: Number(m.port), seen: Date.now() })
        if (!known || known.nick !== m.nick) changed()
        if (!known) hello() // nowy launcher w sieci - od razu sie przedstawiamy, zeby nie czekal na nastepna ture
      } catch {}
    })
    udp.on('error', e => console.log('[znajomi] udp:', e.message))
    await new Promise(resolve => udp.bind(DISCOVERY_PORT, () => { try { udp.setBroadcast(true) } catch {} resolve() }))
    hello()
    helloTimer = setInterval(() => { hello(); changed() }, HELLO_EVERY)
    store.set({ enabled: true })
    changed()
    return { ok: true }
  }
  function stop(keepSetting) {
    clearInterval(helloTimer)
    try { udp?.close() } catch {}
    try { server?.close() } catch {}
    udp = null
    server = null
    peers.clear()
    if (!keepSetting) store.set({ enabled: false })
    changed()
    return { ok: true }
  }
  function setNick(nick) {
    const n = String(nick || '').trim().slice(0, 24)
    if (n.length < 2) return { ok: false, error: 'Nick: co najmniej 2 znaki.' }
    store.set({ nick: n })
    hello()
    changed()
    return { ok: true }
  }

  return { state, start, stop, setNick, invite, acceptInvite, rejectInvite, removeFriend, chat, history, autoStart: () => (store.get().enabled ? start().catch(e => console.log('[znajomi]', e.message)) : null) }
}

module.exports = { createFriends, DISCOVERY_PORT }
