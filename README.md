# MakAI

Osobní AI systém pro sémantické hodnocení pracovních nabídek a výběr relevantních
podkladů pro životopis. Obsahuje sběr reálných nabídek ze StartupJobs, validaci,
deduplikaci URL v Turso před LLM evaluací a transakční uložení výsledků.
`run_hunt.py` používá reálné nabídky; `run_local.py` zachovává dva explicitně
označené mockové inzeráty. Generování finálního CV patří do dalších etap.

## Architektura

```text
StartupJobs -> JobOffer[] -> ingest -> filter -> deduplicate -> evaluate -> save
                                                    |           |         |
                                                  Turso     Gemini /    Turso /
                                                            OpenAI     JSON / PostgreSQL
```

- `schemas.py`: Pydantic v2 doménové modely a typovaný stav LangGraphu.
- `profile.py`: typovaný profil z `candidate_profile.md`, samostatné CV podklady a historie přihlášek.
- `agent_instructions.md`: pravidla evaluace a budoucího vyhledávání.
- `config.py`: `.env` v kořeni projektu, validace a přednost proměnných prostředí.
- `evaluator.py`: JSON schema pro Gemini, `responses.parse` pro OpenAI a lokální
  validace výsledků. Timeout a jediný pokus na poskytovatele omezují opakovaná volání.
- `graph.py`: kompilovaný `StateGraph`; neplatné nabídky a duplicitní ID zaznamená
  do `errors`. URL v Turso a opakované URL v batchi přeskočí před LLM.
  Sémantická no-go kritéria posuzuje LLM nad celým kontextem.
- `scrapers/startupjobs.py`: veřejné vyhledávací API StartupJobs a strukturovaný
  `JobPosting` z detailu nabídky; AI, Python a Vývoj s omezeným stránkováním.
- `storage.py`: rozhraní `EvaluationStore`, atomický JSON snapshot a transakční
  PostgreSQL upsert; `turso.py` přidává transakční Turso/libSQL přes HTTPS. Žádné připojení k síti při importu modulů.
- `demo.py`: pevné fixtures pro bezplatný offline smoke test.

Při použití Turso už uložené URL nevyhodnocuje znovu. JSON a PostgreSQL adaptéry
zatím nemají trvalou deduplikaci. Při selhání jedné evaluace pokračuje dalšími
nabídkami a uloží úspěšné výsledky. Chyba uložení
zachová evaluace ve vráceném stavu. CLI při jakékoli chybě vrátí exit code `1`.
Filtr nechává první nabídku s daným ID; duplicity rovněž hlásí jako chybu.

## Struktura

```text
MakAI/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── profile.py
│   │   ├── schemas.py
│   │   ├── evaluator.py
│   │   ├── graph.py
│   │   ├── storage.py
│   │   ├── turso.py
│   │   ├── scrapers/
│   │   │   └── startupjobs.py
│   │   └── demo.py
│   ├── tests/
│   │   ├── test_evaluator.py
│   │   ├── test_graph.py
│   │   ├── test_profile.py
│   │   └── test_turso.py
│   ├── run_local.py
│   ├── run_hunt.py
│   └── requirements.txt
├── candidate_profile.md
├── agent_instructions.md
├── data/                  # lokální CV, historie a výsledky (gitignore)
├── .env.example
├── .gitignore
└── README.md
```

## Spuštění

Potřebuješ Python **3.11 nebo novější**. Všechny následující příkazy spouštěj
z kořene tohoto repozitáře. Není potřeba Docker ani běžící webový server.

