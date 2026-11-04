// Asystent AI (Claude) w programie: doradza z komendami, tworzy budowle z opisu i nowe komendy bota.
// Dziala w procesie glownym Electrona - klucz API nie trafia do okna.
const Anthropic = require('@anthropic-ai/sdk')

const MODEL = 'claude-opus-5-5'
const MAX_STEPS = 8

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
2. Tworzyć nowe budowle - narzędzie create_building. Budowla trafia do zakładki Kreator i bot buduje ją komendą "buduj <nazwa>".
3. Tworzyć nowe komendy bota - narzędzie create_command. Komenda to lista kroków; bot wykona ją po wpisaniu jej nazwy.
4. Wysyłać polecenie do działającego bota - narzędzie run_bot_command (tylko gdy gracz prosi, żeby bot coś zrobił teraz).
5. Sprawdzić, które boty działają i co jest już zapisane - narzędzie get_state.

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
        bot: { type: 'string', description: 'Nick bota; puste = bot wybrany w programie' },
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

// host: { getKey, saveDesign, saveCommand, sendCommand, state, emit }
function createAssistant(host) {
  let messages = []

  async function runTool(name, input, ctx) {
    if (name === 'create_building') {
      if (!input || typeof input.name !== 'string' || !Array.isArray(input.parts) || !input.parts.length) return { error: 'Podaj name i niepustą listę parts.' }
      const spec = { name: input.name, description: input.description || '', seed: 1, parts: input.parts, source: 'ai' }
      const res = host.saveDesign(spec)
      if (!res.ok) return { error: res.error }
      host.emit({ type: 'design', key: res.key, name: input.name, spec })
      return { ok: true, saved_as: res.name, command: `buduj ${res.name}`, size: res.size, blocks: res.blocks, materials: res.materials.slice(0, 10), warnings: res.warnings }
    }
    if (name === 'create_command') {
      if (!input || typeof input.name !== 'string' || !Array.isArray(input.steps) || !input.steps.length) return { error: 'Podaj name i niepustą listę steps.' }
      const res = host.saveCommand({ name: input.name, description: input.description || '', steps: input.steps.map(String) })
      if (!res.ok) return { error: res.error }
      host.emit({ type: 'command', key: res.key, name: res.name, steps: input.steps })
      return { ok: true, saved_as: res.name }
    }
    if (name === 'run_bot_command') {
      if (!input || !input.command) return { error: 'Brak komendy.' }
      return host.sendCommand(input.bot || ctx.botId, String(input.command))
    }
    if (name === 'get_state') return host.state()
    return { error: 'Nieznane narzędzie: ' + name }
  }

  async function chat(text, ctx = {}) {
    const key = host.getKey()
    if (!key) return { ok: false, error: 'Brak klucza API. Wpisz go w zakładce Asystent → Ustawienia.' }
    const client = new Anthropic({ apiKey: key })
    messages.push({ role: 'user', content: String(text) })
    const replies = []
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const response = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          system: SYSTEM(),
          tools: TOOLS,
          messages
        })
        // cala odpowiedz (z blokami myslenia) wraca do historii
        messages.push({ role: 'assistant', content: response.content })
        for (const b of response.content) if (b.type === 'text' && b.text.trim()) replies.push(b.text)
        if (response.stop_reason === 'refusal') { replies.push('(Asystent odmówił odpowiedzi na to pytanie.)'); break }
        if (response.stop_reason === 'max_tokens') { replies.push('(Odpowiedź była za długa i została ucięta - spróbuj mniejszej budowli.)'); break }
        const uses = response.content.filter(b => b.type === 'tool_use')
        if (response.stop_reason !== 'tool_use' || !uses.length) break
        const results = []
        for (const u of uses) {
          host.emit({ type: 'tool', name: u.name, input: u.input })
          let out
          try { out = await runTool(u.name, u.input, ctx) } catch (e) { out = { error: e.message } }
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 8000), is_error: !!out?.error })
        }
        messages.push({ role: 'user', content: results })
      }
      return { ok: true, text: replies.join('\n\n') || '(brak odpowiedzi)' }
    } catch (e) {
      // nieudana tura nie zostaje w historii - kolejna wiadomosc zaczyna od czystego stanu
      messages = messages.slice(0, messages.findLastIndex(m => m.role === 'user' && typeof m.content === 'string'))
      if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: 'Zły klucz API - sprawdź go w ustawieniach asystenta.' }
      if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: 'Ten klucz API nie ma dostępu do modelu.' }
      if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'Za dużo zapytań naraz - spróbuj za chwilę.' }
      if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: 'Brak połączenia z internetem.' }
      if (e instanceof Anthropic.APIError) return { ok: false, error: `Błąd API (${e.status}): ${e.message}` }
      return { ok: false, error: e.message }
    }
  }

  return { chat, reset: () => { messages = [] } }
}

module.exports = { createAssistant, MODEL }
