// Generator projektu "wielki hogwart": zamek szkoly magii na skale, w skali ok. 1 blok = 1 metr (na wzor zdjec zamku).
// Uzycie: node tools/hogwart-wielki.js <folder-projektow>   (np. "D:/Minecraft Bot/Dane/projekty")
// Uklad jak w planach bota: x w prawo, z do przodu (od bota), y w gore; y = 0 to poziom gruntu przed skala.
const path = require('path')
const fs = require('fs')
const Designer = require('../gui/designer.js')
const md = require('minecraft-data')
const ver = ['1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.6', '1.21.5', '1.21.4'].find(v => { try { return md(v) } catch { return false } })
Designer.setBlocks(md(ver).blocksArray.map(b => b.name))

const outDir = process.argv[2] || path.join(__dirname, '..')

// ---------- siatka ----------
const cells = new Map()
const K = (x, y, z) => x + ',' + y + ',' + z
const set = (x, y, z, block, extra) => cells.set(K(x, y, z), Object.assign({ x, y, z, block }, extra || {}))
const cut = (x, y, z) => cells.delete(K(x, y, z))
const has = (x, y, z) => cells.has(K(x, y, z))

// powtarzalny "los" - faktura scian i skaly za kazdym razem taka sama
const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
const pick = (list, x, y, z) => { let r = hash(x, y, z); for (const [b, p] of list) { if ((r -= p) < 0) return b } return list[0][0] }
const WALL_MIX = [['stone_bricks', 0.6], ['cracked_stone_bricks', 0.1], ['andesite', 0.12], ['tuff_bricks', 0.18]]
const ROCK_MIX = [['stone', 0.42], ['andesite', 0.25], ['tuff', 0.15], ['cobblestone', 0.12], ['mossy_cobblestone', 0.06]]
const wall = (x, y, z) => set(x, y, z, pick(WALL_MIX, x, y, z))
const TRIM = 'polished_andesite'
const ROOF = 'deepslate_tiles'
const GLASS = 'gray_stained_glass'
const TIP = 'lightning_rod'

const H = 16 // wysokosc skaly; budynki stoja od y = H
const Y0 = H

// ---------- ksztalty ----------
const disk = r => { const a = []; for (let dx = -r - 1; dx <= r + 1; dx++) for (let dz = -r - 1; dz <= r + 1; dz++) if (dx * dx + dz * dz <= (r + 0.4) * (r + 0.4)) a.push([dx, dz]); return a }
const inDisk = (r, dx, dz) => dx * dx + dz * dz <= (r + 0.4) * (r + 0.4)
const ringOf = r => disk(r).filter(([dx, dz]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !inDisk(r, dx + a, dz + b)))

// stozkowy dach (2 bloki grubosci - kazda warstwa ma oparcie w nizszej), na koncu iglica
function cone(cx, cz, y, r, rise, tip = TIP) {
  let t = 0
  for (let rho = r; rho >= 0; rho--) {
    for (let k = 0; k < rise; k++, t++) {
      for (const [dx, dz] of disk(rho)) if (!inDisk(rho - 2, dx, dz) || rho <= 1) set(cx + dx, y + t, cz + dz, ROOF)
    }
  }
  set(cx, y + t, cz, tip)
  return y + t
}

