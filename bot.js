const fs = require('fs')
const pathLib = require('path')
const mineflayer = require('mineflayer')
// folder na pliki bota (punkty, budowle, uprawnienia); GUI podaje wlasny, bo program jest tylko do odczytu
const DATA_DIR = process.env.MC_DATA_DIR || __dirname
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const pvp = require('mineflayer-pvp').plugin
const Vec3 = require('vec3').Vec3

// Bez MC_PORT sprawdzamy rekord SRV (_minecraft._tcp), tak jak robi to gra.
// Robione synchronicznie w osobnym procesie, bo createBot jest wywolywany od razu.
function resolveSrv(host) {
  try {
    // lokalny resolver bywa odrzuca SRV (ECONNREFUSED w c-ares), wiec uzywamy publicznych DNS
    const script = "const d=require('dns');d.setServers(['1.1.1.1','8.8.8.8']);d.resolveSrv('_minecraft._tcp.'+process.argv[1],(e,r)=>{if(!e&&r[0])console.log(r[0].name+' '+r[0].port)})"
    const out = require('child_process').execFileSync(process.execPath, ['-e', script, host], { timeout: 5000 }).toString().trim()
    if (out) { const [name, port] = out.split(' '); return { host: name, port: parseInt(port) } }
  } catch {}
  return null
}

let target = { host: process.env.MC_HOST || 'localhost', port: process.env.MC_PORT ? parseInt(process.env.MC_PORT) : 25565 }
if (!process.env.MC_PORT && !/^[\d.]+$/.test(target.host) && target.host !== 'localhost') {
  target = resolveSrv(target.host) || target
}

const bot = mineflayer.createBot({
  host: target.host,
  port: target.port,
  username: process.env.MC_USER || 'Claude',
  version: process.env.MC_VERSION || false, // false = autodetekcja
  auth: process.env.MC_AUTH || 'offline' // 'microsoft' dla serwerow z online-mode=true
})

bot.loadPlugin(pathfinder)
bot.loadPlugin(collectBlock)
bot.loadPlugin(pvp)

// Kopanie: mineflayer sam liczy czas kopania i po nim od razu rysuje blok jako zniszczony. Gdy serwer liczy dluzej
// (np. uwaza, ze bot jest w powietrzu albo nie widzial jeszcze zmiany narzedzia), odrzuca zniszczenie i blok wraca -
// wyglada to jak "skopal, a pien stoi". Dlatego kopiemy z zapasem czasu, a gdy serwer cofnie blok, zapas rosnie.
let digMargin = 1.2
const baseDigTime = bot.digTime
bot.digTime = block => {
  const t = baseDigTime(block)
  return Number.isFinite(t) ? Math.ceil(t * digMargin) + 50 : t
}
const baseDig = bot.dig
bot.dig = async (block, ...rest) => {
  await sleep(100) // serwer musi najpierw dostac zmiane narzedzia w rece
  const name = block.name
  const pos = block.position
  await baseDig(block, ...rest)
  await sleep(300)
  const after = bot.blockAt(pos)
  // zwir i piasek spadaja z gory na to samo miejsce - to nie jest cofniecie przez serwer
  if (after && after.name === name && !['gravel', 'sand', 'red_sand'].includes(name)) {
    digMargin = Math.min(digMargin * 1.5, 5)
    console.log(`[bot] serwer cofnal kopanie ${name}, kopie wolniej (x${digMargin.toFixed(2)})`)
  } else if (digMargin > 1.2) {
    digMargin = Math.max(1.2, digMargin * 0.97)
  }
}

let running = false
let currentTask = null
// cel biezacego zadania (np. "mam 8 zelaza"); gdy osiagniety po drodze - np. ze skrzyni - pomocnicze kroki sie koncza
let taskGoal = null
const goalReached = () => !!taskGoal && taskGoal()
// biezacy krok zadania, np. "kopie w dol: y=12, cel y=-54" - pokazywany przez "jak tam"
let taskStatus = null
const setStatus = text => { taskStatus = text }
function progressText() {
  if (!currentTask) return 'Nic nie robie - daj mi zadanie.'
  return `Zadanie: ${currentTask}${taskStatus ? ' - teraz ' + taskStatus : ''}.`
}
let activeTasks = 0
let mcData

// pytanie do gracza w trakcie zadania, np. "Mam po nie pojsc czy budowac bez nich?".
// options: [[regex odpowiedzi (bez polskich znakow), wartosc], ...]; bez odpowiedzi po timeoutMs zwraca def.
let pendingQuestion = null
function askUser(question, options, timeoutMs, def, timeoutText) {
  if (pendingQuestion) pendingQuestion.resolve(def) // stare pytanie przepada
  say(question)
  return new Promise(resolve => {
    const finish = value => {
      clearTimeout(timer)
      if (pendingQuestion?.resolve === finish) pendingQuestion = null
      resolve(value)
    }
    const timer = setTimeout(() => {
      if (timeoutText) say(timeoutText)
      finish(def)
    }, timeoutMs)
    pendingQuestion = { options, resolve: finish, def }
  })
}

// wspolna obudowa dlugich zadan: jedno naraz, "stop" je przerywa (running = false), a po zakonczeniu bot staje
async function task(name, fn) {
  if (running) {
    // komenda od AI: nie piszemy na czacie, AI dostaje informacje zwrotna
    if (aiCmd.active) { aiCmd.busy = currentTask; return }
    say(`Jestem zajety (${currentTask}), napisz "stop".`)
    return
  }
  // po "stop" poprzednie zadanie moze jeszcze konczyc np. kopanie bloku - nie zaczynamy nowego w tym czasie
  if (activeTasks > 0) { say('Koncze poprzednie zadanie, sprobuj za chwile.'); return }
  running = true
  currentTask = name
  activeTasks++
  rememberTask(name)
  try {
    await fn()
  } catch (e) {
    console.log(`[bot] ${name} blad:`, e)
    say(`Blad (${name}): ${e.message}`)
  } finally {
    activeTasks--
    running = false
    currentTask = null
    taskGoal = null
    taskStatus = null
    currentJob = null
    forgetTask() // zadanie skonczone albo przerwane przez "stop" - nie ma czego wznawiac
    try { bot.pathfinder.setGoal(null); bot.clearControlStates() } catch {}
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Serwer przepuszcza jedna wiadomosc na ~2 s (antyspam), wiec wszystko idzie przez kolejke.
const CHAT_DELAY = parseInt(process.env.MC_CHAT_DELAY || '3200')
const chatQueue = []
let lastChat = 0
setInterval(() => {
  // przed wejsciem do swiata czat nie dziala - wiadomosci czekaja w kolejce
  if (!chatQueue.length || Date.now() - lastChat < CHAT_DELAY || typeof bot.chat !== 'function') return
  const text = chatQueue.shift()
  lastChat = Date.now()
  try { bot.chat(text) } catch (e) { console.log('[bot] Nie wyslano:', e.message) }
}, 200)
function queueChat(text) {
  if (chatQueue.length >= 8) chatQueue.shift() // nie zalewamy kolejki starymi komunikatami
  chatQueue.push(text)
}
// gdy komende dostalismy przez /msg, odpowiadamy tez przez /msg (null = czat publiczny)
let replyTo = null
// MC_QUIET=1: odpowiedzi tylko w konsoli (do testow, zeby nie pisac na czat serwera)
const QUIET = process.env.MC_QUIET === '1'
const say = msg => { console.log('[bot]', msg); if (!QUIET) queueChat(replyTo ? `/msg ${replyTo} ${msg}` : msg) }

// ---------- narzedzia ----------
const count = name => bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0)
const countMatch = re => bot.inventory.items().filter(i => re.test(i.name)).reduce((s, i) => s + i.count, 0)
const has = name => count(name) > 0

// dowolne drewno: kloce (oak_log, ...) i pnie (crimson_stem, ...), tez ociosane
const WOOD_RE = /_(log|stem)$/
const woodBlocks = () => mcData.blocksArray.map(b => b.name).filter(n => WOOD_RE.test(n))

// bloki, do ktorych pathfinder nie znalazl drogi - pomijamy je, zamiast probowac w kolko tego samego
const unreachable = new Set()

// uprawy zbieramy tylko dojrzale (niedojrzale daja same nasiona)
const CROP_MAX_AGE = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 }
function ripeOrNotCrop(p) {
  const b = bot.blockAt(p)
  if (!b || CROP_MAX_AGE[b.name] === undefined) return true
  return Number(b.getProperties().age) === CROP_MAX_AGE[b.name] // wlasciwosci bloku sa tekstem ("7")
}

function findBlocks(names, max = 32, dist = 64) {
  const ids = names.map(n => mcData.blocksByName[n]?.id).filter(x => x !== undefined)
  return bot.findBlocks({ matching: ids, maxDistance: dist, count: max + unreachable.size + 32 })
    .filter(p => !unreachable.has(posKey(p)) && ripeOrNotCrop(p) && !nearDangerZone(p, 24) && !isBuilt(p))
    .slice(0, max)
}

// prawie pelny ekwipunek (np. po dlugim tunelu): wyrzucamy smieci i nadmiar bruku, zeby bylo miejsce na rude
async function makeRoom() {
  if (bot.inventory.emptySlotCount() > 2) return
  let tossed = 0
  const toss = async it => { try { await bot.toss(it.type, null, it.count); tossed += it.count } catch {} }
  // materialow aktualnej budowy (np. bruk na zamek, ziemia na rusztowanie) nie wyrzucamy
  const keep = i => protectedItems.has(i.name) || (protectedItems.has('log') && WOOD_RE.test(i.name))
  for (const it of bot.inventory.items().filter(i => JUNK_RE.test(i.name) && !keep(i))) await toss(it)
  // bruku zostawiamy jeden stack (na piec i schody), reszta to balast
  if (!protectedItems.has('cobblestone')) for (const it of bot.inventory.items().filter(i => i.name === 'cobblestone').slice(1)) await toss(it)
  if (tossed) console.log(`[bot] pelny ekwipunek - wyrzucilem ${tossed} smieci`)
  else if (bot.inventory.emptySlotCount() === 0) say('Mam pelny ekwipunek i nie ma czego wyrzucic - schowaj mi cos albo wez rzeczy ("daj wszystko").')
}

async function collect(names, amount, itemRe) {
  if (isCreative() && countMatch(itemRe) < amount) {
    const name = creativeItemFor(itemRe)
    if (name) return await creativeGive(name, count(name) + amount - countMatch(itemRe))
  }
  if (countMatch(itemRe) < amount && !goalReached()) await prepareFor(names)
  let fails = 0
  while (running && countMatch(itemRe) < amount && fails < 5 && !goalReached()) {
    setStatus(`zbieram ${names[0].replace('deepslate_', '')} (mam ${countMatch(itemRe)}/${amount})`)
    // kilof mogl sie zepsuc w trakcie kopania - wtedy robimy nowy, zanim pojdziemy dalej
    const needTier = Math.max(-1, ...names.map(n => ORE_TIER[n.replace('deepslate_', '')] ?? -1))
    if (bestPickTier() < needTier) {
      say('Nie mam odpowiedniego kilofa (moze sie zepsul) - robie nowy.')
      await prepareFor(names)
      if (bestPickTier() < needTier) break
    }
    const spots = findBlocks(names, 8)
    await ensureFed()
    await makeRoom()
    await lootIfSeen()
    if (!spots.length) {
      fails++
      // rudy lezace gleboko (zelazo, diamenty...): kopiemy w dol i drazymy tunel, az jakas bedzie widac
      const depth = oreDepth(names)
      if (depth !== null) {
        if (await mineFor(names, depth)) fails = 0
        continue
      }
      // reszta: losowy teleport (/rtp), a gdy sie nie da, zwykly spacer
      if (!(await rtpToLand())) await explore()
      continue
    }
    const target = spots.map(p => bot.blockAt(p)).find(Boolean)
    if (!target) { fails++; continue }
    try {
      await bot.collectBlock.collect(target)
      fails = 0
    } catch (e) {
      fails++
      console.log('collect blad:', e.message)
      // nie da sie dojsc - zapamietujemy i nastepnym razem bierzemy inny blok
      if (/path|goal/i.test(e.message)) unreachable.add(posKey(target.position))
      await sleep(500)
    }
  }
  return countMatch(itemRe) >= amount
}

// ---------- /rtp: losowy teleport na staly lad ----------
const RTP_ENABLED = process.env.MC_RTP !== '0'
let rtpBlockedUntil = 0

function onSolidLand() {
  const feet = bot.entity.position
  const floor = bot.blockAt(feet.offset(0, -0.5, 0))
  return !bot.entity.isInWater && !!floor && floor.boundingBox === 'block' && !['water', 'lava', 'ice', 'blue_ice', 'packed_ice'].includes(floor.name)
}

// zwraca true, gdy po teleporcie stoimy na ladzie (albo doplynelismy do brzegu)
async function rtpToLand(maxTries = 5) {
  if (!RTP_ENABLED || Date.now() < rtpBlockedUntil) return false
  for (let i = 0; i < maxTries && running; i++) {
    const start = bot.entity.position.clone()
    say(`Brak surowca w poblizu, /rtp (${i + 1}/${maxTries}).`)
    sendChat('/rtp')
    // teleport bywa opozniony (odliczanie), wiec czekamy do 25 s na zmiane pozycji
    let moved = false
    for (let t = 0; t < 50 && running; t++) {
      await sleep(500)
      if (bot.entity.position.distanceTo(start) > 20) { moved = true; break }
    }
    if (!moved) {
      say('/rtp nie zadzialal (cooldown albo brak komendy), szukam pieszo.')
      rtpBlockedUntil = Date.now() + 5 * 60 * 1000
      return false
    }
    await sleep(2500) // chunki po teleporcie
    if (onSolidLand()) return true
    // wyladowalismy w wodzie: plyniemy do najblizszego brzegu, a jak go nie ma - losujemy jeszcze raz
    const land = findLand(24)
    if (land) {
      try { await bot.pathfinder.goto(new goals.GoalNear(land.x, land.y, land.z, 1)) } catch {}
      if (onSolidLand()) return true
    }
    say('Ocean albo woda, losuje jeszcze raz.')
    await sleep(CHAT_DELAY) // /rtp zwykle ma krotka przerwe miedzy uzyciami
  }
  return false
}

async function explore() {
  const p = bot.entity.position
  const a = Math.random() * Math.PI * 2
  const target = p.offset(Math.cos(a) * 40, 0, Math.sin(a) * 40)
  try {
    await bot.pathfinder.goto(new goals.GoalNearXZ(target.x, target.z, 3))
  } catch {}
}

// ---------- kopanie w glab: schody w dol i tunele ----------
// na jakiej wysokosci szukac rudy (najwiecej jej tam jest)
const ORE_DEPTH = { coal_ore: 48, copper_ore: 48, iron_ore: 16, lapis_ore: 0, gold_ore: -16, redstone_ore: -54, diamond_ore: -54, emerald_ore: 100 }
const DANGER_BLOCKS = ['lava', 'water', 'fire']

function oreDepth(names) {
  const d = names.map(n => ORE_DEPTH[n.replace('deepslate_', '')]).filter(x => x !== undefined)
  return d.length ? d[0] : null
}

// kierunek patrzenia zaokraglony do osi: {x, z}
function facingAxis() {
  const yaw = bot.entity.yaw
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  return Math.abs(fx) > Math.abs(fz) ? { x: Math.sign(fx), z: 0 } : { x: 0, z: Math.sign(fz) }
}
const turnRight = d => ({ x: -d.z, z: d.x })

// czy w bloku albo tuz obok jest lawa/woda (nie wkopujemy sie w nia)
function dangerNear(pos) {
  for (const [dx, dy, dz] of [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const b = bot.blockAt(pos.offset(dx, dy, dz))
    if (b && DANGER_BLOCKS.includes(b.name)) return true
  }
  return false
}

// wykopuje blok, jesli cos tam stoi (narzedzie dobiera mineflayer-tool); zwir/piasek moga spasc - wtedy powtarza
async function clearBlock(pos) {
  for (let i = 0; i < 6; i++) {
    const b = bot.blockAt(pos)
    if (!b || b.boundingBox !== 'block') return
    if (!bot.canDigBlock(b)) throw new Error(`nie moge wykopac ${b.name}`)
    try { await bot.tool.equipForBlock(b, {}) } catch {}
    await bot.dig(b, true)
  }
}

// jeden krok: na pole obok (dy = 0) albo schodek w dol (dy = -1); przy lawie skreca.
// Bloki wykopujemy sami - pathfinder przy szukaniu drogi przez lita skale potrafi nie zdazyc ("Took to long").
async function stepTo(dir, dy) {
  for (let turn = 0; turn < 4; turn++) {
    const p = bot.entity.position.floored()
    const next = p.offset(dir.x, dy, dir.z)
    if (!dangerNear(next) && !dangerNear(next.offset(0, 1, 0))) {
      // przejscie: nogi i glowa na nowym polu, a przy schodku tez blok nad glowa (przez niego sie przechodzi)
      const toClear = dy < 0 ? [next.offset(0, 2, 0), next.offset(0, 1, 0), next] : [next.offset(0, 1, 0), next]
      for (const pos of toClear) await clearBlock(pos)
      // pod nowym polem musi byc podloga, inaczej spadlibysmy w dziure
      const floor = bot.blockAt(next.offset(0, -1, 0))
      if (floor && floor.boundingBox !== 'block') {
        if (DANGER_BLOCKS.includes(floor.name)) { dir = turnRight(dir); continue }
      }
      await bot.pathfinder.goto(new goals.GoalBlock(next.x, next.y, next.z))
      return dir
    }
    console.log('[bot] lawa/woda przed nami, skrecam')
    dir = turnRight(dir)
  }
  throw new Error('wszedzie lawa albo woda')
}

// schodami w dol do wysokosci y (schody, nie pionowy szyb - da sie wyjsc i nie spada sie w dziure)
async function digDownTo(y) {
  let dir = awayFromDanger() || facingAxis()
  say(`Kopie schodami w dol do y=${y}.`)
  for (let i = 0; i < 200 && running && bot.entity.position.y > y + 0.5; i++) {
    setStatus(`kopie schodami w dol: jestem na y=${Math.floor(bot.entity.position.y)}, cel y=${y}`)
    const sculk = sculkNear(8)
    if (sculk) {
      // deep dark: glebiej czujniki sculk przywolalyby wardena - zostajemy na tej wysokosci
      markDangerZone(sculk.position)
      say(`Pode mna deep dark (sculk) - nie schodze nizej niz y=${Math.floor(bot.entity.position.y)}, bo moze przyjsc warden.`)
      return true
    }
    try { dir = await stepTo(dir, -1) } catch (e) { console.log('[bot] schody:', e.message); return false }
    await lootIfSeen() // np. skrzynie w kopalniach
  }
  return bot.entity.position.y <= y + 1
}

// tunel 1x2 o dlugosci len; konczy wczesniej, gdy w zasiegu pojawi sie szukana ruda
async function stripMine(names, len) {
  let dir = awayFromDanger() || facingAxis()
  for (let i = 0; i < len && running; i++) {
    setStatus(`draze tunel na y=${Math.floor(bot.entity.position.y)} (${i}/${len} blokow), szukam ${names[0].replace('deepslate_', '')}`)
    const sculk = sculkNear(8)
    if (sculk) {
      // tunel wchodzi w deep dark - zawracamy, zanim czujnik nas uslyszy
      const fresh = !nearDangerZone(sculk.position, 16)
      markDangerZone(sculk.position)
      if (fresh) say('Przed nami deep dark (sculk) - zmieniam kierunek, zeby nie obudzic wardena.')
      dir = awayFromDanger() || { x: -dir.x, z: -dir.z }
    }
    if (findBlocks(names, 1, 10).length) return true
    try { dir = await stepTo(dir, 0) } catch (e) { console.log('[bot] tunel:', e.message); return false }
    await lootIfSeen()
  }
  return findBlocks(names, 1, 10).length > 0
}

async function mineFor(names, depth) {
  if (bot.entity.position.y > depth + 3) {
    if (!await digDownTo(depth)) return false
    if (findBlocks(names, 1, 16).length) return true
  }
  say('Draze tunel w poszukiwaniu rudy.')
  return await stripMine(names, 40)
}

async function goNear(pos, range = 2) {
  await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, range))
}

function logName() {
  const it = bot.inventory.items().find(i => WOOD_RE.test(i.name))
  return it?.name
}

// bot.craft potrafi zawisnac (okno stolu sie nie otworzy/nie zsynchronizuje), wiec dajemy mu limit czasu
async function craftSafe(recipe, times, table, label) {
  console.log(`[bot] crafting: ${label} x${times}${table ? ' (stol)' : ''}`)
  let timer
  try {
    await Promise.race([
      bot.craft(recipe, times, table),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('crafting nie odpowiada od 15 s')), 15000) })
    ])
    // ekwipunek aktualizuje sie chwile po craftingu; bez czekania nastepny przepis "nie widzi" nowych desek/patykow
    await sleep(300)
  } catch (e) {
    console.log(`[bot] crafting ${label} nie wyszedl: ${e.message}`)
    if (bot.currentWindow) { try { bot.closeWindow(bot.currentWindow) } catch {} }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function craft(itemName, amount, table) {
  const item = mcData.itemsByName[itemName]
  if (!item) throw new Error('brak itemu ' + itemName)
  const recipe = bot.recipesFor(item.id, null, 1, table || null)[0]
  if (!recipe) return false
  const per = recipe.result.count
  // crafting w ekwipunku czasem nie dostaje odpowiedzi od serwera ("updateSlot:0 did not fire") - druga proba zwykle wychodzi
  const before = count(itemName)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await craftSafe(recipe, Math.ceil(amount / per), table || null, itemName)
      return true
    } catch (e) {
      if (count(itemName) > before) return true
      if (attempt === 1) throw e
      await sleep(1000)
    }
  }
  return false
}

async function placeNear(itemName) {
  const item = bot.inventory.items().find(i => i.name === itemName)
  if (!item) return null
  await bot.equip(item, 'hand')
  const p = bot.entity.position.floored()
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]
  // trawa, kwiaty, snieg itp. nie blokuja - postawiony blok je zastepuje (tak jak u gracza)
  const isFree = b => b && b.boundingBox === 'empty' && !['water', 'lava'].includes(b.name)

  async function placeAt(spot) {
    const ref = bot.blockAt(spot.offset(0, -1, 0))
    if (!ref || ref.boundingBox !== 'block' || !isFree(bot.blockAt(spot))) return null
    const it = bot.inventory.items().find(i => i.name === itemName)
    if (!it) return null
    await bot.equip(it, 'hand')
    try { await bot.placeBlock(ref, new Vec3(0, 1, 0)) } catch {}
    // serwer potwierdza postawienie z opoznieniem; bez czekania dostalibysmy "air"
    // i proba otwarcia stolu/pieca wisialaby w nieskonczonosc
    for (let t = 0; t < 20; t++) {
      const placed = bot.blockAt(spot)
      if (placed && placed.name === itemName) return placed
      await sleep(100)
    }
    return null
  }

  for (const [dx, dz] of offsets) {
    const placed = await placeAt(p.offset(dx, 0, dz))
    if (placed) return placed
  }
  // nigdzie wolnego miejsca (np. waski tunel): wykopujemy wneke obok siebie i tam stawiamy
  for (const [dx, dz] of offsets.slice(0, 4)) {
    const spot = p.offset(dx, 0, dz)
    const floor = bot.blockAt(spot.offset(0, -1, 0))
    if (!floor || floor.boundingBox !== 'block' || dangerNear(spot)) continue
    try { await clearBlock(spot) } catch { continue }
    console.log(`[bot] brak miejsca - wykopalem wneke na ${itemName}`)
    const placed = await placeAt(spot)
    if (placed) return placed
  }
  return null
}

async function getTable() {
  const near = bot.findBlock({ matching: mcData.blocksByName.crafting_table.id, maxDistance: 32 })
  if (near) { await goNear(near.position, 3); return near }
  if (!has('crafting_table')) {
    if (!await craft('crafting_table', 1, null)) {
      throw new Error(`nie mam z czego zrobic stolu (deski: ${countMatch(/_planks$/)}, pnie: ${countMatch(WOOD_RE)})`)
    }
  }
  const placed = await placeNear('crafting_table')
  if (!placed) throw new Error('nie moge postawic stolu (brak miejsca obok)')
  return placed
}

async function ensurePlanks(n) {
  if (countMatch(/_planks$/) >= n) return
  const log = logName()
  if (!log) return
  const planks = log.replace(WOOD_RE, '_planks')
  await craft(planks, n, null)
}

// ---------- jedzenie i walka ----------
const FOOD = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'bread', 'baked_potato', 'apple', 'carrot', 'beef', 'porkchop', 'mutton', 'chicken']
// jedzenie, ktore szkodzi (trucizna, glod) - bot go nie je
const BAD_FOOD = ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken', 'suspicious_stew']

// najlepsze jedzenie z ekwipunku; zlote jablka tylko na leczenie (hurt), przy pelnym glodzie tylko one da sie zjesc
function pickFood(hurt) {
  const foods = bot.inventory.items()
    .filter(i => mcData.foodsByName[i.name] && !BAD_FOOD.includes(i.name))
    .sort((a, b) => mcData.foodsByName[b.name].foodPoints - mcData.foodsByName[a.name].foodPoints)
  const golden = foods.filter(f => f.name.includes('golden_apple'))
  if (bot.food >= 20) return hurt ? golden[0] || null : null
  if (hurt) return golden[0] || foods[0] || null
  return foods.find(f => !f.name.includes('golden_apple')) || foods[0] || null
}

async function eatItem(food) {
  await bot.equip(food, 'hand')
  await bot.consume()
}

async function eatIfHungry() {
  if (bot.food >= 14) return
  const food = pickFood(false)
  if (food) { try { await eatItem(food) } catch {} }
}

async function bestSword() {
  const order = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword']
  for (const n of order) {
    const it = bot.inventory.items().find(i => i.name === n)
    if (it) { try { await bot.equip(it, 'hand') } catch {} return }
  }
}

// ---------- instynkt samozachowawczy ----------
// Jak grozny jest mob (im wiecej tym gorzej). Pominiete: enderman, wilki, golemy itp. - nie zaczepiamy ich.
const DANGER = {
  zombie: 2, zombie_villager: 2, husk: 2, drowned: 2.5, skeleton: 3, stray: 3, bogged: 3, spider: 2, cave_spider: 2.5,
  creeper: 6, witch: 3, pillager: 4, vindicator: 5, evoker: 5, ravager: 9, phantom: 3, blaze: 6, ghast: 8,
  wither_skeleton: 6, piglin_brute: 7, hoglin: 6, zoglin: 6, vex: 4, guardian: 5, elder_guardian: 10,
  slime: 1.5, magma_cube: 2, silverfish: 1, endermite: 1, warden: 100, wither: 100, ender_dragon: 100
}
const ALWAYS_FLEE = ['warden', 'wither', 'ender_dragon', 'ghast', 'elder_guardian', 'ravager', 'creeper']
const ARMOR_W = { leather: 1, golden: 1, chainmail: 1.5, iron: 2, diamond: 3, netherite: 3.5 }
const SWORD_W = { wooden: 2, golden: 2, stone: 3, iron: 4, diamond: 5, netherite: 6 }

function myPower() {
  let p = bot.health * 0.4
  for (const slot of [5, 6, 7, 8]) {
    const it = bot.inventory.slots[slot]
    if (it) p += ARMOR_W[it.name.split('_')[0]] || 0
  }
  const sword = bot.inventory.items().find(i => i.name.endsWith('_sword'))
  p += sword ? SWORD_W[sword.name.split('_')[0]] || 1 : 0.5
  if (bot.inventory.slots[45]?.name === 'shield') p += 1.5
  return p
}

function threats(range) {
  return Object.values(bot.entities).filter(e =>
    e !== bot.entity && DANGER[e.name] !== undefined && e.position.distanceTo(bot.entity.position) < range)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
}

let mode = 'normal'
let lastTalk = 0
function setMode(m, text) {
  if (m === mode) return
  mode = m
  console.log('[bot] tryb:', m)
  if (text && Date.now() - lastTalk > 15000) { lastTalk = Date.now(); say(text) }
}

function inBlock(offsetY, names) {
  const b = bot.blockAt(bot.entity.position.offset(0, offsetY, 0))
  return b && names.includes(b.name)
}

// najblizsze suche miejsce (twarde podloze, powietrze nad nim), omijajac wode i lawe
function findLand(radius = 14) {
  const base = bot.entity.position.floored()
  let best = null
  let bestD = Infinity
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -2; dy <= 3; dy++) {
        const feet = bot.blockAt(base.offset(dx, dy, dz))
        const floor = bot.blockAt(base.offset(dx, dy - 1, dz))
        const head = bot.blockAt(base.offset(dx, dy + 1, dz))
        if (!feet || !floor || !head) continue
        if (feet.name === 'air' && head.name === 'air' && floor.boundingBox === 'block' &&
            !['lava', 'water', 'magma_block', 'cactus', 'fire'].includes(floor.name)) {
          const d = dx * dx + dz * dz + dy * dy * 4
          if (d < bestD) { bestD = d; best = feet.position }
        }
      }
    }
  }
  return best
}

// ---------- deep dark i warden ----------
// miejsca, gdzie byl warden albo sculk (deep dark) - przy kopaniu trzymamy sie od nich z daleka
const dangerZones = []
let lastWardenSeen = 0
const SCULK = ['sculk_shrieker', 'sculk_sensor', 'calibrated_sculk_sensor', 'sculk_catalyst', 'sculk']

function markDangerZone(pos) {
  if (dangerZones.some(z => Math.hypot(z.x - pos.x, z.z - pos.z) < 16)) return
  dangerZones.push({ x: Math.floor(pos.x), z: Math.floor(pos.z) })
  console.log(`[bot] niebezpieczne miejsce (deep dark/warden) na ${Math.floor(pos.x)} ${Math.floor(pos.z)}`)
}

function nearDangerZone(pos, r) {
  return dangerZones.find(z => Math.hypot(z.x - pos.x, z.z - pos.z) < r)
}

// kierunek (po osi) od najblizszej strefy zagrozenia, albo null gdy zadnej w poblizu
function awayFromDanger() {
  const p = bot.entity.position
  const z = nearDangerZone(p, 96)
  if (!z) return null
  const dx = p.x - z.x
  const dz = p.z - z.z
  return Math.abs(dx) > Math.abs(dz) ? { x: Math.sign(dx) || 1, z: 0 } : { x: 0, z: Math.sign(dz) || 1 }
}

// sculk w poblizu = deep dark, gdzie czujniki i skrzeczace bloki przywoluja wardena
function sculkNear(r) {
  const ids = SCULK.map(n => mcData.blocksByName[n]?.id).filter(x => x !== undefined)
  return bot.findBlock({ matching: ids, maxDistance: r })
}

// kierunek po osi od podanego punktu (np. od wardena)
function axisAwayFrom(pos) {
  const me = bot.entity.position
  const dx = me.x - pos.x
  const dz = me.z - pos.z
  if (Math.abs(dx) < 0.5 && Math.abs(dz) < 0.5) return facingAxis()
  return Math.abs(dx) > Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) }
}

let escaping = false
async function escapeWarden() {
  if (escaping) return
  escaping = true
  running = false // przerywamy zadanie: kopanie i chodzenie robia halas, ktory go przyciaga
  lastWardenSeen = Date.now()
  setMode('warden', 'Warden! Uciekam i kopie waski tunel - on sie w nim nie zmiesci.')
  const solid = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'block' }
  let lastPos = bot.entity.position.clone()
  let stuckSince = Date.now()
  try {
    bot.pvp.stop()
    bot.pathfinder.setGoal(null)
    for (const until = Date.now() + 120000; Date.now() < until && bot.health > 0;) {
      bot.pathfinder.setGoal(null) // konczace sie zadanie moglo jeszcze cos ustawic
      const warden = bot.nearestEntity(e => e.name === 'warden')
      const dist = warden ? warden.position.distanceTo(bot.entity.position) : Infinity
      if (dist < 40) { lastWardenSeen = Date.now(); markDangerZone(warden.position) }
      if (Date.now() - lastWardenSeen > 10000) break // nie widac go od 10 s - jestesmy bezpieczni

      const feet = bot.entity.position.floored()
      let dir = warden ? axisAwayFrom(warden.position) : facingAxis()
      for (let turn = 0; turn < 3 && dangerNear(feet.offset(dir.x, 0, dir.z)); turn++) dir = turnRight(dir) // nie w lawe
      const legs = feet.offset(dir.x, 0, dir.z)
      const head = legs.offset(0, 1, 0)

      if (solid(legs) || solid(head)) {
        // sciana: stajemy i przekopujemy przejscie (najpierw glowa, potem nogi)
        bot.clearControlStates()
        for (const p of [head, legs]) {
          const b = bot.blockAt(p)
          if (!b || b.boundingBox !== 'block' || !bot.canDigBlock(b)) continue
          try { await bot.tool.equipForBlock(b, {}) } catch {}
          try { await bot.dig(b, true) } catch {}
        }
      } else {
        await bot.lookAt(bot.entity.position.offset(dir.x * 6, 1.6, dir.z * 6), true)
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
        bot.setControlState('jump', bot.entity.isCollidedHorizontally) // stopien o 1 blok - przeskakujemy
        await sleep(150)
      }

      // brak postepu, a warden tuz obok: nie ma gdzie uciec - bronimy sie
      if (bot.entity.position.distanceTo(lastPos) > 0.7) { lastPos = bot.entity.position.clone(); stuckSince = Date.now() }
      else if (warden && dist < 4 && Date.now() - stuckSince > 2500) {
        if (Date.now() - stuckSince < 3000) say('Nie mam gdzie uciec - walcze!')
        await bestSword()
        bot.attack(warden)
        await sleep(600)
      }
      if (bot.health < 8) await eatIfLow()
    }
  } catch (e) {
    console.log('[bot] ucieczka blad:', e.message)
  } finally {
    bot.clearControlStates()
    escaping = false
    setMode('normal')
    if (bot.health > 0) say('Ucieklem przed wardenem. To miejsce bede omijal przy kopaniu.')
  }
}

let busy = false
async function survivalTick() {
  if (busy || !bot.entity || !mcData || bot.health <= 0) return
  busy = true
  try {
    // 1. lawa i ogien - najwazniejsze
    if (inBlock(0, ['lava']) || inBlock(1, ['lava']) || inBlock(0, ['fire', 'soul_fire'])) {
      setMode('lava', 'Lawa! Uciekam!')
      bot.pvp.stop()
      bot.setControlState('jump', true)
      const land = findLand(8)
      if (land) bot.pathfinder.setGoal(new goals.GoalNear(land.x, land.y, land.z, 0), true)
      return
    }

    // 2. topienie: brakuje tlenu albo jestesmy pod woda
    const underwater = inBlock(1, ['water']) || bot.oxygenLevel < 20 && bot.entity.isInWater
    if (bot.entity.isInWater && (underwater || bot.oxygenLevel < 15)) {
      setMode('swim', 'Plynie do brzegu.')
      bot.setControlState('jump', true)
      bot.setControlState('sprint', true)
      const land = findLand(14)
      if (land) bot.pathfinder.setGoal(new goals.GoalNear(land.x, land.y, land.z, 1), true)
      return
    }
    if (mode === 'swim' || mode === 'lava') {
      bot.setControlState('jump', false)
      bot.pathfinder.setGoal(null)
      setMode('normal')
    }

    // 3. warden: nie do pokonania - przerywamy zadanie i uciekamy (osobna petla, patrz escapeWarden)
    if (escaping) return
    const warden = bot.nearestEntity(e => e.name === 'warden' && e.position.distanceTo(bot.entity.position) < 40)
    if (warden) { escapeWarden(); return }

    // 4. zagrozenie od pozostalych mobow
    const near = threats(running ? 12 : 6)
    const threat = near.reduce((s, e) => s + DANGER[e.name], 0)
    const power = myPower()
    const closest = near[0]

    if (!closest) {
      if (mode === 'flee' || mode === 'fight') {
        bot.pvp.stop()
        bot.pathfinder.setGoal(null)
        bot.setControlState('sprint', false)
        setMode('normal')
        await eatIfLow()
      }
      return
    }

    const dist = closest.position.distanceTo(bot.entity.position)
    const mustFlee = near.some(e => ALWAYS_FLEE.includes(e.name) && e.position.distanceTo(bot.entity.position) < (e.name === 'creeper' ? 6 : 16))
    const lowHp = bot.health <= 6

    if (mustFlee || lowHp || threat > power) {
      if (!mustFlee || closest.name !== 'warden') askForFightHelp()
      setMode('flee', lowHp ? 'Malo zycia, uciekam!' : 'Za grozne, uciekam!')
      bot.pvp.stop()
      bot.setControlState('sprint', true)
      bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(closest, 24)), true)
      if (dist > 8) await eatIfLow()
      return
    }

    // walka: tylko gdy jestesmy silniejsi
    if (dist < (running ? 10 : 5)) {
      if (threat >= 4) askForFightHelp()
      setMode('fight')
      await bestSword()
      if (!bot.pvp.target) bot.pvp.attack(closest)
    }
  } catch (e) {
    console.log('[bot] instynkt blad:', e.message)
  } finally {
    busy = false
  }
}

