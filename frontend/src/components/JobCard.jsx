import { ArrowUpRight, Building2, CalendarDays, ChevronDown, Check, AlertCircle, X } from 'lucide-react';
import { VERDICTS, formatDate, getOfferSources, safeOfferUrl } from '../lib/jobs.js';

export default function JobCard({ job }) {
  const { offer, evaluation } = job;
  const badge = VERDICTS[evaluation.verdict];
  const href = safeOfferUrl(offer.url);
  const sources = getOfferSources(offer);
  const salary = typeof offer.salary_raw === 'string' ? offer.salary_raw.trim() : '';
  const ReasonIcon = evaluation.verdict === 'NO_GO' ? X : Check;
  return (
    <article className="job-card">
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold ' + badge.color}>
            <span className={'h-1.5 w-1.5 rounded-full ' + badge.dot} aria-hidden="true" />{badge.label}
          </span>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            {salary && <span className="max-w-full break-words rounded-full border border-viatix-mint/20 bg-viatix-mint/10 px-2.5 py-1 text-[10px] font-medium leading-relaxed text-viatix-teal" aria-label={'Mzda: ' + salary}>{salary}</span>}
            <span className="shrink-0 text-sm font-semibold tabular-nums text-viatix-teal" aria-label={'Skóre shody ' + evaluation.score + ' ze 100'}>
              {evaluation.score}<span className="ml-1 text-xs font-normal text-muted-foreground">/ 100</span>
            </span>
          </div>
        </div>
        <div>
          <h2 className="break-words font-display text-lg font-semibold leading-snug text-foreground">{offer.title}</h2>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"><Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{offer.company}</p>
          {!job.demo && sources.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Zdroje nabídky">
            {sources.map(source => <li key={source.portal} className="min-w-0 max-w-full">
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-full border border-viatix-line/60 px-2.5 py-1 text-[10px] font-medium text-viatix-teal transition-colors hover:border-viatix-teal/30 hover:bg-viatix-teal/5" aria-label={'Otevřít inzerát na ' + source.portal + ': ' + offer.title}>
                <span className="break-words">{source.portal}</span><ArrowUpRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
              </a>
            </li>)}
          </ul>}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-viatix-line/50" aria-hidden="true">
          <div className={'h-full rounded-full ' + badge.dot} style={{ width: evaluation.score + '%' }} />
        </div>
        <ul className="space-y-2.5 text-sm leading-relaxed text-foreground/80">
          {evaluation.fit_reasons.map((reason, i) => <li key={i} className="flex gap-2"><ReasonIcon className={'mt-1 h-3.5 w-3.5 shrink-0 ' + (evaluation.verdict === 'NO_GO' ? 'text-rose-700' : 'text-viatix-teal')} aria-hidden="true" /><span>{reason}</span></li>)}
        </ul>
        {evaluation.gap_analysis.length > 0 && <div className="rounded-xl bg-viatix-amber/10 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#9a4b12]"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />Co ověřit / kde je mezera</p>
          <ul className="space-y-1.5 text-xs leading-relaxed text-foreground/80">{evaluation.gap_analysis.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
        </div>}
        <details className="mt-auto border-t border-border/30 pt-3 text-xs">
          <summary className="flex cursor-pointer items-center justify-between font-medium text-viatix-teal">Podrobnosti hodnocení<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></summary>
          <div className="mt-3 space-y-3 leading-relaxed text-muted-foreground">
            <p>Zveřejněno: {formatDate(offer.published_at)}</p>
            <p className="whitespace-pre-wrap break-words">{offer.raw_description}</p>
            {evaluation.tailored_cv_highlights.length > 0 && <div><p className="mb-2 font-semibold text-foreground">Vybrané podklady do CV</p><ul className="list-disc space-y-1 pl-4">{evaluation.tailored_cv_highlights.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
          </div>
        </details>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/30 px-4 py-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{formatDate(job.evaluatedAt)}</span>
        {job.demo ? <span>Smyšlená ukázka</span> : href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-viatix-teal transition-colors hover:bg-viatix-teal/10" aria-label={'Otevřít inzerát: ' + offer.title}>Otevřít inzerát<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></a>}
      </footer>
    </article>
  );
}