// OKRAGLA WIEZA: sciany, okna-szczeliny, pietra z drabina, kolnierz i stozek
function roundTower({ cx, cz, y0 = Y0, r, h, rise = 3, door = null, floors = 7, flat = false }) {
  for (const [dx, dz] of disk(r)) set(cx + dx, y0 - 1, cz + dz, TRIM)
  const ring = ringOf(r)
  const ringSet = new Set(ring.map(([a, b]) => a + ',' + b))
  for (let y = y0; y < y0 + h; y++) {
    for (const [dx, dz] of ring) wall(cx + dx, y, cz + dz)
    for (const [dx, dz] of disk(r)) if (!ringSet.has(dx + ',' + dz)) cut(cx + dx, y, cz + dz)
  }
  // okna: 8 kierunkow, co 6 blokow, po 2 w gore
  if (r >= 2) {
    for (let y = y0 + 3; y < y0 + h - 3; y += 6) {
      for (let a = 0; a < 8; a++) {
        if (r < 4 && a % 2) continue
        const dx = Math.round(r * Math.cos(a * Math.PI / 4))
        const dz = Math.round(r * Math.sin(a * Math.PI / 4))
        if (!ringSet.has(dx + ',' + dz)) continue
        set(cx + dx, y, cz + dz, GLASS, { optional: true })
        set(cx + dx, y + 1, cz + dz, GLASS, { optional: true })
      }
    }
  }
  // drabina przy scianie (naprzeciw drzwi) i podlogi co kilka blokow
  const opp = door ? { x: -door.x, z: -door.z } : { x: 0, z: 1 }
  const lx = cx + opp.x * (r - 1)
  const lz = cz + opp.z * (r - 1)
  if (r >= 2) {
    for (let y = y0; y < y0 + h; y++) set(lx, y, lz, 'ladder', { attach: { x: opp.x, z: opp.z } })
    for (let y = y0 + floors; y < y0 + h - 2; y += floors) {
      for (const [dx, dz] of disk(r - 1)) if (!(cx + dx === lx && cz + dz === lz)) set(cx + dx, y - 1, cz + dz, 'spruce_planks')
    }
  }
  if (door) for (let y = y0; y < y0 + 3; y++) cut(cx + door.x * r, y, cz + door.z * r)
  // kolnierz (szerszy pierscien) i dach
  const top = y0 + h
  for (const [dx, dz] of disk(r + 1)) set(cx + dx, top, cz + dz, TRIM)
  if (flat) {
    for (const [dx, dz] of ringOf(r + 1)) if ((dx + dz) % 2 === 0) set(cx + dx, top + 1, cz + dz, 'stone_brick_wall')
    return top + 1
  }
  return cone(cx, cz, top + 1, r + 1, rise)
}

