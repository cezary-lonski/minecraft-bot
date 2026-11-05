// Centrum sterowania botow (Electron).
// Kazdy bot to profil (nick, swiat, ustawienia) z wlasnym folderem danych - pamieta punkty, budowle, ostatnie zadanie.
// Uruchomiony bot dziala jako osobny proces Node (bot.js); okno wysyla mu komendy na wejscie i czyta jego wyjscie.
// Kilka botow moze dzialac naraz - ich wiadomosci zespolowe (@@TEAM) sa przekazywane miedzy nimi.
const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, spawnSync } = require('child_process')
const Designer = require('./designer')
const { createAssistant } = require('./ai')

let autoUpdater = null
try { autoUpdater = require('electron-updater').autoUpdater } catch { /* brak w trybie deweloperskim */ }

// Dane programu leza obok programu, na tym samym dysku: D:\Minecraft Bot\Program -> D:\Minecraft Bot\Dane
// (nie w folderze programu - ten jest czyszczony przy aktualizacji). Program na dysku C zostawia dane w %APPDATA%.
// Za pierwszym razem kopiujemy tam stare dane z %APPDATA% (boty, projekty, komendy, klucze).
function moveDataNextToProgram() {
  if (!app.isPackaged || process.argv.some(a => a.startsWith('--user-data-dir'))) return
  const exeDir = path.dirname(process.execPath)
  if (/^c:/i.test(exeDir)) return
  const dataDir = path.basename(exeDir).toLowerCase() === 'program' ? path.join(path.dirname(exeDir), 'Dane') : exeDir + ' - Dane'
  const oldDir = app.getPath('userData')
  // kopiujemy tez "Local State" - starsze wersje szyfrowaly nim klucze API (safeStorage)
  const ours = d => ['bots.json', 'app-settings.json', 'bots', 'projekty', 'komendy'].some(m => fs.existsSync(path.join(d, m)))
  try {
    if (!ours(dataDir) && ours(oldDir)) {
      const skip = /^[\\/](Cache|Code Cache|GPUCache|GPUPersistentCache|GrShaderCache|ShaderCache|old_ShaderCache\w*|DawnCache|DawnGraphiteCache|DawnWebGPUCache|blob_storage|Crashpad|Network|Session Storage|Local Storage|Shared Dictionary|shared_proto_db|VideoDecodeStats|WebStorage|DIPS|declarative_performance_observer\.db.*)([\\/]|$)/i
      fs.cpSync(oldDir, dataDir, { recursive: true, filter: src => !skip.test(src.slice(oldDir.length)) })
    }
    fs.mkdirSync(dataDir, { recursive: true })
    app.setPath('userData', dataDir)
  } catch (e) { console.log('dane obok programu:', e.message) }
}
moveDataNextToProgram()
const DATA = app.getPath('userData') // D:\Minecraft Bot\Dane albo %APPDATA%\Minecraft Bot
const PROFILES_FILE = path.join(DATA, 'bots.json')
const APP_SETTINGS_FILE = path.join(DATA, 'app-settings.json')
const BOT_DEFAULTS = {
  name: 'Claude', mode: 'lan', port: '', host: '', player: '', owner: '', password: '', version: '',
  loot: 'auto', rtp: true, chatDelay: '', eatBelow: 8, autoHelp: true, aiChat: false
}
const APP_DEFAULTS = { autoUpdate: true }

let win = null
const procs = new Map() // id profilu -> { proc, buf, username }

// ---------- pliki ----------
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)) }
const loadProfiles = () => readJson(PROFILES_FILE, []).map(p => ({ ...BOT_DEFAULTS, ...p }))
const saveProfiles = list => writeJson(PROFILES_FILE, list)
const appSettings = () => ({ ...APP_DEFAULTS, ...readJson(APP_SETTINGS_FILE, {}) })
const botDir = id => path.join(DATA, 'bots', id)
// budowle z kreatora i wlasne komendy sa wspolne dla wszystkich botow
const DESIGNS_DIR = path.join(DATA, 'projekty')
const COMMANDS_DIR = path.join(DATA, 'komendy')
const keyOf = name => Designer.strip(name).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const fileOf = (dir, key) => path.join(dir, key.replace(/ /g, '_') + '.json')

