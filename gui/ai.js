// Asystent AI: w programie (zakladka Asystent) i w grze (bot odpowiada na czacie).
// Doradza z komendami, tworzy budowle z opisu i nowe komendy, wydaje polecenia botom.
// Dwa silniki do wyboru: Gemini (Google, darmowy limit) albo Claude (Anthropic).
// Dziala w procesie glownym Electrona - klucze API nie trafiaja do okna ani do gry.
const Anthropic = require('@anthropic-ai/sdk')

const CLAUDE_MODEL = 'claude-opus-5-5'
const MAX_STEPS = 8
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'

// opis komend dla modelu: z tej samej listy, z ktorej korzysta okno (data.js ustawia window.COMMANDS)
function commandList() {
  try {
    const w = {}
    // eslint-disable-next-line no-new-func
    new Function('window', require('fs').readFileSync(require('path').join(__dirname, 'data.js'), 'utf8'))(w)
    return w.COMMANDS.map(c => `- ${c.cmd} - ${c.desc}`).join('\n')
  } catch { return '' }
}

const SYSTEM = () => `Jesteś asystentem w programie "Minecraft Bot" (centrum sterowania botów do Minecraft Java).
Program uruchamia boty (Mineflayer), które wchodzą do gry jako gracze i wykonują polecenia po polsku.
Rozmawiasz z graczami, często dziećmi na kółku informatycznym: pisz po polsku, krótko, prosto i przyjaźnie. Bez długich wstępów.

Co umiesz:
1. Doradzać, jak coś zrobić botem - podawaj gotowe komendy (w backtickach), które gracz wpisze na czacie gry albo w programie.
2. Tworzyć nowe budowle - narzędzie create_building. Budowla trafia do zakładki Kreator i bot buduje ją komendą "buduj <nazwa>" (od razu z wystrojem wnętrz).
3. Tworzyć nowe komendy bota - narzędzie create_command. Komenda to lista kroków; bot wykona ją po wpisaniu jej nazwy.
4. Wysyłać polecenie do działającego bota - narzędzie run_bot_command (gdy gracz prosi, żeby bot coś zrobił).
5. Sprawdzić, które boty działają, co robią i co jest już zapisane - narzędzie get_state.

Komendy bota:
${commandList()}
Dodatkowe: projekty (lista budowli z kreatora), buduj <projekt>, moje komendy, naucz się <nazwa>: krok; krok, zapomnij komendę <nazwa>, kontynuuj.

BUDOWLE (create_building). Układ: x w prawo, z do przodu (od bota), y w górę. Drzwi/front głównej części w (0,0,0), budowla stoi przed botem (z >= 0).
Budowla to lista części "parts". Każda część ma "kind", pozycję x,y,z (przesunięcie) i parametry:
- house: w (szerokość, nieparzysta), d (głębokość), floors, storey (wysokość piętra, 4), wall, wall2 (wyższe piętra), corner, floor, foundation,
  roof {type: gable|hip|pyramid|flat|dome|none, mat, steep (1-3), overhang, axis x|z, tip (blok na szczycie)},
  windows {block (np. glass, red_stained_glass, none), every (co ile), style: "big" (całe przeszklone), tall},
  chimney, porch, balcony, columns (materiał), terrace (taras na płaskim dachu), battlements, pagoda (dachy na każdym piętrze),
  towers (liczba wież w rogach), towerRoof (cone|dome|battlements), doorWidth (szeroka brama)
- tower: shape square|round, size (nieparzysta), h, mat, mat2 (pasy), roof {type: battlements|cone|pyramid|spire|dome|flat, mat, tip}, door front|back|left|right|none
- castle: w, d, h (mury), mat, towers (0-8), towerShape square|round, towerSize, towerH, towerRoof, roofMat, keep (donżon true/false)
- walls: w, d, h, mat, gate; church: w, d, h, wall, roofMat, glass; pyramid: size, mat; lighthouse: r, h, mat, mat2, roofMat
- windmill: w, h, wall, wall2, roofMat, sail; bridge: length, w, mat, pillar; well; gazebo: r, mat, roofMat; igloo: r; arena: r, mat
- skyscraper: w, d, floors, wall, corner; barn: jak house
- fence: x1, x2, z1, z2 (prostokąt płotu, furtka z przodu przy x=0), mat, flowers, lamps; tree: wood, h; lamp: h, post, light
- box: w, d, h, block, hollow; cylinder: r, h, block, hollow; sphere: r, block, hollow
- voxels: dowolny kształt (posągi, zwierzęta, rzeźby, statki, litery 3D). palette: {"Y": "yellow_wool", ...}, layers: [{y: 0, rows: ["..YY..", ".YYYY."]}]
  Każda warstwa to poziom y (od dołu), wiersz = z (od przodu, 0 = najbliżej bota), znak = x (środek wiersza to x = 0). "." = pusto, "_" = wymuszone powietrze.
  Zamiast warstw (albo obok nich): blocks - lista {x, y, z, block} z opcjami: attach {x,y,z} (do którego sąsiada przyczepić: dźwignia, drabina),
  look {x,y,z} (gdzie bot patrzy przy stawianiu - tłok/dozownik patrzy głowicą w stronę bota), late: true (postaw na końcu, np. dźwignię), optional.
  Do posągów i zwierząt (np. kurczak, creeper, smok) używaj voxels: odwzoruj kształt i kolory z gry jak najwierniej, w odpowiedniej skali
  (mały mob 1:1 to kilka bloków; "duży posąg" to 2-6x). Rób bryłę pełną albo z sensowną grubością ścian i pamiętaj o nogach jako podporze.
Materiały to nazwy bloków Minecraft Java (np. oak_planks, spruce, stone_bricks, cobblestone, bricks, quartz, deepslate_tiles, white_concrete,
yellow_wool, glass, lantern) albo skróty drewna (oak, spruce, birch, dark_oak, cherry...). Schody i płyty dobierają się same.
Rozmiar: zwykle do 40x40x40. W survivalu bot sam zdobędzie drewno, bruk, kamień, szkło, cegły; resztę trzeba mu dać albo budować w kreatywnym - powiedz o tym.
Nazwa budowli: krótka, po polsku (bot buduje ją komendą "buduj <nazwa>"), nie taka jak wbudowane (dom, zamek, pałac...).

KOMENDY (create_command): name (jedno-dwa słowa), description, steps - lista kroków. Krok to zwykła komenda bota albo:
powiedz <tekst> | czekaj <sekundy> | powtórz <n>: <krok> | szukaj moba <mob po polsku lub angielsku> | szukaj bloku <blok> |
idź do celu | ogrodź cel [płotem|murkiem|<blok>] [promień] | ogrodź siebie [płotem] [promień] | zabij cel | jeśli masz <rzecz>: <krok>
W krokach: $1, $2 - słowa wpisane po nazwie komendy, $* - wszystkie, $gracz - kto wydał komendę.
Przykład (tylko wzór): name "owce", steps ["szukaj moba owca", "idź do celu", "ogrodź cel płotem 3", "powiedz Owca ogrodzona!"].

Po utworzeniu budowli lub komendy powiedz krótko, co zrobiłeś i jak tego użyć (np. "Napisz botowi: buduj kurczak").`