// KWADRATOWA WIEZA z narozami, oknami, wiezyczkami na rogach i iglica
function squareTower({ x1, z1, s, y0 = Y0, h, rise = 3, door = null, floors = 7, clock = false }) {
  const x2 = x1 + s - 1
  const z2 = z1 + s - 1
  const cx = (x1 + x2) / 2
  const cz = (z1 + z2) / 2
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) set(x, y0 - 1, z, TRIM)
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x1; x <= x2; x++) {
      for (let z = z1; z <= z2; z++) {
        if (x === x1 || x === x2 || z === z1 || z === z2) wall(x, y, z)
        else cut(x, y, z)
      }
    }
    // narozne pilastry
    for (const [x, z] of [[x1 - 1, z1], [x1, z1 - 1], [x2 + 1, z1], [x2, z1 - 1], [x1 - 1, z2], [x1, z2 + 1], [x2 + 1, z2], [x2, z2 + 1]]) if (y < y0 + h - 2) set(x, y, z, TRIM)
  }
  set(x1 - 1, y0 - 1, z1, TRIM); set(x1, y0 - 1, z1 - 1, TRIM); set(x2 + 1, y0 - 1, z1, TRIM); set(x2, y0 - 1, z1 - 1, TRIM)
  set(x1 - 1, y0 - 1, z2, TRIM); set(x1, y0 - 1, z2 + 1, TRIM); set(x2 + 1, y0 - 1, z2, TRIM); set(x2, y0 - 1, z2 + 1, TRIM)
  // wysokie okna na kazdej scianie co 8 blokow
  const mid = [Math.floor(cx), Math.ceil(cx)]
  const midz = [Math.floor(cz), Math.ceil(cz)]
  for (let y = y0 + 4; y < y0 + h - 5; y += 8) {
    for (let k = 0; k < 4; k++) {
      for (const m of mid) { set(m, y + k, z1, GLASS, { optional: true }); set(m, y + k, z2, GLASS, { optional: true }) }
      for (const m of midz) { set(x1, y + k, m, GLASS, { optional: true }); set(x2, y + k, m, GLASS, { optional: true }) }
    }
  }
  // drabina i pietra
  const lx = x2 - 1
  const lz = z2 - 1
  for (let y = y0; y < y0 + h; y++) set(lx, y, lz, 'ladder', { attach: { x: 1, z: 0 } })
  for (let y = y0 + floors; y < y0 + h - 2; y += floors) for (let x = x1 + 1; x < x2; x++) for (let z = z1 + 1; z < z2; z++) if (!(x === lx && z === lz)) set(x, y - 1, z, 'spruce_planks')
  if (door) for (let y = y0; y < y0 + 4; y++) for (const m of (door.z ? mid : midz)) door.z ? cut(m, y, door.z < 0 ? z1 : z2) : cut(door.x < 0 ? x1 : x2, y, m)
  // zegar na froncie
  if (clock) {
    const cy = y0 + h - 6
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (dx * dx + dy * dy <= 5) set(Math.round(cx) + dx, cy + dy, z1 - 1, dx === 0 && dy === 0 ? 'black_concrete' : 'white_concrete')
    set(Math.round(cx), cy + 1, z1 - 2, 'black_concrete'); set(Math.round(cx) + 1, cy, z1 - 2, 'black_concrete')
    for (let dx = -2; dx <= 2; dx++) set(Math.round(cx) + dx, cy - 3, z1 - 1, TRIM)
  }
  // gzyms (szerszy o 1), wiezyczki na rogach, iglica
  const top = y0 + h
  for (let x = x1 - 1; x <= x2 + 1; x++) for (let z = z1 - 1; z <= z2 + 1; z++) set(x, top, z, TRIM)
  for (const [x, z] of [[x1 - 1, z1 - 1], [x2 + 1, z1 - 1], [x1 - 1, z2 + 1], [x2 + 1, z2 + 1]]) {
    for (let y = top + 1; y <= top + 4; y++) set(x, y, z, 'stone_brick_wall')
    set(x, top + 5, z, TIP)
  }
  let y = top + 1
  for (let d = 0; x1 + d <= x2 - d; d++) {
    for (let k = 0; k < rise; k++, y++) {
      for (let x = x1 + d; x <= x2 - d; x++) {
        for (let z = z1 + d; z <= z2 - d; z++) {
          const edge = Math.min(x - x1 - d, x2 - d - x, z - z1 - d, z2 - d - z)
          if (edge <= 1) set(x, y, z, ROOF)
        }
      }
    }
  }
  set(Math.round(cx), y, Math.round(cz), TIP)
  return y
}

