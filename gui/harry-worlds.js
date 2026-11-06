// Swiaty Harry'ego (czesc modu "Wiecej budowli"): oba Hogwarty (z oswietleniem) i slawne miejsca - Nora, ulica Pokatna
// z Dziurawym Kotlem i bankiem Gringotta, peron 9 3/4 z ekspresem, chatka Hagrida, boisko do quidditcha, Bijaca Wierzba.
// Uklad jak w projektach bota: x w prawo (od bota), z do przodu, y w gore; y = 0 to pierwszy poziom nad ziemia.
const fs = require('fs')
const path = require('path')

const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
const pick = (list, x, y, z) => { let r = hash(x, y, z); for (const [b, p] of list) { if ((r -= p) < 0) return b } return list[0][0] }

// prosta siatka komorek
function grid() {
  const m = new Map()
  const g = {
    set: (x, y, z, block, extra) => m.set(`${x},${y},${z}`, Object.assign({ x, y, z, block }, extra || {})),
    cut: (x, y, z) => m.delete(`${x},${y},${z}`),
    has: (x, y, z) => m.has(`${x},${y},${z}`),
    box: (x1, x2, y1, y2, z1, z2, b) => { for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) typeof b === 'function' ? b(x, y, z) : g.set(x, y, z, b) },
    // pusta skrzynka: sciany (fn albo blok), podloga i (opcjonalnie) strop; w srodku wyciete
    shell(x1, x2, y1, y2, z1, z2, wall, floor, ceil) {
      for (let x = x1; x <= x2; x++) {
        for (let z = z1; z <= z2; z++) {
          if (floor) g.set(x, y1 - 1, z, floor)
          if (ceil) g.set(x, y2 + 1, z, ceil)
          for (let y = y1; y <= y2; y++) {
            if (x === x1 || x === x2 || z === z1 || z === z2) typeof wall === 'function' ? g.set(x, y, z, wall(x, y, z)) : g.set(x, y, z, wall)
            else g.cut(x, y, z)
          }
        }
      }
    },
    // dach czterospadowy (2 bloki grubosci, kazda warstwa ma oparcie) nad prostokatem
    hipRoof(x1, x2, z1, z2, y, block, tip) {
      let d = 0
      for (; x1 + d <= x2 - d && z1 + d <= z2 - d; d++) {
        for (let x = x1 + d; x <= x2 - d; x++) for (let z = z1 + d; z <= z2 - d; z++) {
          const edge = Math.min(x - x1 - d, x2 - d - x, z - z1 - d, z2 - d - z)
          if (edge <= 1) g.set(x, y + d, z, block)
        }
      }
      if (tip) g.set(Math.round((x1 + x2) / 2), y + d, Math.round((z1 + z2) / 2), tip)
      return y + d
    },
    hang: (x, y, z) => g.set(x, y, z, 'lantern', { attach: { x: 0, y: 1, z: 0 }, late: true, optional: true }),
    cells: () => [...m.values()],
    map: m
  }
  return g
}
const disk = r => { const a = []; for (let dx = -r - 1; dx <= r + 1; dx++) for (let dz = -r - 1; dz <= r + 1; dz++) if (dx * dx + dz * dz <= (r + 0.4) * (r + 0.4)) a.push([dx, dz]); return a }
const inDisk = (r, dx, dz) => dx * dx + dz * dz <= (r + 0.4) * (r + 0.4)

