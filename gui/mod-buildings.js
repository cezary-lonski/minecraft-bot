// Mod "Wiecej budowli": posagi graczy ze skina (1 piksel skina = 1 blok), miedziana wanienka ze schodkow powiekszonych
// 16 razy (woda i lawa z kolorowych blokow) i inne smieszne budowle. Projekty trafiaja do folderu projektow programu,
// wiec bot buduje je zwyklym "buduj <nazwa>". Uzywane przez program (main.js).
const https = require('https')
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

// ---------- kolory blokow (srednie kolory tekstur) - do zamiany pikseli skina na bloki ----------
const PALETTE = {
  white_concrete: [207, 213, 214], orange_concrete: [224, 97, 0], magenta_concrete: [169, 48, 159], light_blue_concrete: [35, 137, 198],
  yellow_concrete: [241, 175, 21], lime_concrete: [94, 168, 24], pink_concrete: [213, 101, 142], gray_concrete: [54, 57, 61],
  light_gray_concrete: [125, 125, 115], cyan_concrete: [21, 119, 136], purple_concrete: [100, 31, 156], blue_concrete: [44, 46, 143],
  brown_concrete: [96, 59, 31], green_concrete: [73, 91, 36], red_concrete: [142, 32, 32], black_concrete: [8, 10, 15],
  white_terracotta: [209, 178, 161], orange_terracotta: [161, 83, 37], magenta_terracotta: [149, 88, 108], light_blue_terracotta: [113, 108, 137],
  yellow_terracotta: [186, 133, 35], lime_terracotta: [103, 117, 52], pink_terracotta: [161, 78, 78], gray_terracotta: [57, 42, 35],
  light_gray_terracotta: [135, 106, 97], cyan_terracotta: [86, 91, 91], purple_terracotta: [118, 70, 86], blue_terracotta: [74, 59, 91],
  brown_terracotta: [77, 51, 35], green_terracotta: [76, 83, 42], red_terracotta: [143, 61, 46], black_terracotta: [37, 22, 16], terracotta: [152, 94, 67],
  white_wool: [233, 236, 236], pink_wool: [237, 141, 172], light_blue_wool: [58, 175, 217], yellow_wool: [248, 197, 39], lime_wool: [112, 185, 25],
  orange_wool: [240, 118, 19], red_wool: [160, 39, 34], magenta_wool: [189, 68, 179], cyan_wool: [21, 137, 145], purple_wool: [121, 42, 172],
  snow_block: [249, 254, 254], quartz_block: [235, 229, 222], gold_block: [246, 208, 61], sandstone: [216, 203, 155], smooth_stone: [158, 158, 158],
  birch_planks: [192, 175, 121], oak_planks: [162, 130, 78], spruce_planks: [114, 84, 48], dark_oak_planks: [66, 43, 20], jungle_planks: [160, 115, 80],
  mushroom_stem: [203, 196, 185], bone_block: [229, 225, 207], iron_block: [220, 220, 220], stone: [125, 125, 125], andesite: [136, 136, 136],
  diamond_block: [98, 237, 228], emerald_block: [42, 203, 87], redstone_block: [175, 24, 5], lapis_block: [30, 67, 140], netherite_block: [66, 61, 63],
  pink_concrete_powder: [228, 153, 181], light_blue_concrete_powder: [74, 180, 213], yellow_concrete_powder: [232, 199, 54], white_concrete_powder: [225, 227, 227]
}
const PAL = Object.entries(PALETTE)
function nearestBlock(r, g, b) {
  let best = 'stone'
  let bd = Infinity
  for (const [name, [R, G, B]] of PAL) {
    // odleglosc "na oko" (czerwony i niebieski wazone zaleznie od jasnosci)
    const rm = (r + R) / 2
    const d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2
    if (d < bd) { bd = d; best = name }
  }
  return best
}