// nazwy blokow z gry (do sprawdzania budowli) - z minecraft-data dla najnowszej wersji
let BLOCKS = []
try {
  const md = require('minecraft-data')
  const ver = ['1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.6', '1.21.5', '1.21.4'].find(v => { try { return md(v) } catch { return false } })
  BLOCKS = md(ver).blocksArray.map(b => b.name)
  Designer.setBlocks(BLOCKS)
} catch (e) { console.log('minecraft-data:', e.message) }

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1340, height: 870, minWidth: 1000, minHeight: 660,
    backgroundColor: '#12131a',
    title: 'Minecraft Bot - centrum sterowania',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  win.removeMenu()
  win.loadFile(path.join(__dirname, 'index.html'))
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
}

// ---------- procesy botow ----------
function botEnv(p) {
  const env = {
    ...process.env, ELECTRON_RUN_AS_NODE: '1', MC_GUI: '1', MC_DATA_DIR: botDir(p.id), MC_USER: p.name || 'Claude', MC_MODE: p.mode,
    MC_DESIGNS_DIR: DESIGNS_DIR, MC_COMMANDS_DIR: COMMANDS_DIR
  }
  delete env.MC_PORT
  if (p.mode === 'lan') {
    Object.assign(env, { MC_HOST: 'localhost', MC_PORT: String(p.port), MC_RTP: '0', MC_AUTOLOGIN: '0', MC_CHAT_DELAY: p.chatDelay || '600' })
  } else {
    const [host, port] = String(p.host).split(':')
    env.MC_HOST = host
    if (port) env.MC_PORT = port
    env.MC_OWNER = p.owner || ''
    env.MC_PASS = p.password || ''
    if (p.chatDelay) env.MC_CHAT_DELAY = String(p.chatDelay)
    if (!p.rtp) env.MC_RTP = '0'
  }
  env.MC_PLAYER = p.player || p.owner || '' // do kogo odnosza sie "tu", "daj", "chodz za mna" z okna programu
  env.MC_AUTO_HELP = p.autoHelp === false ? '0' : '1'
  env.MC_AI = p.aiChat ? '1' : '0' // AI w grze (pytania ida przez program, klucz zostaje w programie)
  if (p.version) env.MC_VERSION = p.version
  if (p.loot === 'on') env.MC_LOOT = '1'
  if (p.loot === 'off') env.MC_LOOT = '0'
  if (p.eatBelow) env.MC_EAT_BELOW = String(p.eatBelow)
  return env
}

function startBot(id) {
  if (procs.has(id)) return { ok: true }
  const p = loadProfiles().find(x => x.id === id)
  if (!p) return { ok: false, error: 'Nie ma takiego bota.' }
  if (p.mode === 'lan' && !/^\d+$/.test(String(p.port))) return { ok: false, error: `${p.name}: podaj port LAN (pokazuje sie w grze po "Open to LAN").` }
  if (p.mode !== 'lan' && !p.host) return { ok: false, error: `${p.name}: podaj adres serwera.` }
  fs.mkdirSync(botDir(id), { recursive: true })
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'bot.js')], { env: botEnv(p), cwd: botDir(id), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const entry = { proc, buf: '', username: p.name }
  procs.set(id, entry)
  // zapamietujemy, kiedy bot ostatnio gral
  saveProfiles(loadProfiles().map(x => x.id === id ? { ...x, lastPlayed: Date.now() } : x))
  send('bot-state', { id, running: true })
  send('log', { id, kind: 'gui', text: `Uruchamiam ${p.name} (${p.mode === 'lan' ? 'LAN, port ' + p.port : 'serwer ' + p.host})...` })
  proc.stdout.on('data', chunk => {
    entry.buf += chunk.toString('utf8')
    const lines = entry.buf.split(/\r?\n/)
    entry.buf = lines.pop()
    for (const line of lines) handleBotLine(id, line)
  })
  proc.stderr.on('data', chunk => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) send('log', { id, kind: 'error', text: line })
  })
  proc.on('exit', code => {
    procs.delete(id)
    send('bot-state', { id, running: false, code })
    send('log', { id, kind: 'gui', text: `${p.name} zakonczyl dzialanie${code ? ' (kod ' + code + ')' : ''}.` })
  })
  return { ok: true }
}