// jezeli zdrowie niskie, zjedz co masz (golden apple najpierw)
async function eatIfLow() {
  if (bot.health >= 14 && bot.food >= 14) return
  const f = pickFood(bot.health < 14)
  if (f) { try { await eatItem(f) } catch {} }
}

setInterval(survivalTick, 400)

// ---------- odblokowanie: bot wbity w blok albo zaklinowany ----------
// pozycje stawianych wlasnie blokow budowli - tych przy odblokowywaniu nie kopiemy
const noDigPositions = new Set()

// bloki postawionych budowli (z builds.json, razem z wystrojem): pathfinder nie kopie przez nie drogi,
// odblokowywanie ich nie rusza, a "zdobadz bruk" nie rozbiera zamku z bruku
let builtCache = null
function builtPositions() {
  if (builtCache) return builtCache
  builtCache = new Set()
  for (const r of builds) {
    try {
      const o = new Vec3(r.origin.x, r.origin.y, r.origin.z)
      for (const c of [...(planOf(r.type) || []), ...(decorPlan(r.type) || [])]) {
        if (c.block !== 'air' && !c.temp) builtCache.add(posKey(toWorld(o, r.front, c.x, c.y, c.z)))
      }
    } catch (e) { console.log('[bot] ochrona budowli:', e.message) }
  }
  return builtCache
}
const forgetBuiltCache = () => { builtCache = null }
const isBuilt = p => noDigPositions.has(posKey(p)) || builtPositions().has(posKey(p))
// ruchy pathfindera, ktore omijaja budowle zamiast je przekopywac
function protectBuilds(moves) {
  moves.exclusionAreasBreak.push(b => isBuilt(b.position) ? 1000 : 0)
  return moves
}

// blok, ktorego ksztalt naprawde nachodzi na cialo bota (0.6 x 1.8) - wtedy bot jest w nim "wbity"
// drabiny i pnacza: bot na nich wisi, wiec nie sa ani przeszkoda, ani rzecza do wykopania
const CLIMBABLE = ['ladder', 'vine', 'scaffolding', 'twisting_vines', 'weeping_vines', 'cave_vines']
const onClimbable = () => { const b = bot.blockAt(bot.entity.position.floored()); return !!b && CLIMBABLE.includes(b.name) }

// Wspinanie: pathfinder na drabinie czesto nie wciska skoku, a od 1.14 wspina sie wlasnie skokiem (albo pchajac w sciane).
// Gdy kolejny punkt drogi jest nad nami, a my wisimy na drabinie - trzymamy skok.
let lastPath = []
bot.on('path_update', r => { lastPath = r.path || [] })
bot.on('goal_reached', () => { lastPath = [] })
let climbJump = false
bot.on('physicsTick', () => {
  if (!bot.entity) return
  const climbing = lastPath.length && bot.pathfinder.isMoving() && onClimbable()
  const p = bot.entity.position
  const up = climbing && lastPath.some(n => Math.abs(n.x - p.x) < 1.2 && Math.abs(n.z - p.z) < 1.2 && n.y > p.y + 0.6)
  if (up) { bot.setControlState('jump', true); climbJump = true } else if (climbJump) { bot.setControlState('jump', false); climbJump = false }
})

function embeddedBlock() {
  const p = bot.entity.position
  const box = [p.x - 0.29, p.y + 0.05, p.z - 0.29, p.x + 0.29, p.y + 1.75, p.z + 0.29]
  for (let x = Math.floor(box[0]); x <= Math.floor(box[3]); x++) {
    for (let y = Math.floor(box[1]); y <= Math.floor(box[4]); y++) {
      for (let z = Math.floor(box[2]); z <= Math.floor(box[5]); z++) {
        const b = bot.blockAt(new Vec3(x, y, z))
        if (!b || !b.shapes?.length || CLIMBABLE.includes(b.name)) continue // na drabinie bot ma prawo "dotykac" bloku
        for (const s of b.shapes) {
          if (x + s[0] < box[3] && x + s[3] > box[0] && y + s[1] < box[4] && y + s[4] > box[1] && z + s[2] < box[5] && z + s[5] > box[2]) return b
        }
      }
    }
  }
  return null
}

let unsticking = false
let stuckSince = Date.now()
let lastMovePos = null
async function unstickTick() {
  if (!bot.entity || !mcData || unsticking || bot.targetDigBlock || bot.isSleeping || escaping || bot.health <= 0) return
  const pos = bot.entity.position
  // "chce isc": pathfinder prowadzi albo wcisniety jest klawisz ruchu
  const wantsMove = bot.pathfinder.isMoving() || bot.controlState.forward || bot.controlState.back
  if (!lastMovePos || pos.distanceTo(lastMovePos) > 0.3 || !wantsMove) { lastMovePos = pos.clone(); stuckSince = Date.now() }
  const inside = embeddedBlock()
  const jammed = wantsMove && Date.now() - stuckSince > 5000
  if (!inside && !jammed) return

  unsticking = true
  try {
    const canBreak = b => b && b.boundingBox === 'block' && bot.canDigBlock(b) && !isBuilt(b.position) && !CLIMBABLE.includes(b.name) &&
      !/_door$|_fence_gate$|chest|furnace|crafting_table|bed$/.test(b.name)
    if (inside) {
      if (Date.now() - (unstickTick.lastLog || 0) > 10000) { unstickTick.lastLog = Date.now(); console.log(`[bot] jestem wbity w ${inside.name} - wykopuje sie`) }
      if (/_door$|_fence_gate$/.test(inside.name)) { await bot.activateBlock(inside) } // drzwi/furtke otwieramy
      else if (canBreak(inside)) { try { await bot.tool.equipForBlock(inside, {}) } catch {} await bot.dig(inside, true) }
      else if (isBuilt(inside.position) && isCreative() && bot.canDigBlock(inside)) {
        // wbity we wlasna budowle: w kreatywnym wyjmujemy blok, wychodzimy i zaraz odstawiamy go na miejsce
        const p = inside.position.clone()
        const name = inside.name
        await bot.dig(inside, true)
        setTimeout(async () => {
          try { if (bot.blockAt(p)?.name === 'air') { await creativeGive(name, 1); await placeBlockAt(name, p) } } catch (e) { console.log('[bot] nie odstawilem bloku:', e.message) }
        }, 2500)
      }
      else {
        // nie da sie wykopac (np. czesc budowli): wyskakujemy w gore/bok
        bot.setControlState('jump', true)
        bot.setControlState('back', true)
        await sleep(500)
        bot.setControlState('jump', false)
        bot.setControlState('back', false)
      }
    } else {
      // tylko zaklinowany (nie wbity): nie kopiemy - to moglaby byc sciana budowli albo blanki.
      // Skok (np. na stopien), lekki ruch w bok i nowa droga zwykle wystarcza.
      console.log('[bot] utknalem w miejscu - probuje sie odblokowac')
      if (onClimbable()) {
        // na drabinie: cel wyzej - wspinaczka (skok), nizej - puszczamy wszystko i zjezdzamy
        const p = bot.entity.position
        const up = lastPath.some(n => n.y > p.y + 0.6)
        bot.clearControlStates()
        if (up) { bot.setControlState('jump', true); bot.setControlState('forward', true); await sleep(800) } else await sleep(800)
        bot.clearControlStates()
        if (bot.pathfinder.goal) bot.pathfinder.setMovements(bot.pathfinder.movements)
        return
      }
      bot.setControlState('jump', true)
      bot.setControlState(Math.random() < 0.5 ? 'left' : 'right', true)
      await sleep(400)
      bot.clearControlStates()
      // pathfinder liczy droge od nowa z nowego miejsca (ten sam cel, wiec trwajace "idz do" nie jest przerywane)
      if (bot.pathfinder.goal) bot.pathfinder.setMovements(bot.pathfinder.movements)
    }
  } catch (e) {
    console.log('[bot] odblokowanie:', e.message)
  } finally {
    stuckSince = Date.now()
    lastMovePos = bot.entity.position.clone()
    unsticking = false
  }
}
setInterval(unstickTick, 1000)

// automatyczne jedzenie: gdy glod albo zdrowie spadnie ponizej 4 ikon (8 punktow z 20)
const AUTO_EAT_BELOW = parseInt(process.env.MC_EAT_BELOW || '8')
let eating = false
let lastNoFood = 0
async function autoEat() {
  if (eating || !mcData || !bot.entity || bot.health <= 0 || isCreative()) return
  const hungry = bot.food < AUTO_EAT_BELOW
  const hurt = bot.health < AUTO_EAT_BELOW
  if (!hungry && !hurt) return
  // nie jemy, gdy wróg jest tuz obok (1.6 s jedzenia to za dlugo), chyba ze zdrowie jest krytyczne
  const close = threats(3)
  if (close.length && bot.health > 4) return
  const food = pickFood(hurt)
  if (!food) {
    // ranny przy pelnym glodzie bez zlotego jablka - zdrowie i tak sie zregeneruje, nie ma co krzyczec
    if (hungry && Date.now() - lastNoFood > 60000) { lastNoFood = Date.now(); say('Glodny, a nie mam jedzenia!') }
    return
  }
  eating = true
  try {
    await eatItem(food)
    console.log(`[bot] zjadlem ${food.name} (glod ${Math.round(bot.food)}, zdrowie ${Math.round(bot.health)})`)
  } catch (e) {
    console.log('[bot] jedzenie nie wyszlo:', e.message)
  } finally {
    eating = false
  }
}
setInterval(autoEat, 1000)

// ---------- glod: polowanie, gdy nie ma co jesc ----------
const FOOD_ANIMALS = ['cow', 'pig', 'sheep', 'chicken', 'rabbit']

// atakuje zwierze i czeka, az padnie (max 20 s); zwraca czy padlo
async function killAnimal(animal) {
  setStatus(`poluje na ${animal.name}`)
  await bestSword()
  let dead = false
  const onDead = e => { if (e === animal) dead = true }
  bot.on('entityDead', onDead)
  bot.pvp.attack(animal)
  for (let t = 0; t < 40 && running && !dead && bot.entities[animal.id]; t++) await sleep(500)
  bot.removeListener('entityDead', onDead)
  bot.pvp.stop()
  return dead || !bot.entities[animal.id]
}

// glodny i bez jedzenia: zabija najblizsze zwierze, podnosi mieso i je (surowa wolowina/wieprzowina sa bezpieczne)
async function ensureFed() {
  if (bot.food >= AUTO_EAT_BELOW || pickFood(false)) return true
  for (let tries = 0; tries < 3 && running; tries++) {
    const animal = bot.nearestEntity(e => FOOD_ANIMALS.includes(e.name) && e.position.distanceTo(bot.entity.position) < 48)
    if (!animal) {
      if (tries === 0) say('Jestem glodny, a nie mam jedzenia - szukam zwierzat.')
      await explore()
      continue
    }
    say(`Jestem glodny - poluje (${animal.name}).`)
    await killAnimal(animal)
    await pickUpItems(8)
    const food = pickFood(false)
    if (food) { try { await eatItem(food) } catch {} return true }
  }
  return false
}

// bezczynny i glodny bez jedzenia: sam rusza na polowanie, zamiast stac w miejscu
setInterval(() => {
  if (running || activeTasks > 0 || !mcData || !bot.entity || bot.health <= 0) return
  if (bot.food >= AUTO_EAT_BELOW || pickFood(false)) return
  task('polowanie (glod)', ensureFed)
}, 10000)

// ---------- etapy ----------
async function hunt() {
  const animal = bot.nearestEntity(e => ['cow', 'pig', 'sheep', 'chicken'].includes(e.name))
  if (animal) {
    await bestSword()
    bot.pvp.attack(animal)
    await sleep(6000)
    // zbierz drop
    const drop = bot.nearestEntity(e => e.name === 'item')
    if (drop) { try { await goNear(drop.position, 0) } catch {} }
  }
}

async function stageWood() {
  say('Etap 1: drewno')
  if (!await collect(woodBlocks(), 12, WOOD_RE)) return false
  await ensurePlanks(8)
  const table = await getTable()
  await ensurePlanks(8)
  if (count('stick') < 4) await craft('stick', 4, null)
  if (!has('wooden_pickaxe')) await craft('wooden_pickaxe', 1, table)
  if (!has('wooden_sword')) await craft('wooden_sword', 1, table)
  return has('wooden_pickaxe')
}

async function stageStone() {
  say('Etap 2: kamien')
  if (!await collect(['stone', 'cobblestone'], 20, /^cobblestone$/)) return false
  const table = await getTable()
  if (count('stick') < 4) { await ensurePlanks(4); await craft('stick', 4, null) }
  if (!has('stone_pickaxe')) await craft('stone_pickaxe', 1, table)
  if (!has('stone_sword')) await craft('stone_sword', 1, table)
  if (!has('stone_axe')) await craft('stone_axe', 1, table)
  if (!has('furnace')) await craft('furnace', 1, table)
  return has('stone_pickaxe')
}

async function stageFood() {
  say('Etap 3: jedzenie')
  let tries = 0
  while (running && countMatch(/beef|porkchop|mutton|chicken|bread/) < 6 && tries < 10) {
    await hunt()
    tries++
  }
  return countMatch(/beef|porkchop|mutton|chicken|bread/) >= 6
}

// ---------- przepalanie ----------
const SMELTABLE = /^(raw_iron|raw_gold|raw_copper|beef|porkchop|mutton|chicken|rabbit|cod|salmon|potato|kelp)$/
// ile przedmiotow przepala jedna sztuka paliwa
const FUEL_VALUE = { coal: 8, charcoal: 8, planks: 1.5, log: 1.5, stem: 1.5, stick: 0.5 }

function fuelStack() {
  const items = bot.inventory.items()
  const pick = re => items.find(i => re.test(i.name))
  const it = pick(/^(coal|charcoal)$/) || pick(/_planks$/) || pick(/_(log|stem)$/) || pick(/^stick$/)
  if (!it) return null
  const kind = /coal|charcoal/.test(it.name) ? 'coal' : /planks/.test(it.name) ? 'planks' : /stick/.test(it.name) ? 'stick' : 'log'
  return { item: it, per: FUEL_VALUE[kind] }
}

async function ensureFurnaceBlock() {
  let block = bot.findBlock({ matching: mcData.blocksByName.furnace.id, maxDistance: 32 })
  if (block) return block
  if (!has('furnace')) {
    if (count('cobblestone') < 8) {
      await ensurePickaxe(0)
      if (!await collect(['stone', 'cobblestone'], 8, /^cobblestone$/)) return null
    }
    const table = await getTable()
    await craft('furnace', 1, table)
  }
  return await placeNear('furnace')
}

// przepala wszystko, co sie da (rudy, surowe mieso, ziemniaki); zwraca liczbe przepalonych
// filter: co przepalamy (domyslnie rudy i surowe jedzenie); np. /^sand$/ zeby zrobic szklo
async function smeltAll(filter = SMELTABLE) {
  let total = 0
  const raw = () => bot.inventory.items().filter(i => filter.test(i.name))
  if (!raw().length) return 0
  const block = await ensureFurnaceBlock()
  if (!block) { say('Nie mam pieca ani kamienia na piec.'); return 0 }
  await goNear(block.position, 3)
  const furnace = await bot.openFurnace(block)
  try {
    for (const input of raw()) {
      if (!running) break
      let fuel = fuelStack()
      if (!fuel) {
        furnace.close()
        if (!await collect(woodBlocks(), 2, WOOD_RE)) return total
        fuel = fuelStack()
        if (!fuel) return total
        return total + await smeltAll(filter)
      }
      const need = Math.ceil(input.count / fuel.per)
      setStatus(`przepalam ${input.name} x${input.count} (ok. ${Math.ceil(input.count * 10.5)} s)`)
      await furnace.putFuel(fuel.item.type, null, Math.min(need, fuel.item.count))
      await furnace.putInput(input.type, null, input.count)
      // 10 s na sztuke; czekamy w kawalkach, zeby "stop" dzialal
      for (let t = 0; t < input.count * 10.5 && running; t++) await sleep(1000)
      try { await furnace.takeOutput() } catch {}
      total += input.count
    }
  } catch (e) {
    console.log('przepalanie blad:', e.message)
  } finally {
    try { furnace.close() } catch {}
  }
  return total
}

// ---------- narzedzia na zamowienie ----------
const TIERS = ['wooden', 'stone', 'iron', 'diamond']
// jakiego kilofa wymaga blok (indeks w TIERS); brak wpisu = reka wystarczy
const ORE_TIER = { stone: 0, cobblestone: 0, coal_ore: 0, copper_ore: 1, iron_ore: 1, lapis_ore: 1, gold_ore: 2, redstone_ore: 2, diamond_ore: 2, emerald_ore: 2, obsidian: 3 }

function bestPickTier() {
  let best = -1
  for (const it of bot.inventory.items()) {
    const m = it.name.match(/^(\w+)_pickaxe$/)
    if (m) best = Math.max(best, m[1] === 'golden' ? 0 : TIERS.indexOf(m[1]))
  }
  return best
}

// drewno liczone w deskach (pien = 4 deski); scina brakujace pnie
async function ensureWood(planks) {
  const have = () => countMatch(/_planks$/) + countMatch(WOOD_RE) * 4
  if (have() >= planks) return true
  return await collect(woodBlocks(), countMatch(WOOD_RE) + Math.ceil((planks - have()) / 4), WOOD_RE)
}

async function makePickaxe(tier) {
  const mat = TIERS[tier]
  say(`Robie ${mat}_pickaxe.`)
  setStatus(`robie ${mat}_pickaxe (potrzebny do kopania)`)
  // zapas drewna na pozniej: stoly, patyki i paliwo do pieca beda potrzebne pod ziemia, gdzie drzew nie ma
  if (tier === 0) {
    if (!await ensureWood(24)) return false
    await ensurePlanks(12)
  } else {
    await ensureWood(8)
  }
  if (tier === 1) {
    if (!await collect(['stone', 'cobblestone'], 3, /^cobblestone$/)) return false
  } else if (tier === 2) {
    if (count('iron_ingot') < 3) {
      if (!await collect(['iron_ore', 'deepslate_iron_ore'], 3, /^(raw_iron|iron_ingot)$/)) return false
      await smeltAll()
    }
  } else if (tier === 3) {
    if (count('diamond') < 3 && !await stageDiamond()) return false
  }
  if (goalReached()) return true
  return await craftItem(`${mat}_pickaxe`)
}

async function ensurePickaxe(tier) {
  for (let t = Math.max(0, bestPickTier() + 1); t <= tier && running && !goalReached(); t++) {
    if (bestPickTier() >= tier) break
    if (!await makePickaxe(t) && !goalReached()) { say(`Nie udalo mi sie zrobic kilofa (${TIERS[t]}).`); return false }
  }
  return bestPickTier() >= tier
}

// najlepsze narzedzie danego typu, jakie da sie zrobic z tego, co mamy w ekwipunku
async function craftBasicTool(part) {
  if (bot.inventory.items().some(i => i.name.endsWith('_' + part))) return true
  for (const mat of ['iron', 'stone', 'wooden']) {
    if (await craftItem(`${mat}_${part}`)) return true
  }
  return false
}

let preparing = false
async function prepareFor(names) {
  if (preparing) return
  preparing = true
  try {
    const tiers = names.map(n => ORE_TIER[n.replace('deepslate_', '')]).filter(t => t !== undefined)
    if (tiers.length) await ensurePickaxe(Math.max(...tiers))
    if (names.some(n => WOOD_RE.test(n))) await craftBasicTool('axe')
    if (names.some(n => /^(dirt|grass_block|sand|gravel|clay)$/.test(n))) await craftBasicTool('shovel')
    if (!bot.inventory.items().some(i => i.name.endsWith('_sword'))) await craftBasicTool('sword')
  } catch (e) {
    console.log('przygotowanie blad:', e.message)
  } finally {
    preparing = false
  }
}

async function stageIron() {
  say('Etap 4: zelazo')
  await collect(['coal_ore', 'deepslate_coal_ore'], 8, /^coal$/)
  if (!await collect(['iron_ore', 'deepslate_iron_ore'], 11, /^raw_iron$/)) return false
  await smeltAll()
  const table = await getTable()
  if (count('stick') < 4) { await ensurePlanks(4); await craft('stick', 4, null) }
  if (count('iron_ingot') >= 3 && !has('iron_pickaxe')) await craft('iron_pickaxe', 1, table)
  if (count('iron_ingot') >= 2 && !has('iron_sword')) await craft('iron_sword', 1, table)
  if (count('iron_ingot') >= 1 && !has('shield')) { try { await craft('shield', 1, table) } catch {} }
  if (count('iron_ingot') >= 5 && !has('iron_chestplate')) await craft('iron_chestplate', 1, table)
  for (const a of ['iron_helmet', 'iron_leggings', 'iron_boots', 'iron_chestplate']) {
    const it = bot.inventory.items().find(i => i.name === a)
    if (it) {
      const slot = a.includes('helmet') ? 'head' : a.includes('chestplate') ? 'torso' : a.includes('leggings') ? 'legs' : 'feet'
      try { await bot.equip(it, slot) } catch {}
    }
  }
  return has('iron_pickaxe')
}

async function stageDiamond() {
  say('Etap 5: diamenty')
  // collect sam zrobi brakujace kilofy (drewniany, kamienny, zelazny) i zejdzie kopiac na glebokosc diamentow
  return await collect(['diamond_ore', 'deepslate_diamond_ore'], 3, /^diamond$/)
}

const STAGES = [stageWood, stageStone, stageFood, stageIron, stageDiamond]

// jeden etap, do 3 prob; zwraca czy sie udal
async function tryStage(stage) {
  let ok = false
  for (let attempt = 0; attempt < 3 && running && !ok; attempt++) {
    try { ok = await stage() } catch (e) { console.log(stage.name, 'blad:', e.message) }
    await eatIfHungry()
  }
  if (running) say(`${stage.name}: ${ok ? 'gotowe' : 'nie udalo sie'}`)
  return ok
}

function run() {
  return task('wszystkie etapy', async () => {
    for (const stage of STAGES) {
      if (!running) break
      await tryStage(stage)
    }
    if (running) say('Koniec zaplanowanych etapow. Nether, End i smok nie sa jeszcze zrobione.')
  })
}

const HELP = [
  'Zadania: start, etap <drewno|kamien|jedzenie|zelazo|diamenty>, zdobadz <surowiec|przedmiot|jedzenie> [ile], poluj [zwierze] [ile], przepal, scraftuj <co>, stop',
  'Ruch: tu, idz <ile> <przod|tyl|lewo|prawo>, idz do <x z | punkt | gracz>, chodz za mna, ochraniaj [gracz], zabij <gracz>, spij',
  'Budowa (z wystrojem): zburz <budowla>, usun obszar <x y z|nick> <x y z|nick>, rozbierz rusztowania, buduj dom | zamek | zamczysko | palac | palac endu | dom villagera | baza podziemna | skybase | napis: <tekst> | farma <zboza|marchwi|ziemniakow|burakow|drzew|trzciny|zwierzat>',
  'Punkty: zapisz <nazwa>, ustaw dom, dom, punkty, usun <nazwa>, gdzie',
  'Rzeczy: eq, czy masz <co>, postaw <co> [x y z], daj <co> [ile], wez <co> [ile], schowaj [co|wszystko], przeszukaj, szukaj, skrzynie wl/wyl, wyrzuc <co|smieci> [ile], trzymaj <co>, zaloz, jedz, podnies',
  'Zespol: pomoz [bot], pomoc <kto> <komu> (np. pomoc Kopacz Claude), popros <bot> o <co> [ile], zabij <gracz|mob|imie>',
  'Po bledzie (np. zabraklo blokow): daj mu brakujace rzeczy i napisz kontynuuj. Ile do konca budowy: czas',
  'Wlasne: projekty, buduj <projekt>, moje komendy, naucz sie <nazwa>: krok; krok, zapomnij komende <nazwa>',
  'Inne: status, co robisz, diag, chat <tekst>, permisja <nick>, odbierz <nick>, permisje'
]

const STAGE_BY_NAME = { drewno: stageWood, kamien: stageStone, jedzenie: stageFood, zelazo: stageIron, diamenty: stageDiamond }

function runStage(name) {
  const stage = STAGE_BY_NAME[stripPl(name || '')]
  if (!stage) { say('Etapy: ' + Object.keys(STAGE_BY_NAME).join(', ')); return }
  return task(`etap ${name}`, () => tryStage(stage))
}

// ---------- czat i zdarzenia ----------
process.on('uncaughtException', e => console.log('[bot] Blad:', e.message))
// Node 22 bez tego konczy caly proces przy nieobsluzonym bledzie w obietnicy - bot by sie "wylogowal" bez slowa
process.on('unhandledRejection', e => console.log('[bot] Nieobsluzony blad:', e?.stack || e))
console.log('[bot] Laczenie z', target.host + ':' + target.port, '...')
bot.once('connect', () => console.log('[bot] Nawiazano polaczenie TCP, loguje...'))
// Po zmianie swiata (respawn, np. po /login) mineflayer wylacza fizyke i wlacza ja dopiero po pozycji od serwera.
// Ten serwer jej nie wysyla, wiec bot stoi zamrozony (na ziemi: false). Wtedy wlaczamy fizyke recznie,
// podajac botowi jego wlasna pozycje tak, jakby przyszla od serwera.
let lastPhysTick = Date.now()
let lastWorldEntry = 0
let lastTeleportId = 0
let lastRescue = 0
bot._client.on('position', p => { lastTeleportId = p.teleportId ?? 0 })
let forcedTotal = 0
bot.on('forcedMove', () => { forcedTotal++ })
bot.on('physicsTick', () => { lastPhysTick = Date.now() })
bot.on('respawn', () => { lastWorldEntry = Date.now(); console.log('[bot] zdarzenie: respawn') })
bot.on('mount', () => console.log('[bot] zdarzenie: mount'))
bot.on('login', () => console.log('[bot] zdarzenie: login'))
bot.on('spawn', () => { lastWorldEntry = Date.now() })

// stan fizyki do diagnozy: czy tikuje, czy jest chunk pod botem, czy nie siedzi na czyms
function physicsReport() {
  const p = bot.entity?.position
  const here = p && bot.blockAt(p)
  const below = p && bot.blockAt(p.offset(0, -1, 0))
  return `tiki fizyki: ${Date.now() - lastPhysTick} ms temu, blok w bocie: ${here ? here.name : 'BRAK (chunk niezaladowany)'}, ` +
    `blok pod botem: ${below ? below.name : 'BRAK'}, pojazd: ${bot.vehicle ? bot.vehicle.name : 'brak'}, na ziemi: ${bot.entity?.onGround}, cofniec od serwera: ${forcedTotal}, ` +
    `poz: ${p ? [p.x, p.y, p.z].map(v => v.toFixed(2)).join(',') : '?'}, v: ${bot.entity ? [bot.entity.velocity.x, bot.entity.velocity.y, bot.entity.velocity.z].map(v => v.toFixed(3)).join(',') : '?'}, ` +
    `klawisze: ${Object.entries(bot.controlState).filter(([, on]) => on).map(([k]) => k).join('+') || 'brak'}, efekty: ${JSON.stringify(bot.entity?.effects)}, ` +
    `atrybuty: ${JSON.stringify(Object.fromEntries(Object.entries(bot.entity?.attributes || {}).map(([k, a]) => [k.replace('minecraft:', ''), a.value])))}`
}

setInterval(() => {
  if (!bot.entity || !lastWorldEntry) return
  const stalled = Date.now() - lastPhysTick > 3000 && Date.now() - lastWorldEntry > 4000
  if (!stalled || Date.now() - lastRescue < 10000) return
  lastRescue = Date.now()
  console.log('[bot] fizyka nie dziala:', physicsReport())
  if (bot.vehicle) { console.log('[bot] zsiadam z pojazdu.'); try { bot.dismount() } catch {}; return }
  if (!bot.blockAt(bot.entity.position)) return // chunk niezaladowany - wlaczenie fizyki nic nie da
  // serwer nie wyslal pozycji po zmianie swiata: podajemy botowi jego wlasna pozycje, jakby przyszla od serwera
  console.log('[bot] wlaczam fizyke recznie.')
  const conv = require('mineflayer/lib/conversions')
  const p = bot.entity.position
  // mineflayer odpowiada na pozycje potwierdzeniem teleportu; falszywe (stare) potwierdzenie
  // wpedza antycheat serwera w petle cofania, wiec na czas tej podmiany je blokujemy
  const write = bot._client.write
  bot._client.write = function (name, data) { if (name !== 'teleport_confirm') return write.call(this, name, data) }
  try {
    bot._client.emit('position', {
      teleportId: lastTeleportId,
      x: p.x, y: p.y, z: p.z,
      yaw: conv.toNotchianYaw(bot.entity.yaw), pitch: conv.toNotchianPitch(bot.entity.pitch),
      flags: { x: false, y: false, z: false, yaw: false, pitch: false }
    })
  } finally {
    bot._client.write = write
  }
}, 1000)

// automatyczne logowanie (plugin w stylu AuthMe). Haslo podaje sie w start.js albo zmienna MC_PASS;
// bez hasla bot sie nie loguje sam (mozna wpisac /login recznie w konsoli).
const PASSWORD = process.env.MC_PASS || ''
let authTries = 0
let lastAuth = 0
bot.on('messagestr', m => {
  if (!m.trim()) return
  console.log('[serwer]', m)
  if (process.env.MC_AUTOLOGIN === '0' || !PASSWORD || authTries >= 4 || Date.now() - lastAuth < 3000) return
  if (/successful|zalogowan|zarejestrowan|logged in\./i.test(m)) { authTries = 99; return }
  if (/\/register/i.test(m) && !/usage/i.test(m)) {
    authTries++; lastAuth = Date.now()
    sendChat(`/register ${PASSWORD} ${PASSWORD}`)
  } else if (/\/login/i.test(m) && !/usage/i.test(m)) {
    authTries++; lastAuth = Date.now()
    sendChat(`/login ${PASSWORD}`)
  } else if (/usage: \/register/i.test(m)) {
    // serwer wymaga rejestracji, a my jeszcze nie wyslalismy
    authTries++; lastAuth = Date.now()
    sendChat(`/register ${PASSWORD} ${PASSWORD}`)
  }
})

// Serwer czeka na odpowiedz o paczce zasobow ("Tak, instaluj"). Mineflayer odpowiada od razu,
// wiec po chwili powtarzamy "zaladowana", jakby paczka sie pobrala.
bot._client.on('add_resource_pack', data => {
  console.log('[bot] Serwer wyslal paczke zasobow, akceptuje.')
  setTimeout(() => {
    try {
      bot._client.write('resource_pack_receive', { uuid: data.uuid, result: 3 })
      bot._client.write('resource_pack_receive', { uuid: data.uuid, result: 0 })
    } catch (e) { console.log('[bot] paczka:', e.message) }
  }, 2000)
})

let loggedIn = false
bot.once('login', () => {
  loggedIn = true
  console.log('[bot] Polaczono z serwerem, wersja', bot.version, '- czekam na wejscie do swiata...')
})

function sendChat(text) {
  if (!loggedIn) { console.log('[bot] Jeszcze nie polaczony z serwerem, poczekaj na komunikat "Polaczono z serwerem".'); return }
  queueChat(text)
}

bot.once('spawn', () => {
  mcData = require('minecraft-data')(bot.version)
  const moves = protectBuilds(new Movements(bot))
  moves.canDig = true
  moves.allow1by1towers = true
  bot.pathfinder.setMovements(moves)
  bot.pathfinder.thinkTimeout = 15000 // domyslne 5 s to za malo na drogi przez skale i jaskinie
  say('Gotowy. Napisz "start", "stop", "status" albo "tu".')
})

// polska nazwa -> bloki do wykopania i item, ktory wypada
const RESOURCES = {
  // liczy tez deski i inne drewno, jakie bot juz ma
  get drewno() { return [woodBlocks(), /_(log|stem|wood|hyphae|planks)$/] },
  kamien: [['stone', 'cobblestone'], /^cobblestone$/],
  wegiel: [['coal_ore', 'deepslate_coal_ore'], /^coal$/],
  zelazo: [['iron_ore', 'deepslate_iron_ore'], /^(raw_iron|iron_ingot)$/],
  zloto: [['gold_ore', 'deepslate_gold_ore'], /^(raw_gold|gold_ingot)$/],
  miedz: [['copper_ore', 'deepslate_copper_ore'], /^(raw_copper|copper_ingot)$/],
  diament: [['diamond_ore', 'deepslate_diamond_ore'], /^diamond$/],
  redstone: [['redstone_ore', 'deepslate_redstone_ore'], /^redstone$/],
  lapis: [['lapis_ore', 'deepslate_lapis_ore'], /^lapis_lazuli$/],
  szmaragd: [['emerald_ore', 'deepslate_emerald_ore'], /^emerald$/],
  piasek: [['sand'], /^sand$/],
  zwir: [['gravel'], /^gravel$/],
  ziemia: [['dirt', 'grass_block'], /^dirt$/],
  glina: [['clay'], /^clay_ball$/],
  obsydian: [['obsidian'], /^obsidian$/]
}

const stripPl = s => s.toLowerCase()
  .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
  .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z')

function resolveResource(word) {
  let w = stripPl(word)
  // proste odmiany: diamenty, zelaza, kamienia, ...
  const cands = [w, w.replace(/(y|i|a|u|e)$/, ''), w.replace(/(ty|ow|ami|a|y|u)$/, '')]
  for (const c of cands) {
    for (const key of Object.keys(RESOURCES)) {
      if (RESOURCES[key] && (key === c || key.startsWith(c) && c.length >= 4)) return RESOURCES[key]
    }
  }
  // nazwa angielska, np. "oak_log"
  const block = mcData.blocksByName[w]
  if (block) return [[w], new RegExp('^' + (mcData.itemsByName[w] ? w : block.drops?.length ? mcData.items[block.drops[0]]?.name : w) + '$')]
  return null
}

async function getResource(word, amount) {
  if (/^jedzen/.test(stripPl(word))) return foodCommand(amount)
  const res = !word.includes(' ') && resolveResource(word)
  if (!res) {
    // nie surowiec z ziemi - moze przedmiot, ktory da sie zrobic/upolowac/przepalic (np. "chleb", "pieczone mieso", "skora")
    const name = parseCraft(word).names[0] || (mcData.itemsByName[stripPl(word).replace(/\s+/g, '_')] && stripPl(word).replace(/\s+/g, '_'))
    if (!name || !obtainable(name)) { say(`Nie znam "${word}".`); return }
    return task(`zdobywam ${name}`, async () => {
      const target = count(name) + amount
      taskGoal = () => count(name) >= target
      const ok = await obtain(name, target)
      if (running) say(ok ? `Mam ${count(name)} x ${name}.` : `Nie udalo sie zdobyc ${name} (mam ${count(name)}).`)
    })
  }
  await task(`zdobywam ${word}`, async () => {
    say(`Zdobywam ${amount} x ${word}...`)
    const [blocks, re] = res
    taskGoal = () => countMatch(re) >= amount
    await collect(blocks, amount, re)
    const ok = countMatch(re) >= amount
    if (running) say(ok ? `Mam ${countMatch(re)} x ${word}.` : `Nie udalo sie zdobyc ${word} (mam ${countMatch(re)}).`)
  })
}

// polska nazwa -> regex na nazwy itemow w ekwipunku
const GIVE = {
  drewno: /_(log|stem|wood|hyphae|planks)$/, deski: /_planks$/, patyki: /^stick$/, kamien: /^cobblestone$/,
  wegiel: /^coal$/, zelazo: /^(raw_iron|iron_ingot)$/, zloto: /^(raw_gold|gold_ingot)$/,
  miedz: /^(raw_copper|copper_ingot)$/, diament: /^diamond$/, redstone: /^redstone$/,
  lapis: /^lapis_lazuli$/, szmaragd: /^emerald$/, piasek: /^sand$/, zwir: /^gravel$/,
  ziemia: /^dirt$/, jedzenie: new RegExp('^(' + FOOD.join('|') + ')$'),
  miecz: /_sword$/, kilof: /_pickaxe$/, siekiera: /_axe$/, zbroja: /_(helmet|chestplate|leggings|boots)$/,
  narzedzia: /_(sword|pickaxe|axe|shovel|hoe)$/, lopata: /_shovel$/, motyka: /_hoe$/, tarcza: /^shield$/, luk: /^bow$/, strzaly: /^arrow$/,
  jablko: /^(apple|golden_apple|enchanted_golden_apple)$/, chleb: /^bread$/, marchewka: /^carrot$/, ziemniak: /^(potato|baked_potato)$/,
  mieso: /^(beef|porkchop|mutton|chicken|rabbit|cooked_\w+)$/, kosc: /^bone$/, nici: /^string$/, skora: /^leather$/, pioro: /^feather$/,
  proch: /^gunpowder$/, perla: /^ender_pearl$/, szklo: /^glass$/, stol: /^crafting_table$/, piec: /^furnace$/, pochodnie: /^torch$/,
  skrzynia: /^chest$/, wiadro: /^\w*bucket$/, obsydian: /^obsidian$/, kloce: /_log$/
}

