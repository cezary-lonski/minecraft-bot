// Zapisuje plany wbudowanych budowli bota (dom, zamek, palac...) do gui/wbudowane.json - z nich program rysuje podglad.
// Uruchom po zmianie planow w bot.js: node tools/export-builtin.js
const path = require('path')
const mineflayer = require('mineflayer')
mineflayer.createBot = require('../test/bot-offline-fake')
process.env.MC_EXPORT_PLANS = path.join(__dirname, '..', 'gui', 'wbudowane.json')
process.env.MC_DATA_DIR = path.join(require('os').tmpdir(), 'mb-export')
process.env.MC_HOST = '127.0.0.1'
process.env.MC_PORT = '1'
require('../bot.js')
