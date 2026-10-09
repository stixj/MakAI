import {updateOffer,offerEdits,applyOfferEdit} from './offerEditing.js';
import { UserError } from './cloudStore.js';
import { applicationDetail, updateApplication, listApplications, manualRows, assertActive, offerRow, updateOfferInterest } from './applicationStore.js';
import { addOffer, previewOffer } from './externalOffer.js';
import { profileTable } from './cloudProfile.js';
import { readHistoryPage, historyView } from './historyQuery.js';
export async function opportunityRequest(store,method,url,body,{dispatch=async()=>({}),preview=previewOffer,translate=async()=>{throw new UserError('Překlad zatím není připojený.',503);}}={}) {
  const params=new URL(url,'http://localhost').searchParams;
  if (method==='GET') {
    const profile=await store.profile(); if(!profile) return {items:[]};
    return params.has('offerId') ? applicationDetail(store,profile.id,params.get('offerId')) : listApplications(store,profile.id);
  }
  if(method==='PATCH')return updateApplication(store,body);
  if(method==='POST'){
    if(body?.action==='interest')return updateOfferInterest(store,body);
    if(body?.action==='translate')return translate(body);
    if(body?.action==='preview') {await assertActive(store,store.client,body.profileId);return preview(body.url);}
    if(body?.action==='add')return addOffer(store,body);
    if(body?.action==='editOffer')return updateOffer(store,body);
    if(body?.action==='description'){
      const detail=await applicationDetail(store,body.profileId,body.offerId);
      if (typeof body.raw_description!=='string')throw new UserError('Neplatný text nabídky.');
      const offer=Object.fromEntries(['title','company','url','location','salary_raw','raw_description'].map(key=>[key,detail.offer[key]||'']));
      return updateOffer(store,{...body,offerRevision:detail.offerRevision,offer:{...offer,raw_description:body.raw_description}});
    }
    if(body?.action==='evaluate')return {...await store.evaluateOffer(body),...await dispatch()};
  }
  throw new UserError('Nepodporovaná metoda.',405);
}
export async function opportunityHistory(store,query) {
  const profile=await store.profile(); const empty=()=>({rows:[],...historyView([],query)});if(!profile)return empty();
  const table=profileTable(profile.id), client=store.client;
  const exists=(await client.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[table]})).rows.length;
  const reader={execute:stmt=>exists?client.execute({...stmt,sql:stmt.sql.replaceAll('makai_job_evaluations',table)}):Promise.resolve({rows:[]})};
  const result = await readHistoryPage(reader,query,await store.jobStates(profile.id),await manualRows(store,profile.id),await offerEdits(store.client,profile.id));
  if (profile.updatedAt) result.rows = result.rows.map(row => ({...row,evaluationStale:row.evaluationStale || !!row.evaluation && Date.parse(row.evaluated_at?.includes('T') ? row.evaluated_at : row.evaluated_at?.replace(' ','T')+'Z') < Date.parse(profile.updatedAt)}));
  return result;
}
