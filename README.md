# MakAI

Osobní AI systém pro sémantické hodnocení pracovních nabídek a výběr relevantních
podkladů pro životopis. Tento úvodní skeleton obsahuje celý běh nad dodanými
inzeráty: validaci, filtrování duplicit, LLM evaluaci a uložení výsledků.
Automatický sběr inzerátů a generování finálního CV patří do dalších etap;
aktuální CLI používá dva explicitně označené mockové inzeráty.

## Architektura

```text
JobOffer[] -> ingest -> filter -> evaluate -> save -> MakAIState
                                     |         |
                            Gemini / OpenAI    JSON / PostgreSQL
```

- `schemas.py`: Pydantic v2 doménové modely a typovaný stav LangGraphu.
- `profile.py`: typovaný master profil, preference, no-go a povolené CV podklady.
- `config.py`: `.env` v kořeni projektu, validace a přednost proměnných prostředí.
- `evaluator.py`: JSON schema pro Gemini, `responses.parse` pro OpenAI a lokální
  validace výsledků. Timeout a jediný pokus na poskytovatele omezují opakovaná volání.
- `graph.py`: kompilovaný `StateGraph`; neplatné nabídky a duplicitní ID zaznamená
  do `errors`. Sémantická no-go kritéria posuzuje LLM nad celým kontextem.
- `storage.py`: rozhraní `EvaluationStore`, atomický JSON snapshot a transakční
  PostgreSQL upsert. Žádné připojení k síti při importu modulů.
- `demo.py`: pevné fixtures pro bezplatný offline smoke test.

Každé spuštění znovu vyhodnotí nabídky; skeleton zatím nemá LLM cache. Při selhání
jedné evaluace pokračuje dalšími nabídkami a uloží úspěšné výsledky. Chyba uložení
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
│   │   └── demo.py
│   ├── tests/
│   │   ├── test_evaluator.py
│   │   └── test_graph.py
│   ├── run_local.py
│   └── requirements.txt
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
`data/demo_results.json`: AI Agent Engineer `95 / STRONG_FIT`, obchodní zástupce
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

## Profil a CV podklady

Master profil obsahuje dovednosti ze zadání: Python, FastAPI, LangGraph, LLM
integrace, BPMN, enterprise procesy a analytické myšlení. Žádné konkrétní projekty,
zaměstnavatelé, počet let, certifikace ani výsledkové metriky nebyly poskytnuty.
Před použitím pro skutečné žádosti uprav `MASTER_PROFILE` podle skutečného CV.

`tailored_cv_highlights` musí obsahovat doslovné položky `approved_cv_highlights`;
jiné tvrzení evaluátor odmítne. To je konzervativní výběr ověřených podkladů,
ne automatické dopsání nové kariérní historie. Inzerát je v promptu oddělený jako
nedůvěryhodný obsah; model dostává instrukci ignorovat pokyny v něm obsažené.
Obsah důvodů a sémantické závěry přesto vyžadují lidské posouzení.

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
SQL a transakční rozhraní s mockem; živé DB připojení je třeba ověřit s vlastním
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
