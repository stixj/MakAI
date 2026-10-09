import {UserError} from './cloudStore.js';
import {profileTable} from './cloudProfile.js';
import {applicationDetail,appendEvent,assertActive} from './applicationStore.js';
import {canonicalId,normalizedUrl} from './externalOffer.js';
import {getOfferSources} from '../src/lib/jobs.js';
export const OFFER_FIELDS=['title','company','location','salary_raw','url','raw_description'];
export async function offerEdits(db,profileId){return (await db.execute({sql:'SELECT o.offer_id,o.payload,o.revision,COALESCE(v.offer_revision,0) AS evaluated_revision FROM makai_offer_edits o LEFT JOIN makai_offer_evaluation_versions v ON v.profile_id=o.profile_id AND v.offer_id=o.offer_id WHERE o.profile_id=?',args:[profileId]})).rows;}
export function applyOfferEdit(row,edits){const edit=edits.find(item=>item.offer_id===row.offer_id);return edit?{...row,offer:JSON.stringify({...JSON.parse(row.offer),...JSON.parse(edit.payload)}),offerEdited:true,evaluationStale:!!row.evaluation&&Number(edit.revision)>Number(edit.evaluated_revision||0),offerRevision:Number(edit.revision)}:row;}
export async function updateOffer(store,input){
  if(!Number.isSafeInteger(input?.offerRevision)||input.offerRevision<0)throw new UserError('Načti nabídku znovu.');
  const offer=input.offer;
  if(!offer||OFFER_FIELDS.some(key=>typeof offer[key]!=='string'||offer[key].length>(key==='raw_description'?30000:key==='url'?2000:300))||!offer.title.trim()||!offer.company.trim())throw new UserError('Doplň název pozice a firmu.');
  const changes=Object.fromEntries(OFFER_FIELDS.map(key=>[key,offer[key].trim()]));
  changes.url=normalizedUrl(changes.url);changes.location=changes.location||null;changes.salary_raw=changes.salary_raw||null;
  changes.canonical_id=canonicalId(changes.company,changes.title,changes.location||'');
  return store.transaction(async db=>{
    await assertActive(store,db,input.profileId);
    const previous=await applicationDetail(store,input.profileId,input.offerId,db);
    if(previous.offerRevision!==input.offerRevision)throw new UserError('Nabídka se mezitím změnila. Načti ji znovu.',409);
    const changed=OFFER_FIELDS.filter(key=>(previous.offer[key]||'')!==(changes[key]||''));
    if(!changed.length)return previous;
    const active=(await db.execute("SELECT options FROM makai_runs WHERE status IN ('queued','running','stopping')")).rows;
    if(active.some(run=>JSON.parse(run.options).evaluationOffer?.id===input.offerId))throw new UserError('Nejdřív dokonči nebo zastav AI hodnocení.',409);
    const table=profileTable(input.profileId),exists=(await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[table]})).rows.length;
    const rows=[...(exists?(await db.execute('SELECT offer_id,offer FROM '+table)).rows:[]),...(await db.execute({sql:'SELECT offer_id,offer FROM makai_manual_offers WHERE profile_id=?',args:[input.profileId]})).rows];
    const edits=await offerEdits(db,input.profileId);
    for(const row of rows){if(row.offer_id===input.offerId)continue;for(const candidate of [JSON.parse(row.offer),JSON.parse(applyOfferEdit(row,edits).offer)]){
      if(canonicalId(candidate.company,candidate.title,candidate.location||'')===changes.canonical_id||changes.url&&[candidate.url,...getOfferSources(candidate).map(s=>s.url)].some(url=>url&&normalizedUrl(url)===changes.url))throw new UserError('Tyto údaje patří nabídce, kterou už máš uloženou. Úprava by vytvořila duplicitu.',409);
    }}
    changes.sources=changes.url?[{portal:new URL(changes.url).hostname,url:changes.url}]:[];
    await db.execute({sql:'INSERT INTO makai_offer_edits(profile_id,offer_id,payload,revision) VALUES(?,?,?,?) ON CONFLICT(profile_id,offer_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision',args:[input.profileId,input.offerId,JSON.stringify(changes),input.offerRevision+1]});
    await appendEvent(store,db,input.profileId,input.offerId,'offer_updated',{changes:changed,before:previous.offer,after:{...previous.offer,...changes}});
    return applicationDetail(store,input.profileId,input.offerId,db);
  });
}
