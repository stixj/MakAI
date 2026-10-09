# Online MakAI

Vercel serves the application and its short, authenticated Node API calls.
GitHub Actions runs the Python search worker; Turso keeps plans, profile versions,
run history and evaluations. No database or AI key is included in browser code.

Set the Vercel project Root Directory to `frontend`, framework to Vite.
`frontend/vercel.json` builds the UI and its `/api/*` Node functions together.
There is no Python HTTP service and no service-to-service binding: browser
requests go to the same-origin API, and the external worker authenticates separately.
The generated multiple-services template is unnecessary for this architecture.

## Server configuration

Set these Vercel **production server secrets**, without any `VITE_` prefix:

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Turso database URL |
| `TURSO_AUTH_TOKEN` | Server database access |
| `MAKAI_LOGIN_PASSWORD` | Personal app password, at least 12 characters |
| `MAKAI_SESSION_SECRET` | Random signing secret, at least 32 characters |
| `MAKAI_WORKER_SECRET` | Separate worker credential, at least 32 characters |
| `OPENAI_API_KEY` | OpenAI profile builder, when selected |
| `GEMINI_API_KEY` | Gemini profile builder, preferred in auto mode |
| `PROFILE_GEMINI_MODEL` (optional) | Dedicated profile model; this deployment uses `gemini-3.1-flash-lite` |
| `PROFILE_LLM_PROVIDER` (optional) | `gemini`, `openai`, or `auto` |
| `OPENAI_MODEL` (optional) | Uses the existing backend default `gpt-4o-mini` if absent |
| `MAKAI_GITHUB_TOKEN` (optional) | Fine-grained token for **only this repository**, Actions write, for immediate manual workflow dispatch |

The build command `npm run build:cloud` selects server API mode. Do not configure
`VITE_TURSO_AUTH_TOKEN` or any other browser credential. Rotating the session secret
invalidates existing sessions. The personal password is a single-owner login,
not a multi-user account system.

After signing in, use “Změnit heslo” to choose a new password (12–128 characters),
confirming the current password. Only a salted scrypt hash is stored in Turso.
Changing the password invalidates previous sessions on other devices; the current
browser receives a fresh session. The original password in `data/online-access.txt`
and `MAKAI_LOGIN_PASSWORD` is then no longer accepted: it is only the initial login
credential before the first password change.

GitHub repository Actions secrets: `DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`MAKAI_WORKER_SECRET` (the same worker secret as Vercel), and your configured
`GEMINI_API_KEY` and/or `OPENAI_API_KEY`. Repository variables: `MAKAI_URL` (the
stable production origin, not a temporary preview URL) and optionally `LLM_PROVIDER`.
The API model settings retain backend defaults.

For one-time setup using the existing root `.env` and signed-in CLI:

```powershell
npx vercel login
npx vercel link --project makai
venv\Scripts\python.exe -m pip install PyNaCl
venv\Scripts\python.exe scripts/configure_online.py vercel
npx vercel --prod --yes
venv\Scripts\python.exe scripts/configure_online.py github --url https://YOUR-STABLE-DOMAIN
```

The setup helper generates secrets under ignored `data/online-private.json`,
stores the personal login password in ignored `data/online-access.txt`, and uploads
GitHub secrets encrypted using the repository public key. It does not copy your
GitHub login token into Vercel. If using a shared computer, protect these local files.

## Use

1. Sign in and open “Správa profilu → Vytvořit profil s AI”. Choose a CV
   (readable PDF, DOCX, TXT or Markdown up to 2 MB) or the questionnaire.
   CV analysis prefills documented experience, skills and languages; confirm the
   desired career, location, salary and any AI follow-up questions. Review and edit
   the draft, then explicitly activate it. Existing profiles remain active until then.
   Raw uploaded files are not persisted; only reviewed profile data is saved.
   Scanned/image-only PDFs require a text version or the questionnaire.
   CV text and answers are sent to the provider displayed in the wizard (Gemini or
   OpenAI; OpenAI uses `store: false`); contact details are
   unnecessary. The wizard has the same flow on localhost and Vercel.
   The online builder permits 20 analysis/draft requests per UTC day; local limit
   resets when the local server restarts.
2. Set days, up to six times per day, portals, publication window and budgets.
3. Save the plan and explicitly enable automation. Initial automation is off.
4. Use “Spustit hledání teď” for a manual queued run. If a dispatch token is configured,
   the API requests a worker immediately; otherwise the next scheduled worker picks it up.
5. Inspect run history, last scheduler contact, and “Nové od poslední návštěvy”.
   The last-visit filter is per profile and per browser. Other devices have independent visits.

Profile versions have independent evaluations and deduplication. Editing or changing
the active profile pauses automation, requiring re-enabling after review. Existing
local/default evaluations remain untouched; the first online profile starts its own history.

## Scheduler behavior

The workflow checks every 15 minutes, not at an exact guaranteed wall-clock instant.
The plan uses `Europe/Prague` including daylight saving, or UTC. A nonexistent
spring clock time is skipped; a repeated autumn time runs at most once that day.
Delayed slots coalesce into at most one search, never a replay of every missed slot.
Slots older than 24 hours are skipped. If another hunt is queued/running, that slot
is skipped and the next future slot is scheduled.

Daily run limits cover scheduled and manual searches, including failed runs and
cancelled searches that already started. Cancelling an unstarted queue item does
not consume a run. The evaluation cap counts new offers attempted after deduplication;
provider fallback can still make two API calls for an offer. It is not a monetary cap.

Cancelling a queued run is immediate. A running worker checks cancellation every
10 seconds and terminates its Python subprocess; an AI request already sent can
still be charged. A job runs at most 35 minutes, search processing at most 30,
and abandoned claims expire after 45 minutes. A stale worker cannot overwrite a
later run. Monitor partial saves/errors in history.

GitHub can delay schedules under load and disable public-repository schedules
after 60 days without repository activity. Re-enable the workflow from Actions
if needed; the app reports stale scheduler contact. Public repositories normally
have free standard Actions runners; private repository minute quotas depend on
the account plan. AI API usage is billed separately by the provider.

## Verification

```powershell
cd frontend
npm test
npm run build:cloud
cd ..
venv\Scripts\python.exe -m unittest discover -s backend/tests -q
```

Server tests use an isolated in-memory libSQL database and no real AI or portal calls.
GitHub Pages continues to build the credential-free static preview; full online
controls require the Vercel deployment.