// ---------- NORA: krzywy, wysoki dom Weasleyow - pietra dostawiane jedno na drugim, kazde troche w bok ----------
function nora() {
  const g = grid()
  const tiers = [ // [x1, x2, z1, z2, material]
    [-6, 6, 0, 8, 'stone'], [-5, 5, 0, 7, 'planks'], [-4, 3, 1, 7, 'planks'], [-2, 4, 1, 6, 'planks'], [-3, 2, 2, 7, 'planks'], [-2, 3, 1, 5, 'planks'], [-1, 3, 2, 6, 'planks']
  ]
  const H = 4
  const planks = ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks']
  tiers.forEach(([x1, x2, z1, z2, mat], i) => {
    const y0 = i * (H + 1)
    const wall = (x, y, z) => {
      const corner = (x === x1 || x === x2) && (z === z1 || z === z2)
      if (corner) return i ? 'stripped_spruce_log' : 'cobblestone'
      if (y === y0 + 1 && !corner && (x - x1) % 3 === 2) return 'glass'
      return mat === 'stone' ? pick([['cobblestone', 0.5], ['mossy_cobblestone', 0.3], ['stone', 0.2]], x, y, z) : planks[i % planks.length]
    }
    g.shell(x1, x2, y0, y0 + H - 1, z1, z2, wall, i ? 'spruce_planks' : 'oak_planks', null)
    // odsloniety brzeg nizszego pietra: daszek z czerwonej dachowki
    if (i) {
      const [a1, a2, b1, b2] = tiers[i - 1]
      for (let x = a1; x <= a2; x++) for (let z = b1; z <= b2; z++) if (x < x1 || x > x2 || z < z1 || z > z2) g.set(x, y0 - 1, z, 'red_nether_bricks')
    }
  })
  const [tx1, tx2, tz1, tz2] = tiers[tiers.length - 1]
  const top = tiers.length * (H + 1) - 1
  g.hipRoof(tx1 - 1, tx2 + 1, tz1 - 1, tz2 + 1, top, 'red_nether_bricks', 'lightning_rod')
  // drabina przez wszystkie pietra (przy slupie w srodku)
  for (let y = 0; y < top; y++) { g.set(1, y, 4, 'stripped_oak_log'); g.set(0, y, 4, 'ladder', { attach: { x: 1, y: 0, z: 0 } }) }
  // drzwi, kominy, podporki
  g.set(0, 0, 0, 'oak_door'); g.cut(0, 1, 0)
  for (let y = 0; y < 26; y++) g.set(7, y, 3, 'bricks')
  for (let y = 10; y < 34; y++) g.set(-3, y, 7, 'bricks')
  g.set(7, 26, 3, 'campfire', { optional: true })
  for (const [x, z] of [[-5, -1], [5, -1]]) for (let y = 0; y < 5; y++) g.set(x, y, z, 'oak_fence')
  // ogrodek: plot, dynie, szopa na miotly
  for (let x = -12; x <= 12; x++) for (const z of [-6, 16]) g.set(x, 0, z, 'oak_fence')
  for (let z = -6; z <= 16; z++) for (const x of [-12, 12]) g.set(x, 0, z, 'oak_fence')
  g.cut(0, 0, -6)
  for (const [x, z] of [[-9, -3], [-8, -2], [9, 12], [-9, 13]]) g.set(x, 0, z, 'pumpkin')
  g.shell(8, 11, 0, 2, 9, 13, 'spruce_planks', 'spruce_planks', 'spruce_planks')
  g.cut(8, 0, 11); g.cut(8, 1, 11)
  const rooms = tiers.map(([x1, x2, z1, z2], i) => ({ x1: x1 + 1, x2: x2 - 1, z1: z1 + 1, z2: z2 - 1, y: i * (H + 1), h: H - 1, theme: 'wood', bed: i > 0, keep: ['0,4', '1,4', '0,3', '0,5', '-1,4', '0,1'] }))
  for (let i = 0; i < tiers.length; i++) g.hang(0, i * (H + 1) + H - 1, 2)
  return { cells: g.cells(), rooms }
}