### Windows / PowerShell

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
Copy-Item .env.example .env
python backend/run_local.py --demo
```

Pokud už `.env` existuje, kopírování přeskoč, aby ses nepřipravil o klíče.
Pokud PowerShell blokuje aktivační skript, můžeš použít přímo interpreter:

```powershell
.\venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\venv\Scripts\python.exe backend/run_local.py --demo
```

### macOS / Linux

```bash
python3 -m venv venv
source venv/bin/activate
python -m pip install -r backend/requirements.txt
cp -n .env.example .env
python backend/run_local.py --demo
```

Demo nevolá API ani databázi, ignoruje jejich klíče a uloží pevné výsledky do
`data/demo_results.json`: AI Automation Specialist `95 / STRONG_FIT`, obchodní zástupce
`5 / NO_GO`. Tyto hodnoty ověřují orchestrace a nejsou skutečným výstupem LLM.

### Živá LLM evaluace

Do lokálního `.env` vlož `GEMINI_API_KEY` z
[Google AI Studio](https://aistudio.google.com/apikey), nebo `OPENAI_API_KEY` z
[OpenAI Platform](https://platform.openai.com/api-keys). Pak spusť:

```bash
python backend/run_local.py
```

`LLM_PROVIDER=auto` používá Gemini, pokud má jeho klíč; s pouze OpenAI klíčem
použije OpenAI. `LLM_PROVIDER=gemini` nebo `openai` pevně zvolí poskytovatele.
V automatickém režimu zapne `ALLOW_OPENAI_FALLBACK=true` druhý pokus přes OpenAI
po chybě Gemini, včetně nevalidního JSON nebo nepovoleného CV tvrzení. Výchozí
hodnota je `false`, aby samotná přítomnost obou klíčů nezapnula placený fallback.
Explicitní volba poskytovatele nikdy nepřepíná na jiný.

Modely jsou nastavitelné přes `GEMINI_MODEL` (výchozí `gemini-3.5-flash`) a
`OPENAI_MODEL` (výchozí požadovaný `gpt-4o-mini`). Skutečná skóre se mohou lišit
mezi běhy a poskytovateli. Odmítnutí nebo neúplná odpověď jsou chybou evaluace,
nikoli skórem `0`. API klíče a celé chybové odpovědi providerů se nelogují.

## PostgreSQL / Neon

Prázdné `DATABASE_URL` znamená lokální snapshot `data/results.json`. Každý úspěšný
batch nahradí předchozí snapshot; jde o úložiště pro jeden lokální proces,
bez historie a koordinace více souběžných zapisovatelů. Cesta se mění přes
`LOCAL_RESULTS_PATH` a relativní hodnota se vždy vztahuje ke kořeni projektu.

Pro Neon vlož connection string z jeho dashboardu:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

Při prvním uložení vytvoří PostgreSQL adaptér tabulku `makai_job_evaluations`.
Účet musí mít právo vytvořit tabulku a zapisovat do ní. Nabídka a evaluace jsou
uloženy jako JSONB, `offer_id` je primární klíč a opakované ID aktualizuje řádek.
Celý batch používá jednu transakci, parametrizované SQL, connection timeout
10 sekund a statement timeout 15 sekund. Chyba DB se hlásí; graf poté automaticky
nepřechází na lokální úložiště. `.env` ani soubory v `data/` se necommitují.

## Turso / libSQL

Turso URL ve formátu `libsql://DATABASE-ORGANIZATION.REGION.turso.io` je správná.
Nejde o PostgreSQL: podle schématu URL MakAI vybere samostatný Turso adaptér.
Do lokálního `.env` vlož:

```dotenv
DATABASE_URL=libsql://DATABASE-ORGANIZATION.REGION.turso.io
TURSO_AUTH_TOKEN=YOUR_DATABASE_TOKEN
```