// HALA (Wielka Sala, skrzydla): sciany, przypory z pinaklami, wysokie okna, stromy dach dwuspadowy (albo plaski z blankami)
function hall({ x1, x2, z1, z2, y0 = Y0, h, axis = 'x', rise = 1, buttress = 6, flat = false, rows = 1, floorBlock = TRIM }) {
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) set(x, y0 - 1, z, floorBlock)
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x1; x <= x2; x++) {
      for (let z = z1; z <= z2; z++) {
        if (x === x1 || x === x2 || z === z1 || z === z2) wall(x, y, z)
        else cut(x, y, z)
      }
    }
  }
  const along = axis === 'x' ? [x1, x2] : [z1, z2]
  const across = axis === 'x' ? [z1, z2] : [x1, x2]
  const P = (a, b, y, block, extra) => axis === 'x' ? set(a, y, b, block, extra) : set(b, y, a, block, extra)
  // przypory na dlugich scianach, miedzy nimi okna
  for (let a = along[0] + 2; a <= along[1] - 2; a++) {
    const k = (a - along[0] - 2) % buttress
    for (const [side, out] of [[across[0], -1], [across[1], 1]]) {
      if (k === 0) {
        for (let y = y0 - 1; y < y0 + h; y++) {
          P(a, side + out, y, TRIM)
          if (y < y0 + h - 4) P(a, side + 2 * out, y, TRIM)
        }
        // pinakiel nad przypora
        for (let y = y0 + h; y < y0 + h + 3; y++) P(a, side + out, y, 'stone_brick_wall')
        P(a, side + out, y0 + h + 3, TIP)
      } else if (k === Math.floor(buttress / 2) || (buttress >= 6 && k === Math.floor(buttress / 2) + 1)) {
        const tall = flat ? Math.max(2, Math.floor((h - 4) / rows) - 2) : h - 7
        for (let r = 0; r < rows; r++) {
          const yb = y0 + 2 + r * Math.floor((h - 2) / rows)
          for (let y = yb; y < yb + tall; y++) P(a, side, y, GLASS, { optional: true })
          P(a, side, yb + tall, 'chiseled_stone_bricks')
        }
      }
    }
  }
  const top = y0 + h
  const width = across[1] - across[0] + 1
  if (flat) {
    // plaski dach z blankami
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) set(x, top, z, TRIM)
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) if ((x === x1 || x === x2 || z === z1 || z === z2) && (x + z) % 2 === 0) wall(x, top + 1, z)
    return top + 1
  }
  // dach dwuspadowy: warstwami do srodka, 2 bloki grubosci; szczyty na koncach zamurowane
  let y = top
  for (let d = 0; d <= Math.floor((width - 1) / 2); d++) {
    for (let k = 0; k < rise; k++, y++) {
      for (let a = along[0]; a <= along[1]; a++) {
        for (let b = across[0] + d; b <= across[1] - d; b++) {
          const inner = b - across[0] - d >= 2 && across[1] - d - b >= 2
          const end = a === along[0] || a === along[1]
          if (!inner) P(a, b, y, ROOF)
          else if (end) P(a, b, y, pick(WALL_MIX, a, y, b))
        }
      }
    }
  }
  return y
}

// mur obronny miedzy dwoma punktami (gruby na 3, z blankami)
function rampart(ax, az, bx, bz, h = 9, y0 = Y0) {
  const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az))
  const done = new Set()
  for (let i = 0; i <= n; i++) {
    const x = Math.round(ax + (bx - ax) * i / n)
    const z = Math.round(az + (bz - az) * i / n)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const k = (x + dx) + ',' + (z + dz)
        if (done.has(k)) continue
        done.add(k)
        set(x + dx, y0 - 1, z + dz, TRIM)
        for (let y = y0; y < y0 + h; y++) wall(x + dx, y, z + dz)
        if ((x + dx + z + dz) % 2 === 0) wall(x + dx, y0 + h, z + dz)
      }
    }
  }
}

// szklarnia: szklane sciany i dach na kamiennym cokole
function greenhouse(x1, x2, z1, z2, y0 = Y0) {
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) set(x, y0 - 1, z, TRIM)
  const h = 4
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
      if (!(x === x1 || x === x2 || z === z1 || z === z2)) continue
      const post = (x - x1) % 3 === 0 && (z === z1 || z === z2) || (z - z1) % 3 === 0 && (x === x1 || x === x2)
      set(x, y, z, y === y0 ? TRIM : post ? 'white_concrete' : 'glass', post || y === y0 ? {} : { optional: true })
    }
  }
  const w = z2 - z1 + 1
  let y = y0 + h
  for (let d = 0; d <= Math.floor((w - 1) / 2); d++, y++) {
    for (let x = x1; x <= x2; x++) for (let z = z1 + d; z <= z2 - d; z++) {
      const edge = z - z1 - d <= 1 || z2 - d - z <= 1
      if (edge || x === x1 || x === x2) set(x, y, z, (x - x1) % 3 === 0 ? 'white_concrete' : 'glass', (x - x1) % 3 === 0 ? {} : { optional: true })
    }
  }
}
function glassDome(cx, cz, r, y0 = Y0) {
  for (const [dx, dz] of disk(r)) set(cx + dx, y0 - 1, cz + dz, TRIM)
  for (const [dx, dz] of ringOf(r)) { set(cx + dx, y0, cz + dz, TRIM); set(cx + dx, y0 + 1, cz + dz, 'glass', { optional: true }) }
  for (let k = 0; k <= r; k++) {
    const rr = Math.round(Math.sqrt(r * r - k * k))
    for (const [dx, dz] of disk(rr)) if (!inDisk(rr - 2, dx, dz) || rr <= 1) set(cx + dx, y0 + 2 + k, cz + dz, (dx === 0 || dz === 0) ? 'white_concrete' : 'glass', (dx === 0 || dz === 0) ? {} : { optional: true })
  }
  set(cx, y0 + 3 + r, cz, TIP)
}

