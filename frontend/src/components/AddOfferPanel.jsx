import { clearDraft, useDraftState, useUnsavedWarning } from '../hooks/useDraft.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Link2, Loader2 } from 'lucide-react';
import { profileApi } from '../lib/profileApi.js';
import { today } from '../lib/applications.js';

export default function AddOfferPanel({ profileId, onClose, onAdded, onDuplicate }) {
  const draftKey = 'new-offer:' + profileId;
  const [offer, setOffer] = useDraftState(draftKey, { url: '', title: '', company: '', location: '', salary_raw: '', raw_description: '' });
  const [applied, setApplied] = useDraftState(draftKey + ':applied', false);
  const [appliedAt, setAppliedAt] = useDraftState(draftKey + ':date', today());
  const [salaryExpectation, setSalaryExpectation] = useDraftState(draftKey + ':salary', '');
  const [reactionDetails, setReactionDetails] = useDraftState(draftKey + ':reaction', '');
  const [step, setStep] = useState('link');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [duplicate, setDuplicate] = useState(null);
  const urlInput = useRef(null), titleInput = useRef(null);
  const draftExists = Object.values(offer).some(value => value.trim());

  useEffect(() => { urlInput.current?.focus(); }, []);
  useEffect(() => { if (step === 'review' && !offer.title.trim()) titleInput.current?.focus(); }, [step, offer.title]);

  function clearAllDrafts() {
    [draftKey, draftKey + ':date', draftKey + ':applied', draftKey + ':salary', draftKey + ':reaction'].forEach(clearDraft);
  }

  async function preview() {
    setBusy(true); setError(''); setNotice(''); setDuplicate(null);
    try {
      const result = await profileApi('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', profileId, url: offer.url }) });
      setOffer(previous => ({ ...previous, ...Object.fromEntries(Object.entries(result.offer || {}).filter(([key, value]) => key in previous && value)) }));
      setNotice(result.notice || 'Zkontroluj předvyplněné údaje a před uložením je případně uprav.');
      setStep('review');
    } catch {
      setNotice('Stránka nepovolila automatické načtení textu. Nevadí, údaje můžeš doplnit ručně.');
      setStep('review');
    } finally { setBusy(false); }
  }

  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await profileApi('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', profileId, offer, applied, appliedAt: applied ? appliedAt || null : null, salaryExpectation, reactionDetails }) });
      if (result.duplicate) { setDuplicate(result); return; }
      clearAllDrafts(); onAdded(result, applied);
    } catch (failure) { setError(failure.message || 'Nabídku se nepodařilo uložit. Zkus to znovu.'); }
    finally { setBusy(false); }
  }

  useUnsavedWarning(draftExists);
  const field = (key, label, required = false, ref = null) => <label className="block text-sm font-medium" key={key}>{label}{required && <span aria-hidden="true"> *</span>}<input ref={ref} value={offer[key]} required={required} maxLength={key === 'url' ? 2000 : 300} autoComplete="off" onChange={event => { setOffer(previous => ({ ...previous, [key]: event.target.value })); setDuplicate(null); }} className="mt-1.5 min-h-11 w-full rounded-xl border border-viatix-line bg-white px-3 py-2.5 text-sm transition-colors focus:border-viatix-teal" /></label>;

  return <section aria-label="Přidat nabídku" aria-labelledby="add-offer-title" className="mt-6 rounded-3xl border border-viatix-line bg-viatix-sand2 p-5 sm:p-7">
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium text-viatix-teal">{step === 'link' ? 'KROK 1 Z 2' : 'KROK 2 Z 2'}</p><h2 id="add-offer-title" className="mt-1 font-display text-xl font-semibold">{step === 'link' ? 'Přidat nabídku' : 'Zkontroluj údaje nabídky'}</h2></div><button type="button" className="button-secondary min-h-11" onClick={onClose} disabled={busy}>Zavřít</button></div>
    {step === 'link' ? <div className="mt-5 animate-reveal">
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">Vlož odkaz na inzerát. Zkusíme doplnit údaje za tebe; před uložením je vždy zkontroluješ.</p>
      <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); preview(); }}>
        <label className="block text-sm font-medium">Odkaz na inzerát<input ref={urlInput} type="url" value={offer.url} maxLength={2000} onChange={event => { setOffer(previous => ({ ...previous, url: event.target.value })); setNotice(''); }} placeholder="https://..." className="mt-1.5 min-h-12 w-full rounded-xl border border-viatix-line bg-white px-4 py-3 text-base transition-colors focus:border-viatix-teal" /></label>
        <button type="submit" className="button-primary min-h-11 w-full sm:w-auto" disabled={busy || !offer.url.trim()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Načítám inzerát…</> : <><Link2 className="h-4 w-4" />Načíst inzerát</>}</button>
      </form>
      <div className="mt-5 border-t border-viatix-line pt-4"><button type="button" data-action="manual-offer-entry" className="min-h-11 text-sm font-medium text-viatix-teal" disabled={busy} onClick={() => { setNotice(''); setError(''); setStep('review'); }}>Odkaz nemám? Doplnit nabídku ručně</button></div>
      {notice && <p role="status" className="mt-3 rounded-xl bg-viatix-amber/15 p-3 text-sm leading-relaxed">{notice}</p>}
    </div> : <form onSubmit={save} className="mt-5 animate-reveal space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">Zkontroluj údaje, které jsme našli. Nabídku uložíme až po tvém potvrzení.</p>
      {notice && <p role="status" className="rounded-xl bg-viatix-amber/15 p-3 text-sm leading-relaxed">{notice}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{field('title', 'Název pozice', true, titleInput)}{field('company', 'Firma', true)}{field('location', 'Lokalita')}{field('salary_raw', 'Mzda a podmínky')}</div>
      <details className="rounded-xl border border-viatix-line bg-white/60 p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-viatix-teal">Text inzerátu a další údaje</summary><label className="mt-2 block text-sm">Text inzerátu <span className="font-normal text-muted-foreground">(potřebný pro AI hodnocení)</span><textarea value={offer.raw_description} maxLength={30000} rows={6} onChange={event => setOffer(previous => ({ ...previous, raw_description: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-viatix-line bg-white p-3 text-sm leading-relaxed" /></label>
        <label className="mt-4 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={applied} onChange={event => setApplied(event.target.checked)} className="h-5 w-5 accent-viatix-teal" />Na tuto nabídku jsem už reagoval/a</label>
        {applied && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="block text-sm">Datum reakce<input type="date" value={appliedAt} onChange={event => setAppliedAt(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-viatix-line bg-white p-3" /></label><label className="block text-sm">Mzda uvedená firmě<input value={salaryExpectation} maxLength={1000} onChange={event => setSalaryExpectation(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-viatix-line bg-white p-3" /></label><label className="block text-sm sm:col-span-2">Poznámka k odeslané reakci<textarea rows={2} value={reactionDetails} maxLength={5000} onChange={event => setReactionDetails(event.target.value)} className="mt-1.5 w-full rounded-xl border border-viatix-line bg-white p-3" /></label></div>}
      </details>
      {duplicate && <div role="status" className="rounded-xl bg-viatix-amber/15 p-3 text-sm"><p>Tuto nabídku už máš: {duplicate.offer.title} · {duplicate.offer.company}.</p><button type="button" className="button-secondary mt-2 min-h-11" onClick={() => onDuplicate(duplicate.offerId)}>Otevřít existující nabídku</button></div>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex flex-col-reverse gap-3 border-t border-viatix-line pt-4 sm:flex-row sm:items-center sm:justify-between"><button type="button" className="button-secondary min-h-11" disabled={busy} onClick={() => { setStep('link'); setNotice(''); setError(''); }}><ArrowLeft className="h-4 w-4" />Zpět k odkazu</button><button type="submit" className="button-primary min-h-11" disabled={busy}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Ukládám…</> : applied ? 'Uložit do přihlášek' : 'Uložit do mých nabídek'}</button></div>
    </form>}
  </section>;
}
