import { useState } from 'react';
import { ArrowUpRight, Bookmark, Check, EyeOff, MapPin, ChevronRight, Star } from 'lucide-react';
import { normalizeJobState } from '../lib/jobState.js';
import { VERDICTS, safeOfferUrl } from '../lib/jobs.js';
export default function JobCard({ job, onStateChange, actionsDisabled = false, onDetail }) {
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
        <span className={'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ' + (job.evaluationStale ? 'bg-viatix-line/40 text-muted-foreground' : badge?.color || 'bg-viatix-line/30 text-muted-foreground')}>
          {job.evaluationStale ? 'Hodnocení před změnou' : badge?.label || 'Zatím bez hodnocení'}
          {evaluation && !job.evaluationStale && <span className="opacity-70">{evaluation.score}/100</span>}
        </span>
        {onStateChange && !job.demo && <button type="button" disabled={saving||actionsDisabled} aria-label={state.priority?'Zrušit osobní prioritu':'Označit jako osobní prioritu'} aria-pressed={state.priority} onClick={()=>change('priority')} className={'inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs '+(state.priority?'font-semibold text-viatix-teal':'text-muted-foreground')}><Star className="h-4 w-4" fill={state.priority?'currentColor':'none'} aria-hidden="true" />{state.priority?'Moje priorita':'Priorita'}</button>}
        {state.applied && <span className="inline-flex items-center gap-1 text-xs text-viatix-teal"><Check className="h-3.5 w-3.5" />Reakce odeslána</span>}
      </div>
      <h2 className="font-display text-lg font-semibold leading-snug">
        {onDetail && !job.demo ? <button type="button" onClick={() => onDetail(job.id)} className="text-left hover:text-viatix-teal">{offer.title}</button> : offer.title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{offer.company}</p>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />{offer.location || 'Lokalitu je potřeba ověřit'}</p>
      <p className="mt-4 text-sm font-semibold text-viatix-ink">{offer.salary_raw?.trim() || 'Mzda není uvedená'}</p>
      <div className="my-5 flex-1 border-t border-viatix-line/60 pt-4">
        <p className="line-clamp-2 text-sm leading-relaxed text-foreground/80">{evaluation?.fit_reasons?.[0] || 'Prohlédni si nabídku a rozhodni, jestli stojí za další krok.'}</p>
        {evaluation?.gap_analysis?.[0] && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-[#9a4b12]">K ověření: </span>{evaluation.gap_analysis[0]}</p>}
      </div>
      {!job.demo && <div className="flex items-center justify-between gap-2">
        {onDetail ? <button type="button" className="button-primary px-4" onClick={() => onDetail(job.id)}>Prohlédnout<ChevronRight className="h-4 w-4" aria-hidden="true" /></button> : href && <a className="button-primary" href={href} target="_blank" rel="noopener noreferrer">Otevřít inzerát<ArrowUpRight className="h-4 w-4" /></a>}
        {onStateChange && <button type="button" disabled={saving || actionsDisabled} aria-pressed={state.saved} aria-label={state.saved ? 'Zrušit uložení nabídky' : 'Uložit nabídku'} onClick={() => change('saved')} className={'inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm ' + (state.saved ? 'bg-viatix-teal/10 text-viatix-teal' : 'text-muted-foreground hover:bg-viatix-teal/5')}><Bookmark className="h-4 w-4" aria-hidden="true" />{state.saved ? 'Uloženo' : 'Uložit'}</button>}
        {onStateChange && <details className="relative"><summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-xl text-lg text-muted-foreground hover:bg-viatix-teal/5" aria-label="Další možnosti nabídky">···</summary><div className="absolute bottom-full right-0 z-10 mb-2 w-44 rounded-xl border border-viatix-line bg-viatix-sand2 p-2 shadow-card"><button type="button" disabled={saving || actionsDisabled} onClick={() => change('hidden')} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-viatix-teal/5"><EyeOff className="h-4 w-4" />{state.hidden ? 'Zobrazit znovu' : 'Skrýt'}</button></div></details>}
      </div>}
      {job.demo && <span className="text-xs text-muted-foreground">Smyšlená ukázka</span>}
      {saving && <p role="status" className="mt-3 text-xs text-muted-foreground">Ukládám změnu…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  </article>;
}