// ---------- SKALA pod zamkiem ----------
// obrys szczytu (wielokat) z "poszarpanym" brzegiem; nizej skala jest szersza (opada w strone gruntu)
const POLY = [[-88, 10], [-50, 4], [0, 6], [50, 2], [90, 8], [94, 40], [90, 80], [70, 112], [40, 122], [0, 124], [-40, 120], [-75, 112], [-90, 80], [-92, 40]]
function inPoly(x, z) {
  let c = false
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [xi, zi] = POLY[i]; const [xj, zj] = POLY[j]
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c
  }
  return c
}
function edgeDist(x, z) {
  let best = Infinity
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [ax, az] = POLY[j]; const [bx, bz] = POLY[i]
    const vx = bx - ax; const vz = bz - az
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)))
    best = Math.min(best, Math.hypot(x - ax - t * vx, z - az - t * vz))
  }
  return inPoly(x, z) ? best : -best
}
// gladki szum na siatce co 7 blokow
function noise(x, z) {
  const g = 7
  const x0 = Math.floor(x / g); const z0 = Math.floor(z / g)
  const fx = x / g - x0; const fz = z / g - z0
  const v = (a, b) => hash(a, 99, b) * 2 - 1
  const sx = fx * fx * (3 - 2 * fx); const sz = fz * fz * (3 - 2 * fz)
  return (v(x0, z0) * (1 - sx) + v(x0 + 1, z0) * sx) * (1 - sz) + (v(x0, z0 + 1) * (1 - sx) + v(x0 + 1, z0 + 1) * sx) * sz
}
const D = new Map()
const dAt = (x, z) => { const k = x + ',' + z; if (!D.has(k)) D.set(k, edgeDist(x, z) + noise(x, z) * 2.5); return D.get(k) }
const insideAt = (x, y, z) => dAt(x, z) > -(H - 1 - y) / 3 // na dole skala wystaje ok. 5 blokow dalej
function rock() {
  for (let x = -100; x <= 104; x++) {
    for (let z = -6; z <= 134; z++) {
      if (dAt(x, z) < -6) continue
      for (let y = 0; y < H; y++) {
        if (!insideAt(x, y, z)) continue
        // powierzchnia: przy brzegu (2 bloki grubosci) albo odslonieta od gory
        let shell = y === H - 1 || !insideAt(x, y + 1, z)
        for (let dx = -2; dx <= 2 && !shell; dx++) for (let dz = -2; dz <= 2 && !shell; dz++) if (!insideAt(x + dx, y, z + dz)) shell = true
        const pillar = ((x % 8) + 8) % 8 === 0 && ((z % 8) + 8) % 8 === 0 // filary pod plaskim szczytem (kazda dzialka ma oparcie)
        if (y === H - 1) set(x, y, z, 'grass_block')
        else if (shell || pillar) set(x, y, z, pick(ROCK_MIX, x, y, z))
      }
    }
  }
}

