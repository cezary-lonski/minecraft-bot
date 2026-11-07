// Model 3D (STL albo OBJ) -> budowla dla bota. Powierzchnia modelu zamienia sie w bloki (w srodku pusto),
// a material zalezy od kierunku powierzchni: sciany, dachy (skosy), plaskie tarasy i skala (nizej niz --skala-do).
//
// Uzycie: node tools/model-na-budowle.js <plik.stl|obj> <folder-projektow> [--nazwa "moja budowla"] [--skala 1]
//         [--rozmiar 200] [--skala-do 46] [--usun x1:x2,y1:y2,z1:z2] ...
// Jako modul: require('./tools/model-na-budowle.js').convert(plik, opcje) -> { cells }
const fs = require('fs')
const path = require('path')

// ---------- wczytywanie ----------
function readStl(buf) {
  const n = buf.readUInt32LE(80)
  if (84 + n * 50 === buf.length) {
    const t = new Float32Array(n * 9)
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) t[i * 9 + k] = buf.readFloatLE(84 + i * 50 + 12 + k * 4)
    return t
  }
  return Float32Array.from([...buf.toString('utf8').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap(m => [+m[1], +m[2], +m[3]]))
}
function readObj(txt) {
  const v = []
  const t = []
  for (const line of txt.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/)
    if (p[0] === 'v') v.push([+p[1], +p[2], +p[3]])
    else if (p[0] === 'f') {
      const idx = p.slice(1).map(s => { const i = parseInt(s.split('/')[0]); return i < 0 ? v.length + i : i - 1 })
      for (let k = 1; k + 1 < idx.length; k++) t.push(...v[idx[0]], ...v[idx[k]], ...v[idx[k + 1]]) // wielokat -> wachlarz trojkatow
    }
  }
  return Float32Array.from(t)
}
function readModel(file) {
  const buf = fs.readFileSync(file)
  return /\.obj$/i.test(file) ? readObj(buf.toString('utf8')) : readStl(buf)
}

// ---------- materialy ----------
const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
const pick = (list, x, y, z) => { let r = hash(x, y, z); for (const [b, p] of list) { if ((r -= p) < 0) return b } return list[0][0] }
const MATERIALS = {
  wall: [['end_stone_bricks', 0.62], ['end_stone', 0.12], ['smooth_sandstone', 0.14], ['sandstone', 0.12]],
  roof: [['deepslate_tiles', 0.5], ['polished_blackstone_bricks', 0.3], ['blackstone', 0.2]], // czarne dachy
  flat: [['stone_bricks', 0.7], ['polished_andesite', 0.3]],
  under: [['end_stone_bricks', 1]],
  rock: [['stone', 0.42], ['andesite', 0.25], ['tuff', 0.15], ['cobblestone', 0.12], ['mossy_cobblestone', 0.06]]
}

