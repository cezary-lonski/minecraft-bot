// Dane dla okna: komendy (do podpowiedzi i listy), budowle i farmy.
// cmd - tekst wysylany do bota; <...> - miejsce do uzupelnienia przez uzytkownika.
window.COMMANDS = [
  // Informacje
  { cat: 'Informacje', cmd: 'jak tam', desc: 'Bieżące zadanie i krok, zdrowie, głód' },
  { cat: 'Informacje', cmd: 'status', desc: 'Zdrowie, głód, pozycja, co trzyma' },
  { cat: 'Informacje', cmd: 'gdzie', desc: 'Współrzędne i wymiar' },
  { cat: 'Informacje', cmd: 'czas', desc: 'Ile bloków postawił i ile mniej więcej zostało do końca budowy' },
  { cat: 'Informacje', cmd: 'eq', desc: 'Wszystko, co ma w ekwipunku' },
  { cat: 'Informacje', cmd: 'czy masz <co>', desc: 'Np. czy masz diament' },
  { cat: 'Informacje', cmd: 'komendy', desc: 'Ściąga komend na czacie gry' },
  // Zadania
  { cat: 'Zadania', cmd: 'zdobadz <surowiec> <ile>', desc: 'Np. zdobądź żelazo 5 – sam robi kilofy i kopie' },
  { cat: 'Zadania', cmd: 'zdobadz diament 3', desc: 'Schodzi kopiąc i szuka diamentów' },
  { cat: 'Zadania', cmd: 'zdobadz drewno 16', desc: 'Ścina drzewa' },
  { cat: 'Zadania', cmd: 'zdobadz jedzenie 10', desc: 'Warzywa, polowanie, pieczenie mięsa' },
  { cat: 'Zadania', cmd: 'poluj <zwierze> <ile>', desc: 'krowa / świnia / owca / kura / królik / koza' },
  { cat: 'Zadania', cmd: 'przepal', desc: 'Przepala rudy i surowe jedzenie w piecu' },
  { cat: 'Zadania', cmd: 'podnies', desc: 'Zbiera leżące przedmioty' },
  { cat: 'Zadania', cmd: 'start', desc: 'Wszystkie etapy: drewno → diamenty' },
  { cat: 'Zadania', cmd: 'etap <drewno|kamien|jedzenie|zelazo|diamenty>', desc: 'Jeden etap' },
  { cat: 'Zadania', cmd: 'spij', desc: 'Idzie do łóżka i śpi do rana' },
  { cat: 'Zadania', cmd: 'stop', desc: 'Przerywa wszystko' },
  { cat: 'Zadania', cmd: 'kontynuuj', desc: 'Wznawia ostatnie zadanie, np. po „brakuje mi bloków” – najpierw daj mu je' },
  { cat: 'Zadania', cmd: 'kontynuuj <nazwa>', desc: 'Jedno z 3 ostatnich zadań, np. kontynuuj pałac, kontynuuj 2' },
  { cat: 'Zadania', cmd: 'kontynuuj lista', desc: 'Pokazuje 3 ostatnie zadania, które można wznowić' },
  // Crafting
  { cat: 'Crafting', cmd: 'scraftuj <co> <ile>', desc: 'Brakujące składniki zdobywa sam' },
  { cat: 'Crafting', cmd: 'scraftuj diamentowy set', desc: 'Cała zbroja + narzędzia (zakłada)' },
  { cat: 'Crafting', cmd: 'scraftuj zelazna zbroja', desc: 'Hełm, napierśnik, spodnie, buty' },
  { cat: 'Crafting', cmd: 'scraftuj kamienne narzedzia', desc: 'Miecz, kilof, siekiera, łopata, motyka' },
  { cat: 'Crafting', cmd: 'scraftuj stol', desc: 'Stół rzemieślniczy' },
  { cat: 'Crafting', cmd: 'scraftuj pochodnie 16', desc: 'Pochodnie' },
  // Ruch
  { cat: 'Ruch', cmd: 'tu', desc: 'Przychodzi do Ciebie (nick z ustawień)' },
  { cat: 'Ruch', cmd: 'chodz za mna', desc: 'Chodzi za Tobą aż do stop' },
  { cat: 'Ruch', cmd: 'ochraniaj', desc: 'Chodzi za Tobą i bije moby' },
  { cat: 'Ruch', cmd: 'idz <ile> przod', desc: 'przód / tył / lewo / prawo / północ / południe…' },
  { cat: 'Ruch', cmd: 'idz do <x> <z>', desc: 'Do współrzędnych' },
  { cat: 'Ruch', cmd: 'idz do <punkt>', desc: 'Do zapisanego punktu albo gracza' },
  { cat: 'Ruch', cmd: 'zabij <gracz|mob|imie>', desc: 'Gracz (za zgodą), typ moba (zombie, krowa…) albo mob z imieniem' },
  // Baza
  { cat: 'Baza i punkty', cmd: 'baza', desc: 'Zapisuje to miejsce jako bazę' },
  { cat: 'Baza i punkty', cmd: 'idz do bazy', desc: 'Wraca do bazy najkrótszą drogą' },
  { cat: 'Baza i punkty', cmd: 'zapisz <nazwa>', desc: 'Zapisuje punkt' },
  { cat: 'Baza i punkty', cmd: 'punkty', desc: 'Lista punktów' },
  { cat: 'Baza i punkty', cmd: 'usun <nazwa>', desc: 'Usuwa punkt' },
  // Ekwipunek
  { cat: 'Ekwipunek', cmd: 'daj <co> <ile>', desc: 'Wyrzuca Ci przedmioty' },
  { cat: 'Ekwipunek', cmd: 'daj wszystko', desc: 'Cały ekwipunek' },
  { cat: 'Ekwipunek', cmd: 'wez <co> <ile>', desc: 'Bierze ze skrzyni obok' },
  { cat: 'Ekwipunek', cmd: 'schowaj', desc: 'Chowa do skrzyni (zostawia narzędzia, zbroję, jedzenie)' },
  { cat: 'Ekwipunek', cmd: 'wyrzuc smieci', desc: 'Ziemia, żwir, zgniłe mięso…' },
  { cat: 'Ekwipunek', cmd: 'trzymaj <co>', desc: 'Bierze do ręki' },
  { cat: 'Ekwipunek', cmd: 'zaloz', desc: 'Zakłada najlepszą zbroję' },
  { cat: 'Ekwipunek', cmd: 'jedz', desc: 'Zjada najlepsze jedzenie' },
  { cat: 'Ekwipunek', cmd: 'postaw <co>', desc: 'Stawia blok obok siebie' },
  { cat: 'Ekwipunek', cmd: 'szukaj', desc: 'Szuka skrzyni w okolicy i ją przeszukuje' },
  { cat: 'Ekwipunek', cmd: 'przeszukaj', desc: 'Przeszukuje skrzynie w promieniu 32' },
  // Budowanie
  { cat: 'Budowanie', cmd: 'buduj <budowla>', desc: 'dom, zamek, zamczysko, pałac, pałac endu…' },
  { cat: 'Budowanie', cmd: 'buduj napis: <tekst>', desc: 'Napis z bloków' },
  { cat: 'Budowanie', cmd: 'zburz <budowla>', desc: 'Rozbiera budowlę (pyta o potwierdzenie)' },
  { cat: 'Budowanie', cmd: 'rozbierz rusztowania', desc: 'Usuwa lewitującą ziemię z rusztowań' },
  { cat: 'Budowanie', cmd: 'projekty', desc: 'Lista budowli z Kreatora (buduj <nazwa>)' },
  // Wlasne komendy
  { cat: 'Własne komendy', cmd: 'moje komendy', desc: 'Lista komend, których nauczyłeś bota' },
  { cat: 'Własne komendy', cmd: 'naucz sie <nazwa>: <krok>; <krok>', desc: 'Nowa komenda z kroków, np. naucz się drewno: zdobadz drewno 16; idz do bazy; schowaj' },
  { cat: 'Własne komendy', cmd: 'zapomnij komende <nazwa>', desc: 'Usuwa własną komendę' },
  // Zespol
  { cat: 'Zespół', cmd: 'pomoz', desc: 'Dołącza do pracy innego bota (budowa, burzenie, walka)' },
  { cat: 'Zespół', cmd: 'pomoz <bot>', desc: 'Pomaga konkretnemu botowi' },
  { cat: 'Zespół', cmd: 'pomoc <kto> <komu>', desc: 'Na czacie gry: np. pomoc Kopacz Claude – Kopacz dołącza do pracy Claude, inne boty to ignorują' },
  { cat: 'Zespół', cmd: 'popros <bot> o <co> <ile>', desc: 'Prosi innego bota o przedmioty – przyniesie je' },
  // AI w grze (wlaczane w ustawieniach bota)
  { cat: 'AI w grze', cmd: 'ai <pytanie>', desc: 'Pytanie do AI na czacie gry, np. ai jak pokonać smoka?' },
  { cat: 'AI w grze', cmd: 'Claude, <prośba>', desc: 'Prośba do bota po nicku – komenda albo zadanie dla AI, np. Claude, zbuduj coś fajnego' },
  // Inne
  { cat: 'Inne', cmd: 'chat <tekst>', desc: 'Pisze na czacie gry' },
  { cat: 'Inne', cmd: 'skrzynie wl', desc: 'Zaglądanie do skrzyń w trakcie zadań' },
  { cat: 'Inne', cmd: 'skrzynie wyl', desc: 'Wyłącza zaglądanie do skrzyń' },
  { cat: 'Inne', cmd: 'permisja <nick>', desc: 'Pozwala graczowi wydawać komendy (serwer)' },
  { cat: 'Inne', cmd: 'tak', desc: 'Odpowiedź „tak" na pytanie bota' },
  { cat: 'Inne', cmd: 'nie', desc: 'Odpowiedź „nie" na pytanie bota' }
]