// ---------- ZAMEK ----------
rock()

// sciezki na szczycie skaly
const path_ = (x1, x2, z1, z2) => { for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) set(x, H - 1, z, (x + z) % 5 === 0 ? 'cobblestone' : 'stone_bricks') }
path_(-32, -28, 4, 18) // od schodow do wejscia
path_(-24, 40, 44, 48) // dziedziniec przed Wielka Sala
path_(-2, 2, 72, 96) // do wiezy astronomicznej

// wejscie: dwie wysokie kwadratowe wieze jak w katedrze i budynek miedzy nimi (sala wejsciowa)
squareTower({ x1: -47, z1: 16, s: 11, h: 48, rise: 3 })
squareTower({ x1: -23, z1: 16, s: 11, h: 48, rise: 3 })
hall({ x1: -37, x2: -23, z1: 18, z2: 40, h: 24, axis: 'z', rise: 1, buttress: 7 })
for (let y = Y0; y < Y0 + 7; y++) for (let x = -31; x <= -29; x++) cut(x, y, 18) // wielka brama
for (const x of [-32, -28]) for (let y = Y0; y <= Y0 + 7; y++) set(x, y, 18, 'chiseled_stone_bricks')
for (let x = -31; x <= -29; x++) set(x, Y0 + 7, 18, 'chiseled_stone_bricks')
for (let y = Y0; y < Y0 + 3; y++) { cut(-37, y, 22); cut(-38, y, 22); cut(-23, y, 22) } // przejscia do wiez
for (let y = Y0 + 12; y < Y0 + 20; y++) for (const x of [-31, -30, -29]) set(x, y, 18, 'light_blue_stained_glass', { optional: true }) // rozeta nad brama

// lacznik do Wielkiej Sali
hall({ x1: -32, x2: -24, z1: 40, z2: 52, h: 14, axis: 'z', rise: 1, buttress: 5 })
for (let y = Y0; y < Y0 + 5; y++) for (let x = -30; x <= -26; x++) { cut(x, y, 40); cut(x, y, 52) }

// WIELKA SALA: dluga, wysoka, z przyporami i stromym dachem
hall({ x1: -32, x2: 22, z1: 52, z2: 70, h: 22, axis: 'x', rise: 1, buttress: 6 })
for (let y = Y0; y < Y0 + 5; y++) for (let x = -30; x <= -26; x++) cut(x, y, 52)
// stoly, swiece, "plywajace" latarnie, stol nauczycieli
for (const z of [55, 58, 64, 67]) {
  for (let x = -26; x <= 12; x++) set(x, Y0, z, 'spruce_planks')
  for (let x = -25; x <= 12; x += 3) set(x, Y0 + 1, z, 'candle', { optional: true })
  for (let x = -24; x <= 12; x += 6) set(x, Y0 + 21, z, 'lantern', { attach: { x: 0, y: 1, z: 0 }, late: true, optional: true })
}
for (let x = 15; x <= 20; x++) for (let z = 54; z <= 68; z++) set(x, Y0, z, TRIM)
for (let z = 56; z <= 66; z++) { set(17, Y0 + 1, z, 'dark_oak_planks'); set(19, Y0 + 1, z, 'dark_oak_stairs', { facing: { x: 1, z: 0 }, optional: true }) }
set(19, Y0 + 1, 61, 'gold_block')
// narozne wiezyczki Wielkiej Sali
for (const [x, z] of [[-33, 51], [-33, 71], [21, 51]]) roundTower({ cx: x, cz: z, r: 2, h: 28, rise: 3 })

// WIELKA OKRAGLA WIEZA z ogromnym stozkiem (przy koncu Wielkiej Sali)
roundTower({ cx: 31, cz: 61, r: 8, h: 40, rise: 3, door: { x: -1, z: 0 } })
for (let y = Y0; y < Y0 + 4; y++) for (let z = 60; z <= 62; z++) { cut(22, y, z); cut(23, y, z) }

