import { useEffect, useRef, useState } from 'react';
import { Search, UserRound, RefreshCw, Square, X } from 'lucide-react';
import ProfileWizard from './ProfileWizard.jsx';
import ProfileEditor from './ProfileEditor.jsx';
import SchedulePanel, { displayTime } from './SchedulePanel.jsx';
import SelectMenu from './SelectMenu.jsx';
import { profileApi as api } from '../lib/profileApi.js';

const money = amount => new Intl.NumberFormat('cs-CZ').format(amount);
const dismissedHuntErrorStorageKey = 'makai:dismissed-hunt-error';

function HuntErrorNotice({ hunt, onDismiss, className = '' }) {
  if (!hunt.error) return null;
  return <div role="alert" className={'flex w-full flex-wrap items-center justify-between gap-2 text-sm text-danger ' + className}>
    <p>{hunt.error}{hunt.startedAt && <span className="text-xs">{' · Spuštěno ' + displayTime(hunt.startedAt)}</span>}</p>
    <button type="button" onClick={onDismiss} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-secondary hover:bg-danger-bg hover:text-danger" aria-label="Skrýt hlášku o nedokončeném hledání"><X className="h-3.5 w-3.5" aria-hidden="true" />Skrýt hlášku</button>
  </div>;
}

export default function ProfilePanel({ onJobsChanged, onProfileChanged, compact = false, onManage, onManageDocuments, onFirstSearch }) {
  const cloud = import.meta.env.VITE_JOB_SOURCE === 'cloud' || import.meta.env.VITE_SHARED_STORAGE === true;
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [building, setBuilding] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const profileRevision = useRef(0);
  const [profileUpdated, setProfileUpdated] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hunt, setHunt] = useState({ status: 'idle' });
  const [dismissedHuntErrorId, setDismissedHuntErrorId] = useState(() => {
    try { return window.localStorage.getItem(dismissedHuntErrorStorageKey) || ''; } catch { return ''; }
  });
  const [limit, setLimit] = useState(10);
  const [period, setPeriod] = useState('all');
  const [includeUnknownDates, setIncludeUnknownDates] = useState(false);
  const callback = useRef(onJobsChanged);
  callback.current = onJobsChanged;
  const alive = useRef(true);
  const seenRun = useRef('');
  const running = ['queued', 'running', 'stopping'].includes(hunt.status);
  const huntErrorId = hunt.id || hunt.startedAt || '';
  const huntErrorDismissed = Boolean(huntErrorId && huntErrorId === dismissedHuntErrorId);
  function dismissHuntError() {
    if (!huntErrorId) return;
    setDismissedHuntErrorId(huntErrorId);
    try { window.localStorage.setItem(dismissedHuntErrorStorageKey, huntErrorId); } catch {}
  }
  const [stopping, setStopping] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);

  useEffect(() => {
    alive.current = true;
    let polling = false;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const state = await api('/api/hunt');
        if (!alive.current) return;
        setHunt(state);
        if (['done', 'partial', 'blocked', 'cancelled'].includes(state.status) && seenRun.current !== state.startedAt) {
          seenRun.current = state.startedAt;
          callback.current();
        }
      } catch (failure) { if (alive.current) setError(failure.message); }
      finally { polling = false; }
    }
    api('/api/profile').then(result => { if (alive.current) { setProfile(result); onProfileChanged?.(result?.id || null); } })
      .catch(failure => { if (alive.current) setError(failure.message); })
      .finally(() => { if (alive.current) { setBusy(false); setProfileLoaded(true); } });
    poll();
    const timer = setInterval(poll, 3000);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!cloud) return;
    let active = true;
    async function synchronize() {
      if (busy || building || running) return;
      const revision = profileRevision.current;
      try {
        const [current, available] = await Promise.all([api('/api/profile'), api('/api/profile?list=1')]);
        if (!active || revision !== profileRevision.current) return;
        setProfiles(Array.isArray(available) ? available : []);
        if (profile?.id !== current?.id || profile?.revision !== current?.revision) { onProfileChanged?.(current?.id || null); setProfileUpdated(false); callback.current(); }
        setProfile(current);
      } catch (failure) { if (active) setError(failure.message); }
    }
    synchronize();
    const timer = setInterval(synchronize, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [cloud, busy, building, running, profile?.id]);

  async function changeProfile(options) {
    profileRevision.current += 1;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/api/profile', options);
      setProfile(result); setHunt({ status: 'idle' }); setProfileUpdated(true);
      onProfileChanged?.(result?.id || null);
      setNotice(result.isDefault ? 'Používám tvůj profil z projektu.' : cloud ? 'Profil byl uložen. Tvoje nabídky a přihlášky zůstávají dostupné. Automatika je pozastavená; zapni ji po kontrole nastavení.' : 'Nový profil je aktivní. Hledání bude vycházet z jeho preferencí.');
      callback.current();
      return true;
    } catch (failure) { setError(failure.message); return false; }
    finally { setBusy(false); }
  }

  async function startHunt(savedOptions = null) {
    setBusy(true); setError(''); setNotice('');
    try {
      const options = cloud ? savedOptions || await api('/api/schedule') : { limit: Number(limit), period, includeUnknownDates };
      const state = await api('/api/hunt', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...options, profileId: profile.id }) });
      setHunt(state); setNotice(state.notice || ''); onFirstSearch?.();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function dispatchQueuedHunt() {
    setBusy(true); setError(''); setNotice('');
    try {
      const state = await api('/api/hunt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dispatch' }) });
      setHunt(state); setNotice(state.notice || '');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function stopHunt() {
    setStopping(true); setError('');
    try { setHunt(await api('/api/hunt', { method: 'DELETE' })); }
    catch (failure) { setError(failure.message); }
    finally { setStopping(false); }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([profile.content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = profile.content.trimStart().startsWith('{') ? 'candidate_profile.json' : 'candidate_profile.md';
    anchor.click(); URL.revokeObjectURL(url);
  }

  if (compact && profile) return <section aria-label="Aktivní profil a hledání" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-subtle px-4 py-3">
    <button type="button" onClick={onManage} className="min-h-11 min-w-0 flex-1 text-left"><span className="block text-xs text-ink-secondary">Hledáme podle profilu</span><span className="block truncate text-sm font-semibold text-brand">{profile.name}</span></button>
    <div className="mr-[-1rem] flex flex-wrap items-center gap-2"><button type="button" className="button-primary px-3 sm:px-5" aria-label="Hledat nové nabídky" disabled={busy || running || building || scheduleDirty} onClick={() => startHunt()}><Search className="h-4 w-4" /><span className="sm:hidden">{running ? 'Hledám…' : 'Hledat'}</span><span className="hidden sm:inline">{running ? hunt.status === 'queued' ? 'Čeká na spuštění…' : 'Hledám nabídky…' : 'Hledat nové nabídky'}</span></button>{cloud && hunt.status === 'queued' && <button type="button" className="button-secondary" disabled={busy} onClick={dispatchQueuedHunt}>Spustit nyní</button>}{running && <button type="button" className="button-secondary" disabled={stopping || hunt.status === 'stopping'} onClick={stopHunt}>Zastavit</button>}</div>
    {running && <p role="status" className="w-full text-xs text-ink-secondary">{cloud ? 'Stránku můžeš zavřít. Výsledky se uloží do přehledu.' : 'Hledání běží na tomto počítači.'}</p>}
    {notice && <p role="status" className="w-full text-xs text-fit-potential-text">{notice}</p>}
    {scheduleDirty && <p className="w-full text-xs text-fit-potential-text">Nejdřív ulož změny v sekci Profil a hledání.</p>}
    {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    {hunt.error && !huntErrorDismissed && <HuntErrorNotice hunt={hunt} onDismiss={dismissHuntError} />}
    {hunt.status === 'blocked' && <p role="alert" className="w-full text-sm text-fit-potential-text">{hunt.result?.evaluationBlocked?.message || 'AI hodnocení se zastavilo. Podrobnosti najdeš v Profil a hledání.'}</p>}
    {['done','partial'].includes(hunt.status) && hunt.result && <p role="status" className="w-full text-xs text-ink-secondary">{hunt.status === 'partial' ? 'Hledání částečně dokončeno' : 'Hledání dokončeno'} · uloženo {hunt.result.saved} nabídek</p>}
  </section>;
  return <section aria-labelledby="profile-title" className="mt-6 rounded-2xl border border-border-subtle bg-surface p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3"><UserRound className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" /><div>
        <p className="text-xs text-ink-secondary">Profil pro hledání</p>
        <h2 id="profile-title" className="mt-1 break-words font-display text-lg font-semibold">{profile?.name || (busy ? 'Načítám tvůj profil…' : profileLoaded && !error ? 'Začni svým pracovním profilem' : 'Profil se nepodařilo načíst')}</h2>
      </div></div>
      {profile && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="button-primary" disabled={busy || running || building || scheduleDirty} onClick={() => startHunt()}>
          {running ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          {running ? (hunt.status === 'queued' ? 'Čeká na spuštění…' : 'Hledám nabídky…') : 'Hledat nové nabídky'}
        </button>
        {cloud && hunt.status === 'queued' && <button type="button" onClick={dispatchQueuedHunt} disabled={busy} className="button-secondary">Spustit nyní</button>}
        {running && <button type="button" onClick={stopHunt} disabled={stopping || hunt.status === 'stopping'} className="button-secondary border-border-subtle text-danger"><Square className="h-4 w-4" aria-hidden="true" />{stopping || hunt.status === 'stopping' ? 'Zastavuji…' : 'Zastavit hledání'}</button>}
      </div>}
    </div>

    {profile && !compact && <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface-subtle p-4"><div><h3 className="text-sm font-semibold">Dokumenty k přihláškám</h3><p className="mt-1 text-sm text-ink-secondary">Spravuj více verzí CV a motivační dopisy. U přihlášky označíš, které podklady jsi firmě poslal.</p></div><button type="button" className="button-secondary" onClick={onManageDocuments}>Otevřít Dokumenty</button></section>}

    {profileLoaded && !profile && !error && <div className="mt-5">
      <p className="text-sm leading-relaxed text-ink-secondary">MakAI potřebuje znát tvoje zkušenosti a preference, aby našlo práci, která ti sedí.</p>
      <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <li><strong className="text-brand">1. Vytvoř profil</strong><p className="mt-1 text-ink-secondary">Ze životopisu nebo krátkého dotazníku.</p></li>
        <li><strong className="text-brand">2. Zkontroluj preference</strong><p className="mt-1 text-ink-secondary">Role, lokalitu a mzdové podmínky.</p></li>
        <li><strong className="text-brand">3. Najdi první nabídky</strong><p className="mt-1 text-ink-secondary">Potom si můžeš zapnout automatiku.</p></li>
      </ol>
      <ProfileWizard draftKey={'profile-wizard:' + (profile?.id || 'new')} disabled={busy || running} onBusyChange={setBuilding} triggerLabel="Vytvořit můj profil" primary onActivate={payload => changeProfile({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })} />
    </div>}

    {profile && <>
      {cloud && profiles.length > 1 && <div className="mt-4 text-sm"><span className="mb-2 block">Aktivní profil</span>
        <SelectMenu value={profile.id} disabled={busy || running || building} ariaLabel="Aktivní profil" onChange={value=>changeProfile({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: value }) })} options={profiles.map(item=>({value:item.id,label:item.name+(item.revision?' · verze '+(item.revision+1):'')}))} />
        <span className="mt-1 block text-xs text-ink-secondary">Stejný výběr a historie na localhostu i online. Přepnutí profilu pozastaví automatiku.</span>
      </div>}
      <details className="mt-4 border-t border-border-subtle pt-3">
        <summary className="cursor-pointer py-1 text-sm font-medium text-brand">Profil a preference</summary>
        <div className="mt-4 grid gap-4 text-sm md:grid-cols-3">
          <div><h3 className="font-semibold">Kariérní směr</h3><p className="mt-2 leading-relaxed text-ink-secondary">{profile.searchTerms.join(' · ')}</p></div>
          <div><h3 className="font-semibold">Lokalita a jazyky</h3><p className="mt-2 leading-relaxed text-ink-secondary">{profile.profile.location_preferences.join(' · ') || 'Lokalita neuvedena'}</p><p className="mt-2 text-ink-secondary">{profile.profile.language_preferences.join(' · ') || 'Jazyky neuvedeny'}</p></div>
          <div><h3 className="font-semibold">Mzdové preference</h3><p className="mt-2 text-ink-secondary">Cíl {profile.profile.salary.monthly_gross_target_czk.map(money).join('–')} Kč</p><p className="mt-2 text-ink-secondary">Běžné minimum {money(profile.profile.salary.standard_minimum_czk)} Kč</p><p className="mt-1 text-xs text-ink-secondary">Hrubá měsíční mzda</p></div>
        </div>
        <ProfileEditor key={'editor-' + profile.id + ':' + (profile.revision || 0)} profile={profile} disabled={busy || running || building} onSave={payload => changeProfile({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, replaceProfileId: cloud ? profile.id : undefined, preserveCvFromProfileId: cloud ? undefined : profile.id, expectedRevision: payload.expectedRevision ?? profile.revision ?? 0 }) })} />
        <details className="mt-4"><summary className="cursor-pointer py-1 text-sm text-brand">Další možnosti profilu</summary>
          <ProfileWizard draftKey={'profile-wizard:' + (profile?.id || 'new')} disabled={busy || running} onBusyChange={setBuilding} onActivate={payload => changeProfile({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })} />
          {!cloud && !profile.isDefault && <button type="button" className="button-secondary mt-3" disabled={busy || running || building} onClick={() => changeProfile({ method: 'DELETE' })}>Použít můj výchozí profil</button>}
          <button type="button" onClick={download} className="button-secondary mt-3">Stáhnout aktuální profil</button>
          <details className="mt-3"><summary className="cursor-pointer py-1 text-sm text-brand">Zobrazit podklady profilu</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-subtle p-4 font-sans text-xs leading-relaxed">{profile.content}</pre></details>
        </details>
      </details>
      {cloud && <SchedulePanel key={'schedule-' + profile.id + ':' + (profile.revision || 0)} hasProfile draftKey={'schedule:' + profile.id} profileUpdated={profileUpdated} onDirtyChange={setScheduleDirty} onSearch={options => startHunt(options)} searchDisabled={busy || running || building} />}
      {!cloud && <details className="mt-3">
        <summary className="cursor-pointer py-1 text-sm font-medium text-brand">Nastavení hledání</summary>
        <fieldset disabled={busy || running || building} className="mt-3 space-y-3 rounded-xl border border-border-subtle p-4">
          <div className="block text-sm"><span className="mb-1 block">Stáří inzerátů</span><SelectMenu ariaLabel="Stáří inzerátů pro nové hledání" value={period} disabled={busy||running||building} onChange={setPeriod} options={[{value:'all',label:'Bez omezení stáří'},{value:'24h',label:'Posledních 24 hodin'},{value:'7d',label:'Posledních 7 dní'},{value:'30d',label:'Posledních 30 dní'}]} /></div>
          <p className="text-xs text-ink-secondary">Podle data zveřejnění na portálu, nikoli data hodnocení v MakAI.</p>
          {period !== 'all' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={includeUnknownDates} onChange={event => setIncludeUnknownDates(event.target.checked)} className="mt-1" />Zahrnout i nabídky bez ověřitelného data zveřejnění</label>}
          <div className="block text-sm"><span className="mb-1 block">Nabídek na portál</span><SelectMenu ariaLabel="Počet nabídek na portál" value={limit} disabled={busy||running||building} onChange={setLimit} options={[5,10,15,30].map(value=>({value:String(value),label:String(value)}))} /></div>
        </fieldset>
      </details>}
      <p className="mt-3 text-xs leading-relaxed text-ink-secondary">{cloud ? 'Tvůj profil a výsledky jsou dostupné na všech připojených zařízeních. Automatické hledání může běžet i při zavřené aplikaci.' : 'Hledání běží na tomto počítači. Automatiku nastav v online aplikaci.'}</p>
    </>}

    {notice && <p role="status" className="mt-3 text-sm text-brand">{notice}</p>}
    {running && <p role="status" className="mt-3 text-sm text-brand">{hunt.status === 'stopping' ? 'Ukončuji hledání a další AI hodnocení…' : hunt.status === 'queued' ? 'Hledání čeká na spuštění. Stránku můžeš zavřít.' : 'Procházím pracovní nabídky a hodnotím jejich shodu. Může to trvat několik minut.'}</p>}
    {running && <p className="mt-2 text-xs text-ink-secondary">Již odeslané AI požadavky mohou být účtovány i po zastavení.</p>}
    {hunt.status === 'cancelled' && <p role="status" className="mt-3 text-sm">Hledání bylo zastaveno. Uložené nabídky zůstávají dostupné.</p>}
    {['done', 'partial'].includes(hunt.status) && hunt.result && <div className="mt-3">
      <p role="status" className="text-sm">{hunt.status === 'partial' || hunt.result.evaluationBlocked ? 'Hledání je částečně dokončené.' : 'Hledání dokončeno.'} Uloženo {hunt.result.saved} nabídek · {displayTime(hunt.startedAt)}</p>
      <details className="mt-2"><summary className="cursor-pointer py-1 text-xs font-medium text-brand">Podrobnosti posledního hledání</summary>
        <div className="mt-2 text-xs leading-relaxed text-ink-secondary">
          <p>Nalezeno {hunt.result.found} · Vyhodnoceno {hunt.result.evaluated} · Již uložených {hunt.result.skippedDuplicates ?? 0}</p>
          {hunt.result.sources?.map(source => <p key={source.portal} className="mt-1">{source.portal}: {source.status === 'error' ? 'Zdroj se nepodařilo načíst' : source.found + ' nových nabídek'}{source.scanLimitReached ? ' · dosažen limit procházení' : ''}</p>)}
          <p className="mt-1">Mimo období {hunt.result.skippedOutsidePeriod ?? 0} · Bez ověřitelného data {hunt.result.skippedUnknownDate ?? 0}</p>
          {hunt.result.errors?.map((message, index) => <p key={index} className="mt-1 text-fit-potential-text">{message}</p>)}
        </div>
      </details>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    {hunt.status === 'error' && hunt.error && !huntErrorDismissed && <HuntErrorNotice hunt={hunt} onDismiss={dismissHuntError} className="mt-3" />}
    {profileLoaded && !profile && error && <button type="button" className="button-secondary mt-3" onClick={() => window.location.reload()}>Zkusit načíst profil znovu</button>}
    {cloud && hunt.result?.evaluationLimitReached && <p role="status" className="mt-3 text-xs text-fit-potential-text">Dosažen limit AI hodnocení. Další nabídky zůstávají pro příští hledání.</p>}
    {cloud && hunt.status === 'blocked' && <p role="alert" className="mt-3 text-sm text-fit-potential-text">{hunt.result?.evaluationBlocked?.message || 'AI hodnocení bylo zastaveno. Zkontroluj API kvótu.'}</p>}
    {cloud && hunt.runs?.length > 0 && <details className="mt-5 border-t border-border-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-brand">Historie spuštění</summary><ul className="mt-3 space-y-3">{hunt.runs.map(run => <li key={run.id} className="rounded-xl bg-surface-subtle p-3 text-xs leading-relaxed"><p>{displayTime(run.startedAt)} · {run.source === 'scheduled' ? 'Automaticky' : 'Ručně'} · {{ queued: 'Ve frontě', running: 'Probíhá', stopping: 'Zastavuje se', cancelled: 'Zastaveno', done: 'Dokončeno', partial: 'Částečně dokončeno', blocked: 'AI limit', error: 'Chyba' }[run.status] || run.status}</p>{run.result && <p className="mt-1 text-ink-secondary">Nalezeno {run.result.found} · Vyhodnoceno {run.result.evaluated} · Uloženo {run.result.saved}</p>}{run.error && <p className="mt-1 text-danger">{run.error}</p>}</li>)}</ul></details>}
  </section>;
}
