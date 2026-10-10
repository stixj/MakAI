import {useState} from 'react';
import {profileApi} from '../lib/profileApi.js';
export default function OfferText({profileId,offerId,text,translation}) {
  const [translated,setTranslated]=useState(translation||null),[czech,setCzech]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function translate(){
    if(translated){setCzech(true);return;}
    setBusy(true);setError('');
    try{setTranslated(await profileApi('/api/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'translate',profileId,offerId})},120000));setCzech(true);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div>
    {text?.trim()&&<div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Jazyk inzerátu">
      <button type="button" className={'filter-chip '+(!czech?'filter-chip-active':'')} aria-pressed={!czech} onClick={()=>setCzech(false)}>Originál</button>
      <button type="button" disabled={busy} className={'filter-chip '+(czech?'filter-chip-active':'')} aria-pressed={czech} onClick={translate}>{busy?'Překládám…':translated?'Česky':'Přeložit do češtiny'}</button>
    </div>}
    {busy&&<p role="status" className="mt-3 text-sm text-ink-secondary">Překládám celý inzerát. Může to chvíli trvat.</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    {czech&&translated&&<p className="mt-3 text-xs text-ink-secondary">Strojový překlad. Nejasné podmínky porovnej s originálem.</p>}
    {!translated&&text?.trim()&&<p className="mt-2 text-xs text-ink-secondary">Překlad používá AI a může čerpat API kredit. Uložený překlad se použije znovu.</p>}
    <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{czech&&translated?translated.text:text||'Text nabídky zatím není doplněný.'}</p>
  </div>;
}
