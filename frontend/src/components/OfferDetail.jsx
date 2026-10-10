import OfferInterest from './OfferInterest.jsx';
import OfferText from './OfferText.jsx';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bookmark, Check, EyeOff, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { profileApi } from '../lib/profileApi.js';
import { VERDICTS, formatDate, safeOfferUrl, getOfferSources } from '../lib/jobs.js';
import { normalizeJobState } from '../lib/jobState.js';
import OfferEditor from './OfferEditor.jsx';

const monthlySalary = value => Number.isInteger(value) ? new Intl.NumberFormat('cs-CZ').format(value) + ' Kč / měsíc hrubého' : null;

export default function OfferDetail({ profileId, offerId, onClose, onStateChange, onApplication, onChanged, reloadKey }) {
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false), [deleting, setDeleting] = useState(false), [evaluating, setEvaluating] = useState(false);

  useEffect(() => {
    let active = true;
    setError('');
    profileApi('/api/applications?offerId=' + encodeURIComponent(offerId)).then(result => { if (active) { setDetail(result); if (result.evaluation && !result.evaluationStale) setEvaluating(false); } }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [profileId, offerId, reloadKey]);

  useEffect(() => {
    if (!evaluating) return;
    let active = true;
    const poll = async () => {
      try {
        const current = await profileApi('/api/applications?offerId=' + encodeURIComponent(offerId));
        if (active && current.evaluation && !current.evaluationStale) { setDetail(current); setEvaluating(false); setNotice('Hodnocení je hotové.'); }
      } catch (failure) { if (active) setError(failure.message); }
    };
    const timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [profileId, offerId, evaluating]);

  const state = normalizeJobState(detail?.state);
  async function change(key) {
    setBusy(true); setError('');
    try {
      const next = await onStateChange({ id: offerId, state }, key, !state[key]);
      setDetail(previous => ({ ...previous, state: next || { ...state, [key]: !state[key] } }));
      if (key === 'applied' && !state.applied) onApplication(offerId);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function evaluate() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await profileApi('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'evaluate', profileId, offerId }) });
      setEvaluating(true); setNotice(result.notice || 'Hodnocení čeká na spuštění. Výsledek se objeví tady.'); onChanged();
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function removeOffer() {
    setDeleting(true); setError('');
    try { await profileApi('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', profileId, offerId }) }); onChanged(); onClose(); }
    catch (failure) { setError(failure.message); setDeleting(false); }
  }

  const evaluation = detail?.evaluation;
  const verdict = evaluation ? VERDICTS[evaluation.verdict] : null;
  const needsEvaluation = !evaluation || detail?.evaluationStale;
  const sources = detail ? getOfferSources(detail.offer) : [];

  return <section className="mt-6" aria-label="Detail nabídky">
    <button type="button" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-viatix-teal transition-colors hover:bg-viatix-teal/5" onClick={onClose}><ArrowLeft className="h-4 w-4" />Zpět na nabídky</button>
    {!detail && !error && <p role="status" className="rounded-2xl border border-viatix-line bg-viatix-sand2 p-5 text-sm text-muted-foreground">Načítám nabídku…</p>}
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {detail && <div className="mx-auto max-w-4xl rounded-3xl border border-viatix-line/70 bg-viatix-sand2 p-5 sm:p-8">
      <header>
        <p className="text-sm font-medium text-muted-foreground">{detail.offer.company}</p>
        <h1 className="mt-2 font-display text-2xl font-semibold leading-tight sm:text-3xl">{detail.offer.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{[detail.offer.location || 'Lokalita neuvedena', detail.offer.salary_raw || 'Mzda neuvedena'].join(' · ')}</p>
        {detail.manual && <p role="status" className="mt-4 rounded-xl border border-viatix-teal/20 bg-viatix-teal/5 px-4 py-3 text-sm leading-relaxed text-viatix-teal">Nabídka je uložená v „Přidáno mnou“{evaluation ? ' a má AI hodnocení.' : ' a zatím nemá AI hodnocení.'}</p>}
      </header>

      <div className="mt-6 rounded-2xl border border-viatix-line bg-white p-5 sm:p-6">
        {evaluation ? <>
          <div className="flex flex-wrap items-center gap-3"><span className={'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ' + (verdict?.color || 'bg-viatix-teal/10 text-viatix-teal')}>{detail.evaluationStale ? 'Hodnocení je zastaralé' : verdict?.label}</span><p className="font-display text-2xl font-semibold tracking-tight text-viatix-ink sm:text-3xl">{evaluation.score} / 100</p></div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Skóre porovnává nabídku s tvým profilem. Pomáhá posoudit vhodnost práce; nevyjadřuje pravděpodobnost přijetí.</p>
          {detail.evaluationStale && <p className="mt-4 rounded-xl bg-viatix-amber/15 p-3 text-sm leading-relaxed">Profil nebo nabídka se změnily. Nové hodnocení bude vycházet z aktuálních údajů.</p>}
        </> : <>
          <h2 className="font-display text-xl font-semibold">Zatím bez hodnocení shody</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Porovnáme požadavky nabídky s tvým profilem a ukážeme, co stojí za pozornost.</p>
        </>}
        {needsEvaluation && <div className="mt-5"><button type="button" disabled={busy || evaluating || !detail.offer.raw_description?.trim()} onClick={evaluate} className="button-primary min-h-11 w-full sm:w-auto">{evaluating || busy ? <><Loader2 className="h-4 w-4 animate-spin" />{evaluating ? 'Hodnocení připravujeme…' : 'Odesílám k hodnocení…'}</> : <><Sparkles className="h-4 w-4" />{evaluation ? 'Znovu vyhodnotit s AI' : 'Spustit AI evaluaci'}</>}</button>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">AI hodnocení může využívat placené API. {!detail.offer.raw_description?.trim() && 'Nejdřív doplň text inzerátu v části Další možnosti.'}</p></div>}
        {notice && <p role="status" className="mt-4 text-sm text-viatix-teal">{notice}</p>}
      </div>

      {!needsEvaluation && <div className="mt-4 rounded-2xl border border-viatix-line bg-white p-4">
        {state.applied ? <button type="button" className="button-primary min-h-11 w-full sm:w-auto" onClick={() => onApplication(offerId)}>Otevřít přihlášku</button> : <button type="button" disabled={busy} className="button-primary min-h-11 w-full sm:w-auto" onClick={() => change('applied')}><Check className="h-4 w-4" />Označit jako odeslanou přihlášku</button>}
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Přihlášku odešleš na stránce zaměstnavatele. Tady si její odeslání pouze zaznamenáš.</p>
      </div>}
      {needsEvaluation && state.applied && <button type="button" className="button-secondary mt-3 min-h-11 w-full sm:w-auto" onClick={() => onApplication(offerId)}>Otevřít přihlášku</button>}

      <div className="mt-6 flex flex-wrap gap-2">
        {safeOfferUrl(detail.offer.url) && <a className="button-secondary min-h-11" href={detail.offer.url} target="_blank" rel="noopener noreferrer">Otevřít původní inzerát<ArrowUpRight className="h-4 w-4" /></a>}
        <button type="button" disabled={busy} aria-pressed={state.saved} className="button-secondary min-h-11" onClick={() => change('saved')}><Bookmark className="h-4 w-4" />{state.saved ? 'Uloženo' : 'Uložit nabídku'}</button>
        <button type="button" disabled={busy} aria-pressed={state.priority} className="button-secondary min-h-11" onClick={() => change('priority')}>{state.priority ? 'Odebrat prioritu' : 'Moje priorita'}</button>
      </div>
      <OfferInterest profileId={profileId} offerId={offerId} interest={detail.interest} onSaved={interest => { setDetail(previous => ({ ...previous, interest, state: { ...previous.state, priority: interest.priority } })); onChanged(); }} />

      {evaluation && <div className="mt-8 space-y-7">
        <section aria-labelledby="fit-title"><h2 id="fit-title" className="font-display text-xl font-semibold">Proč se nabídka hodí</h2><ul className="mt-3 space-y-3 text-sm leading-relaxed">{evaluation.fit_reasons.slice(0, 3).map((reason, index) => <li key={index} className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-viatix-teal" aria-hidden="true" /><span>{reason}</span></li>)}</ul></section>
        {!!evaluation.gap_analysis.length && <section aria-labelledby="questions-title" className="rounded-2xl bg-viatix-amber/10 p-5"><h2 id="questions-title" className="font-display text-lg font-semibold">Co ověřit na pohovoru</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Tato témata ti pomohou získat před rozhodnutím jasnější odpovědi.</p><ul className="mt-3 space-y-3 text-sm leading-relaxed">{evaluation.gap_analysis.map((gap, index) => <li key={index} className="flex gap-3"><span className="font-semibold text-[#9a4b12]">{index + 1}.</span><span>{gap}</span></li>)}</ul></section>}
        <section aria-labelledby="salary-title" className="rounded-2xl border border-viatix-line bg-white p-5"><h2 id="salary-title" className="font-display text-lg font-semibold">Mzda a podmínky</h2><p className="mt-3 text-sm leading-relaxed">{evaluation.salary_assessment === 'ODPOVÍDÁ' ? 'Uvedená mzda odpovídá nastavenému běžnému minimu.' : evaluation.salary_assessment === 'POD_LIMITEM' ? 'Uvedená mzda je pod běžným minimem v profilu.' : evaluation.salary_stated ? 'Mzda je v inzerátu uvedená, ale nelze ji spolehlivě převést na měsíční hrubou částku v Kč.' : 'Inzerát mzdu neuvádí.'}</p>
          {(evaluation.salary_min_czk != null || evaluation.salary_max_czk != null) && <p className="mt-2 text-sm font-semibold text-viatix-ink">{monthlySalary(evaluation.salary_min_czk) || 'Částka neuvedena'}{evaluation.salary_max_czk != null ? ' až ' + monthlySalary(evaluation.salary_max_czk) : ''}</p>}
          {detail.application?.salaryExpectation && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Tvoje očekávání sdělené firmě: <span className="font-medium text-viatix-ink">{detail.application.salaryExpectation}</span></p>}
          {detail.offer.salary_raw && <p className="mt-3 border-t border-viatix-line pt-3 text-sm leading-relaxed text-muted-foreground">Podmínky uvedené v inzerátu: {detail.offer.salary_raw}</p>}
        </section>
        {!!evaluation.tailored_cv_highlights.length && <details className="rounded-2xl border border-viatix-line bg-white p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-viatix-teal">Podklady k životopisu</summary><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed">{evaluation.tailored_cv_highlights.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      </div>}

      <details className="mt-7 rounded-2xl border border-viatix-line bg-white p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-viatix-teal">Zobrazit původní znění inzerátu</summary>
        <OfferText key={offerId + ':' + detail.offerRevision} profileId={profileId} offerId={offerId} text={detail.offer.raw_description} translation={detail.translation} />
        {!!sources.length && <div className="mt-5 flex flex-wrap gap-3">{sources.map(source => <a key={source.portal} href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-medium text-viatix-teal">{source.portal} ↗</a>)}</div>}
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Zveřejněno: {formatDate(detail.offer.published_at)} · Dostupnost inzerátu ověř na původním portálu.</p>
      </details>

      <details className="mt-4 rounded-2xl border border-viatix-line p-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-muted-foreground">Další možnosti</summary>
        <div className="mt-3"><h2 className="font-semibold">Upravit nabídku</h2><OfferEditor profileId={profileId} offerId={offerId} initialDetail={detail} onSaved={result => { setDetail(previous => ({ ...previous, ...result })); onChanged(); }} /></div>
        <button type="button" disabled={busy} onClick={() => change('hidden')} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-viatix-teal/5"><EyeOff className="h-4 w-4" />{state.hidden ? 'Zobrazit nabídku znovu' : 'Skrýt nabídku'}</button>
        {!deleteConfirm ? <button type="button" disabled={busy || deleting} onClick={() => setDeleteConfirm(true)} className="mt-3 flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" />Smazat nabídku natrvalo</button> : <div role="alertdialog" aria-label="Potvrzení smazání nabídky" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">Opravdu chceš nabídku smazat?</p><p className="mt-1 text-sm leading-relaxed text-red-800">Odstraní se také hodnocení AI, poznámky, historie reakcí i uložený text. Tuto akci nelze vrátit.</p>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={deleting} onClick={() => setDeleteConfirm(false)} className="button-secondary min-h-11">Zrušit</button><button type="button" disabled={deleting} onClick={removeOffer} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">{deleting && <Loader2 className="h-4 w-4 animate-spin" />}{deleting ? 'Mažu nabídku…' : 'Ano, smazat natrvalo'}</button></div>
        </div>}
      </details>
    </div>}
  </section>;
}
