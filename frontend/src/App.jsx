import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Briefcase, RefreshCw, Search, X } from 'lucide-react';
import JobCard from './components/JobCard.jsx';
import ProfilePanel from './components/ProfilePanel.jsx';
import { COLLECTIONS, normalizeJobState } from './lib/jobState.js';
import { profileApi } from './lib/profileApi.js';
import LoginGate from './components/LoginGate.jsx';
import { VERDICTS, filterJobs, paginateJobs, pageNumbers } from './lib/jobs.js';
import { hasJobSource, loadJobs, loadHistoryPage } from './lib/turso.js';

function EmptyState({ title, children, action }) {
  return <div className="rounded-3xl border border-viatix-line/60 bg-viatix-sand2 px-6 py-16 text-center">
    <Briefcase className="mx-auto mb-5 h-8 w-8 text-viatix-teal/60" aria-hidden="true" />
    <h2 className="font-display text-xl font-semibold">{title}</h2>
    <div className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">{children}</div>
    {action && <div className="mt-6">{action}</div>}
  </div>;
}

export function Dashboard({ accountControls }) {
  const configured = hasJobSource();
  const shared = import.meta.env.VITE_JOB_SOURCE === 'cloud' || import.meta.env.VITE_SHARED_STORAGE === true;
  const local = ['local', 'cloud'].includes(import.meta.env.VITE_JOB_SOURCE);
  const [collection, setCollection] = useState('active');
  const [lastAction, setLastAction] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const currentProfile = useRef(null);
  const undoButton = useRef(null);
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState(configured ? 'loading' : 'unconfigured');
  const [error, setError] = useState('');
  const [invalidCount, setInvalidCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [search, setSearch] = useState('');
  const [verdict, setVerdict] = useState('all');
  const [sort, setSort] = useState('score');
  const [historyPeriod, setHistoryPeriod] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [pageResult, setPageResult] = useState(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [demo, setDemo] = useState(false);
  const [profileId, setProfileId] = useState(null);
  const [newOnly, setNewOnly] = useState(false);
  const [previousVisit, setPreviousVisit] = useState(null);
  currentProfile.current = profileId;
  const requestId = useRef(0);
  const loadedRevision = useRef(-1);

  useEffect(() => {
    setNewOnly(false); setPage(1); setLastAction(null); setActionError('');
    try { const value = localStorage.getItem('makai-last-visit:' + profileId); setPreviousVisit(value && Number.isFinite(Date.parse(value)) ? value : null); }
    catch { setPreviousVisit(null); }
  }, [profileId]);

  function refresh() {
    requestId.current += 1;
    setDemo(false); setJobs([]); setPageResult(null); setPage(1);
    setInvalidCount(0); setError('');
    setStatus(configured ? 'loading' : 'unconfigured');
    setReloadKey(value => value + 1);
  }

  useEffect(() => {
    if (!configured || demo || (!local && loadedRevision.current === reloadKey)) return;
    const current = ++requestId.current;
    setLoadingResults(true); setError('');
    const timer = setTimeout(async () => {
      try {
        const result = local
          ? await loadHistoryPage({ collection, page, pageSize, search, verdict, sort, historyPeriod, since: newOnly ? previousVisit : null })
          : await loadJobs();
        if (current !== requestId.current) return;
        setJobs(result.jobs); setInvalidCount(result.invalidCount);
        setLimitReached(result.limitReached ?? false);
        setPageResult(local ? result : null);
        loadedRevision.current = reloadKey;
        setStatus('ready');
        if (profileId) { try { localStorage.setItem('makai-last-visit:' + profileId, new Date().toISOString()); } catch {} }
      } catch (failure) {
        if (current !== requestId.current) return;
        setError(failure.message);
        setStatus('error');
      } finally { if (current === requestId.current) setLoadingResults(false); }
    }, local && search ? 250 : 0);
    return () => { clearTimeout(timer); if (requestId.current === current) requestId.current += 1; };
  }, [collection, search, verdict, sort, historyPeriod, page, pageSize, reloadKey, demo, profileId, newOnly, previousVisit]);

  useEffect(() => {
    if (!shared || demo || !profileId) return;
    const timer = setInterval(() => setReloadKey(value => value + 1), 30000);
    return () => clearInterval(timer);
  }, [shared, demo, profileId]);

  async function changeJobState(job, key, value) {
    const selected = profileId;
    const result = await profileApi('/api/jobs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: selected, offerId: job.id, changes: { [key]: value } }) });
    if (currentProfile.current !== selected) return;
    setJobs(previous => previous.map(item => item.id === job.id ? { ...item, state: result.state } : item));
    setLastAction({ profileId: selected, offerId: job.id, key, previous: normalizeJobState(job.state)[key], removesCard: (collection === 'active' && key === 'hidden' && value) || (collection === 'saved' && (key === 'hidden' && value || key === 'saved' && !value)) || (collection === 'applied' && (key === 'hidden' && value || key === 'applied' && !value)) || (collection === 'hidden' && key === 'hidden' && !value),
      message: key === 'saved' ? value ? 'Nabídka uložená.' : 'Uložení zrušeno.' : key === 'applied' ? value ? 'Nabídka označená jako Reagoval jsem.' : 'Označení reakce zrušeno.' : value ? 'Nabídka skrytá. Najdeš ji v sekci Skryté.' : 'Nabídka znovu zobrazená.' });
    setActionError(''); setReloadKey(value => value + 1);
  }

  useEffect(() => { if (lastAction?.removesCard) undoButton.current?.focus({ preventScroll: true }); }, [lastAction]);

  async function undoAction() {
    const action = lastAction;
    setUndoBusy(true); setActionError('');
    try {
      await profileApi('/api/jobs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: action.profileId, offerId: action.offerId, changes: { [action.key]: action.previous } }) });
      if (currentProfile.current !== action.profileId) return;
      setLastAction(previous => previous === action ? null : previous);
      setReloadKey(value => value + 1);
    } catch (failure) { setActionError(failure.message); }
    finally { setUndoBusy(false); }
  }

  async function showDemo() {
    const current = ++requestId.current;
    const { demoJobs } = await import('./lib/demo.js');
    if (current !== requestId.current) return;
    setJobs(demoJobs); setDemo(true); setStatus('ready'); setLoadingResults(false);
    setSearch(''); setVerdict('all'); setHistoryPeriod('all'); setPage(1);
    setInvalidCount(0); setLimitReached(false); setPageResult(null); setError('');
  }

  function changeFilter(setter, value) { setter(value); setPage(1); }
  const clientView = useMemo(() => paginateJobs(filterJobs(jobs, { search, verdict, sort, historyPeriod }), page, pageSize), [jobs, search, verdict, sort, historyPeriod, page, pageSize]);
  const view = local && !demo && pageResult ? { ...pageResult, jobs } : clientView;
  const visible = view.jobs;
  const counts = local && !demo && pageResult ? pageResult.counts
    : Object.fromEntries(Object.keys(VERDICTS).map(key => [key, jobs.filter(job => job.evaluation.verdict === key).length]));
  const totalStored = pageResult?.totalStored ?? jobs.length;
  const totalAll = local && !demo && pageResult ? pageResult.totalAll : jobs.length;
  const resetFilters = () => { setSearch(''); setVerdict('all'); setHistoryPeriod('all'); setNewOnly(false); setPage(1); };

  function Pagination() {
    return <nav aria-label="Stránkování nabídek" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-viatix-line/60 bg-viatix-sand2 p-3">
      <span className="text-xs text-muted-foreground">Stránka {view.page} z {view.pageCount}</span>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className="button-secondary" disabled={loadingResults || view.page <= 1} onClick={() => setPage(view.page - 1)}>Předchozí</button>
        {pageNumbers(view.page, view.pageCount).map(number => typeof number === 'string' ? <span key={number} className="px-2 text-muted-foreground" aria-hidden="true">…</span> : <button type="button" key={number} aria-label={'Stránka ' + number} aria-current={view.page === number ? 'page' : undefined} disabled={loadingResults} onClick={() => setPage(number)} className={'min-h-9 min-w-9 rounded-xl px-3 text-sm font-medium ' + (view.page === number ? 'bg-viatix-teal text-white' : 'text-viatix-teal hover:bg-viatix-teal/10')}>{number}</button>)}
        <button type="button" className="button-secondary" disabled={loadingResults || view.page >= view.pageCount} onClick={() => setPage(view.page + 1)}>Další</button>
      </div>
    </nav>;
  }

  return <div className="min-h-screen">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-20 focus:rounded-xl focus:bg-white focus:p-3">Přejít na obsah</a>
    <header className="border-b border-viatix-line/60 bg-viatix-sand2/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <a href="./" aria-label="MakAI — úvod" className="shrink-0 rounded-lg">
          <img
            src={import.meta.env.BASE_URL + 'brand/makai-logo-v1.png'}
            alt="MakAI"
            width="2172"
            height="724"
            className="block h-auto w-32 sm:w-44"
          />
        </a>
        <span className="hidden text-xs text-muted-foreground sm:block">Tvůj další kariérní krok</span>
        <div className="flex items-center gap-3">
          {demo && <span className="rounded-full border border-viatix-line/60 px-3 py-1.5 text-xs text-viatix-teal">Ukázkový režim</span>}
          {accountControls}
        </div>
      </div>
    </header>
    <main id="main" className="mx-auto max-w-6xl px-5 pb-12 pt-6 sm:px-8 sm:pt-8">
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-viatix-teal">Příležitosti s potenciálem</p>
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-[38px]">Práce, která ti sedí.</h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">Vyhodnocené nabídky na jednom místě. Projdi shodu, ověř podmínky a vyber svůj další krok.</p>
        </div>
        {configured && <button type="button" onClick={refresh} disabled={status === 'loading'} className="button-secondary self-start sm:self-auto" title="Načte uložené výsledky. Nové hledání spustíš tlačítkem Hledat nové nabídky."><RefreshCw className={'h-4 w-4 ' + (status === 'loading' ? 'animate-spin' : '')} aria-hidden="true" />Aktualizovat přehled</button>}
      </div>

      {local && <ProfilePanel onJobsChanged={refresh} onProfileChanged={setProfileId} />}

      {demo && <div role="status" className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-viatix-amber/40 bg-viatix-amber/10 px-4 py-3 text-xs leading-relaxed">
        <span><strong>Ukázka vzhledu.</strong> Všechny nabídky i hodnocení jsou smyšlené.</span>
        <button type="button" className="inline-flex items-center gap-1 rounded-lg p-1 font-semibold text-viatix-teal" onClick={refresh}><X className="h-3.5 w-3.5" aria-hidden="true" />Zavřít ukázku</button>
      </div>}

      {shared && !demo && <nav aria-label="Moje nabídky" className="mt-6 flex flex-wrap gap-2">
        {Object.entries(COLLECTIONS).map(([key, label]) => <button type="button" key={key} aria-pressed={collection === key} onClick={() => { changeFilter(setCollection, key); resetFilters(); }} className={collection === key ? 'button-primary' : 'button-secondary'}>{label}</button>)}
      </nav>}
      {lastAction && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-viatix-line bg-viatix-sand2 p-3">
        <p role="status" className="text-sm">{lastAction.message}</p>
        <button type="button" className="button-secondary" ref={undoButton} disabled={undoBusy} onClick={undoAction}>{undoBusy ? 'Vracím změnu…' : 'Vrátit změnu'}</button>
      </div>}
      {actionError && <p role="alert" className="mt-3 text-sm text-red-700">{actionError}</p>}

      {status === 'ready' && <section aria-label="Přehled hodnocení" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['all', 'Vyhodnoceno', totalAll], ...Object.entries(VERDICTS).map(([key, value]) => [key, value.title, counts[key]])].map(([key, title, count]) => <button type="button" key={key} aria-pressed={verdict === key} onClick={() => changeFilter(setVerdict, key)} className={'rounded-2xl border p-4 text-left transition-colors ' + (verdict === key ? 'border-viatix-teal bg-viatix-teal text-white' : 'border-viatix-line/60 bg-viatix-sand2 hover:border-viatix-teal/50')}>
          <span className={'text-xs ' + (verdict === key ? 'text-white/80' : 'text-muted-foreground')}>{title}</span>
          <span className="mt-2 block font-display text-2xl font-semibold tabular-nums">{count}</span>
        </button>)}
      </section>}

      <section className="mt-8" aria-label="Nabídky pro tebe" aria-busy={status === 'loading' || loadingResults}>
        {status === 'ready' && <>
          <h2 className="mb-2 font-display text-xl font-semibold">Nabídky pro tebe</h2>
          <p className="mb-5 text-xs leading-relaxed text-muted-foreground">Nabídky zůstávají dostupné i po dalším hledání. Původní text najdeš v detailu inzerátu.</p>
          {(import.meta.env.VITE_JOB_SOURCE === 'cloud' || import.meta.env.VITE_SHARED_STORAGE === true) && <div className="mb-5 flex flex-wrap items-center gap-3"><button type="button" aria-pressed={newOnly} disabled={!previousVisit || demo} onClick={() => { setNewOnly(value => !value); setPage(1); }} className={newOnly ? 'button-primary' : 'button-secondary'}>Nové od poslední návštěvy</button><span className="text-xs text-muted-foreground">{previousVisit ? 'Podle poslední návštěvy v tomto prohlížeči.' : 'Při první návštěvě zobrazujeme celou historii.'}</span></div>}
          <div className="mb-6 flex flex-col flex-wrap gap-3 sm:flex-row">
            <label className="flex items-center gap-2 text-xs">Na stránce
              <select aria-label="Počet nabídek na stránce" value={pageSize} onChange={event => changeFilter(setPageSize, Number(event.target.value))} className="rounded-2xl border border-viatix-line bg-viatix-sand2 px-3 py-3 text-sm">{[6, 12, 24, 48].map(size => <option key={size} value={size}>{size}</option>)}</select>
            </label>
            <label className="flex items-center gap-2 text-xs">Vyhodnoceno
              <select aria-label="Období vyhodnocení v historii" value={historyPeriod} onChange={event => changeFilter(setHistoryPeriod, event.target.value)} className="rounded-2xl border border-viatix-line bg-viatix-sand2 px-3 py-3 text-sm">
                <option value="all">Celá historie</option><option value="24h">Posledních 24 hodin</option><option value="7d">Posledních 7 dní</option><option value="30d">Posledních 30 dní</option>
              </select>
            </label>
            <label className="relative flex-1"><span className="sr-only">Hledat pozici nebo společnost</span><Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input type="search" maxLength={200} value={search} onChange={event => changeFilter(setSearch, event.target.value)} placeholder="Hledat pozici nebo společnost…" className="w-full rounded-2xl border border-viatix-line bg-viatix-sand2 py-3 pl-11 pr-4 text-sm placeholder:text-muted-foreground" />
            </label>
            <label><span className="sr-only">Řadit nabídky</span><select value={sort} onChange={event => changeFilter(setSort, event.target.value)} className="w-full rounded-2xl border border-viatix-line bg-viatix-sand2 px-4 py-3 text-sm sm:w-auto"><option value="score">Nejvyšší shoda</option><option value="newest">Nejnovější hodnocení</option></select></label>
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p role="status">{view.total ? (view.page - 1) * view.pageSize + 1 : 0}–{Math.min(view.page * view.pageSize, view.total)} z {view.total} odpovídajících nabídek</p>
            {(search || verdict !== 'all' || historyPeriod !== 'all' || newOnly) && <button type="button" onClick={resetFilters} className="rounded-lg p-1 font-medium text-viatix-teal">Zrušit filtry</button>}
          </div>
          {invalidCount > 0 && <p role="status" className="mb-4 rounded-xl bg-viatix-amber/15 p-3 text-xs">Počet přeskočených neplatných záznamů: {invalidCount}.</p>}
          {limitReached && <p className="mb-4 text-xs text-muted-foreground">Přímé připojení načítá posledních 500 hodnocení.</p>}
          {loadingResults && <p role="status" className="mb-3 text-xs text-viatix-teal">Načítám stránku nabídek…</p>}
          {view.total > 0 && <div className="mb-5"><Pagination /></div>}
          {visible.length > 0 ? <div className="grid items-start gap-5 md:grid-cols-2 lg:grid-cols-3">{visible.map(job => <JobCard key={profileId + ':' + job.id} job={job} onStateChange={shared && !demo && profileId ? changeJobState : undefined} actionsDisabled={undoBusy || loadingResults} />)}</div> :
            <EmptyState title={totalAll ? 'Žádná nabídka neodpovídá filtrům' : collection === 'saved' ? 'Zatím nemáš uložené nabídky' : collection === 'applied' ? 'Zatím nemáš označené reakce' : collection === 'hidden' ? 'Zatím nemáš skryté nabídky' : totalStored ? 'Všechny nabídky jsou skryté' : 'První příležitost teprve přijde'} action={totalAll ? <button type="button" className="button-secondary" onClick={resetFilters}>Zrušit filtry</button> : totalStored && collection === 'active' ? <button type="button" className="button-secondary" onClick={() => changeFilter(setCollection, 'hidden')}>Prohlédnout skryté nabídky</button> : collection !== 'active' ? <button type="button" className="button-secondary" onClick={() => { changeFilter(setCollection, 'active'); resetFilters(); }}>Prohlédnout nabídky</button> : null}>
              {totalAll ? 'Zkus jiný název pozice nebo zobraz všechna hodnocení.' : collection === 'saved' ? 'Zajímavou nabídku si odlož tlačítkem Uložit.' : collection === 'applied' ? 'Po odeslání přihlášky označ nabídku tlačítkem Reagoval jsem.' : collection === 'hidden' ? 'Skryté nabídky najdeš tady a můžeš je kdykoliv znovu zobrazit.' : totalStored ? 'Nabídky zůstávají uložené v sekci Skryté. Můžeš je kdykoliv vrátit.' : 'Vytvoř profil a spusť první hledání. Vyhodnocené nabídky se potom objeví tady.'}
            </EmptyState>}
          {view.total > 0 && <div className="mt-6"><Pagination /></div>}
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </>}

        {status === 'loading' && <><p role="status" className="mb-4 text-sm text-muted-foreground">Načítám nabídky…</p><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">{[1, 2, 3].map(key => <div key={key} className="h-80 animate-pulse rounded-2xl border border-border/50 bg-card p-4"><div className="h-5 w-24 rounded-full bg-viatix-line/50" /><div className="mt-6 h-5 w-3/4 rounded-lg bg-viatix-line/50" /><div className="mt-3 h-4 w-1/2 rounded-lg bg-viatix-line/30" /></div>)}</div></>}

        {status === 'error' && <EmptyState title="Přehled se nepodařilo načíst" action={<button type="button" className="button-primary" onClick={refresh}>Zkusit znovu</button>}><p role="alert">{error}</p></EmptyState>}

        {status === 'unconfigured' && <EmptyState title="Přehled je připravený" action={<button type="button" className="button-primary" onClick={showDemo}>Prohlédnout ukázku<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></button>}>
          <p>Zdroj nabídek zatím není připojený. Mezitím si můžeš prohlédnout vzhled karet na smyšlených datech.</p>
        </EmptyState>}
      </section>
      <footer className="mt-10 flex flex-col justify-between gap-3 border-t border-viatix-line/60 pt-5 text-[11px] leading-relaxed text-muted-foreground sm:flex-row">
        <span>MakAI · Další krok s lepším přehledem.</span>
        <span>Skóre vyjadřuje shodu s profilem, nikoli pravděpodobnost přijetí.</span>
      </footer>
    </main>
  </div>;
}

export default function App() {
  return import.meta.env.VITE_JOB_SOURCE === 'cloud' ? <LoginGate><Dashboard /></LoginGate> : <Dashboard />;
}