function resolveGive(word) {
  // "diamentowy kilof", "zelazna zbroja" itp. - te same polskie nazwy co w "scraftuj"
  const crafted = parseCraft(word).names
  if (crafted.length && crafted.every(n => /_planks$/.test(n))) return /_planks$/ // deski: dowolny rodzaj
  if (crafted.length) return new RegExp('^(' + crafted.join('|') + ')$')
  const w = stripPl(word).trim().replace(/\s+/g, '_')
  for (const c of [w, w.replace(/(y|i|a|u|e)$/, ''), w.replace(/(ty|ow|ami|a|y|u)$/, '')]) {
    for (const key of Object.keys(GIVE)) {
      if (key === c || (key.startsWith(c) && c.length >= 4)) return GIVE[key]
    }
  }
  return new RegExp('^' + w + '$')
}

async function giveItems(user, word, amount) {
  if (!user) { say('Z konsoli nie wiem, komu dac. Uzyj "wyrzuc <co>" albo wyslij "daj" z gry.'); return }
  const target = bot.players[user]?.entity
  if (!target) { say('Nie widze Cie, podejdz blizej.'); return }
  // "daj reka" = to, co trzyma w rece; "daj wszystko" = caly ekwipunek (bez zalozonej zbroi)
  const w = stripPl(word).trim()
  const hand = /^(reka|reke|rece|reki|w rece|z reki)$/.test(w)
  const all = /^(wszystko|wszystkie|cale eq|caly ekwipunek|eq)$/.test(w)
  const re = hand || all ? null : resolveGive(word)
  const items = hand ? (bot.heldItem ? [bot.heldItem] : [])
    : all ? bot.inventory.items()
      : bot.inventory.items().filter(i => re.test(i.name))
  if (!items.length) { say(hand ? 'Nic nie trzymam w rece.' : all ? 'Mam pusty ekwipunek.' : `Nie mam: ${word}.`); return }
  let left = amount ?? Infinity
  let given = 0
  try {
    await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2))
    await bot.lookAt(target.position.offset(0, target.height, 0))
    for (const it of items) {
      if (left <= 0) break
      const n = Math.min(it.count, left)
      await bot.toss(it.type, null, n)
      left -= n
      given += n
      await sleep(300)
    }
    say(`Dalem Ci ${given} x ${word}.`)
  } catch (e) {
    say('Blad: ' + e.message)
  }
}

// ---------- crafting: komenda "scraftuj" ----------
const MATERIALS = [['drewn', 'wooden'], ['kamie', 'stone'], ['zelaz', 'iron'], ['zlot', 'golden'], ['diame', 'diamond'], ['skorz', 'leather'], ['kolcz', 'chainmail'], ['nether', 'netherite']]
const ARMOR_PARTS = ['helmet', 'chestplate', 'leggings', 'boots']
const TOOL_PARTS = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']
const PIECE_WORDS = [['helm', 'helmet'], ['kask', 'helmet'], ['czapk', 'helmet'], ['napiers', 'chestplate'], ['klat', 'chestplate'], ['kurtk', 'chestplate'], ['spodni', 'leggings'], ['nogaw', 'leggings'],
  ['buty', 'boots'], ['trzewik', 'boots'], ['miecz', 'sword'], ['kilof', 'pickaxe'], ['siekier', 'axe'], ['lopat', 'shovel'], ['motyk', 'hoe']]
// polskie nazwy przedmiotow: poczatki kolejnych slow (bez polskich znakow) -> nazwa w grze.
// Kolejnosc ma znaczenie: dokladniejsze najpierw ("pieczony ziemniak" przed "piec", "stol do zaklinania" przed "stol").
const SPECIAL = [
  // jedzenie
  ['zlote jablk', 'golden_apple'], ['zlota marchew', 'golden_carrot'], ['pieczon ziemniak', 'baked_potato'],
  ['pieczon wolowin', 'cooked_beef'], ['stek', 'cooked_beef'], ['pieczon wieprzowin', 'cooked_porkchop'], ['pieczon schab', 'cooked_porkchop'],
  ['pieczon kurczak', 'cooked_chicken'], ['pieczon kur', 'cooked_chicken'], ['pieczon baranin', 'cooked_mutton'], ['pieczon krolik', 'cooked_rabbit'],
  ['pieczon dorsz', 'cooked_cod'], ['pieczon losos', 'cooked_salmon'], ['pieczon mies', 'cooked_beef'], ['pieczon', 'cooked_beef'],
  ['suszon wodorost', 'dried_kelp'], ['chleb', 'bread'], ['zupa grzyb', 'mushroom_stew'], ['zupa burak', 'beetroot_soup'],
  ['zupa krolik', 'rabbit_stew'], ['zupa', 'mushroom_stew'], ['gulasz', 'rabbit_stew'], ['ciastk', 'cookie'], ['ciasteczk', 'cookie'],
  ['ciasto dyni', 'pumpkin_pie'], ['placek dyni', 'pumpkin_pie'], ['ciasto', 'cake'], ['tort', 'cake'],
  // stoly i bloki uzytkowe
  ['stol do zaklin', 'enchanting_table'], ['stol karto', 'cartography_table'], ['stol kowal', 'smithing_table'], ['stol', 'crafting_table'],
  ['piec wedz', 'smoker'], ['wedzarni', 'smoker'], ['piec hut', 'blast_furnace'], ['piec', 'furnace'],
  ['skrzyn', 'chest'], ['beczk', 'barrel'], ['kowadl', 'anvil'], ['kamien szlif', 'grindstone'], ['lozk', 'white_bed'],
  ['ognisk', 'campfire'], ['latarni', 'lantern'], ['lejek', 'hopper'], ['dozownik', 'dispenser'], ['podajnik', 'dropper'], ['polk', 'bookshelf'],
  ['regal', 'bookshelf'], ['tnt', 'tnt'], ['dynamit', 'tnt'],
  // budowanie
  ['zelazn drzwi', 'iron_door'], ['drzwi', 'oak_door'], ['klap', 'oak_trapdoor'], ['furtk', 'oak_fence_gate'], ['plot', 'oak_fence'],
  ['drabin', 'ladder'], ['schod', 'oak_stairs'], ['plyt nacisk', 'oak_pressure_plate'], ['plyt', 'oak_slab'], ['cegl kamien', 'stone_bricks'], ['kamienn cegl', 'stone_bricks'],
  ['cegl', 'bricks'], ['szklo', 'glass'], ['szyb', 'glass_pane'], ['tabliczk', 'oak_sign'], ['znak', 'oak_sign'],
  ['krat', 'iron_bars'], ['pochodnia redstone', 'redstone_torch'], ['pochodn', 'torch'], ['wegiel drzewny', 'charcoal'], ['gladki kamien', 'smooth_stone'],
  // narzedzia i rzeczy
  ['patyk', 'stick'], ['kij', 'stick'], ['tarcz', 'shield'], ['wiadr', 'bucket'], ['luk', 'bow'], ['kusz', 'crossbow'], ['strzal', 'arrow'],
  ['nozyce', 'shears'], ['krzesiw', 'flint_and_steel'], ['wedk', 'fishing_rod'], ['kompas', 'compass'], ['zegar', 'clock'], ['map', 'map'],
  ['miska', 'bowl'], ['misk', 'bowl'], ['butelk', 'glass_bottle'], ['lodk', 'oak_boat'], ['lodz', 'oak_boat'], ['wozek', 'minecart'],
  ['tory', 'rail'], ['szyn', 'rail'], ['ksiazk', 'book'], ['papier', 'paper'], ['cukier', 'sugar'], ['dzwigni', 'lever'],
  ['przycisk', 'oak_button'], ['smycz', 'lead'],
  ['siano', 'hay_block'], ['bele siana', 'hay_block'], ['wlok', 'string']
]

// czy kolejne slowa tekstu zaczynaja sie od kolejnych slow frazy ("pieczon ziemniak" pasuje do "pieczony ziemniak")
function phraseMatches(words, phrase) {
  const pw = phrase.split(' ')
  for (let i = 0; i + pw.length <= words.length; i++) {
    if (pw.every((p, j) => words[i + j].startsWith(p))) return true
  }
  return false
}
const EQUIP_SLOT = { helmet: ['head', 5], chestplate: ['torso', 6], leggings: ['legs', 7], boots: ['feet', 8] }

// z tekstu "diamentowy set 1" robi liste nazw itemow
function parseCraft(text) {
  const words = stripPl(text).split(/\s+/).filter(Boolean)
  const amount = parseInt(words.find(w => /^\d+$/.test(w)) || '1')
  const names = []
  // angielska nazwa podana wprost ("iron_pickaxe" albo "iron pickaxe"), ale nie pojedyncze slowo z dluzszej nazwy
  const direct = words.filter(w => !/^\d+$/.test(w)).join('_')
  if (mcData.itemsByName[direct]) return { names: [direct], amount }
  const mat = MATERIALS.find(([p]) => words.some(w => w.startsWith(p)))?.[1]
  const has = p => words.some(w => w.startsWith(p))
  if (mat) {
    if (has('set') || has('komplet')) names.push(...ARMOR_PARTS.map(p => `${mat}_${p}`), ...TOOL_PARTS.map(p => `${mat}_${p}`))
    else if (has('zbroj')) names.push(...ARMOR_PARTS.map(p => `${mat}_${p}`))
    else if (has('narzedz')) names.push(...TOOL_PARTS.map(p => `${mat}_${p}`))
    for (const [w, part] of PIECE_WORDS) if (has(w)) names.push(`${mat}_${part}`)
  }
  // nie zbroja/narzedzie (albo slowo materialu w innej nazwie, np. "zlote jablko", "kamienne cegly"): szukamy w nazwach przedmiotow
  if (!names.length) {
    const hit = SPECIAL.find(([p]) => phraseMatches(words, p))
    if (hit) names.push(hit[1])
    else if (has('desk')) names.push((logName() || 'oak_log').replace(WOOD_RE, '_planks'))
  }
  return { names: [...new Set(names)].filter(n => mcData.itemsByName[n]), amount }
}

// czego brakuje do pierwszego przepisu (np. "3 x diamond")
function missingFor(itemName) {
  const recipes = mcData.recipes[mcData.itemsByName[itemName]?.id]
  if (!recipes?.length) return `${itemName} (nie da sie go scraftowac)`
  const out = []
  for (const [nm, n] of Object.entries(recipeIngredients(chooseRecipe(recipes)))) {
    const planks = /_planks$/.test(nm) // deski: dowolne drewno
    const lack = n - (planks ? countMatch(/_planks$/) : count(nm))
    if (lack > 0) out.push(`${lack} x ${planks ? 'deski' : nm}`)
  }
  return out.join(', ') || 'niczego (crafting sie nie udal - sprobuj jeszcze raz)'
}

// robi przedmiot, a w razie potrzeby najpierw patyki (narzedzia); false gdy brakuje materialow
async function craftItem(name, amount = 1) {
  const item = mcData.itemsByName[name]
  if (!item) return false
  if (TOOL_PARTS.some(p => name.endsWith('_' + p)) && count('stick') < 2) {
    // na patyki trzeba desek; jak nie ma ani desek, ani drewna - scinamy jeden pien
    if (countMatch(/_planks$/) < 2 && !logName() && running) await collect(woodBlocks(), 1, WOOD_RE)
    try { await ensurePlanks(2); await craft('stick', 4, null) } catch {}
  }
  try { return await craftWithTable(item, amount) } catch (e) { console.log('craft blad:', e.message); return false }
}

async function craftWithTable(item, amount) {
  // szybkie sprawdzenie: czy w ogole mamy skladniki (true = udajemy, ze stol jest)
  if (!bot.recipesFor(item.id, null, 1, true).length) return false
  let recipe = bot.recipesFor(item.id, null, 1, null)[0]
  let table = null
  if (!recipe) {
    if (!bot.findBlock({ matching: mcData.blocksByName.crafting_table.id, maxDistance: 32 }) && !has('crafting_table')) await ensurePlanks(4)
    try { table = await getTable() } catch (e) { say(`Nie mam stolu do ${item.name}: ${e.message}`); return false }
    recipe = bot.recipesFor(item.id, null, 1, table)[0]
  }
  if (!recipe) return false
  const before = count(item.name)
  const times = Math.ceil(amount / recipe.result.count)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await craftSafe(recipe, times, table, item.name)
      return true
    } catch {
      if (count(item.name) > before) return true // przedmiot powstal mimo bledu
      if (table) { try { await goNear(table.position, 1) } catch {} } // blizej stolu i jeszcze raz
      await sleep(500)
    }
  }
  return false
}

// ---------- tryb kreatywny: przedmioty bierzemy z ekwipunku kreatywnego zamiast je zdobywac ----------
const isCreative = () => bot.game?.gameMode === 'creative'

// wkłada do ekwipunku `amount` sztuk przedmiotu (pelne stacki), jak gracz biorący bloki z menu kreatywnego
async function creativeGive(name, amount) {
  const item = mcData.itemsByName[name]
  if (!item) return false
  const Item = require('prismarine-item')(bot.registry)
  let left = Math.max(0, amount - count(name))
  while (left > 0) {
    // wolny slot: najpierw pasek szybkiego wyboru (36-44), potem reszta ekwipunku (9-35)
    const slot = [...Array(9).keys()].map(i => 36 + i).concat([...Array(27).keys()].map(i => 9 + i)).find(s => !bot.inventory.slots[s])
    if (slot === undefined) {
      if (Date.now() - (creativeGive.warned || 0) > 120000) { creativeGive.warned = Date.now(); say('Mam pelny ekwipunek - nie zmieszcze wiecej.') }
      return count(name) >= amount
    }
    const n = Math.min(left, item.stackSize || 64)
    await bot.creative.setInventorySlot(slot, new Item(item.id, n))
    left -= n
  }
  return true
}

// lot w kreatywnym: w gore, poziomo i w dol. flyTo leci prosto (przez bloki), wiec lecimy na wysokosci,
// ktora przy budowie od dolu jest jeszcze pusta (nad biezaca warstwa)
// Lot w kreatywnym idzie po prostej i nie omija blokow - przez sciane czy dach bot by sie w nie wbil.
// Dlatego lecimy tylko, gdy cala trasa (nogi i glowa, z zapasem na szerokosc ciala) jest wolna; inaczej false.
function segmentClear(a, b) {
  const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.3))
  for (let i = 0; i <= steps; i++) {
    const p = a.plus(b.minus(a).scaled(i / steps))
    for (const dy of [0.1, 1.1, 1.7]) {
      for (const [dx, dz] of [[0, 0], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) {
        if (bot.blockAt(p.offset(dx, dy, dz))?.boundingBox === 'block') return false
      }
    }
  }
  return true
}
async function creativeFlyTo(target) {
  const dest = new Vec3(target.x + 0.5, target.y, target.z + 0.5)
  const here = bot.entity.position.clone()
  // w gore, w poprzek, w dol; gdy po drodze cos stoi (mury, wieze) - probujemy przeleciec wyzej
  for (const extra of [1, 4, 8, 14, 22]) {
    const top = Math.max(here.y, dest.y) + extra
    const route = [here, new Vec3(here.x, top, here.z), new Vec3(dest.x, top, dest.z), dest]
    let clear = true
    for (let i = 0; i < route.length - 1 && clear; i++) clear = segmentClear(route[i], route[i + 1])
    if (!clear) continue
    for (const p of route.slice(1)) if (!await flyStraight(p)) return false
    return true
  }
  return false
}

// Lot po prostej jak bot.creative.flyTo, ale z limitem: flyTo z mineflayera leci, az dotrze - gdy serwer cofa bota
// (cos zaslania, "moved wrongly"), wisi w powietrzu w nieskonczonosc. Tu: brak postepu przez 1.5 s albo za dlugo - false.
async function flyStraight(dest) {
  bot.creative.startFlying()
  const step = 0.5
  const limit = Date.now() + 4000 + bot.entity.position.distanceTo(dest) * 150
  let best = Infinity
  let bestAt = Date.now()
  for (;;) {
    const v = dest.minus(bot.entity.position)
    const d = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
    if (d <= step) break
    if (d < best - 0.1) { best = d; bestAt = Date.now() }
    if (Date.now() - bestAt > 1500 || Date.now() > limit || !bot.entity) { console.log('[bot] lot: nie moge doleciec - probuje inaczej'); return false }
    bot.physics.gravity = 0
    bot.entity.velocity = new Vec3(0, 0, 0)
    bot.entity.position.add(v.scaled(step / d))
    await sleep(50)
  }
  bot.entity.position = dest.clone()
  await new Promise(res => { const t = setTimeout(res, 1000); bot.once('move', () => { clearTimeout(t); res() }) })
  return true
}

// obietnica z limitem czasu - zeby bot nie stal i nie "myslal" w nieskonczonosc (np. droga, ktorej nie ma)
function withTimeout(promise, ms, what, onTimeout) {
  let timer
  return Promise.race([promise, new Promise((resolve, reject) => {
    timer = setTimeout(() => { try { onTimeout?.() } catch {} reject(new Error(`${what}: brak postepu od ${Math.round(ms / 1000)} s`)) }, ms)
  })]).finally(() => clearTimeout(timer))
}
// pathfinder.goto z limitem: po czasie zatrzymujemy go (zawracanie na drabinie, krazenie wokol celu)
function gotoSafe(goal, ms = 25000) {
  return withTimeout(bot.pathfinder.goto(goal), ms, 'droga', () => { bot.pathfinder.setGoal(null); bot.clearControlStates() })
}

// nazwa przedmiotu pasujacego do wzorca (np. /_(log|stem)$/ -> oak_log)
const creativeItemFor = re => mcData.itemsArray.find(i => re.test(i.name))?.name

// ---------- zdobywanie skladnikow: "mam miec N sztuk X" ----------
// skad brac surowce, ktorych nie da sie scraftowac
const GATHER = {
  cobblestone: [['stone', 'cobblestone'], /^cobblestone$/],
  raw_iron: [['iron_ore', 'deepslate_iron_ore'], /^raw_iron$/],
  raw_gold: [['gold_ore', 'deepslate_gold_ore'], /^raw_gold$/],
  raw_copper: [['copper_ore', 'deepslate_copper_ore'], /^raw_copper$/],
  coal: [['coal_ore', 'deepslate_coal_ore'], /^coal$/],
  diamond: [['diamond_ore', 'deepslate_diamond_ore'], /^diamond$/],
  redstone: [['redstone_ore', 'deepslate_redstone_ore'], /^redstone$/],
  lapis_lazuli: [['lapis_ore', 'deepslate_lapis_ore'], /^lapis_lazuli$/],
  emerald: [['emerald_ore', 'deepslate_emerald_ore'], /^emerald$/],
  sand: [['sand'], /^sand$/],
  gravel: [['gravel'], /^gravel$/],
  dirt: [['dirt', 'grass_block'], /^dirt$/],
  clay_ball: [['clay'], /^clay_ball$/],
  obsidian: [['obsidian'], /^obsidian$/],
  // rosliny i jedzenie z pola (uprawy tylko dojrzale)
  wheat: [['wheat'], /^wheat$/],
  carrot: [['carrots'], /^carrot$/],
  potato: [['potatoes'], /^potato$/],
  beetroot: [['beetroots'], /^beetroot$/],
  red_mushroom: [['red_mushroom'], /^red_mushroom$/],
  brown_mushroom: [['brown_mushroom'], /^brown_mushroom$/],
  sugar_cane: [['sugar_cane'], /^sugar_cane$/],
  pumpkin: [['pumpkin'], /^pumpkin$/],
  melon_slice: [['melon'], /^melon_slice$/],
  cactus: [['cactus'], /^cactus$/],
  bamboo: [['bamboo'], /^bamboo$/],
  kelp: [['kelp', 'kelp_plant'], /^kelp$/],
  cocoa_beans: [['cocoa'], /^cocoa_beans$/],
  glowstone_dust: [['glowstone'], /^glowstone_dust$/],
  quartz: [['nether_quartz_ore'], /^quartz$/],
  poppy: [['poppy'], /^poppy$/]
}
// co powstaje w piecu z czego
const SMELT_FROM = {
  iron_ingot: 'raw_iron', gold_ingot: 'raw_gold', copper_ingot: 'raw_copper', glass: 'sand', stone: 'cobblestone',
  cooked_beef: 'beef', cooked_porkchop: 'porkchop', cooked_mutton: 'mutton', cooked_chicken: 'chicken', baked_potato: 'potato',
  cooked_rabbit: 'rabbit', cooked_cod: 'cod', cooked_salmon: 'salmon', dried_kelp: 'kelp', charcoal: 'oak_log', smooth_stone: 'stone'
}
// co wypada ze zwierzat
const HUNT_FOR = { leather: 'cow', beef: 'cow', porkchop: 'pig', mutton: 'sheep', white_wool: 'sheep', feather: 'chicken', chicken: 'chicken', rabbit: 'rabbit', rabbit_hide: 'rabbit' }

function recipeIngredients(recipe) {
  const need = {}
  const add = x => {
    const id = x?.id ?? x
    if (id === null || id === undefined || id < 0) return
    const name = mcData.items[id]?.name
    if (name) need[name] = (need[name] || 0) + (x?.count ?? 1)
  }
  if (recipe.inShape) recipe.inShape.flat().forEach(add)
  else (recipe.ingredients || []).forEach(add)
  return need
}

// czy w ogole wiemy, skad wziac ten przedmiot
function obtainable(name) {
  return /_planks$/.test(name) || WOOD_RE.test(name) || GATHER[name] || SMELT_FROM[name] || HUNT_FOR[name] ||
    !!mcData.recipes[mcData.itemsByName[name]?.id]?.length
}

// z kilku przepisow (np. kilof z bruku / czarnego kamienia / glebinowego bruku) wybiera ten, do ktorego najmniej brakuje
function chooseRecipe(recipes) {
  let best = null
  let bestScore = Infinity
  for (const r of recipes) {
    let score = 0
    for (const [n, c] of Object.entries(recipeIngredients(r))) {
      const have = /_planks$/.test(n) ? countMatch(/_planks$/) : count(n)
      score += Math.max(0, c - have) + (obtainable(n) ? 0 : 100)
    }
    if (score < bestScore) { bestScore = score; best = r }
  }
  return best
}

// sprawia, ze w ekwipunku jest co najmniej `need` sztuk `name`: zbiera, przepala, poluje albo craftuje (rekurencyjnie skladniki)
async function obtain(name, need, depth = 0) {
  if (!running) return false
  if (count(name) >= need) return true
  if (isCreative()) return await creativeGive(name, need)
  if (depth > 6) return false
  const missing = need - count(name)
  setStatus(`zdobywam ${name} (mam ${count(name)}/${need})`)

  if (/_planks$/.test(name)) { // deski: dowolny rodzaj drewna
    await ensureWood(need)
    await ensurePlanks(need)
    return countMatch(/_planks$/) >= need
  }
  if (WOOD_RE.test(name)) return await collect(woodBlocks(), countMatch(WOOD_RE) + missing, WOOD_RE)
  if (GATHER[name]) {
    const [blocks, re] = GATHER[name]
    say(`Brakuje mi ${missing} x ${name} - ide zdobyc.`)
    return await collect(blocks, need, re)
  }
  if (SMELT_FROM[name]) {
    const src = SMELT_FROM[name]
    if (!await obtain(src, missing, depth + 1)) return false
    await smeltAll(WOOD_RE.test(src) ? WOOD_RE : new RegExp(`^${src}$`))
    return count(name) >= need
  }
  if (HUNT_FOR[name]) {
    const kind = HUNT_FOR[name]
    say(`Brakuje mi ${missing} x ${name} - poluje (${kind}).`)
    for (let tries = 0; tries < 12 && running && count(name) < need; tries++) {
      const animal = bot.nearestEntity(e => e.name === kind && e.position.distanceTo(bot.entity.position) < 48)
      if (!animal) { await explore(); continue }
      await killAnimal(animal)
      await pickUpItems(8)
    }
    return count(name) >= need
  }

  const recipes = mcData.recipes[mcData.itemsByName[name]?.id]
  if (!recipes?.length) { say(`Nie wiem, skad wziac ${name}.`); return false }
  const recipe = chooseRecipe(recipes)
  const times = Math.ceil(missing / (recipe.result?.count || 1))
  // deski na koncu: patyki i inne skladniki tez sie z nich robi, wiec zebrane wczesniej zostalyby zuzyte
  const ingredients = Object.entries(recipeIngredients(recipe)).sort(([a], [b]) => /_planks$/.test(a) - /_planks$/.test(b))
  for (const [ing, per] of ingredients) {
    const want = per * times
    const ok = /_planks$/.test(ing) ? await obtain('oak_planks', want, depth + 1) : await obtain(ing, want, depth + 1)
    if (!ok) {
      const have = /_planks$/.test(ing) ? countMatch(/_planks$/) : count(ing)
      if (running) say(`Do ${name} brakuje mi: ${want - have} x ${ing}.`)
      return false
    }
  }
  // przepisy 3x3 wymagaja stolu - bez niego i bez desek na niego crafting sie nie uda
  const needsTable = recipe.inShape && (recipe.inShape.length > 2 || recipe.inShape.some(row => row.length > 2))
  if (needsTable && !has('crafting_table') && !bot.findBlock({ matching: mcData.blocksByName.crafting_table.id, maxDistance: 32 })) {
    await obtain('oak_planks', countMatch(/_planks$/) + 4, depth + 1)
  }
  await craftItem(name, missing)
  return count(name) >= need
}

async function equipArmor(itemName) {
  const part = ARMOR_PARTS.find(p => itemName.endsWith('_' + p))
  if (!part) return
  const [dest, slot] = EQUIP_SLOT[part]
  const cur = bot.inventory.slots[slot]
  const w = n => ARMOR_W[n.split('_')[0]] || 0
  if (cur && w(cur.name) >= w(itemName)) return
  const it = bot.inventory.items().find(i => i.name === itemName)
  if (it) { try { await bot.equip(it, dest) } catch {} }
}

async function craftCommand(text) {
  const { names, amount } = parseCraft(text)
  if (!names.length) { say('Co mam scraftowac? np. "scraftuj diamentowy set", "scraftuj zelazna zbroje", "scraftuj kamienny kilof", "scraftuj stol".'); return }
  const done = []
  const missing = []
  await task('crafting', async () => {
    for (const name of names) {
      if (!running) break
      const isGear = ARMOR_PARTS.some(p => name.endsWith('_' + p)) || TOOL_PARTS.some(p => name.endsWith('_' + p))
      if (isGear && has(name)) { await equipArmor(name); continue }
      // brakujace skladniki zdobywa sam: craftuje posrednie (deski, patyki), wydobywa, przepala, poluje
      const ok = await obtain(name, count(name) + (isGear ? 1 : amount))
      if (ok) { done.push(name); await equipArmor(name) } else missing.push(`${missingFor(name)} (do ${name})`)
    }
    if (done.length) say('Scraftowalem: ' + done.join(', '))
    if (missing.length) say('Brakuje mi: ' + missing.join('; ') + '.')
    if (!done.length && !missing.length) say('Wszystko juz mam.')
  })
}

// komenda "zabij <gracz>": idzie do gracza, a gdy go nie widzi, prosi o /tpa
const findPlayerName = name => Object.keys(bot.players).find(n => n.toLowerCase() === name.toLowerCase())

// sprawia, ze gracz jest w zasiegu wzroku: od razu, albo po /tpa (czeka do 30 s na akceptacje)
async function reachPlayer(username) {
  const getEnt = () => bot.players[username]?.entity
  if (getEnt()) return true
  const start = bot.entity.position.clone()
  say(`Nie widze ${username}, wysylam /tpa.`)
  sendChat(`/tpa ${username}`)
  for (let t = 0; t < 60 && running; t++) {
    await sleep(500)
    if (getEnt() || bot.entity.position.distanceTo(start) > 8) {
      await sleep(1500) // chunki po teleporcie
      return true
    }
  }
  if (running) say(`Nie moge go znalezc (${username} nie przyjal tpa).`)
  return false
}

async function killPlayer(name) {
  const username = findPlayerName(name)
  if (!username) { say(`Nie ma gracza ${name} online.`); return }
  if (username === bot.username) { say('Siebie nie zaatakuje.'); return }
  await task(`walka z ${username}`, () => fightPlayer(username))
}

async function fightPlayer(username) {
  const getEnt = () => bot.players[username]?.entity
  let killed = false
  const onDead = e => { if (e === getEnt()) killed = true }
  bot.on('entityDead', onDead)
  try {
    if (!await reachPlayer(username)) return
    say(`Atakuje ${username}.`)
    const until = Date.now() + 3 * 60 * 1000
    while (running && !killed && Date.now() < until) {
      const ent = getEnt()
      if (!ent) { await sleep(1000); if (!getEnt()) { say(`Zgubilem ${username}.`); break } continue }
      if (bot.pvp.target !== ent) { await bestSword(); bot.pvp.attack(ent) }
      await sleep(500)
    }
    if (killed) say(`${username} pokonany.`)
  } finally {
    bot.removeListener('entityDead', onDead)
    bot.pvp.stop()
  }
}

// komenda "idz <ile> <kierunek>": przod/tyl/lewo/prawo wzgledem tego, gdzie bot patrzy, albo polnoc/poludnie/wschod/zachod
const DIRECTIONS = [
  [/^(przod|naprzod|prosto)/, 'front'], [/^(tyl|wstecz)/, 'back'], [/^lew/, 'left'], [/^praw/, 'right'],
  [/^polnoc/, 'N'], [/^poludnie/, 'S'], [/^wschod/, 'E'], [/^zachod/, 'W']
]
async function walkCommand(text) {
  const words = stripPl(text).split(/\s+/).filter(Boolean)
  const dist = parseInt(words.find(w => /^\d+$/.test(w)) || '5')
  const dir = DIRECTIONS.find(([re]) => words.some(w => re.test(w)))?.[1]
  if (!dir) { say('Uzycie: idz <ile> przod|tyl|lewo|prawo|polnoc|poludnie|wschod|zachod'); return }
  if (running) { say('Jestem zajety, napisz "stop".'); return }
  const yaw = bot.entity.yaw
  const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) } // przod; prawo to (cos, -sin)
  const v = {
    front: f, back: { x: -f.x, z: -f.z }, right: { x: Math.cos(yaw), z: -Math.sin(yaw) }, left: { x: -Math.cos(yaw), z: Math.sin(yaw) },
    N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 }
  }[dir]
  const p = bot.entity.position
  await goWithReport(new goals.GoalNearXZ(Math.round(p.x + v.x * dist), Math.round(p.z + v.z * dist), 1))
}

// idzie do celu i mowi, co z tego wyszlo (czy sie ruszyl, czy serwer go cofal)
function goWithReport(goal, label = 'marsz') {
  if (goal.isEnd(bot.entity.position.floored())) { say('Jestem juz na miejscu.'); return }
  return task(label, () => walkTo(goal))
}

// idzie do celu (w ramach biezacego zadania) i mowi, co z tego wyszlo
async function walkTo(goal) {
  const p = bot.entity.position.clone()
  setStatus('ide do celu')
  console.log(`[bot] marsz: z (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}), tryb: ${bot.game?.gameMode}, ${physicsReport()}`)
  let forced = 0
  const onForced = () => { forced++ }
  const onPath = r => console.log('[bot] sciezka:', r.status, `(${r.path.length} krokow)`)
  bot.on('forcedMove', onForced)
  bot.on('path_update', onPath)
  try {
    await bot.pathfinder.goto(goal)
    const moved = Math.hypot(bot.entity.position.x - p.x, bot.entity.position.z - p.z)
    if (moved < 1) say(`Nie ruszylem sie z miejsca${forced ? ` - serwer cofnal mnie ${forced} razy` : ''}.`)
    else say(`Doszedlem (przeszedlem ${Math.round(moved)} blokow).`)
    return moved >= 1
  } catch (e) {
    if (running) say('Nie moge tam dojsc: ' + e.message)
    return false
  } finally {
    bot.removeListener('forcedMove', onForced)
    bot.removeListener('path_update', onPath)
  }
}

// komenda "przepal": przepala rudy i surowe jedzenie z ekwipunku
function smeltCommand() {
  return task('przepalanie', async () => {
    const n = await smeltAll()
    say(n ? `Przepalilem ${n} rzeczy.` : 'Nie mam nic do przepalenia.')
  })
}

