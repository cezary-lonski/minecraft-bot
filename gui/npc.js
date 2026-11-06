// Postacie Hogwartu: najwazniejsi nauczyciele jako boty (wlasny skin, miejsce w zamku, rozmowa przez AI w roli),
// reszta jako wiesniacy z imieniem - przywoluja ich boty komenda "postacie hogwart".
const zlib = require('zlib')

// rola: nicki do wyboru (pierwszy, ktory nie zajmuje skina innego bota), miejsce w wielkim hogwarcie (wspolrzedne projektu),
// opis dla AI i powitania (wlasne zdania w stylu postaci)
const ROLES = {
  snape: {
    names: ['Snape', 'Severus_Snape', 'Snape_', 'ProfSnape'],
    title: 'Profesor Snape', place: 'lochy (klasa eliksirow)', post: [45, 0, 47],
    persona: 'Grasz profesora Snape\'a - mistrza eliksirow w Hogwarcie. Mowisz chlodno, krotko i z lekka ironia, wymagasz ciszy i precyzji, czasem grozisz odjeciem punktow domowi, ale pomagasz, gdy ktos naprawde sie stara. Uczysz w lochach.',
    greet: ['Cisza. Tu sie warzy eliksiry, a nie gada.', 'Spoznienie. Dziesiec punktow mniej.', 'Mam nadzieje, ze tym razem przeczytales podrecznik.', 'Kociolek nie pilnuje sie sam.']
  },
  mcgonagall: {
    names: ['McGonagall', 'ProfMcGonagall', 'Minerva_M'],
    title: 'Profesor McGonagall', place: 'klasa transmutacji', post: [56, 16, 36],
    persona: 'Grasz profesor McGonagall - wicedyrektorke Hogwartu i nauczycielke transmutacji. Jestes surowa, ale sprawiedliwa i troskliwa; mowisz rzeczowo i uprzejmie, pilnujesz regul i punktualnosci, czasem zartujesz sucho. Uczysz w klasie transmutacji.',
    greet: ['Dzien dobry. Prosze zajac miejsce, zaczynamy transmutacje.', 'Punktualnosc to podstawa, prosze to zapamietac.', 'Zamiana zapalki w igle - kto pierwszy?', 'Bardzo dobrze. Piec punktow dla twojego domu.']
  },
  dumbledore: {
    names: ['Dumbledore', 'Dumbledore_', 'AlbusDumbledore', 'ProfDumbledore'],
    title: 'Profesor Dumbledore', place: 'Wielka Sala (stol nauczycieli)', post: [18, 17, 60],
    persona: 'Grasz profesora Dumbledore\'a - madrego, cieplego i troche ekscentrycznego dyrektora Hogwartu. Mowisz spokojnie i zyczliwie, lubisz madre rady, zagadki i slodycze (cytrynowe dropsy), wierzysz w uczniow. Zwykle jestes w Wielkiej Sali.',
    greet: ['Witaj w Hogwarcie! Cytrynowego dropsa?', 'Odpowiedzi czesto przychodza, gdy przestajemy ich tak goraczkowo szukac.', 'Ach, jak milo cie widziec. Uczta wkrotce sie zacznie.', 'Nawet w najciemniejszych chwilach wystarczy pamietac, zeby zapalic swiatlo.']
  }
}

// postacie-wiesniacy: [imie, kolor imienia, zawod, x, y, z] - wspolrzedne w wielkim hogwarcie
const VILLAGERS = [
  ['Hagrid', 'gold', 'leatherworker', -66, 16, 42], ['Profesor Flitwick', 'aqua', 'librarian', 55, 25, 36], ['Profesor Sprout', 'green', 'farmer', -66, 16, 20],
  ['Profesor Trelawney', 'light_purple', 'cleric', 20, 23, 101], ['Filch', 'gray', 'nitwit', -30, 16, 30], ['Profesor Lupin', 'yellow', 'librarian', 52, 16, 83],
  ['Profesor Binns', 'white', 'nitwit', -46, 16, 52], ['Pani Hooch', 'yellow', 'fletcher', 0, 16, 46], ['Pani Pomfrey', 'red', 'cleric', -60, 24, 52],
  ['Harry Potter', 'red', 'cartographer', -10, 16, 56], ['Ron Weasley', 'red', 'farmer', -8, 16, 56], ['Hermiona Granger', 'red', 'librarian', -6, 16, 56],
  ['Draco Malfoy', 'green', 'weaponsmith', 3, 0, 40], ['Prawie Bezglowy Nick', 'gray', 'nitwit', 0, 16, 61], ['Zgredek', 'white', 'nitwit', -12, 16, 61],
  ['Madame Pince', 'gray', 'librarian', -40, 16, 84]
]