// ---------- PNG (skiny: 8 bitow, RGBA/RGB/paleta, bez przeplotu) ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('to nie jest PNG')
  let pos = 8
  let w = 0, h = 0, bitDepth = 0, colorType = 0, palette = null, trns = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; if (data[12]) throw new Error('PNG z przeplotem') }
    else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error('obslugiwane tylko 8 bitow')
  const ch = { 6: 4, 2: 3, 3: 1, 4: 2, 0: 1 }[colorType]
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(w * h * ch)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= ch ? out[y * stride + x - ch] : 0
      const b = y ? out[(y - 1) * stride + x] : 0
      const c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0
      let p = v
      if (f === 1) p = v + a
      else if (f === 2) p = v + b
      else if (f === 3) p = v + ((a + b) >> 1)
      else if (f === 4) { const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c); p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) }
      out[y * stride + x] = p & 255
    }
  }
  const px = (x, y) => {
    const i = (y * w + x) * ch
    if (colorType === 6) return [out[i], out[i + 1], out[i + 2], out[i + 3]]
    if (colorType === 2) return [out[i], out[i + 1], out[i + 2], 255]
    if (colorType === 4) return [out[i], out[i], out[i], out[i + 1]]
    if (colorType === 0) return [out[i], out[i], out[i], 255]
    const k = out[i]
    return [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255]
  }
  return { w, h, px }
}

// ---------- skin gracza z serwerow Mojang ----------
function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000, headers: { 'User-Agent': 'MinecraftBot' } }, res => {
      const parts = []
      res.on('data', d => parts.push(d))
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(res.statusCode === 404 || res.statusCode === 204 ? 'nie ma takiego gracza' : 'serwer Mojang: ' + res.statusCode)); try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))) } catch (e) { reject(e) } })
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('brak odpowiedzi')) })
  })
}
function getBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, res => {
      const parts = []
      res.on('data', d => parts.push(d))
      res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(parts)) : reject(new Error('skin: ' + res.statusCode)))
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('brak odpowiedzi')) })
  })
}
async function fetchSkin(nick) {
  const prof = await getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`)
  const sess = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${prof.id}`)
  const tex = JSON.parse(Buffer.from(sess.properties.find(p => p.name === 'textures').value, 'base64').toString('utf8'))
  const skin = tex.textures?.SKIN
  if (!skin) throw new Error('gracz nie ma wlasnego skina')
  return { name: prof.name, png: await getBuffer(skin.url.replace('http://', 'https://')), slim: skin.metadata?.model === 'slim' }
}