// komenda "eq": mowi wszystko, co ma (ekwipunek + zalozone rzeczy)
async function showInventory() {
  const total = {}
  for (const it of bot.inventory.items()) total[it.name] = (total[it.name] || 0) + it.count
  const worn = [5, 6, 7, 8, 45].map(s => bot.inventory.slots[s]).filter(Boolean).map(i => i.name)
  const hand = bot.heldItem?.name
  const lines = []
  if (worn.length) lines.push('Zalozone: ' + worn.join(', '))
  if (hand) lines.push('W rece: ' + hand)
  const list = Object.entries(total).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} x${c}`)
  lines.push(list.length ? 'Ekwipunek:' : 'Ekwipunek pusty.')
  // czat ma limit ~256 znakow, wiec dzielimy na kawalki
  let chunk = ''
  for (const e of list) {
    if ((chunk + e).length > 200) { lines.push(chunk.trim()); chunk = '' }
    chunk += e + ', '
  }
  if (chunk) lines.push(chunk.replace(/, $/, ''))
  lines.push(`HP ${Math.round(bot.health)}/20, glod ${Math.round(bot.food)}/20`)
  for (const l of lines) { say(l); await sleep(700) }
}

// komenda "jedz": zjada najlepsze jedzenie z ekwipunku
async function eatNow() {
  if (bot.food >= 20) { say('Jestem najedzony.'); return }
  const food = pickFood(bot.health < 14)
  if (!food) { say('Nie mam jedzenia w ekwipunku.'); return }
  try {
    await eatItem(food)
    say(`Zjadlem ${food.name}. Glod: ${Math.round(bot.food)}/20.`)
  } catch (e) {
    say('Nie moge zjesc: ' + e.message)
  }
}

// ---------- budowanie: plany budowli ----------
// Plan to lista komorek {x, y, z, block} we wspolrzednych lokalnych: x w prawo, z do przodu, y w gore,
// liczonych od punktu przed botem. block === 'air' oznacza "ma byc pusto" (wnetrze, przejscie).
// Deski i pnie moga byc dowolnego gatunku drewna.

function invItemFor(name) {
  const items = bot.inventory.items()
  if (/_planks$/.test(name)) return items.find(i => /_planks$/.test(i.name))
  if (WOOD_RE.test(name)) return items.find(i => WOOD_RE.test(i.name))
  return items.find(i => i.name === name)
}

function sameKind(blockName, want) {
  if (/_planks$/.test(want)) return /_planks$/.test(blockName)
  if (WOOD_RE.test(want)) return WOOD_RE.test(blockName)
  return blockName === want
}

function haveOf(name) {
  if (/_planks$/.test(name)) return countMatch(/_planks$/)
  if (WOOD_RE.test(name)) return countMatch(WOOD_RE)
  return count(name)
}

// wspolrzedne lokalne -> swiat
function toWorld(origin, front, x, y, z) {
  const right = turnRight(front)
  return origin.offset(right.x * x + front.x * z, y, right.z * x + front.z * z)
}

const isSolid = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'block' }
const hasSupport = p => [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([dx, dy, dz]) => isSolid(p.offset(dx, dy, dz)))

// kierunek lokalny planu ({x: w prawo, z: do przodu}) -> kierunek w swiecie
function worldDir(front, d) {
  const right = turnRight(front)
  return { x: right.x * (d.x || 0) + front.x * (d.z || 0), y: d.y || 0, z: right.z * (d.x || 0) + front.z * (d.z || 0) }
}

// staje w zasiegu reki, ale nie w miejscu, gdzie ma stanac blok.
// facing (schody): stajemy 2 bloki za miejscem i patrzymy w tym kierunku - schody obracaja sie tak, jak patrzy stawiajacy
async function goNearCell(pos, facing) {
  if (isCreative()) {
    // w zasiegu reki nie latamy (z jednego miejsca stawiamy wiele blokow); inaczej nad cel - budujemy od dolu,
    // wiec nad biezaca warstwa jest pusto. Schody - z miejsca za nimi.
    const here = bot.entity.position
    const inBody = here.floored().equals(pos) || here.floored().offset(0, 1, 0).equals(pos)
    if (!facing && !inBody && here.distanceTo(pos.offset(0.5, 0.5, 0.5)) <= 4.2) return
    const free = p => bot.blockAt(p)?.boundingBox !== 'block'
    const freeStand = p => free(p) && free(p.offset(0, 1, 0)) && !p.equals(pos) && !p.offset(0, 1, 0).equals(pos)
    // gdzie stanac: nad blokiem, a jak tam zajete (strop, dach) - obok albo po skosie, ale w zasiegu reki
    const spots = facing
      ? [pos.offset(-facing.x, 0, -facing.z)]
      : [pos.offset(0, 2, 0), ...[[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, 1], [1, -1], [-1, -1]]
          .flatMap(([dx, dz]) => [pos.offset(dx, 0, dz), pos.offset(dx, 1, dz), pos.offset(dx, -1, dz)])]
    for (const stand of spots.filter(freeStand)) {
      if (here.distanceTo(stand.offset(0.5, 0, 0.5)) <= 1) return
      if (await creativeFlyTo(stand)) return
    }
    // zadne miejsce nie jest osiagalne lotem po prostej (np. zamkniety pokoj): ladujemy i idziemy jak w survivalu
    bot.creative.stopFlying()
  }
  if (facing) {
    // stoimy na poprzednim stopniu (albo na ziemi przed pierwszym) - tak schody obracaja sie w strone marszu
    const stand = pos.offset(-facing.x, 0, -facing.z)
    await gotoSafe(new goals.GoalNear(stand.x, stand.y, stand.z, 0.6))
    return
  }
  const dist = bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5))
  const inside = bot.entity.position.floored().equals(pos) || bot.entity.position.floored().offset(0, 1, 0).equals(pos)
  if (dist < 4 && !inside) return
  // limit czasu: bez niego bot potrafil cala noc wchodzic i schodzic po drabinie albo stac i liczyc droge, ktorej nie ma
  await gotoSafe(new goals.GoalCompositeAll([
    new goals.GoalNear(pos.x, pos.y, pos.z, 3),
    new goals.GoalInvert(new goals.GoalNear(pos.x, pos.y, pos.z, 1))
  ]), bot.pathfinder.movements?.canDig ? 45000 : 25000)
}

// czym podsypac dziure pod fundamentem
const SCAFFOLD = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'stone', 'andesite', 'diorite', 'granite']
async function fillBelow(pos) {
  let depth = 1
  while (depth <= 5 && !isSolid(pos.offset(0, -depth, 0))) depth++
  if (depth > 5) return
  for (let k = depth - 1; k >= 1; k--) {
    const it = bot.inventory.items().find(i => SCAFFOLD.includes(i.name))
    if (!it) return
    try { await goNearCell(pos.offset(0, -k, 0)); await placeBlockAt(it.name, pos.offset(0, -k, 0)) } catch {}
  }
}

// zdobywa materialy: najpierw rzeczy craftowane (drzwi, skrzynia - zjadaja deski), potem deski, na koncu pnie
async function gatherMaterials(cells, label) {
  const need = {}
  for (const c of cells) if (c.block !== 'air') need[c.block] = (need[c.block] || 0) + 1
  const rank = n => WOOD_RE.test(n) ? 2 : /_planks$/.test(n) ? 1 : 0
  const names = Object.keys(need).sort((a, b) => rank(a) - rank(b))
  // "Brakuje mi: 80 x oak_planks, 10 x oak_log" - tylko to, czego nie ma w ekwipunku
  const missingText = () => names.filter(n => haveOf(n) < need[n]).map(n => `${need[n] - haveOf(n)} x ${n}`).join(', ')
  const missing = missingText()
  if (!missing) { say(`Mam wszystko na ${label}.`); return true }
  say(`Na ${label} brakuje mi: ${missing}. Ide to zdobyc.`)
  for (const name of names) {
    if (!running) return false
    if (haveOf(name) >= need[name]) continue
    setStatus(`zbieram material na ${label}: ${name} (mam ${haveOf(name)}/${need[name]})`)
    await askTeamFor(name, need[name] - haveOf(name)) // moze kolega ma - przyniesie
    if (haveOf(name) >= need[name]) continue
    const ok = WOOD_RE.test(name) ? await collect(woodBlocks(), need[name], WOOD_RE) : await obtain(name, need[name])
    if (!ok && running) { say(`Nie dam rady zbudowac ${label}. Brakuje mi: ${missingText()}. Daj mi to i napisz "kontynuuj".`); return false }
  }
  return running
}

// ---------- szacowany czas budowy ("czas") ----------
// tempo liczone z tego, ile blokow naprawde przybylo od poczatku stawiania (razem z przerwami na zbieranie materialu);
// na samym poczatku - typowe tempo (kreatywny szybciej)
let currentBuild = null
function buildEta() {
  const b = currentBuild
  if (!b) return null
  const done = b.placed
  if (done !== b.lastDone) { b.lastDone = done; b.lastChangeAt = Date.now() }
  const left = Math.max(0, b.total - done)
  const secs = (Date.now() - b.startedAt) / 1000
  const made = done - (b.basePlaced || 0)
  const measured = b.phase === 'budowa' && made >= 15 && secs >= 20
  const rate = measured ? made / secs : (isCreative() ? 2.5 : 0.7) // bloki na sekunde
  return { done, total: b.total, left, pct: Math.min(100, Math.round(done * 100 / Math.max(1, b.total))), etaSec: left / Math.max(rate, 0.01), measured, rate }
}
function fmtDuration(sec) {
  if (sec < 90) return `${Math.max(1, Math.round(sec / 5) * 5)} s`
  if (sec < 5400) return `${Math.round(sec / 60)} min`
  return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`
}
function timeCommand() {
  const e = buildEta()
  if (!e) {
    if (running && /budow|wystroj|pomoc w budowie|budowa/i.test(currentTask || '')) { say('Jeszcze przygotowuje budowe (material, teren) - czas podam, gdy zaczne stawiac bloki.'); return }
    say(running ? `Teraz: ${currentTask}. Czas umiem szacowac przy budowie.` : 'Nic nie buduje.')
    return
  }
  const b = currentBuild
  if (b.phase === 'teren') {
    const tp = b.terrainTotal ? Math.round(b.terrainDone * 100 / b.terrainTotal) : 0
    say(`${b.label}: przygotowuje teren (${b.terrainDone}/${b.terrainTotal} blokow do wykopania, ${tp}%), potem stawiam ${b.total} blokow - to potrwa ok. ${fmtDuration(e.etaSec)}.`)
    return
  }
  const left = e.left ? `Zostalo ok. ${fmtDuration(e.etaSec)}${e.measured ? '' : ' (szacunek na start, dokladniej za chwile)'}.` : 'Koncze!'
  // dlugo nic nie przybywa - mowimy wprost, co teraz robimy (zbieranie materialu, droga), zamiast udawac, ze idzie
  const idle = (Date.now() - (b.lastChangeAt || b.startedAt)) / 1000
  const now = idle > 90 ? ` Od ${fmtDuration(idle)} nic nie przybylo - teraz: ${taskStatus || currentTask}.` : ''
  say(`${b.label}: ${e.done}/${e.total} blokow (${e.pct}%). ${left}${now}`)
}

// materialy aktualnej budowy - automatyczne sprzatanie ekwipunku (makeRoom) ich nie wyrzuca
const protectedItems = new Set()

// duze budowle (zamczysko, palac) nie mieszcza sie w ekwipunku na raz - materialy zbieramy partiami, warstwa po warstwie
const BATCH_LIMIT = 600
// ile blokow budowy zbierac naraz w survivalu (ekwipunek miesci ok. 2300; zostaje miejsce na narzedzia, jedzenie, ziemie)
const BUILD_CHUNK = 1200

// kreatywny: brakujacy blok z menu; przy pelnym ekwipunku wyrzucamy z niego bloki, ktore nie sa teraz potrzebne
async function creativeRefill(name) {
  if (!mcData.itemsByName[name]) return false
  const free = () => [...Array(36).keys()].map(i => i + 9).some(s => !bot.inventory.slots[s])
  if (!free()) {
    // od razu kilka miejsc (a nie jedno przy kazdym bloku) - wszystko i tak jest w menu
    const keep = new Set([name, 'dirt'])
    const slots = [...Array(27).keys()].map(i => i + 9).concat([...Array(9).keys()].map(i => i + 36))
      .filter(s => bot.inventory.slots[s] && !keep.has(bot.inventory.slots[s].name) && bot.heldItem !== bot.inventory.slots[s]).slice(0, 9)
    for (const slot of slots) { try { await bot.creative.setInventorySlot(slot, null) } catch {} }
  }
  return creativeGive(name, 64)
}

// rozbieranie bez kopania przez mury: pathfinder nie moze niczego niszczyc ani stawiac nowych slupkow,
// a kopie tylko sam slupek. Czego nie da sie dosiegnac - zostaje.
async function removeBlocksCarefully(positions) {
  const careful = protectBuilds(new Movements(bot))
  careful.canDig = false
  careful.allow1by1towers = false
  const normal = bot.pathfinder.movements
  bot.pathfinder.setMovements(careful)
  let removed = 0
  try {
    for (const p of [...positions].sort((a, b) => b.y - a.y)) { // od gory - nie stoimy na tym, co kopiemy
      if (!running) break
      setStatus(`rozbieram rusztowanie (${removed}/${positions.length})`)
      try { await goNearCell(p); await clearBlock(p); removed++ } catch (e) { console.log('[bot] rusztowanie:', e.message) }
    }
  } finally {
    bot.pathfinder.setMovements(normal)
  }
  return removed
}

function cleanupCommand() {
  return task('rozbieranie rusztowan', async () => {
    const c = bot.entity.position.floored()
    // najblizsza zapamietana budowla: znamy jej obrys i poziom gruntu; bez niej - 20 blokow wokol bota, grunt pod jego stopami
    const near = builds.filter(r => (!r.dim || r.dim === bot.game?.dimension) && Math.hypot(r.origin.x - c.x, r.origin.z - c.z) < 48)
      .sort((a, b) => Math.hypot(a.origin.x - c.x, a.origin.z - c.z) - Math.hypot(b.origin.x - c.x, b.origin.z - c.z))[0]
    let blocks
    if (near && planOf(near.type)) {
      const o = new Vec3(near.origin.x, near.origin.y, near.origin.z)
      const cells = planWithDecor(near.type, planOf(near.type)).map(x => ({ ...x, pos: toWorld(o, near.front, x.x, x.y, x.z) }))
      blocks = findScaffolding(cells, near.origin.y)
      say(`Sprzatam ziemie z rusztowan przy: ${near.type}.`)
    } else {
      blocks = floatingDirt(c.x - 20, c.x + 20, c.z - 20, c.z + 20, c.y, c.y + 40)
    }
    if (!blocks.length) { say('Nie widze lewitujacej ziemi (rusztowan) w okolicy.'); return }
    say(`Rozbieram rusztowania: ${blocks.length} blokow.`)
    const removed = await removeBlocksCarefully(blocks)
    if (running) say(removed < blocks.length ? `Rozebralem ${removed} z ${blocks.length} (reszty nie dosiegne).` : `Rozebralem ${removed} blokow rusztowania.`)
  })
}

// Rusztowania sa z ziemi, wiec po budowie usuwamy cala ziemie od pierwszego poziomu nad gruntem w gore (yGround to poziom,
// na ktorym stoi bot - grunt jest pod nim). Zostaje ziemia z planu budowli i naturalne pagorki (na szczycie kolumny jest trawa).
function floatingDirt(x1, x2, z1, z2, yGround, y2, keep = new Set()) {
  const found = []
  for (let x = x1; x <= x2; x++) {
    for (let z = z1; z <= z2; z++) {
      for (let y = yGround; y <= y2; y++) {
        const p = new Vec3(x, y, z)
        if (bot.blockAt(p)?.name !== 'dirt' || keep.has(posKey(p))) continue
        let t = y + 1
        while (bot.blockAt(new Vec3(x, t, z))?.name === 'dirt') t++
        if (/^(grass_block|podzol|mycelium|moss_block|rooted_dirt)$/.test(bot.blockAt(new Vec3(x, t, z))?.name || '')) continue
        found.push(p)
      }
    }
  }
  return found
}

// po budowie (znamy plan): lewitujaca ziemia w obrysie budowli i do 4 blokow dookola
function findScaffolding(cells, groundY) {
  const planKeys = new Set(cells.filter(c => c.block !== 'air' && !c.temp).map(c => posKey(c.pos)))
  const xs = cells.map(c => c.pos.x)
  const zs = cells.map(c => c.pos.z)
  const maxY = Math.max(...cells.map(c => c.pos.y)) + 2
  return floatingDirt(Math.min(...xs) - 4, Math.max(...xs) + 4, Math.min(...zs) - 4, Math.max(...zs) + 4, groundY, maxY, planKeys)
}

async function hangPainting(c, front) {
  const it = bot.inventory.items().find(i => i.name === 'painting')
  if (!it) return false
  const a = worldDir(front, c.attach)
  const wall = bot.blockAt(c.pos.offset(a.x, 0, a.z))
  if (!wall || wall.boundingBox !== 'block') return false
  try {
    await goNearCell(c.pos)
    await bot.equip(it, 'hand')
    // jak gracz: klikniecie obrazem w sciane (placeEntity w mineflayer nie obsluguje obrazow)
    const before = Object.values(bot.entities).filter(e => e.name === 'painting').length
    await bot.activateBlock(wall, new Vec3(-a.x, 0, -a.z))
    await sleep(400)
    return Object.values(bot.entities).filter(e => e.name === 'painting').length > before
  } catch (e) {
    console.log('[bot] obraz:', e.message)
    return false
  }
}

async function removeScaffolding(found) {
  return await removeBlocksCarefully(found)
}

// czerwony blok w podlozu tam, gdzie bot stal, zaczynajac budowe - zeby bylo wiadomo, gdzie stanac przy "zburz"
const MARKERS = ['red_concrete', 'red_wool', 'red_terracotta', 'redstone_block', 'red_concrete_powder', 'red_glazed_terracotta']
async function placeStartMarker(feet) {
  const spot = feet.offset(0, -1, 0)
  if (MARKERS.includes(bot.blockAt(spot)?.name)) return
  if (isCreative()) await creativeGive('red_concrete', 1)
  let it = bot.inventory.items().find(i => MARKERS.includes(i.name))
  if (!it) {
    say('Robie czerwony znacznik miejsca startu (czerwona welna).')
    try { await obtain('red_wool', 1) } catch {}
    it = bot.inventory.items().find(i => MARKERS.includes(i.name))
  }
  if (!it) { say('Nie mam czerwonego bloku na znacznik - zapamietaj, gdzie stalem.'); return }
  try {
    await goNearCell(spot)
    await clearBlock(spot)
    await placeBlockAt(it.name, spot)
    say(`Postawilem czerwony znacznik startu (${spot.x} ${spot.y} ${spot.z}) - stan na nim przy "zburz".`)
  } catch (e) { console.log('[bot] znacznik:', e.message) }
}

// naturalny teren (bez drewna, desek, cegiel itp. - to moze byc czyjs dom)
const NATURAL_RE = /^(dirt|coarse_dirt|grass_block|podzol|mycelium|rooted_dirt|mud|moss_block|moss_carpet|stone|deepslate|tuff|calcite|granite|diorite|andesite|sand|red_sand|gravel|clay|snow|snow_block|ice|packed_ice|netherrack|end_stone|dripstone_block|.*_ore|.*_leaves|short_grass|tall_grass|grass|fern|large_fern|dead_bush|.*_tulip|dandelion|poppy|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sweet_berry_bush)$/

// Kolejnosc stawiania jak u gracza: pasami po 3 rzedy, waz tam i z powrotem - postaw, przesun sie, postaw...
// Bot stawia wszystko w zasiegu reki i przesuwa sie dalej, zamiast biegac po calej warstwie.
function snakeOrder(list) {
  if (!list.length) return list
  const minX = Math.min(...list.map(c => c.pos.x))
  const strip = c => Math.floor((c.pos.x - minX) / 3)
  return [...list].sort((a, b) => strip(a) - strip(b) || (strip(a) % 2 ? b.pos.z - a.pos.z : a.pos.z - b.pos.z) || a.pos.x - b.pos.x)
}

// Partia materialu w survivalu liczona miejscami w ekwipunku (nie blokami): 1200 blokow w 30 rodzajach nie miesci sie
// w 36 slotach i bot stawal z pelnym ekwipunkiem. Bierzemy tyle komorek, ile zmiesci sie w wolnych slotach.
function takeChunk(list, from, room) {
  const need = {}
  const have = {}
  // slotow na n sztuk: tyle stackow, ile brakuje, +1 na polprodukty (deski, bruk do pieca)
  const slotsFor = (name, n) => n ? Math.ceil(Math.max(0, n - have[name]) / (mcData.itemsByName[name]?.stackSize || 64)) + 1 : 0
  let slots = 0
  let i = from
  for (; i < list.length && i - from < BUILD_CHUNK; i++) {
    const name = list[i].block
    if (have[name] === undefined) have[name] = haveOf(name)
    const n = need[name] || 0
    const delta = slotsFor(name, n + 1) - slotsFor(name, n)
    if (slots + delta > room && i > from) break
    slots += delta
    need[name] = n + 1
  }
  return list.slice(from, i)
}

// Malo miejsca w ekwipunku przed kolejna partia: to, co nie jest potrzebne teraz (resztki innych materialow, lupy),
// chowamy do najblizszej skrzyni. Narzedzi, jedzenia i ziemi na rusztowania nie ruszamy.
async function stashForBuild(keep) {
  if (bot.inventory.emptySlotCount() >= 10) return
  const extra = bot.inventory.items().filter(i => !keep.has(i.name) && i.name !== 'dirt' && !KEEP_RE.test(i.name) && !mcData.foodsByName[i.name])
  if (!extra.length) return
  setStatus('chowam niepotrzebne rzeczy do skrzyni (malo miejsca w ekwipunku)')
  let box = null
  try { box = await withTimeout(openNearestContainer(), 40000, 'skrzynia', () => bot.pathfinder.setGoal(null)) } catch (e) { console.log('[bot] skrzynia:', e.message) }
  if (!box) return
  try {
    for (const it of extra) {
      if (bot.inventory.emptySlotCount() >= 16) break
      try { await box.deposit(it.type, null, it.count) } catch { break }
    }
  } finally { box.close() }
}

// Droga do miejsca budowy (np. "pomoc" na drugim koncu mapy): bez kopania i bez slupkow - bot obchodzi domy,
// zamiast sie przez nie przekopywac. W kreatywnym leci gora.
async function travelToSite(center) {
  if (bot.entity.position.distanceTo(center) < 24) return
  setStatus(`ide na miejsce budowy (${center.x} ${center.y} ${center.z})`)
  if (isCreative()) {
    const up = new Vec3(center.x, Math.max(bot.entity.position.y, center.y) + 30, center.z)
    if (await creativeFlyTo(up)) return
  }
  const careful = protectBuilds(new Movements(bot))
  careful.canDig = false
  careful.allow1by1towers = false
  careful.scafoldingBlocks = []
  const normal = bot.pathfinder.movements
  bot.pathfinder.setMovements(careful)
  try { await gotoSafe(new goals.GoalNearXZ(center.x, center.z, 8), 240000) } catch (e) { console.log('[bot] droga na budowe:', e.message) }
  finally { bot.pathfinder.setMovements(normal) }
}

async function buildPlan(label, plan, origin, front, opts = {}) {
  // tu stoi bot, gdy zaczyna budowe (przy "kontynuuj" - tam, gdzie zaczal za pierwszym razem)
  const startFeet = opts.start ? new Vec3(opts.start.x, opts.start.y, opts.start.z) : bot.entity.position.floored()
  if (opts.type && !opts.decor && !opts.helper && !opts.resume) recordBuild(opts.type, origin, front)
  // pomocnik robi prawa polowe (x >= 0); lider robi calosc i pomija to, co juz stoi
  const cells = plan.filter(c => opts.part !== 'right' || c.x >= 0).map(c => ({ ...c, pos: toWorld(origin, front, c.x, c.y, c.z) }))
  if (opts.type && !opts.helper) {
    currentJob = { kind: opts.decor ? 'decor' : 'build', type: opts.type, label, origin: { x: origin.x, y: origin.y, z: origin.z }, front,
      start: { x: startFeet.x, y: startFeet.y, z: startFeet.z } }
    rememberJob(currentJob)
    if (cells.filter(c => c.block !== 'air').length > 40) askForHelp(currentJob)
  }
  // material tylko na to, czego jeszcze nie ma (wazne przy "kontynuuj" i gdy pomocnik juz cos postawil)
  const notPlaced = c => !sameKind(bot.blockAt(c.pos)?.name || '', c.block)
  for (const c of cells) if (c.temp) c.block = 'dirt' // tymczasowe podpory (np. pod kropka nad "i"), na koncu znikaja
  const solidCells = cells.filter(c => c.block !== 'air')
  const batched = solidCells.length > BATCH_LIMIT
  for (const c of solidCells) protectedItems.add(WOOD_RE.test(c.block) ? 'log' : c.block)
  for (const c of solidCells) noDigPositions.add(posKey(c.pos)) // odblokowywanie nie rusza budowli
  // cala budowla (sciany, stropy, dach, tez polowa kolegi) jest nietykalna - zaklinowany bot nie kopie sufitu,
  // a w drodze po material nie przekopuje sie przez mury
  if (opts.type) {
    for (const c of planOf(opts.type) || []) if (c.block !== 'air') noDigPositions.add(posKey(toWorld(origin, front, c.x, c.y, c.z)))
  }
  const normalMoves = bot.pathfinder.movements
  // rusztowania sa zawsze z ziemi: pathfinder przy budowie stawia slupki tylko z niej (po budowie cala znika)
  const dirtId = mcData.itemsByName.dirt?.id
  const terrainMoves = protectBuilds(new Movements(bot))
  terrainMoves.canDig = true
  terrainMoves.allow1by1towers = true
  if (dirtId !== undefined) terrainMoves.scafoldingBlocks = [dirtId]
  // przy przygotowaniu terenu kopiemy tylko w obrysie budowli (+2 bloki) - nigdy przez cudze domy dookola
  const box = cells.reduce((m, c) => ({ x1: Math.min(m.x1, c.pos.x), x2: Math.max(m.x2, c.pos.x), z1: Math.min(m.z1, c.pos.z), z2: Math.max(m.z2, c.pos.z),
    y1: Math.min(m.y1, c.pos.y), y2: Math.max(m.y2, c.pos.y) }), { x1: Infinity, x2: -Infinity, z1: Infinity, z2: -Infinity, y1: Infinity, y2: -Infinity })
  const inBox = p => p.x >= box.x1 - 2 && p.x <= box.x2 + 2 && p.z >= box.z1 - 2 && p.z <= box.z2 + 2
  terrainMoves.exclusionAreasBreak.push(b => inBox(b.position) ? 0 : 1000)
  const siteCenter = new Vec3(Math.round((box.x1 + box.x2) / 2), box.y1, Math.round((box.z1 + box.z2) / 2))
  protectedItems.add('dirt')
  const scaffoldDirt = async () => {
    if (isCreative()) { if (count('dirt') < 32) await creativeRefill('dirt'); return }
    if (count('dirt') >= 16 || opts.decor) return
    bot.pathfinder.setMovements(normalMoves)
    setStatus(`zbieram ziemie na rusztowania (${label})`)
    say('Zbieram ziemie na rusztowania.')
    try { await obtain('dirt', 64) } catch (e) { console.log('[bot] ziemia na rusztowania:', e.message) }
  }
  try {
    await scaffoldDirt()
    // najpierw to, bez czego sie nie da (sciany, dach, meble); duze budowle - partiami w trakcie
    if (isCreative()) say(`${label}: ${solidCells.length} blokow - biore je z menu na biezaco.`)
    else if (batched) say(`${label} to ${solidCells.length} blokow - materialy bede zbieral partiami, ile zmiesci sie w ekwipunku.`)
    else if (!await gatherMaterials(solidCells.filter(c => !c.optional && notPlaced(c)), label)) return false

    // ozdoby (szyby, pochodnie): pytamy, czy po nie isc
    const extras = {}
    for (const c of cells) if (c.optional) extras[c.block] = (extras[c.block] || 0) + 1
    const lacking = Object.entries(extras).filter(([name, n]) => haveOf(name) < n)
    let wantExtras = false
    if (lacking.length && isCreative()) {
      wantExtras = true // w kreatywnym ozdoby sa od reki (bierzemy je z menu przy stawianiu) - nie ma o co pytac
    } else if (lacking.length) {
      setStatus(`czekam na odpowiedz: zdobyc ozdoby na ${label} czy budowac bez nich`)
      const list = lacking.map(([name, n]) => `${n - haveOf(name)} x ${name}`).join(', ')
      const choice = await askUser(`Potrzebuje jeszcze: ${list}. Mam po nie pojsc czy budowac bez nich? (pojdz / buduj bez)`,
        // cale wiadomosci, zeby np. "idz do bazy" nie zostalo wziete za odpowiedz "idz"
        [[/^(pojdz|idz|lec|tak|zdobadz|dawaj)( po nie)?$/, 'go'], [/^(buduj bez( nich)?|bez( nich)?|nie|buduj)$/, 'skip']],
        90000, 'skip', 'Nie dostalem odpowiedzi - buduje bez nich.')
      if (!running) return false
      wantExtras = choice === 'go'
      say(wantExtras ? 'Dobra, ide po nie.' : 'Dobra, buduje bez nich.')
      if (wantExtras && !batched) {
        for (const [name, n] of lacking) {
          if (!running) return false
          setStatus(`zbieram ozdoby na ${label}: ${name} (mam ${haveOf(name)}/${n})`)
          try { await obtain(name, n) } catch (e) { console.log('[bot] ozdoby:', e.message) }
        }
      }
    }
    if (!wantExtras) {
      // ozdoby, ktorych nie mamy w ilosci potrzebnej na cala budowle, pomijamy (licznik raz, a nie dla kazdej komorki - wielkie budowle)
      const total = {}
      for (const c of cells) total[c.block] = (total[c.block] || 0) + 1
      for (const c of cells) if (c.optional && haveOf(c.block) < total[c.block]) c.block = 'air'
    }

    // budujemy bez kopania przez wlasne sciany (kopiemy tylko przy przygotowaniu terenu i zbieraniu)
    const buildMoves = protectBuilds(new Movements(bot))
    buildMoves.canDig = false
    buildMoves.allow1by1towers = true
    if (dirtId !== undefined) buildMoves.scafoldingBlocks = [dirtId]
    // w kreatywnym bot lata - pieszo (np. w zamknietym pokoju) nie stawia slupkow z ziemi
    if (isCreative()) {
      for (const m of [buildMoves, terrainMoves]) { m.allow1by1towers = false; m.scafoldingBlocks = [] }
    }
    const total = cells.filter(c => c.block !== 'air').length
    let placed = 0
    currentBuild = { label, total, phase: 'teren', terrainDone: 0, terrainTotal: 0, startedAt: Date.now(), basePlaced: 0, get placed() { return placed } }
    let failed = 0

    // 1) teren: od gory wykopujemy to, co przeszkadza (ziemia, trawa, kamien w obrysie)
    say(`Buduje ${label} (${total} blokow). Najpierw przygotowuje teren.`)
    await travelToSite(siteCenter)
    if (!running) return false
    bot.pathfinder.setMovements(terrainMoves)
    // najpierw liczymy, co trzeba wykopac - zeby "czas" pokazywal postep tez przy przygotowaniu terenu
    const clearLayers = [...new Set(cells.map(c => c.y))].sort((a, b) => b - a)
    const toClear = clearLayers.flatMap(y => snakeOrder(cells.filter(c => c.y === y))).filter(c => {
      const b = bot.blockAt(c.pos)
      if (!b || b.boundingBox !== 'block' || sameKind(b.name, c.block) || (opts.decor && c.block !== 'air')) return false // wystroj nie burzy tego, co juz stoi
      // pomocnik kopie tylko naturalny teren - gdyby kolega podal zle miejsce, nie rozwali niczyjego domu
      return !opts.helper || NATURAL_RE.test(b.name)
    })
    currentBuild.terrainTotal = toClear.length
    for (const c of toClear) {
      if (!running) return false
      currentBuild.terrainDone++
      const b = bot.blockAt(c.pos)
      if (!b || b.boundingBox !== 'block' || sameKind(b.name, c.block)) continue
      setStatus(`przygotowuje teren pod ${label}: ${currentBuild.terrainDone}/${toClear.length}`)
      try { await goNearCell(c.pos); await clearBlock(c.pos) } catch (e) { console.log('[bot] teren:', e.message) }
    }
    // od teraz liczy sie tempo stawiania
    // to, co juz stoi (np. po "kontynuuj"), liczy sie od razu - procent jest prawdziwy, a tempo liczymy tylko z nowych blokow
    const counted = new Set()
    for (const c of cells) if (c.block !== 'air' && sameKind(bot.blockAt(c.pos)?.name || '', c.block)) counted.add(posKey(c.pos))
    placed = counted.size
    Object.assign(currentBuild, { phase: 'budowa', startedAt: Date.now(), basePlaced: placed })

    // 2) stawianie warstwami od dolu; w warstwie kilka przejsc - blok musi miec sie o co oprzec
    const layers = [...new Set(cells.map(c => c.y))].sort((a, b) => a - b)
    // jeden blok: 'done' (stoi), 'retry' (sprobowac w nastepnym przejsciu), 'drop' (pominac)
    const placeOne = async (c, first, where) => {
      const cur = bot.blockAt(c.pos)
      if (cur && sameKind(cur.name, c.block)) { if (!counted.has(posKey(c.pos))) { counted.add(posKey(c.pos)); placed++ } return 'done' }
      if (opts.decor && cur && cur.name !== 'air' && cur.boundingBox !== 'empty') return 'drop' // zajete - zostawiamy
      if (c.block === 'painting') { if (isCreative() && !invItemFor('painting')) await creativeRefill('painting'); if (await hangPainting(c, front)) placed++; return 'drop' }
      if (first && !opts.decor) await fillBelow(c.pos)
      if (!hasSupport(c.pos)) return 'retry'
      let it = invItemFor(c.block)
      if (!it && isCreative()) { await creativeRefill(c.block); it = invItemFor(c.block) }
      if (!it && c.alt) { c.block = c.alt; delete c.facing; it = invItemFor(c.block) } // nie mamy schodow - pelny blok
      if (!it) { if (!c.optional) failed++; return 'drop' }
      const eta = buildEta()
      setStatus(`buduje ${label}: ${placed}/${total} blokow (${where})${eta && eta.measured ? ' - zostalo ok. ' + fmtDuration(eta.etaSec) : ''}`)
      try {
        await goNearCell(c.pos, c.facing && worldDir(front, c.facing))
        await placeBlockAt(it.name, c.pos, c.attach && worldDir(front, c.attach))
        if (!counted.has(posKey(c.pos))) { counted.add(posKey(c.pos)); placed++ }
        if (CONTAINERS.includes(c.block)) { ownChests.add(posKey(c.pos)); saveJson('chests.json', [...ownChests]) }
        return 'done'
      } catch (e) {
        console.log(`[bot] nie postawilem ${c.block}: ${e.message}`)
        // nie da sie tam dojsc/doleciec - dwa razy i pomijamy (inaczej tysiace takich blokow to godziny stania)
        if (/brak postepu|No path|Timeout|timeout/i.test(e.message)) {
          try { bot.pathfinder.setGoal(null); bot.clearControlStates() } catch {}
          c.stalls = (c.stalls || 0) + 1
          if (c.stalls >= 2) { if (!c.optional) failed++; return 'drop' }
        }
        return 'retry'
      }
    }
    // kilka przejsc; schody (dach), ktore nie wyszly z dwoch podejsc - zwykly blok, zeby nie zostala dziura
    const runPasses = async (pending, first, where) => {
      for (let pass = 0; pass < (opts.passes || 4) && pending.length && running; pass++) {
        const next = []
        for (const c of pending) {
          if (!running) break
          if ((await placeOne(c, first, where)) !== 'retry') continue
          if (c.alt && c.facing && pass >= 1) { c.block = c.alt; delete c.facing }
          next.push(c)
        }
        pending = next
      }
      return pending
    }
    for (const y of layers) {
      const pending = snakeOrder(cells.filter(c => c.y === y && c.block !== 'air' && !c.late))
      const where = `warstwa ${y - layers[0] + 1}/${layers.length}`
      if (batched && !isCreative() && pending.length) {
        // duza budowla w survivalu: material na warstwe partiami, ktore mieszcza sie w ekwipunku (stawiamy partie i wracamy po nastepna)
        const left = pending.filter(c => notPlaced(c))
        let part = 0
        for (let i = 0; i < left.length && running;) {
          await makeRoom()
          await stashForBuild(new Set(left.slice(i, i + BUILD_CHUNK).map(c => c.block)))
          const chunk = takeChunk(left, i, Math.max(6, bot.inventory.emptySlotCount() - 6))
          i += chunk.length
          part++
          bot.pathfinder.setMovements(normalMoves)
          const what = i < left.length || part > 1 ? `${label} (${where}, czesc ${part})` : `${label} (${where})`
          if (!await gatherMaterials(chunk.filter(c => !c.optional && notPlaced(c)), what)) return false
          await travelToSite(siteCenter)
          if (wantExtras) for (const c of chunk.filter(o => o.optional)) if (haveOf(c.block) < 1) { try { await obtain(c.block, 1) } catch {} }
          await scaffoldDirt()
          bot.pathfinder.setMovements(buildMoves)
          await runPasses(chunk, y === layers[0], where)
        }
        // to, co w swojej partii nie mialo jeszcze oparcia - ostatnie podejscie dla calej warstwy
        failed += (await runPasses(left.filter(c => notPlaced(c)), y === layers[0], where)).length
        continue
      }
      await scaffoldDirt() // ziemia na rusztowania sie konczy - dobieramy
      bot.pathfinder.setMovements(buildMoves)
      failed += (await runPasses(pending, y === layers[0], where)).length
    }

    // 2b) lampy pod stropem i obrazy - na koniec, kiedy stropy i sciany juz stoja
    const late = cells.filter(c => c.late && c.block !== 'air')
    if (late.length && running) {
      bot.pathfinder.setMovements(buildMoves)
      failed += (await runPasses(late, false, 'lampy i obrazy')).length
    }

    // 3) rusztowania: pathfinder, zeby siegnac wysoko, stawia slupki z ziemi/bruku i ich nie rozbiera.
    //    Wszystko z tych blokow, co stoi w obrysie budowli (+1 blok dookola) od poziomu gruntu w gore, a nie nalezy do planu - kopiemy.
    if (running && !opts.decor && !opts.helper) {
      bot.pathfinder.setMovements(normalMoves)
      const scaffold = findScaffolding(cells, origin.y)
      if (scaffold.length) {
        setStatus(`czekam na odpowiedz: rozebrac rusztowania przy ${label}?`)
        const choice = await askUser(`Zostalo ${scaffold.length} blokow rusztowania. Rozebrac je? (tak / nie)`,
          [[/^(tak|rozbierz|dawaj|ok|jasne)( je)?$/, 'yes'], [/^(nie|zostaw)( je)?$/, 'no']],
          60000, 'yes', 'Nie dostalem odpowiedzi - rozbieram.')
        if (running && choice === 'yes') {
          const removed = await removeScaffolding(scaffold)
          if (removed) say(`Rozebralem ${removed} blokow rusztowania.`)
        } else if (running) {
          say('Dobra, zostawiam rusztowania ("rozbierz rusztowania" usunie je pozniej).')
        }
      }
    }

    // 4) tymczasowe podpory znikaja (od gory)
    const temps = cells.filter(c => c.temp).sort((a, b) => b.y - a.y)
    if (temps.length && running) {
      bot.pathfinder.setMovements(normalMoves)
      setStatus(`usuwam rusztowanie z ${label}`)
      for (const c of temps) {
        if (!running) break
        try { await goNearCell(c.pos); await clearBlock(c.pos) } catch {}
      }
    }
    if (running && opts.type && !opts.decor && !opts.helper) await placeStartMarker(startFeet)
    if (running) say(failed ? `${label} gotowe, ale ${failed} blokow nie udalo sie postawic.` : `${label} gotowe!`)
    return true
  } finally {
    bot.pathfinder.setMovements(normalMoves)
    protectedItems.clear()
    currentBuild = null
    noDigPositions.clear()
    if (isCreative()) bot.creative.stopFlying()
  }
}

