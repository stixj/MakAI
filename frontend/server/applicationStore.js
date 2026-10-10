import { createHash, randomUUID } from 'node:crypto';
import { UserError } from './cloudStore.js';
import { profileTable } from './cloudProfile.js';
import { APPLICATION_STATUSES } from '../src/lib/applications.js';
import { today } from '../src/lib/applications.js';

export const applicationTables = [
  'CREATE TABLE IF NOT EXISTS makai_offer_interest (profile_id TEXT NOT NULL, offer_id TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT "", revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(profile_id,offer_id))',
  'CREATE TABLE IF NOT EXISTS makai_offer_translations (profile_id TEXT NOT NULL, offer_id TEXT NOT NULL, source_hash TEXT NOT NULL, status TEXT NOT NULL, token TEXT, lease_until TEXT, text TEXT, translated_at TEXT, PRIMARY KEY(profile_id,offer_id,source_hash))',

  'CREATE TABLE IF NOT EXISTS makai_offer_evaluation_versions (profile_id TEXT NOT NULL, offer_id TEXT NOT NULL, offer_revision INTEGER NOT NULL, PRIMARY KEY(profile_id,offer_id))',
  'CREATE TABLE IF NOT EXISTS makai_offer_edits (profile_id TEXT NOT NULL, offer_id TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(profile_id,offer_id))',
  'CREATE TABLE IF NOT EXISTS makai_application_imports (profile_id TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY(profile_id,source_id))',
  'CREATE TABLE IF NOT EXISTS makai_applications (profile_id TEXT NOT NULL, offer_id TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(profile_id,offer_id))',
  'CREATE TABLE IF NOT EXISTS makai_application_events (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, offer_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS makai_application_event_lookup ON makai_application_events(profile_id,offer_id,at)',
  'CREATE TABLE IF NOT EXISTS makai_manual_offers (profile_id TEXT NOT NULL, offer_id TEXT NOT NULL, offer TEXT NOT NULL, evaluation TEXT, evaluated_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY(profile_id,offer_id))'
];
export function blankApplication() { return { appliedAt: null, status: 'waiting', notes: '', salaryExpectation: '', reactionDetails: '', contacts: [], tasks: [], interviews: [], sentDocuments: '', sentDocumentIds: [], applicationChannel: '', responseExpectedAt: null, applicationDeadline: null, selectionStage: '', assignment: '', assignmentDue: null, assignmentDone: false, questions: '', offeredConditions: '', outcomeReason: '' }; }
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new UserError('Zkontroluj vyplněné údaje.');
  return value.trim();
}
function date(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new UserError('Zkontroluj datum.');
  return value;
}
function list(values, mapper) {
  if (!Array.isArray(values) || values.length > 100) throw new UserError('Seznam může mít nejvýše 100 položek.');
  const ids = new Set();
  return values.map(value => { if (!value || typeof value !== 'object') throw new UserError('Neplatná položka seznamu.');
    const id = value.id == null ? randomUUID() : text(value.id, 100, true);
    if (ids.has(id)) throw new UserError('Položka seznamu je uvedená dvakrát.'); ids.add(id); return { id, ...mapper(value) }; });
}
export function validateApplication(input) {
  if (!input || !Object.hasOwn(APPLICATION_STATUSES,input.status)) throw new UserError('Vyber stav přihlášky.');
  if(input.assignmentDone!==undefined && typeof input.assignmentDone!=='boolean')throw new UserError('Zkontroluj stav zadání.');
  if(input.sentDocumentIds!==undefined&&(!Array.isArray(input.sentDocumentIds)||input.sentDocumentIds.length>50||input.sentDocumentIds.some(id=>typeof id!=='string'||id.length>100)))throw new UserError('Zkontroluj vybrané dokumenty.');
  return { assignmentDone: input.assignmentDone ?? false, sentDocuments: text(input.sentDocuments ?? '',3000), sentDocumentIds: [...new Set(input.sentDocumentIds||[])], applicationChannel: text(input.applicationChannel ?? '',200), responseExpectedAt: date(input.responseExpectedAt ?? null), applicationDeadline: date(input.applicationDeadline ?? null), selectionStage: text(input.selectionStage ?? '',200), assignment: text(input.assignment ?? '',4000), assignmentDue: date(input.assignmentDue ?? null), questions: text(input.questions ?? '',4000), offeredConditions: text(input.offeredConditions ?? '',5000), outcomeReason: text(input.outcomeReason ?? '',2000), appliedAt: date(input.appliedAt), status: input.status, notes: text(input.notes, 20000), salaryExpectation: text(input.salaryExpectation ?? '',1000), reactionDetails: text(input.reactionDetails ?? '',5000),
    contacts: list(input.contacts, c => ({ name: text(c.name,200,true), role: text(c.role,200), email: text(c.email,320), phone: text(c.phone,100) })),
    tasks: list(input.tasks, t => { if (typeof t.done !== 'boolean') throw new UserError('Neplatný stav úkolu.'); return { text: text(t.text,1000,true), due: date(t.due), done: t.done }; }),
    interviews: list(input.interviews, i => {
      if (typeof i.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(i.at) || !Number.isFinite(Date.parse(i.at)) || typeof i.cancelled !== 'boolean' || !Number.isInteger(i.duration) || i.duration < 5 || i.duration > 480) throw new UserError('Zkontroluj čas a délku pohovoru.');
      return { at: new Date(i.at).toISOString(), round: text(i.round ?? '',200), duration: i.duration, place: text(i.place,1000), note: text(i.note,5000), cancelled: i.cancelled };
    }) };
}
export async function assertActive(store, db, profileId) {
  if (typeof profileId !== 'string' || !/^[a-f0-9]{64}$/.test(profileId)) throw new UserError('Neplatný profil.');
  if ((await store.control(db)).profile_id !== profileId) throw new UserError('Aktivní profil se změnil. Obnov přehled.',409);
}
export async function offerRow(db, profileId, offerId) {
  if (typeof offerId !== 'string' || !offerId.trim() || offerId.length > 500) throw new UserError('Neplatná nabídka.');
  const manual = (await db.execute({sql:'SELECT offer_id,offer,evaluation,evaluated_at,created_at FROM makai_manual_offers WHERE profile_id=? AND offer_id=?',args:[profileId,offerId]})).rows[0];
  if (manual) return {...manual,manual:true};
  const table=profileTable(profileId);
  const exists=(await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[table]})).rows.length;
  const row=exists ? (await db.execute({sql:'SELECT offer_id,offer,evaluation,evaluated_at FROM '+table+' WHERE offer_id=?',args:[offerId]})).rows[0] : null;
  if (!row) throw new UserError('Nabídka nebyla nalezena.',404);
  return row;
}
export async function appendEvent(store,db,profileId,offerId,kind,payload) {
  await db.execute({sql:'INSERT INTO makai_application_events(id,profile_id,offer_id,at,kind,payload) VALUES(?,?,?,?,?,?)',args:[randomUUID(),profileId,offerId,store.now().toISOString(),kind,JSON.stringify(payload)]});
}
export async function appliedStateChanged(store,db,profileId,offerId,applied) {
  const previous=(await db.execute({sql:'SELECT applied FROM makai_job_states WHERE profile_id=? AND offer_id=?',args:[profileId,offerId]})).rows[0];
  if (!!previous?.applied === applied) return;
  if (applied) await db.execute({sql:'INSERT OR IGNORE INTO makai_applications(profile_id,offer_id,payload) VALUES(?,?,?)',args:[profileId,offerId,JSON.stringify({...blankApplication(),appliedAt:today(store.now())})]});
  await appendEvent(store,db,profileId,offerId,applied?'applied':'application_removed',{});
}
export async function applicationDetail(store,profileId,offerId,db=store.client) {
  await assertActive(store,db,profileId);
  const row=await offerRow(db,profileId,offerId);
  const saved=(await db.execute({sql:'SELECT payload,revision FROM makai_applications WHERE profile_id=? AND offer_id=?',args:[profileId,offerId]})).rows[0];
  const events=(await db.execute({sql:'SELECT id,at,kind,payload FROM makai_application_events WHERE profile_id=? AND offer_id=? ORDER BY at DESC,rowid DESC',args:[profileId,offerId]})).rows.map(e=>({...e,payload:JSON.parse(e.payload)}));
  const originalOffer=JSON.parse(row.offer);
  const interest=await readOfferInterest(db,profileId,offerId);
  const edited=(await db.execute({sql:'SELECT payload,revision FROM makai_offer_edits WHERE profile_id=? AND offer_id=?',args:[profileId,offerId]})).rows[0];
  const state=(await db.execute({sql:'SELECT saved,applied,hidden FROM makai_job_states WHERE profile_id=? AND offer_id=?',args:[profileId,offerId]})).rows[0] || {};
  const profile=await store.profile(db);
  const profileStale=!!profile?.updatedAt && !!row.evaluation && Date.parse(row.evaluated_at?.includes('T') ? row.evaluated_at : row.evaluated_at?.replace(' ','T')+'Z') < Date.parse(profile.updatedAt);
  const basis=row.evaluation?(await db.execute({sql:'SELECT offer_revision FROM makai_offer_evaluation_versions WHERE profile_id=? AND offer_id=?',args:[profileId,offerId]})).rows[0]:null;
  const description=edited ? {...originalOffer,...JSON.parse(edited.payload)}.raw_description : originalOffer.raw_description;
  const translation=description ? (await db.execute({sql:'SELECT text,translated_at FROM makai_offer_translations WHERE profile_id=? AND offer_id=? AND source_hash=? AND status=?',args:[profileId,offerId,translationHash(description),'done']})).rows[0] || null : null;
  return {id:offerId,profileId,interest,translation,state:{...state,priority:interest.priority},evaluatedAt:row.evaluated_at,evaluationStale:profileStale || (!!row.evaluation&&Number(edited?.revision||0)>Number(basis?.offer_revision||0)),offer:edited?{...originalOffer,...JSON.parse(edited.payload)}:originalOffer,originalOffer,offerRevision:Number(edited?.revision||0),offerEdited:!!edited,evaluation:row.evaluation?JSON.parse(row.evaluation):null,manual:!!row.manual,application:saved?{...blankApplication(),...JSON.parse(saved.payload)}:blankApplication(),sentDocumentSnapshots:await store.applicationDocuments(profileId,offerId,db),revision:Number(saved?.revision||0),events};
}
export async function updateApplication(store,input) {
  if (!Number.isSafeInteger(input?.revision) || input.revision<0) throw new UserError('Obnov detail přihlášky.');
  const application=validateApplication(input.application);
  return store.transaction(async db=>{
    const previous=await applicationDetail(store,input.profileId,input.offerId,db);
    for(const key of ['sentDocuments','sentDocumentIds','applicationChannel','responseExpectedAt','applicationDeadline','selectionStage','assignment','assignmentDue','assignmentDone','questions','offeredConditions','outcomeReason'])if(!Object.hasOwn(input.application,key))application[key]=previous.application[key];
    const state=(await db.execute({sql:'SELECT applied FROM makai_job_states WHERE profile_id=? AND offer_id=?',args:[input.profileId,input.offerId]})).rows[0];
    if (!state?.applied) throw new UserError('Nejdřív označ odeslanou reakci.',409);
    if (previous.revision!==input.revision) throw new UserError('Přihláška se mezitím změnila. Načti detail znovu.',409);
    const changes=Object.keys(application).filter(key=>JSON.stringify(application[key])!==JSON.stringify(previous.application[key]));
    if (!changes.length) return previous;
    await store.attachDocumentsToApplication(input.profileId,input.offerId,application.sentDocumentIds,db);
    await db.execute({sql:'INSERT INTO makai_applications(profile_id,offer_id,payload,revision) VALUES(?,?,?,?) ON CONFLICT(profile_id,offer_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision',args:[input.profileId,input.offerId,JSON.stringify(application),input.revision+1]});
    await appendEvent(store,db,input.profileId,input.offerId,'updated',{changes,before:previous.application,after:application});
    return applicationDetail(store,input.profileId,input.offerId,db);
  });
}
export async function listApplications(store,profileId) {
  await assertActive(store,store.client,profileId);
  const table=profileTable(profileId);
  const exists=(await store.client.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[table]})).rows.length;
  const rows=(await store.client.execute({sql:
    'SELECT s.offer_id, i.priority, i.reason AS interest_reason, i.revision AS interest_revision, '+(exists?'COALESCE(m.offer,e.offer)':'m.offer')+' AS offer, o.payload AS offer_edit, a.payload, a.revision FROM makai_job_states s '+
    'LEFT JOIN makai_offer_interest i ON i.profile_id=s.profile_id AND i.offer_id=s.offer_id '+
    'LEFT JOIN makai_offer_edits o ON o.profile_id=s.profile_id AND o.offer_id=s.offer_id '+
    'LEFT JOIN makai_applications a ON a.profile_id=s.profile_id AND a.offer_id=s.offer_id '+
    'LEFT JOIN makai_manual_offers m ON m.profile_id=s.profile_id AND m.offer_id=s.offer_id '+
    (exists?'LEFT JOIN '+table+' e ON e.offer_id=s.offer_id ':'')+
    'WHERE s.profile_id=? AND s.applied=1 ORDER BY s.updated_at DESC',args:[profileId]})).rows;
  const items=rows.filter(row=>row.offer).map(row=>({id:row.offer_id,profileId,interest:{priority:!!row.priority,reason:row.interest_reason||'',revision:Number(row.interest_revision||0)},offer:{...JSON.parse(row.offer),...(row.offer_edit?JSON.parse(row.offer_edit):{})},application:row.payload?{...blankApplication(),...JSON.parse(row.payload)}:blankApplication(),revision:Number(row.revision||0)}));
  return {profileId,items};
}
export async function manualRows(store,profileId) {
  return (await store.client.execute({sql:'SELECT offer_id,offer,evaluation,evaluated_at,created_at FROM makai_manual_offers WHERE profile_id=?',args:[profileId]})).rows.map(row=>({...row,manual:true}));
}