// ---------- POSAG ZE SKINA: 1 piksel = 1 blok (32 bloki wysokosci), w srodku pusty ----------
// Uklad jak w projektach bota: x w prawo (patrzac od bota), z do przodu, y w gore; posag patrzy na bota.
function statueCells(img, slim, pedestal = 'polished_andesite', opts = {}) {
  const cells = new Map()
  const put = (x, y, z, block) => cells.set(`${x},${y},${z}`, { x, y, z, block })
  const legacy = img.h === 32 // stare skiny 64x32: lewa reka/noga = odbicie prawej
  const color = (u, v) => {
    const [r, g, b, a] = img.px(u, v)
    return a < 128 ? null : nearestBlock(r, g, b)
  }
  // jedna czesc ciala: pudelko w x0..x0+w-1, y0..y0+h-1, z0..z0+d-1; tekstura od (u, v) jak w skinie Minecrafta
  function part(x0, y0, z0, w, h, d, u, v, ou, ov, mirror) {
    const tex = (uu, vv) => {
      const over = ou !== undefined && !legacy ? color(ou + uu - u, ov + vv - v) : null // druga warstwa skina (kaptur, kurtka)
      return over || color(uu, vv) || 'white_concrete'
    }
    const X = i => mirror ? x0 + w - 1 - i : x0 + i
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        put(X(i), y0 + h - 1 - j, z0, tex(u + d + i, v + d + j)) // przod
        put(X(w - 1 - i), y0 + h - 1 - j, z0 + d - 1, tex(u + 2 * d + w + i, v + d + j)) // tyl
      }
    }
    for (let k = 0; k < d; k++) {
      for (let j = 0; j < h; j++) {
        put(mirror ? x0 + w - 1 : x0, y0 + h - 1 - j, z0 + d - 1 - k, tex(u + k, v + d + j)) // prawy bok postaci (lewy dla patrzacego)
        put(mirror ? x0 : x0 + w - 1, y0 + h - 1 - j, z0 + k, tex(u + d + w + k, v + d + j)) // lewy bok postaci
      }
    }
    for (let i = 0; i < w; i++) {
      for (let k = 0; k < d; k++) {
        put(X(i), y0 + h - 1, z0 + d - 1 - k, tex(u + d + i, v + k)) // gora
        put(X(i), y0, z0 + k, tex(u + d + w + i, v + k)) // spod
      }
    }
  }
  const aw = slim ? 3 : 4
  const Y = 2 // nad cokolem
  // nogi i rece: prawa (postaci) jest po lewej stronie patrzacego
  part(-4, Y, 2, 4, 12, 4, 0, 16, 0, 32) // prawa noga
  if (legacy) part(0, Y, 2, 4, 12, 4, 0, 16, undefined, undefined, true); else part(0, Y, 2, 4, 12, 4, 16, 48, 0, 48) // lewa noga
  part(-4, Y + 12, 2, 8, 12, 4, 16, 16, 16, 32) // tulow
  part(-4 - aw, Y + 12, 2, aw, 12, 4, 40, 16, 40, 32) // prawa reka
  if (legacy) part(4, Y + 12, 2, aw, 12, 4, 40, 16, undefined, undefined, true); else part(4, Y + 12, 2, aw, 12, 4, 32, 48, 48, 48) // lewa reka
  part(-4, Y + 24, 0, 8, 8, 8, 0, 0, 32, 0) // glowa
  // stroj krola: czerwona peleryna do kolan, gronostajowy kolnierz na ramionach i miecz w prawej dloni
  if (opts.royal) {
    const ermine = (x, y, z) => (x * 3 + y * 5 + z * 7) % 6 === 0 ? 'black_wool' : 'white_wool'
    for (let x = -4 - aw; x <= 3 + aw; x++) {
      for (let y = Y + 6; y <= Y + 23; y++) put(x, y, 6, y >= Y + 22 ? ermine(x, y, 6) : (x === -4 - aw || x === 3 + aw) && y < Y + 22 ? 'red_concrete' : 'red_wool')
      for (let z = 2; z <= 6; z++) if (x < -4 || x > 3 || z === 6) put(x, Y + 24, z, ermine(x, Y + 24, z)) // kolnierz na ramionach
    }
    for (let x = -4 - aw; x <= 3 + aw; x++) put(x, Y + 6, 6, 'gold_block') // zloty brzeg peleryny
    const hx = -4 - Math.ceil(aw / 2) // prawa dlon (lewa strona patrzacego)
    put(hx, Y + 13, 1, 'dark_oak_planks'); put(hx, Y + 13, 0, 'dark_oak_planks')
    for (let x = hx - 1; x <= hx + 1; x++) put(x, Y + 13, -1, 'gold_block')
    for (let z = -2; z >= -9; z--) put(hx, Y + 13, z, z === -9 ? 'iron_block' : 'iron_block')
    put(hx, Y + 13, -10, 'light_gray_concrete')
  }
  // cokol
  for (let x = -10; x <= 9; x++) for (let z = -2; z <= 9; z++) { put(x, 0, z, pedestal); put(x, 1, z, x === -10 || x === 9 || z === -2 || z === 9 ? 'chiseled_stone_bricks' : pedestal) }
  return [...cells.values()]
}

// ---------- HEROBRINE: postac jak domyslna, ale z bialymi oczami (rysowana tu, bez pliku skina) ----------
function herobrineImg() {
  const SKIN = [190, 136, 108], SKIN2 = [170, 118, 90], HAIR = [60, 40, 22], EYE = [255, 255, 255], MOUTH = [120, 72, 60]
  const SHIRT = [0, 170, 175], SHIRT2 = [0, 140, 145], PANTS = [70, 60, 160], PANTS2 = [55, 48, 130], SHOE = [100, 100, 100]
  const px = (u, v) => {
    // glowa (0..32, 0..16)
    if (v < 16 && u < 32) {
      const face = u >= 8 && u < 16 && v >= 8 // przod glowy
      if (v < 8) return [...HAIR, 255] // gora i spod
      const row = v - 8
      if (face) {
        const c = u - 8
        if (row < 2) return [...HAIR, 255]
        if (row === 2 && (c === 0 || c === 7)) return [...HAIR, 255]
        if (row === 4 && (c === 1 || c === 2 || c === 5 || c === 6)) return [...EYE, 255] // biale oczy
        if (row === 6 && c >= 2 && c <= 5) return [...MOUTH, 255]
        if (row === 7 && c >= 2 && c <= 5) return [...SKIN2, 255]
        return [...SKIN, 255]
      }
      return row < 3 || (u >= 24 && row < 7) ? [...HAIR, 255] : [...SKIN, 255] // boki z wlosami, tyl prawie caly we wlosach
    }
    if (v < 16) return [0, 0, 0, 0] // kaptur - pusty
    if (v < 32) {
      if (u < 16) return v >= 29 ? [...SHOE, 255] : [...(u % 4 === 0 ? PANTS2 : PANTS), 255] // prawa noga
      if (u < 40) return [...(v < 22 ? SHIRT : v < 30 ? SHIRT2 : PANTS), 255] // tulow (dol koszuli)
      if (u < 56) return v < 24 ? [...SHIRT, 255] : [...SKIN, 255] // reka: krotki rekaw, potem dlon
    }
    if (v >= 48) {
      if (u >= 16 && u < 32) return v >= 61 ? [...SHOE, 255] : [...PANTS, 255] // lewa noga
      if (u >= 32 && u < 48) return v < 56 ? [...SHIRT, 255] : [...SKIN, 255] // lewa reka
    }
    return [0, 0, 0, 0]
  }
  return { w: 64, h: 64, px }
}

