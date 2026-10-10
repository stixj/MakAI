import { clearDraft, useDraftState, useUnsavedWarning } from '../hooks/useDraft.js';
import { useState } from 'react';
import { profileApi } from '../lib/profileApi.js';
import { today } from '../lib/applications.js';
export default function AddOfferPanel({profileId,onClose,onAdded,onDuplicate}) {
  const draftKey='new-offer:'+profileId;
  const [offer,setOffer]=useDraftState(draftKey,{url:'',title:'',company:'',location:'',salary_raw:'',raw_description:''});
  const [applied,setApplied]=useDraftState(draftKey+':applied',false),[appliedAt,setAppliedAt]=useDraftState(draftKey+':date',today());
  const [salaryExpectation,setSalaryExpectation]=useDraftState(draftKey+':salary',''),[reactionDetails,setReactionDetails]=useDraftState(draftKey+':reaction','');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[duplicate,setDuplicate]=useState(null);
  const field=(key,label,required=false)=> <label className="block text-sm">{label}<input value={offer[key]} required={required} maxLength={300} onChange={e=>{setOffer({...offer,[key]:e.target.value});setDuplicate(null);}} className="mt-1 w-full rounded-xl border border-viatix-line bg-white p-3" /></label>;
  async function preview(){setBusy(true);setError('');setDuplicate(null);try{const result=await profileApi('/api/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'import',profileId,url:offer.url})});if(result.duplicate){[draftKey,draftKey+':date',draftKey+':applied',draftKey+':salary',draftKey+':reaction'].forEach(clearDraft);onDuplicate(result.offerId);return;}if(result.saved){[draftKey,draftKey+':date',draftKey+':applied',draftKey+':salary',draftKey+':reaction'].forEach(clearDraft);onAdded(result,false);return;}setOffer(previous=>({...previous,...Object.fromEntries(Object.entries(result.offer).filter(([,value])=>value))}));setNotice(result.notice);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function save(e){e.preventDefault();setBusy(true);setError('');try{const result=await profileApi('/api/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',profileId,offer,applied,appliedAt:applied?appliedAt||null:null,salaryExpectation,reactionDetails})});if(result.duplicate){setDuplicate(result);return;}[draftKey,draftKey+':date',draftKey+':applied',draftKey+':salary',draftKey+':reaction'].forEach(clearDraft);onAdded(result,applied);}catch(e){setError(e.message);}finally{setBusy(false);}}
  useUnsavedWarning(Object.values(offer).some(value=>value.trim()));
  return <section aria-label="Přidat nabídku" className="mt-6 rounded-2xl border border-viatix-line bg-viatix-sand2 p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-semibold">Přidat nabídku</h2><button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Zavřít</button></div>
    <p className="mt-2 text-sm text-muted-foreground">Vlož odkaz nebo nabídku vyplň ručně. Uložení ani načtení odkazu nevyužívá AI.</p>
    <form onSubmit={save} className="mt-5 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row"><label className="flex-1 text-sm">Odkaz na nabídku (volitelně)<input type="url" value={offer.url} maxLength={2000} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();preview();}}} onChange={e=>setOffer({...offer,url:e.target.value})} className="mt-1 w-full rounded-xl border border-viatix-line bg-white p-3" placeholder="https://..." /></label><button type="button" className="button-primary self-end" disabled={busy||!offer.url} onClick={preview}>{busy?'Načítám...':'Načíst nabídku'}</button></div>
      {notice&&<p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{field('title','Název pozice',true)}{field('company','Firma',true)}{field('location','Lokalita')}{field('salary_raw','Mzda / podmínky')}</div>
      <label className="block text-sm">Text inzerátu (pro pozdější AI hodnocení)<textarea value={offer.raw_description} maxLength={30000} rows={5} onChange={e=>setOffer({...offer,raw_description:e.target.value})} className="mt-1 w-full rounded-xl border border-viatix-line bg-white p-3" /></label>
      {offer.raw_description&&<article className="rounded-2xl border border-viatix-line bg-white p-4"><h3 className="font-semibold">{'Náhled uloženého snapshotu'}</h3><p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{offer.raw_description.slice(0,700)}{offer.raw_description.length>700?'...':''}</p></article>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applied} onChange={e=>setApplied(e.target.checked)} />Na tuto nabídku jsem už reagoval</label>
      {applied&&<label className="block text-sm">Datum reakce (neznámé nech prázdné)<input type="date" value={appliedAt} onChange={e=>setAppliedAt(e.target.value)} className="ml-3 rounded-xl border border-viatix-line bg-white p-2" /></label>}
      {applied&&<label className="block text-sm">Plat / rozmezí uvedené firmě<input value={salaryExpectation} maxLength={1000} onChange={e=>setSalaryExpectation(e.target.value)} placeholder="Např. 70 000–80 000 Kč hrubého měsíčně" className="mt-1 w-full rounded-xl border border-viatix-line bg-white p-3" /></label>}
      {applied&&<label className="block text-sm">Další údaje o odeslané reakci<textarea rows={2} value={reactionDetails} maxLength={5000} onChange={e=>setReactionDetails(e.target.value)} className="mt-1 w-full rounded-xl border border-viatix-line bg-white p-3" /></label>}
      {duplicate&&<div role="status" className="rounded-xl bg-viatix-amber/15 p-3 text-sm"><p>Tuto nabídku už máš: {duplicate.offer.title} · {duplicate.offer.company}.</p><button type="button" className="button-secondary mt-2" onClick={()=>onDuplicate(duplicate.offerId)}>Otevřít existující nabídku</button></div>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" className="button-primary" disabled={busy}>{busy?'Ukládám…':applied?'Přidat do mých přihlášek':'Uložit nabídku'}</button>
    </form>
  </section>;
}
