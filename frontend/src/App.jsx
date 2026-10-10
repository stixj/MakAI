import OfferDetail from './components/OfferDetail.jsx';
import ApplicationsPanel from './components/ApplicationsPanel.jsx';
import DocumentsPanel from './components/DocumentsPanel.jsx';
import AddOfferPanel from './components/AddOfferPanel.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Briefcase, RefreshCw, Search, X, Plus, Trash2, Loader2, Menu, ListChecks } from 'lucide-react';
import JobCard from './components/JobCard.jsx';
import ProfilePanel from './components/ProfilePanel.jsx';
import { normalizeJobState } from './lib/jobState.js';
import { profileApi } from './lib/profileApi.js';
import LoginGate from './components/LoginGate.jsx';
import TextSizeControl from './components/TextSizeControl.jsx';
import SelectMenu from './components/SelectMenu.jsx';
import { VERDICTS, filterJobs, paginateJobs, pageNumbers } from './lib/jobs.js';
import { hasJobSource, loadJobs, loadHistoryPage } from './lib/turso.js';

function decodeRouteId(value) { try { return decodeURIComponent(value) || null; } catch { return null; } }
function offerCountLabel(count) { return count === 1 ? 'nabídku' : count >= 2 && count <= 4 ? `${count} nabídky` : `${count} nabídek`; }
function selectedCountLabel(count) { return count === 1 ? 'nabídka vybrána' : count >= 2 && count <= 4 ? 'nabídky vybrány' : 'nabídek vybráno'; }

function EmptyState({ title, children, action }) {
  return <div className="rounded-3xl border border-border-subtle bg-surface px-6 py-16 text-center">
    <Briefcase className="mx-auto mb-5 h-8 w-8 text-ink-secondary" aria-hidden="true" />
    <h2 className="font-display text-xl font-semibold">{title}</h2>
    <div className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-secondary">{children}</div>
    {action && <div className="mt-6">{action}</div>}
  </div>;
}