// ---------- ULICA POKATNA: kreta uliczka kolorowych, krzywych sklepow, Dziurawy Kociol i bank Gringotta ----------
function pokatna() {
  const g = grid()
  const L = 84
  // bruk
  for (let z = 0; z <= L; z++) for (let x = -3; x <= 3; x++) g.set(x, -1, z, pick([['cobblestone', 0.5], ['stone_bricks', 0.3], ['mossy_cobblestone', 0.2]], x, 0, z))
  const COLORS = ['red', 'green', 'blue', 'purple', 'orange', 'cyan', 'yellow', 'brown', 'magenta', 'light_blue', 'lime', 'pink']
  // sklepy po obu stronach
  for (const side of [-1, 1]) {
    let z = 2
    let i = side > 0 ? 3 : 0
    while (z < L - 8) {
      const w = 6 + Math.floor(hash(z, side, 1) * 4)
      const h = 10 + Math.floor(hash(z, side, 2) * 9)
      const col = COLORS[i++ % COLORS.length]
      const near = side * 4
      const far = side * 14
      const [x1, x2] = side < 0 ? [far, near] : [near, far]
      const facade = side < 0 ? x2 : x1
      const wall = (x, y, zz) => {
        if (x === facade && y >= 1 && y <= 2 && zz > z && zz < z + w - 1) return 'glass' // wystawa
        if (x === facade && y >= 6 && (y - 6) % 4 < 2 && (zz - z) % 3 === 1) return 'glass' // okna pieter
        return y < 4 ? 'dark_oak_planks' : `${col}_terracotta`
      }
      g.shell(x1, x2, 0, h - 1, z, z + w - 1, wall, 'spruce_planks', null)
      // drzwi i szyld (kolorowa welna nad wejsciem)
      const dz = z + Math.floor(w / 2)
      g.set(facade, 0, dz, 'dark_oak_door'); g.cut(facade, 1, dz)
      g.set(facade - side, 3, dz, `${col}_wool`); g.set(facade - side, 3, dz - 1, `${col}_wool`)
      // wyzsze pietra wystaja nad ulice (krzywe kamienice)
      for (let y = 6; y < h; y++) for (let zz = z; zz < z + w; zz++) g.set(facade - side, y, zz, wall(facade, y, zz) === 'glass' ? 'glass' : `${col}_terracotta`)
      for (let zz = z; zz < z + w; zz++) g.set(facade - side, 5, zz, 'dark_oak_planks')
      // dach
      g.hipRoof(Math.min(x1, x2) - (side < 0 ? 0 : 1), Math.max(x1, x2) + (side < 0 ? 1 : 0), z, z + w - 1, h, pick([['deepslate_tiles', 0.5], ['dark_oak_planks', 0.25], ['red_nether_bricks', 0.25]], z, side, h), null)
      g.set(facade - side * 2, 4, dz, 'lantern', { optional: true })
      g.set(facade - side, 4, dz, 'dark_oak_planks')
      z += w
    }
  }
  // Dziurawy Kociol (wejscie od strony bota) i ceglany mur z przejsciem na ulice
  g.shell(-8, 8, 0, 6, -14, -2, (x, y, z) => (y === 2 && x % 3 === 0 && (z === -14 || x === -8 || x === 8)) ? 'glass' : pick([['bricks', 0.7], ['mud_bricks', 0.3]], x, y, z), 'spruce_planks', 'dark_oak_planks')
  g.hipRoof(-9, 9, -15, -1, 7, 'deepslate_tiles', null)
  g.set(0, 0, -14, 'dark_oak_door'); g.cut(0, 1, -14)
  for (const x of [-5, 5]) { g.set(x, 0, -8, 'spruce_planks'); g.set(x, 1, -8, 'barrel', { optional: true }) }
  g.hang(0, 5, -8)
  for (let x = -8; x <= 8; x++) for (let y = 0; y <= 6; y++) g.set(x, y, -2, (Math.abs(x) <= 2 && y <= 4 - Math.floor(Math.abs(x) / 2)) ? 'air' : pick([['bricks', 0.8], ['mossy_stone_bricks', 0.2]], x, y, -2))
  for (let x = -2; x <= 2; x++) for (let y = 0; y <= 4; y++) g.cut(x, y, -2)
  // Bank Gringotta: bialy marmur, kolumny, schody, brazowe wrota
  const gz = L + 1
  g.shell(-15, 15, 0, 23, gz + 4, gz + 30, (x, y, z) => (z === gz + 4 && y >= 6 && y % 5 === 1 && x % 4 === 0) ? 'glass' : 'quartz_bricks', 'polished_andesite', 'quartz_block')
  for (let k = 0; k < 4; k++) for (let x = -13 + k; x <= 13 - k; x++) g.set(x, k, gz + k, 'quartz_stairs', { facing: { x: 0, z: 1 } })
  for (let x = -13; x <= 13; x++) for (let z = gz + 4; z >= gz + 4; z--) g.set(x, 3, z, 'quartz_block')
  for (const x of [-12, -8, 8, 12]) for (let y = 4; y <= 20; y++) g.set(x, y, gz + 3, 'quartz_pillar')
  for (let x = -14; x <= 14; x++) { g.set(x, 21, gz + 3, 'quartz_block'); g.set(x, 22, gz + 2, 'chiseled_quartz_block') }
  for (let x = -2; x <= 2; x++) for (let y = 4; y <= 10; y++) g.set(x, y, gz + 4, Math.abs(x) <= 1 && y <= 9 ? 'cut_copper' : 'gold_block')
  g.hipRoof(-16, 16, gz + 3, gz + 31, 24, 'smooth_quartz', 'gold_block')
  for (let z = gz + 8; z <= gz + 28; z += 6) g.hang(0, 22, z)
  // latarnie nad ulica
  for (let z = 6; z < L; z += 10) for (const x of [-3, 3]) { g.set(x, 0, z, 'dark_oak_fence'); g.set(x, 1, z, 'dark_oak_fence'); g.set(x, 2, z, 'lantern', { optional: true }) }
  return { cells: g.cells(), rooms: [] }
}