// dopisek, gdy rozmowa toczy sie na czacie gry
const IN_GAME = ctx => `

TERAZ JESTEŚ W GRZE: nazywasz się ${ctx.botName} i jesteś botem w Minecrafcie. Piszesz na czacie gry z graczem ${ctx.player || '(gracz)'}.${ctx.persona ? `
- TWOJA ROLA: ${ctx.persona} Odpowiadaj zawsze jako ta postać (po polsku), ale komendy bota wykonuj normalnie.` : ''}
- Odpowiadaj bardzo krótko: 1-2 zdania, najwyżej 200 znaków. Bez markdown, bez backticków, bez list i emoji.
- Gdy gracz prosi, żebyś coś zrobił, zrób to sam narzędziem run_bot_command (bez parametru bot - polecenie trafi do Ciebie)
  zamiast tłumaczyć komendy. Długie zadania (zdobywanie, budowa) uruchom i krótko powiedz, że się za to bierzesz.
- Gdy prosi o nową budowlę: create_building, a potem run_bot_command "buduj <nazwa>", jeśli chce, żeby od razu stanęła.
- Komendy serwera zaczynające się od "/" są dla Ciebie zablokowane.
- Używaj tylko komend z listy, dokładnie w tej postaci. Jeśli narzędzie zwróci błąd, popraw komendę albo powiedz graczowi, czego brakuje.
- Na zwykłą rozmowę (powitanie, pytanie) odpowiadaj samym tekstem, bez narzędzi.`

