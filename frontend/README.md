# MakAI frontend

Samostatná Vite + React SPA. Vercel publikuje pouze statické soubory z `dist/`;
frontend nepotřebuje Python, API server ani serverless funkce. Čte již uložená
hodnocení přímo z Turso pomocí `@libsql/client/web`. Spuštění sběru a evaluace
nabídek zůstává samostatnou úlohou existujícího backendu.

## Lokální spuštění

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
Načítá maximálně posledních 500 hodnocení; při dosažení limitu to přehled uvede.
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
