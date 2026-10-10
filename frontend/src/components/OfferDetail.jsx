import OfferInterest from './OfferInterest.jsx';
import OfferText from './OfferText.jsx';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bookmark, Check, EyeOff, Loader2, Sparkles } from 'lucide-react';
import { profileApi } from '../lib/profileApi.js';
import { VERDICTS, formatDate, safeOfferUrl, getOfferSources } from '../lib/jobs.js';
import { normalizeJobState } from '../lib/jobState.js';
import OfferEditor from './OfferEditor.jsx';
export default function OfferDetail({ profileId, offerId, onClose, onStateChange, onApplication, onChanged, reloadKey }) {
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [deleteConfirm,setDeleteConfirm]=useState(false),[deleting,setDeleting]=useState(false);
  const [evaluating,setEvaluating]=useState(false);
  const [tab, setTab] = useState('analysis');
  useEffect(() => {
    let active = true;
    setError('');
    profileApi('/api/applications?offerId=' + encodeURIComponent(offerId)).then(result => { if (active) {setDetail(result);if(result.evaluation && !result.evaluationStale)setEvaluating(false);} }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [profileId, offerId, reloadKey]);
  useEffect(() => {
    if (!evaluating) return;
    let active = true;
    const poll = async () => { try { const current = await profileApi('/api/applications?offerId=' + encodeURIComponent(offerId)); if (active && current.evaluation && !current.evaluationStale) { setDetail(current); setEvaluating(false); setNotice('Evaluation complete.'); } } catch (e) { if (active) setError(e.message); } };
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
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function evaluate() {
    setBusy(true); setError('');
    try {
      const result = await profileApi('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'evaluate', profileId, offerId }) });
      setEvaluating(true); setNotice(result.notice || 'Hodnocení čeká na spuštění. Výsledek najdeš v přehledu nabídek.'); onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function removeOffer() {
    setDeleting(true);setError('');
    try {
      await profileApi('/api/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',profileId,offerId})});
      onChanged();onClose();
    } catch(e) { setError(e.message);setDeleting(false); }
  }
  return <section className="mt-6" aria-label="Detail nabídky">
    <button type="button" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-viatix-teal" onClick={onClose}><ArrowLeft className="h-4 w-4" />Zpět na nabídky</button>
    {!detail && !error && <p role="status">Načítám nabídku…</p>}
    {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
    {detail && <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0 rounded-3xl border border-viatix-line/70 bg-viatix-sand2 p-5 sm:p-8">
        <p className="text-sm text-muted-foreground">{detail.offer.company}</p>
        <h1 className="mt-2 font-display text-2xl font-semibold leading-tight sm:text-3xl">{detail.offer.title}</h1>
        {detail.manual&&<p role="status" className="mt-3 rounded-xl border border-viatix-teal/20 bg-viatix-teal/5 px-4 py-3 text-sm font-medium text-viatix-teal">Nabídka je uložená v „Přidáno mnou“{detail.evaluation?' a má AI hodnocení.':' a zatím nebyla vyhodnocena AI.'}</p>}
        <p className="mt-3 text-sm text-muted-foreground">{detail.offer.location || 'Lokalita není uvedená'} · {detail.offer.salary_raw || 'Mzda není uvedená'}</p>
        {detail.offer.raw_description?.trim()&&<div className="mt-5 rounded-2xl bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Snapshot inzeratu</p><p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{detail.offer.raw_description.slice(0,500)}{detail.offer.raw_description.length>500?'...':''}</p></div>}
        <div className="mt-5 border-t border-viatix-line pt-4">
          {!deleteConfirm ? <button type="button" disabled={busy||deleting} onClick={()=>setDeleteConfirm(true)} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50">Smazat nabídku natrvalo</button> : <div role="alertdialog" aria-label="Potvrzení smazání nabídky" className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">Opravdu chceš nabídku trvale smazat?</p>
            <p className="mt-1 text-sm text-red-800">Odstraní se nabídka, hodnocení AI, poznámky, historie reakcí i uložený text. Tuto akci nelze vrátit.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={deleting} onClick={()=>setDeleteConfirm(false)} className="button-secondary">Zrušit</button>
              <button type="button" disabled={deleting} onClick={removeOffer} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">{deleting&&<Loader2 className="h-4 w-4 animate-spin" />}{deleting?'Mažu nabídku…':'Ano, smazat natrvalo'}</button>
            </div>
          </div>}
        </div>
        <OfferInterest profileId={profileId} offerId={offerId} interest={detail.interest} onSaved={interest=>{setDetail(previous=>({...previous,interest,state:{...previous.state,priority:interest.priority}}));onChanged();}} />
        <div className="mt-5 flex flex-wrap gap-2 lg:hidden">
          {safeOfferUrl(detail.offer.url) && <a className="button-primary" href={detail.offer.url} target="_blank" rel="noopener noreferrer">Otevřít inzerát<ArrowUpRight className="h-4 w-4" /></a>}
          <button type="button" disabled={busy} className="button-secondary" onClick={() => change('saved')}>{state.saved ? 'Uloženo · zrušit' : 'Uložit nabídku'}</button>
          {state.applied ? <button type="button" className="button-secondary" onClick={() => onApplication(offerId)}>Detail přihlášky</button> : <button type="button" disabled={busy} className="button-secondary" onClick={() => change('applied')}>Reagoval jsem</button>}
          <button type="button" disabled={busy} onClick={() => change('hidden')} className="min-h-11 px-3 text-sm text-muted-foreground">{state.hidden ? 'Zobrazit znovu' : 'Skrýt'}</button>
          <p className="w-full text-xs leading-relaxed text-muted-foreground">Reakci zaznamenej po jejím odeslání. MakAI ji neodesílá.</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Obsah nabídky">{[['analysis','Shoda s profilem'],['description','Celý inzerát'],['edit','Upravit údaje']].map(([key,label]) => <button type="button" key={key} aria-pressed={tab === key} className={'filter-chip ' + (tab === key ? 'filter-chip-active' : '')} onClick={() => setTab(key)}>{label}</button>)}</div>
        <div className="mt-6">
          {tab === 'analysis' && <>
            {detail.evaluationStale && <p className="mb-5 rounded-xl bg-viatix-amber/15 p-4 text-sm">Profil nebo nabídka se změnily. Toto hodnocení vychází z dřívějších údajů; můžeš ho přehodnotit.</p>}
            {detail.evaluation ? <>
              <p className="text-sm font-semibold text-viatix-teal">{detail.evaluationStale ? 'Previous match' : VERDICTS[detail.evaluation.verdict]?.label} ({detail.evaluation.verdict}) · {detail.evaluation.score}/100 ({detail.evaluation.score}%)</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Skóre porovnává nabídku s profilem. Nevyjadřuje pravděpodobnost přijetí.</p>
              <h2 className="mt-7 font-semibold">Proč tato shoda</h2><ul className="mt-3 space-y-3 text-sm leading-relaxed">{detail.evaluation.fit_reasons.map((reason,i) => <li key={i} className="flex gap-2"><span className="text-viatix-teal">•</span>{reason}</li>)}</ul>
              {!!detail.evaluation.gap_analysis.length && <div className="mt-6 rounded-2xl bg-viatix-amber/10 p-5"><h2 className="font-semibold">Co ověřit před dalším krokem</h2><ul className="mt-3 list-disc space-y-3 pl-4 text-sm leading-relaxed">{detail.evaluation.gap_analysis.map((gap,i) => <li key={i}>{gap}</li>)}</ul></div>}
              {!!detail.evaluation.tailored_cv_highlights.length && <><h2 className="mt-6 font-semibold">Podklady do životopisu</h2><ul className="mt-3 list-disc space-y-2 pl-4 text-sm">{detail.evaluation.tailored_cv_highlights.map((item,i) => <li key={i}>{item}</li>)}</ul></>}
            </> : <p className="text-sm leading-relaxed text-muted-foreground">Nabídka zatím nemá AI hodnocení. Můžeš ji prohlédnout a uložit i bez něj.</p>}
            {(!detail.evaluation || detail.evaluationStale) && <><button type="button" disabled={busy || evaluating || !detail.offer.raw_description?.trim()} onClick={evaluate} className="button-primary mt-6">{evaluating ? <><Loader2 className="h-4 w-4 animate-spin" />Vyhodnocuji nabidku...</> : busy ? 'Odesilam...' : detail.evaluation ? 'Znovu vyhodnotit s AI' : <><Sparkles className="h-4 w-4" />Spustit AI evaluaci</>}</button><p className="mt-2 text-xs text-muted-foreground">AI evaluaci spousti nastaveny poskytovatel a muze byt zpoplatnena. {!detail.offer.raw_description?.trim() ? 'Pred evaluaci dopln text inzeratu.' : ''}</p></>}
          </>}
          {tab === 'description' && <><h2 className="font-semibold">Text nabídky</h2><OfferText key={offerId+":"+detail.offerRevision} profileId={profileId} offerId={offerId} text={detail.offer.raw_description} translation={detail.translation} /><div className="mt-6 flex flex-wrap gap-3">{getOfferSources(detail.offer).map(source => <a key={source.portal} href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-viatix-teal">{source.portal} ↗</a>)}</div></>}
          <div hidden={tab !== 'edit'}><OfferEditor profileId={profileId} offerId={offerId} initialDetail={detail} onSaved={result => { setDetail(previous => ({ ...previous, ...result })); onChanged(); }} /></div>
          {notice && <p role="status" className="mt-5 text-sm text-viatix-teal lg:hidden">{notice}</p>}
          <p className="mt-5 text-xs text-muted-foreground lg:hidden">Zveřejněno: {formatDate(detail.offer.published_at)} · Dostupnost ověř na původním portálu.</p>
        </div>
      </div>
      <aside className="hidden rounded-2xl border border-viatix-line/70 bg-viatix-sand2 p-5 lg:sticky lg:top-6 lg:block">
        <h2 className="font-semibold">Další krok</h2>
        {safeOfferUrl(detail.offer.url) && <a href={detail.offer.url} target="_blank" rel="noopener noreferrer" className="button-primary mt-4 w-full">Otevřít inzerát<ArrowUpRight className="h-4 w-4" /></a>}
        <button type="button" disabled={busy} onClick={() => change('saved')} className="button-secondary mt-3 w-full"><Bookmark className="h-4 w-4" />{state.saved ? 'Zrušit uložení' : 'Uložit nabídku'}</button>
        {state.applied ? <button type="button" className="button-secondary mt-3 w-full" onClick={() => onApplication(offerId)}>Detail přihlášky</button> : <button type="button" disabled={busy} onClick={() => change('applied')} className="button-secondary mt-3 w-full"><Check className="h-4 w-4" />Reagoval jsem</button>}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Po odeslání reakce ji tady zaznamenej. MakAI přihlášku neodesílá.</p>
        <button type="button" disabled={busy} onClick={() => change('hidden')} className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><EyeOff className="h-4 w-4" />{state.hidden ? 'Zobrazit znovu' : 'Skrýt nabídku'}</button>
        <div className="mt-5 border-t border-viatix-line pt-4 text-xs leading-relaxed text-muted-foreground"><p>Zveřejněno: {formatDate(detail.offer.published_at)}</p><p className="mt-2">Dostupnost inzerátu si ověř na původním portálu.</p></div>
        {notice && <p role="status" className="mt-4 text-sm text-viatix-teal">{notice}</p>}
      </aside>
    </div>}
  </section>;
}
