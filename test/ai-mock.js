// Test asystenta bez prawdziwego API: podstawiony klient zwraca zaplanowane odpowiedzi.
// Sprawdza ksztalt zapytania, wykonanie narzedzi i zapis budowli z voxeli.
const path = require('path')
const assert = require('assert')
const sdkPath = require.resolve('@anthropic-ai/sdk')
const Real = require('@anthropic-ai/sdk')

const requests = []
const script = [
  {
    stop_reason: 'tool_use',
    content: [
      { type: 'text', text: 'Robię kurczaka!' },
      {
        type: 'tool_use', id: 't1', name: 'create_building', input: {
          name: 'kurczak', description: 'mały kurczak',
          parts: [{
            kind: 'voxels', x: 0, z: 0,
            palette: { W: 'white_wool', Y: 'yellow_wool', R: 'red_wool', O: 'orange_wool', B: 'black_wool' },
            layers: [
              { y: 0, rows: ['Y.Y'] },
              { y: 1, rows: ['WWW', 'WWW', 'WWW'] },
              { y: 2, rows: ['WWW', 'WWW', 'WWW'] },
              { y: 3, rows: ['BWB', '.W.'] },
              { y: 4, rows: ['.R.', '.O.'] }
            ]
          }]
        }
      }
    ]
  },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Gotowe. Napisz botowi: `buduj kurczak`.' }] }
]

class Fake {
  constructor (opts) { this.opts = opts; this.beta = { messages: { create: async body => { requests.push(JSON.parse(JSON.stringify(body))); return script.shift() } } } }
}
Object.assign(Fake, { AuthenticationError: Real.AuthenticationError, PermissionDeniedError: Real.PermissionDeniedError, RateLimitError: Real.RateLimitError, APIConnectionError: Real.APIConnectionError, APIError: Real.APIError })
require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: Fake }

const Designer = require('../gui/designer')
Designer.setBlocks(require('minecraft-data')('1.21.11').blocksArray.map(b => b.name))
const { createAssistant } = require(path.join('..', 'gui', 'ai'))

const saved = []
const events = []
const a = createAssistant({
  getKey: () => 'sk-test',
  saveDesign: spec => { const r = Designer.generate(spec); saved.push({ spec, r }); return { ok: true, key: 'kurczak', name: spec.name, size: r.size, blocks: r.cells.filter(c => c.block !== 'air').length, materials: r.materials, warnings: r.warnings } },
  saveCommand: () => ({ ok: true }),
  sendCommand: () => ({ ok: true }),
  state: () => ({}),
  emit: e => events.push(e.type)
})

;(async () => {
  const res = await a.chat('dodaj budowlę kurczak')
  assert.ok(res.ok, res.error)
  assert.match(res.text, /buduj kurczak/)
  assert.strictEqual(requests.length, 2)
  const r0 = requests[0]
  assert.strictEqual(r0.model, 'claude-opus-5-5')
  assert.deepStrictEqual(r0.betas, ['server-side-fallback-2026-07-01'])
  assert.strictEqual(r0.fallbacks, 'default')
  assert.ok(!('thinking' in r0) && !('tool_choice' in r0) && !('temperature' in r0))
  assert.ok(r0.tools.some(t => t.name === 'create_building'))
  // druga tura: historia z odpowiedzia asystenta i wynikiem narzedzia
  const r1 = requests[1]
  assert.strictEqual(r1.messages.length, 3)
  assert.strictEqual(r1.messages[2].content[0].type, 'tool_result')
  assert.ok(JSON.parse(r1.messages[2].content[0].content).ok)
  const blocks = saved[0].r.cells.filter(c => c.block !== 'air')
  assert.ok(blocks.length >= 20, 'kurczak ma bloki')
  assert.ok(blocks.some(c => c.block === 'red_wool' && c.y === 4))
  assert.deepStrictEqual(events, ['tool', 'design'])
  console.log('ai-mock OK:', blocks.length, 'blokow kurczaka,', JSON.stringify(saved[0].r.size))
})().catch(e => { console.error(e); process.exit(1) })