export const translationHash = text => createHash('sha256').update(text).digest('hex');
export async function readOfferInterest(db,profileId,offerId) {
  const row=(await db.execute({sql:'SELECT priority,reason,revision FROM makai_offer_interest WHERE profile_id=? AND offer_id=?',args:[profileId,offerId]})).rows[0];
  return {priority:!!row?.priority,reason:row?.reason||'',revision:Number(row?.revision||0)};
}
export async function writeOfferInterest(db,profileId,offerId,input) {
  const previous=await readOfferInterest(db,profileId,offerId);
  if(input.revision!==undefined && (!Number.isSafeInteger(input.revision)||input.revision!==previous.revision)) throw new UserError('Tvůj zájem se mezitím změnil. Obnov detail a zkus to znovu.',409);
  if(input.priority!==undefined && typeof input.priority!=='boolean') throw new UserError('Neplatná priorita.');
  const priority=input.priority ?? previous.priority, reason=input.reason===undefined?previous.reason:text(input.reason,2000);
  if(priority===previous.priority&&reason===previous.reason)return previous;
  const revision=previous.revision+1;
  await db.execute({sql:'INSERT INTO makai_offer_interest(profile_id,offer_id,priority,reason,revision) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,offer_id) DO UPDATE SET priority=excluded.priority,reason=excluded.reason,revision=excluded.revision',args:[profileId,offerId,Number(priority),reason,revision]});
  return {priority,reason,revision};
}
export async function updateOfferInterest(store,input) {
  if(!Number.isSafeInteger(input?.revision)||input.revision<0)throw new UserError('Obnov detail nabídky.');
  return store.transaction(async db=>{await assertActive(store,db,input.profileId);await offerRow(db,input.profileId,input.offerId);return writeOfferInterest(db,input.profileId,input.offerId,input);});
}

