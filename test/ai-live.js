// Prawdziwa rozmowa z AI (wymaga klucza w zmiennej AI_TEST_KEY; provider z AI_TEST_PROVIDER: gemini|claude).
// Uzycie: AI_TEST_KEY=... node test/ai-live.js "pytanie" [inGame]
const Designer = require('../gui/designer')
Designer.setBlocks(require('minecraft-data')('1.21.11').blocksArray.map(b => b.name))
const { createAssistant } = require('../gui/ai')

const key = process.env.AI_TEST_KEY
if (!key) { console.error('Brak AI_TEST_KEY'); process.exit(1) }
const provider = process.env.AI_TEST_PROVIDER || 'gemini'
const a = createAssistant({
  getProvider: () => provider,
  getKey: () => key,
  saveDesign: spec => {
    const r = Designer.generate(spec)
    const blocks = r.cells.filter(c => c.block !== 'air').length
    console.log('[budowla]', spec.name, JSON.stringify(r.size), blocks, 'blokow', r.materials.slice(0, 6).map(m => m.join(':')).join(' '), r.warnings.join(' '))
    return blocks ? { ok: true, key: spec.name, name: spec.name, size: r.size, blocks, materials: r.materials, warnings: r.warnings } : { ok: false, error: 'Budowla nie ma blokow.' }
  },
  saveCommand: c => { console.log('[komenda]', c.name, JSON.stringify(c.steps)); return { ok: true, key: c.name, name: c.name } },
  sendCommand: (who, text) => { console.log('[do bota]', who, text); return { ok: true } },
  state: () => ({ bots: [{ name: 'Claude', running: true }], buildings: [], commands: [] }),
  emit: e => { if (e.type === 'tool') console.log('[narzedzie]', e.name) }
})
const inGame = process.argv[3] === 'inGame'
const t = Date.now()
a.chat(process.argv[2], inGame ? { conv: 'bot:x', botId: 'x', inGame: true, botName: 'Claude', player: 'Czarkonator' } : {})
  .then(r => { console.log(r.ok ? `[odpowiedz ${r.model}, ${((Date.now() - t) / 1000).toFixed(1)} s]\n${r.text}` : '[blad] ' + r.error) })