// ---------- MIEDZIANA WANIENKA: 4 schodki (zasniedziale, zawoskowane, zlobione) 2x2, kazdy powiekszony 16x ----------
// Schodki stoja wysoka czescia na zewnatrz (narozniki wewnetrzne) - razem robia wanne 32x32 z dziura 16x16.
// W srodku na ukos woda i lawa (kolorowe bloki), a gdzie sie stykaja - obsydian.
function tubCells() {
  const cells = []
  const copper = (x, y, z) => ((x % 8 === 0 || z % 8 === 0) && y % 8 !== 7) || y % 8 === 0 ? 'waxed_oxidized_copper' : 'waxed_oxidized_cut_copper'
  const H = 16
  for (let x = 0; x < 32; x++) {
    for (let z = 0; z < 32; z++) {
      const hole = x >= 8 && x < 24 && z >= 8 && z < 24
      for (let y = 0; y < H; y++) {
        if (y >= 8 && hole) continue
        // pelne tylko z zewnatrz (srodek pusty): sciany, spod, wierzch i dno dziury
        const outer = x === 0 || x === 31 || z === 0 || z === 31 || y === 0 || y === H - 1 || y === 7 || (y >= 8 && (x === 8 || x === 23 || z === 8 || z === 23) && !hole)
        if (outer) cells.push({ x: x - 16, y, z, block: copper(x, y, z) })
      }
    }
  }
  // ciecze: powierzchnia na wysokosci 14, pod nia kolorowe bloki (nie prawdziwa woda/lawa)
  for (let x = 8; x < 24; x++) {
    for (let z = 8; z < 24; z++) {
      const dx = x - 8, dz = z - 8
      const water = dx > dz
      const edge = dx === dz
      for (let y = 8; y <= 14; y++) {
        let b
        if (edge) b = 'obsidian'
        else if (water) b = y === 14 && (x * 7 + z * 3) % 11 === 0 ? 'light_blue_concrete' : y === 14 ? 'blue_concrete' : 'blue_terracotta'
        else b = y === 14 && (x * 5 + z * 7) % 9 === 0 ? 'yellow_concrete' : y === 14 && (x + z) % 7 === 0 ? 'red_concrete' : y === 14 ? 'orange_concrete' : 'orange_terracotta'
        cells.push({ x: x - 16, y, z, block: b })
      }
    }
  }
  return cells
}