// ---------- zamiana na bloki ----------
// opts: scale (jednostki modelu na blok), size (zamiast scale: najwiekszy wymiar w blokach), upAxis ('z' dla STL z drukarek 3D),
// rockBelow (ponizej tej wysokosci - skala), remove (lista prostokatow do usuniecia {x1,x2,y1,y2,z1,z2}), dropBottom (bez warstwy y<=0)
function convert(file, opts = {}) {
  const t = readModel(file)
  const up = opts.upAxis || (/\.obj$/i.test(file) ? 'y' : 'z')
  const mn = [Infinity, Infinity, Infinity]
  const mx = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], t[i + k]); mx[k] = Math.max(mx[k], t[i + k]) }
  const scale = opts.size ? opts.size / Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) : (opts.scale || 1)
  // os "do gory" modelu -> y w Minecrafcie
  const map = up === 'z' ? p => [p[0] - mn[0], p[2] - mn[2], p[1] - mn[1]] : p => [p[0] - mn[0], p[1] - mn[1], p[2] - mn[2]]
  const vox = new Map() // klucz -> [x, y, z, glosy: sciana, dach, plasko, spod]
  for (let i = 0; i < t.length; i += 9) {
    const P = [0, 3, 6].map(o => map([t[i + o], t[i + o + 1], t[i + o + 2]]).map(v => v * scale))
    const e1 = P[1].map((v, k) => v - P[0][k])
    const e2 = P[2].map((v, k) => v - P[0][k])
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const len = Math.hypot(...n)
    if (!len) continue
    const upN = n[1] / len
    // rodzaj powierzchni trojkata: plasko w gore, skos (dach - tez od spodu, bo stozki maja dwie scianki), spod,
    // sciana rowna z osia (mury, mosty) albo sciana pod dowolnym katem (okragle wieze, poszarpana skala)
    const hx = Math.abs(n[0]) / len, hz = Math.abs(n[2]) / len
    const kind = upN > 0.9 ? 2 : upN < -0.9 ? 3 : Math.abs(upN) > 0.12 ? 1 : Math.max(hx, hz) > 0.95 * Math.hypot(hx, hz) ? 0 : 4
    const steps = Math.max(1, Math.ceil(Math.max(Math.hypot(...e1), Math.hypot(...e2), Math.hypot(...P[2].map((v, k) => v - P[1][k]))) / 0.35))
    for (let a = 0; a <= steps; a++) {
      for (let b = 0; a + b <= steps; b++) {
        const u = a / steps
        const w = b / steps
        const x = Math.floor(P[0][0] + e1[0] * u + e2[0] * w)
        const y = Math.floor(P[0][1] + e1[1] * u + e2[1] * w)
        const z = Math.floor(P[0][2] + e1[2] * u + e2[2] * w)
        const key = x + ',' + y + ',' + z
        let v = vox.get(key)
        if (!v) { v = [x, y, z, 0, 0, 0, 0, 0]; vox.set(key, v) }
        v[3 + kind]++
      }
    }
  }
  const removed = (x, y, z) => (opts.remove || []).some(r => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2 && z >= r.z1 && z <= r.z2)
  const cells = []
  for (const [x, y, z, wall, roof, flat, under, wallAny] of vox.values()) {
    if ((opts.dropBottom && y <= 0) || removed(x, y, z)) continue
    let mat
    const forced = (opts.force || []).find(r => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2 && z >= r.z1 && z <= r.z2)
    if (forced) mat = forced.mat
    else if (opts.rockBelow !== undefined && y < opts.rockBelow) {
      // nizej: skala, chyba ze powierzchnia jest rowna z osiami (mosty, przystan, mury u podnoza)
      mat = wall + flat + under > roof + wallAny ? (flat > wall ? 'flat' : 'wall') : 'rock'
    } else {
      const w = wall + wallAny
      const best = Math.max(w, roof, flat, under)
      mat = best === roof ? 'roof' : best === flat ? 'flat' : best === under ? 'under' : 'wall'
    }
    cells.push({ x, y, z, block: pick(MATERIALS[mat], x, y, z), mat })
  }
  return { cells, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]].map(v => Math.round(v * scale)) }
}

// zapis jako projekt (z miniatura zmniejszona 3 razy)
function saveDesign(Designer, dir, name, description, cells, rooms = [], extra = {}) {
  const r = Designer.fromCells(cells, rooms)
  const solid = r.cells.filter(c => c.block !== 'air')
  const thumb = new Map()
  for (const c of solid) {
    if (c.temp) continue
    const k = `${Math.floor(c.x / 3)},${Math.floor(c.y / 3)},${Math.floor(c.z / 3)}`
    if (!thumb.has(k)) thumb.set(k, { x: Math.floor(c.x / 3), y: Math.floor(c.y / 3), z: Math.floor(c.z / 3), block: c.block })
  }
  const key = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const rec = { key, name: key, description, spec: { name: key, description, generated: 'model 3D', parts: [] }, plan: r.cells, rooms, ahead: r.ahead, size: r.size, blocks: solid.length, thumb: [...thumb.values()], created: Date.now(), ...extra }
  fs.writeFileSync(path.join(dir, key.replace(/ /g, '_') + '.json'), JSON.stringify(rec))
  return { key, blocks: solid.length, size: r.size, temps: solid.filter(c => c.temp).length, warnings: r.warnings }
}

module.exports = { convert, saveDesign, readModel }

if (require.main === module) {
  const args = process.argv.slice(2)
  const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
  const [file, dir] = args
  if (!file || !dir) { console.log('Uzycie: node tools/model-na-budowle.js <plik.stl|obj> <folder-projektow> [--nazwa ...] [--skala 1 | --rozmiar 200] [--skala-do 46] [--usun x1:x2,y1:y2,z1:z2]'); process.exit(1) }
  const remove = []
  args.forEach((a, i) => { if (a === '--usun') { const [xs, ys, zs] = args[i + 1].split(',').map(s => s.split(':').map(Number)); remove.push({ x1: xs[0], x2: xs[1], y1: ys[0], y2: ys[1], z1: zs[0], z2: zs[1] }) } })
  const Designer = require('../gui/designer.js')
  const md = require('minecraft-data')
  Designer.setBlocks(md(md.supportedVersions.pc.filter(v => !/snapshot|pre|rc|w/.test(v)).slice(-1)[0]).blocksArray.map(b => b.name))
  const { cells } = convert(file, { scale: opt('skala') ? +opt('skala') : undefined, size: opt('rozmiar') ? +opt('rozmiar') : undefined, rockBelow: opt('skala-do') ? +opt('skala-do') : undefined, remove, dropBottom: true })
  const name = opt('nazwa', path.basename(file).replace(/\.\w+$/, ''))
  console.log(saveDesign(Designer, dir, name, `Budowla z modelu 3D (${path.basename(file)}).`, cells))
}
