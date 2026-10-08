import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Briefcase, RefreshCw, Search, X } from 'lucide-react';
import JobCard from './components/JobCard.jsx';
import { VERDICTS, filterJobs } from './lib/jobs.js';
import { hasTursoConfig, loadJobs, JOB_LIMIT } from './lib/turso.js';

function EmptyState({ title, children, action }) {
  return <div className="rounded-3xl border border-viatix-line/60 bg-viatix-sand2 px-6 py-16 text-center">
    <Briefcase className="mx-auto mb-5 h-8 w-8 text-viatix-teal/60" aria-hidden="true" />
    <h2 className="font-display text-xl font-semibold">{title}</h2>
    <div className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">{children}</div>
    {action && <div className="mt-6">{action}</div>}
  </div>;
}

export default function App() {
  const configured = hasTursoConfig();
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState(configured ? 'loading' : 'unconfigured');
  const [error, setError] = useState('');
  const [invalidCount, setInvalidCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [search, setSearch] = useState('');
  const [verdict, setVerdict] = useState('all');
  const [sort, setSort] = useState('score');
  const [demo, setDemo] = useState(false);
  const requestId = useRef(0);

  async function refresh() {
    const current = ++requestId.current;
    setDemo(false);
    setError('');
    setJobs([]);
    setInvalidCount(0);
    setLimitReached(false);
    if (!configured) { setStatus('unconfigured'); return; }
    setStatus('loading');
    try {
      const result = await loadJobs();
      if (current !== requestId.current) return;
      setJobs(result.jobs);
      setInvalidCount(result.invalidCount);
      setLimitReached(result.limitReached);
      setStatus('ready');
    } catch (failure) {
      if (current !== requestId.current) return;
      setError(failure.message);
      setStatus('error');
    }
  }

  useEffect(() => { refresh(); return () => { requestId.current += 1; }; }, []);

  async function showDemo() {
    const current = ++requestId.current;
    const { demoJobs } = await import('./lib/demo.js');
    if (current !== requestId.current) return;
    setJobs(demoJobs);
    setDemo(true);
    setStatus('ready');
    setSearch('');
    setVerdict('all');
    setInvalidCount(0);
    setLimitReached(false);
    setError('');
  }

  const visible = useMemo(() => filterJobs(jobs, { search, verdict, sort }), [jobs, search, verdict, sort]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(VERDICTS).map(key => [key, jobs.filter(job => job.evaluation.verdict === key).length])), [jobs]);
  const resetFilters = () => { setSearch(''); setVerdict('all'); };

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
        <span className="rounded-full border border-viatix-line/60 px-3 py-1.5 text-[11px] font-medium text-viatix-teal">{demo ? 'Ukázkový režim' : 'Pracovní přehled'}</span>
      </div>
    </header>
    <main id="main" className="mx-auto max-w-6xl px-5 pb-12 pt-10 sm:px-8 sm:pt-14">
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-viatix-teal">Příležitosti s potenciálem</p>
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-[38px]">Práce, která ti sedí.</h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">Vyhodnocené nabídky na jednom místě. Projdi shodu, ověř podmínky a vyber svůj další krok.</p>
        </div>
        {configured && <button type="button" onClick={refresh} disabled={status === 'loading'} className="button-primary self-start sm:self-auto"><RefreshCw className={'h-4 w-4 ' + (status === 'loading' ? 'animate-spin' : '')} aria-hidden="true" />Obnovit nabídky</button>}
      </div>

      {demo && <div role="status" className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-viatix-amber/40 bg-viatix-amber/10 px-4 py-3 text-xs leading-relaxed">
        <span><strong>Ukázka vzhledu.</strong> Všechny nabídky i hodnocení jsou smyšlené.</span>
        <button type="button" className="inline-flex items-center gap-1 rounded-lg p-1 font-semibold text-viatix-teal" onClick={refresh}><X className="h-3.5 w-3.5" aria-hidden="true" />Zavřít ukázku</button>
      </div>}

      {status === 'ready' && <section aria-label="Přehled hodnocení" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['all', 'Vyhodnoceno', jobs.length], ...Object.entries(VERDICTS).map(([key, value]) => [key, value.title, counts[key]])].map(([key, title, count]) => <button type="button" key={key} aria-pressed={verdict === key} onClick={() => setVerdict(key)} className={'rounded-2xl border p-4 text-left transition-colors ' + (verdict === key ? 'border-viatix-teal bg-viatix-teal text-white' : 'border-viatix-line/60 bg-viatix-sand2 hover:border-viatix-teal/50')}>
          <span className={'text-xs ' + (verdict === key ? 'text-white/80' : 'text-muted-foreground')}>{title}</span>
          <span className="mt-2 block font-display text-2xl font-semibold tabular-nums">{count}</span>
        </button>)}
      </section>}

      <section className="mt-8" aria-label="Pracovní nabídky" aria-busy={status === 'loading'}>
        {status === 'ready' && <>
          <div className="mb-6 flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1"><span className="sr-only">Hledat pozici nebo společnost</span><Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Hledat pozici nebo společnost…" className="w-full rounded-2xl border border-viatix-line bg-viatix-sand2 py-3 pl-11 pr-4 text-sm placeholder:text-muted-foreground" />
            </label>
            <label><span className="sr-only">Řadit nabídky</span><select value={sort} onChange={event => setSort(event.target.value)} className="w-full rounded-2xl border border-viatix-line bg-viatix-sand2 px-4 py-3 text-sm sm:w-auto"><option value="score">Nejvyšší shoda</option><option value="newest">Nejnovější hodnocení</option></select></label>
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p role="status">{visible.length} z {jobs.length} nabídek</p>
            {(search || verdict !== 'all') && <button type="button" onClick={resetFilters} className="rounded-lg p-1 font-medium text-viatix-teal">Zrušit filtry</button>}
          </div>
          {invalidCount > 0 && <p role="status" className="mb-4 rounded-xl bg-viatix-amber/15 p-3 text-xs">Počet přeskočených neplatných záznamů: {invalidCount}.</p>}
          {limitReached && <p className="mb-4 text-xs text-muted-foreground">Přehled obsahuje posledních {JOB_LIMIT} hodnocení.</p>}
          {visible.length > 0 ? <div className="grid items-start gap-5 md:grid-cols-2 lg:grid-cols-3">{visible.map(job => <JobCard key={job.id} job={job} />)}</div> :
            <EmptyState title={jobs.length ? 'Žádná nabídka neodpovídá filtrům' : 'První příležitost teprve přijde'} action={jobs.length ? <button type="button" className="button-secondary" onClick={resetFilters}>Zrušit filtry</button> : null}>
              {jobs.length ? 'Zkus jiný název pozice nebo zobraz všechna hodnocení.' : 'Jakmile se uloží první hodnocení, najdeš ho tady. Potom přehled obnov.'}
            </EmptyState>}
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