// ---------- TORT 1 piksel = 1 blok: tort z Minecrafta (14x8x14) ze swieczka ----------
function cakeCells() {
  const cells = []
  for (let x = 0; x < 14; x++) {
    for (let z = 0; z < 14; z++) {
      for (let y = 0; y < 8; y++) {
        const edge = x === 0 || x === 13 || z === 0 || z === 13
        if (!edge && y > 0 && y < 7) continue
        let b
        if (y === 7) b = (x * 3 + z * 5) % 13 === 0 ? 'red_concrete' : (x * 7 + z) % 17 === 0 ? 'red_wool' : 'white_concrete'
        else if (y >= 5) b = (x + z + y) % 4 === 0 ? 'white_concrete' : 'snow_block' // lukier splywa
        else if (y === 3) b = 'red_terracotta' // warstwa dzemu
        else b = (x + y * 3 + z) % 5 === 0 ? 'brown_concrete' : 'brown_terracotta' // biszkopt
        cells.push({ x: x - 7, y, z, block: b })
      }
    }
  }
  // swieczka 2x6x2 z plomieniem
  for (let y = 8; y < 14; y++) for (const [x, z] of [[-1, 6], [0, 6], [-1, 7], [0, 7]]) cells.push({ x, y, z, block: y === 8 ? 'white_terracotta' : 'red_concrete' })
  cells.push({ x: 0, y: 14, z: 6, block: 'black_concrete' })
  for (const [x, y, z] of [[0, 15, 6], [0, 16, 6], [-1, 15, 6], [0, 15, 7]]) cells.push({ x, y, z, block: y === 16 ? 'yellow_concrete' : 'orange_concrete' })
  return cells
}

// ---------- GUMOWA KACZKA (wielka, zolta) ----------
function duckCells() {
  const cells = new Map()
  const put = (x, y, z, b) => cells.set(`${x},${y},${z}`, { x, y, z, block: b })
  const ell = (cx, cy, cz, rx, ry, rz, b) => {
    for (let x = -rx; x <= rx; x++) for (let y = -ry; y <= ry; y++) for (let z = -rz; z <= rz; z++) {
      const d = (x / (rx + 0.4)) ** 2 + (y / (ry + 0.4)) ** 2 + (z / (rz + 0.4)) ** 2
      const dIn = (x / (rx - 1.6)) ** 2 + (y / (ry - 1.6)) ** 2 + (z / (rz - 1.6)) ** 2 // skorupa na 2 bloki - kazda warstwa ma oparcie
      if (d <= 1 && (dIn > 1 || rx < 2) && cy + y >= 0) put(cx + x, cy + y, cz + z, b)
    }
  }
  ell(0, 5, 12, 7, 5, 10, 'yellow_concrete') // tulow
  ell(0, 4, 21, 3, 3, 3, 'yellow_concrete') // ogon
  ell(0, 13, 5, 5, 5, 5, 'yellow_concrete') // glowa
  for (let x = -2; x <= 2; x++) for (let y = 11; y <= 12; y++) for (let z = -3; z <= 0; z++) put(x, y, z, 'orange_concrete') // dziob
  for (const x of [-3, 3]) { put(x, 15, 1, 'black_concrete'); put(x, 16, 1, 'black_concrete'); put(x, 16, 2, 'white_concrete') } // oczy
  for (const x of [-7, 7]) for (let y = 4; y <= 7; y++) for (let z = 9; z <= 16; z++) put(x + Math.sign(x), y, z, 'yellow_concrete_powder') // skrzydla
  return [...cells.values()]
}

// ---------- DOM DO GORY NOGAMI: dach na ziemi, sciany, podloga na gorze ----------
function upsideDownCells() {
  const cells = new Map()
  const put = (x, y, z, b) => cells.set(`${x},${y},${z}`, { x, y, z, block: b })
  const W = 4 // pol szerokosci
  // odwrocony dach dwuspadowy (kalenica na ziemi), 2 bloki grubosci - kazda warstwa opiera sie na nizszej
  for (let t = 0; t <= W; t++) {
    for (let z = 0; z <= 10; z++) {
      for (const s of [-1, 1]) for (const k of [t, t - 1]) if (k >= 0) put(s * k, t, z, 'deepslate_tiles')
      if (z === 0 || z === 10) for (let x = -t + 2; x <= t - 2; x++) put(x, t, z, 'oak_planks') // szczyty
    }
  }
  const y0 = W + 1
  for (let y = y0; y < y0 + 5; y++) {
    for (let x = -W; x <= W; x++) for (let z = 0; z <= 10; z++) {
      if (!(x === -W || x === W || z === 0 || z === 10)) continue
      const corner = (x === -W || x === W) && (z === 0 || z === 10)
      let b = corner ? 'oak_log' : 'oak_planks'
      if (!corner && y === y0 + 2 && (x === 0 || z === 3 || z === 7)) b = 'glass'
      if (x === 0 && z === 0 && (y === y0 + 3 || y === y0 + 4)) b = y === y0 + 3 ? 'spruce_planks' : 'oak_planks' // "drzwi" pod sufitem
      put(x, y, z, b)
    }
  }
  for (let x = -W; x <= W; x++) for (let z = 0; z <= 10; z++) put(x, y0 + 5, z, 'stone_bricks') // podloga na gorze (fundament)
  for (let x = -W + 1; x < W; x++) for (let z = 1; z < 10; z++) put(x, y0 + 4, z, 'oak_planks') // "strop" (podloga do gory nogami)
  for (let y = y0 + 6; y <= y0 + 9; y++) put(2, y, 8, 'bricks') // komin wystaje... z fundamentu
  put(-1, y0 + 6, 3, 'grass_block'); put(0, y0 + 6, 3, 'grass_block'); put(-1, y0 + 7, 3, 'poppy') // trawnik na "dnie"
  return [...cells.values()]
}

