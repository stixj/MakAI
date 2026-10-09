# MakAI — audit UI, UX a CX

Datum: 9. října 2026. Rozsah: místní projekt MakAI, současné React komponenty a návazné datové chování.

## Verdikt

MakAI má užitečné produktové jádro a konzistentní, klidnou barevnost. Rozhraní ale nechává uživatele obsluhovat příliš mnoho částí systému předtím, než může rozhodnout o nabídce. Největší přínos přinese změna informační hierarchie, oddělení přehledu od detailu a ochrana kontinuity práce. Vizuální úpravy mají tuto změnu podpořit.

Apple beru jako měřítko jednoduchosti, předvídatelnosti a péče o detail; jde o odborný heuristický audit, nikoli zkušenost zaměstnance Apple ani uživatelský výzkum.

## Jak bylo hodnocení ověřeno

Prošel jsem App, karty, profil, průvodce, editor, automatiku, přihlášení, ruční přidání nabídky a evidenci přihlášek. Datovou návaznost jsem ověřil ve cloudStore, cloudProfile, opportunityApi, historyQuery a offerEditing.

Skutečné komponenty jsem zobrazil v izolovaném Vite náhledu bez skutečného backendu. API odpovědi byly smyšlené a všechna aplikační fetch volání zachycená. Náhled použil lokální režim se sdíleným rozhraním. Neprováděl jsem hledání, zápisy do skutečné databáze, upload CV ani placená AI volání. Vizualizované nabídky a profil jsou testovací; neposuzoval jsem kvalitu skutečných doporučení AI.

Snímky: [desktop](desktop.png), [mobil](mobile.png), [detail přihlášky](application.png), [průvodce](wizard.png), [první návštěva](onboarding.png). [Měření a reprodukce](measurements.json).

| Měření ve smyšleném scénáři | Desktop 1440 × 1000 | Mobil 390 × 844 |
| --- | ---: | ---: |
| Začátek první karty od horního okraje dokumentu | 1189 px | 1671 px |
| Výška první karty | 745 px | 745 px |
| Výška stránky se třemi nabídkami | 2201 px | 4241 px |

Mobilní náhled neměl vodorovný přesah: šířka dokumentu 390 px. Měření vyjadřuje tento scénář, nikoli všechny stavy aplikace. Delší skutečné texty mohou rozvržení změnit.

## Co zachovat

- Rozlišení silné, možné a nízké shody v češtině; výsledky mají konkrétní důvody a nejistoty.
- Klidnou teal/sand paletu, konzistentní komponenty a rozumné rozestupy uvnitř formulářů.
- Transparentní sdělení, že skóre není pravděpodobnost přijetí.
- Kontrolu AI návrhu profilu před aktivací, vysvětlení odeslání CV poskytovateli a ruční evidenci reakce.
- Vrácení změny po skrytí/uložení, focus ring, odkaz pro přeskočení na obsah, stavové hlášky a omezení animací.

## Nálezy a doporučené zásahy

P0 = opravit nejdřív kvůli ztrátě práce. P1 = zásadní tření nebo narušení důvěry. P2 = další zlepšení srozumitelnosti a kvality. Dopady na konverzi jsou hypotézy k ověření, nikoli naměřené výsledky.

### 1. P0 — Zavření detailu zahodí rozepsané údaje

**Důkaz:** do poznámky přihlášky jsem vložil text. Zobrazilo se „Máš neuložené změny“. Klikl jsem na „Zavřít detail“, znovu otevřel stejnou přihlášku a pole bylo prázdné. Upozornění není ochranou před opuštěním. Zavření odmountuje detail; přepnutí hlavní sekce ho také odmountuje.

**Dopad:** člověk může přijít o poznámky z hovoru nebo přípravu na pohovor. To narušuje důvěru v evidenci.

**Úprava:** uchovávat rozpracovaný formulář podle profilu a nabídky, případně bezpečné automatické ukládání se zřetelným stavem. Dokud není hotové, při odchodu s dirty formulářem nabídnout „Uložit“, „Zahodit“, „Pokračovat v úpravách“. Pokrýt zavření, změnu sekce, změnu vybrané přihlášky a obnovu stránky. Draft obsahuje osobní údaje; jeho umístění a životnost musí být vědomé rozhodnutí.