// ---------- PERON 9 3/4 z ekspresem do Hogwartu ----------
// cyfry 3x5 do napisu "9 3/4"
const FONT = { 9: ['###', '#.#', '###', '..#', '###'], 3: ['###', '..#', '.##', '..#', '###'], 4: ['#.#', '#.#', '###', '..#', '..#'], '/': ['..#', '..#', '.#.', '#..', '#..'] }
function peron() {
  const g = grid()
  const LEN = 70
  // peron (podwyzszony) i tory
  for (let z = 0; z < LEN; z++) {
    for (let x = -7; x <= 1; x++) { g.set(x, -1, z, 'stone_bricks'); g.set(x, 0, z, x === 1 ? 'yellow_concrete' : 'smooth_stone') }
    for (let x = 2; x <= 8; x++) g.set(x, -1, z, 'gravel_dummy')
    for (const x of [3, 7]) g.set(x, 0, z, 'iron_block')
    for (let x = 3; x <= 7; x++) if (z % 2 === 0) g.set(x, -1, z, 'spruce_planks')
  }
  for (const c of g.cells()) if (c.block === 'gravel_dummy') c.block = 'andesite'
  // ceglane slupy z lukami i szklany dach na zelazie
  for (let z = 2; z < LEN; z += 8) {
    for (let y = 1; y <= 8; y++) for (const x of [-7, -6]) g.set(x, y, z, 'bricks')
    for (let zz = z + 1; zz < z + 8 && zz < LEN; zz++) g.set(-7, 8, zz, 'bricks')
  }
  for (let z = 0; z < LEN; z++) for (let x = -7; x <= 9; x++) g.set(x, 9 + (x > 1 ? 1 : 0), z, (z % 4 === 0 || x === -7 || x === 9) ? 'iron_bars_block' : 'glass')
  for (const c of g.cells()) if (c.block === 'iron_bars_block') c.block = 'light_gray_concrete'
  for (let z = 2; z < LEN; z += 8) for (let y = 1; y <= 9; y++) g.set(9, y, z, 'light_gray_concrete')
  // tablica "9 3/4" na slupie
  const sx = -5
  const sz = 34
  const text = ['9', '3', '/', '4']
  let col = 0
  for (const ch of text) {
    FONT[ch].forEach((row, r) => [...row].forEach((c, k) => g.set(sx, 7 - r, sz + col + k, c === '#' ? 'white_concrete' : 'black_concrete')))
    for (let r = 0; r < 5; r++) g.set(sx, 7 - r, sz + col + 3, 'black_concrete')
    col += 4
  }
  for (let k = -1; k <= col; k++) { g.set(sx, 8, sz + k, 'black_concrete'); g.set(sx, 2, sz + k, 'black_concrete') }
  for (let k = -1; k <= col; k++) for (let y = 2; y <= 8; y++) if (!g.has(sx, y, sz + k)) g.set(sx, y, sz + k, 'black_concrete')
  // ekspres: czerwona lokomotywa (kociol, komin, kabina, kola) i 3 wagony
  const tx = 5
  const z0 = 4
  for (let z = z0; z < z0 + 12; z++) {
    for (let dx = -2; dx <= 2; dx++) for (let y = 2; y <= 5; y++) if (dx * dx + (y - 3.5) ** 2 <= 5.5) g.set(tx + dx, y, z, z === z0 ? 'black_concrete' : 'red_concrete')
    for (const dx of [-2, 2]) g.set(tx + dx, 1, z, z % 3 === 0 ? 'black_concrete' : 'red_concrete')
    for (let dx = -2; dx <= 2; dx++) g.set(tx + dx, 1, z, (dx === -2 || dx === 2) && z % 3 === 0 ? 'black_concrete' : 'red_concrete')
  }
  for (let y = 6; y <= 8; y++) g.set(tx, y, z0 + 2, 'black_concrete')
  g.set(tx, 9, z0 + 2, 'gray_concrete', { optional: true })
  g.set(tx, 3, z0 - 1, 'yellow_concrete')
  for (let dx = -2; dx <= 2; dx++) g.set(tx + dx, 1, z0 - 1, 'black_concrete')
  g.shell(tx - 2, tx + 2, 2, 6, z0 + 12, z0 + 15, (x, y, z) => y === 4 && (x === tx - 2 || x === tx + 2) ? 'glass' : 'red_concrete', 'black_concrete', 'black_concrete')
  for (let c = 0; c < 3; c++) {
    const cz = z0 + 17 + c * 17
    g.shell(tx - 2, tx + 2, 2, 6, cz, cz + 15, (x, y, z) => y >= 3 && y <= 4 && (z - cz) % 3 !== 0 && (x === tx - 2 || x === tx + 2) ? 'yellow_stained_glass' : y === 6 ? 'black_concrete' : 'red_concrete', 'red_concrete', 'black_concrete')
    for (let z = cz; z <= cz + 15; z++) for (let dx = -2; dx <= 2; dx++) g.set(tx + dx, 1, z, (Math.abs(dx) === 2 && (z - cz) % 5 === 1) ? 'black_concrete' : 'gray_concrete')
    g.hang(tx, 6, cz + 8)
  }
  for (let z = 6; z < LEN; z += 12) g.hang(-3, 8, z)
  return { cells: g.cells(), rooms: [] }
}

