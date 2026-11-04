# Claude — bot do Minecrafta (beta)

Bot do **Minecraft Java Edition** napisany w Node.js na bibliotece [Mineflayer](https://github.com/PrismarineJS/mineflayer).
Wchodzi do gry jako osobny gracz i wykonuje polecenia wydawane **po polsku na czacie**.

**Co potrafi:**
- zbiera surowce i kopie rudy — sam robi potrzebne kilofy (drewniany → kamienny → żelazny) i schodzi na odpowiednią głębokość,
- craftuje około 100 przedmiotów, a brakujące składniki zdobywa sam (ścina drzewa, kopie, przepala, poluje),
- buduje: domy, zamek, zamczysko, pałac, pałac Endu, bazę podziemną, skybase, napisy i farmy,
- urządza wnętrza (meble, oświetlenie, drabiny, obrazy) i burzy swoje budowle,
- chodzi za Tobą, pilnuje Cię, wraca do bazy, zapamiętuje punkty,
- dba o siebie: je, ucieka z lawy i przed wardenem, walczy albo ucieka przed mobami, odblokowuje się,
- obsługuje tryb kreatywny (bierze bloki z menu i lata przy budowie),
- rozmawia: odpowiada na „elo", „co tam", „dzięki"…

> **Wersja beta.** Bot działa, ale bywa zawodny. Błędy zgłaszaj w [Issues](https://github.com/cezary-lonski/minecraft-bot/issues),
> najlepiej z kawałkiem logu z konsoli. Testowany na Minecraft **1.21.11** w świecie LAN.

---

## Spis treści
- [Wymagania](#wymagania)
- [Instalacja](#instalacja)
- [Uruchomienie](#uruchomienie)
- [Jak wydawać komendy](#jak-wydawać-komendy)
- [Jak zmienić nick bota](#jak-zmienić-nick-bota)
- [Wszystkie komendy](#wszystkie-komendy)
- [Pytania, które zadaje bot](#pytania-które-zadaje-bot)
- [Co bot robi sam](#co-bot-robi-sam)
- [Tryb kreatywny](#tryb-kreatywny)
- [Konfiguracja](#konfiguracja)
- [Uwagi i ograniczenia](#uwagi-i-ograniczenia)

---

## Wymagania
- [Node.js](https://nodejs.org/) w wersji **18 lub nowszej** (sprawdzisz: `node -v`),
- Minecraft Java Edition — świat singleplayer otwarty na LAN albo serwer,
- Git (do pobrania) albo pobrany ZIP z GitHuba (**Code → Download ZIP**).

## Instalacja

### Krok po kroku (Windows)
1. **Zainstaluj Node.js:** wejdź na [nodejs.org](https://nodejs.org/), pobierz wersję **LTS** i zainstaluj (wszystko „Dalej").
2. **Pobierz bota:** na tej stronie kliknij zielony przycisk **Code → Download ZIP**.
3. **Wypakuj folder** w dowolne, łatwe do znalezienia miejsce, np. `C:\Gry\minecraft-bot` albo na Pulpit.
   - Nie wkładaj go do folderu `.minecraft` ani do `Program Files` — bot nie jest modem, to osobny program.
   - Ścieżka może mieć spacje i polskie znaki, ale najprościej bez nich.
4. **Otwórz konsolę w tym folderze:** wejdź do wypakowanego folderu (tam, gdzie leżą `bot.js` i `start.js`),
   kliknij w pasek adresu Eksploratora, wpisz `powershell` i naciśnij Enter.
   (Albo: Shift + prawy przycisk myszy w pustym miejscu folderu → „Otwórz okno programu PowerShell tutaj".)
5. **Zainstaluj biblioteki** (tylko za pierwszym razem, trwa chwilę):
   ```
   npm install
   ```
   W folderze pojawi się `node_modules` — tak ma być.
6. Gotowe — przejdź do [Uruchomienie](#uruchomienie).

Przy kolejnych uruchomieniach wystarczy otworzyć konsolę w tym samym folderze (krok 4) i wpisać `node start.js`.

### Z Gita (dla zaawansowanych)
```
git clone https://github.com/cezary-lonski/minecraft-bot.git
cd minecraft-bot
npm install
```
Aktualizacja do nowej wersji: `git pull`, potem `npm install`.

## Uruchomienie

### Singleplayer (LAN)
1. Uruchom Minecrafta i wejdź do swojego świata.
2. Naciśnij **Esc → Open to LAN → Start LAN World**. Na czacie pojawi się port, np. `Local game hosted on port 12345`.
3. W konsoli (PowerShell / terminal) w folderze bota wpisz:
   ```
   node start.js
   ```
4. Odpowiedz na pytania:
   - **Tryb:** `lan` (Enter, bo to domyślne),
   - **Nick bota:** np. `Claude` (Enter = domyślny),
   - **Port LAN:** ten z czatu gry, np. `12345`.
5. Gdy w konsoli pojawi się **„Gotowy"**, bot jest w grze. Pisz komendy na zwykłym czacie, np. `komendy`.

Szybki start bez pytań: `node start.js lan 12345`

### Serwer
```
node start.js serwer mc.example.com
```
Bot zapyta o **nick bota**, **Twój nick w grze** (właściciel — tylko on wydaje komendy) i opcjonalnie **hasło do `/login`**
(serwery z AuthMe). Port bot znajduje sam (rekord SRV), a jeśli trzeba, podaj go po dwukropku: `mc.example.com:25565`.
Komendy wysyłasz prywatnie: `/msg <nick bota> <komenda>`.

Odpowiedzi zapisują się w `config.json` i przy kolejnym starcie są podpowiadane — wystarczy Enter.

### Zatrzymanie
**Ctrl+C** w konsoli bota. Samo przerwanie zadania bez wyłączania: komenda `stop`.

## Jak wydawać komendy
- **LAN:** na zwykłym czacie gry — bot słucha każdego gracza w świecie.
- **Serwer:** `/msg <nick bota> <komenda>` — tylko właściciel i osoby dodane przez `permisja <nick>`. Bot odpowiada też przez `/msg`.
- **Konsola:** w oknie, w którym działa bot (zawsze działa).
- Polskie znaki są opcjonalne: `zdobądź` = `zdobadz`, `łóżko` = `lozko`.
- Bot robi **jedno zadanie naraz**; `stop` przerywa bieżące. `jak tam` pokazuje, co robi.

## Jak zmienić nick bota
- **Przy starcie:** `node start.js` pyta „Nick bota" — wpisz nowy (zapamięta go w `config.json`).
- **Zmienną środowiskową:**
  - PowerShell: `$env:MC_USER="MojBot"; node start.js`
  - cmd: `set MC_USER=MojBot && node start.js`
  - Linux / macOS: `MC_USER=MojBot node start.js`
- **Od nowa:** usuń `config.json` — bot zapyta o wszystko jeszcze raz.

Na serwerach z kontami premium (`online-mode=true`) nick musi należeć do prawdziwego konta:
ustaw `MC_AUTH=microsoft` i `MC_USER=<email konta>` — przy pierwszym starcie bot poda link do zalogowania.

---

## Wszystkie komendy
`<…>` — wymagane, `[…]` — opcjonalne. Krótka ściąga w grze: `komendy`.

### Informacje
| Komenda | Działanie |
|---|---|
| `komendy` (`pomoc`) | ściąga komend na czacie |
| `jak tam`, `co robisz`, `postęp` | bieżące zadanie i krok, np. „kopię schodami w dół: y=12, cel y=-54" |
| `status` | zdrowie, głód, pozycja, co trzyma, zadanie |
| `gdzie` (`pozycja`, `koordy`) | współrzędne i wymiar |
| `eq` (`ekwipunek`) | wszystko, co ma |
| `czy masz <co>`, `ile masz <co>` | np. `czy masz diament?` → „Tak: diamond x3" |
| `diag` | stan fizyki bota (do szukania błędów) |

### Zadania i surowce
| Komenda | Działanie |
|---|---|
| `zdobądź <surowiec> [ile]` | też `zbierz`, `wykop`, `przynieś`; np. `zdobądź żelazo 5`, `zdobądź diament 3`. Sam robi kilofy i schodzi kopiąc na głębokość rudy. Domyślnie 8 sztuk |
| `zdobądź <przedmiot> [ile]` | dowolna rzecz, którą umie zrobić / upolować / przepalić: `zdobądź chleb 3`, `zdobądź skórę 5`, `zdobądź pieczone mięso 4` |
| `zdobądź jedzenie [ile]` | zbiera dojrzałe warzywa, poluje i piecze mięso |
| `poluj [krowa/świnia/owca/kura/królik/koza] [ile]` | poluje i podnosi mięso (domyślnie 3) |
| `przepal` | przepala w piecu rudy i surowe jedzenie |
| `podnieś` (`zbierz drop`) | zbiera leżące przedmioty w promieniu 16 |
| `start` | wszystkie etapy po kolei: drewno, kamień, jedzenie, żelazo, diamenty |
| `etap drewno / kamień / jedzenie / żelazo / diamenty` | jeden etap |
| `śpij` | idzie do łóżka (32 bloki) i śpi do rana |
| `stop` (`zostań`, `czekaj`, `stój`) | przerywa wszystko |

Surowce: drewno, kamień, węgiel, żelazo, złoto, miedź, diament, redstone, lapis, szmaragd, piasek, żwir, ziemia, glina, obsydian,
zboże, marchew, ziemniaki, buraki, grzyby, trzcina, dynia, melon, kaktus, bambus, wodorosty…

### Crafting
| Komenda | Działanie |
|---|---|
| `scraftuj <co> [ile]` | też `zrób`, `stwórz`; brakujące składniki zdobywa sam, np. `scraftuj drewniany kilof`, `scraftuj stół`, `scraftuj pochodnie 16` |
| `scraftuj <materiał> set` | cała zbroja + narzędzia, np. `scraftuj diamentowy set` (zakłada zbroję) |
| `scraftuj <materiał> zbroja` / `narzędzia` | np. `scraftuj żelazna zbroja`, `scraftuj kamienne narzędzia` |

Około 100 nazw po polsku, np.: zbroje i narzędzia (drewniany/kamienny/żelazny/złoty/diamentowy + kilof, miecz, siekiera,
łopata, motyka, hełm, napierśnik, spodnie, buty), **jedzenie** (chleb, pieczone mięso, stek, pieczony ziemniak, pieczony
kurczak, zupa grzybowa, zupa z buraków, ciastka, ciasto dyniowe, złote jabłko, suszone wodorosty), **bloki** (stół, piec,
wędzarnia, piec hutniczy, skrzynia, beczka, kowadło, łóżko, ognisko, latarnia, lejek, regał, stół do zaklinania),
**budowanie** (drzwi, żelazne drzwi, klapa, płot, furtka, drabina, schody, płyta, cegły, kamienne cegły, szkło, szyba,
tabliczka), **rzeczy** (patyki, deski, pochodnie, wiadro, tarcza, łuk, strzały, nożyce, krzesiwo, kompas, zegar, mapa,
miska, butelka, łódka, wózek, tory, książka, papier, cukier, dźwignia, przycisk). Działa też angielska nazwa z gry (`iron_pickaxe`).

### Ruch
| Komenda | Działanie |
|---|---|
| `tu` (`przyjdź`, `do mnie`) | przychodzi do Ciebie; na serwerze, gdy Cię nie widzi, wysyła `/tpa` |
| `idź <ile> przód / tył / lewo / prawo` | marsz względem tego, gdzie patrzy bot |
| `idź <ile> północ / południe / wschód / zachód` | marsz według stron świata |
| `idź do <x> <z>`, `idź do <x> <y> <z>` | do współrzędnych |
| `idź do <punkt>`, `idź do <gracz>` | do zapisanego punktu albo gracza |
| `chodź za mną`, `chodź za <gracz>` | chodzi za graczem aż do `stop` |
| `ochraniaj [gracz]` (`pilnuj`) | chodzi za graczem i bije moby obok niego |
| `zabij <gracz>` | atakuje gracza — **tylko za jego zgodą** |

### Baza i punkty
| Komenda | Działanie |
|---|---|
| `baza` (`ustaw bazę`, `to jest baza`) | zapisuje miejsce, w którym stoi bot, jako bazę |
| `idź do bazy` (`wróć`, `do bazy`) | wraca do bazy najkrótszą drogą |
| `zapisz <nazwa>` | zapisuje pozycję, potem `idź do <nazwa>` (działa odmiana: „do kopalni", „do domu") |
| `ustaw dom`, `dom` | zapisuje / idzie do punktu „dom" |
| `punkty` | lista punktów |
| `usuń <nazwa>` | usuwa punkt |

### Ekwipunek i skrzynie
| Komenda | Działanie |
|---|---|
| `daj <co> [ile]` | wyrzuca Ci przedmioty (tylko z gry); `daj rękę` — to, co trzyma, `daj wszystko` — cały ekwipunek |
| `weź <co> [ile]` | bierze z najbliższej skrzyni lub beczki |
| `schowaj`, `schowaj <co>`, `schowaj wszystko` | chowa do skrzyni (bez nazwy zostawia narzędzia, zbroję i jedzenie) |
| `wyrzuć <co> [ile]`, `wyrzuć śmieci` | wyrzuca na ziemię (śmieci: ziemia, żwir, zgniłe mięso, granit…) |
| `trzymaj <co>` | bierze przedmiot do ręki |
| `załóż` | zakłada najlepszą zbroję |
| `jedz` | zjada najlepsze jedzenie |
| `postaw <co>`, `postaw <co> <x> <y> <z>` | stawia blok obok siebie albo we wskazanym miejscu |
| `szukaj` | chodzi po okolicy, aż znajdzie skrzynię, i ją przeszukuje |
| `przeszukaj` | przeszukuje skrzynie w promieniu 32 |
| `skrzynie wł` / `skrzynie wył` | włącza / wyłącza zaglądanie do skrzyń w trakcie zadań |

### Budowanie
Bot buduje **przed sobą** — ustaw go przodem tam, gdzie ma stanąć budowla. Materiały zbiera sam, teren wyrównuje.
| Komenda | Co powstaje | Materiały (ok.) |
|---|---|---|
| `buduj dom` | dom 7×7: ściany z desek, rogi z pni, drzwi, okna, dach, stół, skrzynia, piec | 124 deski, 16 pni |
| `buduj dom villagera` | domek 5×5 jak w wiosce, fundament z bruku, dach ze szczytem | 65 desek, 13 pni, 16 bruku |
| `buduj zamek` | mury 13×13 z blankami, brama, 4 wieże, drabiny na mury i wieże | ok. 450 bruku |
| `buduj zamczysko` | mury 21×21 z blankami, brama, 4 wieże 5×5, donżon, drabiny | ok. 1630 bruku |
| `buduj pałac` | sala z kolumnami i dwoma rzędami okien, taras, 4 okrągłe wieże i wieża środkowa z iglicami, drabiny | ok. 1000 bruku, 370 desek, 64 pnie |
| `buduj pałac endu` | platforma z latarniami, schody, dwupiętrowa sala z purpuru, fioletowe witraże, rozeta, balustrada z end rodami, 4 wieże z kopułami i iglicami, wieża środkowa (30 bloków), drabiny | ok. 2800 bloków z Endu — najlepiej w kreatywnym |
| `buduj baza podziemna` | schody 8 w dół i pokój 7×7 ze stołem, piecem, skrzynią | — |
| `buduj skybase` | słup do y=150 i platforma 9×9 z murkiem, stołem i skrzynią | ok. 200 bruku |
| `buduj napis: <tekst>` | stojący napis (litery 3×5, do 30 znaków), np. `buduj napis: elo` | 5–15 bruku na literę |
| `buduj napis z <blok>: <tekst>` | napis z innego bloku, np. `buduj napis z desek: kurczak` | |
| `buduj farma zboża / marchwi / ziemniaków / buraków` | zaorane pole przy wodzie z nasionami; bez wody robi oczko wodne | motyka, nasiona, wiadro |
| `buduj farma drzew` | 9 sadzonek w siatce | sadzonki |
| `buduj farma trzciny` | trzcina przy wodzie | trzcina |
| `buduj farma zwierząt` | zagroda 9×9 z płotem i furtką | 31 płotów |

Duże budowle (ponad 600 bloków) bot buduje partiami: zbiera materiał na kolejne 3 warstwy, buduje je i wraca po następne.

### Wystrój, burzenie, rusztowania
| Komenda | Działanie |
|---|---|
| `wystrój <budowla>` (`udekoruj`, `umebluj`) | urządza wnętrze: drabiny, latarnie / end rody pod stropem, stół z krzesłami, warsztat, piec, wędzarnia, skrzynie, łóżko, regały, biblioteka (pałac Endu), dywany, obrazy. Wstawia tylko w puste miejsca |
| `zburz <budowla>` (`usuń budowlę <budowla>`) | po potwierdzeniu rozbiera budowlę i jej wystrój od góry; terenu dookoła nie rusza |
| `rozbierz rusztowania` | usuwa słupki rusztowań w promieniu 20 bloków, nie ruszając murów i blanków |

Budowle: `dom`, `dom villagera`, `zamek`, `zamczysko`, `pałac`, `pałac endu`, `baza podziemna`.
Bot pamięta, gdzie postawił budowlę (`builds.json`). Dla budowli, których nie pamięta, postaw go tam, gdzie zaczynał budowę —
albo przy pałacu Endu **na najwyższym end rodzie środkowej iglicy** — a sam rozpozna budowlę i jej obrót.

### Rozmowa, czat, uprawnienia
| Komenda | Działanie |
|---|---|
| `elo`, `siema`, `cześć`, `hej`, `dzień dobry` | powitanie |
| `co tam`, `jak się masz` | jak się czuje i co robi |
| `kim jesteś`, `dzięki`, `nara`, `dobry bot` | krótkie odpowiedzi |
| `chat <tekst>` | pisze tekst na czacie |
| `/komenda` | wykonuje komendę serwera (tylko właściciel i konsola), np. `/spawn` |
| `permisja <nick>`, `odbierz <nick>`, `permisje` | kto (poza właścicielem) może wydawać komendy na serwerze |

---

## Pytania, które zadaje bot
| Pytanie | Odpowiedzi | Bez odpowiedzi |
|---|---|---|
| „Widzę chest… Mogę ją otworzyć?" (gdy nic nie robi) | `tak` / `nie` | po minucie odpuszcza |
| „Potrzebuję jeszcze: … Mam po nie pójść czy budować bez nich?" (ozdoby przy budowie, survival) | `pójdź` / `buduj bez` | po 90 s buduje bez nich |
| „Zostało N bloków rusztowania. Rozebrać je?" (po budowie) | `tak` / `nie` | po 60 s rozbiera |
| „Na pewno zburzyć …?" | `tak` / `nie` | po 60 s nic nie burzy |

## Co bot robi sam
- **Instynkt samozachowawczy:** ucieka z lawy i ognia, wypływa z wody, ocenia siłę mobów i walczy albo ucieka (przed creeperem zawsze).
- **Warden:** nie schodzi w głąb deep dark (sculk) i zawraca tunel przed sculkiem; gdy pojawi się warden, przerywa zadanie,
  sprintuje i przekopuje wąski tunel, w którym warden się nie mieści.
- **Jedzenie:** je, gdy głód lub zdrowie spadnie poniżej 4 ikon; bez jedzenia idzie polować.
- **Narzędzia:** robi kilof potrzebny do rudy; nowy, gdy stary się zepsuje.
- **Skrzynie (LAN):** w trakcie zadań zagląda do znalezionych skrzyń i bierze lepsze narzędzia, zbroję, cenne rzeczy i jedzenie.
- **Odblokowywanie:** wbity w blok — wykopuje się; zaklinowany — podskakuje i szuka nowej drogi; na drabinie — wspina się.
- **Pełny ekwipunek:** wyrzuca śmieci, ale nigdy materiałów aktualnej budowy.
- **Rusztowania:** po budowie proponuje ich rozebranie.

## Tryb kreatywny
Gdy bot jest w kreatywnym (`/gamemode creative <nick bota>`), nie zbiera surowców — bierze bloki i przedmioty z menu
kreatywnego (`zdobądź`, `scraftuj`, `buduj`, wiadro wody na farmy), przy budowie **lata** zamiast stawiać rusztowania
i nie potrzebuje jedzenia. To najlepszy sposób na duże budowle (pałac Endu, zamczysko).

## Konfiguracja
Zmienne środowiskowe (ustawiane przed `node start.js`):
| Zmienna | Znaczenie |
|---|---|
| `MC_USER` | nick bota (domyślnie `Claude`) |
| `MC_HOST`, `MC_PORT` | adres i port serwera (bez portu bot sprawdza rekord SRV) |
| `MC_OWNER` | nick właściciela (serwer) |
| `MC_PASS` | hasło do `/login` (serwery z AuthMe) |
| `MC_AUTH` | `offline` (domyślnie) albo `microsoft` |
| `MC_VERSION` | wersja gry (domyślnie wykrywana) |
| `MC_RTP=0` | wyłącza `/rtp`, gdy w pobliżu brak surowca |
| `MC_LOOT=1` / `0` | wymusza włączenie / wyłączenie przeszukiwania skrzyń |
| `MC_CHAT_DELAY` | odstęp między wiadomościami w ms (antyspam; LAN 600, serwer 3200) |
| `MC_EAT_BELOW` | próg automatycznego jedzenia (domyślnie 8 z 20) |
| `MC_QUIET=1` | odpowiedzi tylko w konsoli (do testów) |

Pliki lokalne (nie trafiają do repozytorium): `config.json` (ustawienia startu, hasło), `permissions.json`,
`waypoints.json` (punkty i baza), `chests.json` (własne skrzynie), `builds.json` (postawione budowle).

## Uwagi i ograniczenia
- Bot widzi rudy przez ściany (jak x-ray). W singleplayerze to bez znaczenia, na serwerach to traktowane jak oszustwo —
  używaj go tam tylko za zgodą admina.
- Na serwerach z antycheatem (np. Grim) bot bywa cofany w miejscu i flagowany — admin może dodać go do wyjątków.
- Nether, End i walka ze smokiem nie są jeszcze zrobione.
- Bot nie zwabi zwierząt do zagrody, a do farm marchwi i ziemniaków potrzebuje ich na start (chyba że w kreatywnym).