// ---------- skiny 64x64 rysowane w programie ----------
function crc32(buf) {
  let c, crc = ~0
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c }
  return ~crc >>> 0
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function painter() {
  const px = Buffer.alloc(64 * 64 * 4)
  const dot = (x, y, c) => { if (!c) return; const i = (y * 64 + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3] ?? 255 }
  // pudelko czesci ciala (jak w skinie): fn(sciana, kolumna, wiersz, szerokosc, wysokosc) -> kolor albo null
  const box = (u, v, w, h, d, fn) => {
    const face = (name, x0, y0, fw, fh) => { for (let i = 0; i < fw; i++) for (let j = 0; j < fh; j++) dot(x0 + i, y0 + j, fn(name, i, j, fw, fh)) }
    face('top', u + d, v, w, d); face('bottom', u + d + w, v, w, d)
    face('right', u, v + d, d, h); face('front', u + d, v + d, w, h); face('left', u + d + w, v + d, d, h); face('back', u + 2 * d + w, v + d, w, h)
  }
  return { box, png: () => encodePng(64, 64, px) }
}
const C = {
  pale: [232, 210, 186], skin: [214, 170, 140], black: [22, 22, 26], robe: [30, 30, 36], white: [240, 240, 240], gray: [120, 120, 125],
  green: [24, 96, 54], dgreen: [14, 62, 34], silver: [214, 216, 222], purple: [96, 38, 140], dpurple: [64, 22, 96], gold: [235, 190, 60], blue: [60, 110, 200], brown: [70, 45, 30]
}
// wspolny ksztalt postaci: glowa (twarz z oczami), tulow i rece w szacie, nogi
function figure({ hair, face, robe, robe2, trim, legs, shoes, eyes, beard, hat, hatBand, glasses, longHair, stars }) {
  const p = painter()
  // glowa
  p.box(0, 0, 8, 8, 8, (f, i, j) => {
    if (f === 'top') return hair
    if (f === 'bottom') return beard || face
    if (f === 'front') {
      if (j < 2) return hair
      if ((i === 0 || i === 7) && (longHair || j < 3)) return hair
      if (j === 4 && (i === 2 || i === 5)) return eyes
      if (glasses && j === 4 && (i === 1 || i === 3 || i === 4 || i === 6)) return glasses
      if (beard && j >= 5 && i >= 1 && i <= 6) return beard
      if (j === 6 && i >= 3 && i <= 4) return [face[0] - 60, face[1] - 60, face[2] - 60]
      return face
    }
    if (f === 'back') return hair
    return (longHair || j < 3) ? hair : face // boki
  })
  // kapelusz (druga warstwa glowy): wierzch i 3 gorne rzedy, opaska
  if (hat) p.box(32, 0, 8, 8, 8, (f, i, j) => f === 'top' ? hat : f === 'bottom' ? null : j < 2 ? hat : j === 2 ? (hatBand || hat) : null)
  // tulow: szata, lamowka na srodku, broda splywa na piers
  p.box(16, 16, 8, 12, 4, (f, i, j) => {
    if (beard && f === 'front' && j < 7 && i >= 2 && i <= 5 && (j < 5 || (i >= 3 && i <= 4))) return beard
    if (trim && f === 'front' && (i === 3 || i === 4)) return trim
    if (stars && (i * 7 + j * 3) % 11 === 0) return stars
    if (longHair && f === 'back' && j < 3) return hair
    return j % 4 === 3 && robe2 ? robe2 : robe
  })
  // rece: rekawy szaty, dlonie na dole
  const arm = (f, i, j) => j >= 10 && f !== 'top' ? face : (stars && (i * 5 + j * 3) % 13 === 0 ? stars : robe)
  p.box(40, 16, 4, 12, 4, arm)
  p.box(32, 48, 4, 12, 4, arm)
  // nogi: dol szaty, buty
  const leg = (f, i, j) => j >= 10 ? shoes : (legs || robe)
  p.box(0, 16, 4, 12, 4, leg)
  p.box(16, 48, 4, 12, 4, leg)
  return p.png()
}
const SKINS = {
  snape: () => figure({ hair: C.black, face: C.pale, robe: C.robe, robe2: C.black, trim: [50, 50, 56], shoes: C.black, eyes: C.black, longHair: true }),
  mcgonagall: () => figure({ hair: [40, 40, 44], face: C.pale, robe: C.green, robe2: C.dgreen, trim: C.dgreen, shoes: C.black, eyes: C.brown, hat: C.dgreen, hatBand: C.black, glasses: C.gray }),
  dumbledore: () => figure({ hair: C.silver, face: C.skin, robe: C.purple, robe2: C.dpurple, shoes: C.brown, eyes: C.blue, beard: C.silver, longHair: true, hat: C.purple, hatBand: C.gold, glasses: C.gold, stars: C.gold })
}

module.exports = { ROLES, VILLAGERS, SKINS }