// ---------- plany ----------
function ring(x1, x2, z1, z2, cb) {
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) if (x === x1 || x === x2 || z === z1 || z === z2) cb(x, z)
}
function fill(x1, x2, z1, z2, cb) {
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) cb(x, z)
}

// dom 7x7: sciany z desek, rogi z pni, drzwi z przodu, okna, plaski dach, stol, skrzynia, piec, pochodnia
function planHouse() {
  const p = []
  const h = 4
  fill(-2, 2, 1, 5, (x, z) => { for (let y = 0; y < h; y++) p.push({ x, y, z, block: 'air' }) })
  for (let y = 0; y < h; y++) {
    ring(-3, 3, 0, 6, (x, z) => {
      if (x === 0 && z === 0 && y <= 1) return // drzwi
      const corner = Math.abs(x) === 3 && (z === 0 || z === 6)
      const window = y === 2 && ((Math.abs(x) === 3 && z === 3) || (x === 0 && z === 6))
      p.push({ x, y, z, block: corner ? 'oak_log' : window ? 'glass_pane' : 'oak_planks', optional: window })
    })
  }
  p.push({ x: 0, y: 0, z: 0, block: 'oak_door' }, { x: 0, y: 1, z: 0, block: 'air' })
  fill(-3, 3, 0, 6, (x, z) => p.push({ x, y: h, z, block: 'oak_planks' }))
  p.push({ x: -2, y: 0, z: 5, block: 'crafting_table' }, { x: 2, y: 0, z: 5, block: 'chest' },
    { x: -2, y: 0, z: 3, block: 'furnace' }, { x: 2, y: 0, z: 1, block: 'torch', optional: true })
  return replaceInterior(p)
}

// ostatni wpis dla danej komorki wygrywa (meble zastepuja "powietrze" wnetrza)
function replaceInterior(p) {
  const byPos = new Map()
  for (const c of p) byPos.set(`${c.x},${c.y},${c.z}`, c)
  return [...byPos.values()]
}

// dom jak u villagerow (rowniny): 5x5, rogi z pni, sciany z desek, okna, dach z wierzcholkiem
function planVillagerHouse() {
  const p = []
  fill(-1, 1, 1, 3, (x, z) => { for (let y = 0; y < 3; y++) p.push({ x, y, z, block: 'air' }) })
  ring(-2, 2, 0, 4, (x, z) => p.push({ x, y: -1, z, block: 'cobblestone' })) // fundament
  for (let y = 0; y < 3; y++) {
    ring(-2, 2, 0, 4, (x, z) => {
      if (x === 0 && z === 0 && y <= 1) return
      const corner = Math.abs(x) === 2 && (z === 0 || z === 4)
      const window = y === 1 && ((Math.abs(x) === 2 && z === 2) || (x === 0 && z === 4))
      p.push({ x, y, z, block: corner ? 'oak_log' : window ? 'glass_pane' : 'oak_planks', optional: window })
    })
  }
  p.push({ x: 0, y: 0, z: 0, block: 'oak_door' }, { x: 0, y: 1, z: 0, block: 'air' })
  fill(-2, 2, 0, 4, (x, z) => p.push({ x, y: 3, z, block: 'oak_planks' }))
  fill(-1, 1, 1, 3, (x, z) => p.push({ x, y: 4, z, block: 'oak_planks' }))
  p.push({ x: 0, y: 5, z: 2, block: 'oak_log' })
  p.push({ x: 1, y: 0, z: 3, block: 'torch', optional: true })
  return replaceInterior(p)
}

// zamek 13x13 z bruku: mury 5 wysokie z blankami, brama 3 szeroka, 4 wieze 3x3 do wysokosci 8
function planCastle() {
  const p = []
  fill(-5, 5, 1, 11, (x, z) => { for (let y = 0; y < 4; y++) p.push({ x, y, z, block: 'air' }) })
  for (let y = 0; y < 5; y++) ring(-6, 6, 0, 12, (x, z) => p.push({ x, y, z, block: 'cobblestone' }))
  ring(-6, 6, 0, 12, (x, z) => { if ((x + z) % 2 === 0) p.push({ x, y: 5, z, block: 'cobblestone' }) })
  for (const [cx, cz] of [[-6, 0], [6, 0], [-6, 12], [6, 12]]) {
    const sx = cx < 0 ? 1 : -1
    const sz = cz === 0 ? 1 : -1
    for (let y = 0; y < 8; y++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) p.push({ x: cx + sx * i, y, z: cz + sz * j, block: 'cobblestone' })
    for (const [i, j] of [[0, 0], [2, 0], [0, 2], [2, 2]]) p.push({ x: cx + sx * i, y: 8, z: cz + sz * j, block: 'cobblestone' })
  }
  for (let x = -1; x <= 1; x++) for (let y = 0; y < 3; y++) p.push({ x, y, z: 0, block: 'air' }) // brama
  p.push({ x: -4, y: 0, z: 10, block: 'crafting_table' }, { x: 4, y: 0, z: 10, block: 'chest' }, { x: 0, y: 0, z: 6, block: 'torch', optional: true })
  return replaceInterior(p)
}

// zagroda na zwierzeta: plot 9x9 z furtka
function planPen() {
  const p = []
  ring(-4, 4, 0, 8, (x, z) => p.push({ x, y: 0, z, block: x === 0 && z === 0 ? 'oak_fence_gate' : 'oak_fence' }))
  fill(-3, 3, 1, 7, (x, z) => { p.push({ x, y: 0, z, block: 'air' }); p.push({ x, y: 1, z, block: 'air' }) })
  return replaceInterior(p)
}

// platforma w niebie 9x9 z murkiem dookola, stolem i skrzynia (srodek to slup, na ktorym stoi bot)
function planSkyPlatform() {
  const p = []
  fill(-4, 4, -4, 4, (x, z) => { if (x || z) p.push({ x, y: -1, z, block: 'cobblestone' }) })
  ring(-4, 4, -4, 4, (x, z) => p.push({ x, y: 0, z, block: 'cobblestone' })) // murek, zeby nie spasc
  p.push({ x: -3, y: 0, z: -3, block: 'crafting_table' }, { x: 3, y: 0, z: -3, block: 'chest' }, { x: 0, y: 0, z: 3, block: 'torch', optional: true })
  return p
}

// baza podziemna: pokoj 7x7x3 z pochodniami, stolem, piecem i skrzynia
function planUndergroundRoom() {
  const p = []
  fill(-3, 3, 0, 6, (x, z) => { for (let y = 0; y < 3; y++) p.push({ x, y, z, block: 'air' }) })
  p.push({ x: -3, y: 0, z: 6, block: 'crafting_table' }, { x: 3, y: 0, z: 6, block: 'chest' }, { x: -3, y: 0, z: 3, block: 'furnace' })
  for (const [x, z] of [[-2, 1], [2, 1], [-2, 5], [2, 5]]) p.push({ x, y: 0, z, block: 'torch', optional: true })
  return replaceInterior(p)
}

// zamczysko 21x21: wysokie mury z blankami, brama, 4 wieze 5x5 i donzon (wieza mieszkalna) z tylu dziedzinca
function planBigCastle() {
  const p = []
  fill(-9, 9, 1, 19, (x, z) => { for (let y = 0; y < 6; y++) p.push({ x, y, z, block: 'air' }) }) // dziedziniec
  for (let y = 0; y < 7; y++) ring(-10, 10, 0, 20, (x, z) => p.push({ x, y, z, block: 'cobblestone' }))
  ring(-10, 10, 0, 20, (x, z) => { if ((x + z) % 2 === 0) p.push({ x, y: 7, z, block: 'cobblestone' }) })
  for (const [cx, cz] of [[-10, 0], [10, 0], [-10, 20], [10, 20]]) {
    fill(cx - 1, cx + 1, cz - 1, cz + 1, (x, z) => { for (let y = 0; y < 11; y++) p.push({ x, y, z, block: 'air' }) })
    for (let y = 0; y < 12; y++) ring(cx - 2, cx + 2, cz - 2, cz + 2, (x, z) => p.push({ x, y, z, block: 'cobblestone' }))
    ring(cx - 2, cx + 2, cz - 2, cz + 2, (x, z) => { if ((x + z) % 2 === 0) p.push({ x, y: 12, z, block: 'cobblestone' }) })
  }
  for (let x = -1; x <= 1; x++) for (let y = 0; y < 4; y++) p.push({ x, y, z: 0, block: 'air' }) // brama
  // donzon 7x7: 14 wysoki, dach i blanki, wejscie od dziedzinca
  fill(-2, 2, 12, 16, (x, z) => { for (let y = 0; y < 14; y++) p.push({ x, y, z, block: 'air' }) })
  for (let y = 0; y < 14; y++) ring(-3, 3, 11, 17, (x, z) => p.push({ x, y, z, block: 'cobblestone' }))
  fill(-3, 3, 11, 17, (x, z) => p.push({ x, y: 14, z, block: 'cobblestone' }))
  ring(-3, 3, 11, 17, (x, z) => { if ((x + z) % 2 === 0) p.push({ x, y: 15, z, block: 'cobblestone' }) })
  p.push({ x: 0, y: 0, z: 11, block: 'air' }, { x: 0, y: 1, z: 11, block: 'air' })
  p.push({ x: -2, y: 0, z: 16, block: 'crafting_table' }, { x: 2, y: 0, z: 16, block: 'chest' }, { x: -2, y: 0, z: 13, block: 'furnace' })
  for (const [x, z] of [[-8, 2], [8, 2], [-8, 18], [8, 18], [0, 14]]) p.push({ x, y: 0, z, block: 'torch', optional: true })
  return replaceInterior(p)
}

// wieza palacowa: "okragla" (5x5 bez rogow), od y0 do y1, z czapa i iglica (deski, pnie, na szczycie ploty)
function palaceTower(p, cx, cz, y0, y1) {
  const roundRing = (x, z) => !(Math.abs(x - cx) === 2 && Math.abs(z - cz) === 2)
  fill(cx - 1, cx + 1, cz - 1, cz + 1, (x, z) => { for (let y = y0; y < y1; y++) p.push({ x, y, z, block: 'air' }) })
  for (let y = y0; y < y1; y++) {
    ring(cx - 2, cx + 2, cz - 2, cz + 2, (x, z) => {
      if (!roundRing(x, z)) return
      const window = (y - y0) % 4 === 2 && (x === cx || z === cz)
      p.push({ x, y, z, block: window ? 'glass_pane' : 'cobblestone', optional: window })
    })
  }
  fill(cx - 2, cx + 2, cz - 2, cz + 2, (x, z) => { if (roundRing(x, z)) p.push({ x, y: y1, z, block: 'oak_planks' }) }) // czapa
  fill(cx - 1, cx + 1, cz - 1, cz + 1, (x, z) => p.push({ x, y: y1 + 1, z, block: 'oak_planks' }))
  p.push({ x: cx, y: y1 + 2, z: cz, block: 'oak_log' }, { x: cx, y: y1 + 3, z: cz, block: 'oak_log' })
  p.push({ x: cx, y: y1 + 4, z: cz, block: 'oak_fence' }, { x: cx, y: y1 + 5, z: cz, block: 'oak_fence' }) // iglica
}

// palac: fundament, sala 15x11 z kolumnami z pni i dwoma rzedami okien, taras z blankami,
// 4 okragle wieze narozne i wysoka wieza srodkowa - wszystkie z iglicami
function planPalace() {
  const p = []
  fill(-9, 9, 0, 14, (x, z) => p.push({ x, y: -1, z, block: 'cobblestone' })) // fundament / dziedziniec
  fill(-6, 6, 3, 11, (x, z) => { for (let y = 0; y < 8; y++) p.push({ x, y, z, block: 'air' }) })
  for (let y = 0; y < 8; y++) {
    ring(-7, 7, 2, 12, (x, z) => {
      const pillar = ((x + 7) % 4 === 0 && (z === 2 || z === 12)) || ((z - 2) % 4 === 0 && Math.abs(x) === 7) ||
        (Math.abs(x) === 7 && (z === 2 || z === 12))
      const window = !pillar && [2, 3, 5, 6].includes(y)
      p.push({ x, y, z, block: pillar ? 'oak_log' : window ? 'glass_pane' : 'oak_planks', optional: window })
    })
  }
  p.push({ x: 0, y: 0, z: 2, block: 'oak_door' }, { x: 0, y: 1, z: 2, block: 'air' }) // wejscie
  for (const x of [-1, 1]) for (let y = 0; y < 3; y++) p.push({ x, y, z: 1, block: 'oak_log' }) // kolumny portyku
  fill(-1, 1, 1, 1, (x, z) => p.push({ x, y: 3, z, block: 'oak_planks' }))
  fill(-7, 7, 2, 12, (x, z) => p.push({ x, y: 8, z, block: 'oak_planks' })) // dach-taras
  ring(-7, 7, 2, 12, (x, z) => { if ((x + z) % 2 === 0) p.push({ x, y: 9, z, block: 'cobblestone' }) })
  for (const [cx, cz] of [[-7, 2], [7, 2], [-7, 12], [7, 12]]) palaceTower(p, cx, cz, 0, 14)
  palaceTower(p, 0, 7, 9, 16) // wieza srodkowa na dachu
  p.push({ x: -5, y: 0, z: 10, block: 'crafting_table' }, { x: 5, y: 0, z: 10, block: 'chest' })
  for (const [x, z] of [[-5, 4], [5, 4], [-5, 9], [5, 9]]) p.push({ x, y: 0, z, block: 'torch', optional: true })
  return replaceInterior(p)
}

// ---------- palac endu ----------
// Mieszkalny palac z materialow z Endu: tarasowa platforma z murkiem i latarniami, schody wejsciowe,
// dwupietrowa sala z kolumnami z purpuru, fioletowe witraze, pasy z purpuru, schody na pietro,
// cztery okragle wieze z iglicami z end rodow i wysoka wieza srodkowa z kopula.
const roundCell = (dx, dz, rMin, rMax) => { const d = Math.sqrt(dx * dx + dz * dz); return d > rMin && d <= rMax }

// okragla wieza z bandami purpuru, witrazami, kopula i iglica
function endTower(p, cx, cz, y0, y1, big) {
  const R = big ? 3.2 : 2.3
  const r0 = big ? 2.2 : 1.3
  const span = Math.ceil(R)
  for (let dx = -span; dx <= span; dx++) {
    for (let dz = -span; dz <= span; dz++) {
      const x = cx + dx
      const z = cz + dz
      for (let y = y0; y < y1; y++) {
        if (roundCell(dx, dz, r0, R)) {
          const band = (y - y0) % 5 === 4
          // bez okien od strony -z: tam wisi drabina (drabiny nie trzymaja sie szkla)
          const window = !band && (dx === 0 || dz === 0) && !(dx === 0 && dz < 0) && (y - y0) % 5 >= 1 && (y - y0) % 5 <= 2
          p.push({ x, y, z, block: band ? 'purpur_block' : window ? 'purple_stained_glass' : 'end_stone_bricks', optional: window })
        } else if (Math.sqrt(dx * dx + dz * dz) <= r0) {
          p.push({ x, y, z, block: 'air' })
        }
      }
    }
  }
  // kopula: coraz mniejsze kregi z purpuru
  let y = y1
  for (let rad = R; rad > 0.9; rad -= 1, y++) {
    for (let dx = -span; dx <= span; dx++) for (let dz = -span; dz <= span; dz++) {
      if (Math.sqrt(dx * dx + dz * dz) <= rad) p.push({ x: cx + dx, y, z: cz + dz, block: 'purpur_block' })
    }
  }
  // kolce z end rodow na krawedzi kopuly i iglica
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) p.push({ x: cx + dx, y: y, z: cz + dz, block: 'end_rod' })
  p.push({ x: cx, y, z: cz, block: 'purpur_pillar' }, { x: cx, y: y + 1, z: cz, block: 'purpur_pillar' })
  if (big) p.push({ x: cx, y: y + 2, z: cz, block: 'purpur_pillar' })
  p.push({ x: cx, y: y + (big ? 3 : 2), z: cz, block: 'end_rod' }, { x: cx, y: y + (big ? 4 : 3), z: cz, block: 'end_rod' })
  // drabina przy scianie (od strony -z), az do kopuly; nad nia dziura w kopule, zeby wyjsc na gore
  const lz = cz - (big ? 2 : 1)
  for (let ly = y0; ly <= y1; ly++) p.push({ x: cx, y: ly, z: lz, block: 'ladder', attach: { x: 0, z: -1 } })
  for (let ly = y1 + 1; ly <= y1 + 1; ly++) p.push({ x: cx, y: ly, z: lz, block: 'air' })
}

function planEndPalace() {
  const p = []
  // 1) platforma 23x23: obramowanie z purpuru, posadzka z cegiel, fioletowa sciezka z witraza
  fill(-11, 11, 0, 22, (x, z) => {
    const border = Math.abs(x) === 11 || z === 0 || z === 22
    const path = Math.abs(x) <= 1 && z >= 1 && z <= 6
    p.push({ x, y: 0, z, block: border ? 'purpur_block' : path ? 'purple_stained_glass' : 'end_stone_bricks' })
  })
  fill(-11, 11, 0, 22, (x, z) => { for (let y = 1; y < 11; y++) p.push({ x, y, z, block: 'air' }) }) // wolne nad platforma
  // schody wejsciowe (z ziemi na platforme)
  for (let x = -2; x <= 2; x++) p.push({ x, y: 0, z: -1, block: 'end_stone_brick_stairs', facing: { x: 0, z: 1 } })
  // murek dookola platformy (bez wejscia) i slupki z end rodami w rogach
  ring(-11, 11, 0, 22, (x, z) => { if (!(z === 0 && Math.abs(x) <= 2)) p.push({ x, y: 1, z, block: 'end_stone_brick_wall' }) })
  for (const [x, z] of [[-11, 0], [11, 0], [-11, 22], [11, 22]]) {
    p.push({ x, y: 1, z, block: 'purpur_pillar' }, { x, y: 2, z, block: 'purpur_pillar' }, { x, y: 3, z, block: 'end_rod' })
  }
  // latarnie przy sciezce
  for (const x of [-3, 3]) for (const z of [2, 5]) {
    for (let y = 1; y <= 3; y++) p.push({ x, y, z, block: 'purpur_pillar' })
    p.push({ x, y: 4, z, block: 'end_rod' })
  }

  // 2) sala 15x15, dwa pietra: parter y1-4, strop y5, pietro y6-9, dach y10
  const pillar = (x, z) => ((z === 7 || z === 21) && [-7, -3, 3, 7].includes(x)) || (Math.abs(x) === 7 && [7, 11, 14, 18, 21].includes(z)) ||
    (z === 7 && Math.abs(x) === 2)
  const nearPillar = (x, z) => pillar(x, z) || pillar(x - 1, z) || pillar(x + 1, z) || pillar(x, z - 1) || pillar(x, z + 1)
  for (let y = 1; y <= 10; y++) {
    ring(-7, 7, 7, 21, (x, z) => {
      if (pillar(x, z)) { p.push({ x, y, z, block: 'purpur_pillar' }); return }
      const band = y === 5 || y === 10
      const window = !band && !nearPillar(x, z) && ([2, 3, 4].includes(y) || [7, 8, 9].includes(y))
      p.push({ x, y, z, block: band ? 'purpur_block' : window ? 'purple_stained_glass' : 'end_stone_bricks', optional: window })
    })
  }
  // portal wejsciowy 3x4 i witrazowa rozeta nad nim
  for (let x = -1; x <= 1; x++) for (let y = 1; y <= 4; y++) p.push({ x, y, z: 7, block: 'air' })
  for (let x = -1; x <= 1; x++) p.push({ x, y: 5, z: 7, block: 'purpur_block' })
  for (const [x, y] of [[0, 6], [-1, 7], [0, 7], [1, 7], [0, 8]]) p.push({ x, y, z: 7, block: 'purple_stained_glass', optional: true })
  // wnetrze
  fill(-6, 6, 8, 20, (x, z) => { for (let y = 1; y <= 9; y++) if (y !== 5) p.push({ x, y, z, block: 'air' }) })
  fill(-6, 6, 8, 20, (x, z) => p.push({ x, y: 5, z, block: 'end_stone_bricks' })) // strop/podloga pietra
  // schody na pietro wzdluz lewej sciany (z podporami pod stopniami) i otwor w stropie nad nimi
  for (let i = 0; i <= 4; i++) {
    for (let y = 1; y < 1 + i; y++) p.push({ x: -6, y, z: 11 + i, block: 'end_stone_bricks' })
    p.push({ x: -6, y: 1 + i, z: 11 + i, block: 'end_stone_brick_stairs', facing: { x: 0, z: 1 } })
  }
  for (let z = 10; z <= 14; z++) p.push({ x: -6, y: 5, z, block: 'air' })
  // dach i balustrada: na kolumnach end rody, miedzy nimi na zmiane murek i polplyty
  fill(-7, 7, 7, 21, (x, z) => p.push({ x, y: 10, z, block: 'end_stone_bricks' }))
  ring(-7, 7, 7, 21, (x, z) => {
    if (pillar(x, z)) p.push({ x, y: 11, z, block: 'end_rod' })
    else p.push({ x, y: 11, z, block: (x + z) % 2 === 0 ? 'end_stone_brick_wall' : 'purpur_slab' })
  })
  // meble i swiatla: parter i pietro
  p.push({ x: -4, y: 1, z: 20, block: 'crafting_table' }, { x: -3, y: 1, z: 20, block: 'furnace' },
    { x: 3, y: 1, z: 20, block: 'chest' }, { x: 4, y: 1, z: 20, block: 'chest' }, { x: 2, y: 6, z: 20, block: 'chest' })
  for (const [x, z] of [[-5, 9], [5, 9], [5, 19], [-5, 19], [0, 14]]) {
    p.push({ x, y: 1, z, block: 'end_rod' })
    p.push({ x, y: 6, z, block: 'end_rod' })
  }
  // 3) wieze narozne i wieza srodkowa z kopula
  for (const [cx, cz] of [[-7, 7], [7, 7], [-7, 21], [7, 21]]) endTower(p, cx, cz, 1, 16, false)
  endTower(p, 0, 14, 11, 23, true)
  // drabina z pietra na dach przy tylnej scianie (z dziura w dachu) i drzwi z dachu do wiezy srodkowej
  for (let y = 6; y <= 10; y++) p.push({ x: 4, y, z: 20, block: 'ladder', attach: { x: 0, z: 1 } })
  p.push({ x: 4, y: 11, z: 20, block: 'air' })
  p.push({ x: 3, y: 11, z: 14, block: 'air' }, { x: 3, y: 12, z: 14, block: 'air' }) // od wschodu - od poludnia wisi drabina
  return replaceInterior(p)
}

// ---------- napisy ----------
// czcionka 3x5 (# = blok), czytana od lewej z miejsca, gdzie stoi bot
const FONT = {
  a: ['###', '#.#', '###', '#.#', '#.#'], b: ['##.', '#.#', '##.', '#.#', '##.'], c: ['###', '#..', '#..', '#..', '###'],
  d: ['##.', '#.#', '#.#', '#.#', '##.'], e: ['###', '#..', '###', '#..', '###'], f: ['###', '#..', '###', '#..', '#..'],
  g: ['###', '#..', '#.#', '#.#', '###'], h: ['#.#', '#.#', '###', '#.#', '#.#'], i: ['###', '.#.', '.#.', '.#.', '###'],
  j: ['..#', '..#', '..#', '#.#', '###'], k: ['#.#', '##.', '#..', '##.', '#.#'], l: ['#..', '#..', '#..', '#..', '###'],
  m: ['#.#', '###', '###', '#.#', '#.#'], n: ['##.', '#.#', '#.#', '#.#', '#.#'], o: ['###', '#.#', '#.#', '#.#', '###'],
  p: ['###', '#.#', '###', '#..', '#..'], q: ['###', '#.#', '#.#', '###', '..#'], r: ['##.', '#.#', '##.', '#.#', '#.#'],
  s: ['###', '#..', '###', '..#', '###'], t: ['###', '.#.', '.#.', '.#.', '.#.'], u: ['#.#', '#.#', '#.#', '#.#', '###'],
  v: ['#.#', '#.#', '#.#', '#.#', '.#.'], w: ['#.#', '#.#', '###', '###', '#.#'], x: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  y: ['#.#', '#.#', '###', '.#.', '.#.'], z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '###', '..#', '###'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '..#', '..#', '..#'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'], ' ': ['...', '...', '...', '...', '...'], '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['###', '..#', '.##', '...', '.#.'], '.': ['...', '...', '...', '...', '.#.'], ',': ['...', '...', '...', '.#.', '#..'],
  '-': ['...', '...', '###', '...', '...'], ':': ['...', '.#.', '...', '.#.', '...'], '+': ['...', '.#.', '###', '.#.', '...'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'], '>': ['#..', '.#.', '..#', '.#.', '#..']
}

// napis stojacy pionowo przed botem; wiszace piksele (kropka, czesci X) dostaja tymczasowe podpory z ziemi
function planText(text, block) {
  const chars = [...stripPl(text)].map(ch => FONT[ch] ? ch : ' ')
  const width = chars.length * 4 - 1
  const left = -Math.floor(width / 2)
  const pixels = new Set()
  chars.forEach((ch, i) => FONT[ch].forEach((row, r) => [...row].forEach((px, col) => {
    if (px === '#') pixels.add(`${left + i * 4 + col},${4 - r}`)
  })))
  // podparte = stoja na ziemi albo dotykaja (gora/dol/bok) podpartego piksela
  const supported = new Set([...pixels].filter(k => k.endsWith(',0')))
  for (let changed = true; changed;) {
    changed = false
    for (const k of pixels) {
      if (supported.has(k)) continue
      const [x, y] = k.split(',').map(Number)
      if ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => supported.has(`${a},${b}`))) { supported.add(k); changed = true }
    }
  }
  const p = []
  for (const k of pixels) { const [x, y] = k.split(',').map(Number); p.push({ x, y, z: 0, block }) }
  for (const k of pixels) {
    if (supported.has(k)) continue
    const [x, y] = k.split(',').map(Number)
    for (let yy = y - 1; yy >= 0 && !pixels.has(`${x},${yy}`); yy--) p.push({ x, y: yy, z: 0, block: 'dirt', temp: true })
  }
  return replaceInterior(p)
}

// ---------- wystroj wnetrz ----------
// Zapamietane budowle (typ, punkt startu, kierunek) - zeby "wystroj zamek" wiedzial, gdzie zamek stoi i jak jest obrocony.
const builds = loadJson('builds.json', [])
function recordBuild(type, origin, front) {
  builds.push({ type, origin: { x: origin.x, y: origin.y, z: origin.z }, front, dim: bot.game?.dimension, at: Date.now() })
  saveJson('builds.json', builds)
  forgetBuiltCache()
}

// typy budowli: rozpoznanie z tekstu i odleglosc poczatku planu przed botem
const BUILD_TYPES = [
  { type: 'dom villagera', re: /^(dom vil|dom wies|chat|chalupa)/, ahead: 3 },
  { type: 'baza podziemna', re: /^(baza pod|podziem|bunkier)/, ahead: 1 },
  { type: 'palac endu', re: /^(palac endu|palac z end|endowy palac|palac end|end palac|palac purpur|palac kresu)/, ahead: 4 },
  { type: 'zamczysko', re: /^zamczysk/, ahead: 3 },
  { type: 'palac', re: /^(palac|palacyk)/, ahead: 3 },
  { type: 'zamek', re: /^zam/, ahead: 3 },
  { type: 'dom', re: /^(dom|baz|chat)/, ahead: 3 }
]
const matchBuildType = t => {
  const d = findDesign(t)
  if (d) return { type: d.key, ahead: d.ahead || 3, design: true }
  return BUILD_TYPES.find(b => b.re.test(t))
}

// Pokoj: wnetrze x1..x2, z1..z2 (lokalnie), podloga na wysokosci y, h blokow wysokosci (strop na y+h).
// Wejscie od strony z1. keep: komorki "x,z", ktorych nie zastawiamy (schody, przejscia, istniejace meble).
// theme: 'wood' (drewno, czerwony dywan, latarnie) albo 'end' (purpur, fiolet, end rody).
function decorateRoom(p, room) {
  const { x1, x2, z1, z2, y, h, theme = 'wood', keep = [], library = false, bed = true } = room
  const free = new Set(keep)
  const used = new Set()
  const put = (x, yy, z, block, extra = {}) => {
    const k = `${x},${z}`
    if (yy === y && (free.has(k) || used.has(k))) return false
    if (yy === y) used.add(k)
    p.push({ x, y: yy, z, block, ...extra })
    return true
  }
  const end = theme === 'end'
  const cx = Math.round((x1 + x2) / 2)
  // wolne przejscie od wejscia do srodka
  for (let z = z1; z <= z1 + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) free.add(`${x},${z}`)

  // 1) oswietlenie: latarnie (w Endzie end rody) zwisajace ze stropu, co 4 bloki
  for (let x = x1 + 1; x <= x2 - 1; x += 4) {
    for (let z = z1 + 1; z <= z2 - 1; z += 4) {
      p.push({ x, y: y + h - 1, z, block: end ? 'end_rod' : 'lantern', attach: { x: 0, y: 1, z: 0 } })
    }
  }
  // 2) srodek: stol z dwoma krzeslami (krzesla przed stolem - bot stawia je, stojac w miejscu stolu)
  const tz = Math.round((z1 + z2) / 2)
  const chair = end ? 'purpur_stairs' : 'oak_stairs'
  if (x2 - x1 >= 4 && z2 - z1 >= 4 && ![cx - 1, cx, cx + 1].some(x => free.has(`${x},${tz}`))) {
    put(cx - 1, y, tz, chair, { facing: { x: -1, z: 0 } })
    put(cx + 1, y, tz, chair, { facing: { x: 1, z: 0 } })
    if (put(cx, y, tz, end ? 'end_stone_brick_wall' : 'oak_fence')) p.push({ x: cx, y: y + 1, z: tz, block: end ? 'purpur_slab' : 'oak_pressure_plate' })
  }
  // 3) przy prawej scianie: stol warsztatowy, piec, wedzarnia, skrzynie
  const utilities = ['crafting_table', 'furnace', 'smoker', 'chest', 'barrel']
  let zz = z1 + 2
  for (const u of utilities) { if (zz > z2 - 1) break; put(x2, y, zz, u); zz++ }
  // 4) przy lewej scianie: lozko (wezglowie przy scianie) i obok szafka z ksiazkami
  if (bed && z2 - z1 >= 3) {
    const bz = z2 - 1
    if (!free.has(`${x1},${bz}`) && !free.has(`${x1 + 1},${bz}`)) {
      used.add(`${x1},${bz}`) // wezglowie lozka
      put(x1 + 1, y, bz, end ? 'purple_bed' : 'red_bed', { facing: { x: -1, z: 0 } })
    }
  }
  // 5) tylna sciana: regaly z ksiazkami (2 wysokie, gdy pokoj jest wysoki), z przerwa na srodku
  if (h >= 3) {
    for (let x = x1; x <= x2; x++) {
      if (Math.abs(x - cx) <= 1) continue
      if (put(x, y, z2, 'bookshelf', { optional: true }) && h >= 4) p.push({ x, y: y + 1, z: z2, block: 'bookshelf', optional: true })
    }
  }
  // 6) biblioteka: stol do zaklinania na srodku tylnej czesci
  if (library) put(cx, y, z2 - 2, 'enchanting_table', { optional: true })
  // 7) dywan na srodku podlogi (ozdoba); w Endzie fioletowy z biala obwodka i rozowym wzorem w romby
  const [cx1, cx2, cz1, cz2] = [x1 + 2, x2 - 2, z1 + 2, z2 - 2]
  const ccx = Math.round((cx1 + cx2) / 2)
  const ccz = Math.round((cz1 + cz2) / 2)
  for (let x = cx1; x <= cx2; x++) {
    for (let z = cz1; z <= cz2; z++) {
      let carpet = end ? 'purple_carpet' : 'red_carpet'
      if (end && (x === cx1 || x === cx2 || z === cz1 || z === cz2)) carpet = 'white_carpet'
      else if (end && (Math.abs(x - ccx) + Math.abs(z - ccz)) % 3 === 0) carpet = 'pink_carpet'
      put(x, y, z, carpet, { optional: true })
    }
  }
  // 8) obrazy na bocznych scianach (na wysokosci oczu)
  if (h >= 3) {
    for (let z = z1 + 2; z <= z2 - 2; z += 3) {
      p.push({ x: x1, y: y + 1, z, block: 'painting', attach: { x: -1, z: 0 }, optional: true })
      p.push({ x: x2, y: y + 1, z: z + 1, block: 'painting', attach: { x: 1, z: 0 }, optional: true })
    }
  }
}

// drabina wzdluz sciany: komorki (x, y0..y1, z) przyczepione do sciany w kierunku attach; holes - otwory do wybicia
function ladder(p, x, z, y0, y1, attach, holes = []) {
  for (let y = y0; y <= y1; y++) p.push({ x, y, z, block: 'ladder', attach })
  for (const [hx, hy, hz] of holes) p.push({ x: hx, y: hy, z: hz, block: 'air' })
}

const PLAN_FOR_TYPE = {
  dom: () => planHouse(), 'dom villagera': () => planVillagerHouse(), zamek: () => planCastle(), zamczysko: () => planBigCastle(),
  palac: () => planPalace(), 'palac endu': () => planEndPalace(), 'baza podziemna': () => planUndergroundRoom()
}

