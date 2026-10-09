import { useEffect, useRef, useState } from 'react';
import { FileUp, Search, UserRound, RefreshCw, Square } from 'lucide-react';
import ProfileWizard from './ProfileWizard.jsx';
import ProfileEditor from './ProfileEditor.jsx';
import SchedulePanel, { displayTime } from './SchedulePanel.jsx';
import { profileApi as api } from '../lib/profileApi.js';

const money = amount => new Intl.NumberFormat('cs-CZ').format(amount);

export default function ProfilePanel({ onJobsChanged, onProfileChanged }) {
  const cloud = import.meta.env.VITE_JOB_SOURCE === 'cloud';
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hunt, setHunt] = useState({ status: 'idle' });
  const [limit, setLimit] = useState(10);
  const [period, setPeriod] = useState('all');
  const [includeUnknownDates, setIncludeUnknownDates] = useState(false);
  const callback = useRef(onJobsChanged);
  callback.current = onJobsChanged;
  const alive = useRef(true);
  const seenRun = useRef('');
  const running = ['queued', 'running', 'stopping'].includes(hunt.status);
  const [stopping, setStopping] = useState(false);

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
      .finally(() => { if (alive.current) setBusy(false); });
    poll();
    const timer = setInterval(poll, 3000);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);

  async function changeProfile(options) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/api/profile', options);
      setProfile(result); setHunt({ status: 'idle' });
      onProfileChanged?.(result?.id || null);
      setNotice(result.isDefault ? 'Používám tvůj profil z projektu.' : cloud ? 'Profil byl uložen. Automatika je pozastavená; zapni ji znovu po kontrole nastavení.' : 'Nový profil je aktivní. Hledání bude vycházet z jeho preferencí.');
      callback.current();
      return true;
    } catch (failure) { setError(failure.message); return false; }
    finally { setBusy(false); }
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 250000) { setError('Profil může mít nejvýše 250 kB.'); return; }
    if (!/\.(md|json)$/i.test(file.name)) { setError('Nahraj profil ve formátu .md nebo .json.'); return; }
    try {
      await changeProfile({ method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, content: await file.text() }) });
    } catch { setError('Soubor se nepodařilo přečíst.'); }
  }

  async function startHunt() {
    setBusy(true); setError(''); setNotice('');
    try {
      const options = cloud ? await api('/api/schedule') : { limit: Number(limit), period, includeUnknownDates };
      const state = await api('/api/hunt', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...options, profileId: profile.id }) });
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

  return <section aria-labelledby="profile-title" className="mt-8 rounded-3xl border border-viatix-teal/25 bg-viatix-sand2 p-5 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-3"><UserRound className="h-6 w-6 text-viatix-teal" aria-hidden="true" /><div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-viatix-teal">Aktivní profil pro hledání</p>
        <h2 id="profile-title" className="mt-1 font-display text-xl font-semibold">{profile?.name || (busy ? 'Načítám tvůj profil…' : 'Vytvoř si profil pro hledání')}</h2>
      </div></div>
      {profile && <span className="rounded-full bg-viatix-teal/10 px-3 py-1.5 text-xs text-viatix-teal">{cloud ? 'Online profil' : profile.isDefault ? 'Výchozí profil' : 'Místní profil'}</span>}
    </div>
    {profile && <>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">{profile.isDefault
        ? 'Hledání vychází z tvého profilu uloženého v projektu: zkušeností, kariérního směru a pracovních podmínek.'
        : cloud ? 'Tento profil používá ruční i automatické hledání. Výsledky jsou uložené v online historii.' : 'Hledání vychází z tohoto místního profilu. Jeho výsledky se ukládají samostatně.'}</p>
      <div className="mt-5 grid gap-5 text-sm md:grid-cols-3">
        <div><h3 className="mb-2 font-semibold">Kariérní směr</h3><p className="leading-relaxed text-muted-foreground">{profile.searchTerms.slice(0, 5).join(' · ')}</p>
          {profile.searchTerms.length > 5 && <p className="mt-2 text-xs text-viatix-teal">A dalších {profile.searchTerms.length - 5} cílových rolí</p>}</div>
        <div><h3 className="mb-2 font-semibold">Lokalita a jazyky</h3><p className="leading-relaxed text-muted-foreground">{profile.profile.location_preferences[0] || 'Lokalita neuvedena'}</p><p className="mt-2 leading-relaxed text-muted-foreground">{profile.profile.language_preferences[0] || 'Jazyky neuvedeny'}</p></div>
        <div><h3 className="mb-2 font-semibold">Mzdové preference</h3><p className="text-muted-foreground">Cíl {profile.profile.salary.monthly_gross_target_czk.map(money).join('–')} Kč</p><p className="mt-2 text-muted-foreground">Běžné minimum {money(profile.profile.salary.standard_minimum_czk)} Kč</p><p className="mt-2 text-xs text-muted-foreground">Hrubá měsíční mzda</p></div>
      </div>
      <details className="mt-5 border-t border-viatix-line/60 pt-4"><summary className="cursor-pointer text-sm font-medium text-viatix-teal">Zobrazit celý profil a podmínky</summary>
        <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/40 p-4 font-sans text-xs leading-relaxed">{profile.content}</pre>
        <button type="button" onClick={download} className="button-secondary mt-3">Stáhnout aktuální profil</button>
      </details>
    </>}
    {!busy && <details className="mt-5 border-t border-viatix-line/60 pt-4">
      <summary className="cursor-pointer text-sm font-medium text-viatix-teal">{profile ? 'Správa profilu' : 'Vytvořit nebo nahrát profil'}</summary>
      <ProfileEditor key={'editor-' + (profile?.id || 'new')} profile={profile} disabled={running || building} onSave={payload => changeProfile({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })} />
      <label className={'button-secondary relative mt-3 ' + (running || building ? 'opacity-50' : 'cursor-pointer')}>
        <FileUp className="h-4 w-4" aria-hidden="true" />{profile ? 'Nahrát jiný profil' : 'Nahrát profil'}
        <input aria-label="Nahrát jiný profil" type="file" accept=".md,.json" onChange={upload} disabled={running || building} className="absolute inset-0 w-full cursor-pointer opacity-0" />
      </label>
      {!cloud && profile && !profile.isDefault && <button type="button" className="button-secondary ml-3" disabled={running || building} onClick={() => changeProfile({ method: 'DELETE' })}>Použít můj výchozí profil</button>}
      {!cloud && <ProfileWizard disabled={running} onBusyChange={setBuilding} onActivate={payload => changeProfile({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })} />}
    </details>}
    {cloud && <SchedulePanel key={'schedule-' + (profile?.id || 'new')} hasProfile={Boolean(profile)} />}
    {!cloud && <fieldset disabled={busy || running || building} className="mt-6 rounded-2xl border border-viatix-line/60 p-4">
      <legend className="px-2 text-sm font-semibold">Časové vymezení nového hledání</legend>
      <label className="flex flex-wrap items-center gap-3 text-sm">Zveřejněno
        <select aria-label="Stáří inzerátů pro nové hledání" value={period} onChange={event => setPeriod(event.target.value)} className="rounded-xl border border-viatix-line bg-transparent px-3 py-2">
          <option value="all">Bez omezení stáří</option><option value="24h">Za posledních 24 hodin</option><option value="7d">Za posledních 7 dní</option><option value="30d">Za posledních 30 dní</option>
        </select>
      </label>
      {period !== 'all' && <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={includeUnknownDates} onChange={event => setIncludeUnknownDates(event.target.checked)} className="mt-0.5" />Zahrnout i nabídky bez data zveřejnění (jejich stáří nelze ověřit)</label>}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Filtr používá datum zveřejnění uvedené portálem. Již uložené nabídky se znovu nehodnotí. Část inzerátů na Jobs.cz a Práci za rohem nemá přesné datum; s časovým omezením se zahrne pouze při zaškrtnutí volby výše.</p>
    </fieldset>}
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button type="button" className="button-primary" disabled={!profile || busy || running || building} onClick={startHunt}>
        {running ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
        {running ? (hunt.status === 'queued' ? 'Hledání čeká ve frontě…' : 'Hledám podle profilu…') : 'Spustit hledání teď'}
      </button>
      {running && <button type="button" onClick={stopHunt} disabled={stopping || hunt.status === 'stopping'} className="button-secondary border-red-300 text-red-700 hover:bg-red-50">
        <Square className="h-4 w-4" aria-hidden="true" />{stopping || hunt.status === 'stopping' ? 'Zastavuji…' : 'Zastavit hledání'}
      </button>}
      {!cloud && <label className="flex items-center gap-2 text-xs text-muted-foreground">Nabídek na portál
        <select aria-label="Počet nabídek na portál" value={limit} onChange={event => setLimit(event.target.value)} disabled={busy || running || building} className="rounded-xl border border-viatix-line bg-transparent px-3 py-2 text-sm">{[5, 10, 15, 30].map(value => <option key={value} value={value}>{value}</option>)}</select>
      </label>}
      {!profile && !busy && <button type="button" className="button-secondary" onClick={() => window.location.reload()}>Načíst znovu</button>}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{cloud ? 'Ruční hledání používá uložené nastavení. Obnovení nabídek pouze načte výsledky.' : 'Místní hledání běží na tomto počítači. Automatiku nastav v online aplikaci.'}</p>
    <details className="mt-4 rounded-2xl border border-viatix-line/60 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-viatix-teal">Šablony a návod pro nový profil</summary>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p><strong className="text-foreground">Doporučujeme Markdown (.md).</strong> Obsahuje preference v JSON a prostor pro profesní shrnutí, zkušenosti a projekty. Samostatný .json slouží pro strukturované preference.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Stáhni šablonu a nahraď ukázkové role, dovednosti, lokalitu i mzdy vlastními údaji.</li>
          <li>Zachovej názvy polí. V Markdownu ponech jeden JSON blok a doplň profesní kontext pod ním.</li>
          <li>Ulož jako UTF-8 a nahraj přes „Nahrát jiný profil“. Zkontroluj načtené údaje a spusť hledání.</li>
        </ol>
        <p className="text-xs">Šablony obsahují smyšlené ukázkové údaje. Maximální velikost je 250 kB. DOCX, PDF a TXT zatím nelze přímo nahrát.</p>
        <div className="flex flex-wrap gap-2">
          <a className="button-secondary" download href={import.meta.env.BASE_URL + 'templates/candidate-profile-template.md'}>Šablona Markdown (.md)</a>
          <a className="button-secondary" download href={import.meta.env.BASE_URL + 'templates/candidate-profile-template.json'}>Šablona JSON (.json)</a>
          <a className="button-secondary" download href={import.meta.env.BASE_URL + 'templates/profile-guide.md'}>Podrobný návod</a>
        </div>
      </div>
    </details>
    {notice && <p role="status" className="mt-3 text-sm text-viatix-teal">{notice}</p>}
    {running && <p role="status" className="mt-3 text-sm text-viatix-teal">{hunt.status === 'stopping' ? 'Ukončuji hledání a další AI hodnocení…' : hunt.status === 'queued' ? 'Hledání je připravené pro pracovníka. Stránku můžeš zavřít.' : 'Procházím cílové role a hodnotím nabídky. Hledání může trvat několik minut.'}</p>}
    {hunt.status === 'cancelled' && <p role="status" className="mt-3 text-sm text-viatix-teal">Hledání bylo zastaveno. Již uložené nabídky zůstávají v historii. Rozpracovaná neuložená hodnocení se zahodila.</p>}
    {running && <p className="mt-2 text-xs text-muted-foreground">Zastavení ukončí běžící proces. Požadavek již odeslaný AI poskytovateli může být účtován i po zastavení.</p>}
    {['done', 'partial'].includes(hunt.status) && <div role="status" className="mt-3 text-sm"><p>{hunt.result.evaluationBlocked ? 'Sběr nabídek dokončen, AI hodnocení bylo zastaveno.' : 'Hledání dokončeno.'} Nalezeno: {hunt.result.found}, vyhodnoceno: {hunt.result.evaluated}, uloženo: {hunt.result.saved}. Přeskočeno již uložených: {hunt.result.skippedDuplicates ?? 0}.</p>{hunt.result.sources?.map(source => <p key={source.portal} className="mt-1 text-xs text-muted-foreground">{source.portal}: {source.status === 'error' ? 'zdroj se nepodařilo načíst' : `${source.found} nových nabídek`}{source.scanLimitReached ? ' · dosažen limit procházení' : ''}</p>)}<p className="mt-1 text-xs text-muted-foreground">Mimo období: {hunt.result.skippedOutsidePeriod ?? 0} · Bez ověřitelného data: {hunt.result.skippedUnknownDate ?? 0}</p>{hunt.result.errors.map((message, index) => <p key={index} className="mt-1 text-amber-800">{message}</p>)}</div>}
    {(error || hunt.status === 'error') && <p role="alert" className="mt-3 text-sm text-red-700">{error || hunt.error}</p>}
    {cloud && hunt.result?.evaluationLimitReached && <p role="status" className="mt-3 text-xs text-amber-800">Dosažen nastavený limit AI hodnocení pro tento běh. Další nabídky zůstávají pro příští hledání.</p>}
    {cloud && hunt.status === 'blocked' && <p role="alert" className="mt-3 text-sm text-amber-800">{hunt.result?.evaluationBlocked?.message || 'AI hodnocení bylo zastaveno. Zkontroluj API kvótu.'}</p>}
    {cloud && hunt.runs?.length > 0 && <details className="mt-5 border-t border-viatix-line/60 pt-4"><summary className="cursor-pointer text-sm font-medium text-viatix-teal">Historie spuštění</summary><ul className="mt-3 space-y-3">{hunt.runs.map(run => <li key={run.id} className="rounded-xl bg-white/40 p-3 text-xs leading-relaxed"><p>{displayTime(run.startedAt)} · {run.source === 'scheduled' ? 'Automaticky' : 'Ručně'} · {{ queued: 'Ve frontě', running: 'Probíhá', stopping: 'Zastavuje se', cancelled: 'Zastaveno', done: 'Dokončeno', partial: 'Částečně dokončeno', blocked: 'AI limit', error: 'Chyba' }[run.status] || run.status}</p>{run.result && <p className="mt-1 text-muted-foreground">Nalezeno {run.result.found} · Vyhodnoceno {run.result.evaluated} · Uloženo {run.result.saved}</p>}{run.error && <p className="mt-1 text-red-700">{run.error}</p>}</li>)}</ul></details>}
  </section>;
}