// WIEZA ASTRONOMICZNA - najwyzsza, z przylegajacymi wiezyczkami
roundTower({ cx: -6, cz: 100, r: 5, h: 66, rise: 3, door: { x: 0, z: -1 } })
roundTower({ cx: -12, cz: 95, r: 3, h: 56, rise: 3 })
roundTower({ cx: 0, cz: 106, r: 2, h: 50, rise: 3 })

// dziedziniec z wieza zegarowa (prawa strona)
squareTower({ x1: 52, z1: 8, s: 9, h: 34, rise: 2, door: { x: 0, z: 1 }, clock: true })
hall({ x1: 40, x2: 51, z1: 12, z2: 20, h: 16, axis: 'x', rise: 1, buttress: 5 })
hall({ x1: 61, x2: 76, z1: 12, z2: 20, h: 16, axis: 'x', rise: 1, buttress: 5 })
hall({ x1: 68, x2: 76, z1: 21, z2: 60, h: 16, axis: 'z', rise: 1, buttress: 6 })
for (let y = Y0; y < Y0 + 4; y++) { for (const z of [15, 16, 17]) { cut(51, y, z); cut(52, y, z); cut(60, y, z); cut(61, y, z) } }

// galeria z arkadami: od wielkiej wiezy do skrzydla przy dziedzincu
hall({ x1: 40, x2: 67, z1: 58, z2: 64, h: 10, axis: 'x', flat: true, buttress: 4, rows: 2 })
for (let y = Y0; y < Y0 + 4; y++) for (let z = 60; z <= 62; z++) { cut(39, y, z); cut(40, y, z); cut(67, y, z); cut(68, y, z) }

// biblioteka (lewe skrzydlo z tylu)
hall({ x1: -62, x2: -36, z1: 76, z2: 90, h: 18, axis: 'x', rise: 1, buttress: 6 })
for (let x = -60; x <= -38; x++) for (const z of [77, 89]) for (let y = Y0; y < Y0 + 4; y++) set(x, y, z, 'bookshelf')
for (const x of [-56, -51, -46, -41]) for (let z = 80; z <= 86; z++) for (let y = Y0; y < Y0 + 3; y++) set(x, y, z, 'bookshelf')
for (let y = Y0; y < Y0 + 4; y++) for (let x = -50; x <= -48; x++) cut(x, y, 76)

// kolejne skrzydla z klasami - zamek jest gesto zabudowany
hall({ x1: 28, x2: 60, z1: 30, z2: 42, h: 18, axis: 'x', rise: 1, buttress: 6 }) // skrzydlo transmutacji (miedzy Wielka Sala a dziedzincem)
for (let y = Y0; y < Y0 + 4; y++) for (let x = 42; x <= 44; x++) cut(x, y, 30)
hall({ x1: 30, x2: 56, z1: 76, z2: 90, h: 20, axis: 'x', rise: 1, buttress: 6 }) // skrzydlo wschodnie (z tylu)
for (let y = Y0; y < Y0 + 4; y++) for (let x = 42; x <= 44; x++) cut(x, y, 76)
roundTower({ cx: 62, cz: 83, r: 5, h: 48, rise: 3, door: { x: -1, z: 0 } }) // wieza przy skrzydle wschodnim
for (let y = Y0; y < Y0 + 3; y++) cut(56, y, 83)
hall({ x1: -74, x2: -42, z1: 46, z2: 58, h: 16, axis: 'x', rise: 1, buttress: 6 }) // skrzydlo zachodnie
for (let y = Y0; y < Y0 + 4; y++) for (let x = -58; x <= -56; x++) cut(x, y, 58)
roundTower({ cx: -40, cz: 66, r: 4, h: 42, rise: 3, door: { x: 0, z: -1 } }) // wieza miedzy biblioteka a Wielka Sala
hall({ x1: -20, x2: 8, z1: 76, z2: 88, h: 14, axis: 'x', rise: 1, buttress: 5 }) // kruzganek przed wieza astronomiczna
for (let y = Y0; y < Y0 + 4; y++) for (let x = -2; x <= 2; x++) { cut(x, y, 76); cut(x, y, 88) }