// ---------- wlasne budowle z kreatora (program z oknem zapisuje je jako pliki JSON) ----------
// plik: { key, name, description, plan: [{x,y,z,block,...}], rooms: [...], ahead }
const DESIGNS_DIR = process.env.MC_DESIGNS_DIR || pathLib.join(DATA_DIR, 'projekty')
const designKey = s => stripPl(String(s || '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
function loadDesigns() {
  try {
    return fs.readdirSync(DESIGNS_DIR).filter(n => n.endsWith('.json')).map(n => {
      try { return JSON.parse(fs.readFileSync(pathLib.join(DESIGNS_DIR, n), 'utf8')) } catch { return null }
    }).filter(d => d && d.key && Array.isArray(d.plan))
  } catch { return [] }
}
const designOf = type => loadDesigns().find(d => d.key === type) || null
// "buduj wieza maga" - projekt o najdluzszej pasujacej nazwie
function findDesign(text) {
  const t = designKey(text)
  return loadDesigns().filter(d => t === d.key || t.startsWith(d.key + ' ')).sort((a, b) => b.key.length - a.key.length)[0] || null
}
// plan budowli: wbudowanej albo z kreatora
function planOf(type) {
  if (PLAN_FOR_TYPE[type]) return PLAN_FOR_TYPE[type]()
  const d = designOf(type)
  return d ? d.plan.map(c => ({ ...c })) : null
}
function typeInfo(type) {
  const bt = BUILD_TYPES.find(b => b.type === type)
  if (bt) return bt
  const d = designOf(type)
  return d ? { type: d.key, ahead: d.ahead || 3, design: true } : null
}
function designsCommand() {
  const list = loadDesigns()
  if (!list.length) { say('Nie mam jeszcze wlasnych projektow. Zrob je w programie (zakladka Kreator).'); return }
  say('Moje projekty: ' + list.map(d => `${d.name} (${d.plan.filter(c => c.block !== 'air').length} blokow)`).join(', ') + '. Napisz "buduj <nazwa>".')
}

function decorPlan(type) {
  const p = []
  if (type === 'dom') {
    decorateRoom(p, { x1: -2, x2: 2, z1: 1, z2: 5, y: 0, h: 4, keep: ['-2,5', '2,5', '-2,3', '2,1'] })
  } else if (type === 'dom villagera') {
    p.push({ x: 0, y: 2, z: 2, block: 'lantern', attach: { x: 0, y: 1, z: 0 } })
    p.push({ x: -1, y: 0, z: 3, block: 'crafting_table' }, { x: -1, y: 0, z: 2, block: 'chest' }, { x: 1, y: 0, z: 2, block: 'barrel' })
    p.push({ x: 1, y: 2, z: 2, block: 'painting', attach: { x: 1, z: 0 }, optional: true })
  } else if (type === 'zamek') {
    // drabiny na mury (tam, gdzie na gorze nie ma blanki) i na kazda wieze
    ladder(p, -5, 5, 0, 4, { x: -1, z: 0 })
    ladder(p, 5, 5, 0, 4, { x: 1, z: 0 })
    ladder(p, 1, 11, 0, 4, { x: 0, z: 1 })
    for (const [x, z, a] of [[-5, 3, -1], [5, 3, -1], [-5, 9, 1], [5, 9, 1]]) ladder(p, x, z, 0, 7, { x: 0, z: a })
    // latarnie na slupkach na dziedzincu
    for (const [x, z] of [[-3, 4], [3, 4], [-3, 8], [3, 8]]) {
      p.push({ x, y: 0, z, block: 'oak_fence' }, { x, y: 1, z, block: 'oak_fence' }, { x, y: 2, z, block: 'lantern' })
    }
    p.push({ x: -4, y: 0, z: 9, block: 'furnace' }, { x: 4, y: 0, z: 9, block: 'barrel' })
  } else if (type === 'zamczysko') {
    ladder(p, -9, 9, 0, 6, { x: -1, z: 0 })
    ladder(p, 9, 9, 0, 6, { x: 1, z: 0 })
    ladder(p, 1, 19, 0, 6, { x: 0, z: 1 })
    // wieze: drzwi od dziedzinca i drabina w srodku
    for (const [cx, cz] of [[-10, 0], [10, 0], [-10, 20], [10, 20]]) {
      const dx = cx < 0 ? 1 : -1
      const dz = cz === 0 ? 1 : -1
      p.push({ x: cx + 2 * dx, y: 0, z: cz + dz, block: 'air' }, { x: cx + 2 * dx, y: 1, z: cz + dz, block: 'air' })
      ladder(p, cx, cz - dz, 0, 11, { x: 0, z: -dz })
    }
    // donzon: pokoj na parterze i drabina na dach (z otworem)
    decorateRoom(p, { x1: -2, x2: 2, z1: 12, z2: 16, y: 0, h: 5, keep: ['-2,16', '2,16', '-2,13', '0,14', '2,13'] })
    ladder(p, 2, 15, 0, 13, { x: 1, z: 0 }, [[2, 14, 15]])
    for (const [x, z] of [[-6, 5], [6, 5], [-6, 15], [6, 15]]) {
      p.push({ x, y: 0, z, block: 'cobblestone_wall' }, { x, y: 1, z, block: 'cobblestone_wall' }, { x, y: 2, z, block: 'lantern' })
    }
  } else if (type === 'palac') {
    decorateRoom(p, { x1: -6, x2: 6, z1: 3, z2: 11, y: 0, h: 8, keep: ['-5,10', '5,10', '-5,4', '5,4', '-5,9', '5,9', '1,11', '1,10'] })
    ladder(p, 1, 11, 0, 7, { x: 0, z: 1 }, [[1, 8, 11]]) // na dach, przy kolumnie z pni
    for (const [cx, cz] of [[-7, 2], [7, 2], [-7, 12], [7, 12]]) ladder(p, cx - 1, cz - 1, 0, 14, { x: -1, z: 0 }, [[cx - 1, 14, cz - 1], [cx - 1, 15, cz - 1]])
    p.push({ x: 2, y: 9, z: 7, block: 'air' }, { x: 2, y: 10, z: 7, block: 'air' }) // drzwi z dachu do wiezy srodkowej
    ladder(p, -1, 6, 9, 16, { x: -1, z: 0 }, [[-1, 16, 6], [-1, 17, 6]])
  } else if (type === 'palac endu') {
    // parter (schody na pietro przy lewej scianie, meble z planu) i pietro z biblioteka
    decorateRoom(p, {
      x1: -6, x2: 6, z1: 8, z2: 20, y: 1, h: 4, theme: 'end',
      keep: ['-6,11', '-6,12', '-6,13', '-6,14', '-6,15', '-6,10', '-5,11', '-5,12', '-5,13', '-5,14', '-5,15', '-4,20', '-3,20', '3,20', '4,20', '-5,9', '5,9', '5,19', '-5,19', '0,14']
    })
    decorateRoom(p, {
      x1: -6, x2: 6, z1: 8, z2: 20, y: 6, h: 4, theme: 'end', library: true, bed: false,
      keep: ['-6,10', '-6,11', '-6,12', '-6,13', '-6,14', '-6,15', '-5,15', '-5,16', '4,20', '4,19', '2,20', '-5,9', '5,9', '5,19', '-5,19', '0,14']
    })
    // drabiny jak w nowym planie (dla palacow zbudowanych wczesniej)
    for (const [cx, cz] of [[-7, 7], [7, 7], [-7, 21], [7, 21]]) ladder(p, cx, cz - 1, 1, 16, { x: 0, z: -1 }, [[cx, 17, cz - 1]])
    ladder(p, 4, 20, 6, 10, { x: 0, z: 1 }, [[4, 11, 20]])
    p.push({ x: 3, y: 11, z: 14, block: 'air' }, { x: 3, y: 12, z: 14, block: 'air' })
    ladder(p, 0, 12, 11, 23, { x: 0, z: -1 }, [[0, 24, 12]])
  } else if (type === 'baza podziemna') {
    decorateRoom(p, { x1: -3, x2: 3, z1: 0, z2: 6, y: 0, h: 3, keep: ['-3,6', '3,6', '-3,3', '-2,1', '2,1', '-2,5', '2,5'] })
  } else if (designOf(type)?.rooms?.length) {
    // projekt z kreatora: pokoje zapisane przez kreator (pietra domu, wnetrza wiez)
    for (const r of designOf(type).rooms) decorateRoom(p, r)
  } else {
    return null
  }
  return replaceInterior(p)
}

// Punkty, na ktorych mozna stanac botem, zeby rozpoznal stara budowle (lokalnie: x, y stop, z).
// Palac endu: na samym szczycie srodkowej iglicy - najwyzszy end rod jest na y=30, wiec stopy bota na y=31.
const ANCHORS = { 'palac endu': { x: 0, y: 31, z: 14, where: 'na samym szczycie srodkowej iglicy (na najwyzszym end rodzie)' } }
const FRONTS = [{ x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: -1, z: 0 }]

// Szuka budowli wokol bota: probuje 4 obrotow i dwoch punktow startu (bot stoi tam, gdzie zaczynal budowe,
// albo na punkcie zaczepienia z ANCHORS) i sprawdza, jaka czesc blokow planu naprawde stoi w swiecie.
function locateBuild(type) {
  const bt = typeInfo(type)
  const solid = planOf(type).filter(c => c.block !== 'air' && !c.optional)
  const step = Math.max(1, Math.floor(solid.length / 300))
  const sample = solid.filter((c, i) => i % step === 0)
  const feet = bot.entity.position.floored()
  const anchor = ANCHORS[type]
  let best = null
  for (const front of FRONTS) {
    const origins = [feet.offset(front.x * bt.ahead, 0, front.z * bt.ahead)]
    if (anchor) {
      const off = toWorld(new Vec3(0, 0, 0), front, anchor.x, anchor.y, anchor.z)
      origins.push(feet.offset(-off.x, -off.y, -off.z))
    }
    for (const origin of origins) {
      let hits = 0
      for (const c of sample) {
        const blk = bot.blockAt(toWorld(origin, front, c.x, c.y, c.z))
        if (blk && sameKind(blk.name, c.block)) hits++
      }
      const score = hits / sample.length
      if (!best || score > best.score) best = { origin, front, score }
    }
  }
  return best
}

// plan budowy razem z wystrojem: bot urzadza wnetrze od razu przy budowie (meble, oswietlenie, drabiny, dywany, obrazy).
// Meble sa ozdobami (bot pyta, czy po nie isc); lampy wiszace pod stropem i obrazy stawia na koniec, gdy stoja juz stropy i sciany.
function planWithDecor(type, plan) {
  const decor = (decorPlan(type) || []).map(c => c.block === 'air' || c.block === 'ladder'
    ? c
    : { ...c, optional: true, late: (c.attach && c.attach.y > 0) || c.block === 'painting' || undefined })
  return replaceInterior([...plan, ...decor])
}

// gdzie stoi budowla: z pamieci (builds.json), a gdy jej nie ma albo "tutaj" - rozpoznana z miejsca, w ktorym stoi bot
function whereIsBuild(bt, here, verb) {
  const rec = !here && [...builds].reverse().find(r => r.type === bt.type && (!r.dim || !bot.game?.dimension || r.dim === bot.game.dimension))
  if (rec) return { origin: new Vec3(rec.origin.x, rec.origin.y, rec.origin.z), front: rec.front }
  // budowla nieznana (np. z wczesniejszej wersji) - rozpoznajemy ja z miejsca, w ktorym stoi bot
  const found = locateBuild(bt.type)
  if (!found || found.score < 0.6) {
    const anchor = ANCHORS[bt.type]
    say(`Nie rozpoznaje tu: ${bt.type}. Postaw mnie na czerwonym znaczniku (tam, gdzie zaczynalem budowe)${anchor ? ' albo ' + anchor.where : ''} i napisz "${verb} ${bt.type}".`)
    return null
  }
  say(`Rozpoznalem ${bt.type} (zgodnosc ${Math.round(found.score * 100)}%).`)
  recordBuild(bt.type, found.origin, found.front) // nastepnym razem juz bedzie wiadomo
  return { origin: found.origin, front: found.front }
}

// "zburz <budowla>" / "usun budowle <budowla>": rozbiera wszystko, co nalezy do budowli (plan + wystroj),
// od gory; nie rusza terenu dookola. Najpierw pyta, czy na pewno.
// rozbiera bloki budowli (plan + wystroj) od gory; part 'right' - tylko prawa polowa (pomocnik)
async function demolishCells(type, loc, part) {
  const cells = [...planOf(type), ...(decorPlan(type) || [])].filter(c => c.block !== 'air' && (part !== 'right' || c.x >= 0))
  const targets = new Map()
  for (const c of cells) {
    const pos = toWorld(loc.origin, loc.front, c.x, c.y, c.z)
    const blk = bot.blockAt(pos)
    // tylko to, co pasuje do planu (np. bruk w miejscu muru) - trawy i ziemi dookola nie ruszamy
    if (blk && blk.name !== 'air' && (sameKind(blk.name, c.block) || /_(bed|door)$/.test(blk.name))) targets.set(posKey(pos), pos)
  }
  const list = [...targets.values()].sort((x, y) => y.y - x.y)
  say(`Burze ${type}${part ? ' (polowa)' : ''}: ${list.length} blokow.`)
  let removed = 0
  for (const p of list) {
    if (!running) break
    setStatus(`burze ${type}: ${removed}/${list.length}`)
    const blk = bot.blockAt(p)
    if (!blk || blk.name === 'air' || !bot.canDigBlock(blk)) continue
    try {
      await goNearCell(p)
      try { await bot.tool.equipForBlock(blk, {}) } catch {}
      await bot.dig(blk, true)
      removed++
    } catch (e) { console.log('[bot] burzenie:', e.message) }
  }
  return removed
}

// ---------- "usun obszar <rog> <rog>": wykopuje wszystko w prostopadloscianie miedzy dwoma rogami ----------
// Rog: x y z, nick gracza (jego pozycja), "tu"/"mnie" (gracz, ktory pisze), "bot" (pozycja bota).
function parseAreaPoint(tok, i, user) {
  const num = k => tok[k] !== undefined && /^-?\d+$/.test(tok[k])
  if (num(i) && num(i + 1) && num(i + 2)) return { pos: new Vec3(+tok[i], +tok[i + 1], +tok[i + 2]), next: i + 3 }
  const t = tok[i]
  if (!t) return { error: 'brakuje rogu' }
  const playerAt = name => Object.values(bot.players).find(p => p.username.toLowerCase() === String(name).toLowerCase())
  if (/^(tu|tutaj|mnie|ja)$/.test(t)) {
    const p = playerAt(user || process.env.MC_PLAYER || '')
    return p?.entity ? { pos: p.entity.position.floored(), next: i + 1 } : { error: 'nie widze Cie - podaj wspolrzedne x y z' }
  }
  if (/^(bot|siebie|ty)$/.test(t)) return { pos: bot.entity.position.floored(), next: i + 1 }
  const p = playerAt(t)
  if (!p) return { error: `nie rozumiem "${t}" (podaj x y z albo nick gracza)` }
  if (!p.entity) return { error: `nie widze gracza ${p.username} - musi byc blisko bota` }
  return { pos: p.entity.position.floored(), next: i + 1 }
}

function areaClearCommand(user, text) {
  const usage = 'Uzycie: usun obszar <x y z | nick | tu> <x y z | nick | tu>, np. usun obszar 10 64 10 30 80 30'
  const tok = stripPl(text).toLowerCase().trim().split(/\s+/).filter(Boolean)
  const a = parseAreaPoint(tok, 0, user)
  if (a.error) { say(`${usage} (${a.error}).`); return }
  const b = parseAreaPoint(tok, a.next, user)
  if (b.error) { say(`${usage} (${b.error}).`); return }
  const min = new Vec3(Math.min(a.pos.x, b.pos.x), Math.min(a.pos.y, b.pos.y), Math.min(a.pos.z, b.pos.z))
  const max = new Vec3(Math.max(a.pos.x, b.pos.x), Math.max(a.pos.y, b.pos.y), Math.max(a.pos.z, b.pos.z))
  const dims = `${max.x - min.x + 1}x${max.y - min.y + 1}x${max.z - min.z + 1}`
  const volume = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1)
  if (volume > 250000) { say(`Za duzy obszar (${dims} = ${volume} pol) - najwyzej 250 000, np. 50x100x50.`); return }
  const inArea = p => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z
  return task(`usuwanie obszaru ${dims}`, async () => {
    // co jest do wykopania: od gory (piasek i zwir nie spadaja), wszystko poza powietrzem, ciecza i blokami nie do zniszczenia
    const list = []
    for (let y = max.y; y >= min.y; y--) {
      for (let x = min.x; x <= max.x; x++) {
        for (let z = min.z; z <= max.z; z++) {
          const blk = bot.blockAt(new Vec3(x, y, z))
          if (!blk || /^(air|cave_air|void_air)$|water|lava|bubble_column/.test(blk.name) || !blk.diggable) continue
          list.push(blk.position)
        }
      }
    }
    if (!list.length) { say(`W obszarze ${dims} nie ma nic do usuniecia (albo jest za daleko i bot go nie widzi).`); return }
    const answer = await askUser(`Usunac obszar ${dims} od ${min.x} ${min.y} ${min.z} do ${max.x} ${max.y} ${max.z}? To ${list.length} blokow. (tak / nie)`,
      [[/^(tak|usun|dawaj|ok|na pewno)$/, 'yes'], [/^(nie|stop|zostaw)$/, 'no']], 60000, 'no', 'Brak odpowiedzi - nic nie usuwam.')
    if (answer !== 'yes' || !running) { if (running) say('Dobra, nic nie usuwam.'); return }
    // pathfinder kopie tylko w obszarze (budowle i teren dookola zostaja); rusztowania z ziemi
    const moves = protectBuilds(new Movements(bot))
    moves.canDig = true
    moves.allow1by1towers = !isCreative()
    const dirtId = mcData.itemsByName.dirt?.id
    if (dirtId !== undefined) moves.scafoldingBlocks = isCreative() ? [] : [dirtId]
    moves.exclusionAreasBreak.push(blk => inArea(blk.position) ? 0 : 1000)
    const normal = bot.pathfinder.movements
    bot.pathfinder.setMovements(moves)
    let removed = 0
    currentBuild = { label: `usuwanie obszaru ${dims}`, total: list.length, phase: 'budowa', startedAt: Date.now(), basePlaced: 0, get placed() { return removed } }
    say(`Usuwam ${list.length} blokow (${dims}). "czas" powie, ile zostalo.`)
    try {
      for (const p of list) {
        if (!running) break
        const blk = bot.blockAt(p)
        if (!blk || /^(air|cave_air|void_air)$|water|lava/.test(blk.name)) { removed++; continue } // juz zniknal
        setStatus(`usuwam obszar ${dims}: ${removed}/${list.length}`)
        try {
          await goNearCell(p)
          const now = bot.blockAt(p)
          if (now && now.diggable && !/^(air|cave_air|void_air)$/.test(now.name)) {
            try { await bot.tool.equipForBlock(now, {}) } catch {}
            await bot.dig(now, true)
          }
          removed++
        } catch (e) { console.log('[bot] obszar:', e.message) }
      }
      if (!running) return
      // slupki z ziemi, ktore bot postawil, zeby dosiegnac wysoko - tez znikaja
      const dirtLeft = floatingDirt(min.x, max.x, min.z, max.z, min.y, max.y + 3)
      if (dirtLeft.length) await removeBlocksCarefully(dirtLeft)
      say(`Obszar ${dims} wyczyszczony: usunalem ${removed} z ${list.length} blokow.`)
    } finally {
      bot.pathfinder.setMovements(normal)
      currentBuild = null
    }
  })
}

function demolishCommand(text) {
  const t = stripPl(text).trim().replace(/^budowl\w*\s*/, '')
  const here = /\btutaj|\btu$/.test(t)
  const bt = matchBuildType(t.replace(/\s*\b(tutaj|tu)$/, ''))
  if (!bt) { say('Co zburzyc? dom, dom villagera, zamek, zamczysko, palac, palac endu, baza podziemna'); return }
  const loc = whereIsBuild(bt, here, 'zburz')
  if (!loc) return
  return task(`burzenie: ${bt.type}`, async () => {
    const answer = await askUser(`Na pewno zburzyc ${bt.type}? Wszystko z niego zniknie. (tak / nie)`,
      [[/^(tak|zburz|dawaj|na pewno)$/, 'yes'], [/^(nie|stop|zostaw)$/, 'no']], 60000, 'no', 'Brak odpowiedzi - nic nie burze.')
    if (answer !== 'yes' || !running) { if (running) say('Dobra, zostawiam.'); return }
    currentJob = { kind: 'demolish', type: bt.type, label: bt.type, origin: { x: loc.origin.x, y: loc.origin.y, z: loc.origin.z }, front: loc.front }
    askForHelp(currentJob)
    const removed = await demolishCells(bt.type, loc)
    if (running) {
      say(`Zburzylem ${bt.type} (${removed} blokow).`)
      for (let i = builds.length - 1; i >= 0; i--) if (builds[i].type === bt.type && builds[i].origin.x === loc.origin.x && builds[i].origin.z === loc.origin.z) builds.splice(i, 1)
      saveJson('builds.json', builds)
      forgetBuiltCache()
    }
  })
}

// ---------- slup do nieba ----------
async function pillarUp(targetY) {
  const block = () => bot.inventory.items().find(i => SCAFFOLD.includes(i.name))
  let stuck = 0
  while (running && bot.entity.position.y < targetY && stuck < 5) {
    const it = block()
    if (!it) { say('Skonczyly mi sie bloki na slup.'); return false }
    const feet = bot.entity.position.floored()
    // nad glowa musi byc wolne
    if (isSolid(feet.offset(0, 2, 0))) { try { await clearBlock(feet.offset(0, 2, 0)) } catch {} }
    await bot.equip(it, 'hand')
    await bot.look(bot.entity.yaw, -Math.PI / 2, true)
    bot.setControlState('jump', true)
    for (let t = 0; t < 20 && bot.entity.position.y < feet.y + 1; t++) await sleep(50)
    try { await bot.placeBlock(bot.blockAt(feet.offset(0, -1, 0)), new Vec3(0, 1, 0)) } catch {}
    bot.setControlState('jump', false)
    await sleep(300)
    stuck = bot.entity.position.floored().y > feet.y ? 0 : stuck + 1
    setStatus(`buduje slup do nieba: y=${Math.floor(bot.entity.position.y)}/${targetY}`)
  }
  return bot.entity.position.y >= targetY
}

// ---------- farmy ----------
const CROPS = [
  [/^(zbo|psze|zyt)/, 'wheat_seeds', 'zboze'], [/^marchew/, 'carrot', 'marchew'], [/^ziemniak/, 'potato', 'ziemniaki'], [/^burak/, 'beetroot_seeds', 'buraki']
]

// wiadro wody: robi wiadro (3 zelaza) i nabiera wode ze zrodla w promieniu 64 blokow
async function getWaterBucket() {
  if (has('water_bucket')) return true
  if (isCreative()) return await creativeGive('water_bucket', 1) // w kreatywnym wiadro wody prosto z menu
  if (!await obtain('bucket', 1)) return false
  const source = bot.findBlock({ matching: b => b.name === 'water' && Number(b.getProperties().level) === 0, maxDistance: 64 })
  if (!source) { say('Nie widze wody w promieniu 64 blokow, nie mam czym nabrac.'); return false }
  setStatus('nabieram wode do wiadra')
  await goNearCell(source.position.offset(0, 1, 0))
  await bot.equip(bot.inventory.items().find(i => i.name === 'bucket'), 'hand')
  await bot.lookAt(source.position.offset(0.5, 0.5, 0.5), true)
  bot.activateItem()
  await sleep(600)
  return has('water_bucket')
}

// oczko wodne: dziura w ziemi przed botem wypelniona woda z wiadra (pole wokol niej jest nawodnione)
async function makePond() {
  const home = bot.entity.position.floored()
  if (!await getWaterBucket()) return null
  if (bot.entity.position.distanceTo(home) > 3) await bot.pathfinder.goto(new goals.GoalNear(home.x, home.y, home.z, 1))
  const front = facingAxis()
  const hole = bot.entity.position.floored().offset(front.x * 3, -1, front.z * 3) // blok ziemi 3 kroki przed nami
  await clearBlock(hole)
  // wiadro uzywamy wprost na gornej scianie bloku pod dziura (jak klikniecie gracza w dno dolka).
  // Celowanie wzrokiem z daleka zahaczalo o krawedz dolka i woda wylewala sie na trawe obok.
  await goNearCell(hole.offset(0, 1, 0))
  await bot.equip(bot.inventory.items().find(i => i.name === 'water_bucket'), 'hand')
  await bot.activateBlock(bot.blockAt(hole.offset(0, -1, 0)), new Vec3(0, 1, 0))
  await sleep(600)
  const w = bot.blockAt(hole)
  return w && w.name === 'water' ? w : null
}

async function cropFarm(seed, label) {
  let water = bot.findBlock({ matching: mcData.blocksByName.water.id, maxDistance: 16 })
  if (!water) {
    say('Nie ma wody w poblizu - robie oczko wodne (wiadro wody).')
    water = await makePond()
    if (!water) { say('Nie udalo mi sie zrobic oczka wodnego - podejdz ze mna nad wode.'); return }
  }
  if (!bot.inventory.items().some(i => i.name.endsWith('_hoe'))) await obtain('wooden_hoe', 1)
  if (!has(seed)) {
    say(`Nie mam ${seed} - zdobywam.`)
    if (seed === 'wheat_seeds') await collect(['short_grass', 'tall_grass', 'grass'].filter(n => mcData.blocksByName[n]), 16, /^wheat_seeds$/)
    else await obtain(seed, 8)
  }
  if (!has(seed)) { say(`Nie mam czego posadzic (${seed}).`); return }
  // ziemia w zasiegu nawodnienia (4 bloki od wody), na tej samej wysokosci, z powietrzem nad soba
  const spots = bot.findBlocks({
    matching: ['dirt', 'grass_block', 'farmland'].map(n => mcData.blocksByName[n].id),
    maxDistance: 12,
    count: 200
  }).filter(p => Math.abs(p.x - water.position.x) <= 4 && Math.abs(p.z - water.position.z) <= 4 && p.y === water.position.y &&
    bot.blockAt(p.offset(0, 1, 0))?.name === 'air')
  let planted = 0
  for (const p of spots) {
    if (!running || !has(seed)) break
    setStatus(`sadze ${label}: ${planted} posadzonych`)
    try {
      await goNearCell(p.offset(0, 1, 0))
      if (bot.blockAt(p).name !== 'farmland') {
        const hoe = bot.inventory.items().find(i => i.name.endsWith('_hoe'))
        if (!hoe) break
        await bot.equip(hoe, 'hand')
        await bot.activateBlock(bot.blockAt(p))
        await sleep(250)
      }
      if (bot.blockAt(p).name !== 'farmland') continue
      await bot.equip(bot.inventory.items().find(i => i.name === seed), 'hand')
      await bot.placeBlock(bot.blockAt(p), new Vec3(0, 1, 0)).catch(() => {})
      await sleep(200)
      if (bot.blockAt(p.offset(0, 1, 0))?.name !== 'air') planted++
    } catch (e) { console.log('[bot] farma:', e.message) }
  }
  say(planted ? `Farma (${label}) gotowa: posadzilem ${planted}.` : 'Nie udalo mi sie nic posadzic (brak ziemi przy wodzie?).')
}

async function treeFarm() {
  if (!bot.inventory.items().some(i => i.name.endsWith('_sapling'))) {
    say('Nie mam sadzonek - zbieram je z lisci.')
    const leaves = mcData.blocksArray.map(b => b.name).filter(n => n.endsWith('_leaves'))
    await collect(leaves, 6, /_sapling$/)
  }
  const front = facingAxis()
  const origin = bot.entity.position.floored().offset(front.x * 3, 0, front.z * 3)
  let planted = 0
  for (const [x, z] of [[-4, 0], [0, 0], [4, 0], [-4, 4], [0, 4], [4, 4], [-4, 8], [0, 8], [4, 8]]) {
    const sap = bot.inventory.items().find(i => i.name.endsWith('_sapling'))
    if (!running || !sap) break
    const top = toWorld(origin, front, x, 0, z)
    // ziemia pod sadzonka: szukamy powierzchni w kolumnie
    let ground = null
    for (let dy = 3; dy >= -3; dy--) {
      const b = bot.blockAt(top.offset(0, dy, 0))
      if (b && ['dirt', 'grass_block', 'podzol', 'coarse_dirt'].includes(b.name) && bot.blockAt(top.offset(0, dy + 1, 0))?.name === 'air') { ground = b; break }
    }
    if (!ground) continue
    setStatus(`sadze drzewa: ${planted} posadzonych`)
    try {
      await goNearCell(ground.position.offset(0, 1, 0))
      await bot.equip(sap, 'hand')
      await bot.placeBlock(ground, new Vec3(0, 1, 0)).catch(() => {})
      await sleep(200)
      if (bot.blockAt(ground.position.offset(0, 1, 0))?.name.endsWith('_sapling')) planted++
    } catch (e) { console.log('[bot] drzewa:', e.message) }
  }
  say(planted ? `Farma drzew gotowa: posadzilem ${planted} sadzonek.` : 'Nie udalo mi sie posadzic drzew (brak sadzonek albo ziemi).')
}

async function caneFarm() {
  if (!has('sugar_cane')) await obtain('sugar_cane', 4)
  if (!has('sugar_cane')) { say('Nie mam trzciny do posadzenia.'); return }
  const findSpots = () => bot.findBlocks({ matching: ['dirt', 'grass_block', 'sand', 'red_sand'].map(n => mcData.blocksByName[n].id), maxDistance: 16, count: 300 })
    .filter(p => bot.blockAt(p.offset(0, 1, 0))?.name === 'air' &&
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => bot.blockAt(p.offset(dx, 0, dz))?.name === 'water'))
  let spots = findSpots()
  if (!spots.length) {
    // trzcina rosnie tylko tuz przy wodzie - jak jej nie ma, robimy oczko wodne
    say('Nie ma wody w poblizu - robie oczko wodne pod trzcine.')
    if (!await makePond()) { say('Nie udalo mi sie zrobic oczka wodnego.'); return }
    spots = findSpots()
  }
  let planted = 0
  for (const p of spots) {
    const cane = bot.inventory.items().find(i => i.name === 'sugar_cane')
    if (!running || !cane) break
    try {
      await goNearCell(p.offset(0, 1, 0))
      await bot.equip(cane, 'hand')
      await bot.placeBlock(bot.blockAt(p), new Vec3(0, 1, 0)).catch(() => {})
      await sleep(200)
      if (bot.blockAt(p.offset(0, 1, 0))?.name === 'sugar_cane') planted++
    } catch {}
  }
  say(planted ? `Posadzilem ${planted} trzciny.` : 'Nie znalazlem miejsca przy wodzie na trzcine.')
}

// ---------- komenda "buduj" ----------
function buildCommand(text) {
  const t = stripPl(text).trim()
  const front = facingAxis()
  const ahead = n => bot.entity.position.floored().offset(front.x * n, 0, front.z * n)

  // najpierw wlasne projekty z kreatora (nazwa moze zaczynac sie jak wbudowana, np. "domek nad jeziorem")
  const design = findDesign(t)
  if (design) {
    return task(`budowa: ${design.name}`, () => buildPlan(design.name, planWithDecor(design.key, design.plan.map(c => ({ ...c }))), ahead(design.ahead || 3), front, { type: design.key, passes: 6 }))
  }

  if (/^(dom vil|dom wies|chat|chalupa)/.test(t)) return task('budowa domu villagera', () => buildPlan('dom villagera', planWithDecor('dom villagera', planVillagerHouse()), ahead(3), front, { type: 'dom villagera' }))
  if (/^(baza pod|podziem|bunkier)/.test(t)) {
    return task('budowa bazy podziemnej', async () => {
      say('Kopie zejscie do bazy podziemnej.')
      for (let i = 0; i < 8 && running; i++) await stepTo(front, -1)
      await buildPlan('baza podziemna', planWithDecor('baza podziemna', planUndergroundRoom()), bot.entity.position.floored().offset(front.x, 0, front.z), front, { type: 'baza podziemna' })
    })
  }
  if (/^(sky|baza w niebie|niebo|podniebn)/.test(t)) {
    return task('budowa skybase', async () => {
      const targetY = Math.min(300, Math.max(Math.floor(bot.entity.position.y) + 30, 150))
      // wszystko zbieramy na dole - w niebie nie ma skad (slup + platforma + murek + meble)
      const plan = planSkyPlatform()
      const pillar = Array.from({ length: targetY - Math.floor(bot.entity.position.y) + 5 }, () => ({ block: 'cobblestone' }))
      if (!await gatherMaterials([...plan.filter(c => !c.optional), ...pillar], 'skybase')) return
      say(`Buduje slup do y=${targetY}.`)
      if (!await pillarUp(targetY)) return
      await buildPlan('skybase', plan, bot.entity.position.floored(), front, { passes: 8 })
    })
  }
  // napis: "napis: czesc", "napis z desek: czesc"
  const sign = t.match(/^napis(?:\s+z\s+([^:]+?))?\s*:?\s*(.*)$/)
  if (sign) {
    const text = sign[2].trim().slice(0, 30)
    if (!text) { say('Jaki napis? np. "buduj napis: czesc" albo "buduj napis z desek: elo"'); return }
    let block = 'cobblestone'
    if (sign[1]) {
      const re = resolveGive(sign[1])
      const found = mcData.itemsArray.find(i => re.test(i.name) && mcData.blocksByName[i.name] && obtainable(i.name))
      if (!found) { say(`Nie umiem budowac z "${sign[1]}".`); return }
      block = found.name
    }
    return task(`napis "${text}"`, () => buildPlan(`napis "${text}"`, planText(text, block), ahead(3), front))
  }
  if (/^(palac endu|palac z end|endowy palac|palac end|end palac|palac purpur|palac kresu)/.test(t)) {
    return task('budowa palacu endu', async () => {
      if (!isCreative()) say('Uwaga: end stone, purpur i end rody sa tylko w Endzie - w survivalu bede potrzebowal ich w ekwipunku. W kreatywnym wezme je sam.')
      await buildPlan('palac endu', planWithDecor('palac endu', planEndPalace()), ahead(4), front, { passes: 6, type: 'palac endu' })
    })
  }
  if (/^zamczysk/.test(t)) return task('budowa zamczyska', () => buildPlan('zamczysko', planWithDecor('zamczysko', planBigCastle()), ahead(3), front, { type: 'zamczysko' }))
  if (/^(palac|palacyk)/.test(t)) return task('budowa palacu', () => buildPlan('palac', planWithDecor('palac', planPalace()), ahead(3), front, { type: 'palac' }))
  if (/^zam/.test(t)) return task('budowa zamku', () => buildPlan('zamek', planWithDecor('zamek', planCastle()), ahead(3), front, { type: 'zamek' }))
  if (/^farm/.test(t)) {
    const what = t.replace(/^farm\w*\s*/, '')
    const crop = CROPS.find(([re]) => re.test(what))
    if (crop) return task(`farma: ${crop[2]}`, () => cropFarm(crop[1], crop[2]))
    if (/^(drzew|drew|las)/.test(what)) return task('farma drzew', treeFarm)
    if (/^(trzcin|cukr)/.test(what)) return task('farma trzciny', caneFarm)
    if (/^(zwierz|krow|owc|swin|kur|zagrod)/.test(what)) {
      return task('zagroda', async () => {
        await buildPlan('zagroda', planPen(), ahead(2), front)
        if (running) say('Zagroda gotowa. Zwierzeta trzeba do niej zwabic (np. pszenica dla krow i owiec, marchew dla swin).')
      })
    }
    say('Farma czego? farma zboza / marchwi / ziemniakow / burakow / drzew / trzciny / zwierzat')
    return
  }
  if (/^(dom|baz|chat)/.test(t)) return task('budowa domu', () => buildPlan('dom', planWithDecor('dom', planHouse()), ahead(3), front, { type: 'dom' }))
  say('Co zbudowac? dom, zamek, zamczysko, palac, palac endu, dom villagera, baza podziemna, skybase, napis: <tekst>, farma <zboza|marchwi|ziemniakow|burakow|drzew|trzciny|zwierzat>')
}

// ---------- pliki z danymi (punkty, uprawnienia) ----------
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(pathLib.join(DATA_DIR, file), 'utf8')) } catch { return fallback }
}
function saveJson(file, data) {
  try { fs.writeFileSync(pathLib.join(DATA_DIR, file), JSON.stringify(data, null, 2)) } catch (e) { console.log(`[bot] zapis ${file}:`, e.message) }
}

// ---------- chodzenie za graczem i ochrona ----------
// petla w ramach zadania: co pol sekundy odnawia cel, bo instynkt (walka, ucieczka) moze go podmienic
async function stayWithPlayer(username, guard) {
  if (!await reachPlayer(username)) return
  say(guard ? `Pilnuje ${username}. "stop" konczy.` : `Ide za ${username}. "stop" konczy.`)
  let lostSince = 0
  while (running) {
    const ent = bot.players[username]?.entity
    if (!ent) {
      lostSince ||= Date.now()
      if (Date.now() - lostSince > 10000) { say(`Zgubilem ${username}.`); break }
      await sleep(500)
      continue
    }
    lostSince = 0
    if (guard && !bot.pvp.target && mode === 'normal') {
      // wrogie moby blisko gracza (oprocz tych, przed ktorymi zawsze uciekamy)
      const mob = Object.values(bot.entities).find(e => DANGER[e.name] !== undefined && !ALWAYS_FLEE.includes(e.name) &&
        e.position.distanceTo(ent.position) < 10)
      if (mob) { await bestSword(); bot.pvp.attack(mob) }
    }
    const g = bot.pathfinder.goal
    if (mode === 'normal' && !bot.pvp.target && !(g instanceof goals.GoalFollow && g.entity === ent)) {
      bot.pathfinder.setGoal(new goals.GoalFollow(ent, 2), true)
    }
    await sleep(500)
  }
}

function followCommand(user, target, guard) {
  const username = target ? findPlayerName(target) : user
  if (!username) { say(target ? `Nie ma gracza ${target} online.` : 'Komu? np. "chodz za mna" na czacie albo "chodz za Nick".'); return }
  return task(guard ? `ochrona ${username}` : `chodze za ${username}`, () => stayWithPlayer(username, guard))
}

// ---------- punkty (dom, kopalnia, ...) ----------
const waypoints = loadJson('waypoints.json', {})

function saveWaypoint(name) {
  const p = bot.entity.position
  waypoints[name] = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dim: bot.game?.dimension }
  saveJson('waypoints.json', waypoints)
  say(`Zapisalem punkt "${name}": ${waypoints[name].x} ${waypoints[name].y} ${waypoints[name].z}.`)
}

function listWaypoints() {
  const names = Object.keys(waypoints)
  say(names.length ? 'Punkty: ' + names.map(n => `${n} (${waypoints[n].x} ${waypoints[n].y} ${waypoints[n].z})`).join(', ') : 'Nie mam zapisanych punktow. Uzyj "zapisz <nazwa>".')
}

// nazwa punktu w odmianie: "bazy"/"bazie" -> "baza", "domu" -> "dom", "kopalni" -> "kopalnia"
function findWaypoint(name) {
  const cands = [name, name.replace(/(y|e|ie|i)$/, 'a'), name.replace(/(u|em|owi)$/, ''), name.replace(/i$/, 'ia'), name.replace(/(y|e)$/, '')]
  return cands.find(c => waypoints[c]) || null
}

function deleteWaypoint(name) {
  if (!waypoints[name]) { say(`Nie ma punktu "${name}".`); return }
  delete waypoints[name]
  saveJson('waypoints.json', waypoints)
  say(`Usunalem punkt "${name}".`)
}

