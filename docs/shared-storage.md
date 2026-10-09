# Společný profil a historie na localhostu a Vercelu

Při `VITE_JOB_SOURCE=local` používá frontend stejný CloudStore, aktivní profil,
tabulky `makai_profile_<id>`, plán a frontu hledání jako online API. Kořenový
`.env` musí mít stejnou `DATABASE_URL` jako Vercel a zapisovací
`TURSO_AUTH_TOKEN`. Klíče jsou pouze na místním serveru; nedávají se do `VITE_*`.

První požadavek po spuštění místního serveru převede `candidate_profile.md`,
původní tabulku `makai_job_evaluations` a soubory
`data/profiles/<id>/profile.json` + `results.json` do společného úložiště.
Import zachovává původní soubory i tabulku a existující online hodnocení,
texty a data nepřepisuje. Opakování nepřidává duplicity. Neplatná data
zastaví import daného profilu místo tichého vynechání. Při chybě se místní API
nepřepne na jinou historii a původní zdroje zůstávají dostupné.

Pokud online profil už existuje, jeho výběr a plán se během převodu zachovají.
Importované profily jsou dostupné ve výběru **Aktivní profil** na localhostu
i Vercelu. Výběr se sdílí a kontroluje po 15 sekundách; přepnutí pozastaví
automatiku. Při běžícím hledání se profil přepnout nedá.

Hledání spuštěné z localhostu jde do stejné fronty a zpracuje jej GitHub Actions.
Bez místního `MAKAI_GITHUB_TOKEN` počká na nejbližší kontrolu plánovače.
Vytvoření návrhu ze CV nadále používá místní AI konfiguraci, potvrzený profil se
pak ukládá do Turso. Online přihlášení a ochrany zůstávají beze změn; místní API
přijímá jen loopback a stejný origin.

Spuštění na samostatném portu:
```powershell
cd C:\Users\Dell\Desktop\MakAI
git pull --ff-only origin main
cd frontend
$env:VITE_JOB_SOURCE = "local"
npm run dev -- --port 5174
```
Pokud jsi stále na staré větvi, nejdřív přepni na `main`; neodstraňuj místní změny.
Import proběhne po otevření `http://localhost:5174`, nikoli samotným deployem
na Vercel. Soukromé místní soubory se nikdy nepřidávají do repozitáře.

Původní oddělený souborový režim je dostupný pouze výslovně přes
`VITE_LOCAL_STORAGE=files` v `frontend/.env.local`. V tomto režimu se profily
nesynchronizují. Pro běžné použití tuto volbu nenastavuj.