// ---------- CHATKA HAGRIDA: okragla kamienna chata ze strzecha, komin, grzadka dyni ----------
function chatka() {
  const g = grid()
  const r = 5
  const cz = 7
  for (const [dx, dz] of disk(r)) g.set(dx, -1, cz + dz, 'spruce_planks')
  for (let y = 0; y < 6; y++) for (const [dx, dz] of disk(r)) {
    const ring = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !inDisk(r, dx + a, dz + b))
    if (ring) g.set(dx, y, cz + dz, y === 2 && (dx === 0 || dz === 0) && dz !== -r ? 'glass' : pick([['cobblestone', 0.45], ['stone', 0.3], ['mossy_cobblestone', 0.25]], dx, y, dz))
  }
  // strzecha (stozek z siana, 2 bloki grubosci)
  let t = 0
  for (let rho = r + 1; rho >= 0; rho--) for (let k = 0; k < 2; k++, t++) for (const [dx, dz] of disk(rho)) if (!inDisk(rho - 2, dx, dz) || rho <= 1) g.set(dx, 6 + t, cz + dz, 'hay_block')
  for (let y = 0; y < 6 + t; y++) g.set(r - 1, y, cz + 1, 'cobblestone')
  for (let y = 6; y < 6 + t - 2; y++) g.set(r, y, cz + 1, 'cobblestone')
  // wielkie drzwi
  for (let y = 0; y < 3; y++) g.cut(0, y, cz - r)
  g.set(0, 0, cz - r, 'spruce_door'); g.cut(0, 1, cz - r); g.set(0, 2, cz - r, 'spruce_planks')
  g.set(-2, 0, cz + 2, 'red_bed', { facing: { x: 0, z: 1 }, optional: true })
  g.set(2, 0, cz + 3, 'crafting_table', { optional: true })
  g.set(3, 0, cz + 1, 'campfire', { optional: true })
  g.hang(0, 6 + t - 4, cz)
  // grzadka dyni i plotek
  for (let x = -10; x <= -6; x++) for (let z = 0; z <= 6; z++) { g.set(x, -1, z, 'farmland_dummy'); if ((x + z) % 2 === 0) g.set(x, 0, z, (x * z) % 3 === 0 ? 'carved_pumpkin' : 'pumpkin') }
  for (const c of g.cells()) if (c.block === 'farmland_dummy') c.block = 'coarse_dirt'
  for (let x = -11; x <= -5; x++) { g.set(x, 0, -1, 'spruce_fence'); g.set(x, 0, 7, 'spruce_fence') }
  return { cells: g.cells(), rooms: [] }
}