**Ověření:** stejný scénář zachová text nebo vyžádá vědomé zahození. Zdroj: frontend/src/components/ApplicationDetail.jsx:17 a :21; frontend/src/App.jsx:217 a :222.

### 2. P1 — Úprava profilu mění kontext historie

**Důkaz v kódu:** parseCloudProfile vytváří ID jako SHA-256 obsahu. saveProfile aktivuje toto ID a vypne automatiku. Nabídky, označení a přihlášky jsou svázané s profilem; opportunityHistory čte tabulku odvozenou z jeho ID. Obsahová změna tedy přepne na jiný kontext. Starší data se tím nemažou, ale uživatel je v novém kontextu nemusí vidět. Živou migraci ani přepnutí skutečné databáze jsem netestoval.

**Dopad:** i běžná změna mzdy může působit jako zmizení rozpracované práce. Nové verze mohou mít stejný název a být těžko rozlišitelné.

**Úprava:** oddělit identitu pracovního profilu od jeho revize. Uchovat přihlášky a uložené nabídky napříč revizemi téhož profilu; hodnocení označit revizí, ze které vychází. Nový kariérní scénář vytvářet explicitně. Dočasně před uložením jasně popsat změnu kontextu, nabídnout návrat a uvést datum/verzi profilu. Pozastavení automatiky po změně preferencí má smysl, musí ale mít zřetelný další krok.

**Ověření:** změna mzdové preference neznepřístupní rozpracované přihlášky stejného člověka. Zdroj: frontend/server/cloudProfile.js:33; cloudStore.js:101; opportunityApi.js:28.

### 3. P1 — Hodnota produktu se objevuje příliš pozdě

**Důkaz:** první karta začíná na desktopu na 1189 px a na mobilu na 1671 px. Před ní jsou úvod, velký profilový panel, automatika, hlavní sekce, kolekce, čtyři statistiky, vysvětlivky, filtry a stránkování. Profilový panel zůstává nad obsahem i v „Moje přihlášky“.

**Úprava:** pro vracejícího se uživatele kompaktní záhlaví s profilem a stavem hledání; hlavní sekce ihned pod ním; potom samotné nabídky. Správu profilu a automatiku přesunout do vlastní sekce. Statistiky změnit na stručné počty u filtrů. Horní stránkování skrýt, pokud existuje jediná stránka.

**Ověření:** na desktopu 1440 × 1000 je první skutečná nabídka v prvním viewportu; na mobilu 390 × 844 je vidět alespoň její název a firma. Tyto hodnoty jsou návrh kritérií pro redesign.

### 4. P1 — Karta je současně přehled, analýza i editor

**Důkaz:** testovací první karta má 745 px. Obsahuje badge, mzdu, číslo skóre, proužek skóre, vysvětlení skóre, důvody, mezery, další details, celý inzerát a několik akcí. Úprava nabídky je přímo na každé kartě. Výšky karet se liší.

**Dopad:** srovnávání je náročné a člověk musí číst mnoho textu před rozhodnutím.

**Úprava:** stručná karta nebo řádek: role, firma, lokalita/režim, mzda, slovní shoda, jeden konkrétní důvod a nejvýznamnější nejistota. Primární akce „Prohlédnout nabídku“, vedle „Uložit“, další akce v menu. Analýzu, celý inzerát, zdroje a editaci přesunout do jednotného detailu. Vysvětlení skóre jednou u přehledu.

**Ověření:** uživatel dokáže srovnat pět nabídek bez postupného rozbalování tří částí každé karty. Zdroj: frontend/src/components/JobCard.jsx:30–99.

### 5. P1 — Detail nabídky není jednotné místo

**Důkaz:** název role neotevírá detail; části nabídky se rozbalují přímo v kartě. „Detail přihlášky“ je k dispozici až při označené reakci. Přidání, úprava a přihláška se otevírají jako dlouhé vložené panely. Otevření duplicity pouze přepne do nabídky a vyhledá její název, nikoli přesný detail.

**Úprava:** všechny nabídky mají stejnou detailní stránku s cestou podle ID. V ní shrnutí, AI analýza, původní inzerát a podle stavu evidence přihlášky. Z výsledků, uložených položek i duplicit otevírat stejnou entitu.