// "idz do 100 -200", "idz do 100 64 -200", "idz do dom", "idz do Nick"
function goToCommand(args) {
  const nums = args.filter(a => /^-?\d+$/.test(a)).map(Number)
  if (nums.length === 2) return goWithReport(new goals.GoalNearXZ(nums[0], nums[1], 1), `ide do ${nums.join(' ')}`)
  if (nums.length === 3) return goWithReport(new goals.GoalNear(nums[0], nums[1], nums[2], 1), `ide do ${nums.join(' ')}`)
  const name = args.join(' ')
  const wpName = findWaypoint(name)
  const wp = wpName && waypoints[wpName]
  if (wp) {
    if (wp.dim && bot.game?.dimension && wp.dim !== bot.game.dimension) { say(`Punkt "${name}" jest w innym wymiarze (${wp.dim}).`); return }
    return goWithReport(new goals.GoalNear(wp.x, wp.y, wp.z, 1), `ide do ${wpName}`)
  }
  const username = findPlayerName(name)
  if (username) {
    return task(`ide do ${username}`, async () => {
      if (!await reachPlayer(username)) return
      const ent = bot.players[username]?.entity
      if (ent) await walkTo(new goals.GoalNear(ent.position.x, ent.position.y, ent.position.z, 2))
    })
  }
  say('Uzycie: idz do <x> <z> | idz do <x> <y> <z> | idz do <punkt> | idz do <gracz>')
}

function positionText() {
  const p = bot.entity.position
  const block = bot.blockAt(p)
  const biome = block?.biome?.name
  return `Jestem na ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}, wymiar ${bot.game?.dimension || '?'}${biome ? ', biom ' + biome : ''}.`
}

// ---------- ekwipunek: trzymaj, zaloz, wyrzuc ----------
const ARMOR_RE = /_(helmet|chestplate|leggings|boots)$/
const KEEP_RE = /_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots)$|^(shield|bow|crossbow|arrow|torch|crafting_table|furnace)$/
const JUNK_RE = /^(dirt|gravel|rotten_flesh|spider_eye|poisonous_potato|wheat_seeds|granite|diorite|andesite|tuff|netherrack|cobbled_deepslate)$/

function findInventory(word) {
  const re = resolveGive(word)
  return bot.inventory.items().filter(i => re.test(i.name))
}

async function holdCommand(word) {
  const it = findInventory(word)[0]
  if (!it) { say(`Nie mam: ${word}.`); return }
  try { await bot.equip(it, 'hand'); say(`Trzymam ${it.name}.`) } catch (e) { say('Nie moge: ' + e.message) }
}

async function wearArmorCommand() {
  const armor = bot.inventory.items().filter(i => ARMOR_RE.test(i.name))
    .sort((a, b) => (ARMOR_W[b.name.split('_')[0]] || 0) - (ARMOR_W[a.name.split('_')[0]] || 0))
  for (const it of armor) await equipArmor(it.name)
  const worn = [5, 6, 7, 8].map(s => bot.inventory.slots[s]?.name).filter(Boolean)
  say(worn.length ? 'Mam na sobie: ' + worn.join(', ') : 'Nie mam zadnej zbroi.')
}

async function tossCommand(word, amount) {
  const junk = /^smiec/.test(stripPl(word))
  const items = junk ? bot.inventory.items().filter(i => JUNK_RE.test(i.name)) : findInventory(word)
  if (!items.length) { say(junk ? 'Nie mam smieci.' : `Nie mam: ${word}.`); return }
  let left = amount ?? Infinity
  let tossed = 0
  for (const it of items) {
    if (left <= 0) break
    const n = Math.min(it.count, left)
    try { await bot.toss(it.type, null, n) } catch { continue }
    left -= n
    tossed += n
    await sleep(200)
  }
  say(`Wyrzucilem ${tossed} rzeczy.`)
}

// "czy masz <co>" / "ile masz <co>": ile tego ma w ekwipunku (liczac zalozona zbroje i druga reke)
function haveCommand(word) {
  word = word.replace(/\?+$/, '').trim()
  if (!word) { say('Uzycie: czy masz <co>, np. "czy masz diament"'); return }
  const re = resolveGive(word)
  const all = [...bot.inventory.items(), ...[5, 6, 7, 8, 45].map(s => bot.inventory.slots[s]).filter(Boolean)]
  const total = {}
  for (const it of all) if (re.test(it.name)) total[it.name] = (total[it.name] || 0) + it.count
  const names = Object.keys(total)
  if (!names.length) { say(`Nie, nie mam: ${word}.`); return }
  say('Tak: ' + names.map(n => `${n} x${total[n]}`).join(', ') + '.')
}

// ---------- stawianie blokow ----------
// stawia blok w miejscu target (musi byc wolne); klika w sasiedni pelny blok, tak jak gracz
async function placeBlockAt(itemName, target, attach) {
  const here = bot.blockAt(target)
  if (here && here.boundingBox === 'block') throw new Error(`miejsce jest zajete (${here.name})`)
  const sides = attach ? [[attach.x || 0, attach.y || 0, attach.z || 0]] : [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]
  for (const [dx, dy, dz] of sides) {
    const ref = bot.blockAt(target.offset(dx, dy, dz))
    if (!ref || ref.boundingBox !== 'block') continue
    const it = bot.inventory.items().find(i => i.name === itemName)
    if (!it) throw new Error(`nie mam ${itemName}`)
    await bot.equip(it, 'hand')
    try { await bot.placeBlock(ref, new Vec3(-dx, -dy, -dz)) } catch {}
    for (let t = 0; t < 20; t++) { // serwer potwierdza postawienie z opoznieniem
      if (bot.blockAt(target)?.name === itemName) return
      await sleep(100)
    }
    throw new Error('serwer nie przyjal postawienia (za daleko albo cos zaslania)')
  }
  throw new Error('nie ma sie czego zaczepic - blok musi stac obok innego bloku')
}

// "postaw <co>" - przed soba; "postaw <co> <x> <y> <z>" - we wskazanym miejscu
function placeCommand(args) {
  const nums = args.filter(a => /^-?\d+$/.test(a)).map(Number)
  const word = args.filter(a => !/^-?\d+$/.test(a)).join(' ')
  if (!word) { say('Uzycie: postaw <co> albo postaw <co> <x> <y> <z>'); return }
  const re = resolveGive(word)
  const it = bot.inventory.items().find(i => re.test(i.name) && mcData.blocksByName[i.name])
  if (!it) { say(`Nie mam bloku: ${word}.`); return }
  return task(`stawiam ${it.name}`, async () => {
    if (nums.length === 3) {
      const target = new Vec3(nums[0], nums[1], nums[2])
      await goNear(target, 3)
      await placeBlockAt(it.name, target)
      say(`Postawilem ${it.name} na ${nums.join(' ')}.`)
      return
    }
    // przed soba, a jak tam zajete - na ktoryms polu obok
    const feet = bot.entity.position.floored()
    const front = facingAxis()
    const spots = [front, turnRight(front), turnRight(turnRight(front)), turnRight(turnRight(turnRight(front)))]
      .map(d => feet.offset(d.x, 0, d.z))
    for (const target of spots) {
      try {
        await placeBlockAt(it.name, target)
        say(`Postawilem ${it.name} na ${target.x} ${target.y} ${target.z}.`)
        return
      } catch (e) {
        console.log(`[bot] nie stawiam na ${target}: ${e.message}`)
      }
    }
    say(`Nie mam gdzie postawic ${it.name} obok siebie.`)
  })
}

// ---------- skrzynie: schowaj, wez ----------
const CONTAINERS = ['chest', 'trapped_chest', 'barrel']

const containerIds = () => CONTAINERS.map(n => mcData.blocksByName[n]?.id).filter(x => x !== undefined)
const posKey = p => `${p.x},${p.y},${p.z}`

// skrzynie uzywane przez "schowaj"/"wez" sa nasze - automatyczne przeszukiwanie ich nie rusza
const ownChests = new Set(loadJson('chests.json', []))

async function openNearestContainer() {
  const block = bot.findBlock({ matching: containerIds(), maxDistance: 32 })
  if (!block) { say('Nie widze skrzyni w promieniu 32 blokow.'); return null }
  if (!ownChests.has(posKey(block.position))) {
    ownChests.add(posKey(block.position))
    saveJson('chests.json', [...ownChests])
  }
  await goNear(block.position, 2)
  return await bot.openContainer(block)
}

// ---------- przeszukiwanie znalezionych skrzyn ----------
// domyslnie tylko w singleplayerze: na serwerze branie z cudzych skrzyn to kradziez
let lootEnabled = process.env.MC_LOOT ? process.env.MC_LOOT === '1' : process.env.MC_MODE === 'lan'
const lootedChests = new Set()
const GEAR_SCORE = { wooden: 1, leather: 1, golden: 1, stone: 2, chainmail: 2, iron: 3, diamond: 4, netherite: 5 }
const GEAR_RE = /^(\w+?)_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots)$/
const VALUABLE_RE = /^(diamond|emerald|iron_ingot|gold_ingot|netherite_ingot|netherite_scrap|raw_iron|raw_gold|raw_copper|coal|charcoal|golden_apple|enchanted_golden_apple|ender_pearl|torch|obsidian|name_tag|saddle|totem_of_undying|experience_bottle|enchanted_book|lapis_lazuli|redstone|bucket|water_bucket|lava_bucket|shield|bow|crossbow|arrow|golden_carrot)$/

// najlepszy wynik, jaki mamy dla danej czesci (kilof, napiersnik...), liczac ekwipunek i zalozone rzeczy
function bestOwnedScore(part) {
  let best = 0
  const all = [...bot.inventory.items(), ...[5, 6, 7, 8].map(s => bot.inventory.slots[s]).filter(Boolean)]
  for (const it of all) {
    const m = it.name.match(GEAR_RE)
    if (m && m[2] === part) best = Math.max(best, GEAR_SCORE[m[1]] || 0)
  }
  return best
}

function wantedItem(it) {
  const m = it.name.match(GEAR_RE)
  if (m) return (GEAR_SCORE[m[1]] || 0) > bestOwnedScore(m[2]) // tylko lepsze niz to, co mamy
  if (VALUABLE_RE.test(it.name)) return true
  return !!mcData.foodsByName[it.name] && !BAD_FOOD.includes(it.name)
}

async function lootChest(block) {
  lootedChests.add(posKey(block.position))
  setStatus(`przeszukuje ${block.name}`)
  await goNear(block.position, 2)
  const box = await bot.openContainer(block)
  const taken = {} // nazwa -> ile (kilka stackow tego samego laczymy w jeden wpis)
  try {
    for (const it of box.containerItems()) {
      if (!running || bot.inventory.emptySlotCount() === 0) break
      if (!wantedItem(it)) continue
      try { await box.withdraw(it.type, null, it.count); taken[it.name] = (taken[it.name] || 0) + it.count } catch {}
    }
  } finally {
    box.close()
  }
  const names = Object.keys(taken)
  if (!names.length) { say('Nic lepszego tam nie bylo.'); return 0 }
  say('Ze skrzyni wzialem: ' + names.map(n => `${n} x${taken[n]}`).join(', '))
  for (const it of bot.inventory.items().filter(i => ARMOR_RE.test(i.name))) await equipArmor(it.name)
  return names.length
}

// wywolywane w trakcie zadan: jak widac nieprzeszukana skrzynie, zagladamy do niej
let lastLootCheck = 0
async function lootIfSeen(radius = 24, force = false) {
  if (!force && (!lootEnabled || Date.now() - lastLootCheck < 4000)) return 0
  lastLootCheck = Date.now()
  if (bot.inventory.emptySlotCount() === 0) return 0
  const spots = bot.findBlocks({ matching: containerIds(), maxDistance: radius, count: 10 })
    .filter(p => !lootedChests.has(posKey(p)) && !ownChests.has(posKey(p)))
  if (spots.length) console.log(`[bot] skrzynie w poblizu do sprawdzenia: ${spots.length}`)
  let total = 0
  for (const p of spots.slice(0, 3)) {
    if (!running) break
    const block = bot.blockAt(p)
    if (!block) continue
    say(`Widze ${block.name} - sprawdzam, czy jest tam cos lepszego.`)
    try { total += await lootChest(block) } catch (e) { console.log('[bot] skrzynia:', e.message) }
  }
  return total
}

// Bez zadania bot nie rusza skrzyn sam - pyta, czy moze. Odpowiedz "tak" / "nie" na czacie.
const askedChests = new Set()
let pendingChest = null // { pos, name, at }
setInterval(() => {
  if (pendingChest && Date.now() - pendingChest.at > 60000) pendingChest = null // bez odpowiedzi przez minute - dajemy spokoj
  if (!lootEnabled || running || activeTasks > 0 || pendingChest || !mcData || !bot.entity) return
  const p = bot.findBlocks({ matching: containerIds(), maxDistance: 16, count: 10 })
    .find(p => !lootedChests.has(posKey(p)) && !ownChests.has(posKey(p)) && !askedChests.has(posKey(p)))
  if (!p) return
  const block = bot.blockAt(p)
  askedChests.add(posKey(p))
  pendingChest = { pos: p, name: block?.name || 'skrzynia', at: Date.now() }
  replyTo = null
  say(`Widze ${pendingChest.name} na ${p.x} ${p.y} ${p.z}. Moge ja otworzyc? (tak/nie)`)
}, 5000)

function answerChest(yes) {
  const chest = pendingChest
  pendingChest = null
  if (!yes) { lootedChests.add(posKey(chest.pos)); say('Dobrze, nie ruszam jej.'); return }
  return task('przeszukiwanie skrzyni', async () => {
    const block = bot.blockAt(chest.pos)
    if (!block || !CONTAINERS.includes(block.name)) { say('Tej skrzyni juz tam nie ma.'); return }
    await lootChest(block)
  })
}

// "szukaj": chodzi po okolicy, az znajdzie nieprzeszukana skrzynie, i ja przeszukuje
function searchChestsCommand() {
  return task('szukam skrzyn', async () => {
    for (let i = 0; i < 8 && running; i++) {
      const before = lootedChests.size
      await lootIfSeen(32, true)
      if (lootedChests.size > before) return
      if (i === 0) say('Nie widze skrzyn w poblizu - rozgladam sie po okolicy.')
      await explore()
    }
    if (running) say('Nie znalazlem zadnej skrzyni.')
  })
}

function lootCommand() {
  return task('przeszukiwanie skrzyn', async () => {
    const before = lootedChests.size
    const n = await lootIfSeen(32, true)
    if (lootedChests.size === before) say('Nie widze nieprzeszukanych skrzyn w promieniu 32 blokow.')
    else if (!n) say('Nic lepszego w skrzyniach nie bylo.')
  })
}

function depositCommand(word) {
  return task('chowam do skrzyni', async () => {
    const all = word && /^wszystk/.test(stripPl(word))
    const isFood = i => !!mcData.foodsByName[i.name]
    const items = !word || all
      ? bot.inventory.items().filter(i => all || !(KEEP_RE.test(i.name) || isFood(i)))
      : findInventory(word)
    if (!items.length) { say('Nie mam nic do schowania.'); return }
    const box = await openNearestContainer()
    if (!box) return
    let stored = 0
    try {
      for (const it of items) {
        if (!running) break
        try { await box.deposit(it.type, null, it.count); stored += it.count } catch (e) { say('Skrzynia pelna albo blad: ' + e.message); break }
      }
    } finally {
      box.close()
    }
    say(`Schowalem ${stored} rzeczy.`)
  })
}

function withdrawCommand(word, amount) {
  return task('biore ze skrzyni', async () => {
    const box = await openNearestContainer()
    if (!box) return
    const re = resolveGive(word)
    let left = amount ?? Infinity
    let taken = 0
    try {
      for (const it of box.containerItems().filter(i => re.test(i.name))) {
        if (left <= 0 || !running) break
        const n = Math.min(it.count, left)
        try { await box.withdraw(it.type, null, n) } catch (e) { say('Nie moge wziac: ' + e.message); break }
        left -= n
        taken += n
      }
    } finally {
      box.close()
    }
    say(taken ? `Wzialem ${taken} x ${word}.` : `W skrzyni nie ma: ${word}.`)
  })
}

// ---------- spanie, podnoszenie, polowanie ----------
function sleepCommand() {
  return task('spanie', async () => {
    const bed = bot.findBlock({ matching: b => b.name.endsWith('_bed'), maxDistance: 32 })
    if (!bed) { say('Nie widze lozka w promieniu 32 blokow.'); return }
    await goNear(bed.position, 2)
    try {
      await bot.sleep(bed)
    } catch (e) {
      say('Nie moge spac: ' + e.message)
      return
    }
    say('Spie. Obudze sie rano albo po "stop".')
    while (running && bot.isSleeping) await sleep(1000)
    if (bot.isSleeping) { try { await bot.wake() } catch {} }
    say('Wstalem.')
  })
}

// podchodzi do lezacych przedmiotow w promieniu (zbiera je samo przejscie)
async function pickUpItems(radius = 16) {
  let picked = 0
  for (let i = 0; i < 30 && running; i++) {
    const drop = bot.nearestEntity(e => (e.name === 'item' || e.displayName === 'Item') && e.position.distanceTo(bot.entity.position) < radius)
    if (!drop) break
    try { await bot.pathfinder.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.5)) } catch {}
    picked++
    await sleep(250)
  }
  return picked
}

function pickUpCommand() {
  return task('podnoszenie', async () => {
    const n = await pickUpItems(16)
    say(n ? 'Pozbieralem przedmioty.' : 'Nic nie lezy w poblizu.')
  })
}

// "zdobadz jedzenie [ile]": poluje (i zbiera dojrzale warzywa z pola), a na koniec piecze surowe mieso
const countFood = () => bot.inventory.items().filter(i => mcData.foodsByName[i.name] && !BAD_FOOD.includes(i.name)).reduce((s, i) => s + i.count, 0)
const RAW_FOOD = /^(beef|porkchop|mutton|chicken|rabbit|cod|salmon|potato)$/

function foodCommand(amount) {
  return task('zdobywam jedzenie', async () => {
    say(`Zdobywam ${amount} jedzenia.`)
    let misses = 0
    while (running && countFood() + countMatch(/^chicken$/) < amount && misses < 6) {
      // najpierw to, co rosnie obok (dojrzale marchewki, ziemniaki, buraki)
      const crop = findBlocks(['carrots', 'potatoes', 'beetroots'], 1, 24)[0]
      if (crop) {
        try { await bot.collectBlock.collect(bot.blockAt(crop)) } catch {}
        continue
      }
      const animal = bot.nearestEntity(e => FOOD_ANIMALS.includes(e.name) && e.position.distanceTo(bot.entity.position) < 48)
      if (!animal) { misses++; await explore(); continue }
      misses = 0
      await killAnimal(animal)
      await pickUpItems(8)
    }
    // pieczone mieso daje wiecej najedzenia, a surowy kurczak truje
    if (running && countMatch(RAW_FOOD)) {
      say('Piekę surowe jedzenie w piecu.')
      await smeltAll(RAW_FOOD)
    }
    if (running) say(`Mam ${countFood()} jedzenia.`)
  })
}

const ANIMALS = [['krow', 'cow'], ['swin', 'pig'], ['owc', 'sheep'], ['kur', 'chicken'], ['kurczak', 'chicken'], ['krolik', 'rabbit'], ['koz', 'goat']]

function huntCommand(args) {
  const words = args.map(stripPl)
  const amount = parseInt(words.find(w => /^\d+$/.test(w)) || '3')
  const picked = ANIMALS.filter(([p]) => words.some(w => w.startsWith(p))).map(([, n]) => n)
  const kinds = picked.length ? picked : ['cow', 'pig', 'sheep', 'chicken']
  return task(`polowanie (${kinds.join(', ')})`, async () => {
    let killed = 0
    let misses = 0
    while (running && killed < amount && misses < 5) {
      const animal = bot.nearestEntity(e => kinds.includes(e.name) && e.position.distanceTo(bot.entity.position) < 48)
      if (!animal) { misses++; await explore(); continue }
      misses = 0
      if (await killAnimal(animal)) killed++
      await pickUpItems(8)
    }
    if (running) say(`Upolowalem ${killed}. Mieso: ${countMatch(/^(beef|porkchop|mutton|chicken|rabbit)$/)}.`)
  })
}

// ---------- zespol botow (kilka botow uruchomionych z jednego centrum sterowania) ----------
// Boty rozmawiaja przez centrum sterowania: linia "@@TEAM {json}" na wyjsciu trafia do pozostalych botow na wejscie.
// Kazdy co 2 s rozsyla swoj stan (ekwipunek, pozycja, zadanie), prosi o pomoc przy duzych zadaniach i walce,
// a gdy brakuje mu materialu, prosi kolege, ktory go ma.
const TEAM = process.env.MC_GUI === '1'
const AUTO_HELP = process.env.MC_AUTO_HELP !== '0'
const team = new Map() // nick -> ostatni stan
let currentJob = null // biezaca praca, do ktorej moga dolaczyc inni: { kind, type, label, origin, front }

function teamSend(msg) {
  if (!TEAM || !bot.username) return
  process.stdout.write('@@TEAM ' + JSON.stringify({ ...msg, from: bot.username }) + '\n')
}

// koledzy, ktorzy sa na tym samym swiecie i odezwali sie w ostatnich 10 s
function teammates() {
  const now = Date.now()
  return [...team.values()].filter(t => now - t.at < 10000 && (!t.dim || !bot.game?.dimension || t.dim === bot.game.dimension))
}

setInterval(() => {
  if (!TEAM || !bot.entity || !mcData) return
  const inv = {}
  for (const it of bot.inventory.items()) inv[it.name] = (inv[it.name] || 0) + it.count
  const p = bot.entity.position
  teamSend({ type: 'state', inv, pos: { x: p.x, y: p.y, z: p.z }, dim: bot.game?.dimension, task: currentTask, job: currentJob, busy: running || activeTasks > 0 })
}, 2000)

// prosba o pomoc w biezacej pracy (budowa, wystroj, burzenie) - odpowiada pierwszy wolny kolega
function askForHelp(job) {
  if (!TEAM || !teammates().some(t => !t.busy)) return
  teamSend({ type: 'help', job })
}

// walka: prosimy o pomoc najwyzej raz na 30 s
let lastFightHelp = 0
function askForFightHelp() {
  if (!TEAM || Date.now() - lastFightHelp < 30000) return
  lastFightHelp = Date.now()
  askForHelp({ kind: 'fight' })
}

function handleTeam(msg) {
  if (!msg || msg.from === bot.username) return
  if (msg.type === 'state') { team.set(msg.from, { ...msg, at: Date.now() }); return }
  if (msg.to && msg.to !== bot.username) return
  if (msg.type === 'help') {
    if (!AUTO_HELP || running || activeTasks > 0 || !mcData) return
    replyTo = null
    joinJob(msg.from, msg.job, true)
    return
  }
  if (msg.type === 'request') { answerRequest(msg); return }
  if (msg.type === 'reply') { console.log(`[bot] ${msg.from}: ${msg.text}`); return }
  if (msg.type === 'say') { console.log(`[bot] ${msg.from}: ${msg.text}`) }
}

// dolaczenie do pracy kolegi: bot bierze polowe planu (prawa strona), kolega i tak pomija juz postawione bloki
function joinJob(name, job, auto) {
  if (!job) {
    // kolega nic duzego nie robi - chodzimy za nim i bronimy go
    return task(`pomagam ${name}`, () => guardFor(name, 60000))
  }
  const tag = auto ? `${name} prosi o pomoc - ` : ''
  if (job.kind === 'fight') {
    say(`${tag}ide pomoc ${name} w walce.`)
    return task(`pomoc w walce: ${name}`, () => guardFor(name, 60000))
  }
  const origin = new Vec3(job.origin.x, job.origin.y, job.origin.z)
  if (job.kind === 'build' && planOf(job.type)) {
    say(`${tag}pomagam ${name} budowac: ${job.type}.`)
    return task(`pomoc w budowie (${job.type})`, () =>
      buildPlan(`${job.type} (pomoc)`, planWithDecor(job.type, planOf(job.type)), origin, job.front,
        { type: job.type, helper: true, part: 'right', passes: job.type === 'palac endu' || !PLAN_FOR_TYPE[job.type] ? 6 : 4 }))
  }
  if (job.kind === 'decor' && decorPlan(job.type)) {
    say(`${tag}pomagam ${name} w wystroju: ${job.type}.`)
    return task(`pomoc w wystroju (${job.type})`, () =>
      buildPlan(`wystroj ${job.type} (pomoc)`, decorPlan(job.type), origin, job.front, { type: job.type, decor: true, helper: true, part: 'right', passes: 3 }))
  }
  if (job.kind === 'demolish' && planOf(job.type)) {
    say(`${tag}pomagam ${name} burzyc: ${job.type}.`)
    return task(`pomoc w burzeniu (${job.type})`, () => demolishCells(job.type, { origin, front: job.front }, 'right'))
  }
  return task(`pomagam ${name}`, () => guardFor(name, 60000))
}

// chodzi za kolega i bije moby obok niego przez podany czas (albo do "stop")
async function guardFor(name, ms) {
  const until = Date.now() + ms
  const stop = setInterval(() => { if (Date.now() > until) running = false }, 1000)
  try { await stayWithPlayer(name, true) } finally { clearInterval(stop) }
}

// "pomoz" / "pomoz <bot>": dolaczamy do pracy kolegi (albo tego, ktory cos robi)
function helpCommand(arg) {
  const mates = teammates()
  if (!TEAM) { say('Pomaganie dziala, gdy boty sa uruchomione z centrum sterowania.'); return }
  if (!mates.length) { say('Nie widze innych botow.'); return }
  const name = arg && mates.find(t => t.from.toLowerCase().startsWith(arg.toLowerCase()))?.from
  if (arg && !name) { say(`Nie widze bota ${arg}. Dzialaja: ${mates.map(t => t.from).join(', ')}.`); return }
  const target = name ? mates.find(t => t.from === name) : (mates.find(t => t.job) || mates.find(t => t.busy) || mates[0])
  // praca daleko od kolegi (np. stara, nieaktualna) - nie idziemy na slepo kopac na drugi koniec mapy
  if (target.job?.origin && target.pos && Math.hypot(target.job.origin.x - target.pos.x, target.job.origin.z - target.pos.z) > 96) {
    say(`${target.from} jest daleko od swojej budowy (${target.job.origin.x} ${target.job.origin.z}) - ide do niego i go pilnuje.`)
    return joinJob(target.from, null, false)
  }
  if (target.job?.origin) say(`Ide pomoc ${target.from}: ${target.job.label || target.job.type} na ${target.job.origin.x} ${target.job.origin.y} ${target.job.origin.z}.`)
  return joinJob(target.from, target.job, false)
}

// "pomoc <ja> <komu>" jest wyraznym poleceniem: przerywamy biezace zadanie i idziemy pomagac
async function helpNow(arg) {
  if (running || activeTasks > 0) {
    say(`Przerywam ${currentTask || 'zadanie'} i ide pomoc ${arg}.`)
    running = false
    if (pendingQuestion) pendingQuestion.resolve(pendingQuestion.def)
    try { bot.pathfinder.setGoal(null); bot.stopDigging(); bot.clearControlStates() } catch {}
    for (let i = 0; i < 60 && activeTasks > 0; i++) await sleep(250)
    if (activeTasks > 0) { say('Nie moge przerwac poprzedniego zadania - napisz "stop" i sprobuj jeszcze raz.'); return }
  }
  return helpCommand(arg)
}

// ---------- wymiana przedmiotow ----------
// nazwa do "daj": deski i pnie dowolnego drewna
const giveWord = item => /_planks$/.test(item) ? 'deski' : WOOD_RE.test(item) ? 'kloce' : item
const teamHas = (t, item) => Object.entries(t.inv || {}).filter(([n]) => sameKind(n, item)).reduce((s, [, c]) => s + c, 0)

// prosi kolege, ktory ma przedmiot, zeby go przyniosl; czeka do 45 s
async function askTeamFor(item, count, who) {
  if (!TEAM || count <= 0) return false
  const mates = teammates().filter(t => (!who || t.from === who) && teamHas(t, item) > 0 && !t.busy)
  if (!mates.length) return false
  const giver = mates.sort((a, b) => teamHas(b, item) - teamHas(a, item))[0]
  const want = Math.min(count, teamHas(giver, item))
  const before = haveOf(item)
  say(`Brakuje mi ${count} x ${item} - prosze ${giver.from}, ma ${teamHas(giver, item)}.`)
  teamSend({ type: 'request', to: giver.from, item, count: want })
  for (let i = 0; i < 45 && running; i++) {
    await sleep(1000)
    if (haveOf(item) >= before + want) break
  }
  await pickUpItems(6)
  return haveOf(item) > before
}

function answerRequest(msg) {
  const reply = text => teamSend({ type: 'reply', to: msg.from, text })
  if (running || activeTasks > 0) { reply(`jestem zajety (${currentTask})`); return }
  if (!bot.players[msg.from]?.entity) { reply('nie widze Cie - podejdz blizej'); return }
  say(`${msg.from} prosi o ${msg.count} x ${msg.item} - zanosze.`)
  task(`daje ${msg.item} dla ${msg.from}`, () => giveItems(msg.from, giveWord(msg.item), msg.count))
}

// "popros <bot> o <co> [ile]"
function requestCommand(text) {
  const m = stripPl(text).match(/^(\S+)\s+o\s+(.+?)(?:\s+(\d+))?$/)
  if (!m) { say('Uzycie: popros <bot> o <co> [ile], np. popros Bob o diament 3'); return }
  const who = teammates().find(t => t.from.toLowerCase().startsWith(m[1]))?.from
  if (!who) { say(`Nie widze bota ${m[1]}.`); return }
  const re = resolveGive(m[2])
  const t = team.get(who)
  const item = Object.keys(t.inv || {}).find(n => re.test(n))
  if (!item) { say(`${who} nie ma: ${m[2]}.`); return }
  return task(`prosba do ${who}`, () => askTeamFor(item, parseInt(m[3] || '1'), who))
}

// ---------- zabij: gracz, mob (typ) albo mob z imieniem ----------
const MOB_PL = [['zombi', 'zombie'], ['szkielet', 'skeleton'], ['pajak', 'spider'], ['creeper', 'creeper'], ['enderman', 'enderman'],
  ['wiedzm', 'witch'], ['krow', 'cow'], ['swin', 'pig'], ['owc', 'sheep'], ['kur', 'chicken'], ['krolik', 'rabbit'], ['koz', 'goat'],
  ['kon', 'horse'], ['wilk', 'wolf'], ['slime', 'slime'], ['szlam', 'slime'], ['blaze', 'blaze'], ['ghast', 'ghast'], ['piglin', 'piglin'],
  ['topiel', 'drowned'], ['husk', 'husk'], ['fantom', 'phantom'], ['phantom', 'phantom'], ['pillager', 'pillager'], ['rozboj', 'pillager'],
  ['lis', 'fox'], ['kot', 'cat'], ['lama', 'llama'], ['osiol', 'donkey'], ['muchomor', 'mooshroom'], ['silverfish', 'silverfish'], ['rybik', 'silverfish']]

// imie nadane mobowi (tabliczka z imieniem) - w metadanych bytu jako tekst albo JSON czatu
function customName(e) {
  for (const v of Object.values(e.metadata || {})) {
    if (typeof v === 'string' && v.length < 64 && !/^[\d.]+$/.test(v)) return v.replace(/"|\{.*"text":"|\}/g, '')
    if (v && typeof v === 'object' && typeof v.text === 'string' && v.text) return v.text
  }
  return null
}

function findMob(word) {
  const w = stripPl(word)
  const me = bot.entity.position
  const near = e => e !== bot.entity && e.position.distanceTo(me) < 64
  // 1) mob z imieniem
  const named = Object.values(bot.entities).find(e => near(e) && e.type !== 'player' && stripPl(customName(e) || '').includes(w))
  if (named) return named
  // 2) typ moba (po polsku albo angielsku)
  const type = MOB_PL.find(([p]) => w.startsWith(p))?.[1] || w
  return bot.nearestEntity(e => near(e) && e.name === type) || null
}

async function killEntity(ent, label) {
  if (ent.name === 'warden' || ent.name === 'ender_dragon' || ent.name === 'wither') { say(`${label} jest za silny - nie atakuje.`); return }
  let dead = false
  const onDead = e => { if (e === ent) dead = true }
  bot.on('entityDead', onDead)
  try {
    await bestSword()
    bot.pvp.attack(ent)
    say(`Atakuje: ${label}.`)
    for (let t = 0; t < 240 && running && !dead && bot.entities[ent.id]; t++) {
      if (bot.pvp.target !== ent) bot.pvp.attack(ent)
      await sleep(500)
    }
    if (dead || !bot.entities[ent.id]) say(`${label} pokonany.`)
  } finally {
    bot.removeListener('entityDead', onDead)
    bot.pvp.stop()
  }
}

function killCommand(target) {
  if (findPlayerName(target)) return killPlayer(target)
  const ent = findMob(target)
  if (!ent) { say(`Nie widze ani gracza, ani moba "${target}" w promieniu 64 blokow.`); return }
  const label = customName(ent) ? `${customName(ent)} (${ent.name})` : ent.name
  return task(`walka: ${label}`, () => killEntity(ent, label))
}

// ---------- wlasne komendy (makra) ----------
// Komenda to lista krokow. Krok to zwykla komenda bota ("zdobadz drewno 10", "tu") albo instrukcja makra:
//   powiedz <tekst> | czekaj <sekundy> | powtorz <n>: <krok> | szukaj moba <mob> | szukaj bloku <blok> |
//   idz do celu | ogrodz cel [plotem|murkiem|<blok>] [promien] | zabij cel | jesli masz <rzecz>: <krok>
// W krokach: $1, $2... - slowa po nazwie komendy, $* - wszystkie, $gracz - kto wydal komende.
// Pliki JSON w folderze komend (wspolnym dla wszystkich botow z programu).
const COMMANDS_DIR = process.env.MC_COMMANDS_DIR || pathLib.join(DATA_DIR, 'komendy')
function loadMacros() {
  try {
    return fs.readdirSync(COMMANDS_DIR).filter(n => n.endsWith('.json')).map(n => {
      try { return JSON.parse(fs.readFileSync(pathLib.join(COMMANDS_DIR, n), 'utf8')) } catch { return null }
    }).filter(m => m && m.key && Array.isArray(m.steps) && m.steps.length)
  } catch { return [] }
}
function saveMacro(m) {
  fs.mkdirSync(COMMANDS_DIR, { recursive: true })
  fs.writeFileSync(pathLib.join(COMMANDS_DIR, m.key.replace(/ /g, '_') + '.json'), JSON.stringify(m, null, 2))
}
// "kurczak 3" -> makro "kurczak" i argumenty ["3"]
function findMacro(c) {
  const t = designKey(c)
  const m = loadMacros().filter(x => t === x.key || t.startsWith(x.key + ' ')).sort((a, b) => b.key.length - a.key.length)[0]
  if (!m) return null
  return { macro: m, args: t.slice(m.key.length).trim().split(/\s+/).filter(Boolean) }
}

let macroStop = false
let macroDepth = 0
// czeka, az bot skonczy zadanie uruchomione przez krok
async function waitIdle() {
  await sleep(700)
  while ((running || activeTasks > 0 || pendingQuestion) && !macroStop) await sleep(300)
}

async function runMacro(macro, user, args) {
  if (macroDepth >= 3) { say('Za duzo komend wewnatrz komend - przerywam.'); return }
  if (running) { say(`Jestem zajety (${currentTask}), napisz "stop".`); return }
  macroDepth++
  if (macroDepth === 1) macroStop = false
  const ctx = { target: null }
  say(`Robie: ${macro.name} (${macro.steps.length} krokow).`)
  try {
    for (let i = 0; i < macro.steps.length && !macroStop; i++) {
      const line = String(macro.steps[i])
        .replace(/\$\*/g, args.join(' '))
        .replace(/\$gracz/g, user || process.env.MC_PLAYER || '')
        .replace(/\$(\d)/g, (m, n) => args[n - 1] || '')
        .trim()
      if (!line) continue
      console.log(`[bot] ${macro.name}: krok ${i + 1}/${macro.steps.length}: ${line}`)
      await macroStep(line, ctx, user)
    }
    if (!macroStop && macroDepth === 1) say(`Gotowe: ${macro.name}.`)
  } catch (e) {
    console.log('[bot] makro:', e)
    say(`Blad w komendzie ${macro.name}: ${e.message}. Napraw kroki albo napisz "kontynuuj".`)
  } finally {
    macroDepth--
  }
}

