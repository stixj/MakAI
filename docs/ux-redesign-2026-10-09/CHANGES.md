# MakAI — přehled změn INS-10005

9. října 2026. Uživatel schválil publikaci změn jako INS-10005 do Gitu a na Vercel. Níže uvedené výsledky a poznámky popisují místní kontrolu před nasazením. Aplikace běží na http://localhost:5180/ (čerstvý Vite server). Starší servery na portech 5173 a 4173 jsem nezastavoval.

## Co se změnilo

- Tři hlavní sekce: Nabídky, Moje přihlášky, Profil a hledání. Profilový panel je v přehledu kompaktní, nastavení má vlastní sekci.
- Stručné karty s rolí, firmou, lokalitou, mzdou, důvodem shody a jednou nejistotou. Celá analýza, text a editace jsou v jednotném detailu.
- Detail lze otevřít přímo přes hash URL podle ID. Filtry a stránka jsou v URL; návrat z detailu zachová pozici seznamu.
- Koncepty přihlášky, nabídky, ručně přidané nabídky, úprav profilu, dotazníku a nastavení se uchovávají v sessionStorage této karty prohlížeče s platností 24 hodin. Potvrzené uložení koncept smaže; odhlášení smaže koncepty. Samotný raw text CV se do sessionStorage neukládá.
- Přihláška má stále dostupné tlačítko uložení. Obnoví se po opuštění detailu nebo reloadu; starý koncept nemůže automaticky přepsat novější verzi uloženou na jiném zařízení.
- Úprava existujícího sdíleného profilu zachovává jeho ID a všechny navázané nabídky, přihlášky a události. Obsah má vlastní hash a revizi s kontrolou souběžných změn. Samostatné vytvoření nového profilu nadále vytváří samostatný kontext.
- Hodnocení před změnou profilu nebo nabídky je označené jako zastaralé. Na výslovnou akci lze přehodnotit upravenou nebo dříve vyhodnocenou nabídku. Původní text inzerátu a evidence přihlášky zůstávají zachované.
- Nastavení hledání nabízí Uložit a hledat. Při neuložených změnách nelze omylem spustit hledání podle starých parametrů.
- Průvodce uchovává odpovědi, zjednodušuje kontrolu návrhu a umožňuje dokončení bez AI. Mzdové částky jsou zatím stále povinné podle současného datového kontraktu.
- Novější řazení má přesný název Naposledy přidané. Dostupnost inzerátu se neprezentuje jako ověřená bez kontroly.
- Login umožňuje zobrazit heslo a nabízí postup při ztrátě přístupu. Navigace, filtry a hlavní akce mají odlišnou vizuální hierarchii.
- Webové logo má 57 kB namísto 580 kB; favicon přibližně 5 kB namísto 1 MB. Původní soubory zůstávají zachované.

## Navazující úprava Moje přihlášky

- Souhrn je kompaktní a karty uvádějí další krok, jeho termín nebo nejbližší pohovor. Počet dní popisuje dobu od odeslání reakce, nikoli neznámý okamžik změny stavu.
- Detail začíná doporučeným dalším krokem. Kroky po termínu mají přednost; uzavřená přihláška nedostává nové doporučení. Připomenutí po sedmi dnech je pouze volitelný návrh ručního kroku, žádná zpráva se neposílá automaticky.
- Přidání, dokončení, odebrání a změna termínu kroku, pohovory a kontakty se ukládají samostatně. Rozepsané poznámky, stav, datum a údaje reakce zůstávají konceptem až do Uložit změny. Každá akce používá kontrolu revize.
- Neúspěšné přidání zachová vstup; opakování nevytvoří duplicitu. Údaje o odeslané reakci jsou rozbalovací. Mobilní pole nového kroku zabírá celou šířku.
- Aktuální frontend má 101 úspěšných testů. Následná vizuální kontrola ve smyšleném scénáři: mobil 390 px bez vodorovného přesahu, žádné runtime výjimky. Nové snímky jsou pouze v dočasném adresáři mimo Git. Níže uvedené obrázky zachycují první fázi redesignu před touto navazující úpravou.

## Priority, překlad a obsah přihlášek