**Ověření:** odkaz na detail otevře přesnou nabídku i po obnovení stránky; návrat zachová filtry a pozici v seznamu. Zdroj: frontend/src/App.jsx:137–147; JobCard.jsx:39 a :88.

### 6. P1 — Průvodce vyžaduje hodně práce před prvním výsledkem

**Důkaz:** otázky požadují delší volné texty o směru, zkušenostech a dovednostech, potom podmínky, tři povinné mzdové částky a rozsáhlou kontrolu návrhu. Kontrola má osm seznamů a další mzdové možnosti. Bez konfigurace AI lze dotazník vyplňovat, ale dokončení návrhu je zablokované. Rozpracování je v React state a nepřežije obnovu. Návrat z prvního kroku na výběr metody a opětovný výběr dotazníku provede setAnswers({}).

**Úprava:** hlavní cestu vést přes CV, potom doplnit jen chybějící preference. Ruční cesta nabídne příklady a jednoduché strukturované vstupy; neznámou mzdu dovolit, což vyžaduje i změnu datového modelu. Kontrolu shrnout do srozumitelných bloků, úplný editor ponechat jako další možnost. Uchovat draft a při nedostupné AI umožnit dokončení ručně. Rozpracovaný průvodce vyčlenit z dashboardu.

**Ověření:** při výpadku AI a obnově stránky se uživatel vrátí k odpovědím. Po aktivaci nabídnout přímo „Najít první nabídky“. Zdroj: ProfileWizard.jsx:10–26, :80, :100 a :118; lib/profileDraft.js:23.

### 7. P1 — Změna nastavení a spuštění hledání nejsou pevně propojené

**Důkaz:** SchedulePanel má vlastní dirty draft. startHunt v ProfilePanel čte poslední uložený plán z API. Upozornění na neuložené změny je až dole ve formuláři; primární tlačítko hledání je nahoře mimo něj.

**Úprava:** rozlišit parametry příštího hledání a časový plán automatiky. Před ručním spuštěním stručně ukázat použité období a rozsah. Při rozepsaných parametrech nabídnout „Uložit a hledat“ nebo explicitní spuštění se starým nastavením. Stav „čeká“ doplnit skutečně měřitelným časem čekání a další možností; nevymýšlet procentuální průběh.

**Ověření:** člověk ví, zda hledá podle právě změněných nebo uložených podmínek. Zdroj: ProfilePanel.jsx:92; SchedulePanel.jsx:89.

### 8. P1 — Zastaralá AI analýza zůstává výrazným doporučením

**Důkaz:** po úpravě nabídky se staré skóre a verdikt stále zobrazují standardně. Text o zastaralosti je až u akcí. Karta nabízí hodnocení pouze ruční nabídce bez evaluation; server evaluateOffer opětovné hodnocení existující evaluation odmítá.

**Úprava:** označit „Hodnocení před změnou údajů“ přímo u verdiktu, snížit jeho vizuální autoritu a nabídnout řízené přehodnocení. Oddělit důvod shody, skutečnou překážku a neověřenou podmínku. Zdroj: JobCard.jsx:87–89; cloudStore.js:149–158.

**Ověření:** změna důležité podmínky nemůže působit jako aktuálně potvrzené doporučení.

### 9. P2 — „Nejnovější nabídky“ znamená něco jiného než uživatel čeká

**Důkaz:** řazení newest používá čas hodnocení, u ručních položek také čas přidání; není to datum zveřejnění inzerátu. Zveřejnění je schované v podrobnostech. V přehledu není viditelné ověření, zda je nabídka stále otevřená.

**Úprava:** přejmenovat na „Naposledy přidané“ nebo přidat skutečné řazení podle zveřejnění. Viditelně rozlišit zveřejnění, přidání do MakAI a poslední ověření dostupnosti. Ukazovat „Aktivní“ pouze po skutečném ověření. Zdroj: App.jsx:278; lib/jobs.js:79; server/historyQuery.js:46–47.

### 10. P2 — Detail přihlášky je dlouhý administrativní formulář

**Důkaz:** detail se otevře pod přehledem, zatímco seznam dalších přihlášek zůstává pod ním. Stav, reakce, úkoly, pohovory, poznámky a kontakty jsou součástí společného formuláře. Přidat krok nebo pohovor ještě neznamená uložit změnu. Globální uložení je až za těmito částmi.