async function macroStep(line, ctx, user) {
  const c = stripPl(line).toLowerCase().trim()
  let m
  if ((m = line.match(/^powiedz\s+(.+)$/i))) { say(m[1]); return }
  if ((m = c.match(/^czekaj\s+(\d+)/))) { for (let t = 0; t < +m[1] * 2 && !macroStop; t++) await sleep(500); return }
  if ((m = line.match(/^powt[oó]rz\s+(\d+)(?:\s*razy)?\s*:?\s*(.+)$/i))) {
    for (let i = 0; i < Math.min(+m[1], 50) && !macroStop; i++) await macroStep(m[2], ctx, user)
    return
  }
  if ((m = line.match(/^je[sś]li\s+masz\s+(.+?)\s*:\s*(.+)$/i))) {
    const re = resolveGive(m[1])
    if (bot.inventory.items().some(i => re.test(i.name))) await macroStep(m[2], ctx, user)
    return
  }
  if ((m = c.match(/^szukaj\s+moba\s+(.+)$/))) {
    const word = m[1]
    await task(`szukam: ${word}`, async () => {
      let ent = findMob(word)
      for (let tries = 0; !ent && tries < 8 && running; tries++) {
        setStatus(`szukam moba: ${word} (proba ${tries + 1}/8)`)
        await explore()
        ent = findMob(word)
      }
      if (!ent) { say(`Nie znalazlem: ${word}.`); macroStop = true; return }
      ctx.target = ent
      say(`Znalazlem: ${customName(ent) || ent.name}.`)
      await bot.pathfinder.goto(new goals.GoalFollow(ent, 2)).catch(() => {})
    })
    return
  }
  if ((m = c.match(/^szukaj\s+bloku\s+(.+)$/))) {
    const re = resolveGive(m[1])
    const ids = mcData.blocksArray.filter(b => re.test(b.name)).map(b => b.id)
    const pos = ids.length ? bot.findBlock({ matching: ids, maxDistance: 64 })?.position : null
    if (!pos) { say(`Nie widze w poblizu: ${m[1]}.`); macroStop = true; return }
    ctx.target = { position: pos, isBlock: true }
    say(`Widze ${m[1]} na ${pos.x} ${pos.y} ${pos.z}.`)
    return
  }
  if (/^idz do celu/.test(c)) {
    if (!ctx.target) { say('Nie mam celu - najpierw "szukaj moba" albo "szukaj bloku".'); return }
    const p = ctx.target.position
    await task('ide do celu', () => bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2)).catch(() => {}))
    return
  }
  if ((m = c.match(/^ogrodz(?:\s+(cel|siebie|mnie|tu))?(?:\s+([a-z_]+))?(?:\s+(\d+))?/))) {
    const who = m[1] || (ctx.target ? 'cel' : 'siebie')
    let center = bot.entity.position
    if (who === 'cel' && ctx.target) center = ctx.target.position
    if (who === 'mnie' && user && bot.players[user]?.entity) center = bot.players[user].entity.position
    const r = Math.max(1, Math.min(8, +(m[3] || 2)))
    const word = m[2] || 'plotem'
    let block = 'oak_fence'
    if (/^mur/.test(word)) block = 'cobblestone_wall'
    else if (!/^plot/.test(word)) { const re = resolveGive(word); block = mcData.blocksArray.find(b => re.test(b.name))?.name || 'oak_fence' }
    else block = bot.inventory.items().find(i => /_fence$/.test(i.name))?.name || 'oak_fence'
    const plan = []
    ring(-r, r, -r, r, (x, z) => plan.push({ x, y: 0, z, block }))
    const origin = center.floored()
    await task(`ogradzam (${block})`, () => buildPlan(`ogrodzenie`, plan, origin, facingAxis(), { passes: 3 }))
    return
  }
  if (/^zabij cel/.test(c)) {
    if (!ctx.target || ctx.target.isBlock) { say('Nie mam celu do zaatakowania.'); return }
    await task('walka z celem', () => killEntity(ctx.target, customName(ctx.target) || ctx.target.name))
    return
  }
  // zwykla komenda bota (albo inna wlasna komenda)
  handle(user, line)
  await waitIdle()
}

// "naucz sie <nazwa>: krok; krok; krok" - nowa komenda wpisana na czacie
function learnCommand(text) {
  const m = text.match(/^(?:naucz\s+si[eę]|nowa\s+komenda|stw[oó]rz\s+komend[eę])\s+(.+?)\s*:\s*(.+)$/i)
  if (!m) { say('Uzycie: naucz sie <nazwa>: krok; krok; krok   (np. naucz sie drewno: zdobadz drewno 16; idz do bazy; schowaj)'); return }
  const name = m[1].trim()
  const key = designKey(name)
  if (!key) { say('Podaj nazwe komendy.'); return }
  const steps = m[2].split(/\s*;\s*/).map(x => x.trim()).filter(Boolean)
  saveMacro({ key, name, description: '', steps, createdAt: Date.now() })
  say(`Nauczylem sie komendy "${name}" (${steps.length} krokow). Napisz "${name}", zeby ja wykonac.`)
}
function forgetMacro(name) {
  const key = designKey(name)
  const file = pathLib.join(COMMANDS_DIR, key.replace(/ /g, '_') + '.json')
  if (!fs.existsSync(file)) { say(`Nie znam komendy "${name}".`); return }
  fs.unlinkSync(file)
  say(`Zapomnialem komende "${name}".`)
}
function macrosCommand() {
  const list = loadMacros()
  if (!list.length) { say('Nie mam wlasnych komend. Naucz mnie: naucz sie <nazwa>: krok; krok'); return }
  say('Moje komendy: ' + list.map(x => x.name).join(', '))
}

// ---------- pamiec ostatniego zadania: "kontynuuj" i pytanie po restarcie ----------
let lastCommand = null // tekst komendy, ktora wlasnie uruchamia zadanie (ustawiane w handle)
// ostatnie zadanie zostaje w pamieci tez po bledzie (np. zabraklo blokow) - "kontynuuj" je wznawia.
// Plik last_task.json jest tylko na czas zadania: jak zostal po restarcie, zadanie zostalo przerwane.
let lastTask = loadJson('last_task.json', null) // { cmd, name, job }
function rememberTask(name) {
  if (!lastCommand) return
  lastTask = { cmd: lastCommand, name, at: Date.now() }
  saveJson('last_task.json', lastTask)
  // dlugie zadania trafiaja tez na liste 3 ostatnich ("kontynuuj <nazwa>")
  if (/^(zdobadz|zbierz|wykop|przynies|scraftuj|zrob|stworz|poluj|etap|start|przepal|buduj|zburz|usun budowl)/.test(stripPl(lastCommand).toLowerCase())) pushRecent(lastTask)
  lastCommand = null
}
function rememberJob(job) {
  if (!lastTask) return
  lastTask.job = job
  if (running) saveJson('last_task.json', lastTask)
  pushRecent(lastTask) // budowla: z miejscem i obrotem
}

// 3 ostatnie wieksze zadania (najnowsze pierwsze) - "kontynuuj <nazwa>", "kontynuuj 2", "kontynuuj lista"
let recentTasks = loadJson('ostatnie_zadania.json', [])
const recentKey = e => e.job ? `${e.job.kind}:${e.job.type}:${e.job.origin?.x},${e.job.origin?.z}` : designKey(e.cmd)
function pushRecent(entry) {
  recentTasks = [entry, ...recentTasks.filter(e => e !== entry && recentKey(e) !== recentKey(entry))].slice(0, 3)
  saveJson('ostatnie_zadania.json', recentTasks)
}
const recentLabel = e => e.job ? `${e.job.kind === 'demolish' ? 'burzenie' : 'budowa'}: ${e.job.label || e.job.type}` : e.cmd
function agoText(t) {
  const m = Math.round((Date.now() - (t || 0)) / 60000)
  return m < 2 ? 'przed chwila' : m < 90 ? `${m} min temu` : m < 60 * 36 ? `${Math.round(m / 60)} h temu` : `${Math.round(m / 1440)} dni temu`
}
function recentList() {
  if (!recentTasks.length) return 'Nie pamietam zadnych zadan do kontynuowania.'
  return 'Moge kontynuowac: ' + recentTasks.map((e, i) => `${i + 1}) ${recentLabel(e)} (${agoText(e.at)})`).join(', ') + '. Napisz: kontynuuj <nazwa> albo kontynuuj <numer>.'
}
function forgetTask() {
  try { fs.unlinkSync(pathLib.join(DATA_DIR, 'last_task.json')) } catch {}
}
function continueCommand(user, arg) {
  let last = lastTask
  const a = designKey(arg || '')
  if (/^(lista|liste|co|wszystko|ostatnie)$/.test(a)) { say(recentList()); return }
  if (a) {
    // numer z listy albo nazwa (typ budowli, jej nazwa, komenda)
    last = /^\d$/.test(a) ? recentTasks[Number(a) - 1]
      : recentTasks.find(e => [e.job?.type, e.job?.label, e.cmd].some(n => n && designKey(n).includes(a)))
    if (!last) { say(`Nie pamietam zadania "${arg}". ${recentList()}`); return }
    lastTask = last
  }
  if (!last?.cmd) { say('Nie mam czego kontynuowac.'); return }
  if (running) { say(`Jestem zajety (${currentTask}), napisz "stop".`); return }
  const job = last.job
  // budowa i wystroj: w tym samym miejscu i obrocie, materialy tylko na brakujace bloki
  if (job && (job.kind === 'build' || job.kind === 'decor') && planOf(job.type)) {
    const plan = job.kind === 'decor' ? decorPlan(job.type) : planWithDecor(job.type, planOf(job.type))
    say(`Kontynuuje: ${job.label || job.type}.`)
    lastCommand = null
    return task(`${job.kind === 'decor' ? 'wystroj' : 'budowa'}: ${job.type} (dalej)`, () =>
      buildPlan(job.label || job.type, plan, new Vec3(job.origin.x, job.origin.y, job.origin.z), job.front, {
        type: job.type, decor: job.kind === 'decor', resume: true, start: job.start,
        passes: job.kind === 'decor' ? 3 : job.type === 'palac endu' || !PLAN_FOR_TYPE[job.type] ? 6 : undefined
      }))
  }
  say(`Kontynuuje: ${last.cmd}.`)
  return handle(user, last.cmd)
}
bot.once('spawn', () => setTimeout(async () => {
  if (!lastTask?.cmd || running || !fs.existsSync(pathLib.join(DATA_DIR, 'last_task.json'))) return
  replyTo = null
  const answer = await askUser(`Ostatnio robilem: "${lastTask.cmd}" (przerwane). Kontynuowac? (tak / nie)`,
    [[/^(tak|kontynuuj|dawaj|ok)$/, 'yes'], [/^(nie|stop)$/, 'no']], 60000, 'no')
  if (answer === 'yes') continueCommand(null)
  else forgetTask()
}, 6000))

// ---------- uprawnienia: kto moze wydawac komendy ----------
// wlasciciel: nick gracza, ktory zawsze moze wydawac komendy (podaje sie w start.js albo zmienna MC_OWNER)
const OWNER = process.env.MC_OWNER || ''
const PERM_FILE = pathLib.join(DATA_DIR, 'permissions.json')
let allowed = new Set(OWNER ? [OWNER.toLowerCase()] : [])
try {
  for (const n of JSON.parse(fs.readFileSync(PERM_FILE, 'utf8')).allowed || []) allowed.add(n.toLowerCase())
} catch {}

function savePerms() {
  try { fs.writeFileSync(PERM_FILE, JSON.stringify({ allowed: [...allowed] }, null, 2)) } catch (e) { console.log('[bot] zapis uprawnien:', e.message) }
}
// w singleplayerze (LAN) w swiecie jest tylko gracz wlasciciel, wiec slucha kazdego z czatu
const LAN = process.env.MC_MODE === 'lan'
const isAllowed = user => !!user && (LAN || allowed.has(user.toLowerCase()))
const isOwnerName = user => !user || LAN || user.toLowerCase() === OWNER.toLowerCase()

// "permisja <nick>" / "odbierz <nick>" / "permisje" - zmienia tylko konsola albo wlasciciel
function permCommand(user, cmd) {
  const isOwner = isOwnerName(user)
  const [verb, nick] = cmd.split(/\s+/)
  if (verb === 'permisje') { say('Moga wydawac komendy: ' + [...allowed].join(', ')); return }
  if (!isOwner) { say('Tylko wlasciciel moze zmieniac uprawnienia.'); return }
  if (!nick) { say(`Uzycie: ${verb} <nick>`); return }
  if (verb === 'permisja') { allowed.add(nick.toLowerCase()); say(`${nick} moze teraz wydawac komendy.`) }
  else if (nick.toLowerCase() === OWNER.toLowerCase()) { say('Wlasciciela nie odbiore.'); return }
  else { allowed.delete(nick.toLowerCase()); say(`${nick} nie moze juz wydawac komendy.`) }
  savePerms()
}

// wiadomosci prywatne: [Nick -> me] tekst, Nick whispers to you: tekst, From Nick: tekst
// (wzorce zakotwiczone na poczatku, zeby nikt nie podrobil ich zwyklym czatem)
const WHISPER_RES = [
  /^\[(\w{3,16}) -> (\w{2,16})\]\s*(.+)$/,
  /^\[(\w{3,16}) → (\w{2,16})\]\s*(.+)$/,
  /^(\w{3,16}) whispers to you: (.+)$/,
  /^From (\w{3,16}):\s*(.+)$/
]
bot.on('messagestr', m => {
  for (const re of WHISPER_RES) {
    const g = m.trim().match(re)
    if (!g) continue
    const from = g[1]
    const to = g.length === 4 ? g[2] : bot.username
    const text = g[g.length - 1]
    const mine = bot.username.toLowerCase()
    if (from.toLowerCase() === mine) return
    if (!['me', 'ja', mine].includes(to.toLowerCase())) return
    if (!isAllowed(from)) { console.log(`[bot] ignoruje /msg od ${from}`); return }
    if (routeToAi(from, text, true)) return
    handle(from, text, true)
    return
  }
})

let stdinBuf = ''
process.stdin.on('data', d => {
  stdinBuf += d.toString()
  const lines = stdinBuf.split(/\r?\n/)
  stdinBuf = lines.pop()
  for (const line of lines) {
    if (line.startsWith('@@TEAM ')) { try { handleTeam(JSON.parse(line.slice(7))) } catch {} continue }
    if (line.startsWith('@@AIREPLY ')) { try { aiReply(JSON.parse(line.slice(10))) } catch {} continue }
    if (line.startsWith('@@AICMD ')) { try { runAiCommand(JSON.parse(line.slice(8))) } catch {} continue }
    if (line.trim()) handle(null, line)
  }
})
// gracze, ktorzy pisza jak boty (np. inny bot spoza programu, starsza wersja) - ich wiadomosci nie sa komendami
const botLike = new Set()
bot.on('chat', (user, msg) => {
  // inne boty z zespolu dostaja polecenia przez GUI, a nie przez czat - inaczej odpowiadalyby sobie w kolko
  if (user === bot.username || team.has(user) || botLike.has(user) || !isAllowed(user)) return
  if (/Nie znam komendy|Napisz "komendy"|^Gotowy\. Napisz/.test(msg)) {
    // odpowiedz innego bota: nie odbijamy jej, a dalsze wiadomosci tego "gracza" pomijamy
    if (!process.env.MC_PLAYER || user.toLowerCase() !== process.env.MC_PLAYER.toLowerCase()) botLike.add(user)
    return
  }
  // komunikat serwera po komendzie gracza, np. "[Czarkonator: Teleported Czarkonator to Tester]"
  if (/\]$/.test(msg) && !msg.includes('[')) return
  // tryb AI: wszystko od gracza idzie do AI (ono samo wydaje botowi komendy)
  if (routeToAi(user, msg, false)) return
  // "<nick>, ..." - komenda dla tego bota
  const nickRe = new RegExp('^@?' + bot.username + '\\b[,:!]?\\s*', 'i')
  if (nickRe.test(msg)) {
    const rest = msg.replace(nickRe, '').trim()
    if (!rest) return
    aiAddressed = true
    try { handle(user, rest) } finally { aiAddressed = false }
    return
  }
  handle(user, msg)
})

// ---------- AI w grze (MC_AI=1, tylko z programu): pytanie idzie do programu, odpowiedz wraca na wejscie jako @@AIREPLY ----------
// Klucz API zostaje w programie. Pytac moze gracz z ustawien bota (LAN) albo osoby z permisja (serwer).
const AI_ON = process.env.MC_AI === '1' && process.env.MC_GUI === '1'
let aiAddressed = false // biezaca wiadomosc zaczynala sie od nicku bota
let aiPending = null
const aiAllowed = user => !!user && (LAN
  ? (!process.env.MC_PLAYER || user.toLowerCase() === process.env.MC_PLAYER.toLowerCase())
  : allowed.has(user.toLowerCase()))
// Tryb AI: kazda wiadomosc gracza (czat albo /msg) trafia do AI, takze "buduj cos-tam" - bot sam jej nie wykonuje.
// Bot przejmuje tylko "stop" (zeby zawsze dalo sie go zatrzymac) i odpowiedzi na swoje pytania (tak / nie...).
// Komendy z programu (panel bota) ida prosto do bota. Zwraca true, gdy wiadomosc poszla do AI albo zostala obsluzona.
function routeToAi(user, msg, whisper) {
  if (!AI_ON || !aiAllowed(user)) return false
  const t = stripPl(String(msg)).toLowerCase().trim()
  if (/^(stop|zostan|stoj|czekaj)!?$/.test(t)) return false
  if (/^(czas|ile jeszcze|ile zostalo|kiedy skonczysz|ile czasu|eta|status)\??$/.test(t)) return false // szybkie informacje - prosto od bota
  if (/^(kontynuuj|kontynuluj|kontynuj|dalej|wznow|buduj dalej)( |$)/.test(t)) return false // wznawianie zadan - prosto do bota
  if (pendingQuestion && pendingQuestion.options.some(([re]) => re.test(t))) return false
  const nickRe = new RegExp('^@?' + bot.username + '\\b[,:!]?\\s*', 'i')
  const text = String(msg).replace(nickRe, '').replace(/^ai\b[,:]?\s*/i, '').trim()
  if (text) askAi(user, text, whisper)
  return true
}
function askAi(user, text, whisper = false) {
  if (aiPending && Date.now() - aiPending.at < 120000) { say('Chwila, jeszcze mysle nad poprzednim pytaniem.'); return }
  aiPending = { id: Date.now().toString(36), at: Date.now(), user, whisper }
  replyTo = whisper ? user : null
  say('Hmm, chwila...')
  process.stdout.write('@@AI ' + JSON.stringify({ id: aiPending.id, from: user, text }) + '\n')
}
// komenda od AI (przez program): wykonujemy jak z konsoli i od razu odsylamy, czy bot ja zrozumial
// (sprawdzenie dzieje sie synchronicznie, zanim komenda zacznie zadanie) - AI moze wtedy poprawic komende
const aiCmd = { active: false, unknown: false, busy: null }
function runAiCommand(m) {
  Object.assign(aiCmd, { active: true, unknown: false, busy: null })
  try { handle(null, String(m.text || '')) } catch (e) { console.log('[bot] komenda od AI:', e.message) } finally { aiCmd.active = false }
  process.stdout.write('@@AICMDRES ' + JSON.stringify({ id: m.id, ok: !aiCmd.unknown && !aiCmd.busy, unknown: aiCmd.unknown, busy: aiCmd.busy }) + '\n')
}
function aiReply(msg) {
  const p = aiPending
  aiPending = null
  if (p) replyTo = p.whisper ? p.user : null
  // czat gry: bez formatowania, krotkie kawalki (najwyzej 4 wiadomosci)
  const clean = String(msg.text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim()
  for (const part of (clean.match(/.{1,230}(\s|$)/g) || []).slice(0, 4)) say(part.trim())
}

function stopAll() {
  running = false
  macroStop = true
  if (pendingQuestion) pendingQuestion.resolve(pendingQuestion.def)
  try { bot.pathfinder.setGoal(null); bot.pvp.stop(); bot.stopDigging(); bot.clearControlStates() } catch {}
  if (bot.isSleeping) bot.wake().catch(() => {})
  say('Zatrzymany.')
}

function statusText() {
  const p = bot.entity?.position
  const pos = p ? `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}` : '?'
  return `HP ${Math.round(bot.health)}/20, glod ${Math.round(bot.food)}/20, poz ${pos}, w rece ${bot.heldItem?.name || 'nic'}, ` +
    `zadanie: ${currentTask || 'brak'}, tryb: ${mode}`
}

// ---------- rozmowa: powitania i grzecznosci ----------
const pick = list => list[Math.floor(Math.random() * list.length)]
const SMALL_TALK = [
  [/^(elo|elo elo|siema|siemka|siemano|czesc|hej|hejka|hejo|witaj|witam|dzien dobry|dobry wieczor|yo|jol|hello|hi|hey)\b/,
    u => pick([`Elo${u ? ' ' + u : ''}!`, `Siema${u ? ' ' + u : ''}!`, `Czesc${u ? ' ' + u : ''}! Napisz "komendy", zeby zobaczyc, co umiem.`, `Witaj${u ? ' ' + u : ''}!`])],
  [/^(dzieki|dziekuje|dzieks|thx|thanks|dziena)\b/, () => pick(['Nie ma za co!', 'Spoko!', 'Zawsze do uslug.'])],
  [/^(jak sie masz|co tam|co slychac|jak leci|jak tam|jak idzie|postep)\b/,
    () => `${progressText()} HP ${Math.round(bot.health)}/20, glod ${Math.round(bot.food)}/20.`],
  [/^(kim jestes|kto ty|co umiesz|przedstaw sie)\b/, () => 'Jestem Claude, bot do Minecrafta. Kopie, craftuje, poluje, chodze za Toba i nie tylko. Napisz "komendy".'],
  [/^(dobranoc|pa pa|papa|nara|narka|do zobaczenia|bye)\b/, u => pick([`Pa${u ? ' ' + u : ''}!`, 'Do zobaczenia!', 'Narka!'])],
  [/^(dobry bot|dobra robota|super|brawo|gratulacje)\b/, () => pick(['Dzieki! :)', 'Staram sie!', 'Hehe, dzieki!'])],
  [/^(glupi bot|zly bot)\b/, () => pick(['Przepraszam, poprawie sie.', 'Ups. Powiedz, co zrobilem zle.'])]
]

// "diament 3" -> { word: 'diament', amount: 3 }; bez liczby amount = null
function splitAmount(text) {
  const g = text.trim().match(/^(.+?)(?:\s+(\d+))?$/)
  return g ? { word: g[1], amount: g[2] ? parseInt(g[2]) : null } : { word: text.trim(), amount: null }
}

function handle(user, msg, whisper = false) {
  lastCommand = msg.trim()
  try { return handleCommand(user, msg, whisper) } finally { lastCommand = null }
}

function handleCommand(user, msg, whisper = false) {
  replyTo = whisper ? user : null
  const text = msg.trim()
  if (!text) return
  const cmd = text.toLowerCase()
  const c = stripPl(cmd) // bez polskich znakow: "zdobądź" = "zdobadz"
  const verb = c.split(/\s+/)[0]
  const rest = text.split(/\s+/).slice(1).join(' ') // reszta w oryginale (nicki)
  const args = c.split(/\s+/).slice(1)
  const isOwner = isOwnerName(user)
  // kto jest "mna" w "tu", "daj", "chodz za mna": nadawca z gry, a z konsoli/GUI - gracz z ustawien (MC_PLAYER)
  const player = user || process.env.MC_PLAYER || null

  // komendy serwera (/...) wykonuje tylko konsola i wlasciciel, zeby inni nie mogli kazac botowi np. /tpa czy /op
  if (text.startsWith('/')) {
    if (isOwner) sendChat(text)
    else say('Komendy z / moze wydawac tylko wlasciciel.')
    return
  }
  const chatText = text.match(/^chat\s+([\s\S]+)$/i)
  if (chatText) {
    if (chatText[1].startsWith('/') && !isOwner) say('Komendy z / moze wydawac tylko wlasciciel.')
    else sendChat(chatText[1])
    return
  }

  if (pendingQuestion) {
    const answer = pendingQuestion.options.find(([re]) => re.test(c))
    if (answer) { pendingQuestion.resolve(answer[1]); return }
  }

  // te dzialaja zawsze, tez przed wejsciem do swiata
  if (/^(permisja|odbierz|permisje)$/.test(verb)) { permCommand(user, cmd); return }
  if (['stop', 'zostan', 'czekaj', 'stoj'].includes(c)) { stopAll(); return }
  const cont = c.match(/^(kontynuuj|kontynuluj|kontynuj|kontynułuj|dalej|wznow|rob dalej|buduj dalej)(?:\s+(.+))?$/)
  if (cont) return continueCommand(user, cont[2])
  if (/^(naucz si|nowa komenda|stworz komend)/.test(c)) return learnCommand(text)
  if (/^(zapomnij|usun) komend/.test(c)) return forgetMacro(text.replace(/^\S+\s+komend\S*\s*/i, ''))
  if (/^(moje|wlasne) komendy$/.test(c)) return macrosCommand()
  if (/^(projekty|moje projekty|moje budowle)$/.test(c)) return designsCommand()
  if (c === 'status') { say(statusText()); return }
  if (/^(czas|ile jeszcze|ile zostalo|kiedy skonczysz|ile czasu|eta)\??$/.test(c)) return timeCommand()
  if (c === 'co robisz' || c === 'co robisz?') { say(progressText()); return }
  if (c === 'diag') { const r = physicsReport(); console.log('[bot]', r); say(r); return }
  if (c === 'komendy' || c === 'pomoc') { for (const l of HELP) say(l); return }
  if (!mcData) {
    console.log('[bot] Jeszcze nie wszedlem do swiata (brak "Gotowy"). Jesli serwer wymaga logowania, wpisz np. /login haslo.')
    if (user) say('Jeszcze nie wszedlem do swiata.')
    return
  }

  // odpowiedz na pytanie o skrzynie
  if (pendingChest && /^(tak|mozesz|ok|jasne|otworz|dawaj)\b/.test(c)) return answerChest(true)
  if (pendingChest && /^(nie|zostaw)\b/.test(c)) return answerChest(false)

  // --- zadania ---
  if (c === 'start') return run()
  if (verb === 'etap') return runStage(args[0])
  if (c === 'przepal' || c === 'przepalaj') return smeltCommand()
  if (/^(podnies|pozbieraj)$/.test(c) || /^zbierz (drop|itemy|przedmioty|rzeczy)$/.test(c)) return pickUpCommand()
  const res = c.match(/^(?:zdobadz|zbierz|wykop|przynies)\s+(.+?)(?:\s+(\d+))?$/)
  if (res) return getResource(res[1], parseInt(res[2] || '8'))
  if (/^(scraftuj|zrob|stworz|wykonaj)$/.test(verb)) return craftCommand(args.join(' '))
  if (/^(poluj|upoluj)$/.test(verb)) return huntCommand(args)
  if (c === 'spij' || c === 'idz spac') return sleepCommand()
  if (/^(buduj|zbuduj|postaw budynek)$/.test(verb)) return buildCommand(args.join(' '))
  if (/^(wystroj|udekoruj|urzadz|umebluj)$/.test(verb)) { say('Wystroj robie teraz od razu przy budowie: meble, lampy, dywany i obrazy sa w planie. Napisz "buduj <budowla>".'); return }
  if (/^(zburz|zniszcz)$/.test(verb) || /^usun budowl/.test(c)) return demolishCommand(args.join(' '))
  if (/^(usun|wyczysc|wykop|skasuj|zniszcz) obszar\b/.test(c)) return areaClearCommand(user, c.replace(/^\S+\s+obszar\s*/, ''))
  if (verb === 'usun' && args[0] && !findWaypoint(args.join(' ')) && matchBuildType(args.join(' '))) return demolishCommand(args.join(' '))
  if (/^(rozbierz|usun|posprzataj|sprzatnij) rusztowani/.test(c) || c === 'posprzataj') return cleanupCommand()
  if (c === 'przeszukaj' || c === 'przeszukaj skrzynie') return lootCommand()
  if (/^szukaj( skrzyn\w*)?$/.test(c)) return searchChestsCommand()
  if (/^skrzynie (wl|on|tak)/.test(c)) { lootEnabled = true; return say('Bede zagladal do znalezionych skrzyn.') }
  if (/^skrzynie (wyl|off|nie)/.test(c)) { lootEnabled = false; return say('Nie bede ruszal skrzyn.') }

  // --- ruch ---
  if (c === 'tu' || c === 'przyjdz' || c === 'chodz tu' || c === 'do mnie') {
    if (!player) { say('Z konsoli nie wiem, gdzie jestes. Uzyj "idz do <gracz>".'); return }
    return goToCommand([player])
  }
  const follow = c.match(/^(?:chodz|idz)\s+za\s+(\S+)$/) || c.match(/^za\s+(mna)$/)
  if (follow) return followCommand(player, follow[1] === 'mna' ? null : rest.split(/\s+/).pop(), false)
  if (/^(ochraniaj|chron|pilnuj)$/.test(verb)) return followCommand(player, !args[0] || args[0] === 'mnie' ? null : rest, true)
  if (/^(idz|ide|chodz|ruszaj)$/.test(verb) && args[0] === 'do') return goToCommand(args.slice(1))
  if (/^(idz|ide|chodz|ruszaj)$/.test(verb)) return walkCommand(args.join(' '))
  if (c === 'dom' || c === 'wroc do domu' || c === 'do domu') return goToCommand(['dom'])
  if (verb === 'zabij') return args[0] ? killCommand(rest) : say('Kogo? np. "zabij Nick", "zabij zombie", "zabij Burek".')
  if (/^(pomoz|pomoc)$/.test(verb) && !/^pomoc$/.test(c)) {
    const names = args.filter(a => !/^(w|przy|mu|jej|budowie|budowaniu|walce|burzeniu|wystroju)$/.test(a))
    const me = bot.username.toLowerCase()
    const isMe = n => n === me || (n.length >= 3 && me.startsWith(n))
    // "pomoc <kto> <komu>" - na czacie slysza to wszystkie boty, a reaguje tylko ten pierwszy
    if (names.length >= 2) return isMe(names[0]) ? helpNow(names[1]) : undefined
    if (names[0] && isMe(names[0])) return // "pomoc <moj nick>" - nikt nie pomaga sam sobie
    return helpCommand(names[0])
  }
  if (c === 'pomoz') return helpCommand(null)
  if (verb === 'popros') return requestCommand(rest)

  // --- punkty ---
  if (c === 'ustaw dom') return saveWaypoint('dom')
  if (/^(baza|ustaw baze|zapisz baze|tu jest baza|to jest baza|to baza|tu baza)$/.test(c)) {
    saveWaypoint('baza')
    return say('To miejsce jest teraz moja baza. "idz do bazy" - wracam tu najkrotsza droga.')
  }
  if (/^((idz |wroc |chodz )?do bazy|wroc|baza\?)$/.test(c)) return goToCommand(['baza'])
  if (verb === 'zapisz') return args[0] ? saveWaypoint(args.join(' ')) : say('Uzycie: zapisz <nazwa>')
  if (c === 'punkty') return listWaypoints()
  if (verb === 'usun') return args[0] ? deleteWaypoint(args.join(' ')) : say('Uzycie: usun <nazwa punktu>')
  if (/^(gdzie|pozycja|koordy|kordy)/.test(c)) return say(positionText())

  // --- rzeczy ---
  if (c === 'eq' || c === 'ekwipunek') return showInventory()
  const haveQ = c.match(/^(?:czy masz|masz|ile masz)\s+(.+)$/)
  if (haveQ) return haveCommand(haveQ[1])
  if (c === 'jedz') return eatNow()
  if (verb === 'daj' && args.length) { const { word, amount } = splitAmount(args.join(' ')); return giveItems(player, word, amount) }
  if (verb === 'wez' && args.length) { const { word, amount } = splitAmount(args.join(' ')); return withdrawCommand(word, amount) }
  if (verb === 'schowaj') return depositCommand(args.join(' ') || null)
  if (verb === 'wyrzuc' && args.length) { const { word, amount } = splitAmount(args.join(' ')); return tossCommand(word, amount) }
  if (verb === 'trzymaj' && args.length) return holdCommand(args.join(' '))
  if (verb === 'postaw') return placeCommand(args)
  if (c === 'zaloz' || /^zaloz zbroj/.test(c)) return wearArmorCommand()

  // wlasne komendy (makra)
  const mac = findMacro(c)
  if (mac) return runMacro(mac.macro, user, mac.args)

  const talk = SMALL_TALK.find(([re]) => re.test(c))
  if (talk) return say(talk[1](user))

  // nieznana komenda: odpowiadamy tylko na /msg i w konsoli, zeby nie odpowiadac na zwykla rozmowe na czacie
  // komenda wydana przez AI, ktorej bot nie zna - AI dostaje informacje zwrotna zamiast "Nie znam komendy" na czacie
  if (aiCmd.active) { aiCmd.unknown = true; return }
  // AI w grze: niezrozumiala wiadomosc do bota (jego nick, /msg, a w LAN kazda od gracza z ustawien) idzie do AI
  if (AI_ON && user && (aiAddressed || whisper || (LAN && process.env.MC_PLAYER)) && aiAllowed(user)) return askAi(user, text, whisper)
  const fromPlayer = !process.env.MC_PLAYER || user?.toLowerCase() === process.env.MC_PLAYER.toLowerCase()
  if (whisper || !user || (LAN && fromPlayer)) say(`Nie znam komendy "${text}". Napisz "komendy".`)
}

// ---------- stan dla GUI (MC_GUI=1): co sekunde jedna linia JSON na wyjsciu ----------
if (process.env.MC_GUI === '1') {
  setInterval(() => {
    const e = bot.entity
    const inv = {}
    try { for (const it of bot.inventory.items()) inv[it.name] = (inv[it.name] || 0) + it.count } catch {}
    const status = {
      connected: !!e && !!mcData,
      username: bot.username,
      health: bot.health, food: bot.food,
      pos: e ? { x: Math.floor(e.position.x), y: Math.floor(e.position.y), z: Math.floor(e.position.z) } : null,
      dim: bot.game?.dimension, gameMode: bot.game?.gameMode, time: bot.time?.timeOfDay,
      task: currentTask, step: taskStatus, mode,
      question: pendingQuestion ? true : false,
      held: bot.heldItem?.name || null,
      armor: [5, 6, 7, 8].map(sl => bot.inventory?.slots?.[sl]?.name || null),
      inventory: inv,
      waypoints,
      builds: builds.map(b => ({ type: b.type, origin: b.origin }))
    }
    process.stdout.write('@@STATUS ' + JSON.stringify(status) + '\n')
  }, 1000)
}

bot.on('death', () => { say('Zginalem, respawn...'); })
// powod wyrzucenia jako zwykly tekst (serwer przysyla JSON albo NBT z czatu - wczesniej w logu bylo samo "{")
function chatToText(r) {
  let v = r
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return v } }
  try { if (v && v.type && v.value !== undefined) v = require('prismarine-nbt').simplify(v) } catch {}
  const walk = x => {
    if (x == null) return ''
    if (typeof x !== 'object') return String(x)
    if (Array.isArray(x)) return x.map(walk).join('')
    return (x.text ?? x[''] ?? '') + (x.translate ? x.translate + (x.with ? ' (' + walk(x.with) + ')' : '') : '') + (x.extra ? walk(x.extra) : '')
  }
  return walk(v) || JSON.stringify(v)
}
bot.on('kicked', r => {
  const text = chatToText(r).replace(/\s+/g, ' ').trim()
  console.log('Wyrzucony: ' + text)
  if (/disconnect\.(incompatible|outdated)|outdated|incompatible client|version|wersj/i.test(text)) {
    console.log(`[bot] Inna wersja gry: bot (Mineflayer) obsluguje Minecrafta do ${require('minecraft-data').supportedVersions.pc.slice(-1)[0]}, a swiat dziala na innej (np. 26.x). Otworz swiat na LAN w wersji obslugiwanej przez bota albo wpisz wersje w ustawieniach bota.`)
  } else if (/mod|fabric|forge|fml|neoforge|registry|channel|payload/i.test(text)) {
    console.log('[bot] Ten swiat wymaga modow po stronie gracza. Bot to zwykly Minecraft bez modow - nie wejdzie. Mody tylko serwerowe (np. WorldEdit) nie przeszkadzaja; przeszkadzaja mody dodajace nowe bloki, przedmioty i moby.')
  }
})
bot.on('error', e => {
  console.log('Blad:', e.message || e.code)
  if (e.code === 'ECONNREFUSED') console.log('[bot] Nikt nie nasluchuje pod tym adresem - sprawdz port LAN albo czy serwer dziala.')
})
bot.on('end', reason => { console.log('Rozlaczony.', reason ? `Powod: ${reason}` : ''); process.exit(0) })