function handleBotLine(id, line) {
  if (line.startsWith('@@STATUS ')) {
    try {
      const st = JSON.parse(line.slice(9))
      lastStatus.set(id, { connected: st.connected, health: st.health, food: st.food, pos: st.pos, task: st.task, gameMode: st.gameMode })
      send('status', { id, ...st })
    } catch {}
    return
  }
  if (line.startsWith('@@AICMDRES ')) {
    try { const r = JSON.parse(line.slice(11)); aiCmdWaiters.get(r.id)?.(r) } catch {}
    return
  }
  if (line.startsWith('@@AI ')) {
    try { handleAiRequest(id, JSON.parse(line.slice(5))) } catch {}
    return
  }
  if (line.startsWith('@@TEAM ')) {
    // wiadomosc zespolu: do wszystkich pozostalych botow; prosby i odpowiedzi pokazujemy tez w logu
    for (const [otherId, other] of procs) if (otherId !== id) other.proc.stdin.write(line + '\n')
    try {
      const m = JSON.parse(line.slice(7))
      if (m.type !== 'state') send('team', { id, ...m })
    } catch {}
    return
  }
  if (!line.trim()) return
  const kind = line.startsWith('[serwer]') ? 'server' : line.startsWith('[bot]') ? 'bot' : /blad|error|wyrzucony/i.test(line) ? 'error' : 'info'
  send('log', { id, kind, text: line })
}

function stopBot(id) {
  const e = procs.get(id)
  if (e) try { e.proc.kill() } catch {}
}
const stopAll = () => { for (const id of procs.keys()) stopBot(id) }

function sendCommand(id, text) {
  const e = procs.get(id)
  if (!e) return { ok: false, error: 'Ten bot nie dziala - uruchom go.' }
  e.proc.stdin.write(String(text).trim() + '\n')
  send('log', { id, kind: 'me', text: '> ' + text })
  return { ok: true }
}

// komenda od AI: bot odsyla (@@AICMDRES), czy ja zrozumial - AI dostaje to jako wynik narzedzia i moze sie poprawic
const aiCmdWaiters = new Map()
let aiCmdSeq = 0
function sendAiCommand(id, text) {
  const e = procs.get(id)
  if (!e) return { ok: false, error: 'Ten bot nie działa.' }
  const reqId = ++aiCmdSeq
  send('log', { id, kind: 'me', text: '🤖> ' + text })
  return new Promise(resolve => {
    const done = r => { clearTimeout(timer); aiCmdWaiters.delete(reqId); resolve(r) }
    const timer = setTimeout(() => done({ ok: true, info: 'Komenda wysłana.' }), 3000)
    aiCmdWaiters.set(reqId, r => done(r.ok
      ? { ok: true, info: 'Bot przyjął komendę i ją wykonuje (długie zadania trwają minuty).' }
      : r.busy
        ? { ok: false, error: `Bot jest zajęty: ${r.busy}. Poczekaj albo najpierw wyślij "stop".` }
        : { ok: false, error: `Bot nie zna komendy "${text}". Użyj dokładnie komendy z listy (np. "zdobadz drewno 16", "buduj <nazwa>", "tu").` }))
    e.proc.stdin.write('@@AICMD ' + JSON.stringify({ id: reqId, text }) + '\n')
  })
}

