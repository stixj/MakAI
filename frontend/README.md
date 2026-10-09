# MakAI frontend

Samostatná Vite + React SPA. Vercel publikuje pouze statické soubory z `dist/`;
frontend nepotřebuje Python, API server ani serverless funkce. Čte již uložená
hodnocení z Turso; localhost může použít místní server a statické nasazení
`@libsql/client/web` se samostatným read-only tokenem. Spuštění sběru a evaluace
nabídek zůstává samostatnou úlohou existujícího backendu.

## Lokální spuštění

Pro skutečný lokální přehled s existujícím backendovým `.env` nastav ve
`frontend/.env.local` pouze:

```dotenv
VITE_JOB_SOURCE=local
```

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

**Nahrát jiný profil** přijímá UTF-8 Markdown s právě jedním strukturovaným JSON blokem nebo samostatný JSON stejných preferencí (max. 250 kB). Aktuální profil lze stáhnout jako předlohu. Neplatný import aktivní profil nezmění. PDF/DOCX import není součástí této verze. Nahrané preference nepřebírají CV podklady, historii ani kariérní reference původního kandidáta.

Výběr se ukládá do `data/profiles/active.json`. Obsahové ID nahraného profilu určuje jeho vlastní složku a výsledky; původní výsledky z Turso zůstávají výchozímu profilu. Při návratu na výchozí profil se jiné profily nemažou. Během hledání nelze profil přepnout nebo spustit další běh.

**Časové vymezení nového hledání** umožňuje bez omezení, posledních 24 hodin, 7 nebo 30 dní. Rozhoduje datum zveřejnění od portálu, nikoli datum načtení. Při časovém omezení se neznámé datum ve výchozím stavu vynechá; lze výslovně zaškrtnout zahrnutí takových nabídek. Známé odkazy se nestahují znovu a uložené totožné pozice se nehodnotí znovu ani z jiného portálu. Staré/známé nabídky nespotřebují limit nových nabídek; sběr zůstává omezený stránkováním a nejvýše 300 načtenými detaily na portál. Výsledek ukazuje počty přeskočených nabídek.

**Historie vyhodnocených nabídek** obsahuje všechny úspěšně uložené výsledky aktivního profilu, včetně nízké shody, textu inzerátu a původních odkazů. Filtr **Vyhodnoceno** omezuje uloženou historii podle doby AI hodnocení. Je oddělený od filtru zveřejnění při novém hledání. Typ shody lze filtrovat podle STRONG FIT, POTENTIAL FIT nebo NO GO. Po změně filtru nebo počtu na stránce se přehled vrátí na první stránku. Nahrané profily ukládají historii atomicky do svého `results.json`; nové hledání staré výsledky neodstraňuje.

API `/api/profile` a `/api/hunt` je dostupné pouze přes lokální Vite plugin při `VITE_JOB_SOURCE=local`. Backend spouští interpreter `venv/Scripts/python.exe`; prostředí a API klíče se neposílají do prohlížeče. CLI `backend/run_hunt.py` používá výchozí profil projektu.

Šablony bez osobních údajů a podrobný návod jsou v `public/templates/` a přímo v panelu **Šablony a návod pro nový profil**. Markdown umožňuje doplnit profesní kontext pod strukturované preference. Obě šablony obsahují smyšlené ukázkové údaje, které je nutné nahradit vlastními.

## Profil z dotazníku přes OpenAI

Tlačítko **Vytvořit profil s AI** otevře tři kroky: směr a zkušenosti, pracovní podmínky a mzdu. Odpovědi se odesílají až po kliknutí na **Sestavit návrh přes OpenAI**. Návrh má upravitelná pole a profesní kontext; aktivuje se až po kontrole přes **Aktivovat profil pro hledání**. Generování neukládá profil ani nespouští hledání. Úprava odpovědí odstraní zastaralý návrh.

Generátor vyžaduje **OPENAI_API_KEY** v kořenovém .env. Používá **OPENAI_MODEL** (výchozí gpt-4o-mini), nezávisle na volbě poskytovatele evaluace. Endpoint GET /api/profile/draft vrací jen přítomnost konfigurace a název modelu; neověřuje API kredit. POST vytvoří návrh přes Responses API a Pydantic structured output, s vypnutým ukládáním odpovědi (store=false) a bez automatického opakování. API klíč je pouze na serveru.

Lokalita, jazyky, no-go a mzda se přebírají přímo z odpovědí. Výjimečné minimum je zpočátku stejné jako běžné; dlouhodobá mzda a horizont jsou neznámé (null), pokud je uživatel při kontrole nedoplní. Samostatné CV není ověřené. Původní profil, CV ani historie se generátoru neposílají. Návrhy rolí a shrnutí jsou výstupy modelu a uživatel je musí ověřit.

Chybějící klíč, neúplná odpověď, odmítnutí, vyčerpaný kredit či chyba připojení zobrazí chybu a zachovají dotazník i aktivní profil. Obecné chyby SDK se redigují.

Implementace strukturovaného výstupu: [oficiální OpenAI dokumentace](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

Při vyčerpané denní kvótě API, chybě přístupu nebo nedostupnosti poskytovatele se AI dávka zastaví a zobrazí se konkrétní důvod. Dočasné chyby 5xx se zopakují nejvýše dvakrát s krátkým čekáním; kvóta 429 se automaticky neopakuje. Již úspěšná hodnocení se uloží. OpenAI fallback zůstává pouze výslovně povolenou volbou konfigurace.

**Zastavit hledání** se zobrazí během běhu. DELETE /api/hunt ukončí Python proces a zablokuje nový běh i přepnutí profilu do potvrzení jeho konce. Již uložená historie zůstává; rozpracovaná neuložená hodnocení se při okamžitém zastavení zahodí. Požadavek již odeslaný AI poskytovateli může být účtován i po ukončení místního procesu. Zastavení je dostupné také po obnovení stránky přes stav běhu na místním serveru.