const TOOLS = [
  {
    name: 'create_building',
    description: 'Tworzy (albo nadpisuje) budowlę w kreatorze programu. Bot zbuduje ją komendą "buduj <name>".',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Krótka nazwa po polsku' },
        description: { type: 'string', description: 'Opis budowli' },
        parts: { type: 'array', description: 'Części budowli (kind + parametry)', items: { type: 'object' } }
      },
      required: ['name', 'parts']
    }
  },
  {
    name: 'create_command',
    description: 'Tworzy (albo nadpisuje) własną komendę bota z listy kroków.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        steps: { type: 'array', items: { type: 'string' } }
      },
      required: ['name', 'steps']
    }
  },
  {
    name: 'run_bot_command',
    description: 'Wysyła polecenie do działającego bota (tak, jakby gracz wpisał je w programie).',
    input_schema: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Nick bota; puste = bot wybrany w programie (albo ten, z którym rozmawiasz w grze)' },
        command: { type: 'string' }
      },
      required: ['command']
    }
  },
  {
    name: 'get_state',
    description: 'Zwraca listę botów (działające, ich stan), zapisanych budowli i własnych komend.',
    input_schema: { type: 'object', properties: {} }
  }
]

// Gemini: schematy w podzbiorze OpenAPI - lista czesci budowli idzie jako tekst JSON (obiekty bez pol sa tam odrzucane)
const GEMINI_TOOLS = [{
  functionDeclarations: [
    {
      name: 'create_building',
      description: TOOLS[0].description,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Krótka nazwa po polsku' },
          description: { type: 'string', description: 'Opis budowli' },
          parts_json: { type: 'string', description: 'Lista części budowli jako tekst JSON, np. [{"kind":"house","x":0,"z":0,"w":9,"d":9}]' }
        },
        required: ['name', 'parts_json']
      }
    },
    { name: 'create_command', description: TOOLS[1].description, parameters: TOOLS[1].input_schema },
    { name: 'run_bot_command', description: TOOLS[2].description, parameters: TOOLS[2].input_schema },
    { name: 'get_state', description: TOOLS[3].description }
  ]
}]