// szklarnie i oranzeria z kopula (z przodu po lewej)
greenhouse(-82, -62, 16, 24)
greenhouse(-82, -62, 28, 36)
glassDome(-55, 30, 5)

// wiezyczki na brzegach skaly i mury miedzy nimi
const TURRETS = [[-72, 56, 3, 30], [-68, 100, 3, 34], [36, 112, 3, 30], [60, 100, 4, 38], [82, 28, 3, 26], [84, 72, 3, 28], [20, 100, 4, 44], [-50, 8, 3, 24], [-84, 28, 2, 20]]
rampart(-72, 56, -68, 100)
rampart(-68, 100, -14, 113)
rampart(36, 112, 60, 100)
rampart(60, 100, 84, 72)
rampart(84, 72, 82, 28)
rampart(-72, 56, -64, 42)
for (const [x, z, r, h] of TURRETS) roundTower({ cx: x, cz: z, r, h, rise: 3 })

// schody z dolu na skale (przed brama), z murkami po bokach
for (let k = 0; k < H; k++) {
  const z = 6 - k
  const y = H - 1 - k
  for (let x = -32; x <= -28; x++) {
    for (let yy = 0; yy < y; yy++) set(x, yy, z, pick(ROCK_MIX, x, yy, z))
    set(x, y, z, 'stone_brick_stairs', { facing: { x: 0, z: 1 } })
    for (let yy = y + 1; yy < H + 3; yy++) cut(x, yy, z)
  }
  for (const x of [-33, -27]) { for (let yy = 0; yy <= y; yy++) set(x, yy, z, pick(ROCK_MIX, x, yy, z)); set(x, y + 1, z, 'stone_brick_wall') }
}

// ---------- zapis ----------
const r = Designer.fromCells([...cells.values()])
const solid = r.cells.filter(c => c.block !== 'air')
// miniatura: model zmniejszony 3 razy (do obrazka na liscie projektow)
const thumbMap = new Map()
for (const c of solid) {
  if (c.temp) continue
  const k = Math.floor(c.x / 3) + ',' + Math.floor(c.y / 3) + ',' + Math.floor(c.z / 3)
  const prev = thumbMap.get(k)
  if (!prev || (prev.block === 'grass_block' && c.block !== 'grass_block')) thumbMap.set(k, { x: Math.floor(c.x / 3), y: Math.floor(c.y / 3), z: Math.floor(c.z / 3), block: c.block })
}
const name = 'wielki hogwart'
const description = 'Zamek szkoly magii na skale, prawie 1:1. Wielka Sala, wejscie z dwiema wiezami, wielka okragla wieza, wieza astronomiczna (najwyzsza), wieza zegarowa z dziedzincem, galeria z arkadami, biblioteka, szklarnie z kopula, wiezyczki i mury. Budowany dzialkami 16x16 - moze go stawiac wiele botow naraz.'
const rec = {
  key: name, name, description,
  spec: { name, description, generated: 'tools/hogwart-wielki.js', parts: [] },
  plan: r.cells, rooms: [], ahead: r.ahead, size: r.size, blocks: solid.length, thumb: [...thumbMap.values()], created: Date.now()
}
fs.writeFileSync(path.join(outDir, 'wielki_hogwart.json'), JSON.stringify(rec))
console.log('bloki', solid.length, 'tymczasowe', solid.filter(c => c.temp).length, 'rozmiar', JSON.stringify(r.size), 'ahead', r.ahead, 'miniatura', thumbMap.size)
console.log(r.warnings.join(' | '))
console.log(r.materials.slice(0, 16).map(([n, c]) => `${n}:${c}`).join(' '))
