import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';
import {CloudStore} from './cloudStore.js';
import {importSnapshot} from './sharedMigration.js';
import {applicationDetail, updateApplication, listApplications} from './applicationStore.js';
import {opportunityHistory} from './opportunityApi.js';
import {historyQuery} from './historyQuery.js';
import {updateOffer} from './offerEditing.js';
import {profileTable} from './cloudProfile.js';
const content=await readFile(new URL('../public/templates/candidate-profile-template.json',import.meta.url),'utf8');
const evaluation={score:85,verdict:'STRONG_FIT',fit_reasons:['Relevantní zkušenost','Vhodné podmínky'],gap_analysis:[],tailored_cv_highlights:[]};
const offer={id:'career-one',title:'Analytik',company:'Firma',url:'https://example.com/one',location:'Praha',salary_raw:'60 000 Kč',raw_description:'Analytická práce',published_at:null};
async function setup(t){const client=createClient({url:'file::memory:'});t.after(()=>client.close());let now=new Date('2026-10-09T10:00:00Z');const store=new CloudStore(client,{now:()=>now});await store.initialize();const profile=await store.saveProfile({name:'Můj profil',content});await importSnapshot(store,{name:profile.name,content,rows:[{offer_id:offer.id,offer:JSON.stringify(offer),evaluation:JSON.stringify(evaluation),evaluated_at:'2026-10-01T10:00:00Z'}]});return {store,client,profile,setTime:value=>{now=new Date(value);}};}
test('editing preferences retains saved offers, application notes, events and profile identity; stale revisions cannot overwrite',async t=>{
 const {store,profile}=await setup(t);
 await store.updateJobState({profileId:profile.id,offerId:offer.id,changes:{saved:true,applied:true}});
 let detail=await applicationDetail(store,profile.id,offer.id);
 await updateApplication(store,{profileId:profile.id,offerId:offer.id,revision:0,application:{...detail.application,notes:'Poznámka z pohovoru'}});
 const edited=await store.saveProfile({name:profile.name,content:content.replace('Účetní','Procesní analytik'),replaceProfileId:profile.id,expectedRevision:0});
 assert.equal(edited.id,profile.id);assert.equal(edited.revision,1);assert.notEqual(edited.contentId,profile.id);
 assert.equal((await listApplications(store,profile.id)).items[0].application.notes,'Poznámka z pohovoru');
 const page=await opportunityHistory(store,historyQuery('/api/jobs?view=paged&collection=saved'));assert.equal(page.total,1);assert.equal(page.rows[0].evaluationStale,true);assert.equal(page.rows[0].state.saved,true);
 detail=await applicationDetail(store,profile.id,offer.id);assert.equal(detail.evaluationStale,true);assert.equal(detail.events.length,2);
 await assert.rejects(store.saveProfile({name:'Old editor',content,replaceProfileId:profile.id,expectedRevision:0}),e=>e.status===409);
 assert.equal((await store.profile()).revision,1);
 await store.manual({profileId:profile.id});const run=await store.claim();assert.equal(run.profile.id,profile.id);assert.equal(run.profile.contentId,edited.contentId);assert.equal(run.profile.content,edited.content);
});
test('re-evaluation of an edited harvested offer uses edited text, keeps original offer and application data, and clears staleness',async t=>{
 const {store,client,profile,setTime}=await setup(t);await store.updateJobState({profileId:profile.id,offerId:offer.id,changes:{applied:true}});
 await updateOffer(store,{profileId:profile.id,offerId:offer.id,offerRevision:0,offer:{title:offer.title,company:offer.company,location:offer.location,salary_raw:'70 000 Kč',url:offer.url,raw_description:'Aktualizované analytické povinnosti'}});
 await store.evaluateOffer({profileId:profile.id,offerId:offer.id});const run=await store.claim();assert.equal(run.options.evaluationOffer.raw_description,'Aktualizované analytické povinnosti');
 await assert.rejects(updateOffer(store,{profileId:profile.id,offerId:offer.id,offerRevision:1,offer:{...offer,title:'Changed while running'}}),e=>e.status===409);
 setTime('2026-10-09T10:05:00Z');await store.finish({...run,status:'done',result:{found:1,evaluated:1,saved:1,errors:[],evaluation:{...evaluation,score:90}}});
 const detail=await applicationDetail(store,profile.id,offer.id);assert.equal(detail.evaluationStale,false);assert.equal(detail.evaluation.score,90);assert.equal(detail.originalOffer.salary_raw,'60 000 Kč');assert.equal(detail.state.applied,1);
 const page=await opportunityHistory(store,historyQuery('/api/jobs?view=paged'));assert.equal(page.rows[0].evaluationStale,false);assert.equal(JSON.parse((await client.execute('SELECT offer FROM '+profileTable(profile.id))).rows[0].offer).raw_description,offer.raw_description);
 await assert.rejects(store.evaluateOffer({profileId:profile.id,offerId:offer.id}),e=>e.status===409);
});
