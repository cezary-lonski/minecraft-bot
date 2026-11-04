// Centrum sterowania botow (Electron).
// Kazdy bot to profil (nick, swiat, ustawienia) z wlasnym folderem danych - pamieta punkty, budowle, ostatnie zadanie.
// Uruchomiony bot dziala jako osobny proces Node (bot.js); okno wysyla mu komendy na wejscie i czyta jego wyjscie.
// Kilka botow moze dzialac naraz - ich wiadomosci zespolowe (@@TEAM) sa przekazywane miedzy nimi.
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

let autoUpdater = null
try { autoUpdater = require('electron-updater').autoUpdater } catch { /* brak w trybie deweloperskim */ }

const DATA = app.getPath('userData') // %APPDATA%\minecraft-bot
const PROFILES_FILE = path.join(DATA, 'bots.json')
const APP_SETTINGS_FILE = path.join(DATA, 'app-settings.json')
const BOT_DEFAULTS = {
  name: 'Claude', mode: 'lan', port: '', host: '', player: '', owner: '', password: '', version: '',
  loot: 'auto', rtp: true, chatDelay: '', eatBelow: 8, autoHelp: true
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
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', MC_GUI: '1', MC_DATA_DIR: botDir(p.id), MC_USER: p.name || 'Claude', MC_MODE: p.mode }
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
    try { send('status', { id, ...JSON.parse(line.slice(9)) }) } catch {}
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
ipcMain.handle('profiles:delete', (e, id) => {
  stopBot(id)
  saveProfiles(loadProfiles().filter(x => x.id !== id))
  try { fs.rmSync(botDir(id), { recursive: true, force: true }) } catch {}
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
