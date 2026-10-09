# Správa přihlášek

V hlavním rozhraní jsou sekce **Nabídky** a **Moje přihlášky**. Uložené a skryté nabídky jsou filtry sekce Nabídky. Označení Reagoval jsem nic neodesílá firmě.

Moje přihlášky ukazují čekání na odpověď, otevřené úkoly a nadcházející pohovory. Přihlášky zůstávají dostupné i po skrytí nabídky. V detailu lze zadat datum reakce (nebo ponechat neznámé), stav, poznámky, kontakty, další kroky a termíny pohovorů. Uzavřené přihlášky mají vlastní filtr. Odpovědi firem se evidují ručně.

Každý zápis detailu a změna označení reakce vytvářejí událost. Zrušení reakce zachovává poznámky a historii pro pozdější obnovení. Souběžná úprava detailu vrací konflikt, místo aby přepsala novější data. Datum události je datum zápisu v MakAI; datum reakce se zadává samostatně.

## Nabídky bez AI

Přidat nabídku umožňuje ruční zadání nebo doplnění z veřejného HTTPS odkazu. Import čte strukturovaný JobPosting, případně název stránky, a vyžaduje kontrolu údajů před uložením. Nedostupný web, JavaScriptový detail nebo blokování portálem nebrání ručnímu zadání. Import nevolá AI. Síťové požadavky mají omezenou velikost a čas; privátní adresy, přihlašovací údaje v URL a přesměrování do interní sítě jsou odmítnuté. DNS odpověď je připnutá k vlastnímu HTTPS spojení.

Ruční nabídka může být bez URL, bez popisu a bez skóre; nehodnocená nabídka není NO_GO. Datum publikace se nedoplňuje odhadem. Nabídka se ukládá do Uložených a může rovnou obsahovat již odeslanou reakci. Duplicitní URL (bez marketingových parametrů), URL zdrojů a kanonická identita firmy/pozice/lokality vracejí existující nabídku, bez druhé přihlášky.

Text lze doplnit později v detailu nabídky. Volitelné Vyhodnotit pomocí AI vytvoří jeden běh ve stávající cloudové frontě; využívá nastaveného poskytovatele a jeho kvótu/náklady. Worker dostává neměnný profil a nabídku. Ověřený výsledek se ukládá odděleně od přihlášky; zrušený běh výsledek nezapíše. Při automatickém hledání jsou ruční nabídky zahrnuté do deduplikace, takže nevzniká druhá placená evaluace stejné pozice.

## Ukládání a migrace

Cloud a sdílený localhost používají stejné API a tabulky v Turso. Režim localhostu s VITE_LOCAL_STORAGE=files a statická ukázka nové serverové funkce nezapínají.

Nové tabulky jsou makai_manual_offers, makai_applications, makai_application_events, makai_application_imports, makai_offer_edits a makai_offer_evaluation_versions. Stávající profily, vyhodnocené nabídky, skóre a data hodnocení se nepřepisují. Starší applied příznak se zobrazuje s neznámým datem, pokud k němu neexistují podklady.

Při lokální migraci se navíc načítají potvrzené applied záznamy z data/application_history.json do původního profilu. Nepotvrzené a not_applied záznamy nejsou prezentované jako odeslané přihlášky. Neznámá data zůstávají null. Importní značka zabraňuje opětovnému označení přihlášky po jejím pozdějším zrušení uživatelem. Zdrojové soubory zůstávají zachované. Lokální data/results.json obsahující demo výsledky se nepřidávají do skutečné historie.

Z frontend/ lze spustit:

~~~powershell
npm run verify:storage
# Idempotentní migrace místních profilů, historie a potvrzených přihlášek:
npm run verify:storage -- --migrate
~~~

Kontrola vypisuje pouze identifikátory a počty, nikdy přístupové údaje. Neprokazuje sama shodu s konfigurací Vercelu; obě prostředí musí mít stejné DATABASE_URL.

## Připomínky

Pohovor lze exportovat do kalendáře jako ICS s připomínkou 30 minut předem. Její doručení závisí na importu a nastavení kalendáře. Automatické push/e-mail připomínky MakAI při zavřené aplikaci jsou další etapa: vyžadují registraci odběru, doručovací kanál a serverový plánovač s ochranou proti opakovanému odeslání. Tato změna je nesimuluje pomocí časovače v prohlížeči.

## Ověření a omezení prostředí

Implementace navazuje na sloučený PR #3 (7399c7a). Lokální Git metadata byla při zahájení na e002cce; chybějící soubory PR #3 byly načteny přes GitHub konektor. Původní .git je v tomto prostředí pouze pro čtení a git fetch přes dostupný náhradní proces nemá síťový přístup.

Živé spojení s Turso a prohlížeč nebyly dostupné. Osobní cloudová data nebyla migrována ani změněna; jejich skutečnou synchronizaci a vizuální vzhled nelze na základě offline testů potvrdit. Testy používají skutečnou SQLite, stejná API pro localhost/cloud, React komponenty a mockované hranice síťových služeb. Nasazení je evidované v GitHub PR a ve stavu Vercelu.

Závěrečné ověření: 94 JavaScript testů a 118 Python testů prošlo; statický, lokální i cloudový build prošly. Patch nové implementace vůči PR #3 je uložený v data/makai-applications.patch (gitignored).

## Dodatečné úpravy nabídky a reakce

Upravit nabídku je dostupné na kartě každé nabídky i v detailu přihlášky. Lze změnit pozici, firmu, lokalitu, mzdu inzerátu, odkaz a text; platí i pro historické a hodnocené nabídky. Opravy jsou uložené odděleně od původního záznamu a mají vlastní revizi a událost v historii. Původní AI hodnocení a datum se zachovávají; rozhraní upozorní, pokud hodnocení předchází úpravě. Deduplikace zahrnuje původní i opravené identity.

Pole **Plat / rozmezí uvedené firmě** patří k odeslané reakci, nikoli k inzerátu. Přijímá přesné znění včetně měny, období, hrubého/čistého základu a bonusů. Je viditelné v přehledu i detailu přihlášky. **Další údaje o odeslané reakci** uchovávají způsob reakce, napsaný text nebo přiložené podklady. Obě pole lze doplnit při vložení již odeslané reakce i zpětně; starší záznamy mají bezpečný prázdný výchozí stav. Uložení těchto změn nespotřebuje AI tokeny.
