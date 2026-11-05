// Uruchamia bot.js z atrapa Mineflayera (bez serwera), zeby sprawdzic komendy dzialajace przed wejsciem do gry:
// naucz sie / moje komendy / zapomnij komende / projekty. Uzycie: node test/bot-offline.js <folder-danych> [ms]
const path = require('path')
const mineflayer = require('mineflayer')
mineflayer.createBot = require('./bot-offline-fake')

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
