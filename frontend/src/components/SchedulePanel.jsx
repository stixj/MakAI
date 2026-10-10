import { readDraft, writeDraft, clearDraft, useUnsavedWarning } from '../hooks/useDraft.js';
import { useEffect, useState } from 'react';
import { CalendarClock, Plus, X } from 'lucide-react';
import { PORTALS, validateSchedule } from '../lib/schedule.js';
import { scheduleHealth } from '../lib/scheduleHealth.js';
import { profileApi } from '../lib/profileApi.js';
import SelectMenu from './SelectMenu.jsx';

const days = [[1, 'Po'], [2, 'Út'], [3, 'St'], [4, 'Čt'], [5, 'Pá'], [6, 'So'], [0, 'Ne']];
const input = 'mt-2 w-full rounded-xl border border-border-subtle bg-surface px-3 py-2.5 text-sm';
export const displayTime = (value, timezone = 'Europe/Prague') => value
  ? new Intl.DateTimeFormat('cs-CZ', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

export default function SchedulePanel({ hasProfile, profileUpdated = false, onDirtyChange, onSearch, searchDisabled = false, draftKey = 'schedule' }) {
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const [saved, setSaved] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  async function load() {
    try { const schedule = await profileApi('/api/schedule'); const restored=readDraft(draftKey); setSaved(schedule); setDraft(restored || schedule); setDirty(!!restored && JSON.stringify(restored)!==JSON.stringify(schedule)); setError(''); }
    catch (failure) { setError(failure.message); }
  }
  useEffect(() => { load(); }, [hasProfile]);
  useEffect(() => {
    const timer = setInterval(async () => {
      setCheckedAt(Date.now());
      if (busy) return;
      try { const schedule = await profileApi('/api/schedule'); setSaved(schedule); if (!dirty) setDraft(schedule); } catch {}
    }, 30000);
    return () => clearInterval(timer);
  }, [dirty, busy]);
  useUnsavedWarning(dirty);
  function change(key, value) { setDraft(previous => { const next={...previous,[key]:value};writeDraft(draftKey,next);return next; }); setDirty(true); setNotice(''); }
  async function save(event, search = false) {
    event.preventDefault(); setError(''); setNotice('');
    try { validateSchedule(draft); } catch (failure) { setError(failure.message); return; }
    setBusy(true);
    try {
      const schedule = await profileApi('/api/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      setSaved(schedule); setDraft(schedule); setDirty(false); clearDraft(draftKey);
      if (search) await onSearch?.(schedule);
      setNotice(schedule.enabled ? 'Automatické hledání je zapnuté. Plán byl uložen.' : 'Plán byl uložen. Automatika je vypnutá; ruční hledání zůstává dostupné.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const health = scheduleHealth(saved, { profileUpdated, now: checkedAt });
  return <div className="mt-3">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-3">
      <div role="status" className="min-w-0 text-sm">
        <p className={health.warning ? 'font-medium text-fit-potential-text' : 'font-medium text-brand'}>{error && !saved ? 'Stav automatiky se nepodařilo načíst' : health.label}</p>
        {saved?.enabled && <p className="mt-1 text-xs text-ink-secondary">Další hledání přibližně: {displayTime(saved.nextAt, saved.timezone)}</p>}
        {saved?.enabled && <p className="mt-1 text-xs text-ink-secondary">Poslední kontrola: {displayTime(saved.workerSeenAt, saved.timezone)}</p>}
        {health.warning && <p className="mt-1 text-xs text-fit-potential-text">Plán je uložený, ale spuštění není potvrzené. Zkontroluj připojení plánovače.</p>}
      </div>
      {saved && profileUpdated && !saved.enabled && <button type="button" className="button-secondary" onClick={() => setExpanded(true)}>Zkontrolovat plán a zapnout</button>}
    </div>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="mt-3">
    <summary className="cursor-pointer py-1 text-sm font-medium text-brand">Nastavení hledání a automatizace</summary>
    <section aria-labelledby="schedule-title" className="mt-3 rounded-xl border border-border-subtle bg-surface p-4">
    <div className="flex items-center gap-3"><CalendarClock className="h-5 w-5 text-brand" aria-hidden="true" /><h3 id="schedule-title" className="font-display text-lg font-semibold">Automatické hledání</h3></div>
    <p className="mt-2 text-sm text-ink-secondary">Hledání začíná na portálech v Brně a okolí do 10 km; plný úvazek se zapne tam, kde portál filtr nabízí. Nové nabídky z posledních 24 hodin pak posoudí MakAI podle tvého profilu.</p>
    {!draft ? <div className="mt-4"><p role="status" className="text-sm">{error ? 'Nastavení se nepodařilo načíst.' : 'Načítám plán…'}</p>{error && <button className="button-secondary mt-3" onClick={load}>Načíst znovu</button>}</div> : <form onSubmit={event => save(event)}>
      <fieldset disabled={busy} className="mt-5 space-y-5">
        <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" checked={draft.enabled} disabled={!hasProfile} onChange={event => change('enabled', event.target.checked)} className="h-5 w-5 accent-brand" />Zapnout automatické hledání</label>
        {!hasProfile && <p className="text-xs text-ink-secondary">Nejdřív vytvoř nebo nahraj profil.</p>}
        <div><p className="mb-2 text-sm font-medium">Ve které dny</p><div className="flex flex-wrap gap-2">{days.map(([day, label]) => <label key={day} className={'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ' + (draft.days.includes(day) ? 'border-brand bg-surface-subtle' : 'border-border-subtle')}><input type="checkbox" checked={draft.days.includes(day)} onChange={event => change('days', event.target.checked ? [...draft.days, day] : draft.days.filter(item => item !== day))} className="accent-brand" />{label}</label>)}</div></div>
        <div><p className="mb-2 text-sm font-medium">Časy spuštění · {draft.times.length}× za vybraný den</p><div className="flex flex-wrap items-center gap-3">{draft.times.map((time, index) => <div key={index} className="flex items-center gap-1"><SelectMenu ariaLabel={'Čas spuštění ' + (index + 1)} value={time} disabled={busy} onChange={value=>change('times',draft.times.map((item,i)=>i===index?value:item))} containerClassName="w-28 shrink-0" options={Array.from({length:96},(_,i)=>{const value=`${String(Math.floor(i/4)).padStart(2,'0')}:${String((i%4)*15).padStart(2,'0')}`;return {value,label:value};})} /><button type="button" aria-label={'Odebrat čas ' + time} disabled={busy || draft.times.length === 1} onClick={() => change('times', draft.times.filter((_, i) => i !== index))} className="rounded-lg p-2 text-ink-secondary"><X className="h-4 w-4" /></button></div>)}<button type="button" disabled={busy || draft.times.length >= 6} className="button-secondary" onClick={() => change('times', [...draft.times, Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`).find(value => !draft.times.includes(value)) || '12:00'])}><Plus className="h-4 w-4" />Přidat čas</button></div>

          <p className="mt-2 text-xs leading-relaxed text-ink-secondary">Plán se kontroluje přibližně každých 15 minut. Při vytížení může spuštění přijít později. Zmeškané časy se nesčítají do série hledání.</p>
        </div>
        <div><p className="mb-2 text-sm font-medium">Kde hledat</p><div className="grid gap-2 sm:grid-cols-2">{Object.entries(PORTALS).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.portals.includes(key)} onChange={event => change('portals', event.target.checked ? [...draft.portals, key] : draft.portals.filter(item => item !== key))} className="accent-brand" />{label}</label>)}</div></div>
        <div className="block text-sm"><span className="mb-1 block">Stáří inzerátů</span><SelectMenu ariaLabel="Stáří inzerátů" value={draft.period} disabled={busy} onChange={value=>change('period',value)} className={input} options={[{value:'24h',label:'Posledních 24 hodin'},{value:'7d',label:'Posledních 7 dní'},{value:'30d',label:'Posledních 30 dní'},{value:'all',label:'Bez omezení'}]} /></div>
        <p className="text-xs text-ink-secondary">Stáří podle zveřejnění na portálu, nikoli data hodnocení v MakAI.</p>
        <details className="rounded-xl border border-border-subtle p-3">
          <summary className="cursor-pointer py-1 text-sm font-medium text-brand">Pokročilé nastavení a limity</summary>
          <div className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm">Nových nabídek na portál<input type="number" min="1" max="100" value={draft.limit} onChange={event => change('limit', Number(event.target.value))} className={input} /></label>
          <label className="text-sm">Nejvýše AI hodnocení za běh<input type="number" min="1" max="100" value={draft.maxEvaluations} onChange={event => change('maxEvaluations', Number(event.target.value))} className={input} /></label>
          <label className="text-sm">Nejvýše spuštění za den<input type="number" min="1" max="24" value={draft.maxDailyRuns} onChange={event => change('maxDailyRuns', Number(event.target.value))} className={input} /></label>
        </div>
        <p className="text-xs leading-relaxed text-ink-secondary">Denní limit zahrnuje automatická i ruční hledání. Jedno hledání projde nejvýše 100 nových nabídek z každého portálu a odešle až 100 nabídek k AI hodnocení. Uložené nabídky se znovu nehodnotí; neověřitelná data zveřejnění se při výchozím nastavení ponechají.</p>
          <div className="mt-3 block text-xs"><span className="mb-1 block">Časové pásmo</span><SelectMenu ariaLabel="Časové pásmo" value={draft.timezone} disabled={busy} onChange={value=>change('timezone',value)} containerClassName="sm:max-w-sm" options={[{value:'Europe/Prague',label:'Český čas (letní i zimní)'},{value:'UTC',label:'UTC'}]} /></div>
        {draft.period !== 'all' && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={draft.includeUnknownDates} onChange={event => change('includeUnknownDates', event.target.checked)} className="mt-0.5 accent-brand" />Zahrnout i inzeráty bez ověřitelného data zveřejnění</label>}
          </div>
        </details>
        <div className="flex flex-wrap gap-3"><button type="submit" className="button-primary" disabled={!dirty}>{busy ? 'Ukládám…' : 'Uložit nastavení'}</button>{onSearch && <button type="button" className="button-secondary" disabled={busy || searchDisabled} onClick={event => save(event,true)}>{dirty ? 'Uložit a hledat' : 'Hledat podle nastavení'}</button>}{dirty && <button type="button" className="button-secondary" onClick={() => { setDraft(saved); clearDraft(draftKey); setDirty(false); setError(''); }}>Zahodit úpravy</button>}</div>
      </fieldset>
      {dirty && <p className="mt-3 text-xs text-fit-potential-text">Máš neuložené změny. Ruční hledání používá poslední uložené nastavení.</p>}

    </form>}
    </section></details>
    {notice && <p role="status" className="mt-3 text-sm text-brand">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </div>;
}
