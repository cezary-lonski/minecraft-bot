# Minecraft bot (beta)

Bot do Minecrafta Java napisany w Node.js na bibliotece [Mineflayer](https://github.com/PrismarineJS/mineflayer).
Wchodzi do gry jako osobny gracz i wykonuje polecenia z czatu: zbiera surowce, kopie po diamenty, craftuje
(sam zdobywa brakujace skladniki), przepala, poluje, chodzi za graczem, broni sie i rozmawia po polsku.

> **Wersja beta.** Bot dziala, ale bywa zawodny - zglaszaj bledy w Issues (najlepiej z kawalkiem logu z konsoli).
> Testowany na Minecraft 1.21.11 (swiat LAN). Na serwerach z antycheatem bot moze byc cofany/flagowany.

## Wymagania
- [Node.js](https://nodejs.org/) 18 lub nowszy
- Minecraft Java (swiat singleplayer otwarty na LAN albo serwer)

## Instalacja
```
git clone https://github.com/cezary-lonski/minecraft-bot.git
cd minecraft-bot
npm install
```

## Uruchomienie
```
node start.js
```
Bot zapyta o:
1. **tryb** - `lan` (swiat singleplayer: w grze Esc -> Open to LAN) albo `serwer`,
2. **nick bota** (domyslnie `Claude`),
3. w trybie LAN: **port** - pokazuje sie na czacie gry po "Open to LAN",
4. w trybie serwera: **adres serwera**, **Twoj nick** (wlasciciel bota) i opcjonalnie **haslo do /login**.

Odpowiedzi zapisuja sie w `config.json` i przy nastepnym starcie sa podpowiadane (wystarczy Enter).
Szybki start bez pytan: `node start.js lan 12345` albo `node start.js serwer mc.example.com`.

Gdy w konsoli pojawi sie "Gotowy", piszesz komendy:
- **LAN:** na zwyklym czacie gry (bot slucha kazdego gracza w swiecie),
- **serwer:** prywatnie `/msg <nick bota> <komenda>` - tylko wlasciciel i osoby dodane przez `permisja <nick>`,
- zawsze tez w konsoli, w ktorej dziala bot.

## Jak zmienic nick bota
- Przy starcie: `node start.js` pyta "Nick bota" - wpisz nowy (zapamieta go w `config.json`).
- Albo zmienna srodowiskowa przed startem:
  - PowerShell: `$env:MC_USER="MojBot"; node start.js`
  - cmd: `set MC_USER=MojBot && node start.js`
  - Linux/macOS: `MC_USER=MojBot node start.js`
- Albo usun `config.json` - zapyta o wszystko od nowa.

Na serwerach z kontami premium (`online-mode=true`) nick musi byc nickiem prawdziwego konta:
ustaw `MC_AUTH=microsoft` i `MC_USER=<email konta>` - przy pierwszym starcie bot poda link do zalogowania.

## Komendy
Polskie znaki sa opcjonalne (`zdobadz` = `zdobądź`). `komendy` wypisuje skrot w grze.

### Zadania (jedno naraz, `stop` przerywa)
| Komenda | Dzialanie |
|---|---|
| `zdobadz <surowiec> [ile]` | tez `zbierz`, `wykop`, `przynies`; np. `zdobadz zelazo 5`, `zdobadz diament 3` - sam robi potrzebne kilofy i schodzi kopiac na glebokosc rudy |
| `zdobadz <przedmiot> [ile]` | dowolna rzecz, ktora umie zrobic/upolowac/przepalic, np. `zdobadz chleb 3`, `zdobadz skore 5` |
| `zdobadz jedzenie [ile]` | zbiera dojrzale warzywa, poluje i piecze mieso |
| `scraftuj <co> [ile]` | np. `scraftuj drewniany kilof`, `scraftuj diamentowy set`, `scraftuj stol`; brakujace skladniki zdobywa sam |
| `poluj [krowa/swinia/owca/kura/krolik/koza] [ile]` | poluje i zbiera mieso |
| `przepal` | przepala rudy i surowe jedzenie w piecu |
| `start` | etapy po kolei: drewno, kamien, jedzenie, zelazo, diamenty |
| `etap drewno/kamien/jedzenie/zelazo/diamenty` | jeden etap |
| `spij` | idzie do lozka w promieniu 32 i spi do rana |
| `szukaj` | chodzi po okolicy, az znajdzie skrzynie, i ja przeszukuje |
| `przeszukaj` | przeszukuje skrzynie w promieniu 32 |
| `stop` (`zostan`, `czekaj`) | przerywa biezace zadanie |

### Ruch
| Komenda | Dzialanie |
|---|---|
| `tu` (`przyjdz`) | przychodzi do Ciebie; na serwerze, gdy Cie nie widzi, wysyla /tpa |
| `idz <ile> przod/tyl/lewo/prawo/polnoc/poludnie/wschod/zachod` | marsz o podana liczbe blokow |
| `idz do <x> <z>`, `idz do <x> <y> <z>` | do wspolrzednych |
| `idz do <punkt>`, `idz do <gracz>` | do zapisanego punktu albo gracza |
| `chodz za mna`, `chodz za <gracz>` | chodzi za graczem az do `stop` |
| `ochraniaj [gracz]` | chodzi za graczem i bije moby obok niego |
| `zabij <gracz>` | atakuje gracza (tylko za jego zgoda!) |

### Budowanie
Bot buduje przed soba (w kierunku, w ktorym patrzy), sam zbiera materialy i wyrownuje teren.
| Komenda | Co powstaje | Materialy (ok.) |
|---|---|---|
| `buduj dom` (`baza`) | dom 7x7: sciany z desek, rogi z pni, drzwi, okna, dach, stol, skrzynia, piec, pochodnia | 124 deski, 16 pni |
| `buduj dom villagera` | domek 5x5 jak w wiosce, fundament z bruku, dach ze szczytem | 65 desek, 13 pni, 16 bruku |
| `buduj zamek` | mury 13x13 z blankami, brama, 4 wieze | ok. 450 bruku (dlugo!) |
| `buduj baza podziemna` | schody 8 w dol i pokoj 7x7x3 ze stolem, piecem, skrzynia i pochodniami | - |
| `buduj skybase` | slup do y=150 (min. 30 w gore) i platforma 9x9 z murkiem, stolem i skrzynia | ok. 200 bruku |
| `buduj farma zboza/marchwi/ziemniakow/burakow` | zaorane pole przy wodzie i posadzone nasiona; bez wody w poblizu robi oczko wodne (wiadro z 3 zelaza, woda ze zrodla do 64 blokow) | motyka, nasiona, wiadro |
| `buduj farma drzew` | 9 sadzonek w siatce co 4 bloki | sadzonki (zbiera z lisci) |
| `buduj farma trzciny` | trzcina posadzona przy wodzie | trzcina |
| `buduj farma zwierzat` | zagroda 9x9 z plotu i furtka (zwierzeta trzeba zwabic) | 31 plotow, furtka |

Wszystkie materialy bot zdobywa sam (scina drzewa, kopie bruk, craftuje drzwi, skrzynie, ploty). Ozdoby tez probuje zdobyc:
szyby (piasek -> szklo w piecu -> szyby) i pochodnie (wegiel + patyki); jak sie nie uda, zostawia w tym miejscu puste pole.

Gdy brakuje ozdob (szyby, pochodnie), bot pyta: "Potrzebuje jeszcze: 3 x glass_pane. Mam po nie pojsc czy budowac bez nich?" -
odpowiedz `pojdz` albo `buduj bez` (bez odpowiedzi przez 90 s buduje bez nich).

### Punkty
| Komenda | Dzialanie |
|---|---|
| `baza` (`ustaw baze`) | zapisuje miejsce, w ktorym stoi bot, jako baze |
| `idz do bazy` (`wroc`, `do bazy`) | wraca do bazy najkrotsza droga |
| `zapisz <nazwa>`, `ustaw dom` | zapisuje aktualna pozycje; potem `idz do <nazwa>` (dziala tez odmiana: "do domu", "do kopalni") |
| `dom` | wraca do punktu "dom" |
| `punkty`, `usun <nazwa>` | lista / usuwanie |
| `gdzie` | wspolrzedne i wymiar |

### Rzeczy
| Komenda | Dzialanie |
|---|---|
| `eq` | mowi wszystko, co ma |
| `czy masz <co>`, `ile masz <co>` | np. `czy masz diament?` |
| `daj <co> [ile]` | wyrzuca Tobie; `daj reka` = to, co trzyma, `daj wszystko` = caly ekwipunek |
| `wez <co> [ile]` | bierze z najblizszej skrzyni lub beczki |
| `schowaj`, `schowaj <co>`, `schowaj wszystko` | chowa do skrzyni (bez nazwy zostawia narzedzia, zbroje i jedzenie) |
| `wyrzuc <co> [ile]`, `wyrzuc smieci` | wyrzuca na ziemie |
| `postaw <co>`, `postaw <co> <x> <y> <z>` | stawia blok obok siebie albo we wskazanym miejscu |
| `trzymaj <co>`, `zaloz` | bierze do reki / zaklada najlepsza zbroje |
| `jedz`, `podnies` | je / zbiera lezace przedmioty |
| `skrzynie wl` / `skrzynie wyl` | samodzielne zagladanie do znalezionych skrzyn |

### Inne
| Komenda | Dzialanie |
|---|---|
| `jak tam`, `co robisz` | biezace zadanie i krok, np. "kopie schodami w dol: y=12, cel y=-54" |
| `status` | zdrowie, glod, pozycja |
| `chat <tekst>` | pisze na czacie |
| `/komenda` | komenda serwera (tylko konsola i wlasciciel) |
| `permisja <nick>`, `odbierz <nick>`, `permisje` | kto moze wydawac komendy |
| `diag` | stan fizyki bota (do szukania bledow) |

Bot odpowiada tez na `elo`, `siema`, `czesc`, `dzieki`, `co tam`, `kim jestes`, `nara` itp.

### Nazwy przedmiotow
Okolo 100 polskich nazw: zbroje i narzedzia (`diamentowy set`, `zelazna zbroja`, `kamienny kilof`), jedzenie (`chleb`,
`pieczone mieso`, `stek`, `pieczony ziemniak`, `zupa grzybowa`, `ciastka`, `zlote jablko`), bloki (`stol`, `piec`, `skrzynia`,
`beczka`, `kowadlo`, `lozko`, `stol do zaklinania`), budowanie (`drzwi`, `plot`, `drabina`, `schody`, `szklo`, `cegly`) i rzeczy
(`pochodnie`, `patyki`, `deski`, `wiadro`, `tarcza`, `kompas`, `zegar`, `ksiazka`, `lodka`). Dziala tez angielska nazwa z gry (`iron_pickaxe`).

## Co bot robi sam
- **Instynkt samozachowawczy:** ucieka z lawy, wyplywa z wody, ocenia zagrozenie od mobow i walczy albo ucieka.
- **Warden i deep dark:** nie schodzi glebiej, gdy pod nim jest sculk, i zawraca tunel przed sculkiem. Gdy pojawi sie
  warden, przerywa zadanie i ucieka schodami, ktorymi zszedl; to miejsce potem omija przy kopaniu.
- **Jedzenie:** je, gdy glod lub zdrowie spadnie ponizej 4 ikon; bez jedzenia idzie polowac.
- **Narzedzia:** robi kilof potrzebny do danej rudy (drewniany -> kamienny -> zelazny), nowy, gdy stary sie zepsuje.
- **Skrzynie (tylko LAN):** w trakcie zadan zaglada do znalezionych skrzyn i bierze lepsze rzeczy; bez zadania pyta "Moge ja otworzyc?".
- **Pelny ekwipunek:** wyrzuca smieci (bruk glebinowy, ziemia, zwir...), zeby zmiescic rude.

## Zmienne srodowiskowe
| Zmienna | Znaczenie |
|---|---|
| `MC_USER` | nick bota (domyslnie `Claude`) |
| `MC_HOST`, `MC_PORT` | adres i port (bez portu bot sprawdza rekord SRV) |
| `MC_OWNER` | nick wlasciciela (serwer) |
| `MC_PASS` | haslo do /login (serwer z AuthMe) |
| `MC_AUTH` | `offline` (domyslnie) albo `microsoft` |
| `MC_VERSION` | wersja gry (domyslnie wykrywana) |
| `MC_RTP=0` | wylacza /rtp, gdy w poblizu brak surowca |
| `MC_LOOT=1` / `0` | wymusza wlaczenie/wylaczenie przeszukiwania skrzyn |
| `MC_CHAT_DELAY` | odstep miedzy wiadomosciami w ms (antyspam) |
| `MC_EAT_BELOW` | prog automatycznego jedzenia (domyslnie 8 z 20) |
| `MC_QUIET=1` | odpowiedzi tylko w konsoli (do testow) |

## Uwagi
- Bot widzi rudy przez sciany (jak x-ray) - na serwerach to traktowane jako oszustwo. Uzywaj go tam tylko za zgoda admina.
- Na serwerach z antycheatem (np. Grim) bot moze byc cofany w miejscu i flagowany - admin moze dodac go do wyjatkow.
- Pliki `config.json`, `permissions.json`, `waypoints.json`, `chests.json` sa lokalne (w `.gitignore`).
