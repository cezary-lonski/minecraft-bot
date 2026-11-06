// Maly hogwart (61x55): Wielka Sala, biblioteka, 4 wieze dormitoriow, wieza astronomiczna, wieza dyrektora, klasy, sowiarnia,
// 2 tajne przejscia na tlokach. build(Designer) zwraca wynik generatora i pokoje do umeblowania.
function build(Designer) {
  const WALL = 'stone_bricks'
  const ROOF = 'deepslate_tiles'
  // wieze dormitoriow: srodek, kolor, strona drzwi
  const DORMS = [
    { cx: -25, cz: 5, color: 'red', door: 'right' },
    { cx: 25, cz: 5, color: 'yellow', door: 'left' },
    { cx: -25, cz: 49, color: 'green', door: 'right' },
    { cx: 25, cz: 49, color: 'blue', door: 'left' }
  ]
  const parts = [
    { kind: 'walls', x: 0, z: 0, w: 61, d: 55, h: 8, mat: WALL },
    ...DORMS.map(t => ({ kind: 'tower', x: t.cx, z: t.cz - 4, shape: 'round', size: 9, h: 24, mat: WALL, roof: { type: 'cone', mat: `${t.color}_terracotta` }, door: t.door, glass: `${t.color}_stained_glass` })),
    // Wielka Sala (z wieza wejsciowa od frontu)
    { kind: 'church', x: 0, z: 13, w: 15, d: 33, h: 14, wall: WALL, roofMat: ROOF, glass: 'white_stained_glass' },
    // biblioteka (2 pietra)
    { kind: 'house', x: -18, z: 14, w: 13, d: 17, floors: 2, storey: 6, wall: WALL, corner: WALL, floor: 'spruce', foundation: WALL, roof: { type: 'gable', mat: ROOF, steep: 2, axis: 'z' }, windows: { block: 'glass', tall: true, every: 2 } },
    // wieza astronomiczna - najwyzsza, z tarasem na szczycie
    { kind: 'tower', x: -14, z: 40, shape: 'round', size: 9, h: 44, mat: WALL, roof: { type: 'battlements', mat: WALL }, door: 'right', glass: 'purple_stained_glass' },
    // wieza dyrektora - kwadratowa, z iglica
    { kind: 'tower', x: 18, z: 20, shape: 'square', size: 7, h: 30, mat: WALL, roof: { type: 'spire', mat: ROOF }, door: 'left', glass: 'orange_stained_glass' },
    // skrzydlo z klasami
    { kind: 'house', x: 18, z: 30, w: 11, d: 13, floors: 2, storey: 5, wall: WALL, corner: WALL, floor: 'oak', foundation: WALL, roof: { type: 'hip', mat: ROOF }, windows: { block: 'glass', tall: true, every: 2 } },
    // sowiarnia
    { kind: 'tower', x: 15, z: 46, shape: 'round', size: 7, h: 18, mat: WALL, roof: { type: 'cone', mat: 'dark_oak' }, door: 'front', glass: 'glass' },
    // fontanny na dziedzincu
    { kind: 'well', x: -9, z: 3, mat: WALL, roofMat: 'dark_oak' },
    { kind: 'well', x: 9, z: 3, mat: WALL, roofMat: 'dark_oak' }
  ]

  // najpierw sama bryla - zeby szczegoly nie zakryly drabin i wiedzialy, gdzie jest wnetrze wiez
  const base = Designer.generate({ parts })
  const at = new Map(base.cells.map(c => [`${c.x},${c.y},${c.z}`, c]))
  const baseAt = (x, y, z) => at.get(`${x},${y},${z}`)
  const isLadder = (x, y, z) => baseAt(x, y, z)?.block === 'ladder'

  const blocks = []
  const put = (x, y, z, block, extra = {}) => { if (!isLadder(x, y, z)) blocks.push({ x, y, z, block, ...extra }) }
  const box = (x1, x2, y1, y2, z1, z2, block, extra) => { for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) put(x, y, z, block, extra) }

  // ---------- tajne drzwi na tlokach ----------
  // W linii sciany: D (przejscie 1x2), X (2 bloki drzwi), P (2 lepkie tloki), B (blok z dzwignia na wierzchu).
  // u - wzdluz sciany (od przejscia w strone tlokow), v - w strone tajnego przejscia (pokoj jest po stronie -v).
  // Dzwignia wlaczona: tloki wypychaja X w przejscie (zamkniete). Wylaczona: tloki cofaja bloki (otwarte).
  // Tloki stawiane z patrzeniem w strone +u - glowica patrzy na przejscie. Dzwignia na koncu, gdy wszystko stoi.
  function secretDoor(b, u, v, door, facade) {
    const p = (k, y, s = 0) => [b.x + u.x * k + v.x * s, b.y + y, b.z + u.z * k + v.z * s]
    for (const y of [0, 1]) {
      put(...p(0, y), 'air') // przejscie
      put(...p(0, y, -1), 'air') // wneka przed nim
      put(...p(1, y), door) // drzwi (w scianie, obok przejscia)
      put(...p(2, y), 'sticky_piston', { look: { x: u.x, y: 0, z: u.z }, optional: true })
    }
    put(...p(3, 0), WALL) // blok zasilany dzwignia (zasila dolny tlok)
    put(...p(3, 1), 'lever', { attach: { x: 0, y: -1, z: 0 }, late: true, optional: true }) // dzwignia zasila gorny tlok
    for (let k = 0; k <= 3; k++) put(...p(k, 2), WALL)
    // okladzina od strony pokoju zaslania tloki; nad dzwignia wneka, zeby dalo sie ja przestawic
    for (let k = 1; k <= 3; k++) for (let y = 0; y <= 2; y++) put(...p(k, y, -1), k === 3 && y === 1 ? 'air' : facade)
  }

  // ---------- Wielka Sala ----------
  box(-6, 6, 0, 0, 14, 44, 'air') // bez law z kosciola i oltarza
  for (const x of [-5, -2, 1, 4]) {
    for (let z = 16; z <= 38; z++) put(x, 0, z, 'spruce_planks')
    for (let z = 17; z <= 38; z += 3) put(x, 1, z, 'candle', { optional: true })
    for (let z = 18; z <= 38; z += 4) put(x, 13, z, 'lantern', { attach: { x: 0, y: 1, z: 0 }, late: true, optional: true }) // "plywajace swiece" pod stropem
  }
  box(-5, 5, 0, 0, 41, 43, 'polished_andesite') // podwyzszenie dla nauczycieli
  for (let x = -4; x <= 4; x++) { put(x, 1, 42, 'dark_oak_planks'); put(x, 1, 43, 'dark_oak_stairs', { facing: { x: 0, z: 1 }, optional: true }) }
  put(0, 1, 43, 'gold_block')
  // tajne przejscie 1: z Wielkiej Sali (prawa sciana) korytarzem do wiezy dyrektora
  secretDoor({ x: 7, y: 0, z: 23 }, { x: 0, z: 1 }, { x: 1, z: 0 }, WALL, WALL)
  box(8, 14, -1, -1, 22, 24, WALL) // podloga korytarza
  box(8, 14, 0, 2, 22, 22, WALL)
  box(8, 14, 0, 2, 24, 24, WALL)
  box(8, 14, 0, 2, 23, 23, 'air')
  box(8, 14, 3, 3, 22, 24, WALL)
  box(8, 8, 0, 2, 25, 26, WALL) // oslona tlokow i dzwigni od zewnatrz
  put(11, 2, 23, 'soul_lantern', { attach: { x: 0, y: 1, z: 0 }, late: true, optional: true })
  box(18, 18, 0, 1, 20, 20, 'air') // druga droga do wiezy dyrektora: od dziedzinca

  // ---------- biblioteka i ukryta komnata ----------
  box(-23, -13, 0, 5, 30, 30, WALL) // tylna sciana bez okien (za nia jest komnata)
  // regaly: pod tylna sciana i w dwoch rzedach
  for (let x = -23; x <= -13; x++) if (x < -21 || x > -18) box(x, x, 0, 2, 29, 29, 'bookshelf')
  for (const x of [-22, -14]) box(x, x, 0, 2, 17, 25, 'bookshelf')
  put(-18, 0, 20, 'lectern', { optional: true })
  put(-18, 0, 24, 'lectern', { optional: true })
  for (let x = -23; x <= -13; x++) box(x, x, 6, 8, 29, 29, 'bookshelf') // pietro: regaly pod tylna sciana
  // tajne przejscie 2: regal w bibliotece otwiera wejscie do ukrytej komnaty
  secretDoor({ x: -21, y: 0, z: 30 }, { x: 1, z: 0 }, { x: 0, z: 1 }, 'bookshelf', 'bookshelf')
  // ukryta komnata: bez okien, kamien glebinowy, kolumny, skrzynia ze skarbem
  box(-24, -12, -1, -1, 31, 38, 'polished_deepslate')
  box(-24, -12, 5, 5, 30, 38, ROOF)
  for (let z = 31; z <= 38; z++) for (const x of [-24, -12]) box(x, x, 0, 4, z, z, 'deepslate_bricks')
  box(-24, -12, 0, 4, 38, 38, 'deepslate_bricks')
  box(-23, -13, 0, 4, 31, 37, 'air')
  for (const x of [-21, -15]) box(x, x, 0, 4, 34, 34, 'mossy_stone_bricks')
  for (const [x, z] of [[-23, 31], [-13, 31], [-23, 37], [-13, 37]]) put(x, 0, z, 'soul_lantern', { optional: true })
  for (let z = 32; z <= 36; z++) for (let x = -19; x <= -17; x++) put(x, 0, z, 'green_carpet', { optional: true })
  put(-18, 0, 37, 'chest', { optional: true })

  // ---------- dormitoria: pietra co 6 blokow, dywany w kolorze wiezy, lozka ----------
  const rooms = []
  for (const t of DORMS) {
    const inside = []
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (baseAt(t.cx + dx, 1, t.cz + dz)?.block === 'air') inside.push([t.cx + dx, t.cz + dz])
    const lad = inside.find(([x, z]) => isLadder(x, 3, z)) || [t.cx, t.cz]
    const entryX = t.door === 'right' ? t.cx + 3 : t.cx - 3
    for (const fy of [6, 12, 18]) {
      for (const [x, z] of inside) {
        if (isLadder(x, fy, z)) continue
        put(x, fy, z, 'spruce_planks')
        put(x, fy + 1, z, `${t.color}_carpet`, { optional: true })
      }
      rooms.push({ x1: t.cx - 2, x2: t.cx + 2, z1: t.cz - 2, z2: t.cz + 2, y: fy + 1, h: 4, theme: 'wood', bed: true, keep: [`${lad[0] + Math.sign(t.cx - lad[0]) },${lad[1]}`, `${t.cx},${t.cz}`] })
    }
    void entryX
  }

  // sciezka od bramy do Wielkiej Sali
  box(-1, 1, -1, -1, 1, 8, 'polished_andesite')

  const spec = {
    name: 'hogwart',
    description: 'Zamek szkoly magii: Wielka Sala z dlugimi stolami, biblioteka, 4 wieze dormitoriow, wieza astronomiczna, wieza dyrektora, klasy, sowiarnia. Dwa tajne przejscia na tlokach (dzwignia we wnece).',
    seed: 7,
    parts: [...parts, { kind: 'voxels', x: 0, z: 0, blocks }],
    source: 'claude'
  }
  const r = Designer.generate(spec)

  // pokoje do automatycznego umeblowania: bez Wielkiej Sali i biblioteki (tam meble sa w projekcie),
  // z wolnym przejsciem przy drzwiach wiez
  const inBox = (rm, x1, x2, z1, z2) => rm.x1 >= x1 && rm.x2 <= x2 && rm.z1 >= z1 && rm.z2 <= z2
  const keepRooms = r.rooms.filter(rm => !inBox(rm, -8, 8, 8, 46) && !inBox(rm, -24, -12, 14, 30)).map(rm => {
    const keep = [...(rm.keep || [])]
    for (const t of DORMS) if (inBox(rm, t.cx - 4, t.cx + 4, t.cz - 4, t.cz + 4)) keep.push(`${t.door === 'right' ? rm.x2 : rm.x1},${t.cz}`)
    if (inBox(rm, 15, 21, 20, 26)) keep.push(`${rm.x1},23`, `18,${rm.z1}`) // wieza dyrektora: korytarz i wejscie od dziedzinca
    if (inBox(rm, -18, -10, 40, 48)) keep.push(`${rm.x2},44`)
    if (inBox(rm, 12, 18, 46, 52)) keep.push(`15,${rm.z1}`)
    return { ...rm, keep }
  })

  return { spec, result: r, rooms: [...keepRooms, ...rooms] }
}

module.exports = { build }