// ---------- profile ----------
function newId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

ipcMain.handle('profiles:list', () => loadProfiles().map(p => ({ ...p, running: procs.has(p.id) })))
ipcMain.handle('profiles:save', (e, p) => {
  const list = loadProfiles()
  if (!p.name || !/^\w{3,16}$/.test(p.name)) return { ok: false, error: 'Nick bota: 3-16 znakow (litery, cyfry, _).' }
  if (list.some(x => x.name.toLowerCase() === p.name.toLowerCase() && x.id !== p.id)) return { ok: false, error: 'Bot o takim nicku juz istnieje.' }
  if (p.id) {
    saveProfiles(list.map(x => x.id === p.id ? { ...x, ...p } : x))
    return { ok: true, id: p.id }
  }
  const id = newId()
  saveProfiles([...list, { ...BOT_DEFAULTS, ...p, id, created: Date.now() }])
  return { ok: true, id }
})
ipcMain.handle('profiles:delete', async (e, id) => {
  // dzialajacy bot ma swoj folder jako katalog roboczy - na Windows folderu nie da sie usunac, zanim proces sie nie zakonczy
  const entry = procs.get(id)
  if (entry) {
    const exited = new Promise(resolve => entry.proc.once('exit', resolve))
    stopBot(id)
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))])
  }
  saveProfiles(loadProfiles().filter(x => x.id !== id))
  try { fs.rmSync(botDir(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
  return { ok: true }
})
// dane bota z poprzednich gier (punkty, budowle, ostatnie zadanie) - do pokazania na karcie
ipcMain.handle('profiles:memory', (e, id) => {
  const dir = botDir(id)
  return {
    waypoints: readJson(path.join(dir, 'waypoints.json'), {}),
    builds: readJson(path.join(dir, 'builds.json'), []),
    lastTask: readJson(path.join(dir, 'last_task.json'), null)
  }
})

ipcMain.handle('bot:start', (e, id) => startBot(id))
ipcMain.handle('bot:stop', (e, id) => { stopBot(id); return { ok: true } })
ipcMain.handle('bot:command', (e, id, text) => sendCommand(id, text))
ipcMain.handle('bot:running', () => [...procs.keys()])
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:settings', () => appSettings())
ipcMain.handle('app:saveSettings', (e, s) => { writeJson(APP_SETTINGS_FILE, { ...appSettings(), ...s }); return { ok: true } })
ipcMain.handle('app:dataDir', (e, id) => { const dir = id ? botDir(id) : DATA; fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); return dir })

// ---------- kreator budowli ----------
// zapis: plan liczy ten sam generator co podglad w oknie
function saveDesign(spec) {
  const name = String(spec.name || '').trim().slice(0, 40)
  const key = keyOf(name)
  if (!key) return { ok: false, error: 'Podaj nazwę budowli.' }
  if (/^(dom|dom villagera|zamek|zamczysko|palac|palac endu|baza podziemna|skybase|napis|farma)( |$)/.test(key)) return { ok: false, error: `Nazwa "${name}" jest zajęta przez wbudowaną budowlę - wybierz inną.` }
  const r = Designer.generate(spec)
  const blocks = r.cells.filter(c => c.block !== 'air').length
  if (!blocks) return { ok: false, error: 'Budowla nie ma żadnych bloków.' }
  if (blocks > 40000) return { ok: false, error: `Za duża budowla (${blocks} bloków, max 40000).` }
  const rec = { key, name, description: spec.description || '', spec: { ...spec, name }, plan: r.cells, rooms: r.rooms, ahead: r.ahead, size: r.size, blocks, created: Date.now() }
  writeJson(fileOf(DESIGNS_DIR, key), rec)
  send('designs-changed', {})
  return { ok: true, key, name, size: r.size, blocks, materials: r.materials, warnings: r.warnings }
}
function listDir(dir) {
  try {
    return fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => readJson(path.join(dir, n), null)).filter(Boolean)
  } catch { return [] }
}
ipcMain.handle('designer:blocks', () => BLOCKS)
ipcMain.handle('designs:list', () => listDir(DESIGNS_DIR).map(d => ({ key: d.key, name: d.name, description: d.description, spec: d.spec, size: d.size, blocks: d.blocks, created: d.created })).sort((a, b) => (b.created || 0) - (a.created || 0)))
ipcMain.handle('designs:save', (e, spec) => saveDesign(spec))
ipcMain.handle('designs:delete', (e, key) => { try { fs.unlinkSync(fileOf(DESIGNS_DIR, key)) } catch {} send('designs-changed', {}); return { ok: true } })