// ---------- BOISKO DO QUIDDITCHA: owalna arena z wiezami trybun w barwach domow i obrecze na bramkach ----------
function quidditch() {
  const g = grid()
  const A = 42
  const B = 22
  const cz = B + 6
  const COLS = ['red', 'yellow', 'green', 'blue']
  const N = 20
  for (let i = 0; i < N; i++) {
    const ang = i / N * Math.PI * 2
    const x = Math.round(Math.cos(ang) * A)
    const z = Math.round(Math.sin(ang) * B) + cz
    const col = COLS[i % 4]
    const h = 12 + (i % 2) * 4
    for (let y = 0; y < h; y++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) g.set(x + dx, y, z + dz, 'spruce_log')
    // trybuna: skrzynka z kolorowymi scianami, dach w paski
    g.shell(x - 2, x + 3, h, h + 3, z - 2, z + 3, (xx, y) => y === h + 1 ? 'air_dummy' : `${col}_wool`, 'spruce_planks', null)
    g.hipRoof(x - 2, x + 3, z - 2, z + 3, h + 4, `${col}_concrete`, 'yellow_concrete')
  }
  for (const c of g.cells()) if (c.block === 'air_dummy') g.cut(c.x, c.y, c.z)
  // bramki: po 3 obrecze z kazdej strony
  for (const side of [-1, 1]) {
    for (const [dz, h] of [[-5, 14], [0, 18], [5, 14]]) {
      const x = side * (A - 9)
      const z = cz + dz
      for (let y = 0; y < h; y++) g.set(x, y, z, 'gold_block')
      for (let a = 0; a < 24; a++) {
        const ang = a / 24 * Math.PI * 2
        g.set(x, h + 2 + Math.round(Math.sin(ang) * 2), z + Math.round(Math.cos(ang) * 2), 'gold_block')
      }
    }
  }
  // linia srodkowa i kolo
  for (let z = cz - B + 4; z <= cz + B - 4; z++) g.set(0, -1, z, 'white_concrete')
  for (let a = 0; a < 40; a++) g.set(Math.round(Math.cos(a / 40 * Math.PI * 2) * 5), -1, cz + Math.round(Math.sin(a / 40 * Math.PI * 2) * 5), 'white_concrete')
  return { cells: g.cells(), rooms: [] }
}

// ---------- BIJACA WIERZBA: gruby, skrecony pien i dlugie zwisajace galezie ----------
function wierzba() {
  const g = grid()
  const LOG = 'oak_log'
  for (let y = 0; y < 12; y++) {
    const ox = Math.round(Math.sin(y / 3) * 1.2)
    const oz = Math.round(Math.cos(y / 4) * 1.0)
    for (const [dx, dz] of disk(y < 3 ? 2 : 1)) g.set(ox + dx, y, 6 + oz + dz, LOG)
  }
  // korzenie
  for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2]]) g.set(dx, 0, 6 + dz, LOG)
  // galezie: na boki i w gore, z koncow zwisaja liscie
  for (let a = 0; a < 9; a++) {
    const ang = a / 9 * Math.PI * 2
    let x = 0, y = 9 + (a % 3), z = 6
    for (let s = 0; s < 8; s++) {
      x = Math.round(Math.cos(ang) * s * 1.1)
      z = 6 + Math.round(Math.sin(ang) * s * 1.1)
      y = 9 + (a % 3) + Math.round(Math.sin(s / 3) * 2)
      g.set(x, y, z, LOG)
      if (s > 2) g.set(x, y + 1, z, 'oak_leaves')
    }
    for (let d = 1; d <= 6; d++) g.set(x, y - d, z, 'oak_leaves') // zwisajace "witki"
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let d = 0; d <= 3; d++) g.set(x + dx, y - d, z + dz, 'oak_leaves')
  }
  for (const [dx, dz] of disk(4)) g.set(dx, 13, 6 + dz, 'oak_leaves')
  return { cells: g.cells(), rooms: [] }
}

