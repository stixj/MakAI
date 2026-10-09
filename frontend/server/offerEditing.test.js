import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFile} from 'node:fs/promises';
import {CloudStore} from './cloudStore.js';
import {updateOffer} from './offerEditing.js';
import {applicationDetail,updateApplication,listApplications} from './applicationStore.js';
import {addOffer} from './externalOffer.js';
import {importSnapshot} from './sharedMigration.js';
import {profileTable} from './cloudProfile.js';
import {opportunityHistory} from './opportunityApi.js';
import {historyQuery} from './historyQuery.js';
import {decodeJobRows} from '../src/lib/jobs.js';
const content=await readFile(new URL('../public/templates/candidate-profile-template.json',import.meta.url),'utf8');
const offer={title:'Analyst',company:'Example',url:'https://example.com/role',location:'Brno',salary_raw:'50 000 Kč',raw_description:'Original text'};
const evaluation={score:85,verdict:'STRONG_FIT',fit_reasons:['Relevant','Suitable'],gap_analysis:[],tailored_cv_highlights:[]};
async function setup(t){const client=createClient({url:'file::memory:'});t.after(()=>client.close());const store=new CloudStore(client);await store.initialize();const profile=await store.saveProfile({name:'Mine',content});return {store,client,profileId:profile.id};}
test('all applied offers remain editable while original offer, evaluation and dates are preserved',async t=>{
 const {store,client,profileId}=await setup(t);
 await importSnapshot(store,{name:'Mine',content,rows:[{offer_id:'evaluated',offer:JSON.stringify({...offer,id:'evaluated'}),evaluation:JSON.stringify(evaluation),evaluated_at:'2026-10-01T10:00:00Z'}]});
 await store.updateJobState({profileId,offerId:'evaluated',changes:{applied:true}});
 const before=(await client.execute('SELECT * FROM '+profileTable(profileId))).rows;
 const detail=await updateOffer(store,{profileId,offerId:'evaluated',offerRevision:0,offer:{...offer,title:'New title',url:'',raw_description:'',salary_raw:'60 000 Kč'}});
 assert.equal(detail.offer.title,'New title');assert.equal(detail.originalOffer.title,'Analyst');assert.deepEqual(detail.evaluation,evaluation);assert.equal(detail.offerRevision,1);
 assert.deepEqual((await client.execute('SELECT * FROM '+profileTable(profileId))).rows,before);
 assert.equal((await listApplications(store,profileId)).items[0].offer.title,'New title');
 const page=await opportunityHistory(store,historyQuery('/api/jobs?view=paged&search=New'));
 const decoded=decodeJobRows(page.rows);assert.equal(decoded.invalidCount,0);assert.equal(decoded.jobs[0].offerEdited,true);assert.equal(decoded.jobs[0].evaluation.score,85);
 await assert.rejects(updateOffer(store,{profileId,offerId:'evaluated',offerRevision:0,offer}),e=>e.status===409);
});
test('salary and sent response are independent of advertised salary and persist with history on older application payloads',async t=>{
 const {store,client,profileId}=await setup(t);const saved=await addOffer(store,{profileId,offer,applied:true,appliedAt:null});
 const old={appliedAt:null,status:'waiting',notes:'Old notes',contacts:[],tasks:[],interviews:[]};
 await client.execute({sql:'UPDATE makai_applications SET payload=? WHERE profile_id=? AND offer_id=?',args:[JSON.stringify(old),profileId,saved.offerId]});
 let detail=await applicationDetail(store,profileId,saved.offerId);assert.equal(detail.application.salaryExpectation,'');
 detail=await updateApplication(store,{profileId,offerId:saved.offerId,revision:0,application:{...detail.application,salaryExpectation:'70 000–80 000 Kč hrubého měsíčně + bonus',reactionDetails:'Dotazník Jobs.cz; odeslaný životopis',appliedAt:'2026-09-15'}});
 const reloaded=await applicationDetail(new CloudStore(client),profileId,saved.offerId);assert.deepEqual(reloaded.application,detail.application);assert.equal(reloaded.offer.salary_raw,'50 000 Kč');assert.ok(reloaded.events[0].payload.changes.includes('salaryExpectation'));
 assert.equal((await listApplications(store,profileId)).items[0].application.salaryExpectation,detail.application.salaryExpectation);
});
test('historical offer edits retain unknown dates and deduplication checks revised identities',async t=>{
 const {store,profileId}=await setup(t);await importSnapshot(store,{name:'Mine',content,applications:[{employer:'Historic',position:'Role',reported_status:'applied',applied_at:null,notes:''}]});
 const item=(await listApplications(store,profileId)).items[0];const revised={...offer,title:'Updated historic role',company:'Historic',url:'https://example.com/history'};
 const detail=await updateOffer(store,{profileId,offerId:item.id,offerRevision:0,offer:revised});assert.equal(detail.application.appliedAt,null);assert.equal(detail.events[0].kind,'offer_updated');
 assert.equal((await addOffer(store,{profileId,offer:revised,applied:false})).duplicate,true);
 const another=await addOffer(store,{profileId,offer:{...offer,title:'Other',url:'https://example.com/other'},applied:false});
 await assert.rejects(updateOffer(store,{profileId,offerId:another.offerId,offerRevision:0,offer:revised}),e=>e.status===409);
 assert.equal((await applicationDetail(store,profileId,another.offerId)).offerRevision,0);
});
test('AI evaluation uses the revised manual offer and refuses edits during a pending evaluation',async t=>{
 const {store,profileId}=await setup(t);const saved=await addOffer(store,{profileId,offer,applied:false});
 const revised={...offer,title:'Revised',raw_description:'Revised duties'};
 await updateOffer(store,{profileId,offerId:saved.offerId,offerRevision:0,offer:revised});await store.evaluateOffer({profileId,offerId:saved.offerId});
 const run=await store.claim();assert.equal(run.options.evaluationOfferRevision,1);assert.equal(run.options.evaluationOffer.title,'Revised');assert.equal(run.options.evaluationOffer.raw_description,'Revised duties');
 await assert.rejects(updateOffer(store,{profileId,offerId:saved.offerId,offerRevision:1,offer:{...revised,title:'Another'}}),e=>e.status===409);
 await store.finish({...run,status:'done',result:{found:1,evaluated:1,saved:1,errors:[],evaluation}});
 const page=await opportunityHistory(store,historyQuery('/api/jobs?view=paged'));assert.equal(decodeJobRows(page.rows).jobs[0].evaluationStale,false);
});