async function deleteOfferInTransaction(store,db,profileId,offerId) {
    const row=await offerRow(db,profileId,offerId);
    const table=profileTable(profileId);

    // A queued or running single-offer evaluation keeps a full copy of the
    // description in makai_runs.options. Remove that snapshot too, so a late
    // worker response cannot recreate data after the user deletes the offer.
    const runs=(await db.execute({sql:'SELECT id,options FROM makai_runs WHERE profile_id=?',args:[profileId]})).rows;
    for(const run of runs){
      let options;
      try{options=JSON.parse(run.options);}catch{continue;}
      if(options?.evaluationOffer?.id===offerId)await db.execute({sql:'DELETE FROM makai_runs WHERE id=?',args:[run.id]});
    }

    const tableExists=(await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[table]})).rows.length>0;
    if(tableExists)await db.execute({sql:'DELETE FROM '+table+' WHERE offer_id=?',args:[offerId]});
    await db.execute({sql:'DELETE FROM makai_manual_offers WHERE profile_id=? AND offer_id=?',args:[profileId,offerId]});
    for(const name of ['makai_job_states','makai_offer_interest','makai_offer_translations','makai_offer_evaluation_versions','makai_offer_edits','makai_applications','makai_application_events']){
      await db.execute({sql:'DELETE FROM '+name+' WHERE profile_id=? AND offer_id=?',args:[profileId,offerId]});
    }
    return {deleted:true,offerId,manual:!!row.manual};
}

export async function deleteOffer(store,input) {
  return store.transaction(async db=>{
    await assertActive(store,db,input?.profileId);
    return deleteOfferInTransaction(store,db,input.profileId,input?.offerId);
  });
}

export async function deleteOffers(store,input) {
  const { profileId, offerIds } = input || {};
  if (!Array.isArray(offerIds) || offerIds.length < 1 || offerIds.length > 100 ||
      offerIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 500) ||
      new Set(offerIds).size !== offerIds.length) throw new UserError('Vyber 1 až 100 různých nabídek.');
  return store.transaction(async db=>{
    await assertActive(store,db,profileId);
    // Validate every row before removing any of them. The transaction keeps the
    // selection atomic if one offer disappeared or the active profile changed.
    for (const offerId of offerIds) await offerRow(db,profileId,offerId);
    const deleted = [];
    for (const offerId of offerIds) deleted.push(await deleteOfferInTransaction(store,db,profileId,offerId));
    return { deleted: true, offerIds: deleted.map(item => item.offerId), count: deleted.length };
  });
}