// ---------- zapis projektow ----------
function saveDesign(Designer, dir, key, description, cells) {
  const r = Designer.fromCells(cells)
  const solid = r.cells.filter(c => c.block !== 'air')
  const rec = {
    key, name: key, description, spec: { name: key, description, generated: 'mod: Wiecej budowli', parts: [] },
    plan: r.cells, rooms: [], ahead: r.ahead, size: r.size, blocks: solid.length,
    thumb: solid.filter(c => !c.temp).map(({ x, y, z, block }) => ({ x, y, z, block })), mod: 'budowle', created: Date.now()
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, key.replace(/ /g, '_') + '.json'), JSON.stringify(rec))
  return { key, blocks: solid.length, size: r.size }
}
const keyOf = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

async function makeStatue(Designer, dir, nick) {
  const s = await fetchSkin(nick)
  const royal = /^technoblade$/i.test(s.name)
  return saveDesign(Designer, dir, keyOf('posag ' + s.name), `Posag ${s.name} ze skina gracza: 1 piksel = 1 blok (32 bloki wysokosci)${royal ? ', w stroju krola: czerwona peleryna z gronostajem i miecz' : ''}.`, statueCells(decodePng(s.png), s.slim, royal ? 'gold_block' : 'polished_andesite', { royal }))
}

// wszystkie budowle modu (posag Technoblade potrzebuje internetu - gdy go nie ma, reszta i tak powstaje)
async function makeAll(Designer, dir) {
  const done = []
  const errors = []
  done.push(saveDesign(Designer, dir, 'posag herobrine', 'Herobrine: postac z bialymi oczami, 1 piksel = 1 blok (32 bloki wysokosci).', statueCells(herobrineImg(), false, 'netherrack')))
  done.push(saveDesign(Designer, dir, 'wanienka', 'Miedziana wanienka: 4 zasniedziale, zawoskowane, zlobione miedziane schodki powiekszone 16 razy (1 piksel = 1 blok), na ukos zalane woda i lawa z kolorowych blokow, obsydian tam, gdzie sie stykaja.', tubCells()))
  done.push(saveDesign(Designer, dir, 'wielki tort', 'Tort z Minecrafta ze swieczka, 1 piksel = 1 blok.', cakeCells()))
  done.push(saveDesign(Designer, dir, 'gumowa kaczka', 'Wielka zolta gumowa kaczka.', duckCells()))
  done.push(saveDesign(Designer, dir, 'dom do gory nogami', 'Domek postawiony na dachu: kominem do gory nogami i trawnikiem na dnie.', upsideDownCells()))
  try { done.push(await makeStatue(Designer, dir, 'Technoblade')) } catch (e) { errors.push(`posag Technoblade: ${e.message}`) }
  // Swiaty Harry'ego: oba Hogwarty i slawne miejsca
  try { done.push(...require('./harry-worlds.js').makeAll(Designer, dir, 'budowle').done) } catch (e) { errors.push(`Swiaty Harry'ego: ${e.message}`) }
  return { done, errors }
}
// usuwa projekty modu (gdy mod zostaje wylaczony)
function removeAll(dir) {
  let n = 0
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith('.json')) continue
    try { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (d.mod === 'budowle') { fs.unlinkSync(path.join(dir, f)); n++ } } catch {}
  }
  return n
}

module.exports = { makeAll, makeStatue, removeAll, decodePng, statueCells, nearestBlock }
