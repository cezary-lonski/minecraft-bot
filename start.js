// Uruchamianie: node start.js                 -> pyta o wszystko (odpowiedzi zapamietuje w config.json)
//               node start.js lan 12345       -> od razu swiat LAN na porcie 12345
//               node start.js serwer <adres>  -> od razu serwer (np. node start.js serwer mc.example.com)
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const CONFIG_FILE = path.join(__dirname, 'config.json')

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) } catch { return {} }
}

function ask(rl, question, def) {
  return new Promise(resolve => rl.question(def ? `${question} [${def}]: ` : `${question}: `, a => resolve(a.trim() || def || '')))
}

async function main() {
  const cfg = loadConfig()
  let [mode, arg] = process.argv.slice(2)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  if (!mode) mode = await ask(rl, 'Tryb: lan czy serwer?', cfg.mode || 'lan')
  mode = mode.toLowerCase().startsWith('s') ? 'serwer' : 'lan'
  cfg.mode = mode

  cfg.username = process.env.MC_USER || await ask(rl, 'Nick bota', cfg.username || 'Claude')

  if (mode === 'lan') {
    let port = arg
    while (!/^\d+$/.test(port || '')) port = await ask(rl, 'Port LAN (pokazuje sie na czacie po "Open to LAN")')
    // tryb ustala adres sam: zmienne MC_HOST/MC_PORT zostaja w oknie PowerShella z poprzednich uruchomien
    process.env.MC_HOST = process.env.MC_LAN_HOST || 'localhost'
    process.env.MC_PORT = port
    // w singleplayerze nie ma /rtp, logowania ani antyspamu
    process.env.MC_RTP = '0'
    process.env.MC_AUTOLOGIN = '0'
    process.env.MC_CHAT_DELAY = process.env.MC_CHAT_DELAY || '600'
  } else {
    let host = arg
    while (!host) host = await ask(rl, 'Adres serwera (np. mc.example.com albo mc.example.com:25565)', cfg.host)
    cfg.host = host
    const [h, p] = host.split(':')
    process.env.MC_HOST = h
    if (p) process.env.MC_PORT = p
    else delete process.env.MC_PORT // port serwer zwykle podaje w rekordzie SRV - bot znajdzie go sam
    cfg.owner = process.env.MC_OWNER || await ask(rl, 'Twoj nick w grze (wlasciciel - moze wydawac komendy)', cfg.owner)
    cfg.password = process.env.MC_PASS ?? await ask(rl, 'Haslo do /login na serwerze (Enter = bez autologowania)', cfg.password)
    process.env.MC_OWNER = cfg.owner || ''
    process.env.MC_PASS = cfg.password || ''
  }
  process.env.MC_USER = cfg.username
  process.env.MC_MODE = mode
  rl.close()

  // zapamietujemy odpowiedzi (plik jest w .gitignore - haslo nie trafia do repozytorium)
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)) } catch {}

  console.log(`[start] Tryb: ${mode === 'lan' ? `LAN (localhost:${process.env.MC_PORT})` : `serwer (${process.env.MC_HOST})`}, nick bota: ${cfg.username}`)
  require('./bot.js')
}

main()
