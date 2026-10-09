> **Aktuální lokální režim:** při `VITE_JOB_SOURCE=local` se profil, historie,
> plán a fronta hledání sdílí přes Turso s Vercel API. První místní spuštění
> převede stará data bez mazání. Viz [společné úložiště](../docs/shared-storage.md).
> Níže uvedené chování místních souborů platí jen pro `VITE_LOCAL_STORAGE=files`.

# MakAI frontend

## GitHub Pages

Workflow `.github/workflows/pages.yml` spouští testy, sestaví `frontend/dist`
a publikuje jej na `https://stixj.github.io/MakAI/`. V nastavení repozitáře
`Settings → Pages → Source` musí být vybráno `GitHub Actions`.
Build používá `VITE_BASE_PATH=/MakAI/`; lokální běh a ostatní hostingy
nadále používají `/`. Workflow lze také spustit ručně z karty Actions.

Pages nasazení neobsahuje databázové tokeny ani osobní profil. Bez připojeného
zdroje nabídek zobrazuje úvod aplikace a tlačítko pro explicitně označenou
ukázku se smyšlenými daty. Hledání a správa profilu vyžadují backend;
GitHub Pages je nespouští. Reálná data vyžadují samostatné zabezpečené API.

## Plná online aplikace na Vercelu

Vercel projekt má Root Directory `frontend`. Build `npm run build:cloud` nasadí
React rozhraní i zabezpečené Node API z `api/`. V aplikaci lze upravovat profil,
nastavit automatický plán, spustit nebo zastavit hledání a prohlížet historii.
Python hledání běží v GitHub Actions a výsledky i nastavení zůstávají v Turso.
Serverové databázové a AI klíče se nikdy neposílají do prohlížeče.
Konfiguraci a chování plánovače popisuje [online návod](../docs/online-setup.md).

Níže jsou zachované lokální a samostatné statické režimy. Přímý read-only token
se týká pouze statického režimu, nikoli plné online aplikace.

## Lokální spuštění

Pro skutečný lokální přehled s existujícím backendovým `.env` nastav ve
`frontend/.env.local` pouze:

```dotenv
VITE_JOB_SOURCE=local
```

Lokální build ukládá soubory do `dist/`, online build do `dist-cloud/`, takže
nasazení na Vercel nepřepíše běžící lokální náhled.

Pak ve složce `frontend` spusť `npm run dev` pro `http://localhost:5173`, nebo
`npm run build` a `npm run preview` pro `http://localhost:4173`.
Po změně prostředí restartuj server. Vite obsluhuje čtecí `/api/jobs`, který
bere `DATABASE_URL` a `TURSO_AUTH_TOKEN` z kořenového `.env`. Token zůstává
na místním serveru a nepřidává se do veřejného JavaScriptu. Endpoint přijímá
pouze místní GET požadavky a nic nezapisuje. Stránkovaný přehled filtruje celou historii a vrací pouze vybranou stránku.
Tento režim je určen pro localhost; pro statický Vercel nech `VITE_JOB_SOURCE`
prázdné a použij níže uvedený samostatný read-only token.

Potřebuješ Node.js 22.12+ (nebo novější podporovanou LTS verzi).

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Pokud `.env.local` existuje, kopírování přeskoč. Vyplň:

```dotenv
VITE_TURSO_DATABASE_URL=libsql://DATABASE-ORGANIZATION.REGION.turso.io
VITE_TURSO_AUTH_TOKEN=READ_ONLY_DATABASE_TOKEN
```

Konfigurace se čte z `frontend/.env.local`, nikoli z kořenového Python `.env`.
Po změně konfigurace restartuj Vite; produkce vyžaduje nový build.
Bez konfigurace lze tlačítkem **Prohlédnout ukázku** zobrazit tři jasně označené
smyšlené nabídky. Ukázka se nikdy nepoužívá jako náhrada při selhání databáze.

## Přímý přístup z prohlížeče

