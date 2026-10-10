import { useState } from 'react';
import { ArrowUpRight, Bookmark, Check, EyeOff, MapPin, ChevronRight, Star } from 'lucide-react';
import { normalizeJobState } from '../lib/jobState.js';
import { VERDICTS, safeOfferUrl } from '../lib/jobs.js';
export default function JobCard({ job, onStateChange, actionsDisabled = false, onDetail, selectionMode = false, selected = false, onToggleSelect }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { offer, evaluation } = job;
  const state = normalizeJobState(job.state);
  const badge = evaluation ? VERDICTS[evaluation.verdict] : null;
  const href = safeOfferUrl(offer.url);
  async function change(key) {
    setSaving(true); setError('');
    try { await onStateChange(job, key, !state[key]); }
    catch (failure) { setError(failure.message || 'Změnu se nepodařilo uložit. Zkus to znovu.'); }
    finally { setSaving(false); }
  }
  return <article className="job-card">
    <div className="flex flex-1 flex-col p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {selectionMode && <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm font-medium text-brand hover:bg-surface-subtle">
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect?.(job.id)} aria-label={'Vybrat nabídku ' + offer.title + ' — ' + offer.company} className="h-4 w-4 accent-brand" />
          <span>Vybrat</span>
        </label>}
        <span className={'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium ' + (job.evaluationStale ? 'bg-surface-subtle text-ink-secondary' : badge?.color || 'bg-surface-subtle text-ink-secondary')}>
          {job.evaluationStale ? 'Hodnocení čeká na obnovení' : evaluation ? `${badge?.label || 'Shoda s profilem'} · ${evaluation.score} %` : 'Zatím bez hodnocení'}
        </span>
        {state.applied && <span className="inline-flex items-center gap-1 text-xs text-brand"><Check className="h-3.5 w-3.5" />Reakce odeslána</span>}
      </div>
      <h2 className="font-display text-lg font-semibold leading-snug">
        {onDetail && !job.demo ? <button type="button" onClick={() => onDetail(job.id)} className="text-left hover:text-brand">{offer.title}</button> : offer.title}
      </h2>
      <p className="mt-2 text-sm text-ink-secondary">{offer.company}</p>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-secondary"><MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />{offer.location || 'Lokalitu je potřeba ověřit'}</p>
      {(offer.salary_raw?.trim() || offer.location?.trim()) && <p className="mt-4 text-sm font-medium text-ink">{[offer.location?.trim(), offer.salary_raw?.trim()].filter(Boolean).join(' · ')}</p>}
      <div className="my-5 flex-1 border-t border-border-subtle pt-4">
        <p className="line-clamp-2 text-sm leading-relaxed text-ink-secondary">{evaluation?.fit_reasons?.[0] || 'Prohlédni si nabídku a rozhodni, jestli stojí za další krok.'}</p>
        {evaluation?.gap_analysis?.[0] && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-secondary"><span className="font-medium text-fit-potential-text">K ověření: </span>{evaluation.gap_analysis[0]}</p>}
      </div>
      {!job.demo && <div className="flex items-center justify-between gap-2">
        {onDetail ? <button type="button" className="button-primary min-h-11 px-4" onClick={() => onDetail(job.id)}>Detail nabídky<ChevronRight className="h-4 w-4" aria-hidden="true" /></button> : href ? <a className="button-primary min-h-11" href={href} target="_blank" rel="noopener noreferrer">Otevřít inzerát<ArrowUpRight className="h-4 w-4" /></a> : null}
        {onStateChange && <button type="button" disabled={saving || actionsDisabled} aria-pressed={state.saved} aria-label={state.saved ? 'Zrušit uložení nabídky' : 'Uložit nabídku'} onClick={() => change('saved')} className={'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl transition-colors ' + (state.saved ? 'bg-surface-subtle text-brand' : 'text-ink-secondary hover:bg-surface-subtle')}><Bookmark className="h-5 w-5" aria-hidden="true" /><span className="sr-only">{state.saved ? 'Uloženo' : 'Uložit'}</span></button>}
        {onStateChange && <details className="relative"><summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-xl text-lg text-ink-secondary hover:bg-surface-subtle" aria-label="Další možnosti nabídky">···</summary><div className="absolute bottom-full right-0 z-10 mb-2 w-48 rounded-xl border border-border-subtle bg-surface p-2 shadow-popover"><button type="button" disabled={saving || actionsDisabled} onClick={() => change('priority')} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-subtle"><Star className="h-4 w-4" />{state.priority ? 'Odebrat prioritu' : 'Moje priorita'}</button><button type="button" disabled={saving || actionsDisabled} onClick={() => change('hidden')} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-subtle"><EyeOff className="h-4 w-4" />{state.hidden ? 'Zobrazit znovu' : 'Skrýt'}</button></div></details>}
      </div>}
      {job.demo && <span className="text-xs text-ink-secondary">Smyšlená ukázka</span>}
      {saving && <p role="status" className="mt-3 text-xs text-ink-secondary">Ukládám změnu…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  </article>;
}
