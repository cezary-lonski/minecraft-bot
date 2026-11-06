// Mody botow (zakladka "Mody" w programie). To nie sa prawdziwe mody do gry - nic nie trzeba instalowac w Minecrafcie:
// - paczki przedmiotow: komendy "daj <rzecz>" - bot wpisuje /give z nazwa i zakleciami (swiat musi miec wlaczone kody),
// - zachowania: nowe umiejetnosci botow (lepsza walka, clutche, wiedza o mobach, lucznictwo).
// Uzywane przez okno programu (karty modow) i przez bota (komendy, zachowania).
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ModsLib = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  // przedmiot: key (to, co piszesz po "daj"), aliases, name (nazwa w grze), item, color, ench, unbreakable, lore, count,
  // effects (mikstury: [id, poziom, sekundy]), potionColor; parts - kilka przedmiotow naraz (np. cala zbroja)
  const MODS = [
    {
      id: 'narzedzia', kind: 'items', icon: '⚔', name: 'Nowe narzędzia',
      desc: 'Legendarne bronie i narzędzia z mocnymi zaklęciami i własnymi nazwami.',
      items: [
        { key: 'excalibur', name: 'Excalibur', item: 'netherite_sword', color: 'gold', lore: 'Miecz wyciagniety z kamienia', ench: { sharpness: 10, fire_aspect: 2, looting: 5, sweeping_edge: 3 }, unbreakable: true },
        { key: 'mlot thora', aliases: ['mjolnir', 'mlot'], name: 'Mlot Thora', item: 'mace', color: 'aqua', lore: 'Uderza jak piorun', ench: { density: 5, breach: 4, wind_burst: 3 }, unbreakable: true },
        { key: 'kilof krasnoluda', aliases: ['kilof'], name: 'Kilof Krasnoluda', item: 'netherite_pickaxe', color: 'yellow', ench: { efficiency: 10, fortune: 5 }, unbreakable: true },
        { key: 'topor drwala', aliases: ['topor', 'siekiera'], name: 'Topor Drwala', item: 'netherite_axe', color: 'green', ench: { efficiency: 10, sharpness: 6 }, unbreakable: true },
        { key: 'luk legolasa', aliases: ['luk'], name: 'Luk Legolasa', item: 'bow', color: 'green', lore: 'Nigdy nie chybia', ench: { power: 10, punch: 3, flame: 1, infinity: 1 }, unbreakable: true, extra: [['arrow', 1]] },
        { key: 'trojzab posejdona', aliases: ['trojzab'], name: 'Trojzab Posejdona', item: 'trident', color: 'blue', ench: { loyalty: 3, impaling: 10, channeling: 1 }, unbreakable: true },
        { key: 'kusza lowcy', aliases: ['kusza'], name: 'Kusza Lowcy', item: 'crossbow', color: 'red', ench: { quick_charge: 3, multishot: 1 }, unbreakable: true, extra: [['arrow', 64]] },
        { key: 'lopata grabarza', aliases: ['lopata'], name: 'Lopata Grabarza', item: 'netherite_shovel', color: 'dark_gray', ench: { efficiency: 10 }, unbreakable: true }
      ]
    },
    {
      id: 'zbroje', kind: 'items', icon: '🛡', name: 'Legendarne zbroje',
      desc: 'Zbroje, które prawie nie dają się zranić, buty do biegania po wodzie i elytra.',
      items: [
        {
          key: 'zbroja smoka', aliases: ['zbroja'], name: 'Zbroja Smoka',
          parts: [
            { name: 'Helm Smoka', item: 'netherite_helmet', color: 'dark_purple', ench: { protection: 10, respiration: 3, aqua_affinity: 1 }, unbreakable: true },
            { name: 'Napiersnik Smoka', item: 'netherite_chestplate', color: 'dark_purple', ench: { protection: 10, thorns: 3 }, unbreakable: true },
            { name: 'Nogawice Smoka', item: 'netherite_leggings', color: 'dark_purple', ench: { protection: 10, swift_sneak: 3 }, unbreakable: true },
            { name: 'Buty Smoka', item: 'netherite_boots', color: 'dark_purple', ench: { protection: 10, feather_falling: 10 }, unbreakable: true }
          ]
        },
        { key: 'buty hermesa', aliases: ['buty'], name: 'Buty Hermesa', item: 'netherite_boots', color: 'aqua', lore: 'Szybkie jak wiatr', ench: { feather_falling: 10, depth_strider: 3, soul_speed: 3, frost_walker: 2 }, unbreakable: true },
        { key: 'elytra feniksa', aliases: ['elytra', 'skrzydla'], name: 'Elytra Feniksa', item: 'elytra', color: 'gold', ench: { mending: 1 }, unbreakable: true, extra: [['firework_rocket', 64]] },
        { key: 'tarcza rycerza', aliases: ['tarcza'], name: 'Tarcza Rycerza', item: 'shield', color: 'white', unbreakable: true }
      ]
    },
    {
      id: 'mikstury', kind: 'items', icon: '🧪', name: 'Magiczne mikstury',
      desc: 'Mikstury, których nie da się uwarzyć: długie i bardzo mocne.',
      items: [
        { key: 'mikstura szybkosci', aliases: ['szybkosc'], name: 'Mikstura Szybkosci', item: 'potion', color: 'aqua', potionColor: 3402751, effects: [['speed', 3, 600]] },
        { key: 'mikstura sily', aliases: ['sila'], name: 'Mikstura Sily', item: 'potion', color: 'red', potionColor: 16711680, effects: [['strength', 3, 600]] },
        { key: 'eliksir zycia', aliases: ['zycie'], name: 'Eliksir Zycia', item: 'potion', color: 'light_purple', potionColor: 16738740, effects: [['regeneration', 2, 120], ['absorption', 4, 600], ['resistance', 1, 600]] },
        { key: 'mikstura skoku', aliases: ['skok'], name: 'Mikstura Skoku', item: 'potion', color: 'green', potionColor: 5635925, effects: [['jump_boost', 3, 600], ['slow_falling', 0, 600]] },
        { key: 'mikstura niewidzialnosci', aliases: ['niewidzialnosc'], name: 'Peleryna w butelce', item: 'potion', color: 'gray', potionColor: 8356754, effects: [['invisibility', 0, 900], ['night_vision', 0, 900]] },
        { key: 'mikstura gornika', aliases: ['gornik'], name: 'Mikstura Gornika', item: 'potion', color: 'yellow', potionColor: 16766720, effects: [['haste', 2, 900], ['night_vision', 0, 900]] }
      ]
    },
    {
      id: 'magia', kind: 'items', icon: '🪄', name: 'Magia (Świat Harry\'ego)',
      desc: 'Różdżki, które naprawdę czarują: trzymasz różdżkę i machasz (lewy przycisk myszy), a bot rzuca czar komendami gry. Do tego miotły (elytry z rakietami).',
      items: [
        { key: 'rozdzka ognia', aliases: ['incendio'], name: 'Rozdzka Ognia', item: 'blaze_rod', color: 'gold', lore: 'Incendio! - zieje ogniem', glint: true, wand: 'ogien' },
        { key: 'rozdzka lodu', aliases: ['glacius'], name: 'Rozdzka Lodu', item: 'breeze_rod', color: 'aqua', lore: 'Glacius! - zamraza', glint: true, wand: 'lod' },
        { key: 'rozdzka blyskawic', aliases: ['blyskawica'], name: 'Rozdzka Blyskawic', item: 'stick', color: 'yellow', lore: 'Piorun tam, gdzie patrzysz', glint: true, wand: 'piorun' },
        { key: 'rozdzka lewitacji', aliases: ['wingardium leviosa', 'leviosa'], name: 'Rozdzka Lewitacji', item: 'stick', color: 'light_purple', lore: 'Wingardium Leviosa!', glint: true, wand: 'lewitacja' },
        { key: 'rozdzka leczenia', aliases: ['episkey'], name: 'Rozdzka Leczenia', item: 'stick', color: 'green', lore: 'Episkey! - leczy', glint: true, wand: 'leczenie' },
        { key: 'rozdzka swiatla', aliases: ['lumos'], name: 'Rozdzka Swiatla', item: 'end_rod', color: 'white', lore: 'Lumos! - swiatlo', glint: true, wand: 'swiatlo' },
        { key: 'czarna rozdzka', aliases: ['starsza rozdzka', 'czarna rozdzka'], name: 'Czarna Rozdzka', item: 'stick', color: 'dark_purple', lore: 'Najpotezniejsza z rozdzek', glint: true, wand: 'czarna' },
        { key: 'nimbus 2000', aliases: ['nimbus', 'miotla'], name: 'Nimbus 2000', item: 'elytra', color: 'gold', lore: 'Miotla wyscigowa', ench: { mending: 1 }, unbreakable: true, extra: [['firework_rocket', 64]] },
        { key: 'blyskawica', aliases: ['firebolt'], name: 'Blyskawica', item: 'elytra', color: 'red', lore: 'Najszybsza miotla swiata', ench: { mending: 1 }, unbreakable: true, extra: [['firework_rocket', 64]] },
        { key: 'kometa', name: 'Kometa 260', item: 'elytra', color: 'aqua', lore: 'Dobra miotla na poczatek', unbreakable: true, extra: [['firework_rocket', 32]] }
      ]
    },
    {
      id: 'uczta', kind: 'items', icon: '🍗', name: 'Uczta',
      desc: 'Najlepsze jedzenie: magiczne złote jabłka, steki i ciasto.',
      items: [
        { key: 'zlote jablka', aliases: ['jablka', 'zlote jablko'], name: null, item: 'enchanted_golden_apple', count: 16 },
        { key: 'steki', aliases: ['stek', 'jedzenie'], name: 'Stek Olbrzyma', item: 'cooked_beef', color: 'gold', count: 64 },
        { key: 'ciasto', name: 'Ciasto Urodzinowe', item: 'cake', color: 'light_purple', count: 1 }
      ]
    },
    {
      id: 'budowle', kind: 'buildings', icon: '🗿', name: 'Więcej budowli',
      desc: 'Posągi graczy ze skina (1 piksel = 1 blok, 32 bloki wysokości), miedziana wanienka i inne śmieszne budowle. Pojawiają się w Kreatorze (Moje projekty).',
      builds: [
        { cmd: 'buduj posag technoblade', name: 'Technoblade z prawdziwego skina' },
        { cmd: 'buduj posag herobrine', name: 'Herobrine z białymi oczami' },
        { cmd: 'posag <nick>', name: 'posąg dowolnego gracza (skin z internetu)' },
        { cmd: 'buduj wanienka', name: 'miedziane schodki 16x, woda i lawa na ukos' },
        { cmd: 'buduj wielki tort', name: 'tort ze świeczką, 1 piksel = 1 blok' },
        { cmd: 'buduj gumowa kaczka', name: 'wielka żółta kaczka' },
        { cmd: 'buduj dom do gory nogami', name: 'domek stojący na dachu' },
        { cmd: 'buduj wielki hogwart', name: 'Światy Harry\'ego: zamek prawie 1:1 na skale, z oświetleniem i tajnymi przejściami' },
        { cmd: 'buduj hogwart', name: 'mały Hogwart (61×55)' },
        { cmd: 'buduj nora', name: 'krzywy dom Weasleyów' },
        { cmd: 'buduj ulica pokatna', name: 'sklepy, Dziurawy Kocioł i bank Gringotta' },
        { cmd: 'buduj peron 9 3 4', name: 'peron z ekspresem do Hogwartu' },
        { cmd: 'buduj chatka hagrida', name: 'okrągła chata ze strzechą' },
        { cmd: 'buduj boisko quidditch', name: 'trybuny w barwach domów i złote obręcze' },
        { cmd: 'buduj bijaca wierzba', name: 'drzewo z gałęziami do ziemi' }
      ]
    },
    {
      id: 'walka', kind: 'behavior', icon: '🗡', name: 'Lepsza walka',
      desc: 'Boty biją z wyskoku (trafienia krytyczne), robią uniki w bok i zasłaniają się tarczą przed strzałami.'
    },
    {
      id: 'clutch', kind: 'behavior', icon: '💧', name: 'Clutche (MLG)',
      desc: 'Gdy bot spada z wysoka, w ostatniej chwili wylewa wodę pod siebie i ją zabiera. Bez wiadra – kładzie blok szlamu albo siana. W survivalu daj mu wiadro wody.'
    },
    {
      id: 'wiedza', kind: 'behavior', icon: '📖', name: 'Wiedza o mobach',
      desc: 'Creeper: uderz i odskocz zamiast uciekać. Pająki w dzień są spokojne – nie zaczepia ich. Najpierw czarownice i szkielety. Na blaze rzuca śnieżkami.'
    },
    {
      id: 'lucznik', kind: 'behavior', icon: '🏹', name: 'Łucznik',
      desc: 'Bot z łukiem i strzałami strzela do mobów z daleka (z poprawką na opadanie strzały), zanim podejdą – też do creeperów.'
    }
  ]

  const strip = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

  // "excalibur", "excalibur ktos", "zbroja smoka dla ktos" -> { mod, def, rest }; szukamy we wszystkich paczkach
  function findItem(text) {
    const t = strip(text)
    let best = null
    for (const mod of MODS) {
      for (const def of mod.items || []) {
        for (const k of [def.key, ...(def.aliases || [])]) {
          if ((t === k || t.startsWith(k + ' ')) && (!best || k.length > best.k.length)) best = { mod, def, k }
        }
      }
    }
    if (!best) return null
    return { mod: best.mod, def: best.def, rest: t.slice(best.k.length).replace(/^ (dla|do) /, ' ').trim() }
  }

  // tekst do /give w formacie danej wersji gry: 'snbt' (1.21.5+), 'json' (1.20.5-1.21.4), 'nbt' (starsze)
  function itemArg(d, fmt) {
    const name = d.name ? { text: d.name, color: d.color || 'white', italic: false } : null
    const ench = d.ench || {}
    const parts = []
    if (fmt === 'nbt') {
      const tags = []
      if (name) tags.push(`display:{Name:'${JSON.stringify(name)}'${d.lore ? `,Lore:['${JSON.stringify({ text: d.lore, color: 'gray', italic: false })}']` : ''}}`)
      if (Object.keys(ench).length) tags.push(`Enchantments:[${Object.entries(ench).map(([k, v]) => `{id:"${k}",lvl:${v}s}`).join(',')}]`)
      if (d.unbreakable) tags.push('Unbreakable:1b')
      if (d.effects) tags.push(`CustomPotionColor:${d.potionColor || 0},custom_potion_effects:[${d.effects.map(([id, a, s]) => `{id:"${id}",amplifier:${a}b,duration:${s * 20}}`).join(',')}]`)
      return d.item + (tags.length ? `{${tags.join(',')}}` : '')
    }
    const text = o => fmt === 'snbt' ? `{text:"${o.text}",color:"${o.color}",italic:false}` : `'${JSON.stringify(o)}'`
    if (name) parts.push(`custom_name=${text(name)}`)
    if (d.lore) parts.push(`lore=[${text({ text: d.lore, color: 'gray' })}]`)
    if (Object.keys(ench).length) {
      const list = Object.entries(ench).map(([k, v]) => `${k}:${v}`).join(',')
      parts.push(fmt === 'snbt' ? `enchantments={${list}}` : `enchantments={levels:{${list}}}`)
    }
    if (d.unbreakable) parts.push('unbreakable={}')
    if (d.glint) parts.push('enchantment_glint_override=true')
    if (d.effects) parts.push(`potion_contents={custom_color:${d.potionColor || 0},custom_effects:[${d.effects.map(([id, a, s]) => `{id:"${id}",amplifier:${a},duration:${s * 20}}`).join(',')}]}`)
    return d.item + (parts.length ? `[${parts.join(',')}]` : '')
  }

  // komendy /give (kazda najwyzej 256 znakow - dluzsze bez opisu)
  function giveCommands(def, target, fmt) {
    const out = []
    for (const d of def.parts || [def]) {
      // za dlugie: najpierw bez opisu, potem bez nazwy (zaklecia i efekty zostaja zawsze)
      const variants = [d, { ...d, lore: null }, { ...d, lore: null, name: null }]
      const cmds = variants.map(v => `/give ${target} ${itemArg(v, fmt)} ${d.count || 1}`)
      out.push(cmds.find(c => c.length <= 256) || cmds[cmds.length - 1])
    }
    for (const [item, n] of def.extra || []) out.push(`/give ${target} ${item} ${n}`)
    return out
  }

  // rozdzka po nazwie przedmiotu (np. "Rozdzka Ognia") -> rodzaj czaru
  function wandByName(name) {
    const t = strip(name)
    if (!t) return null
    for (const mod of MODS) for (const d of mod.items || []) if (d.wand && strip(d.name) === t) return d.wand
    return null
  }

  return { MODS, findItem, itemArg, giveCommands, strip, wandByName }
})