Vite zahrne `VITE_*` do veřejného JavaScriptu. Použij samostatný **read-only
databázový token**, nikdy zapisovací token backendu ani klíče Gemini/OpenAI.
Takový token umožňuje číst databázi každému, kdo aplikaci otevře; tento frontend
tedy není přístupovým omezením pro soukromé nabídky nebo CV údaje.

```powershell
turso db tokens create NAZEV_DATABAZE --read-only
```

Zdroje: [Vite environment variables](https://vite.dev/guide/env-and-mode),
[Turso tokeny](https://docs.turso.tech/cli/db/tokens/create),
[Turso web SDK](https://docs.turso.tech/sdk/ts/reference).

## Vercel

- Root Directory: `frontend`
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Přidej obě `VITE_TURSO_*` proměnné do zvolených prostředí před buildem.

`vercel.json` uvádí stejná nastavení. Aplikace používá jedinou stránku bez routeru,
takže není potřeba přesměrování ani Python runtime.
[Nasazení Vite na Vercel](https://vite.dev/guide/static-deploy.html#vercel).

## Data a ověření

```powershell
npm test
npm run build
npm run preview
```

Čte tabulku `makai_job_evaluations` se sloupci `offer_id`, `offer`,
`evaluation` a `evaluated_at`, shodně s `backend/app/turso.py`.
Nabídka a evaluace jsou JSON dle `backend/app/schemas.py`.
Frontend používá pouze SELECT; tabulky nevytváří a výsledky nemění.
Prázdná databáze bez tabulky má běžný prázdný stav.
Na localhostu lze zvolit 6, 12, 24 nebo 48 nabídek na stránce a přepínat očíslované stránky. Filtr typu shody, hledání a období platí pro celou uloženou historii. Přímé připojení k Turso načítá posledních 500 hodnocení.
Neplatné řádky přeskočí s viditelným počtem. Skóre neznamená pravděpodobnost přijetí.

## Původ vizuálního stylu

Referenční projekt: `C:/Users/Dell/Desktop/Viatix-main`.

- `tailwind.config.ts` → `tailwind.config.js`: přesná paleta, fonty, stíny,
  gradienty a rozšíření radiusu `4xl`; standardní `2xl/3xl` z Tailwind 3.
- `src/styles/viatix-tokens.css` a základní vrstva `src/index.css` →
  `src/index.css`: barevné proměnné, antialiasing, pozadí a focus ring.
- `index.html` → stejné importy Inter 400/500/600 a Poppins 300/400/600/700.
- `MemoryCard.tsx` → JobCard: `rounded-2xl`, `border-border/50`,
  `shadow-card`, padding `p-4`, hover stín a posun, 200 ms přechod.
- `StatusBadge.tsx` → pill badges s tečkou a mint/amber pozadím.
  Rose pro NO_GO navazuje na výstražné stavy v `ExpenseCard.tsx`.

Z Viatixu se přenesly pouze vizuální hodnoty a vzory, žádné služby, routery,
backendová logika ani API volání.

## Aktivní profil na localhostu

Lokální přehled zobrazuje jako výchozí existující `candidate_profile.md` z kořene projektu. Panel ukazuje cílové role, lokalitu, jazyky a mzdu a dovoluje rozbalit celý profil. Tlačítko **Hledat podle profilu** spustí automatický sběr z Jobs.cz, Práce za rohem, DobráPráce.cz, JenPrace.cz, Atmoskopu a Prace.cz a AI hodnocení; limit je na každý portál. Po dokončení zobrazí počet načtených nabídek a případné chyby jednotlivých zdrojů. Obnovení nabídek pouze načítá uložené výsledky. Hledání používá API klíče z backendové konfigurace a může být zpoplatněné podle poskytovatele. Nejde o časový plánovač.

Ve **Správě profilu** lze upravit aktuální profil nebo vytvořit nový pomocí AI.
Vyber životopis (čitelné PDF, DOCX, TXT/Markdown do 2 MB) nebo krátký dotazník.
AI předvyplní doložené zkušenosti a dovednosti; doplníš požadovanou práci,
lokalitu, mzdu a případné doplňující otázky. Návrh zkontroluješ a upravíš před
aktivací. Soubor CV se neukládá a generování nemění aktivní profil.
Stejný průvodce je dostupný i na Vercelu. PDF bez čitelného textu vyžaduje textovou
verzi nebo dotazník. Původní import profilových JSON/Markdown šablon byl z UI odstraněn.

Výběr se ukládá do `data/profiles/active.json`. Obsahové ID nahraného profilu určuje jeho vlastní složku a výsledky; původní výsledky z Turso zůstávají výchozímu profilu. Při návratu na výchozí profil se jiné profily nemažou. Během hledání nelze profil přepnout nebo spustit další běh.

**Časové vymezení nového hledání** umožňuje bez omezení, posledních 24 hodin, 7 nebo 30 dní. Rozhoduje datum zveřejnění od portálu, nikoli datum načtení. Při časovém omezení se neznámé datum ve výchozím stavu vynechá; lze výslovně zaškrtnout zahrnutí takových nabídek. Známé odkazy se nestahují znovu a uložené totožné pozice se nehodnotí znovu ani z jiného portálu. Staré/známé nabídky nespotřebují limit nových nabídek; sběr zůstává omezený stránkováním a nejvýše 300 načtenými detaily na portál. Výsledek ukazuje počty přeskočených nabídek.

**Historie vyhodnocených nabídek** obsahuje všechny úspěšně uložené výsledky aktivního profilu, včetně nízké shody, textu inzerátu a původních odkazů. Filtr **Vyhodnoceno** omezuje uloženou historii podle doby AI hodnocení. Je oddělený od filtru zveřejnění při novém hledání. Typ shody lze filtrovat podle STRONG FIT, POTENTIAL FIT nebo NO GO. Po změně filtru nebo počtu na stránce se přehled vrátí na první stránku. Nahrané profily ukládají historii atomicky do svého `results.json`; nové hledání staré výsledky neodstraňuje.

API `/api/profile` a `/api/hunt` je dostupné pouze přes lokální Vite plugin při `VITE_JOB_SOURCE=local`. Backend spouští interpreter `venv/Scripts/python.exe`; prostředí a API klíče se neposílají do prohlížeče. CLI `backend/run_hunt.py` používá výchozí profil projektu.

## Profil ze životopisu nebo dotazníku přes AI

**Vytvořit profil s AI** nabídne životopis nebo otázky. Průvodce pak obsahuje
směr a zkušenosti, pracovní podmínky a mzdu. Údaje předvyplněné z CV lze opravit;
neznámé informace AI nemá domýšlet. Návrh se uloží až po kontrole a výslovném
potvrzení. Selhání AI zachová rozpracované odpovědi a aktivní profil.

Server používá Gemini, pokud je k dispozici a `LLM_PROVIDER=auto`, jinak OpenAI.
Volbu lze upravit přes `PROFILE_LLM_PROVIDER` (`gemini` nebo `openai`).
`PROFILE_GEMINI_MODEL` dovoluje oddělit kvótu tvorby profilu od `GEMINI_MODEL`
používaného při hledání. V tomto nasazení je nastaven `gemini-3.1-flash-lite`.
Klíče zůstávají na serveru; průvodce zobrazuje vybraného poskytovatele před odesláním.

GET `/api/profile/draft` vrací přítomnost konfigurace a poskytovatele/model.
POST `/api/profile/cv` přečte soubor a připraví interview; POST `/api/profile/draft`
vytvoří návrh. Lokálně se používají stejné Node obsluhy jako na Vercelu, chráněné
kontrolou localhostu a původu požadavku. Při změně serverové konfigurace restartuj
Vite preview. Úložiště a spouštění lokálního hledání nadále obsluhuje Python.

Mzdy, lokalita, jazyky a no-go podmínky se přebírají z potvrzených odpovědí.
Kontaktní údaje pro hledání nejsou potřeba. Raw CV není součástí ukládaného profilu;
profesní kontext obsahuje zkontrolované shrnutí a odpovědi.

Strukturovaný výstup: [OpenAI dokumentace](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses),
[Gemini dokumentace](https://ai.google.dev/gemini-api/docs/structured-output).

Při vyčerpané denní kvótě API, chybě přístupu nebo nedostupnosti poskytovatele se AI dávka zastaví a zobrazí se konkrétní důvod. Dočasné chyby 5xx se zopakují nejvýše dvakrát s krátkým čekáním; kvóta 429 se automaticky neopakuje. Již úspěšná hodnocení se uloží. OpenAI fallback zůstává pouze výslovně povolenou volbou konfigurace.

**Zastavit hledání** se zobrazí během běhu. DELETE /api/hunt ukončí Python proces a zablokuje nový běh i přepnutí profilu do potvrzení jeho konce. Již uložená historie zůstává; rozpracovaná neuložená hodnocení se při okamžitém zastavení zahodí. Požadavek již odeslaný AI poskytovateli může být účtován i po ukončení místního procesu. Zastavení je dostupné také po obnovení stránky přes stav běhu na místním serveru.

## Úpravy UX — říjen 2026

Rozhraní má sekce Nabídky, Moje přihlášky a Profil a hledání. Stručná karta
otevře jednotný detail, který má vlastní hash URL. Filtry a stránka se uchovají
v URL; návrat z detailu obnoví pozici seznamu.

Rozepsané formuláře se uchovávají v sessionStorage této karty prohlížeče
s platností 24 hodin a smažou se při potvrzeném uložení nebo odhlášení.
Raw text CV se do tohoto úložiště neukládá. Koncept není automatické uložení
do sdílené databáze; přihlášku potvrď tlačítkem Uložit změny.

Úprava existujícího sdíleného profilu zachová jeho identitu a historii.
Obsah má samostatný hash a revizi; zastaralé hodnocení lze na vyžádání obnovit.
Python worker i Vercel API musí být aktualizované společně, aby byl protokol
revizí a přehodnocení dostupný i v živém hledání. Režim VITE_LOCAL_STORAGE=files
nadále používá původní souborový profilový registr.

Průvodce lze dokončit ručně i bez AI. Mzdové hranice se nadále řídí současným
povinným datovým kontraktem. Podrobný přehled změn a kontrol je v
[UX změnách](../docs/ux-redesign-2026-10-09/CHANGES.md).

### Osobní priority, překlad a evidence přihlášek

Moje priorita je samostatné označení nabídky uživatelem; nemění AI skóre ani stav reakce. Funguje i před podáním přihlášky a má filtr a řazení před stránkováním. Důvod zájmu se ukládá samostatně s kontrolou revize.

Překlad je dostupný v Celý inzerát a Původní nabídka. POST `/api/applications` s `action: translate` překládá pouze uložený text nabídky přes stávající serverovou AI konfiguraci. Výsledek se ukládá podle hashe textu; upravený text vyžaduje nový překlad. Originál se nepřepisuje. Limit: 20 000 znaků vstupu, 30 nových generování denně pro aplikaci, timeout 120 s. Zámek omezuje souběžné generování stejného překladu. AI transport je testován simulovanými odpověďmi; živé placené volání nebylo součástí automatické kontroly.

Volitelné údaje přihlášky evidují podklady (názvy a verze souborů, žádný upload), způsob reakce, uzávěrku, slíbenou odpověď, kolo řízení, zadání a jeho odevzdání, otázky, nabídnuté podmínky a výsledek. Termíny odpovědi a zadání ovlivňují další kroky; automatické zprávy firmám se neodesílají. Rozbalovací porovnání zobrazuje přihlášky ve stavech nabídka spolupráce / přijato.

Nové tabulky jsou aditivní (`makai_offer_interest`, `makai_offer_translations`). Před společným používáním těchto funkcí je potřeba nasadit nové online API; starší nasazené API doplňující pole přihlášek ještě nezná.