export function Dashboard({ accountControls }) {
  const configured = hasJobSource();
  const shared = import.meta.env.VITE_JOB_SOURCE === 'cloud' || import.meta.env.VITE_SHARED_STORAGE === true;
  const local = ['local', 'cloud'].includes(import.meta.env.VITE_JOB_SOURCE);
  const initialRoute = typeof window === 'undefined' ? '' : window.location.hash;
  const initialParams = new URLSearchParams(initialRoute.split('?')[1] || '');
  const [collection, setCollection] = useState(['active','saved','applied','priority','hidden','manual'].includes(initialParams.get('collection')) ? initialParams.get('collection') : 'active');
  const [section, setSection] = useState(initialRoute.startsWith('#/dokumenty') ? 'documents' : initialRoute.startsWith('#/profil') ? 'profile' : initialRoute.startsWith('#/prihlasky') ? 'applications' : 'offers');
  const [offerDetail, setOfferDetail] = useState(initialRoute.startsWith('#/nabidky/') ? decodeRouteId(initialRoute.split('?')[0].slice('#/nabidky/'.length)) : null);
  const [adding, setAdding] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedOfferIds, setSelectedOfferIds] = useState(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [selectedOffer, setSelectedOffer] = useState(initialRoute.startsWith('#/prihlasky/') ? decodeRouteId(initialRoute.split('?')[0].slice('#/prihlasky/'.length)) : null);
  const [lastAction, setLastAction] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const currentProfile = useRef(null);
  const undoButton = useRef(null);
  const filtersPopover = useRef(null);
  const appMenu = useRef(null);
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState(configured ? 'loading' : 'unconfigured');
  const [error, setError] = useState('');
  const [invalidCount, setInvalidCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [search, setSearch] = useState(initialParams.get('search') || '');
  const [verdict, setVerdict] = useState(Object.hasOwn(VERDICTS,initialParams.get('verdict')) ? initialParams.get('verdict') : 'all');
  const [sort, setSort] = useState(['newest','priority'].includes(initialParams.get('sort')) ? initialParams.get('sort') : 'score');
  const [historyPeriod, setHistoryPeriod] = useState(['24h','7d','30d'].includes(initialParams.get('period')) ? initialParams.get('period') : 'all');
  const [page, setPage] = useState(Math.max(1,Number(initialParams.get('page')) || 1));
  const [pageSize, setPageSize] = useState([6,12,24,48].includes(Number(initialParams.get('size'))) ? Number(initialParams.get('size')) : 12);
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
  const listScroll = useRef(0);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const closeFiltersOutside = event => {
      const popover = filtersPopover.current;
      if (popover?.open && !popover.contains(event.target)) popover.open = false;
      const menu = appMenu.current;
      if (menu?.open && !menu.contains(event.target)) menu.open = false;
    };
    const closeFiltersOnEscape = event => {
      if (event.key !== 'Escape') return;
      if (filtersPopover.current?.open) filtersPopover.current.open = false;
      if (appMenu.current?.open) {
        appMenu.current.open = false;
        appMenu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeFiltersOutside);
    document.addEventListener('keydown', closeFiltersOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFiltersOutside);
      document.removeEventListener('keydown', closeFiltersOnEscape);
    };
  }, []);

  const previousProfileId = useRef(null);
  useEffect(() => {
    setNewOnly(false); if(previousProfileId.current) setPage(1); setLastAction(null); setActionError(''); setAdding(false); setSelectionMode(false); setSelectedOfferIds(new Set()); setDeleteConfirm(false); if (previousProfileId.current && previousProfileId.current !== profileId) { setSelectedOffer(null); setOfferDetail(null); }
    previousProfileId.current = profileId;
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
    setLastAction({ profileId: selected, offerId: job.id, key, previous: normalizeJobState(job.state)[key], removesCard: (collection === 'priority' && (key === 'priority' && !value || key === 'hidden' && value)) || (collection === 'active' && key === 'hidden' && value) || (collection === 'saved' && (key === 'hidden' && value || key === 'saved' && !value)) || (collection === 'applied' && (key === 'hidden' && value || key === 'applied' && !value)) || (collection === 'hidden' && key === 'hidden' && !value),
      message: key === 'priority' ? value ? 'Přidáno mezi tvoje priority.' : 'Priorita zrušená.' : key === 'saved' ? value ? 'Nabídka uložená.' : 'Uložení zrušeno.' : key === 'applied' ? value ? 'Nabídka označená jako Reagoval jsem.' : 'Označení reakce zrušeno.' : value ? 'Nabídka skrytá. Najdeš ji v sekci Skryté.' : 'Nabídka znovu zobrazená.' });
    setActionError(''); setReloadKey(value => value + 1);
    return result.state;
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

  function toggleSelectedOffer(id) {
    if (!selectedOfferIds.has(id) && selectedOfferIds.size >= 100) {
      setDeleteError('Najednou lze vybrat nejvýše 100 nabídek.');
      return;
    }
    setSelectedOfferIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setDeleteError('');
  }
  function selectVisibleOffers() {
    const allSelected = visible.length > 0 && visible.every(job => selectedOfferIds.has(job.id));
    if (!allSelected && selectedOfferIds.size + visible.filter(job => !selectedOfferIds.has(job.id)).length > 100) {
      setDeleteError('Výběr může obsahovat nejvýše 100 nabídek. Odeber některé položky a zkus to znovu.');
      return;
    }
    setDeleteError('');
    setSelectedOfferIds(previous => {
      const next = new Set(previous);
      for (const job of visible) allSelected ? next.delete(job.id) : next.add(job.id);
      return next;
    });
  }
  function leaveSelectionMode() {
    setSelectionMode(false); setSelectedOfferIds(new Set()); setDeleteConfirm(false); setDeleteError('');
  }
  async function deleteSelectedOffers() {
    const profile = profileId;
    const offerIds = [...selectedOfferIds];
    if (!profile || !offerIds.length) return;
    setDeleteBusy(true); setDeleteError('');
    try {
      await profileApi('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteMany', profileId: profile, offerIds }) });
      if (currentProfile.current !== profile) return;
      setDeleteConfirm(false); leaveSelectionMode(); setLastAction(null); setReloadKey(value => value + 1);
    } catch (failure) { setDeleteError(failure.message || 'Nabídky se nepodařilo smazat. Zkus to znovu.'); }
    finally { setDeleteBusy(false); }
  }

  function navigate(nextSection, id = null) {
    if(typeof window !== 'undefined' && section === 'offers' && !offerDetail) listScroll.current=window.scrollY;
    if (selectionMode) leaveSelectionMode();
    setSection(nextSection); setAdding(false);
    setOfferDetail(nextSection === 'offers' ? id : null);
    setSelectedOffer(nextSection === 'applications' ? id : null);
    if (typeof window !== 'undefined') {
      const root = { offers: 'nabidky', applications: 'prihlasky', profile: 'profil', documents: 'dokumenty' }[nextSection];
      window.requestAnimationFrame(() => window.scrollTo({top:nextSection==='offers' && !id ? listScroll.current : 0,behavior:'instant'}));
      window.history.pushState(null, '', '#/' + root + (id ? '/' + encodeURIComponent(id) : '') + '?' + new URLSearchParams({collection,search,verdict,sort,period:historyPeriod,page:String(page),size:String(pageSize)}));
    }
  }
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      const route = window.location.hash.split('?')[0];
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
      setCollection(['active','saved','applied','priority','hidden','manual'].includes(params.get('collection')) ? params.get('collection') : 'active'); setSearch(params.get('search') || ''); setVerdict(Object.hasOwn(VERDICTS,params.get('verdict')) ? params.get('verdict') : 'all'); setSort(['newest','priority'].includes(params.get('sort')) ? params.get('sort') : 'score'); setHistoryPeriod(['24h','7d','30d'].includes(params.get('period')) ? params.get('period') : 'all'); setPage(Math.max(1,Number(params.get('page')) || 1)); setPageSize([6,12,24,48].includes(Number(params.get('size'))) ? Number(params.get('size')) : 12);
      const next = route.startsWith('#/dokumenty') ? 'documents' : route.startsWith('#/profil') ? 'profile' : route.startsWith('#/prihlasky') ? 'applications' : 'offers';
      let id = null;
      try { id = route.split('/')[2] ? decodeURIComponent(route.split('/')[2]) : null; } catch {}
      window.requestAnimationFrame(() => window.scrollTo({top:next==='offers' && !id ? listScroll.current : 0,behavior:'instant'}));
      setSection(next); setOfferDetail(next === 'offers' ? id : null); setSelectedOffer(next === 'applications' ? id : null); setAdding(false);
    };
    window.addEventListener('popstate', sync); window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const route=window.location.hash.split('?')[0] || '#/nabidky';
    window.history.replaceState(null,'',route+'?'+new URLSearchParams({collection,search,verdict,sort,period:historyPeriod,page:String(page),size:String(pageSize)}));
  },[collection,search,verdict,sort,historyPeriod,page,pageSize]);
  function openDuplicate(id) { navigate('offers', id); }
  function openApplication(id) { navigate('applications', id); }
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
    : Object.fromEntries(Object.keys(VERDICTS).map(key => [key, jobs.filter(job => job.evaluation?.verdict === key).length]));
  const totalStored = pageResult?.totalStored ?? jobs.length;
  const totalAll = local && !demo && pageResult ? pageResult.totalAll : jobs.length;
  const resetFilters = () => { setSearch(''); setVerdict('all'); setHistoryPeriod('all'); setNewOnly(false); setPage(1); };

  function Pagination() {
    return <nav aria-label="Stránkování nabídek" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface p-3">
      <span className="text-xs text-ink-secondary">Stránka {view.page} z {view.pageCount}</span>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className="button-secondary" disabled={loadingResults || view.page <= 1} onClick={() => setPage(view.page - 1)}>Předchozí</button>
        {pageNumbers(view.page, view.pageCount).map(number => typeof number === 'string' ? <span key={number} className="px-2 text-ink-secondary" aria-hidden="true">…</span> : <button type="button" key={number} aria-label={'Stránka ' + number} aria-current={view.page === number ? 'page' : undefined} disabled={loadingResults} onClick={() => setPage(number)} className={'min-h-11 min-w-11 rounded-xl px-3 text-sm font-medium ' + (view.page === number ? 'bg-brand text-white' : 'text-brand hover:bg-surface-subtle')}>{number}</button>)}
        <button type="button" className="button-secondary" disabled={loadingResults || view.page >= view.pageCount} onClick={() => setPage(view.page + 1)}>Další</button>
      </div>
    </nav>;
  }

  function AppMenu() {
    return <details ref={appMenu} className="relative" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
      <summary aria-label="Otevřít menu" className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-subtle">
        <Menu className="h-5 w-5" aria-hidden="true" /><span>Menu</span>
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-border-subtle bg-surface p-3 shadow-popover">
        <TextSizeControl />
        {accountControls || <div className="mt-3 border-t border-border-subtle pt-3">
          <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-ink-tertiary">Účet</p>
          <button type="button" disabled className="w-full rounded-lg px-3 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50">Změnit heslo</button>
          <button type="button" disabled className="w-full rounded-lg px-3 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50">Odhlásit se</button>
          <p className="px-3 pt-1 text-xs leading-relaxed text-ink-secondary">Místní režim nepoužívá účet. Tyto akce jsou dostupné po přihlášení do cloudové verze.</p>
        </div>}
      </div>
    </details>;
  }

  return <div className="min-h-screen">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-20 focus:rounded-xl focus:bg-white focus:p-3">Přejít na obsah</a>
    <header className="border-b border-border-subtle bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <a href="./" aria-label="MakAI — úvod" className="shrink-0 rounded-lg focus-visible:outline-offset-4">
          <img src={`${import.meta.env.BASE_URL}brand/01_MakAI_logo_original_V0.svg`} alt="MakAI" width="2048" height="682" className="block h-auto w-32 sm:w-44" />
        </a>
        <span className="hidden text-xs text-ink-secondary sm:block">Tvůj další kariérní krok</span>
        <div className="flex items-center gap-3">
          {demo && <span className="rounded-full border border-border-subtle px-3 py-1.5 text-xs text-brand">Ukázkový režim</span>}
          <AppMenu />
        </div>
      </div>
    </header>
    <main id="main" className="mx-auto max-w-6xl px-5 pb-12 pt-6 sm:px-8 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-2 hidden text-xs font-medium text-brand sm:block">Tvůj další kariérní krok</p><h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{section === 'applications' ? 'Moje přihlášky' : section === 'profile' ? 'Profil a hledání' : section === 'documents' ? 'Dokumenty' : 'Najdi práci, která ti sedí.'}</h1></div>
        {configured && section === 'offers' && <button type="button" onClick={refresh} disabled={status === 'loading'} className="button-secondary" aria-label="Obnovit uložené nabídky"><RefreshCw className={'h-4 w-4 ' + (status === 'loading' ? 'animate-spin' : '')} aria-hidden="true" /><span className="hidden sm:inline">Obnovit přehled</span></button>}
      </div>
      {local && !demo && <nav aria-label="Hlavní sekce" className="main-nav mt-5 flex gap-1 border-b border-border-subtle">{[['offers','Nabídky'],['applications','Moje přihlášky'],['documents','Dokumenty'],['profile','Profil a hledání']].filter(([key]) => key === 'offers' || shared && (key === 'applications' || key === 'documents' || key === 'profile')).map(([key,label]) => <button type="button" key={key} aria-current={section === key ? 'page' : undefined} className={'nav-tab ' + (section === key ? 'nav-tab-active' : '')} onClick={() => navigate(key)}>{label}</button>)}</nav>}
      {local && section !== 'applications' && <ProfilePanel compact={section !== 'profile'} onManage={() => navigate('profile')} onManageDocuments={() => navigate('documents')} onFirstSearch={() => navigate('offers')} onJobsChanged={refresh} onProfileChanged={setProfileId} />}
      {demo && <div role="status" className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-fit-potential-bg bg-fit-potential-bg text-fit-potential-text px-4 py-3 text-xs leading-relaxed">
        <span><strong>Ukázka vzhledu.</strong> Všechny nabídky i hodnocení jsou smyšlené.</span>
        <button type="button" className="inline-flex items-center gap-1 rounded-lg p-1 font-semibold text-brand" onClick={refresh}><X className="h-3.5 w-3.5" aria-hidden="true" />Zavřít ukázku</button>
      </div>}

      {shared && !demo && !offerDetail && section === 'offers' && <div className="mt-5 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="relative block min-w-0"><span className="sr-only">Hledat pozici nebo společnost</span><Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-ink-secondary" aria-hidden="true" /><input type="search" maxLength={200} value={search} onChange={event => changeFilter(setSearch,event.target.value)} placeholder="Pozice nebo společnost" className="min-h-11 w-full rounded-xl border border-border-subtle bg-surface-subtle py-3 pl-11 pr-4 text-sm" /></label>
          <button type="button" className="button-primary min-h-11 w-full sm:w-auto" aria-label="Přidat nabídku" disabled={!profileId} onClick={() => setAdding(value => !value)}><Plus className="h-4 w-4" aria-hidden="true" />Přidat nabídku</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 sm:max-w-2xl" aria-label="Rychlé nastavení přehledu">
          <div className="block text-xs font-medium text-ink-secondary"><span className="mb-1.5 block">Shoda s profilem</span><SelectMenu value={verdict} ariaLabel="Shoda s profilem" onChange={value=>changeFilter(setVerdict,value)} options={[{value:'all',label:`Všechny shody (${totalAll})`},...Object.entries(VERDICTS).map(([key,item])=>({value:key,label:`${item.title} (${counts[key]||0})`}))]} /></div>
          <div className="block text-xs font-medium text-ink-secondary"><span className="mb-1.5 block">Řazení</span><SelectMenu value={sort} ariaLabel="Řazení nabídek" onChange={value=>changeFilter(setSort,value)} options={[{value:'score',label:'Nejvyšší shoda'},{value:'priority',label:'Moje priority první'},{value:'newest',label:'Naposledy přidané'}]} /></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Kategorie nabídek" className="inline-grid min-h-11 w-full grid-cols-3 rounded-xl border border-border-subtle bg-surface-subtle p-1 sm:w-auto">
            {[['active','Všechny'],['saved','Uložené'],['applied','Přihlášky']].map(([key,label]) => <button type="button" key={key} aria-pressed={collection === key} className={'min-h-11 rounded-lg px-3 text-sm transition-colors ' + (collection === key ? 'bg-white font-semibold text-brand shadow-sm' : 'text-ink-secondary hover:text-brand')} onClick={() => { changeFilter(setCollection,key); resetFilters(); }}>{label}</button>)}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
          <button type="button" className={'button-secondary min-h-11 flex-1 justify-center sm:flex-none ' + (selectionMode ? 'border-brand text-brand' : '')} aria-label={selectionMode ? 'Ukončit hromadný výběr nabídek' : 'Vybrat nabídky k hromadnému smazání'} aria-pressed={selectionMode} disabled={!profileId || !visible.length || loadingResults} onClick={() => { if (selectionMode) leaveSelectionMode(); else { setSelectionMode(true); setSelectedOfferIds(new Set()); setDeleteError(''); } }}><ListChecks className="h-4 w-4" aria-hidden="true" /><span className="sm:hidden">{selectionMode ? 'Ukončit' : 'Vybrat'}</span><span className="hidden sm:inline">{selectionMode ? 'Ukončit výběr' : 'Hromadný výběr'}</span></button>
          <details ref={filtersPopover} className="relative w-full sm:w-auto">
            <summary className="button-secondary min-h-11 w-full cursor-pointer list-none sm:w-auto">Další filtry{!['active','saved','applied'].includes(collection) && ` · ${collection === 'priority' ? 'Moje priority' : collection === 'manual' ? 'Přidáno mnou' : 'Skryté nabídky'}`}{(historyPeriod !== 'all' || newOnly || !['active','saved','applied'].includes(collection)) && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs text-white">{Number(historyPeriod !== 'all') + Number(newOnly) + Number(!['active','saved','applied'].includes(collection))}</span>}</summary>
            <div className="absolute right-0 top-full z-30 mt-2 grid w-[min(20rem,calc(100vw-2.5rem))] gap-4 rounded-2xl border border-border-subtle bg-surface p-4 shadow-popover">
              <h2 className="text-sm font-semibold">Další možnosti</h2>
              <div className="block text-sm"><span className="mb-2 block">Další kolekce</span><SelectMenu value={['priority','manual','hidden'].includes(collection) ? collection : ''} ariaLabel="Další kolekce" onChange={value=>{if(value)changeFilter(setCollection,value);}} options={[{value:'',label:'Vyber kolekci…'},{value:'priority',label:'Moje priority'},{value:'manual',label:'Přidáno mnou'},{value:'hidden',label:'Skryté nabídky'}]} /></div>
              <div className="block text-sm"><span className="mb-2 block">Období</span><SelectMenu ariaLabel="Období nabídek v historii" value={historyPeriod} onChange={value=>changeFilter(setHistoryPeriod,value)} options={[{value:'all',label:'Celá historie'},{value:'24h',label:'Posledních 24 hodin'},{value:'7d',label:'Posledních 7 dní'},{value:'30d',label:'Posledních 30 dní'}]} /></div>
              <div className="block text-sm"><span className="mb-2 block">Počet nabídek na stránce</span><SelectMenu ariaLabel="Počet nabídek na stránce" value={pageSize} onChange={value=>changeFilter(setPageSize,Number(value))} options={[6,12,24,48].map(value=>({value,label:String(value)}))} /></div>
              {shared && <label className="flex min-h-11 items-center gap-3 text-sm"><input className="h-5 w-5 accent-brand" type="checkbox" checked={newOnly} disabled={!previousVisit || demo} onChange={e => { setNewOnly(e.target.checked); setPage(1); }} />Nové od poslední návštěvy</label>}
              {(search || verdict !== 'all' || historyPeriod !== 'all' || newOnly || !['active','saved','applied'].includes(collection)) && <button type="button" className="min-h-11 text-left text-sm font-medium text-brand" onClick={() => { resetFilters(); if (!['active','saved','applied'].includes(collection)) changeFilter(setCollection,'active'); }}>Zrušit filtry</button>}
            </div>
          </details>
          </div>
        </div>
      </div>}
      {adding && profileId && <AddOfferPanel key={profileId} profileId={profileId} onClose={() => setAdding(false)} onAdded={(result,applied) => { setAdding(false); setReloadKey(value => value + 1); if(applied) openApplication(result.offerId); else navigate('offers', result.offerId); }} onDuplicate={openDuplicate} />}
      {shared && !demo && section === 'applications' && profileId && <ApplicationsPanel profileId={profileId} reloadKey={reloadKey} selectedOffer={selectedOffer} onSelected={id => navigate('applications',id)} onChanged={() => setReloadKey(value => value + 1)} />}
      {shared && !demo && section === 'documents' && profileId && <DocumentsPanel profileId={profileId} />}
      {shared && !demo && section === 'offers' && offerDetail && profileId && <OfferDetail key={profileId + ':' + offerDetail} profileId={profileId} offerId={offerDetail} reloadKey={reloadKey} onClose={() => navigate('offers')} onStateChange={changeJobState} onApplication={openApplication} onChanged={() => setReloadKey(value => value + 1)} />}
      {((section === 'offers' && !offerDetail) || demo) && <>
      {lastAction && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface p-3">
        <p role="status" className="text-sm">{lastAction.message}</p>
        <button type="button" className="button-secondary" ref={undoButton} disabled={undoBusy} onClick={undoAction}>{undoBusy ? 'Vracím změnu…' : 'Vrátit změnu'}</button>
      </div>}
      {actionError && <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p>}

      <section className="mt-5" aria-label="Nabídky pro tebe" aria-busy={status === 'loading' || loadingResults}>
        {status === 'ready' && <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary"><p role="status">{view.total ? (view.page-1)*view.pageSize+1 : 0}–{Math.min(view.page*view.pageSize,view.total)} z {view.total} nabídek</p><div className="flex items-center gap-3">{selectionMode && <><span>{selectedOfferIds.size} vybráno</span><button type="button" className="min-h-9 text-brand" onClick={selectVisibleOffers}>{visible.length > 0 && visible.every(job => selectedOfferIds.has(job.id)) ? 'Odznačit stránku' : 'Vybrat stránku'}</button></>}{(search || verdict !== 'all' || historyPeriod !== 'all' || newOnly) && <button type="button" className="min-h-9 text-brand" onClick={resetFilters}>Zrušit filtry</button>}</div></div>
          {invalidCount > 0 && <p role="status" className="mb-4 rounded-xl bg-fit-potential-bg text-fit-potential-text p-3 text-xs">Počet přeskočených neplatných záznamů: {invalidCount}.</p>}
          {limitReached && <p className="mb-4 text-xs text-ink-secondary">Přímé připojení načítá posledních 500 hodnocení.</p>}
          {loadingResults && <p role="status" className="mb-3 text-xs text-brand">Načítám stránku nabídek…</p>}

          {visible.length > 0 ? <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map(job => <JobCard key={profileId + ':' + job.id} job={job} onStateChange={shared && !demo && profileId ? changeJobState : undefined} actionsDisabled={undoBusy || loadingResults || selectionMode} onDetail={shared && !demo ? id => navigate('offers',id) : undefined} selectionMode={selectionMode} selected={selectedOfferIds.has(job.id)} onToggleSelect={toggleSelectedOffer} />)}</div> :
            <EmptyState title={totalAll ? 'Žádná nabídka neodpovídá filtrům' : collection === 'manual' ? 'Zatím jsi nepřidal žádné nabídky' : collection === 'saved' ? 'Zatím nemáš uložené nabídky' : collection === 'applied' ? 'Zatím nemáš označené reakce' : collection === 'hidden' ? 'Zatím nemáš skryté nabídky' : totalStored ? 'Všechny nabídky jsou skryté' : 'První příležitost teprve přijde'} action={totalAll ? <button type="button" className="button-secondary" onClick={resetFilters}>Zrušit filtry</button> : totalStored && collection === 'active' ? <button type="button" className="button-secondary" onClick={() => changeFilter(setCollection, 'hidden')}>Prohlédnout skryté nabídky</button> : collection !== 'active' ? <button type="button" className="button-secondary" onClick={() => { changeFilter(setCollection, 'active'); resetFilters(); }}>Prohlédnout nabídky</button> : local ? <button type="button" className="button-primary" onClick={() => navigate('profile')}>Nastavit profil a najít nabídky</button> : null}>
              {totalAll ? 'Zkus jiný název pozice nebo zobraz všechna hodnocení.' : collection === 'manual' ? 'Nabídky z ručního importu se zobrazí právě tady.' : collection === 'saved' ? 'Zajímavou nabídku si odlož tlačítkem Uložit.' : collection === 'applied' ? 'Po odeslání přihlášky označ nabídku tlačítkem Reagoval jsem.' : collection === 'hidden' ? 'Skryté nabídky najdeš tady a můžeš je kdykoliv znovu zobrazit.' : totalStored ? 'Nabídky zůstávají uložené v sekci Skryté. Můžeš je kdykoliv vrátit.' : 'Vytvoř profil a spusť první hledání. Vyhodnocené nabídky se potom objeví tady.'}
            </EmptyState>}
          {view.pageCount > 1 && <div className="mt-6"><Pagination /></div>}
          {selectionMode && selectedOfferIds.size > 0 && <div className="sticky bottom-3 z-20 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface p-3 shadow-soft  sm:px-5">
            <p className="text-sm"><strong>{selectedOfferIds.size}</strong> {selectedCountLabel(selectedOfferIds.size)}</p>
            <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-danger px-4 text-sm font-semibold text-white transition-colors hover:bg-danger-hover disabled:cursor-wait disabled:opacity-60" onClick={() => { setDeleteError(''); setDeleteConfirm(true); }} disabled={deleteBusy}><Trash2 className="h-4 w-4" aria-hidden="true" />Smazat vybrané</button>
          </div>}
          {selectionMode && deleteError && !deleteConfirm && <p role="alert" className="mt-3 text-sm text-danger">{deleteError}</p>}
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </>}

        {status === 'loading' && <><p role="status" className="mb-4 text-sm text-ink-secondary">Načítám nabídky…</p><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">{[1, 2, 3].map(key => <div key={key} className="h-80 animate-pulse rounded-2xl border border-border-subtle bg-surface p-4"><div className="h-5 w-24 rounded-full bg-[#e5e9e5]" /><div className="mt-6 h-5 w-3/4 rounded-lg bg-[#e5e9e5]" /><div className="mt-3 h-4 w-1/2 rounded-lg bg-surface-subtle" /></div>)}</div></>}

        {status === 'error' && <EmptyState title="Přehled se nepodařilo načíst" action={<button type="button" className="button-primary" onClick={refresh}>Zkusit znovu</button>}><p role="alert">{error}</p></EmptyState>}

        {status === 'unconfigured' && <EmptyState title="Přehled je připravený" action={<button type="button" className="button-primary" onClick={showDemo}>Prohlédnout ukázku<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></button>}>
          <p>Zdroj nabídek zatím není připojený. Mezitím si můžeš prohlédnout vzhled karet na smyšlených datech.</p>
        </EmptyState>}
      </section>
      {deleteConfirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4" onMouseDown={event => { if (event.target === event.currentTarget && !deleteBusy) setDeleteConfirm(false); }}>
        <section role="alertdialog" aria-modal="true" aria-labelledby="bulk-delete-title" aria-describedby="bulk-delete-description" className="w-full max-w-md rounded-3xl border border-border-subtle bg-surface p-6 shadow-dialog sm:p-7">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-danger-bg text-danger"><Trash2 className="h-5 w-5" aria-hidden="true" /></div>
          <h2 id="bulk-delete-title" className="font-display text-xl font-semibold">Smazat {offerCountLabel(selectedOfferIds.size)} natrvalo?</h2>
          <p id="bulk-delete-description" className="mt-3 text-sm leading-relaxed text-ink-secondary">Odstraní se také AI hodnocení, poznámky, historie reakcí a uložený text. Tuto akci nelze vrátit.</p>
          {deleteError && <p role="alert" className="mt-4 rounded-xl bg-danger-bg p-3 text-sm text-danger">{deleteError}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="button-secondary" disabled={deleteBusy} onClick={() => setDeleteConfirm(false)}>Zrušit</button>
            <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-danger px-4 text-sm font-semibold text-white transition-colors hover:bg-danger-hover disabled:cursor-wait disabled:opacity-60" disabled={deleteBusy} onClick={deleteSelectedOffers}>{deleteBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{deleteBusy ? 'Mažu nabídky…' : 'Smazat natrvalo'}</button>
          </div>
        </section>
      </div>}
      </>}
      <footer className="mt-10 flex flex-col justify-between gap-3 border-t border-border-subtle pt-5 text-xs leading-relaxed text-ink-secondary sm:flex-row">
        <span>MakAI · Další krok s lepším přehledem.</span>
        <span>Skóre vyjadřuje shodu s profilem, nikoli pravděpodobnost přijetí.</span>
      </footer>
    </main>
  </div>;
}

export default function App() {
  return import.meta.env.VITE_JOB_SOURCE === 'cloud' ? <LoginGate><Dashboard /></LoginGate> : <Dashboard />;
}