// ---------- zapis (mod: kto je stworzyl - przy wylaczeniu modu znikaja) ----------
function save(Designer, dir, key, description, cells, rooms, modId, presupported) {
  const r = presupported || Designer.fromCells(cells, rooms)
  const solid = r.cells.filter(c => c.block !== 'air')
  // miniatura: male budowle w calosci, duze - zmniejszone 3 razy
  const k = solid.length > 30000 ? 3 : 1
  const thumb = new Map()
  for (const c of solid) {
    if (c.temp) continue
    const t = `${Math.floor(c.x / k)},${Math.floor(c.y / k)},${Math.floor(c.z / k)}`
    const prev = thumb.get(t)
    if (!prev || (prev.block === 'grass_block' && c.block !== 'grass_block')) thumb.set(t, { x: Math.floor(c.x / k), y: Math.floor(c.y / k), z: Math.floor(c.z / k), block: c.block })
  }
  const rec = {
    key, name: key, description, spec: { name: key, description, generated: 'mod: Wiecej budowli', parts: [] },
    plan: r.cells, rooms: rooms || [], ahead: r.ahead, size: r.size, blocks: solid.length, thumb: [...thumb.values()], mod: modId, created: Date.now()
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, key.replace(/ /g, '_') + '.json'), JSON.stringify(rec))
  return { key, blocks: solid.length, size: r.size }
}

function makeAll(Designer, dir, modId = 'budowle') {
  const done = []
  const big = require('./harry/wielki-hogwart.js').generate()
  done.push(save(Designer, dir, 'wielki hogwart', 'Zamek szkoly magii na skale, prawie 1:1, z jasnozoltego kamienia, z oswietleniem (latarnie w salach, na pietrach wiez i wzdluz sciezek). Wielka Sala, wieze, biblioteka, klasy, szklarnie. Tajne przejscia na tlokach: biblioteka - Komnata Tajemnic w skale, Wielka Sala - Pokoj Zyczen, skrzydlo transmutacji - lochy. Budowany dzialkami 16x16 - wiele botow naraz.', big.cells, big.rooms, modId))
  const small = require('./harry/maly-hogwart.js').build(Designer)
  done.push(save(Designer, dir, 'hogwart', small.spec.description, null, small.rooms, modId, small.result))
  done.push(save(Designer, dir, 'nora', 'Nora - krzywy, wysoki dom Weasleyow: pietra dostawiane jedno na drugim, czerwone daszki, kominy, ogrodek z dyniami i szopa na miotly.', ...Object.values(nora()), modId))
  done.push(save(Designer, dir, 'ulica pokatna', 'Ulica Pokatna: kreta uliczka kolorowych sklepow z wystawami i szyldami, na poczatku Dziurawy Kociol z ceglanym przejsciem, na koncu bialy bank Gringotta z kolumnami.', ...Object.values(pokatna()), modId))
  done.push(save(Designer, dir, 'peron 9 3 4', 'Peron 9 i 3/4: ceglane luki, szklany dach, tablica 9 3/4 i czerwony ekspres do Hogwartu (lokomotywa i 3 wagony).', ...Object.values(peron()), modId))
  done.push(save(Designer, dir, 'chatka hagrida', 'Chatka Hagrida: okragla kamienna chata ze strzecha, wielkie drzwi, komin i grzadka dyni.', ...Object.values(chatka()), modId))
  done.push(save(Designer, dir, 'boisko quidditch', 'Boisko do quidditcha: owal 20 wiez trybun w barwach domow i po 3 zlote obrecze na kazdej bramce.', ...Object.values(quidditch()), modId))
  done.push(save(Designer, dir, 'bijaca wierzba', 'Bijaca Wierzba: gruby, skrecony pien i dlugie zwisajace galezie.', ...Object.values(wierzba()), modId))
  return { done, errors: [] }
}

module.exports = { makeAll }