**Úprava:** samostatný detail s jasným stavem a nejbližším krokem nahoře. Sekce Přehled, Poznámky, Pohovory, Kontakty a Historie. Každá přidaná entita má jasný stav uložení; globální save bar zůstává dostupný. Po „Reagoval jsem“ nabídnout datum, použitou mzdu a další krok, ale neblokovat zaznamenání reakce.

**Ověření:** uživatel správně rozliší rozpracovaný úkol od uloženého. Zdroj: ApplicationsPanel.jsx:30; ApplicationDetail.jsx:27–35.

### 11. P2 — Vizuální hierarchie a texty potřebují sjednotit

**Důkaz:** aktivní hlavní sekce, aktivní kolekce i CTA používají stejnou vyplněnou teal plochu. Na kartě jsou důležité údaje o shodě a mzdě v 10 px. V běžném profilu je text o Turso a localhostu. V přihláškách se střídají slova reakce a přihláška; akce „Vrátit reakci“ vyžaduje domyšlení, co změní.

**Úprava:** hlavní CTA teal; navigace podtržení nebo segment; filtry nenápadné chips. Mzdu a stav nabídky alespoň 12–14 px, běžné informace 14–16 px podle kontextu. Texty řídit uživatelským úkolem. Místo infrastruktury například „Hledáme i při zavřené aplikaci“ nebo „Poslední synchronizace…“. Jednotná terminologie a jasná vysvětlení evidenčních akcí. Rozměry ověřit klávesnicí, dotykem a při 200% zvětšení; úplný přístupnostní audit zatím neproběhl.

### 12. P2 — Značka a login potřebují lehčí provedení

**Důkaz:** logo má přibližně 580 kB, ikona 1,06 MB; favicon používá velký PNG. Současný vstupní cloudový formulář má jedno heslo, bez zobrazení hesla a bez samoobslužné obnovy.

**Úprava:** zmenšit a optimalizovat bitmapy, případně vytvořit odpovídající vektorový master a malé varianty ikony. Přidat zobrazení hesla a jasný postup při ztrátě přístupu. Pro osobní nástroj jedno heslo může stačit; před veřejným víceuživatelským produktem řešit i model účtů a soukromí, nejde jen o vzhled loginu. Zdroj: LoginGate.jsx; frontend/public/brand; frontend/index.html:9.

## Navržené hlavní flow

První návštěva: stručné vysvětlení hodnoty → CV nebo ruční základ → doplnění podmínek → přehledná kontrola → Najít první nabídky → výsledky → volitelná automatika.

Běžný návrat: nové relevantní nabídky a blížící se úkoly → stručné srovnání → detail nabídky → uložit / otevřít původní inzerát → zaznamenat odeslanou reakci → evidence dalšího kroku.

Hlavní navigace: Nabídky · Moje přihlášky · Profil a hledání. Přidat nabídku jako kontextová akce. Na mobilu lze použít spodní navigaci, pokud bude konzistentní a nebude zakrývat formuláře.

Samostatné cesty: /nabidky, /nabidky/:id, /prihlasky, /prihlasky/:id, /profil. Filtry v URL; přesná podoba cest je návrh, nikoli existující implementace.

## Pořadí práce

1. Ochrana neuložených údajů a jasné chování historie při revizi profilu.
2. Přesun nastavení, zkrácení dashboardu a jednotný detail nabídky; připravit desktopový i mobilní prototyp.
3. Kratší profilový průvodce, návaznost parametrů hledání a přehodnocení zastaralých analýz.
4. Sjednocení textů, velikostí, stavů a aktivních prvků; optimalizace značkových souborů.
5. Ověření s uživateli: vytvořit profil, vybrat ze seznamu nabídku, zaznamenat reakci, přidat pohovor, změnit mzdu bez ztráty přehledu.

Měřit čas do první prohlédnuté nabídky, dokončení profilu, opakované kroky/chybné odbočky, správné pochopení skóre a úspěšnost změny profilu bez ztráty kontextu. Zlepšení těchto metrik zatím nebylo měřeno.

## Závěr

Doporučuji upravit design i flow. První zásah má řešit kontinuitu práce; další zpřístupnit samotné nabídky a sjednotit jejich detail. Současná paleta může zůstat základem. Prémiový dojem vznikne z méně rozhodnutí na obrazovce, čitelného obsahu a předvídatelného chování.