// ---------- wlasne komendy ----------
const BUILTIN_VERBS = /^(stop|tu|jak tam|status|eq|daj|wez|zdobadz|scraftuj|buduj|idz|zabij|pomoz|popros|baza|kontynuuj|komendy|naucz|zapomnij|projekty|moje komendy)( |$)/
function saveCommand(c) {
  const name = String(c.name || '').trim().slice(0, 30)
  const key = keyOf(name)
  if (!key) return { ok: false, error: 'Podaj nazwę komendy.' }
  if (BUILTIN_VERBS.test(key)) return { ok: false, error: `"${name}" to już wbudowana komenda - wybierz inną nazwę.` }
  const steps = (c.steps || []).map(s => String(s).trim()).filter(Boolean).slice(0, 60)
  if (!steps.length) return { ok: false, error: 'Komenda musi mieć co najmniej jeden krok.' }
  writeJson(fileOf(COMMANDS_DIR, key), { key, name, description: c.description || '', steps, created: Date.now() })
  send('commands-changed', {})
  return { ok: true, key, name }
}
ipcMain.handle('commands:list', () => listDir(COMMANDS_DIR).sort((a, b) => (b.created || 0) - (a.created || 0)))
ipcMain.handle('commands:save', (e, c) => saveCommand(c))
ipcMain.handle('commands:delete', (e, key) => { try { fs.unlinkSync(fileOf(COMMANDS_DIR, key)) } catch {} send('commands-changed', {}); return { ok: true } })