window.BUILDINGS = [
  { id: 'dom', name: 'Dom', icon: '🏠', desc: 'Dom 7×7 z desek i pni: drzwi, okna, dach, stół, skrzynia, piec.', mat: '124 deski, 16 pni', decor: true },
  { id: 'dom villagera', name: 'Dom villagera', icon: '🛖', desc: 'Domek 5×5 jak w wiosce, fundament z bruku, dach ze szczytem.', mat: '65 desek, 13 pni, 16 bruku', decor: true },
  { id: 'zamek', name: 'Zamek', icon: '🏯', desc: 'Mury 13×13 z blankami, brama, 4 wieże, drabiny.', mat: 'ok. 450 bruku', decor: true },
  { id: 'zamczysko', name: 'Zamczysko', icon: '🏰', desc: 'Mury 21×21, 4 wieże 5×5, donżon, drabiny.', mat: 'ok. 1630 bruku', decor: true },
  { id: 'palac', name: 'Pałac', icon: '👑', desc: 'Sala z kolumnami i oknami, taras, 4 okrągłe wieże i wieża środkowa z iglicami.', mat: 'ok. 1000 bruku, 370 desek, 64 pnie', decor: true },
  { id: 'palac endu', name: 'Pałac Endu', icon: '🔮', desc: 'Purpur i end stone, fioletowe witraże, kopuły z iglicami, wieża 30 bloków.', mat: 'ok. 2800 bloków z Endu – najlepiej w kreatywnym', decor: true },
  { id: 'baza podziemna', name: 'Baza podziemna', icon: '⛏', desc: 'Schody 8 w dół i pokój 7×7 ze stołem, piecem i skrzynią.', mat: '–', decor: true },
  { id: 'skybase', name: 'Skybase', icon: '☁', desc: 'Słup do y=150 i platforma 9×9 z murkiem.', mat: 'ok. 200 bruku', decor: false }
]

