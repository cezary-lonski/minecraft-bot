// Uruchamia bot.js z atrapa Mineflayera (bez serwera), zeby sprawdzic komendy dzialajace przed wejsciem do gry:
// naucz sie / moje komendy / zapomnij komende / projekty. Uzycie: node test/bot-offline.js <folder-danych>
const path = require('path')
const EventEmitter = require('events')
const mineflayer = require('mineflayer')

const noop = () => {}
mineflayer.createBot = opts => {
  const bot = new EventEmitter()
  bot.username = opts.username
  bot.loadPlugin = noop
  bot.chat = msg => console.log('[czat]', msg)
  bot.whisper = (u, msg) => console.log('[szept]', u, msg)
  bot.quit = noop
  bot.end = noop
  bot.players = {}
  bot.entities = {}
  bot.inventory = { items: () => [] }
  bot._client = new EventEmitter()
  bot.pathfinder = { setGoal: noop, setMovements: noop }
  bot.pvp = { stop: noop }
  bot.clearControlStates = noop
  bot.stopDigging = noop
  return bot
}

const dir = process.argv[2]
process.env.MC_DATA_DIR = dir
process.env.MC_DESIGNS_DIR = path.join(dir, 'projekty')
process.env.MC_COMMANDS_DIR = path.join(dir, 'komendy')
process.env.MC_HOST = '127.0.0.1'
process.env.MC_PORT = '1'
process.env.MC_MODE = 'lan'
process.env.MC_USER = 'Test'
process.env.MC_CHAT_DELAY = '10'
require('../bot.js')
setTimeout(() => process.exit(0), Number(process.argv[3] || 6000))