// ---------- asystent AI ----------
// Klucze API (Gemini albo Claude) w ustawieniach programu, zaszyfrowane przez Windows (DPAPI, konto uzytkownika) przez PowerShell.
// Dzialaja po przeniesieniu danych i po naglym zamknieciu programu - safeStorage Electrona gubil klucz, gdy program
// nie zamknal sie poprawnie (jego klucz trafia do "Local State" dopiero przy wyjsciu). Stare wpisy z safeStorage nadal czytamy.
const KEY_FIELD = { claude: 'apiKeyEnc', gemini: 'geminiKeyEnc' }
const getProvider = () => (appSettings().aiProvider === 'claude' ? 'claude' : 'gemini')
function dpapi(op, text) {
  const ps = op === 'protect'
    ? "$i=[Console]::In.ReadToEnd();Add-Type -AssemblyName System.Security;[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($i),$null,'CurrentUser'))"
    : "$i=[Console]::In.ReadToEnd();Add-Type -AssemblyName System.Security;[Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($i.Trim()),$null,'CurrentUser')))"
  // klucz idzie przez wejscie procesu, nie przez linie polecen
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input: text, encoding: 'utf8', windowsHide: true, timeout: 20000 })
  if (r.status !== 0) throw new Error(String(r.stderr || r.error || 'DPAPI').trim().slice(0, 200))
  return r.stdout.trim()
}
const encryptKey = k => process.platform === 'win32' ? 'dpapi:' + dpapi('protect', k) : safeStorage.encryptString(k).toString('base64')
function decryptKey(v) {
  if (!v) return null
  try {
    return v.startsWith('dpapi:') ? dpapi('unprotect', v.slice(6)) : safeStorage.decryptString(Buffer.from(v, 'base64'))
  } catch { return null }
}
// odszyfrowane klucze trzymamy w pamieci; klucz rozpoznajemy po poczatku, niezaleznie od pola, w ktorym lezy
let keyCache = null
function keys() {
  if (keyCache) return keyCache
  const s = appSettings()
  const out = { gemini: null, claude: null }
  for (const f of ['geminiKeyEnc', 'apiKeyEnc']) {
    const k = decryptKey(s[f])
    const p = k && providerOfKey(k)
    if (p && !out[p]) out[p] = k
  }
  keyCache = out
  return out
}
const getKey = (provider = getProvider()) => keys()[provider]
const assistant = createAssistant({
  getProvider,
  getKey,
  saveDesign,
  saveCommand,
  sendCommand: (who, text) => {
    const list = loadProfiles()
    const p = list.find(x => x.id === who) || list.find(x => x.name.toLowerCase() === String(who || '').toLowerCase()) || list.find(x => procs.has(x.id))
    if (!p) return { ok: false, error: 'Żaden bot nie działa.' }
    return sendAiCommand(p.id, text)
  },
  state: () => ({
    bots: loadProfiles().map(p => ({ name: p.name, mode: p.mode, running: procs.has(p.id), status: lastStatus.get(p.id) || null })),
    buildings: listDir(DESIGNS_DIR).map(d => d.name),
    commands: listDir(COMMANDS_DIR).map(c => ({ name: c.name, steps: c.steps }))
  }),
  emit: ev => send('ai-event', ev)
})
const lastStatus = new Map() // ostatni stan kazdego bota (dla asystenta)
// rodzaj klucza po poczatku: Claude "sk-ant-...", Google "AIza..." albo "AQ...."
const providerOfKey = k => /^sk-ant-/.test(k) ? 'claude' : /^(AIza|AQ\.)/.test(k) ? 'gemini' : null
ipcMain.handle('ai:hasKey', () => !!getKey())
ipcMain.handle('ai:keys', () => ({ provider: getProvider(), gemini: !!getKey('gemini'), claude: !!getKey('claude') }))
ipcMain.handle('ai:setProvider', (e, p) => { writeJson(APP_SETTINGS_FILE, { ...appSettings(), aiProvider: p === 'claude' ? 'claude' : 'gemini' }); return { ok: true } })
// zapis klucza: provider podany albo rozpoznany po kluczu; zapisany klucz od razu staje sie aktywnym silnikiem
ipcMain.handle('ai:setKey', (e, key, provider) => {
  const k = String(key || '').trim()
  const p = provider || providerOfKey(k) || getProvider()
  // pola, w ktorych lezy klucz danego silnika (starsza wersja zapisywala klucz Gemini w polu Claude)
  const fieldsOf = prov => Object.values(KEY_FIELD).filter(f => f === KEY_FIELD[prov] || providerOfKey(decryptKey(appSettings()[f]) || '') === prov)
  if (!k) {
    const s = appSettings()
    for (const f of fieldsOf(p)) s[f] = null
    writeJson(APP_SETTINGS_FILE, s)
    keyCache = null
    return { ok: true, provider: p }
  }
  const real = providerOfKey(k)
  if (!real) return { ok: false, error: 'To nie wygląda na klucz Gemini (AIza… / AQ.…) ani Claude (sk-ant-…).' }
  let enc
  try { enc = encryptKey(k) } catch (err) { return { ok: false, error: 'Nie udało się zaszyfrować klucza: ' + err.message } }
  const s = appSettings()
  for (const f of fieldsOf(real)) s[f] = null
  writeJson(APP_SETTINGS_FILE, { ...s, [KEY_FIELD[real]]: enc, aiProvider: real })
  keyCache = null
  return { ok: true, provider: real }
})
ipcMain.handle('ai:chat', (e, text, botId) => assistant.chat(text, { conv: 'app', botId }))
ipcMain.handle('ai:reset', () => { assistant.reset('app'); return { ok: true } })

