// Kreator budowli: z opisu (spec) robi liste blokow dla bota.
// Dziala w oknie programu (window.Designer) i w Node (require) - ten sam kod generuje podglad i plan dla bota.
//
// Uklad wspolrzednych jak w planach bota: x - w prawo, z - do przodu (od bota), y - w gore.
// Drzwi glownej budowli sa w (0, 0, 0), budowla stoi przed botem (z >= 0).
//
// spec = { name, style, seed, parts: [ { kind, x, y, z, ...parametry } ] }
// kind: house, tower, castle, walls, church, pyramid, lighthouse, windmill, bridge, well, gazebo, igloo,
//       barn, skyscraper, arena, fence, tree, lamp, box, cylinder, sphere, voxels
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.Designer = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // ---------- bloki dostepne w grze (ustawiane z minecraft-data) ----------
  let VALID = null
  function setBlocks(names) { VALID = new Set(names) }
  const valid = n => !!n && (!VALID || VALID.has(n))

  // ---------- kolory i materialy ----------
  const DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']
  const DYE_HEX = {
    white: '#e9ecec', orange: '#f07613', magenta: '#bd44b3', light_blue: '#3aafd9', yellow: '#f8c527', lime: '#70b919',
    pink: '#ed8dac', gray: '#3e4447', light_gray: '#8e8e86', cyan: '#158991', purple: '#792aac', blue: '#35399d',
    brown: '#724728', green: '#546d1b', red: '#a12722', black: '#141519'
  }
  const COLOR_PL = [
    [/jasnoszar/, 'light_gray'], [/jasnoniebiesk|blekit|blekitn/, 'light_blue'], [/jasnozielon|limonk/, 'lime'],
    [/bial/, 'white'], [/czarn/, 'black'], [/czerwon/, 'red'], [/niebiesk|granat/, 'blue'], [/zielon/, 'green'],
    [/zolt|zlocist/, 'yellow'], [/pomarancz/, 'orange'], [/rozow|roz /, 'pink'], [/fiolet/, 'purple'], [/purpurow|magent/, 'magenta'],
    [/szar|siw/, 'gray'], [/braz/, 'brown'], [/turkus|cyjan|morsk/, 'cyan']
  ]

  // materialy: full - pelny blok, stairs/slab/wall/fence - warianty, pillar - na kolumny i rogi, door - drzwi
  const MATS = {}
  const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped']
  for (const w of WOODS) {
    const stem = w === 'crimson' || w === 'warped'
    MATS[w] = {
      label: w, full: w + '_planks', stairs: w + '_stairs', slab: w + '_slab', fence: w + '_fence', wall: w + '_fence',
      gate: w + '_fence_gate', door: w + '_door', log: w === 'bamboo' ? 'bamboo_block' : stem ? w + '_stem' : w + '_log',
      pillar: w === 'bamboo' ? 'bamboo_block' : stem ? w + '_stem' : w + '_log', wood: true
    }
  }
  const STONES = {
    cobblestone: ['cobblestone', 'cobblestone_stairs', 'cobblestone_slab', 'cobblestone_wall'],
    mossy_cobblestone: ['mossy_cobblestone', 'mossy_cobblestone_stairs', 'mossy_cobblestone_slab', 'mossy_cobblestone_wall'],
    stone: ['stone', 'stone_stairs', 'stone_slab', 'cobblestone_wall'],
    smooth_stone: ['smooth_stone', null, 'smooth_stone_slab', 'stone_brick_wall'],
    stone_bricks: ['stone_bricks', 'stone_brick_stairs', 'stone_brick_slab', 'stone_brick_wall', 'chiseled_stone_bricks'],
    mossy_stone_bricks: ['mossy_stone_bricks', 'mossy_stone_brick_stairs', 'mossy_stone_brick_slab', 'mossy_stone_brick_wall'],
    bricks: ['bricks', 'brick_stairs', 'brick_slab', 'brick_wall'],
    sandstone: ['sandstone', 'sandstone_stairs', 'sandstone_slab', 'sandstone_wall', 'chiseled_sandstone'],
    cut_sandstone: ['cut_sandstone', 'smooth_sandstone_stairs', 'cut_sandstone_slab', 'sandstone_wall', 'chiseled_sandstone'],
    red_sandstone: ['red_sandstone', 'red_sandstone_stairs', 'red_sandstone_slab', 'red_sandstone_wall', 'chiseled_red_sandstone'],
    quartz: ['quartz_block', 'quartz_stairs', 'quartz_slab', null, 'quartz_pillar'],
    deepslate_bricks: ['deepslate_bricks', 'deepslate_brick_stairs', 'deepslate_brick_slab', 'deepslate_brick_wall', 'polished_deepslate'],
    deepslate_tiles: ['deepslate_tiles', 'deepslate_tile_stairs', 'deepslate_tile_slab', 'deepslate_tile_wall', 'polished_deepslate'],
    cobbled_deepslate: ['cobbled_deepslate', 'cobbled_deepslate_stairs', 'cobbled_deepslate_slab', 'cobbled_deepslate_wall'],
    blackstone: ['polished_blackstone_bricks', 'polished_blackstone_brick_stairs', 'polished_blackstone_brick_slab', 'polished_blackstone_brick_wall', 'polished_blackstone'],
    nether_bricks: ['nether_bricks', 'nether_brick_stairs', 'nether_brick_slab', 'nether_brick_wall', 'chiseled_nether_bricks'],
    red_nether_bricks: ['red_nether_bricks', 'red_nether_brick_stairs', 'red_nether_brick_slab', 'red_nether_brick_wall'],
    prismarine_bricks: ['prismarine_bricks', 'prismarine_brick_stairs', 'prismarine_brick_slab', 'prismarine_wall', 'dark_prismarine'],
    dark_prismarine: ['dark_prismarine', 'dark_prismarine_stairs', 'dark_prismarine_slab', 'prismarine_wall'],
    prismarine: ['prismarine', 'prismarine_stairs', 'prismarine_slab', 'prismarine_wall'],
    purpur: ['purpur_block', 'purpur_stairs', 'purpur_slab', null, 'purpur_pillar'],
    end_stone_bricks: ['end_stone_bricks', 'end_stone_brick_stairs', 'end_stone_brick_slab', 'end_stone_brick_wall'],
    mud_bricks: ['mud_bricks', 'mud_brick_stairs', 'mud_brick_slab', 'mud_brick_wall'],
    tuff_bricks: ['tuff_bricks', 'tuff_brick_stairs', 'tuff_brick_slab', 'tuff_brick_wall', 'chiseled_tuff_bricks'],
    copper: ['cut_copper', 'cut_copper_stairs', 'cut_copper_slab', null],
    oxidized_copper: ['oxidized_cut_copper', 'oxidized_cut_copper_stairs', 'oxidized_cut_copper_slab', null],
    polished_andesite: ['polished_andesite', 'polished_andesite_stairs', 'polished_andesite_slab', 'andesite_wall'],
    polished_granite: ['polished_granite', 'polished_granite_stairs', 'polished_granite_slab', 'granite_wall'],
    polished_diorite: ['polished_diorite', 'polished_diorite_stairs', 'polished_diorite_slab', 'diorite_wall']
  }
  for (const [k, [full, stairs, slab, wall, pillar]] of Object.entries(STONES)) {
    MATS[k] = { label: k, full, stairs, slab, wall, fence: wall, pillar: pillar || full }
  }
  for (const [k, full] of Object.entries({
    obsidian: 'obsidian', snow: 'snow_block', ice: 'packed_ice', glass: 'glass', gold: 'gold_block', iron: 'iron_block',
    diamond: 'diamond_block', emerald: 'emerald_block', amethyst: 'amethyst_block', calcite: 'calcite', moss: 'moss_block',
    hay: 'hay_block', dirt: 'dirt', sand: 'sand', gravel: 'gravel', clay: 'clay', glowstone: 'glowstone', sea_lantern: 'sea_lantern'
  })) MATS[k] = { label: k, full }

  // material z nazwy: klucz z MATS, kolorowy blok (red_concrete) albo dowolny blok z gry
  function mat(key) {
    if (!key) return mat('stone_bricks')
    if (typeof key === 'object') return key
    const k = String(key).trim()
    let m = MATS[k]
    if (!m) {
      const base = k.replace(/^minecraft:/, '')
      if (/_planks$/.test(base)) m = MATS[base.replace(/_planks$/, '')]
      if (!m) {
        // pochodne nazwy: bricks -> brick_stairs, stone_bricks -> stone_brick_stairs, quartz_block -> quartz_stairs
        const stem = base.replace(/_block$/, '').replace(/s$/, '')
        m = { label: base, full: base, stairs: stem + '_stairs', slab: stem + '_slab', wall: stem + '_wall', pillar: base }
      }
    }
    const out = {}
    for (const [f, v] of Object.entries(m)) out[f] = (typeof v === 'string' && f !== 'label') ? (valid(v) ? v : null) : v
    if (!out.full) out.full = 'stone_bricks'
    if (!out.pillar) out.pillar = out.full
    return out
  }

  // ---------- generator liczb pseudolosowych (warianty) ----------
  function rng(seed) {
    let s = (seed >>> 0) || 1
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000 }
  }

  // ---------- siatka ----------
  class Grid {
    constructor() { this.m = new Map() }
    set(x, y, z, block, extra) { this.m.set(x + ',' + y + ',' + z, Object.assign({ x, y, z, block }, extra || {})) }
    get(x, y, z) { return this.m.get(x + ',' + y + ',' + z) }
    del(x, y, z) { this.m.delete(x + ',' + y + ',' + z) }
    cells() { return [...this.m.values()] }
  }

  const rect = (x1, x2, z1, z2, cb) => { for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) cb(x, z) }
  const ringRect = (x1, x2, z1, z2, cb) => rect(x1, x2, z1, z2, (x, z) => { if (x === x1 || x === x2 || z === z1 || z === z2) cb(x, z) })
  const odd = n => (Math.round(n) | 1)
  const clamp = (n, a, b) => Math.max(a, Math.min(b, Math.round(Number(n) || 0)))

  // kolo o promieniu r wokol (0,0): wnetrze i obwod (obwod - pola dysku z sasiadem poza dyskiem)
  function circle(r) {
    const R = Math.ceil(r) + 1
    const inDisk = (x, z) => Math.hypot(x, z) <= r + 0.45
    const disk = []
    const ring = []
    for (let x = -R; x <= R; x++) {
      for (let z = -R; z <= R; z++) {
        if (!inDisk(x, z)) continue
        disk.push([x, z])
        if (!inDisk(x + 1, z) || !inDisk(x - 1, z) || !inDisk(x, z + 1) || !inDisk(x, z - 1)) ring.push([x, z])
      }
    }
    return { disk, ring, inDisk }
  }

  // kontekst czesci: wspolrzedne lokalne czesci -> wspolrzedne budowli
  function ctxFor(g, part, extraOpt) {
    const ox = part.x || 0
    const oy = part.y || 0
    const oz = part.z || 0
    const opt = extraOpt || {}
    return {
      put(x, y, z, block, extra) { if (block) g.set(x + ox, y + oy, z + oz, block, Object.assign({}, opt, extra || {})) },
      carve(x, y, z) { g.set(x + ox, y + oy, z + oz, 'air') },
      // tylko w puste miejsca (nie psujemy innych czesci)
      soft(x, y, z, block, extra) { const c = g.get(x + ox, y + oy, z + oz); if (!c || c.block === 'air') this.put(x, y, z, block, extra) },
      get(x, y, z) { return g.get(x + ox, y + oy, z + oz) },
      rooms: [],
      room(r) { this.rooms.push(Object.assign({}, r, { x1: r.x1 + ox, x2: r.x2 + ox, z1: r.z1 + oz, z2: r.z2 + oz, y: r.y + oy, keep: (r.keep || []).map(k => { const [a, b] = k.split(',').map(Number); return `${a + ox},${b + oz}` }) })) }
    }
  }

  // ---------- dachy ----------
  // dach dwuspadowy nad prostokatem x1..x2, z1..z2; kalenica wzdluz osi 'z' (szczyty z przodu i z tylu) albo 'x'
  function gableRoof(c, o) {
    const { x1, x2, z1, z2, y, m, gable, axis = 'z', ov = 1, steep = 1 } = o
    const across = axis === 'z' ? [x1, x2] : [z1, z2]
    const along = axis === 'z' ? [z1, z2] : [x1, x2]
    let row = 0
    for (let k = 0; ; k++) {
      const a = across[0] - ov + k
      const b = across[1] + ov - k
      if (a > b) break
      const rows = k === 0 ? 1 : steep
      for (let r = 0; r < rows; r++) {
        const yy = y + row
        const top = r === rows - 1
        for (let t = along[0] - ov; t <= along[1] + ov; t++) {
          const P = (u, blk, ex) => axis === 'z' ? c.put(u, yy, t, blk, ex) : c.put(t, yy, u, blk, ex)
          if (a === b) { P(a, m.full); continue }
          if (top && m.stairs) {
            P(a, m.stairs, { facing: axis === 'z' ? { x: 1, z: 0 } : { x: 0, z: 1 }, alt: m.full })
            P(b, m.stairs, { facing: axis === 'z' ? { x: -1, z: 0 } : { x: 0, z: -1 }, alt: m.full })
          } else { P(a, m.full); P(b, m.full) }
        }
        // szczyty (trojkaty sciany) i pusty strych
        if (k >= 1) {
          for (let u = a + 1; u <= b - 1; u++) {
            for (const t of along) axis === 'z' ? c.put(u, yy, t, gable) : c.put(t, yy, u, gable)
            for (let t = along[0] + 1; t <= along[1] - 1; t++) axis === 'z' ? c.carve(u, yy, t) : c.carve(t, yy, u)
          }
        }
        row++
      }
      if (a === b) break
    }
    return y + row // wysokosc szczytu
  }

  // dach czterospadowy / piramidalny: pierscienie schodow skierowanych do srodka
  function hipRoof(c, o) {
    const { x1, x2, z1, z2, y, m, ov = 1, steep = 1, tip } = o
    let row = 0
    for (let k = 0; ; k++) {
      const a = x1 - ov + k
      const b = x2 + ov - k
      const p = z1 - ov + k
      const q = z2 + ov - k
      if (a > b || p > q) break
      const rows = k === 0 ? 1 : steep
      // szeroki okap: pas pelnych blokow miedzy sciana a krawedzia, zeby okap mial sie o co oprzec
      if (k === 0) for (let j = 1; j < ov; j++) ringRect(a + j, b - j, p + j, q - j, (x, z) => c.put(x, y, z, m.full))
      for (let r = 0; r < rows; r++) {
        const yy = y + row
        const top = r === rows - 1
        if (a === b || p === q) {
          rect(a, b, p, q, (x, z) => c.put(x, yy, z, m.full))
        } else {
          ringRect(a, b, p, q, (x, z) => {
            if (!top || !m.stairs) return c.put(x, yy, z, m.full)
            const f = x === a ? { x: 1, z: 0 } : x === b ? { x: -1, z: 0 } : z === p ? { x: 0, z: 1 } : { x: 0, z: -1 }
            c.put(x, yy, z, m.stairs, { facing: f, alt: m.full })
          })
          if (k >= 1) rect(a + 1, b - 1, p + 1, q - 1, (x, z) => c.carve(x, yy, z))
        }
        row++
      }
      if (a === b || p === q) break
    }
    if (tip) c.put(Math.round((x1 + x2) / 2), y + row, Math.round((z1 + z2) / 2), tip, { optional: true })
    return y + row
  }

  // kopula (polkula) o promieniu r nad (cx, cz)
  function dome(c, o) {
    const { cx, cz, r, y, m, tip } = o
    for (let dy = 0; dy <= r; dy++) {
      const rr = Math.sqrt(Math.max(0, r * r - dy * dy))
      const ci = circle(rr)
      for (const [x, z] of ci.disk) {
        const d = Math.hypot(x, z, dy)
        if (d >= r - 1.05 || ci.ring.some(([a, b]) => a === x && b === z)) c.put(cx + x, y + dy, cz + z, m.full)
        else c.carve(cx + x, y + dy, cz + z)
      }
    }
    if (tip) c.put(cx, y + r + 1, cz, tip, { optional: true })
    return y + r + 1
  }

  // stozek nad okraglym budynkiem: promien maleje co 'rise' warstw
  function cone(c, o) {
    const { cx, cz, r, y, m, rise = 2, tip } = o
    let yy = y
    for (let rr = r; rr >= 0; rr--) {
      for (let k = 0; k < rise; k++) {
        const ci = circle(rr)
        for (const [x, z] of ci.ring) c.put(cx + x, yy, cz + z, m.full)
        for (const [x, z] of ci.disk) if (!ci.ring.some(([a, b]) => a === x && b === z)) c.carve(cx + x, yy, cz + z)
        yy++
        if (rr === 0) break
      }
    }
    if (tip) c.put(cx, yy, cz, tip, { optional: true })
    return yy + 1
  }

  function battlements(c, cells, y, block) {
    for (const [x, z] of cells) if (((x + z) % 2 + 2) % 2 === 0) c.put(x, y, z, block)
  }

  function ladder(c, x, z, y0, y1, attach) {
    for (let y = y0; y <= y1; y++) c.put(x, y, z, 'ladder', { attach })
  }

  // ---------- czesci ----------
  const PARTS = {}

  // DOM: prostokat, pietra, okna, drzwi, dach, komin, ganek, balkon, wieze w rogach
  PARTS.house = (c, o, R) => {
    const w = clamp(o.w ?? 9, 5, 41) | 1
    const d = clamp(o.d ?? 9, 5, 41)
    const F = clamp(o.floors ?? 1, 1, 12)
    const sh = clamp(o.storey ?? 4, 3, 8)
    const x1 = -Math.floor(w / 2)
    const x2 = x1 + w - 1
    const z1 = 0
    const z2 = d - 1
    const top = F * sh - 1
    const wall = mat(o.wall || 'oak')
    const wall2 = mat(o.wall2 || o.wall || 'oak')
    const corner = mat(o.corner || (wall.wood ? (o.wall || 'oak') : o.wall || 'stone_bricks'))
    const cornerBlock = corner.log || corner.pillar || corner.full
    const floorM = mat(o.floor || 'spruce')
    const found = mat(o.foundation || 'cobblestone')
    const roof = Object.assign({ type: 'gable', mat: 'spruce' }, o.roof || {})
    const rm = mat(roof.mat)
    const win = Object.assign({ block: 'glass', every: 2 }, o.windows || {})
    const door = mat(o.doorWood || (wall.wood ? o.wall : 'oak')).door || 'oak_door'

    // fundament i podloga
    rect(x1, x2, z1, z2, (x, z) => c.put(x, -1, z, (x === x1 || x === x2 || z === z1 || z === z2) ? found.full : floorM.full))
    // pietra: powietrze w srodku, stropy
    for (let f = 0; f < F; f++) {
      const y0 = f * sh
      rect(x1 + 1, x2 - 1, z1 + 1, z2 - 1, (x, z) => { for (let y = y0; y < y0 + sh - 1; y++) c.carve(x, y, z) })
      if (f > 0) rect(x1 + 1, x2 - 1, z1 + 1, z2 - 1, (x, z) => c.put(x, y0 - 1, z, floorM.full))
    }
    // sciany (parter z wall, wyzej wall2), rogi z pni/kolumn, opaski miedzy pietrami
    for (let y = 0; y <= top; y++) {
      const storey = Math.min(F - 1, Math.floor(y / sh))
      const wm = storey === 0 ? wall : wall2
      const band = o.trim && y % sh === sh - 1
      ringRect(x1, x2, z1, z2, (x, z) => {
        const isCorner = (x === x1 || x === x2) && (z === z1 || z === z2)
        c.put(x, y, z, isCorner || band ? cornerBlock : wm.full)
      })
    }
    // strop pod dachem
    rect(x1 + 1, x2 - 1, z1 + 1, z2 - 1, (x, z) => c.put(x, top, z, roof.type === 'flat' ? rm.full : floorM.full))

    // okna
    const big = win.style === 'big'
    for (let f = 0; f < F; f++) {
      const y0 = f * sh
      const rows = big ? [y0 + 1, y0 + sh - 2] : (win.tall || sh >= 5) ? [y0 + 1, y0 + 2] : [y0 + 1, y0 + 1]
      const sp = Math.max(2, win.every | 0)
      const along = (a1, a2, cb) => {
        for (let a = a1 + 1; a <= a2 - 1; a++) {
          if (big ? (a - a1) % 4 === 0 : Math.abs(a - Math.round((a1 + a2) / 2)) % sp !== (sp === 2 ? 1 : 0)) continue
          cb(a)
        }
      }
      for (let y = rows[0]; y <= rows[1]; y++) {
        if (win.block === 'none') break
        along(x1, x2, x => {
          if (!(f === 0 && Math.abs(x) <= 1)) c.put(x, y, z1, win.block, { optional: true })
          c.put(x, y, z2, win.block, { optional: true })
        })
        along(z1, z2, z => { c.put(x1, y, z, win.block, { optional: true }); c.put(x2, y, z, win.block, { optional: true }) })
      }
    }
    // drzwi z przodu (i szersza brama w stodole)
    const dw = clamp(o.doorWidth ?? 1, 1, 5)
    if (dw > 1) {
      for (let x = -Math.floor(dw / 2); x <= Math.floor(dw / 2); x++) for (let y = 0; y < Math.min(sh - 1, dw + 1); y++) c.carve(x, y, z1)
    } else {
      c.put(0, 0, z1, door)
      c.carve(0, 1, z1)
    }
    // drabina miedzy pietrami (w prawym tylnym rogu) i pokoje do wystroju
    const lx = x2 - 1
    const lz = z2 - 1
    const terrace = roof.type === 'flat' && o.terrace
    if (F > 1 || terrace) {
      const y1 = terrace ? top : (F - 1) * sh
      ladder(c, lx, lz, 0, y1, { x: 1, z: 0 })
    }
    if (w - 2 >= 3 && d - 2 >= 3) {
      for (let f = 0; f < F; f++) {
        c.room({ x1: x1 + 1, x2: x2 - 1, z1: z1 + 1, z2: z2 - 1, y: f * sh, h: sh - 1, theme: o.theme || 'wood', keep: [`${lx},${lz}`, `${lx},${lz - 1}`, `${lx - 1},${lz}`] })
      }
    }

    // dach
    let peak = top + 1
    const ov = roof.overhang ?? 1
    if (roof.type === 'flat') {
      const par = rm.wall || rm.full
      ringRect(x1, x2, z1, z2, (x, z) => c.put(x, top + 1, z, o.battlements ? null : par))
      if (o.battlements) { const cells = []; ringRect(x1, x2, z1, z2, (x, z) => cells.push([x, z])); battlements(c, cells, top + 1, wall2.full) }
      if (terrace) c.carve(lx, top, lz)
      peak = top + 2
    } else if (roof.type === 'hip' || roof.type === 'pyramid') {
      peak = hipRoof(c, { x1, x2, z1, z2, y: top, m: rm, ov, steep: roof.steep || 1, tip: roof.tip })
    } else if (roof.type === 'dome') {
      const r = Math.floor(Math.min(w, d) / 2)
      peak = dome(c, { cx: 0, cz: Math.round((z1 + z2) / 2), r, y: top + 1, m: rm, tip: roof.tip })
    } else if (roof.type !== 'none') {
      const axis = roof.axis || (w > d + 2 ? 'x' : 'z')
      peak = gableRoof(c, { x1, x2, z1, z2, y: top, m: rm, gable: wall2.full, axis, ov, steep: roof.steep || 1 })
    }
    // dachy na kazdym pietrze (pagoda): okap ze schodow wokol scian
    if (o.pagoda && F > 1) {
      for (let f = 1; f < F; f++) {
        const y = f * sh - 1
        ringRect(x1 - 1, x2 + 1, z1 - 1, z2 + 1, (x, z) => {
          const fc = x === x1 - 1 ? { x: 1, z: 0 } : x === x2 + 1 ? { x: -1, z: 0 } : z === z1 - 1 ? { x: 0, z: 1 } : { x: 0, z: -1 }
          c.put(x, y, z, rm.stairs || rm.full, rm.stairs ? { facing: fc, alt: rm.full } : {})
        })
      }
    }
    // komin z cegly przy tylnej scianie
    if (o.chimney) {
      const cx = x1 + 2
      for (let y = 0; y <= peak + 1; y++) c.put(cx, y, z2, 'bricks')
      c.put(cx, peak + 2, z2, 'campfire', { optional: true })
    }
    // ganek przed drzwiami: podloga, slupki, daszek, latarnia
    if (o.porch) {
      const pw = Math.min(3, Math.floor(w / 2) - 1)
      rect(-pw, pw, -3, -1, (x, z) => { c.put(x, -1, z, floorM.full); for (let y = 0; y < 3; y++) c.carve(x, y, z) })
      for (const [x, z] of [[-pw, -3], [pw, -3]]) for (let y = 0; y < 3; y++) c.put(x, y, z, cornerBlock)
      rect(-pw - 1, pw + 1, -4, -1, (x, z) => c.put(x, 3, z, rm.full))
      c.put(0, 2, -2, 'lantern', { attach: { x: 0, y: 1, z: 0 }, optional: true })
    }
    // kolumnada (portyk) przed frontem
    if (o.columns) {
      const pm = mat(o.columns === true ? (o.wall || 'quartz') : o.columns)
      rect(x1, x2, -3, -1, (x, z) => { c.put(x, -1, z, found.full); for (let y = 0; y < top; y++) c.carve(x, y, z) })
      for (let x = x1; x <= x2; x += 2) for (let y = 0; y < top; y++) c.put(x, y, -3, pm.pillar)
      rect(x1, x2, -3, -1, (x, z) => c.put(x, top, z, wall2.full))
    }
    // balkon na pierwszym pietrze
    if (o.balcony && F > 1) {
      const y = sh - 1
      rect(-2, 2, -2, -1, (x, z) => c.put(x, y, z, floorM.full))
      for (let x = -2; x <= 2; x++) c.put(x, y + 1, -2, (rm.wood ? rm.fence : null) || 'oak_fence')
      c.put(-2, y + 1, -1, 'oak_fence')
      c.put(2, y + 1, -1, 'oak_fence')
      c.carve(0, y + 1, 0)
      c.carve(0, y + 2, 0)
    }
    // wieze w rogach (okragle, wyzsze od domu)
    if (o.towers) {
      const n = clamp(o.towers === true ? 4 : o.towers, 1, 4)
      const corners = [[x1, z1], [x2, z1], [x1, z2], [x2, z2]].slice(0, n === 2 ? 2 : n)
      for (const [cx, cz] of corners) {
        PARTS.tower(ctxFor(c._g, { x: cx + (c._ox || 0), z: cz - 2 + (c._oz || 0) }), {
          shape: 'round', size: 5, h: top + 5, mat: o.towerMat || o.wall2 || o.wall || 'stone_bricks',
          roof: { type: o.towerRoof || 'cone', mat: roof.mat }, door: 'none', windows: true
        }, R)
      }
    }
    return { peak }
  }

  // WIEZA: kwadratowa lub okragla, okna-szczeliny, drabina w srodku, dach
  PARTS.tower = (c, o, R) => {
    const round = o.shape === 'round'
    const size = clamp(o.size ?? 5, 3, 25) | 1
    const r = (size - 1) / 2
    const h = clamp(o.h ?? 14, 4, 120)
    const m = mat(o.mat || 'stone_bricks')
    const m2 = o.mat2 ? mat(o.mat2) : null
    const roof = Object.assign({ type: 'battlements', mat: o.mat || 'stone_bricks' }, o.roof || {})
    const rm = mat(roof.mat)
    const cz = r // srodek: front wiezy na z = 0
    const ci = round ? circle(r) : null
    const isRing = (x, z) => round ? ci.ring.some(([a, b]) => a === x && b - 0 === z) : (Math.abs(x) === r || Math.abs(z) === r)
    const cells = round ? ci.disk : (() => { const a = []; rect(-r, r, -r, r, (x, z) => a.push([x, z])); return a })()
    const ringCells = cells.filter(([x, z]) => isRing(x, z))
    for (const [x, z] of cells) c.put(x, -1, z + cz, m.full)
    for (let y = 0; y < h; y++) {
      const stripe = m2 && Math.floor(y / 3) % 2 === 1
      for (const [x, z] of cells) {
        if (isRing(x, z)) c.put(x, y, z + cz, stripe ? m2.full : m.full)
        else c.carve(x, y, z + cz)
      }
    }
    // podloga na szczycie
    for (const [x, z] of cells) if (!isRing(x, z)) c.put(x, h - 1, z + cz, m.full)
    // okna-szczeliny co 4 bloki na 4 strony
    if (o.windows !== false && r >= 1) {
      for (let y = 3; y < h - 2; y += 4) {
        for (const [x, z] of [[0, -r], [0, r], [-r, 0], [r, 0]]) c.put(x, y, z + cz, o.glass || 'glass', { optional: true })
      }
    }
    // drzwi
    const doorSide = o.door === undefined ? 'front' : o.door
    const sides = { front: [0, -r], back: [0, r], left: [-r, 0], right: [r, 0] }
    if (sides[doorSide] && r >= 1) {
      const [dx, dz] = sides[doorSide]
      c.carve(dx, 0, dz + cz)
      c.carve(dx, 1, dz + cz)
    }
    // drabina przy scianie naprzeciw drzwi
    if (r >= 1) {
      const opp = { front: [0, r - 1, { x: 0, z: 1 }], back: [0, -r + 1, { x: 0, z: -1 }], left: [r - 1, 0, { x: 1, z: 0 }], right: [-r + 1, 0, { x: -1, z: 0 }] }[sides[doorSide] ? doorSide : 'front']
      ladder(c, opp[0], opp[1] + cz, 0, h - 1, opp[2])
      c.room && r >= 2 && c.room({ x1: -r + 1, x2: r - 1, z1: -r + 1 + cz, z2: r - 1 + cz, y: 0, h: Math.min(4, h - 1), theme: o.theme || 'wood', bed: false, keep: [`${opp[0]},${opp[1] + cz}`] })
    }
    // dach
    let peak = h
    if (roof.type === 'cone' || (round && (roof.type === 'pyramid' || roof.type === 'spire'))) {
      peak = cone(c, { cx: 0, cz, r: r + 1, y: h, m: rm, rise: roof.type === 'spire' ? 3 : 2, tip: roof.tip || (roof.type === 'spire' ? 'lightning_rod' : null) })
    } else if (roof.type === 'pyramid' || roof.type === 'spire') {
      peak = hipRoof(c, { x1: -r, x2: r, z1: cz - r, z2: cz + r, y: h, m: rm, ov: 1, steep: roof.type === 'spire' ? 3 : 1, tip: roof.tip || (roof.type === 'spire' ? 'lightning_rod' : null) })
    } else if (roof.type === 'dome') {
      peak = dome(c, { cx: 0, cz, r: r + 1, y: h, m: rm, tip: roof.tip })
    } else if (roof.type === 'flat') {
      for (const [x, z] of ringCells) c.put(x, h, z + cz, m.wall || m.fence || 'oak_fence')
      peak = h + 1
    } else {
      battlements(c, ringCells.map(([x, z]) => [x, z + cz]), h, m.full)
      peak = h + 1
    }
    return { peak }
  }

  // MURY obronne: prostokat z blankami i brama z przodu
  PARTS.walls = (c, o) => {
    const W = clamp(o.w ?? 21, 7, 99) | 1
    const D = clamp(o.d ?? 21, 7, 99)
    const h = clamp(o.h ?? 6, 3, 30)
    const m = mat(o.mat || 'stone_bricks')
    const x1 = -Math.floor(W / 2)
    const x2 = x1 + W - 1
    const ring = []
    ringRect(x1, x2, 0, D - 1, (x, z) => ring.push([x, z]))
    for (const [x, z] of ring) { c.put(x, -1, z, m.full); for (let y = 0; y < h; y++) c.put(x, y, z, m.full) }
    battlements(c, ring, h, m.full)
    if (o.gate !== false) for (let x = -1; x <= 1; x++) for (let y = 0; y < Math.min(4, h - 1); y++) c.carve(x, y, 0)
    // drabiny na mury od srodka
    ladder(c, x1 + 1, Math.floor(D / 2), 0, h - 1, { x: -1, z: 0 })
    ladder(c, x2 - 1, Math.floor(D / 2), 0, h - 1, { x: 1, z: 0 })
    return { peak: h + 1 }
  }

  // ZAMEK: mury, 4 wieze w rogach, donzon z tylu, latarnie na dziedzincu
  PARTS.castle = (c, o, R, g, part) => {
    const W = clamp(o.w ?? 23, 11, 99) | 1
    const D = clamp(o.d ?? 23, 11, 99)
    const h = clamp(o.h ?? 7, 4, 30)
    const m = o.mat || 'stone_bricks'
    const round = o.towerShape === 'round'
    const ts = clamp(o.towerSize ?? (W >= 31 ? 7 : 5), 3, 11) | 1
    const th = clamp(o.towerH ?? h + 6, h + 2, 80)
    const towerRoof = { type: o.towerRoof || 'battlements', mat: o.roofMat || m, tip: o.towerRoof === 'cone' || o.towerRoof === 'spire' ? 'lightning_rod' : null }
    const x1 = -Math.floor(W / 2)
    const x2 = x1 + W - 1
    PARTS.walls(c, { w: W, d: D, h, mat: m })
    const n = clamp(o.towers ?? 4, 0, 8)
    const spots = [[x1, 0, 'back'], [x2, 0, 'back'], [x1, D - 1, 'front'], [x2, D - 1, 'front'], [0, D - 1, 'front'], [x1, Math.floor(D / 2), 'right'], [x2, Math.floor(D / 2), 'left'], [-4, 0, 'back']].slice(0, n)
    const half = (ts - 1) / 2
    for (const [cx, cz, door] of spots) {
      const sub = ctxFor(g, { x: (part.x || 0) + cx, y: part.y || 0, z: (part.z || 0) + cz - half })
      sub.rooms = c.rooms
      PARTS.tower(sub, { shape: round ? 'round' : 'square', size: ts, h: th, mat: m, roof: towerRoof, door }, R)
    }
    // donzon (wieza mieszkalna) z tylu dziedzinca
    if (o.keep !== false && W >= 15) {
      const kw = Math.min(11, W - 8) | 1
      const kd = Math.min(9, Math.floor(D / 2) - 2)
      const sub = ctxFor(g, { x: part.x || 0, y: part.y || 0, z: (part.z || 0) + D - 2 - kd })
      sub.rooms = c.rooms
      PARTS.house(sub, { w: kw, d: kd, floors: 2, storey: 5, wall: m, corner: m, floor: 'spruce', foundation: m, roof: { type: o.keepRoof || 'flat', mat: o.roofMat || m }, battlements: (o.keepRoof || 'flat') === 'flat', windows: { block: 'glass', every: 2 } }, R)
    }
    // latarnie na slupkach przy bramie
    for (const x of [-3, 3]) { c.put(x, 0, 2, 'oak_fence'); c.put(x, 1, 2, 'oak_fence'); c.put(x, 2, 2, 'lantern', { optional: true }) }
    return { peak: th + 4 }
  }

  // KOSCIOL: nawa z wysokimi oknami z witrazy, dzwonnica z iglica z przodu, lawki
  PARTS.church = (c, o, R, g, part) => {
    const w = clamp(o.w ?? 9, 7, 31) | 1
    const d = clamp(o.d ?? 17, 9, 61)
    const sh = clamp(o.h ?? 7, 5, 14)
    const wall = o.wall || 'stone_bricks'
    const glass = o.glass || 'light_blue_stained_glass'
    c.carve(0, 0, -5) // miejsce przed dzwonnica
    PARTS.house(c, { w, d, floors: 1, storey: sh, wall, corner: o.corner || wall, floor: 'polished_andesite', foundation: wall, roof: { type: 'gable', mat: o.roofMat || 'deepslate_tiles', steep: 2, axis: 'z' }, windows: { block: glass, tall: true, every: 2 }, doorWood: 'dark_oak' }, R)
    // lawki (schody tylem do wejscia) i oltarz
    for (let z = 3; z <= d - 5; z += 2) {
      for (let x = -Math.floor(w / 2) + 1; x <= Math.floor(w / 2) - 1; x++) if (Math.abs(x) > 1) c.put(x, 0, z, 'spruce_stairs', { facing: { x: 0, z: -1 }, optional: true })
    }
    c.put(0, 0, d - 3, 'chiseled_stone_bricks')
    c.put(0, 1, d - 3, 'candle', { optional: true })
    // dzwonnica przed nawa
    const sub = ctxFor(g, { x: part.x || 0, y: part.y || 0, z: (part.z || 0) - 4 })
    sub.rooms = c.rooms
    PARTS.tower(sub, { shape: 'square', size: 5, h: sh + 8, mat: wall, roof: { type: 'spire', mat: o.roofMat || 'deepslate_tiles' }, door: 'front', glass }, R)
    for (let y = 0; y < 2; y++) c.carve(0, y, 0)
    return {}
  }

  // PIRAMIDA: schodkowa, wydrazona, z wejsciem i komnata
  PARTS.pyramid = (c, o) => {
    const B = clamp(o.size ?? 21, 7, 81) | 1
    const m = mat(o.mat || 'sandstone')
    const R0 = (B - 1) / 2
    const cz = R0
    let y = 0
    for (let k = 0; R0 - k >= 0; k++, y++) {
      const r = R0 - k
      rect(-r, r, -r, r, (x, z) => {
        const edge = Math.max(Math.abs(x), Math.abs(z))
        if (edge >= r - 1 || r <= 2) c.put(x, y, z + cz, m.full)
        else c.carve(x, y, z + cz)
      })
    }
    rect(-R0, R0, -R0, R0, (x, z) => c.put(x, -1, z + cz, m.full))
    c.put(0, y, cz, o.tip || 'gold_block')
    for (let z = 0; z <= 3; z++) for (let yy = 0; yy < 3; yy++) for (let x = -1; x <= 1; x++) c.carve(x, yy, z)
    c.put(0, 0, cz, 'chest', { optional: true })
    return { peak: y + 1 }
  }

  // LATARNIA MORSKA: okragla wieza w pasy, galeria z barierka, szklana laterna ze swiatlem, stozkowy dach
  PARTS.lighthouse = (c, o, R) => {
    const r = clamp(o.r ?? 3, 2, 8)
    const h = clamp(o.h ?? 18, 8, 80)
    const size = r * 2 + 1
    PARTS.tower(c, { shape: 'round', size, h, mat: o.mat || 'white_concrete', mat2: o.mat2 || 'red_concrete', roof: { type: 'flat' }, windows: true }, R)
    const ci = circle(r + 1)
    for (const [x, z] of ci.disk) c.put(x, h - 1, z + r, mat(o.mat || 'white_concrete').full)
    for (const [x, z] of ci.ring) c.put(x, h, z + r, 'iron_bars')
    const inner = circle(Math.max(1, r - 1))
    for (let y = h; y < h + 3; y++) {
      for (const [x, z] of inner.disk) {
        const ring = inner.ring.some(([a, b]) => a === x && b === z)
        if (ring) c.put(x, y, z + r, 'glass', { optional: true })
        else c.carve(x, y, z + r)
      }
    }
    c.put(0, h, r, o.light || 'glowstone')
    const top = cone(c, { cx: 0, cz: r, r: Math.max(1, r - 1), y: h + 3, m: mat(o.roofMat || 'red_concrete'), rise: 1 })
    return { peak: top }
  }

  // WIATRAK: budynek z kamiennym parterem, dach, smigla na froncie
  PARTS.windmill = (c, o, R) => {
    const w = clamp(o.w ?? 7, 5, 15) | 1
    const h = clamp(o.h ?? 10, 6, 30)
    PARTS.house(c, { w, d: w, floors: 1, storey: h, wall: o.wall || 'cobblestone', wall2: o.wall || 'cobblestone', corner: o.corner || 'spruce', floor: 'spruce', roof: { type: 'pyramid', mat: o.roofMat || 'dark_oak' }, windows: { block: 'glass', every: 3 } }, R)
    // wyzsza czesc z desek
    const x1 = -Math.floor(w / 2)
    for (let y = 4; y < h; y++) ringRect(x1, x1 + w - 1, 0, w - 1, (x, z) => { const cur = c.get(x, y, z); if (cur && /cobblestone/.test(cur.block)) c.put(x, y, z, mat(o.wall2 || 'spruce').full) })
    // smigla: piasta i 4 ramiona z zaglami (w plaszczyznie z = -2)
    const hub = h - 3
    const L = clamp(o.blade ?? Math.min(6, hub - 1), 3, 12)
    const arm = mat(o.armMat || 'spruce').full
    const sail = o.sail || 'white_wool'
    c.put(0, hub, -1, 'oak_log')
    c.put(0, hub, -2, 'oak_log')
    for (let i = 1; i <= L; i++) {
      c.put(0, hub + i, -2, arm); if (i > 1) c.put(1, hub + i, -2, sail, { optional: true })
      c.put(i, hub, -2, arm); if (i > 1) c.put(i, hub - 1, -2, sail, { optional: true })
      c.put(0, hub - i, -2, arm); if (i > 1) c.put(-1, hub - i, -2, sail, { optional: true })
      c.put(-i, hub, -2, arm); if (i > 1) c.put(-i, hub + 1, -2, sail, { optional: true })
    }
    return {}
  }

  // MOST: poklad z desek, krawedzie z pni, barierki, latarnie, filary
  PARTS.bridge = (c, o) => {
    const L = clamp(o.length ?? 21, 5, 151)
    const w = clamp(o.w ?? 5, 3, 15) | 1
    const m = mat(o.mat || 'spruce')
    const r = (w - 1) / 2
    for (let z = 0; z < L; z++) {
      for (let x = -r; x <= r; x++) {
        c.put(x, -1, z, Math.abs(x) === r ? (m.log || m.pillar || m.full) : m.full)
        c.carve(x, 0, z); c.carve(x, 1, z)
      }
      c.put(-r, 0, z, m.fence || m.wall || 'oak_fence')
      c.put(r, 0, z, m.fence || m.wall || 'oak_fence')
    }
    for (let z = 0; z < L; z += 6) {
      for (const x of [-r, r]) { c.put(x, 1, z, m.fence || 'oak_fence'); c.put(x, 2, z, 'lantern', { optional: true }) }
      for (const x of [-r, r]) for (let y = -2; y >= -5; y--) c.put(x, y, z, mat(o.pillar || 'stone_bricks').full)
    }
    return {}
  }

  // STUDNIA: kamienna cembrowina, dziura, slupki i daszek
  PARTS.well = (c, o) => {
    const m = mat(o.mat || 'cobblestone')
    const rm = mat(o.roofMat || 'oak')
    ringRect(-2, 2, 0, 4, (x, z) => { c.put(x, -1, z, m.full); c.put(x, 0, z, m.full) })
    rect(-1, 1, 1, 3, (x, z) => { for (let y = -4; y <= 0; y++) c.carve(x, y, z) })
    for (const [x, z] of [[-2, 0], [2, 0], [-2, 4], [2, 4]]) { c.put(x, 1, z, rm.fence || 'oak_fence'); c.put(x, 2, z, rm.fence || 'oak_fence') }
    hipRoof(c, { x1: -2, x2: 2, z1: 0, z2: 4, y: 3, m: rm, ov: 0 })
    c.put(0, 2, 2, 'lantern', { attach: { x: 0, y: 1, z: 0 }, optional: true })
    return {}
  }

  // ALTANA: osmiokatna podloga, slupki, dach, lawki
  PARTS.gazebo = (c, o) => {
    const r = clamp(o.r ?? 4, 3, 8)
    const m = mat(o.mat || 'oak')
    const rm = mat(o.roofMat || 'dark_oak')
    const ci = circle(r)
    for (const [x, z] of ci.disk) { c.put(x, -1, z + r, m.full); for (let y = 0; y < 3; y++) c.carve(x, y, z + r) }
    for (const [x, z] of ci.ring) if (Math.abs(x) === r || Math.abs(z) === r || (Math.abs(Math.abs(x) - Math.abs(z)) <= 1 && Math.abs(x) >= r - 2)) {
      if (x === 0 && z === -r) continue
      for (let y = 0; y < 3; y++) c.put(x, y, z + r, m.fence || 'oak_fence')
    }
    for (let k = 0; r + 1 - k >= 0; k++) {
      const cc = circle(r + 1 - k)
      for (const [x, z] of cc.ring) c.put(x, 3 + k, z + r, rm.full)
      if (r + 1 - k <= 0) break
    }
    c.put(0, 2, r, 'lantern', { attach: { x: 0, y: 1, z: 0 }, optional: true })
    return {}
  }

  // IGLOO: kopula ze sniegu z wejsciem
  PARTS.igloo = (c, o) => {
    const r = clamp(o.r ?? 4, 3, 9)
    const m = mat(o.mat || 'snow')
    for (const [x, z] of circle(r).disk) c.put(x, -1, z + r + 2, m.full)
    dome(c, { cx: 0, cz: r + 2, r, y: 0, m })
    for (let z = 0; z <= 2; z++) { c.put(-1, 0, z, m.full); c.put(1, 0, z, m.full); c.put(-1, 1, z, m.full); c.put(1, 1, z, m.full); c.put(0, 2, z, m.full); c.carve(0, 0, z); c.carve(0, 1, z); c.put(0, -1, z, m.full) }
    c.carve(0, 0, 3); c.carve(0, 1, 3)
    c.put(0, 0, r + 2, 'lantern', { optional: true })
    return {}
  }

  // STODOLA: duza brama, wysoki stromy dach
  PARTS.barn = (c, o, R) => PARTS.house(c, Object.assign({ w: 11, d: 15, floors: 1, storey: 6, wall: 'spruce', corner: 'dark_oak', doorWidth: 3, roof: { type: 'gable', mat: 'dark_oak', steep: 2, axis: 'z' }, windows: { block: 'glass', every: 4 } }, o), R)

  // WIEZOWIEC: szklane sciany, stropy co pietro, plaski dach z antena
  PARTS.skyscraper = (c, o, R) => {
    const res = PARTS.house(c, Object.assign({ w: 11, d: 11, floors: 10, storey: 4, wall: 'light_gray_concrete', corner: 'gray_concrete', floor: 'smooth_stone', foundation: 'smooth_stone', trim: true, roof: { type: 'flat', mat: 'smooth_stone' }, windows: { block: 'glass', style: 'big' }, terrace: true }, o), R)
    const top = (o.floors || 10) * (o.storey || 4) - 1
    for (let y = top + 1; y < top + 6; y++) c.put(0, y, Math.floor((o.d || 11) / 2), 'iron_bars')
    c.put(0, top + 6, Math.floor((o.d || 11) / 2), 'lightning_rod')
    return res
  }

  // ARENA: okragle trybuny ze schodow i mur z lukami
  PARTS.arena = (c, o) => {
    const r = clamp(o.r ?? 12, 7, 40)
    const m = mat(o.mat || 'stone_bricks')
    const cz = r + 1
    const field = circle(r - 4)
    for (const [x, z] of field.disk) { c.put(x, -1, z + cz, 'sand'); c.carve(x, 0, z + cz); c.carve(x, 1, z + cz) }
    for (let t = 0; t < 4; t++) {
      const rr = r - 3 + t
      const ci = circle(rr)
      for (const [x, z] of ci.ring) {
        for (let y = -1; y < t; y++) c.put(x, y, z + cz, m.full)
        const len = Math.hypot(x, z) || 1
        const f = Math.abs(x) > Math.abs(z) ? { x: x > 0 ? 1 : -1, z: 0 } : { x: 0, z: z > 0 ? 1 : -1 }
        c.put(x, t, z + cz, m.stairs || m.full, m.stairs ? { facing: f, alt: m.full } : {})
        void len
      }
    }
    const outer = circle(r + 1)
    for (const [x, z] of outer.ring) {
      for (let y = -1; y < 6; y++) c.put(x, y, z + cz, m.full)
      const ang = Math.atan2(z, x)
      if (Math.round(ang * 8 / Math.PI) % 2 === 0) { c.carve(x, 0, z + cz); c.carve(x, 1, z + cz); c.carve(x, 2, z + cz) }
    }
    battlements(c, outer.ring.map(([x, z]) => [x, z + cz]), 6, m.full)
    for (let z = -1; z <= 4; z++) for (let x = -1; x <= 1; x++) for (let y = 0; y < 3; y++) c.carve(x, y, z)
    return {}
  }

  // PLOT / OGROD wokol prostokata z furtka z przodu, opcjonalnie kwiaty i sciezka
  PARTS.fence = (c, o) => {
    const x1 = o.x1 ?? -6
    const x2 = o.x2 ?? 6
    const z1 = o.z1 ?? -3
    const z2 = o.z2 ?? 12
    const m = mat(o.mat || 'oak')
    const fence = m.fence || m.wall || 'oak_fence'
    ringRect(x1, x2, z1, z2, (x, z) => c.soft(x, 0, z, (x === 0 && z === z1) ? (m.gate || 'oak_fence_gate') : fence))
    if (o.flowers) {
      const fl = ['poppy', 'dandelion', 'cornflower', 'azure_bluet', 'oxeye_daisy', 'allium']
      let i = 0
      ringRect(x1 + 1, x2 - 1, z1 + 1, z2 - 1, (x, z) => { if ((x + z) % 3 === 0 && !(Math.abs(x) <= 1 && z < 0)) c.soft(x, 0, z, fl[i++ % fl.length], { optional: true }) })
    }
    if (o.path !== false) for (let z = z1; z < 0; z++) c.put(0, -1, z, o.pathBlock || 'cobblestone')
    if (o.lamps) for (const x of [-2, 2]) { c.soft(x, 0, z1, fence); c.soft(x, 1, z1, fence); c.soft(x, 2, z1, 'lantern', { optional: true }) }
    return {}
  }

  // DRZEWO: pien i korona z lisci
  PARTS.tree = (c, o) => {
    const wood = o.wood || 'oak'
    const h = clamp(o.h ?? 5, 3, 12)
    for (let y = 0; y < h; y++) c.put(0, y, 0, mat(wood).log || 'oak_log')
    for (let y = h - 2; y <= h + 1; y++) {
      const r = y >= h ? 1 : 2
      rect(-r, r, -r, r, (x, z) => { if ((x || z || y > h - 1) && !(Math.abs(x) === r && Math.abs(z) === r && r === 2)) c.soft(x, y, z, wood + '_leaves', { optional: true }) })
    }
    return {}
  }

  PARTS.lamp = (c, o) => {
    const h = clamp(o.h ?? 3, 1, 8)
    for (let y = 0; y < h; y++) c.put(0, y, 0, o.post || 'oak_fence')
    c.put(0, h, 0, o.light || 'lantern', { optional: true })
    return {}
  }

  // PROSTE BRYLY dla AI: prostopadloscian (pelny lub pusty), walec, kula
  PARTS.box = (c, o) => {
    const w = clamp(o.w ?? 3, 1, 99)
    const d = clamp(o.d ?? 3, 1, 99)
    const h = clamp(o.h ?? 3, 1, 99)
    const b = mat(o.block || o.mat || 'stone_bricks').full
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
          const shell = x === 0 || z === 0 || x === w - 1 || z === d - 1 || y === 0 || y === h - 1
          if (o.hollow && !shell) c.carve(x, y, z)
          else c.put(x, y, z, b)
        }
      }
    }
    return {}
  }
  PARTS.cylinder = (c, o) => {
    const r = clamp(o.r ?? 3, 1, 40)
    const h = clamp(o.h ?? 5, 1, 120)
    const b = mat(o.block || o.mat || 'stone_bricks').full
    const ci = circle(r)
    for (let y = 0; y < h; y++) {
      for (const [x, z] of ci.disk) {
        const ring = ci.ring.some(([a, q]) => a === x && q === z)
        if (o.hollow && !ring && y > 0) c.carve(x, y, z)
        else c.put(x, y, z, b)
      }
    }
    return {}
  }
  PARTS.sphere = (c, o) => {
    const r = clamp(o.r ?? 4, 1, 30)
    const b = mat(o.block || o.mat || 'glass').full
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        for (let z = -r; z <= r; z++) {
          const dd = Math.hypot(x, y, z)
          if (dd > r + 0.45) continue
          if (o.hollow && dd < r - 0.6) c.carve(x, y + r, z)
          else c.put(x, y + r, z, b)
        }
      }
    }
    return {}
  }

  // VOXELE (rzezby, posagi, dowolne ksztalty): warstwy od dolu, kazda to wiersze tekstu.
  // palette: { "Y": "yellow_wool", "B": "black_wool" }, "." albo " " - pusto, "_" - wymuszone powietrze.
  // layers: [ { y: 0, rows: ["..YY..", ".YYYY."] } ] - wiersz = z (od przodu), znak = x (srodek wiersza na x = 0)
  PARTS.voxels = (c, o) => {
    const pal = o.palette || {}
    const layers = Array.isArray(o.layers) ? o.layers : []
    layers.forEach((L, i) => {
      const y = Number.isFinite(L.y) ? L.y : i
      const rows = Array.isArray(L.rows) ? L.rows : []
      rows.forEach((row, z) => {
        const s = String(row)
        const off = Math.floor(s.length / 2)
        for (let k = 0; k < s.length; k++) {
          const ch = s[k]
          if (ch === '.' || ch === ' ') continue
          if (ch === '_') { c.carve(k - off, y, z); continue }
          const b = pal[ch]
          if (b) c.put(k - off, y, z, mat(b).full === b ? b : (valid(b) ? b : mat(b).full))
        }
      })
    })
    if (Array.isArray(o.blocks)) for (const b of o.blocks.slice(0, 20000)) if (Array.isArray(b) && b.length >= 4) c.put(b[0] | 0, b[1] | 0, b[2] | 0, String(b[3]))
    return {}
  }

  // ---------- podpory: bot buduje warstwami od dolu, a blok musi miec sie o co oprzec ----------
  const NO_SUPPORT = /^(air|torch|wall_torch|lantern|soul_lantern|ladder|.*_carpet|.*_button|.*_pressure_plate|lever|rail|.*_sapling|poppy|dandelion|cornflower|azure_bluet|oxeye_daisy|allium|short_grass|candle|.*_candle)$/
  function addSupports(g, warnings) {
    const cells = g.cells().filter(c => c.block !== 'air')
    if (!cells.length) return
    const minY = Math.min(...cells.map(c => c.y))
    const placed = new Set()
    const key = (x, y, z) => x + ',' + y + ',' + z
    const solid = c => c && c.block !== 'air' && !c.temp
    const layers = [...new Set(cells.map(c => c.y))].sort((a, b) => a - b)
    let temps = 0
    let fills = 0
    for (const y of layers) {
      let pending = g.cells().filter(c => c.y === y && c.block !== 'air')
      // ziemia: najnizsza warstwa i wszystko do y = 0 stoi na gruncie
      let changed = true
      while (changed && pending.length) {
        changed = false
        const next = []
        for (const c of pending) {
          const ok = y <= Math.max(minY, 0) || [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => placed.has(key(c.x + dx, c.y + dy, c.z + dz)))
          if (ok) { if (!NO_SUPPORT.test(c.block)) placed.add(key(c.x, c.y, c.z)); changed = true } else next.push(c)
        }
        pending = next
      }
      // nie ma oparcia: najpierw probujemy jednym blokiem pod spodem, opartym o cos obok (dach, kopula, stozek)
      const still = []
      for (const c of pending) {
        const below = g.get(c.x, c.y - 1, c.z)
        const fillBlock = c.alt || (!NO_SUPPORT.test(c.block) && !/(_stairs|_slab|fence|_wall$|_door|ladder|bars|rod)$/.test(c.block) ? c.block : null)
        const sideOk = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => placed.has(key(c.x + dx, c.y - 1, c.z + dz))) || placed.has(key(c.x, c.y - 2, c.z))
        if (fillBlock && (!below || below.block === 'air') && sideOk) {
          g.set(c.x, c.y - 1, c.z, fillBlock, { fill: true })
          placed.add(key(c.x, c.y - 1, c.z))
          placed.add(key(c.x, c.y, c.z))
          fills++
          continue
        }
        still.push(c)
      }
      // nadal nie ma oparcia: tymczasowy slupek z ziemi do najblizszego bloku pod spodem (bot go potem usunie)
      for (const c of still) {
        let yy = c.y - 1
        while (yy >= Math.max(minY, 0) && !solid(g.get(c.x, yy, c.z))) {
          g.set(c.x, yy, c.z, 'dirt', { temp: true })
          placed.add(key(c.x, yy, c.z))
          temps++
          yy--
        }
        placed.add(key(c.x, c.y, c.z))
      }
    }
    void fills
    if (temps) warnings.push(`Dodalem ${temps} blokow tymczasowych podpor (bot postawi je z ziemi i potem usunie).`)
  }

  // ---------- generowanie ----------
  const LIMIT = 60000
  function generate(spec) {
    const g = new Grid()
    const warnings = []
    const rooms = []
    const parts = Array.isArray(spec && spec.parts) ? spec.parts : []
    const R = rng(spec && spec.seed)
    for (const part of parts) {
      const fn = PARTS[part.kind]
      if (!fn) { warnings.push(`Nieznana czesc: ${part.kind}`); continue }
      const c = ctxFor(g, part)
      c._g = g
      c._ox = part.x || 0
      c._oz = part.z || 0
      try { fn(c, part, R, g, part) } catch (e) { warnings.push(`Blad w czesci ${part.kind}: ${e.message}`) }
      rooms.push(...c.rooms)
      if (g.m.size > LIMIT) { warnings.push('Budowla jest za duza - ucialem reszte.'); break }
    }
    // nieznane bloki zamieniamy na kamienne cegly
    const bad = new Set()
    for (const c of g.cells()) if (c.block !== 'air' && !valid(c.block)) { bad.add(c.block); c.block = 'stone_bricks' }
    if (bad.size) warnings.push('Nie znam blokow: ' + [...bad].slice(0, 8).join(', ') + ' - zamienione na kamienne cegly.')
    for (const c of g.cells()) if (c.alt && !valid(c.alt)) delete c.alt
    addSupports(g, warnings)
    const cells = g.cells()
    const solid = cells.filter(c => c.block !== 'air')
    const xs = solid.map(c => c.x)
    const ys = solid.map(c => c.y)
    const zs = solid.map(c => c.z)
    const bounds = solid.length
      ? { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys), z1: Math.min(...zs), z2: Math.max(...zs) }
      : { x1: 0, x2: 0, y1: 0, y2: 0, z1: 0, z2: 0 }
    return {
      cells,
      rooms,
      bounds,
      size: { w: bounds.x2 - bounds.x1 + 1, h: bounds.y2 - bounds.y1 + 1, d: bounds.z2 - bounds.z1 + 1 },
      materials: materialsOf(cells),
      // bot stoi 3 bloki przed najbardziej wysunieta czescia budowli
      ahead: 3 + Math.max(0, -bounds.z1),
      warnings
    }
  }

  function materialsOf(cells) {
    const m = {}
    for (const c of cells) if (c.block !== 'air' && !c.temp) m[c.block] = (m[c.block] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }

  // bloki, ktore bot w survivalu zdobedzie sam (reszte trzeba mu dac albo budowac w kreatywnym)
  const EASY = /^(cobblestone(_stairs|_slab|_wall)?|stone(_stairs|_slab)?|stone_bricks?|stone_brick_(stairs|slab|wall)|chiseled_stone_bricks|smooth_stone(_slab)?|.*_planks|.*_log|.*_stairs|.*_slab|.*_fence|.*_fence_gate|.*_door|ladder|torch|lantern|glass|glass_pane|crafting_table|furnace|chest|barrel|dirt|sand|sandstone|cut_sandstone|gravel|bricks|brick_stairs|brick_wall|campfire|oak_leaves|white_wool|hay_block|iron_bars|bookshelf|.*_bed|poppy|dandelion|cornflower|azure_bluet|oxeye_daisy|allium)$/
  const HARD_WOOD = /(crimson|warped)/
  const isEasy = b => EASY.test(b) && !HARD_WOOD.test(b) && !/(nether|blackstone|deepslate|prismarine|purpur|end_stone|quartz|tuff|mud|copper|granite|diorite|andesite|red_sandstone|mossy)/.test(b)

  // ---------- kolory do podgladu ----------
  const HEX = {
    stone: '#7d7d7d', cobblestone: '#7a7a7a', mossy_cobblestone: '#6e7a5e', stone_bricks: '#7b7b7b', mossy_stone_bricks: '#6f7a5f',
    chiseled_stone_bricks: '#777777', smooth_stone: '#9e9e9e', bricks: '#966054', sandstone: '#d8cb9b', cut_sandstone: '#d9cc9e',
    chiseled_sandstone: '#d6c999', smooth_sandstone: '#dcd0a3', red_sandstone: '#b5622b', quartz_block: '#ece6df', quartz_pillar: '#ebe5dd',
    smooth_quartz: '#ece6df', deepslate_bricks: '#474749', deepslate_tiles: '#363637', cobbled_deepslate: '#4d4d50', polished_deepslate: '#484849',
    polished_blackstone_bricks: '#302a30', polished_blackstone: '#363139', blackstone: '#2a242a', nether_bricks: '#2d1518',
    red_nether_bricks: '#480709', chiseled_nether_bricks: '#2f171b', prismarine_bricks: '#63ab9e', dark_prismarine: '#335b4c',
    prismarine: '#639c97', purpur_block: '#a97ea9', purpur_pillar: '#ab81ab', end_stone_bricks: '#dbe0a2', end_stone: '#dbde9e',
    mud_bricks: '#89674f', tuff_bricks: '#626a5f', cut_copper: '#c06c50', oxidized_cut_copper: '#4f9c84', polished_andesite: '#848686',
    polished_granite: '#9a6a59', polished_diorite: '#c3c3c4', obsidian: '#14121d', snow_block: '#f9fefe', packed_ice: '#8db4fa',
    glass: '#c6e4ef', tinted_glass: '#2b262d', gold_block: '#f6d03d', iron_block: '#dcdcdc', diamond_block: '#62ede4', emerald_block: '#2ab651',
    amethyst_block: '#8561bf', calcite: '#dfe0dc', moss_block: '#596d2d', hay_block: '#a68b0c', dirt: '#866043', grass_block: '#5d9c3a',
    sand: '#dbcfa3', gravel: '#837f7e', clay: '#a0a6b3', glowstone: '#f8d17a', sea_lantern: '#acc8be', lantern: '#e5a04a', soul_lantern: '#5ad6db',
    ladder: '#a0804a', iron_bars: '#8b8b8b', lightning_rod: '#c87a52', chest: '#a3732b', barrel: '#86643a', crafting_table: '#7a5a34',
    furnace: '#6e6e6e', campfire: '#ff8a2a', candle: '#e8dcc0', bookshelf: '#7b5f3a', end_rod: '#f2ece1', white_wool: '#e9ecec', bell: '#e0b83a'
  }
  const WOOD_HEX = { oak: '#a2834f', spruce: '#725431', birch: '#c0af79', jungle: '#a07351', acacia: '#a85a32', dark_oak: '#432b14', mangrove: '#773631', cherry: '#e2b2ac', pale_oak: '#e4d9d7', bamboo: '#c3ad53', crimson: '#653147', warped: '#2b6963' }
  const LOG_HEX = { oak: '#6d5532', spruce: '#3b2611', birch: '#d8d7d2', jungle: '#56451c', acacia: '#676157', dark_oak: '#3c2e1a', mangrove: '#54402b', cherry: '#37202c', pale_oak: '#4a3f3b', crimson: '#5c1a1e', warped: '#3a3b4e', bamboo: '#7f8f2f' }
  const LEAF_HEX = { oak: '#3f7f2a', spruce: '#2f5a33', birch: '#5a7a3c', jungle: '#3c8a1e', acacia: '#4c7a1e', dark_oak: '#2d6b1e', mangrove: '#4c7e22', cherry: '#f0b6d0', azalea: '#5b7e2d', pale_oak: '#8a9384' }
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16)
    const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)))
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`
  }
  function blockColor(name) {
    if (HEX[name]) return HEX[name]
    for (const d of DYES) {
      if (!name.startsWith(d + '_')) continue
      const rest = name.slice(d.length + 1)
      if (/terracotta/.test(rest)) return shade(DYE_HEX[d], 0.75).replace(/rgb\((\d+),(\d+),(\d+)\)/, (s, r, gg, b) => '#' + [r, gg, b].map(v => (+v).toString(16).padStart(2, '0')).join(''))
      return DYE_HEX[d]
    }
    for (const [w, hx] of Object.entries(WOOD_HEX)) {
      if (!name.startsWith(w + '_') && !name.startsWith('stripped_' + w)) continue
      if (/_(log|wood|stem)$/.test(name) && !name.startsWith('stripped')) return LOG_HEX[w] || hx
      if (/_leaves$/.test(name)) return LEAF_HEX[w] || '#3f7f2a'
      return hx
    }
    if (/_leaves$/.test(name)) return '#3f7f2a'
    if (/terracotta/.test(name)) return '#985e43'
    for (const [k, hx] of Object.entries(HEX)) if (name.includes(k.replace(/_block$/, ''))) return hx
    if (/(poppy|rose)/.test(name)) return '#c4202a'
    if (/(dandelion)/.test(name)) return '#f4d23a'
    if (/(cornflower|bluet|allium|daisy)/.test(name)) return '#6f8fe3'
    return '#9a9a9a'
  }
  const isGlass = n => /glass|ice$/.test(n)
  const isThin = n => /(fence|_wall$|iron_bars|ladder|lantern|torch|rod|candle|poppy|dandelion|cornflower|bluet|daisy|allium|carpet|campfire|_door$|_sapling$|_pressure_plate$|bell)/.test(n) && !/_wall_/.test(n)

  // ---------- rozumienie opisu po polsku (bez AI) ----------
  const strip = s => String(s || '').toLowerCase()
    .replace(/[ąà]/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n')
    .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z')

  // materialy: wzorzec -> klucz materialu (kolejnosc wazna: dluzsze nazwy najpierw)
  const MAT_PL = [
    [/ciemn\w* deb|ciemnodebow/, 'dark_oak'], [/blad\w* deb/, 'pale_oak'], [/omszal\w* kamienn\w* cegl/, 'mossy_stone_bricks'],
    [/kamienn\w* cegl|cegl\w* kamienn/, 'stone_bricks'], [/omszal\w* bruk/, 'mossy_cobblestone'], [/czerwon\w* netherow\w* cegl/, 'red_nether_bricks'],
    [/netherow\w* cegl|cegl\w* (z )?nether|piekieln/, 'nether_bricks'], [/czerwon\w* piaskow/, 'red_sandstone'], [/gladk\w* kamie/, 'smooth_stone'],
    [/kamien\w* (z )?endu|end ?ston|endow|kresu/, 'end_stone_bricks'], [/pryzmaryn|prismarine/, 'prismarine_bricks'], [/purpur(?!ow)/, 'purpur'],
    [/glebiak|deepslate|lupk/, 'deepslate_bricks'], [/czernit|blackstone|czarn\w* kamie/, 'blackstone'], [/swierk/, 'spruce'],
    [/brzoz/, 'birch'], [/dzungl|tropik/, 'jungle'], [/akacj/, 'acacia'], [/namorzyn|mangrow/, 'mangrove'], [/wisni|sakur/, 'cherry'],
    [/bambus/, 'bamboo'], [/karmazyn|szkarlatn/, 'crimson'], [/spaczon|wypaczon|warped/, 'warped'], [/debu|debow|\bdab/, 'oak'],
    [/bruk/, 'cobblestone'], [/cegl|ceglan/, 'bricks'], [/piaskow/, 'sandstone'], [/kwarc/, 'quartz'], [/blot|mul/, 'mud_bricks'],
    [/\btuf/, 'tuff_bricks'], [/miedz|miedzian/, 'copper'], [/obsydian/, 'obsidian'], [/sniegu|snieg|sniezn/, 'snow'],
    [/lodu\b|lodow|\blod\b/, 'ice'], [/zlot(a|y|e|ego)\b|ze zlota/, 'gold'], [/diament/, 'diamond'], [/szmaragd/, 'emerald'],
    [/zelaz/, 'iron'], [/ametyst/, 'amethyst'], [/kalcyt/, 'calcite'], [/mchu|\bmech/, 'moss'], [/siana|slom/, 'hay'],
    [/andezyt/, 'polished_andesite'], [/granit/, 'polished_granite'], [/dioryt/, 'polished_diorite'], [/kamie|kamienn/, 'stone_bricks'],
    [/drewn|desek|deski|drewnian/, 'oak']
  ]
  const DYED = [[/betonu|beton/, 'concrete'], [/welny|welna|weln/, 'wool'], [/terakot|terracot/, 'terracotta'], [/szkla|szklan|szyb|witraz/, 'stained_glass']]
  const ROLE_PL = [
    [/skrzydl|smigl|zagl/, 'sail'], [/dach|dachem|dachu|dachy|kopul|iglic|stozk/, 'roof'], [/okn|witraz|szyb/, 'windows'], [/podlog|posadzk/, 'floor'],
    [/fundament|podmurow|cokol/, 'foundation'], [/wiez|wiezycz|baszt/, 'tower'], [/kolumn|filar/, 'columns'],
    [/rog|narozn|belk|ram|szkielet|obramow/, 'corner'], [/plot|ogrodz/, 'fence'], [/scian|mur|elewac/, 'wall'], [/pieter|pietr|gor/, 'wall2']
  ]
  // domyslny material dla koloru (gdy kolor bez materialu)
  const ROOF_COLOR = { red: 'bricks', black: 'blackstone', gray: 'deepslate_tiles', light_gray: 'stone_bricks', brown: 'dark_oak', white: 'quartz', green: 'oxidized_copper', blue: 'dark_prismarine', cyan: 'prismarine_bricks', orange: 'acacia', yellow: 'birch', pink: 'cherry', purple: 'purpur', magenta: 'purpur', lime: 'lime_concrete', light_blue: 'light_blue_concrete' }
  const WALL_COLOR = { brown: 'spruce', white: 'white_concrete', yellow: 'yellow_concrete' }

  const TYPES_PL = [
    [/latarni\w* morsk|latarnia/, 'lighthouse'], [/wiatrak/, 'windmill'], [/kosciol|kaplic|katedr|swiatyni|klasztor|kosciolek/, 'church'],
    [/piramid/, 'pyramid'], [/\bmost|mostek/, 'bridge'], [/studni/, 'well'], [/altan|pergol/, 'gazebo'], [/igloo|iglo\b/, 'igloo'],
    [/zamek|zamku|zamczysk|twierdz|fortec|cytadel|warown/, 'castle'], [/palac|rezydencj|dworek|dwor\b|willa|willi/, 'mansion'],
    [/wiezowiec|drapacz|biurowiec|blok mieszk|\bblok\b/, 'skyscraper'], [/stodol|obor|stajni|szop|spichlerz/, 'barn'],
    [/arena|koloseum|amfiteatr|stadion/, 'arena'], [/pagod/, 'pagoda'], [/wieza|wiezyczk|baszt|wiezy\b/, 'tower'],
    [/dom|domek|chat|chalup|budyn|kamienic|bungalow|karczm|tawern|gospod|sklep|piekarni|kuzni|chatk/, 'house']
  ]
  const STYLE_PL = [
    [/nowoczesn|modern|futurystycz/, 'modern'], [/sredniowiecz|rycer|stary|starodaw/, 'medieval'], [/japon|azjat|chinsk|orientaln/, 'asian'],
    [/pustyn|egips|arabs/, 'desert'], [/zimow|snie(z|g)|gorsk|alpejsk|skandynaw|wiking/, 'winter'], [/netherow|piekieln|ognist|lawow/, 'nether'],
    [/endu|kosmiczn|kresu|endow/, 'end'], [/podwodn|morsk|atlant|ocean/, 'ocean'], [/bajkow|magiczn|fantasy|czarodziej|elf|wrozk/, 'fantasy'],
    [/wiejsk|rustykal|farmer|chlop/, 'rustic'], [/krolewsk|luksus|bogat|cesars|zamozn/, 'royal'], [/gotyck|mroczn|straszn|nawiedz|wampir|halloween/, 'gothic']
  ]
  const STYLES = {
    default: { wall: 'oak', corner: 'oak', floor: 'spruce', foundation: 'cobblestone', roof: 'spruce', roofType: 'gable', glass: 'glass' },
    modern: { wall: 'white_concrete', corner: 'light_gray_concrete', floor: 'smooth_stone', foundation: 'smooth_stone', roof: 'smooth_stone', roofType: 'flat', glass: 'glass', bigWindows: true },
    medieval: { wall: 'cobblestone', wall2: 'oak', corner: 'dark_oak', floor: 'spruce', foundation: 'stone_bricks', roof: 'dark_oak', roofType: 'gable', steep: 2, glass: 'glass' },
    asian: { wall: 'white_terracotta', corner: 'dark_oak', floor: 'dark_oak', foundation: 'stone_bricks', roof: 'deepslate_tiles', roofType: 'hip', overhang: 2, pagoda: true, glass: 'glass' },
    desert: { wall: 'cut_sandstone', corner: 'chiseled_sandstone', floor: 'smooth_sandstone', foundation: 'sandstone', roof: 'cut_sandstone', roofType: 'flat', glass: 'orange_stained_glass' },
    winter: { wall: 'spruce', corner: 'spruce', floor: 'spruce', foundation: 'cobblestone', roof: 'dark_oak', roofType: 'gable', steep: 2, chimney: true, glass: 'glass' },
    nether: { wall: 'nether_bricks', corner: 'red_nether_bricks', floor: 'blackstone', foundation: 'blackstone', roof: 'blackstone', roofType: 'gable', glass: 'red_stained_glass' },
    end: { wall: 'purpur', corner: 'purpur', floor: 'end_stone_bricks', foundation: 'end_stone_bricks', roof: 'end_stone_bricks', roofType: 'dome', glass: 'magenta_stained_glass', theme: 'end' },
    ocean: { wall: 'prismarine_bricks', corner: 'dark_prismarine', floor: 'dark_prismarine', foundation: 'prismarine', roof: 'dark_prismarine', roofType: 'dome', glass: 'light_blue_stained_glass' },
    fantasy: { wall: 'stone_bricks', wall2: 'birch', corner: 'dark_oak', floor: 'spruce', foundation: 'stone_bricks', roof: 'warped', roofType: 'gable', steep: 2, towerRoof: 'cone', glass: 'light_blue_stained_glass' },
    rustic: { wall: 'spruce', corner: 'spruce', floor: 'oak', foundation: 'cobblestone', roof: 'dark_oak', roofType: 'gable', glass: 'glass', chimney: true },
    royal: { wall: 'quartz', corner: 'quartz', floor: 'polished_andesite', foundation: 'stone_bricks', roof: 'deepslate_tiles', roofType: 'hip', glass: 'glass', columns: 'quartz' },
    gothic: { wall: 'deepslate_bricks', corner: 'blackstone', floor: 'dark_oak', foundation: 'blackstone', roof: 'deepslate_tiles', roofType: 'gable', steep: 3, towerRoof: 'spire', glass: 'red_stained_glass' }
  }
  const NUM_PL = { jeden: 1, jedna: 1, jedno: 1, dwa: 2, dwie: 2, dwoma: 2, dwiema: 2, trzy: 3, trzema: 3, cztery: 4, czterema: 4, piec: 5, piecioma: 5, szesc: 6, siedem: 7, osiem: 8, dziewiec: 9, dziesiec: 10 }
  const num = s => { if (s == null) return null; const n = parseInt(s, 10); return Number.isFinite(n) ? n : (NUM_PL[s] ?? null) }

  function colorAt(t) { for (const [re, c] of COLOR_PL) if (re.test(t)) return c; return null }

  // material + rola z fragmentu tekstu
  function parseMaterials(text) {
    const res = {}
    const said = []
    const clauses = text.split(/[,.;]|\boraz\b|\ba takze\b/)
    for (const cl of clauses) {
      // kolorowe bloki: "z niebieskiego betonu", "czerwone witraze"
      const hits = []
      for (const [re, key] of MAT_PL) {
        const g = new RegExp(re.source, 'g')
        let mm
        while ((mm = g.exec(cl))) { if (!hits.some(h => mm.index >= h.i && mm.index < h.i + h.len)) hits.push({ i: mm.index, len: mm[0].length, key }) }
      }
      for (const [re, kind] of DYED) {
        const g = new RegExp(re.source, 'g')
        let mm
        while ((mm = g.exec(cl))) {
          const before = cl.slice(Math.max(0, mm.index - 22), mm.index + mm[0].length)
          const col = colorAt(before) || (kind === 'stained_glass' ? null : 'white')
          if (kind === 'stained_glass' && !col) continue
          hits.push({ i: mm.index, len: mm[0].length, key: `${col}_${kind}`, dyed: true })
        }
      }
      hits.sort((a, b) => a.i - b.i)
      const WOODK = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped']
      for (let i = hits.length - 1; i >= 0; i--) {
        const h = hits[i]
        if (!/^(drewn|desek|deski)/.test(cl.slice(h.i, h.i + 6))) continue
        if (hits.some(o => o !== h && WOODK.includes(o.key) && Math.abs(o.i - h.i) < 18)) hits.splice(i, 1)
      }
      let last = 0
      for (const h of hits) {
        const seg = cl.slice(last, h.i + h.len)
        let role = null
        for (const [re, r] of ROLE_PL) { const g = new RegExp(re.source, 'g'); let mm; let pos = -1; while ((mm = g.exec(seg))) pos = mm.index; if (pos >= 0 && (!role || pos > role.pos)) role = { r, pos } }
        let r = role ? role.r : (res.wall ? 'wall2' : 'wall')
        if (/stained_glass/.test(h.key)) r = 'windows'
        if (!res[r]) { res[r] = h.key; said.push(`${PL_ROLE[r] || r}: ${h.key}`) }
        last = h.i + h.len
      }
      // sam kolor przy roli: "czerwony dach", "biale sciany", "dach czerwony"
      const words = cl.split(/\s+/)
      for (let i = 0; i < words.length; i++) {
        const col = colorAt(words[i])
        if (!col) continue
        const near = words.slice(Math.max(0, i - 2), i + 3).join(' ')
        if (DYED.some(([re]) => re.test(near)) || MAT_PL.some(([re]) => re.test(words[i + 1] || ''))) continue
        let role = null
        for (const w of [words[i + 1], words[i + 2], words[i - 1], words[i - 2]]) {
          if (!w || role) continue
          for (const [re, rr] of ROLE_PL) if (re.test(w)) { role = rr; break }
        }
        if (!role) role = 'wall'
        if (res[role]) continue
        const key = role === 'roof' ? ROOF_COLOR[col] : role === 'windows' ? `${col}_stained_glass` : role === 'sail' ? `${col}_wool` : (WALL_COLOR[col] || `${col}_concrete`)
        if (key) { res[role] = key; said.push(`${PL_ROLE[role] || role}: ${key}`) }
      }
    }
    return { res, said }
  }
  const PL_ROLE = { sail: 'skrzydła', wall: 'ściany', wall2: 'piętro', roof: 'dach', windows: 'okna', floor: 'podłoga', foundation: 'fundament', tower: 'wieże', columns: 'kolumny', corner: 'rogi', fence: 'płot' }

  // opis -> spec (czesci). Zwraca tez, co zrozumial, zeby pokazac to graczowi.
  function parse(text, seed) {
    const t = ' ' + strip(text) + ' '
    const understood = []
    // typ: ten, ktory pada w opisie najwczesniej
    let type = 'house'
    let best = Infinity
    for (const [re, ty] of TYPES_PL) { const m = re.exec(t); if (m && m.index < best) { best = m.index; type = ty } }
    const tt = t.replace(/latarni\w* morsk\w*/g, 'latarnia')
    let style = 'default'
    for (const [re, st] of STYLE_PL) if (re.test(tt)) { style = st; break }
    const S = Object.assign({}, STYLES.default, STYLES[style])
    const { res: M, said } = parseMaterials(tt)

    // rozmiar
    let scale = 1
    if (/\b(mal|niewiel|mini|ciasn|skromn)/.test(t)) scale = 0.7
    if (/\b(duz|spor|szerok)/.test(t)) scale = 1.4
    if (/\b(wielk|ogromn|gigant|olbrzym|potezn|masywn|kolosaln|epick)/.test(t)) scale = 1.9
    const dims = t.match(/(\d+)\s*(?:x|na|×)\s*(\d+)(?:\s*(?:x|na|×)\s*(\d+))?/)
    const hMatch = t.match(/wysok\w*\s*(?:na\s*)?(\d+)|(\d+)\s*(?:blok\w*\s*)?(?:wysok|w gore|wzwyz)/)
    const floorsMatch = t.match(/(\d+|jedn\w*|dw\w*|trz\w*|czter\w*|piec\w*)\s*(?:-?\s*)?(?:pieter|pietr|kondygnac|poziom)/)
    let floors = null
    if (floorsMatch) { const w = floorsMatch[1]; floors = num(w) ?? (w.startsWith('jedn') ? 1 : w.startsWith('dw') ? 2 : w.startsWith('trz') ? 3 : w.startsWith('czter') ? 4 : w.startsWith('piec') ? 5 : null) }
    if (floors == null) {
      if (/parterow/.test(t)) floors = 1
      else if (/czteropietr/.test(t)) floors = 4
      else if (/trzypietr/.test(t)) floors = 3
      else if (/dwupietr/.test(t)) floors = 2
      else if (/pietrow|pietro/.test(t)) floors = 2
    }
    const count = re => { const m = t.match(new RegExp('(\\d+|jedn\\w*|dw\\w*|trz\\w*|czter\\w*|piec\\w*|szesc\\w*|osiem\\w*)\\s+' + re)); if (!m) return null; const w = m[1]; return num(w) ?? num(Object.keys(NUM_PL).find(k => w.startsWith(k.slice(0, 3))) || '') }

    const has = re => re.test(t)
    const feat = {
      towers: has(/wiez|baszt/) ? (count('(?:wiez|baszt)') || true) : false,
      chimney: has(/komin/) || S.chimney,
      porch: has(/ganek|ganki|werand|przedsion/),
      balcony: has(/balkon/),
      columns: has(/kolumn|portyk|filar/) ? (M.columns || S.columns || true) : (S.columns || false),
      garden: has(/ogrod|plot|ogrodz|kwiat/),
      flowers: has(/kwiat/),
      trees: has(/drzew/),
      lamps: has(/latarn(?!ia morsk)|lamp|oswietl/),
      battlements: has(/blank|krenel/),
      terrace: has(/taras/),
      dome: has(/kopul/),
      spire: has(/iglic/),
      bigWindows: has(/duz\w* okn|panoram|przeszklon|szklan\w* sci/) || S.bigWindows,
      noWindows: has(/bez okien/),
      round: has(/okragl|kolist|okrag/),
      pagoda: S.pagoda || has(/pagod/),
      keep: !has(/bez donzon|bez wiezy srodk/)
    }
    let roofType = S.roofType
    if (has(/plask\w* dach|dach\w* plask|taras/)) roofType = 'flat'
    if (has(/dwuspad|spadzist|trojkat\w* dach/)) roofType = 'gable'
    if (has(/czterospad|kopertow|dach\w* (jak w )?pagod/)) roofType = 'hip'
    if (has(/piramidaln\w* dach|dach\w* piramid|namiotow/)) roofType = 'pyramid'
    if (feat.dome) roofType = 'dome'
    if (has(/stozk|spiczast/)) roofType = 'cone'

    const wall = M.wall || S.wall
    const wall2 = M.wall2 || (M.wall ? M.wall : S.wall2) || wall
    const roofMat = M.roof || S.roof
    const glass = feat.noWindows ? 'none' : (M.windows || S.glass)
    const base = { wall, wall2, corner: M.corner || (M.wall ? (MATS[M.wall] && MATS[M.wall].wood ? M.wall : M.wall) : S.corner), floor: M.floor || S.floor, foundation: M.foundation || S.foundation, theme: S.theme }
    const sz = (n, m = 1) => odd(Math.max(5, n * scale * m))
    const parts = []
    let footprint = { x1: -5, x2: 5, z1: 0, z2: 10 }

    const houseLike = (kind, defaults) => {
      const w = dims ? clamp(+dims[1], 5, 41) | 1 : sz(defaults.w)
      const d = dims ? clamp(+dims[2], 5, 41) : Math.max(5, Math.round(defaults.d * scale))
      const fl = clamp(floors ?? defaults.floors ?? 1, 1, 12)
      const roof = { type: roofType === 'cone' ? 'pyramid' : roofType, mat: roofMat, steep: S.steep || 1, overhang: S.overhang ?? 1 }
      if (feat.spire) roof.tip = 'lightning_rod'
      parts.push(Object.assign({ kind: 'house', x: 0, z: 0, w, d, floors: fl, storey: defaults.storey || 4 }, base, {
        roof, windows: { block: glass, style: feat.bigWindows ? 'big' : undefined, every: 2 },
        chimney: feat.chimney, porch: feat.porch, balcony: feat.balcony && fl > 1, columns: feat.columns || undefined,
        terrace: feat.terrace, battlements: feat.battlements, pagoda: feat.pagoda && fl > 1,
        towers: feat.towers, towerMat: M.tower || wall, towerRoof: S.towerRoof || (roofType === 'dome' ? 'dome' : 'cone'),
        trim: style === 'medieval' || style === 'modern' || undefined
      }, defaults.extra || {}))
      const half = Math.floor(w / 2)
      footprint = { x1: -half, x2: half, z1: 0, z2: d - 1 }
      understood.push(`${defaults.label} ${w}×${d}`, fl > 1 ? `${fl} piętra` : 'parterowy', `dach: ${PL_ROOF[roof.type] || roof.type}`)
    }

    if (type === 'house') houseLike('house', { w: 9, d: 9, floors: 1, label: 'dom' })
    else if (type === 'mansion') {
      houseLike('house', { w: 15, d: 11, floors: 2, storey: 5, label: 'pałac/willa' })
      const main = parts[0]
      if (!dims && scale >= 1) {
        // skrzydla po bokach
        const ww = 7
        for (const sx of [-1, 1]) parts.push(Object.assign({ kind: 'house', x: sx * (Math.floor(main.w / 2) + Math.floor(ww / 2) + 1), z: 2, w: ww, d: main.d - 4, floors: 1, storey: 5 }, base, { roof: { type: main.roof.type === 'gable' ? 'hip' : main.roof.type, mat: roofMat }, windows: main.windows }))
        footprint.x1 -= ww + 1; footprint.x2 += ww + 1
        understood.push('2 skrzydła')
      }
    } else if (type === 'barn') { houseLike('house', { w: 11, d: 15, floors: 1, storey: 6, label: 'stodoła', extra: { doorWidth: 3, roof: { type: 'gable', mat: M.roof || 'dark_oak', steep: 2, axis: 'z' } } }); parts[0].wall = M.wall || 'spruce'; parts[0].corner = M.corner || 'dark_oak' }
    else if (type === 'skyscraper') {
      const fl = clamp(floors ?? Math.round(10 * scale), 3, 30)
      const w = dims ? clamp(+dims[1], 7, 31) | 1 : sz(11)
      parts.push({ kind: 'skyscraper', x: 0, z: 0, w, d: w, floors: fl, wall: M.wall || 'light_gray_concrete', corner: M.corner || 'gray_concrete', windows: { block: M.windows || 'glass', style: 'big' } })
      footprint = { x1: -Math.floor(w / 2), x2: Math.floor(w / 2), z1: 0, z2: w - 1 }
      understood.push(`wieżowiec ${w}×${w}`, `${fl} pięter`)
    } else if (type === 'pagoda') {
      houseLike('house', { w: 9, d: 9, floors: floors || 3, storey: 4, label: 'pagoda' })
      Object.assign(parts[0], { pagoda: true, roof: { type: 'hip', mat: M.roof || 'deepslate_tiles', overhang: 2, tip: 'lightning_rod' }, wall: M.wall || 'white_terracotta', corner: M.corner || 'dark_oak' })
    } else if (type === 'tower') {
      const size = sz(feat.round ? 7 : 5)
      const h = clamp(hMatch ? +(hMatch[1] || hMatch[2]) : Math.round(16 * scale), 6, 120)
      const rt = roofType === 'gable' || roofType === 'hip' ? (S.towerRoof || (feat.battlements ? 'battlements' : 'pyramid')) : roofType === 'flat' ? (feat.battlements ? 'battlements' : 'flat') : roofType
      parts.push({ kind: 'tower', x: 0, z: 0, shape: feat.round ? 'round' : 'square', size, h, mat: M.wall || M.tower || (style === 'default' ? 'stone_bricks' : S.wall), roof: { type: feat.battlements ? 'battlements' : rt, mat: roofMat, tip: feat.spire ? 'lightning_rod' : undefined }, glass: glass === 'none' ? 'glass' : glass })
      footprint = { x1: -size, x2: size, z1: 0, z2: size }
      understood.push(`${feat.round ? 'okrągła ' : ''}wieża ${size}×${size}`, `wysokość ${h}`)
    } else if (type === 'castle') {
      const W = dims ? clamp(+dims[1], 11, 99) | 1 : sz(23)
      const D = dims ? clamp(+dims[2], 11, 99) : sz(23)
      const towers = typeof feat.towers === 'number' ? feat.towers : 4
      parts.push({ kind: 'castle', x: 0, z: 0, w: W, d: D, h: clamp(hMatch ? +(hMatch[1] || hMatch[2]) : Math.round(7 * Math.sqrt(scale)), 4, 30), mat: M.wall || (style === 'default' ? 'stone_bricks' : S.wall), roofMat, towers, towerShape: feat.round ? 'round' : 'square', towerRoof: roofType === 'cone' || roofType === 'dome' ? roofType : (S.towerRoof || (feat.spire ? 'spire' : 'battlements')), keep: feat.keep })
      footprint = { x1: -Math.floor(W / 2) - 3, x2: Math.floor(W / 2) + 3, z1: -3, z2: D + 2 }
      understood.push(`zamek ${W}×${D}`, `${towers} wieże`)
    } else if (type === 'church') {
      parts.push({ kind: 'church', x: 0, z: 0, w: sz(9), d: Math.round(17 * scale), h: Math.round(7 * Math.sqrt(scale)), wall: M.wall || (style === 'default' ? 'stone_bricks' : S.wall), roofMat: M.roof || 'deepslate_tiles', glass: M.windows || 'light_blue_stained_glass' })
      footprint = { x1: -6, x2: 6, z1: -5, z2: Math.round(17 * scale) }
      understood.push('kościół z dzwonnicą')
    } else if (type === 'pyramid') {
      const size = sz(21)
      parts.push({ kind: 'pyramid', x: 0, z: 0, size, mat: M.wall || 'sandstone' })
      footprint = { x1: -size, x2: size, z1: 0, z2: size }
      understood.push(`piramida ${size}×${size}`)
    } else if (type === 'lighthouse') {
      const h = clamp(hMatch ? +(hMatch[1] || hMatch[2]) : Math.round(18 * scale), 8, 80)
      const cols = []
      for (const w of tt.split(/[\s-]+/)) { const c = colorAt(w); if (c && !cols.includes(c)) cols.push(c) }
      const c1 = cols[0] ? `${cols[0]}_concrete` : 'white_concrete'
      const c2 = cols[1] ? `${cols[1]}_concrete` : (cols[0] === 'red' ? 'white_concrete' : 'red_concrete')
      parts.push({ kind: 'lighthouse', x: 0, z: 0, r: Math.max(2, Math.round(3 * Math.sqrt(scale))), h, mat: c1, mat2: c2, roofMat: M.roof || c2 })
      understood.push(`latarnia morska, wysokość ${h}`)
    } else if (type === 'windmill') {
      parts.push({ kind: 'windmill', x: 0, z: 0, w: sz(7), h: Math.round(10 * scale), wall: M.wall || 'cobblestone', wall2: M.wall2 || 'spruce', roofMat: M.roof || 'dark_oak', sail: M.sail || 'white_wool' })
      understood.push('wiatrak')
    } else if (type === 'bridge') {
      const L = dims ? clamp(+dims[2] || +dims[1], 5, 151) : Math.round(21 * scale)
      parts.push({ kind: 'bridge', x: 0, z: 0, length: L, w: dims ? clamp(+dims[1], 3, 15) | 1 : 5, mat: M.wall || 'spruce', pillar: M.columns || 'stone_bricks' })
      understood.push(`most, długość ${L}`)
    } else if (type === 'well') { parts.push({ kind: 'well', x: 0, z: 0, mat: M.wall || 'cobblestone', roofMat: M.roof || 'oak' }); understood.push('studnia') }
    else if (type === 'gazebo') { parts.push({ kind: 'gazebo', x: 0, z: 0, r: Math.round(4 * scale), mat: M.wall || 'oak', roofMat: M.roof || 'dark_oak' }); understood.push('altana') }
    else if (type === 'igloo') { parts.push({ kind: 'igloo', x: 0, z: 0, r: Math.round(4 * scale), mat: M.wall || 'snow' }); understood.push('igloo') }
    else if (type === 'arena') { parts.push({ kind: 'arena', x: 0, z: 0, r: Math.round(12 * scale), mat: M.wall || 'stone_bricks' }); understood.push('arena') }

    // ogrod, drzewa, latarnie wokol budynku
    if (feat.garden && !['bridge', 'castle', 'arena'].includes(type)) {
      const f = { x1: footprint.x1 - 3, x2: footprint.x2 + 3, z1: Math.min(footprint.z1, -2) - 3, z2: footprint.z2 + 3 }
      parts.push({ kind: 'fence', x: 0, z: 0, ...f, mat: M.fence || 'oak', flowers: feat.flowers, lamps: feat.lamps })
      understood.push(feat.flowers ? 'ogród z kwiatami' : 'płot')
      footprint = f
    } else if (feat.lamps && type !== 'castle') {
      parts.push({ kind: 'lamp', x: -2, z: -2 }, { kind: 'lamp', x: 2, z: -2 })
      understood.push('latarnie')
    }
    if (feat.trees) {
      const n = count('drzew') || 2
      const spots = [[footprint.x1 - 3, footprint.z2 - 1], [footprint.x2 + 3, footprint.z2 - 1], [footprint.x1 - 3, 2], [footprint.x2 + 3, 2]]
      for (let i = 0; i < Math.min(4, n); i++) parts.push({ kind: 'tree', x: spots[i][0], z: spots[i][1], wood: /wisni|sakur/.test(t) ? 'cherry' : /brzoz/.test(t) ? 'birch' : /swierk|choink/.test(t) ? 'spruce' : 'oak' })
      understood.push(`${Math.min(4, n)} drzewa`)
    }
    if (style !== 'default') understood.push(`styl: ${PL_STYLE[style]}`)
    if (said.length) understood.push(...said)
    for (const k of ['chimney', 'porch', 'balcony', 'battlements', 'terrace', 'pagoda']) if (feat[k] && parts[0] && parts[0].kind === 'house') understood.push(PL_FEAT[k])
    if (feat.towers && parts[0] && parts[0].kind === 'house') understood.push(`wieże: ${feat.towers === true ? 4 : feat.towers}`)

    const name = guessName(text, type)
    return { spec: { name, style, seed: seed || 1, description: String(text || ''), parts }, understood, type }
  }
  const PL_ROOF = { gable: 'dwuspadowy', hip: 'czterospadowy', flat: 'płaski', pyramid: 'piramidalny', dome: 'kopuła', cone: 'stożek', none: 'brak' }
  const PL_STYLE = { modern: 'nowoczesny', medieval: 'średniowieczny', asian: 'japoński', desert: 'pustynny', winter: 'zimowy', nether: 'netherowy', end: 'z Endu', ocean: 'podwodny', fantasy: 'bajkowy', rustic: 'wiejski', royal: 'królewski', gothic: 'gotycki' }
  const PL_FEAT = { chimney: 'komin', porch: 'ganek', balcony: 'balkon', battlements: 'blanki', terrace: 'taras', pagoda: 'dachy na każdym piętrze' }
  const PL_TYPE = { house: 'dom', mansion: 'pałac', barn: 'stodoła', skyscraper: 'wieżowiec', pagoda: 'pagoda', tower: 'wieża', castle: 'zamek', church: 'kościół', pyramid: 'piramida', lighthouse: 'latarnia', windmill: 'wiatrak', bridge: 'most', well: 'studnia', gazebo: 'altana', igloo: 'igloo', arena: 'arena' }
  function guessName(text, type) {
    // slowa z polskimi znakami (bot i tak porownuje nazwy bez nich)
    const words = String(text || '').toLowerCase().replace(/[^\p{L}0-9 ]/gu, ' ').split(/\s+/).filter(Boolean)
    const stop = new Set(['z', 'ze', 'i', 'a', 'w', 'na', 'do', 'o', 'oraz', 'jak', 'ktory', 'ktora', 'ma', 'byc', 'zbuduj', 'zrob', 'chce', 'postaw', 'mi', 'taki', 'taka', 'takie', 'bardzo'])
    const pick = words.filter(w => !stop.has(strip(w))).slice(0, 3).join(' ')
    return (pick || PL_TYPE[type] || 'budowla').slice(0, 32)
  }

  const EXAMPLES = [
    'mały domek z drewna świerkowego z kominem i ogrodem z kwiatami',
    'dwupiętrowy średniowieczny dom z balkonem i czerwonym dachem',
    'nowoczesna willa z dużymi oknami i płaskim dachem z tarasem',
    'zamek z kamiennych cegieł z 4 okrągłymi wieżami i stożkowymi dachami',
    'japońska pagoda z trzema piętrami',
    'okrągła wieża czarodzieja wysoka na 24 z iglicą',
    'latarnia morska w biało-czerwone pasy',
    'gotycki kościół z dzwonnicą i czerwonymi witrażami',
    'wiatrak z białymi skrzydłami',
    'piramida z piaskowca',
    'netherowy dom z czernitu',
    'kamienny most 5 na 25 z latarniami'
  ]

  return { generate, parse, setBlocks, mat, materialsOf, blockColor, isGlass, isThin, isEasy, shade, EXAMPLES, PARTS: Object.keys(PARTS), PL_TYPE, PL_ROOF, strip }
})