- Hvězdička Moje priorita funguje v přehledu nabídek i přihlášek, před reakcí i po ní. Filtr a řazení pracují nad celou historií před stránkováním. Priorita nemění AI skóre, uložení ani stav reakce. Detail nabízí volitelný osobní důvod zájmu s vlastním uložením, konceptem a kontrolou revize.
- Celý text inzerátu lze přeložit do češtiny a přepínat s originálem. Překlad se uloží do sdílené databáze podle hashe zdrojového textu. Změna textu vyřadí zastaralý překlad. Stejný překlad se znovu negeneruje; souběžné žádosti mají zámek s časovým limitem. Překlad používá stávající AI konfiguraci, neodesílá CV ani osobní profil. Limit je 20 000 znaků zdroje a 30 nových generování denně pro aplikaci; uložené překlady jsou dostupné i po dosažení limitu. Frontend i Vercel endpoint mají limit 120 s.
- Tři volitelné rozbalovací bloky evidují konkrétní názvy/verze/jazyk odeslaných podkladů a způsob přihlášení, uzávěrku, slíbený termín odpovědi, kolo řízení, zadání a jeho odevzdání, otázky, skutečně nabídnuté podmínky a výsledek. Podklady jsou textová evidence; upload dokumentů nebyl přidán.
- Slíbený termín odpovědi má přednost před obecným návrhem připomenutí po sedmi dnech. Neodevzdané zadání a zmeškaná slíbená odpověď se promítají do přehledu dalších kroků. Odevzdané zadání přestane být doporučeným krokem.
- Nabídky ve stavech Nabídka spolupráce / Přijato lze rozbalit do porovnání podmínek, požadované mzdy a nevyjasněných otázek. Neznámé údaje se nepředstírají a chybějící obsah není povinný.
- Nové tabulky jsou aditivní; nebyla provedena změna ani mazání stávajících nabídek. Rozšířené údaje přihlášek používají dosavadní historii událostí a kontrolu revize. Nové API zachová doplňující pole také při uložení starším klientem, který je nezná.
- Ověření: 109 frontendových testů, oba buildy, skutečný localhost HTTP 200 a filtr priorit (zatím prázdný, 22 původních nabídek). Izolovaný browserový průchod použil skutečné úložiště v paměti a simulovanou AI: desktopové porovnání, mobilní seznam, detail, rozbalené údaje a přepnutí překladu/originálu. Mobil 390 px měl všude scrollWidth 390 px, bez runtime výjimek. Nové kontrolní PNG jsou mimo projekt v dočasném adresáři.
- Nebyl spuštěn placený překlad, změněny skutečné přihlášky ani osobní priority. Živý překlad závisí na připojeném AI poskytovateli a dostupném kreditu. Do Gitu ani Vercelu nebylo publikováno. Před používáním nových údajů na více prostředích je nutné aktualizovat také online API; současné starší nasazené API tato pole ještě nezná.

## Vizuální kontrola

Snímky používají smyšlené nabídky a databázi v paměti, bez osobních dat a placených AI volání. [Desktop](desktop.png), [mobil](mobile.png), [detail nabídky](offer-detail.png), [mobilní detail](offer-mobile.png), [přihláška](application.png), [profil](profile.png). Měření: [measurements.json](measurements.json).

Ve stejném testovacím scénáři začíná první karta nově přibližně na 581 px desktop / 644 px mobil, dříve 1189 / 1671 px. Na mobilu se její výška zkrátila ze 745 na 400 px. Mobil 390 px nemá vodorovný přesah.

Browserový průchod ověřil obnovení poznámky po zavření detailu i po reloadu. Konzole v izolovaných kontrolách neměla runtime výjimky.

## Ověření

- Frontend: 109 testů; zahrnují zachování historie při úpravě profilu, přehodnocení upravené nabídky, obnovu konceptu a odmítnutí přepsání novějších dat.
- Python backend: 135 testů; včetně stabilní identity profilu se samostatným hashem obsahu a odmítnutí změněného snapshotu.
- `npm run build` a `npm run build:cloud`.
- Čerstvý localhost: HTTP 200, profil dostupný, 22 uložených nabídek, 12 řádků na první stránce. Neproběhlo nové skutečné hledání ani AI zpracování.

## Co si projít

1. Přehled nabídek, filtrování, uložené položky a mobilní rozvržení.
2. Detail nabídky, celý inzerát a návrat do seznamu.
3. Moje přihlášky: rozepsat poznámku, zavřít detail a znovu ho otevřít; ověřit obnovu konceptu.
4. Profil a hledání: nový průvodce, ruční dokončení, zjednodušená kontrola a nastavení hledání.

## Následné společné nasazení

Hledání z localhostu používá sdílenou databázi a online GitHub worker. Nový protokol revizí profilu a přehodnocení potřebuje aktualizovat Python worker i Vercel API společně. Dokud nejsou nasazené, jejich nové živé AI cesty nejsou ověřené proti produkčnímu workeru. Při místní kontrole dávej přednost prohlížení a konceptům; aktivaci změněného skutečného profilu a nové přehodnocení je vhodné ověřit po společném nasazení.

Do Gitu ani Vercelu zatím nebylo nic publikováno. Přechod na profily s neznámou mzdou, skutečné ověřování otevřenosti inzerátů a samoobslužná obnova účtu jsou samostatná navazující práce, nikoli hotové funkce této změny.