// Modele "flash" dostepne dla klucza, od najlepszego (lista z API, wiec nowe wersje Gemini dzialaja bez zmian w programie):
// najnowsze stabilne, potem preview, na koncu lzejsze "lite". Gdy model ma wyczerpany limit albo jest przeciazony,
// asystent przechodzi na nastepny z listy.
let geminiModelsCache = null
async function geminiModels(key) {
  if (geminiModelsCache && geminiModelsCache.key === key && Date.now() - geminiModelsCache.at < 3600000) return geminiModelsCache.list
  let list = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
  try {
    const r = await fetch(`${GEMINI_API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20000) })
    const j = await r.json()
    if (!r.ok) { const e = new Error(j.error?.message || `HTTP ${r.status}`); e.status = r.status; throw e }
    const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0')
    const names = (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini-[\d.]+-flash(-lite)?(-preview)?$/.test(n))
    const rank = n => (/lite/.test(n) ? 2 : 0) + (/preview/.test(n) ? 1 : 0)
    names.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a))
    if (names.length) list = names
  } catch (e) {
    if (e.status === 400 || e.status === 401 || e.status === 403) throw e
  }
  geminiModelsCache = { key, list, at: Date.now() }
  return list
}
// model z wyczerpanym limitem (429) odpoczywa 15 min, przeciazony (503) - 5 min, nieistniejacy (404) - dobe
let geminiCooldown = new Map()
const coolingDown = m => (geminiCooldown.get(m) || 0) > Date.now()
// model, ktory ostatnio odpowiedzial - od niego zaczynamy (najnowsze bywaja przeciazone i dlugo zwracaja blad)
// ostatni dzialajacy model osobno dla gry (szybkie modele Lite) i dla okna programu
let lastGood = { game: null, app: null }
let cacheFile = null
function loadModelCache(file) {
  cacheFile = file
  try {
    const c = JSON.parse(require('fs').readFileSync(file, 'utf8'))
    geminiCooldown = new Map(Object.entries(c.cooldown || {}).filter(([, t]) => t > Date.now()))
    lastGood = { game: null, app: null, ...(c.lastGood || {}) }
  } catch {}
}
function saveModelCache() {
  if (!cacheFile) return
  try { require('fs').writeFileSync(cacheFile, JSON.stringify({ cooldown: Object.fromEntries(geminiCooldown), lastGood })) } catch {}
}
// modele, ktore nie przyjmuja ustawienia myslenia - wysylamy bez niego
const noThinkingConfig = new Set()

async function geminiCall(key, model, body, timeoutMs = 45000) {
  let r
  try {
    r = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs) // model, ktory nie odpowiada - przechodzimy na nastepny
    })
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw Object.assign(new Error(`Model nie odpowiedział w ${timeoutMs / 1000} s.`), { status: 504 })
    throw e
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = new Error(j.error?.message || `HTTP ${r.status}`)
    e.status = r.status
    // Google podaje, za ile odnowi sie limit (np. "52442s") i czy to limit dzienny
    for (const d of j.error?.details || []) {
      if (d.retryDelay) e.retryMs = parseFloat(d.retryDelay) * 1000
      if ((d.violations || []).some(v => /PerDay/i.test(v.quotaId || ''))) e.perDay = true
    }
    throw e
  }
  return j
}

// host: { getProvider, getKey(provider), saveDesign, saveCommand, sendCommand, state, emit }
function createAssistant(host) {
  if (host.modelCacheFile) loadModelCache(host.modelCacheFile)
  // osobna rozmowa dla okna programu i dla kazdego bota w grze
  const convs = new Map()
  const conv = (id, provider) => {
    let c = convs.get(id)
    if (!c || c.provider !== provider) { c = { provider, messages: [] }; convs.set(id, c) }
    return c
  }

  async function runTool(name, input, ctx) {
    input = input || {}
    if (name === 'create_building') {
      let parts = input.parts
      if (!parts && typeof input.parts_json === 'string') {
        try { parts = JSON.parse(input.parts_json) } catch (e) { return { error: 'parts_json to nie jest poprawny JSON: ' + e.message } }
      }
      if (typeof input.name !== 'string' || !Array.isArray(parts) || !parts.length) return { error: 'Podaj name i niepustą listę części.' }
      const spec = { name: input.name, description: input.description || '', seed: 1, parts, source: 'ai' }
      const res = host.saveDesign(spec)
      if (!res.ok) return { error: res.error }
      host.emit({ type: 'design', key: res.key, name: input.name, spec, botId: ctx.inGame ? ctx.botId : null })
      return { ok: true, saved_as: res.name, command: `buduj ${res.name}`, size: res.size, blocks: res.blocks, materials: res.materials.slice(0, 10), warnings: res.warnings }
    }
    if (name === 'create_command') {
      if (typeof input.name !== 'string' || !Array.isArray(input.steps) || !input.steps.length) return { error: 'Podaj name i niepustą listę steps.' }
      const res = host.saveCommand({ name: input.name, description: input.description || '', steps: input.steps.map(String) })
      if (!res.ok) return { error: res.error }
      host.emit({ type: 'command', key: res.key, name: res.name, steps: input.steps })
      return { ok: true, saved_as: res.name }
    }
    if (name === 'run_bot_command') {
      const cmd = String(input.command || '').trim()
      if (!cmd) return { error: 'Brak komendy.' }
      if (cmd.startsWith('/')) return { error: 'Komendy serwera (z "/") są zablokowane dla asystenta.' }
      return host.sendCommand(input.bot || ctx.botId, cmd)
    }
    if (name === 'get_state') return host.state()
    return { error: 'Nieznane narzędzie: ' + name }
  }

  const callTool = async (name, input, ctx) => {
    host.emit({ type: 'tool', name, input, botId: ctx.inGame ? ctx.botId : null })
    try { return await runTool(name, input, ctx) } catch (e) { return { error: e.message } }
  }

  // ---------- Claude ----------
  async function chatClaude(key, c, system, ctx) {
    const client = new Anthropic({ apiKey: key })
    const replies = []
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: ctx.inGame ? 'low' : 'medium' },
        cache_control: { type: 'ephemeral' },
        system,
        tools: TOOLS,
        messages: c.messages
      })
      // cala odpowiedz (z blokami myslenia) wraca do historii
      c.messages.push({ role: 'assistant', content: response.content })
      for (const b of response.content) if (b.type === 'text' && b.text.trim()) replies.push(b.text)
      if (response.stop_reason === 'refusal') { replies.push('(Asystent odmówił odpowiedzi na to pytanie.)'); break }
      if (response.stop_reason === 'max_tokens') { replies.push('(Odpowiedź była za długa i została ucięta - spróbuj mniejszej budowli.)'); break }
      const uses = response.content.filter(b => b.type === 'tool_use')
      if (response.stop_reason !== 'tool_use' || !uses.length) break
      const results = []
      for (const u of uses) {
        const out = await callTool(u.name, u.input, ctx)
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 8000), is_error: !!out?.error })
      }
      c.messages.push({ role: 'user', content: results })
    }
    return replies
  }

  // ---------- Gemini ----------
  // proba na kolejnych modelach; przy zmianie modelu tura zaczyna sie od nowa od pytania gracza
  async function chatGemini(key, c, system, ctx, mark) {
    const models = await geminiModels(key)
    let lastErr = null
    const mode = ctx.inGame ? 'game' : 'app'
    const base = ctx.inGame ? [...models.filter(m => /lite/.test(m)), ...models.filter(m => !/lite/.test(m))] : models
    const good = lastGood[mode]
    const order = good && base.includes(good) ? [good, ...base.filter(m => m !== good)] : base
    for (let i = 0; i < order.length; i++) {
      const model = order[i]
      if (coolingDown(model)) continue
      try {
        const res = await geminiTurn(key, model, c, system, ctx)
        if (lastGood[mode] !== model) { lastGood[mode] = model; saveModelCache() }
        return res
      } catch (e) {
        lastErr = e
        c.messages.splice(mark + 1)
        // model nie przyjmuje ustawienia myslenia - ten sam model jeszcze raz, bez niego
        if (e.status === 400 && /thinking/i.test(e.message) && !noThinkingConfig.has(model)) { noThinkingConfig.add(model); i--; continue }
        if (![429, 500, 503, 504, 404].includes(e.status)) throw e
        if (model === lastGood[mode]) lastGood[mode] = null
        // limit: tyle, ile poda Google (dzienny - zwykle do rana), inaczej domyslnie
        const wait = e.status === 429 && e.retryMs ? Math.min(e.retryMs + 60000, 26 * 3600000) : e.status === 404 ? 24 * 3600000 : e.status === 429 ? (e.perDay ? 12 * 3600000 : 15 * 60000) : 5 * 60000
        geminiCooldown.set(model, Date.now() + wait)
        saveModelCache()
        console.log(`[ai] ${model}: ${e.status} - probuje nastepny model`)
      }
    }
    throw lastErr || Object.assign(new Error('Wszystkie modele Gemini mają teraz wyczerpany limit.'), { status: 429 })
  }

  async function geminiTurn(key, model, c, system, ctx) {
    const replies = []
    const done = [] // narzedzia wykonane w tej turze
    for (let step = 0; step < MAX_STEPS; step++) {
      let j
      try {
        j = await geminiCall(key, model, {
          systemInstruction: { parts: [{ text: system }] },
          contents: c.messages,
          tools: GEMINI_TOOLS,
          // krotkie myslenie: odpowiedz w kilka sekund zamiast kilkudziesieciu
          generationConfig: noThinkingConfig.has(model) ? { maxOutputTokens: 16384 } : { maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: 'low' } }
        }, ctx.inGame ? 25000 : 45000) // w grze gracz czeka na czacie - zawieszony model szybciej zmieniamy
      } catch (e) {
        // narzedzia juz zadzialaly (np. bot dostal komende) - nie powtarzamy tury na innym modelu, tylko ja konczymy
        if (!done.length) throw e
        const text = replies.length ? replies.join(' ') : ctx.inGame ? 'Już się za to biorę!' : `Zrobione (${done.join(', ')}).`
        c.messages.push({ role: 'model', parts: [{ text }] })
        return { replies: replies.length ? replies : [text], model }
      }
      const cand = j.candidates?.[0]
      if (!cand?.content?.parts) {
        replies.push(j.promptFeedback?.blockReason ? '(Gemini nie odpowiedział na to pytanie.)' : '(Brak odpowiedzi od Gemini.)')
        break
      }
      // odpowiedz modelu wraca do historii bez zmian (z podpisami myslenia przy wywolaniach narzedzi)
      c.messages.push(cand.content)
      for (const p of cand.content.parts) if (p.text && !p.thought && p.text.trim()) replies.push(p.text)
      if (cand.finishReason === 'MAX_TOKENS') { replies.push('(Odpowiedź była za długa i została ucięta - spróbuj mniejszej budowli.)'); break }
      const calls = cand.content.parts.filter(p => p.functionCall)
      if (!calls.length) break
      const responses = []
      for (const p of calls) {
        const out = await callTool(p.functionCall.name, p.functionCall.args, ctx)
        done.push(p.functionCall.name)
        const json = JSON.stringify(out ?? {})
        const fr = { name: p.functionCall.name, response: json.length > 8000 ? { result: json.slice(0, 8000) } : (out ?? {}) }
        if (p.functionCall.id) fr.id = p.functionCall.id
        responses.push({ functionResponse: fr })
      }
      c.messages.push({ role: 'user', parts: responses })
    }
    return { replies, model }
  }

  // ctx: { conv: 'app' | 'bot:<id>', botId, inGame, botName, player }
  async function chat(text, ctx = {}) {
    const provider = host.getProvider()
    const key = host.getKey(provider)
    if (!key) return { ok: false, error: provider === 'gemini' ? 'Brak klucza Gemini - wpisz go w ustawieniach bota albo w zakładce Asystent AI.' : 'Brak klucza API Claude - wpisz go w zakładce Asystent AI.' }
    const c = conv(ctx.conv || 'app', provider)
    const system = SYSTEM() + (ctx.inGame ? IN_GAME(ctx) : '')
    const mark = c.messages.length
    c.messages.push(provider === 'gemini' ? { role: 'user', parts: [{ text: String(text) }] } : { role: 'user', content: String(text) })
    try {
      let replies
      let model = CLAUDE_MODEL
      if (provider === 'gemini') ({ replies, model } = await chatGemini(key, c, system, ctx, mark))
      else replies = await chatClaude(key, c, system, ctx)
      // dluga rozmowa w grze: trzymamy tylko ostatnie wymiany (tanio i szybko)
      if (ctx.inGame && c.messages.length > 40) c.messages.splice(0, c.messages.length - 40)
      while (c.messages.length && !isUserText(c.messages[0])) c.messages.shift()
      return { ok: true, text: replies.join('\n\n') || '(brak odpowiedzi)', model }
    } catch (e) {
      // nieudana tura nie zostaje w historii - kolejna wiadomosc zaczyna od czystego stanu
      c.messages.splice(mark)
      return { ok: false, error: errorText(provider, e) }
    }
  }

  return { chat, reset: id => { if (id) convs.delete(id); else convs.clear() } }
}

const isUserText = m => m.role === 'user' && (typeof m.content === 'string' || (Array.isArray(m.parts) && m.parts.some(p => p.text)))

function errorText(provider, e) {
  if (provider === 'gemini') {
    if (e.status === 400 && /API key/i.test(e.message)) return 'Zły klucz Gemini - sprawdź go w ustawieniach.'
    if (e.status === 401 || e.status === 403) return 'Klucz Gemini nie ma dostępu - sprawdź go w ustawieniach.'
    if (e.status === 429) return 'Wyczerpany limit zapytań Gemini - spróbuj za chwilę (darmowy limit odnawia się co minutę i co dobę).'
    if (e.status) return `Błąd Gemini (${e.status}): ${e.message}`
    return /fetch failed|ENOTFOUND|ECONN/i.test(e.message) ? 'Brak połączenia z internetem.' : e.message
  }
  if (e instanceof Anthropic.AuthenticationError) return 'Zły klucz API - sprawdź go w ustawieniach asystenta.'
  if (e instanceof Anthropic.PermissionDeniedError) return 'Ten klucz API nie ma dostępu do modelu.'
  if (e instanceof Anthropic.RateLimitError) return 'Za dużo zapytań naraz - spróbuj za chwilę.'
  if (e instanceof Anthropic.APIConnectionError) return 'Brak połączenia z internetem.'
  if (e instanceof Anthropic.APIError) return `Błąd API (${e.status}): ${e.message}`
  return e.message
}

module.exports = { createAssistant, CLAUDE_MODEL }
