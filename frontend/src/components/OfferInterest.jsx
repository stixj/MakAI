import {useEffect,useState} from 'react';
import {Star} from 'lucide-react';
import {profileApi} from '../lib/profileApi.js';
import {readDraft,writeDraft,clearDraft,useUnsavedWarning} from '../hooks/useDraft.js';
export default function OfferInterest({profileId,offerId,interest,onSaved}) {
  const saved=interest||{priority:false,reason:'',revision:0};
  const key='interest:'+profileId+':'+offerId;
  const [draft,setDraft]=useState(()=>readDraft(key)||{reason:saved.reason,revision:saved.revision});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const dirty=draft.reason!==saved.reason;
  useUnsavedWarning(dirty);
  useEffect(()=>{if(dirty)writeDraft(key,draft);else{clearDraft(key);setDraft({reason:saved.reason,revision:saved.revision});}},[saved.reason,saved.revision]);
  useEffect(()=>{if(dirty)writeDraft(key,draft);else clearDraft(key);},[draft,dirty,key]);
  async function save(changes){
    setBusy(true);setError('');setNotice('');
    try{
      const result=await profileApi('/api/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'interest',profileId,offerId,revision:changes.reason===undefined?saved.revision:draft.revision,...changes})});
      setDraft({reason:changes.reason===undefined?draft.reason:result.reason,revision:changes.reason===undefined&&dirty&&draft.revision!==saved.revision?draft.revision:result.revision});
      onSaved(result);setNotice(changes.reason===undefined?'Priorita uložená.':'Důvod uložený.');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section aria-label="Můj zájem" className="mt-4 rounded-xl border border-border-subtle bg-white p-3">
    <button type="button" disabled={busy} aria-pressed={saved.priority} onClick={()=>save({priority:!saved.priority})} className={'inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold '+(saved.priority?'text-brand':'text-ink-secondary')}><Star className="h-4 w-4" fill={saved.priority?'currentColor':'none'} aria-hidden="true" />{saved.priority?'Moje priorita':'Označit jako prioritu'}</button>
    <p className="mt-1 text-xs text-ink-secondary">Tvůj osobní zájem. AI skóre se tím nemění.</p>
    <details className="mt-3"><summary className="cursor-pointer text-sm text-brand">Proč mě tato práce láká{saved.reason?' · doplněno':''}</summary>
      <label className="mt-3 block text-xs">Můj důvod<textarea rows={2} maxLength={2000} value={draft.reason} disabled={busy} onChange={e=>{setDraft({...draft,reason:e.target.value});setNotice('');}} placeholder="Např. smysluplný produkt, tým a možnost růstu…" className="mt-1 w-full rounded-xl border border-border-subtle p-3 text-sm" /></label>
      {dirty&&draft.revision!==saved.revision&&<p role="alert" className="mt-2 text-xs text-danger">Uložený zájem se mezitím změnil. Tvůj koncept se zachoval; uložený důvod: {saved.reason||'není doplněný'}.</p>}
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="button-secondary" disabled={busy||!dirty} onClick={()=>save({reason:draft.reason})}>Uložit důvod</button>{dirty&&<button type="button" className="button-secondary" disabled={busy} onClick={()=>{setDraft({reason:saved.reason,revision:saved.revision});clearDraft(key);setError('');}}>Zahodit koncept důvodu</button>}</div>
    </details>
    {error&&<p role="alert" className="mt-2 text-sm text-danger">{error}</p>}{notice&&<p role="status" className="mt-2 text-xs text-brand">{notice}</p>}
  </section>;
}
