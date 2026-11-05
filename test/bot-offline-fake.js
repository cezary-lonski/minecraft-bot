// atrapa bota Mineflayer do testow bez serwera (test/bot-offline.js i testy AI w grze)
const EventEmitter = require('events')
const noop = () => {}
module.exports = opts => {
  const bot = new EventEmitter()
  Object.assign(bot, {
    username: opts.username, loadPlugin: noop, quit: noop, end: noop, players: {}, entities: {},
    chat: msg => console.log('[czat]', msg), whisper: (u, msg) => console.log('[szept]', u, msg),
    inventory: { items: () => [] }, _client: new EventEmitter(),
    pathfinder: { setGoal: noop, setMovements: noop }, pvp: { stop: noop }, clearControlStates: noop, stopDigging: noop
  })
  return bot
}