Použij **databázový** token z Turso (CLI `turso db tokens create NAZEV_DATABAZE`),
nikoli token pro správu účtu. Prázdný nebo chybějící token je chyba konfigurace.
Podporována je i HTTPS URL databáze bez cesty; adaptér připojí `/v2/pipeline`.
Připojení používá [oficiální SQL over HTTP API](https://docs.turso.tech/sdk/http/quickstart),
TLS, 15sekundový timeout a standardní Python knihovny, bez dalšího nativního ovladače.
Token se neposílá na přesměrované adresy; chyby neobsahují token ani odpovědi serveru.

Tabulka `makai_job_evaluations` vznikne při prvním skutečném uložení. Nabídka a evaluace
jsou UTF-8 JSON v textových sloupcích, ID je primární klíč. Opakované ID aktualizuje
řádek. Podmíněný Hrana batch provede BEGIN, vytvoření tabulky, parametrizované upserty
a COMMIT; po selhání následuje ROLLBACK. Kontroluje i SQL chyby v HTTP 200 odpovědi.
Při chybě sítě může být stav zápisu nejistý; adaptér jej automaticky neopakuje ani
nepřechází na JSON. Offline demo do Turso nic nezapisuje.

## Lov na StartupJobs

S nastaveným Turso a klíčem k LLM spusť z kořene projektu:

```powershell
.\venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\venv\Scripts\python.exe backend/run_hunt.py
# Malý vzorek pro ověření:
.\venv\Scripts\python.exe backend/run_hunt.py --limit 3
```

Výchozí limit je 15, povolený rozsah 1–100. CLI nejdřív ověří Turso a stáhne
nabídky. Scraper střídá sekci AI vývojář, Python ve Vývoji a obecný Vývoj;
deduplikuje ID ze zdroje a stránkuje nejvýše deset stránek na vyhledávání.
Používá `httpx`, vlastní User-Agent, 20sekundový timeout, bez automatického
opakování požadavků. Detail parsuje přes `beautifulsoup4`, načítá celé znění,
podmínky a zdrojové datum publikace. Nabídky s prošlou platností nebo HTTP
404/410 vynechá. Chybějící datum ani popis nevymýšlí; nevalidní detail hlásí.
Chyba sítě nebo změna formátu výpisu znamená chybu běhu.

Graf volá `TursoEvaluationStore.is_job_duplicate(offer.url)` před evaluací.
Čte URL z uloženého JSON, takže rozezná i dříve uložené nabídky s jiným ID.
První běh bez tabulky funguje; chybějící tabulka znamená žádné duplicity.
Selhání kontroly v DB nabídku vyřadí z aktuálního běhu a nahlásí chybu.
Vyhodnocené nabídky ukládá přes `save_evaluated_job`: každý pár nabídka/evaluace
má vlastní transakci. Pro rychlé hledání URL vzniká index nad `json_extract`.
CLI vypíše nalezené a přeskočené nabídky, skóre, verdikt, důvody a počet
potvrzených zápisů. Při chybě vrací exit code `1`.

Při druhém spuštění se již uložené URL přeskočí bez LLM volání. Nové nabídky
nebo neúspěšně uložené výsledky se zpracují znovu. Spouštěj jeden lov současně:
kontrola URL a následná evaluace nejsou společná rezervace a souběžné procesy
mohou vyhodnotit stejnou nabídku. Změna profilu sama nevyvolá přehodnocení
uložených URL. CLI záměrně vyžaduje Turso, aby lov nespoléhal na lokální snapshot.

## Profil a CV podklady

`candidate_profile.md` obsahuje kandidátem dodané zkušenosti, preference a profesní
kontext. Aktuální preference jsou v jediném typovaném JSON bloku: pracovní směry,
lokalita, jazyky a mzdové hranice. Mzdu nebo jazyk změníš zde, bez úprav Python kódu.
Profil a `agent_instructions.md` se načtou při startu; po změně znovu spusť CLI.

Profil uvádí přibližně 16 let korporátní praxe, 10 let v Directu a rok přímé práce
s AI. Python, backend, DevOps, produkční ML ani hluboké RAG nejsou prezentované
jako doložené silné kompetence. Prototypy nejsou automaticky produkční výsledky.

Oddělené lokální podklady v `data/` (tato složka se necommituje):

- `candidate_profile_source.md`: původní dodaný dokument.
- `cv_facts.json`: zdroj CV a schválené doslovné podklady. CV zatím nebylo dodáno,
  proto je seznam prázdný. Při doplnění uveď `cv_source` a tvrzení ověř proti CV.
  Životopis uchovávej jako samostatný soubor, například `data/cv.pdf`.
- `application_history.json`: Dr.Max a Air Bank mají hlášenou přihlášku, UNIQA
  hlášený stav „zatím nereagoval“, ABB nepotvrzený stav. Data podání nejsou známa.
- `career_references.md`: historické příklady rolí, ne aktuálně ověřené inzeráty.
- `results.json`: dosavadní snapshot hodnocení nabídek; při tomto doplnění se nemění.

Chybějící CV podklady a historie mají bezpečný prázdný výchozí stav. Historie se
předává evaluátoru odděleně od profilu. Sběr ze StartupJobs je implementovaný;
další zdroje, spolehlivé párování historie přihlášek proti novým URL a sledování
pozdějších změn stavu inzerátů zůstávají další etapou.

`tailored_cv_highlights` musí obsahovat doslovné položky `approved_cv_highlights`;
jiné tvrzení evaluátor odmítne. To je konzervativní výběr ověřených podkladů,
ne automatické dopsání nové kariérní historie. Inzerát je v promptu oddělený jako
nedůvěryhodný obsah; model dostává instrukci ignorovat pokyny v něm obsažené.
Obsah důvodů a sémantické závěry přesto vyžadují lidské posouzení.

Kategorie A/B/C odpovídají současným verdiktům STRONG_FIT/POTENTIAL_FIT/NO_GO.
Skóre a verdikt používají jednotná pásma `80–100 STRONG_FIT`,
`50–79 POTENTIAL_FIT`, `0–49 NO_GO`. `fit_reasons` obsahuje 2–3 konkrétní důvody;
u irelevantních rolí vysvětluje chybějící shodu. Modely kontrolují HTTP(S) URL,
neprázdný popis do 30 000 znaků a čas publikace s časovým pásmem.

## Testy

```bash
python -m unittest discover -s backend/tests -v
python -m pip check
```

Testy běží bez klíčů, internetu a DB. Mockují SDK na hranici klienta, ověřují
skutečné provider adaptéry, validaci výstupu, přepínání poskytovatelů, redakci
chyb, izolaci chyb jednotlivých nabídek a atomický zápis. PostgreSQL test ověřuje
SQL a transakční rozhraní s mockem. Turso testy provádějí skutečné SQL nad lokální
SQLite, včetně upsertu, rollbacku a ochrany před SQL injection; HTTP mocky ověřují
autorizaci a redakci chyb. Ingestion testy mockují HTTP přes `httpx.MockTransport`,
ověřují stránkování, validaci detailů a druhý průchod grafem nad SQLite bez
jediného volání evaluátoru. Živé DB připojení je třeba ověřit s vlastním
`DATABASE_URL`. Offline testy nepotvrzují dostupnost modelu ani kvalitu LLM matchingu.

## Provozní náklady a zdroje

Offline demo a lokální úložiště mají nulové náklady na API a hosting. Živý běh
s Gemini lze používat v rámci dostupného free tieru a kvót účtu; nulová cena se
nedá garantovat pro libovolný objem nebo účet. OpenAI volání jsou placená.
Neon má [free plán](https://neon.com/pricing) s limity. Skeleton nic nenasazuje
a nevytváří cloudové účty ani placené služby.

Integrace vychází z [Google Gen AI SDK](https://googleapis.github.io/python-genai/),
[Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output),
[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)
a [Psycopg transakcí](https://www.psycopg.org/psycopg3/docs/basic/transactions.html).
Aktuální cenu a limity ověř v [Gemini ceníku](https://ai.google.dev/gemini-api/docs/pricing)
a [OpenAI ceníku](https://developers.openai.com/api/docs/pricing).


## Webový přehled (Vite + React)

Samostatný frontend v `frontend/` zobrazuje hodnocení přímo z Turso.
Používá vizuální tokeny Viatixu a staví se na statické soubory pro Vercel.
Spuštění, samostatný read-only token a nasazení popisuje
[frontend/README.md](frontend/README.md). Python backend není součástí webového buildu.