window.FARMS = [
  { cmd: 'buduj farma zboza', label: '🌾 Zboże' },
  { cmd: 'buduj farma marchwi', label: '🥕 Marchew' },
  { cmd: 'buduj farma ziemniakow', label: '🥔 Ziemniaki' },
  { cmd: 'buduj farma burakow', label: '🟥 Buraki' },
  { cmd: 'buduj farma drzew', label: '🌳 Drzewa' },
  { cmd: 'buduj farma trzciny', label: '🎋 Trzcina' },
  { cmd: 'buduj farma zwierzat', label: '🐄 Zagroda' }
]

window.QUICK = [
  { cmd: 'kontynuuj', label: '⏯ Kontynuuj' },
  { cmd: 'tu', label: '📍 Do mnie', needsPlayer: true },
  { cmd: 'chodz za mna', label: '🚶 Za mną', needsPlayer: true },
  { cmd: 'ochraniaj', label: '🛡 Ochraniaj', needsPlayer: true },
  { cmd: 'idz do bazy', label: '🏠 Do bazy' },
  { cmd: 'baza', label: '🚩 Ustaw bazę' },
  { cmd: 'jak tam', label: '💬 Jak tam?' },
  { cmd: 'eq', label: '🎒 Ekwipunek' },
  { cmd: 'jedz', label: '🍖 Jedz' },
  { cmd: 'zdobadz jedzenie 10', label: '🥩 Zdobądź jedzenie' },
  { cmd: 'zaloz', label: '🦺 Załóż zbroję' },
  { cmd: 'daj wszystko', label: '🎁 Daj wszystko', needsPlayer: true },
  { cmd: 'spij', label: '🛏 Śpij' }
]