// AI w grze: bot przysyla pytanie gracza (@@AI), odpowiedz wraca na jego wejscie (@@AIREPLY) i bot pisze ja na czacie
async function handleAiRequest(id, req) {
  const p = loadProfiles().find(x => x.id === id)
  const entry = procs.get(id)
  if (!p || !entry) return
  send('log', { id, kind: 'gui', text: `🤖 AI: ${req.from}: ${req.text}` })
  const res = await assistant.chat(req.text, { conv: 'bot:' + id, botId: id, inGame: true, botName: p.name, player: req.from })
  const text = res.ok ? res.text : 'AI: ' + res.error
  send('log', { id, kind: 'gui', text: `🤖 AI → ${text}` })
  if (procs.get(id) === entry) entry.proc.stdin.write('@@AIREPLY ' + JSON.stringify({ id: req.id, text }) + '\n')
}

// ---------- aktualizacje (GitHub Releases) ----------
function setupUpdates() {
  if (!autoUpdater || !app.isPackaged) {
    send('update', { state: 'dev', text: 'Aktualizacje dzialaja w zainstalowanej wersji programu.' })
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = true // wersje beta sa na GitHubie oznaczone jako pre-release
  autoUpdater.on('checking-for-update', () => send('update', { state: 'checking', text: 'Sprawdzam aktualizacje...' }))
  autoUpdater.on('update-available', i => send('update', { state: 'available', text: `Jest nowa wersja ${i.version} - pobieram...`, version: i.version }))
  autoUpdater.on('update-not-available', () => send('update', { state: 'none', text: 'Masz najnowsza wersje.' }))
  autoUpdater.on('download-progress', p => send('update', { state: 'downloading', text: `Pobieram aktualizacje: ${Math.round(p.percent)}%`, percent: p.percent }))
  autoUpdater.on('update-downloaded', i => send('update', { state: 'ready', text: `Wersja ${i.version} gotowa do instalacji.`, version: i.version }))
  autoUpdater.on('error', e => send('update', { state: 'error', text: 'Nie udalo sie sprawdzic aktualizacji: ' + (e?.message || e) }))
  const check = () => { if (appSettings().autoUpdate) autoUpdater.checkForUpdates().catch(() => {}) }
  check()
  setInterval(check, 30 * 60 * 1000)
}
ipcMain.handle('update:check', () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false, error: 'Aktualizacje dzialaja tylko w zainstalowanej wersji.' }
  autoUpdater.checkForUpdates().catch(err => send('update', { state: 'error', text: String(err?.message || err) }))
  return { ok: true }
})
ipcMain.handle('update:install', () => {
  stopAll()
  setTimeout(() => autoUpdater?.quitAndInstall(), 500)
  return { ok: true }
})

app.whenReady().then(() => {
  createWindow()
  win.webContents.once('did-finish-load', setupUpdates)
  // MB_SCREENSHOT=plik.png: zrzut okna po zaladowaniu i wyjscie (do sprawdzania wygladu bez klikania)
  if (process.env.MB_SCREENSHOT) {
    win.webContents.on('console-message', e => console.log('[okno]', e.message))
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.MB_JS) await win.webContents.executeJavaScript(process.env.MB_JS).catch(err => console.log('[okno] MB_JS:', err.message))
      await new Promise(r => setTimeout(r, 600))
      fs.writeFileSync(process.env.MB_SCREENSHOT, (await win.webContents.capturePage()).toPNG())
      app.quit()
    }, 1500))
  }
})
app.on('window-all-closed', () => { stopAll(); app.quit() })
app.on('before-quit', stopAll)
