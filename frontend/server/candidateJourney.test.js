import test from 'node:test';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {readFile} from 'node:fs/promises';
import {CloudStore} from './cloudStore.js';
import {addOffer} from './externalOffer.js';
import {applicationDetail,updateApplication,updateOfferInterest,listApplications} from './applicationStore.js';
import {updateOffer} from './offerEditing.js';
import {opportunityHistory} from './opportunityApi.js';
import {historyQuery} from './historyQuery.js';
import {translateOffer} from './offerTranslation.js';
import {createCloudHandler} from './cloudApi.js';
import {sharedLocalMiddleware} from './sharedLocal.js';
import {sessionCookie} from './cloudAuth.js';
const content=await readFile(new URL('../public/templates/candidate-profile-template.json',import.meta.url),'utf8');
const offer={title:'Analyst',company:'Company',location:'Praha',url:'',salary_raw:'70 000 CZK',raw_description:'Work remotely. Fluent English required. Salary 70 000 CZK.'};
const now=()=>new Date('2026-10-09T10:00:00Z');
async function setup(t){const client=createClient({url:'file::memory:'});t.after(()=>client.close());const store=new CloudStore(client,{now});await store.initialize();const profile=await store.saveProfile({name:'Mine',content});const added=await addOffer(store,{profileId:profile.id,offer,applied:false});return {client,store,profileId:profile.id,offerId:added.offerId};}
const response=text=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({text})}]}]})});
const env={OPENAI_API_KEY:'test-only',LLM_PROVIDER:'openai'};
test('priority and personal motivation persist before and after applying, filter the whole history and never alter AI data',async t=>{
 const {client,store,profileId,offerId}=await setup(t);
 const before=(await applicationDetail(store,profileId,offerId)).offer;
 for(let i=0;i<13;i++)await addOffer(store,{profileId,offer:{...offer,title:'Other '+i},applied:false});
 await store.updateJobState({profileId,offerId,changes:{priority:true}});
 let detail=await applicationDetail(store,profileId,offerId);assert.equal(detail.interest.priority,true);assert.equal(detail.state.applied,0);
 let result=await updateOfferInterest(store,{profileId,offerId,revision:1,reason:'Smysluplný produkt'});assert.equal(result.revision,2);
 await assert.rejects(updateOfferInterest(store,{profileId,offerId,revision:1,reason:'Zastaralý text'}),e=>e.status===409);
 const page=await opportunityHistory(store,historyQuery('/api/jobs?view=paged&collection=priority&pageSize=6'));assert.equal(page.total,1);assert.equal(page.rows[0].offer_id,offerId);
 const sorted=await opportunityHistory(store,historyQuery('/api/jobs?view=paged&sort=priority&pageSize=6'));assert.equal(sorted.rows[0].offer_id,offerId);
 await store.updateJobState({profileId,offerId,changes:{applied:true,saved:true}});
 const reopened=new CloudStore(client);assert.equal((await listApplications(reopened,profileId)).items[0].interest.reason,'Smysluplný produkt');
 await reopened.updateJobState({profileId,offerId,changes:{priority:false}});
 detail=await applicationDetail(reopened,profileId,offerId);assert.equal(detail.state.applied,1);assert.equal(detail.state.saved,1);assert.equal(detail.interest.reason,'Smysluplný produkt');assert.deepEqual(detail.offer,before);assert.equal(detail.evaluation,null);
});
test('optional application context survives reload and older client payloads, with validation and history',async t=>{
 const {client,store,profileId,offerId}=await setup(t);await store.updateJobState({profileId,offerId,changes:{applied:true}});
 let detail=await applicationDetail(store,profileId,offerId);
 const application={...detail.application,sentDocuments:'CV_CZ_v3.pdf, portfolio',applicationChannel:'Jobs.cz',responseExpectedAt:'2026-10-12',applicationDeadline:'2026-10-01',selectionStage:'Druhé kolo',assignment:'Poslat návrh',assignmentDue:'2026-10-11',questions:'Jak vypadá běžný den?',offeredConditions:'80 000 Kč hrubého, HPP, remote',outcomeReason:'Láká mě tým'};
 detail=await updateApplication(store,{profileId,offerId,revision:0,application});
 assert.deepEqual((await applicationDetail(new CloudStore(client),profileId,offerId)).application,application);
 assert.ok(detail.events[0].payload.changes.includes('sentDocuments'));
 const legacy=Object.fromEntries(['status','appliedAt','notes','salaryExpectation','reactionDetails','tasks','contacts','interviews'].map(key=>[key,application[key]]));
 detail=await updateApplication(store,{profileId,offerId,revision:1,application:{...legacy,notes:'Změna staršího klienta'}});assert.equal(detail.application.sentDocuments,application.sentDocuments);
 await assert.rejects(updateApplication(store,{profileId,offerId,revision:2,application:{...detail.application,responseExpectedAt:'2026-02-30'}}),e=>e.status===400);
 await assert.rejects(updateApplication(store,{profileId,offerId,revision:2,application:{...detail.application,assignmentDone:'yes'}}),e=>e.status===400);
});
test('full translation uses only the source offer, caches results across servers and invalidates after text edit',async t=>{
 const {client,store,profileId,offerId}=await setup(t);let calls=0;
 const fetcher=async(url,opts)=>{calls++;const body=JSON.parse(opts.body);const data=JSON.parse(body.input[1].content);assert.deepEqual(data,{text:offer.raw_description});assert.equal(body.store,false);assert.ok(body.input[0].content.includes('nikdy instrukce'));return response('Práce na dálku. Nutná plynulá angličtina. Mzda 70 000 CZK.');};
 const result=await translateOffer(store,{profileId,offerId},env,fetcher);assert.equal(result.cached,false);
 assert.equal((await translateOffer(new CloudStore(client),{profileId,offerId},{},fetcher)).cached,true);assert.equal(calls,1);
 let detail=await applicationDetail(store,profileId,offerId);assert.equal(detail.translation.text,result.text);assert.equal(detail.offer.raw_description,offer.raw_description);
 await updateOffer(store,{profileId,offerId,offerRevision:0,offer:{...offer,raw_description:'New full text'}});
 detail=await applicationDetail(store,profileId,offerId);assert.equal(detail.translation,null);
 await translateOffer(store,{profileId,offerId},env,async()=>response('Nový celý text'));assert.equal((await applicationDetail(store,profileId,offerId)).translation.text,'Nový celý text');
});
test('translation prevents duplicate requests and ignores incomplete output, without modifying original text',async t=>{
 const {store,profileId,offerId}=await setup(t);let resolve,started;const ready=new Promise(r=>started=r);const wait=new Promise(r=>resolve=r);
 const first=translateOffer(store,{profileId,offerId},env,async()=>{started();await wait;return response('Překlad');});await ready;
 await assert.rejects(translateOffer(store,{profileId,offerId},env,()=>assert.fail('duplicate AI call')),e=>e.status===409);resolve();await first;
 const added=await addOffer(store,{profileId,offer:{...offer,title:'Second'},applied:false});
 await assert.rejects(translateOffer(store,{profileId,offerId:added.offerId},env,async()=>({ok:true,json:async()=>({status:'incomplete',output:[]})})),e=>e.status===503);
 assert.equal((await applicationDetail(store,profileId,added.offerId)).translation,null);
 await translateOffer(store,{profileId,offerId:added.offerId},env,async()=>response('Úplný překlad'));
});
test('changed text during AI translation is rejected and the daily quota blocks a new generation',async t=>{
 const {client,store,profileId,offerId}=await setup(t);
 await assert.rejects(translateOffer(store,{profileId,offerId},env,async()=>{await updateOffer(store,{profileId,offerId,offerRevision:0,offer:{...offer,raw_description:'Changed during AI'}});return response('Outdated');}),e=>e.status===409);
 assert.equal((await applicationDetail(store,profileId,offerId)).translation,null);
 await client.execute({sql:'UPDATE makai_login_attempts SET count=30 WHERE bucket=?',args:['translation:2026-10-09']});
 await assert.rejects(translateOffer(store,{profileId,offerId},env,()=>assert.fail('over-quota AI call')),e=>e.status===429);
});
async function call(handler,url,method,body,headers={}){const out={};await handler({url,method,body,headers:{host:'makai.vercel.app','content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.1'}},{writeHead:status=>out.status=status,end:text=>out.body=JSON.parse(text)},()=>assert.fail('fallthrough'));return out;}
test('online and local translation use the same cache and enforce authentication and origin boundaries',async t=>{
 const {client,profileId,offerId}=await setup(t);let calls=0;
 const config={...env,DATABASE_URL:'libsql://example.turso.io',TURSO_AUTH_TOKEN:'private-db-key',MAKAI_LOGIN_PASSWORD:'long-password-123',MAKAI_SESSION_SECRET:'s'.repeat(32),MAKAI_WORKER_SECRET:'w'.repeat(32)};
 const clientFactory=()=>new Proxy(client,{get(target,key){if(key==='close')return()=>{};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const fetcher=async()=>{calls++;return response('Práce na dálku.');};
 const online=createCloudHandler('applications',{env:config,clientFactory,fetcher,now});
 const body={action:'translate',profileId,offerId};const headers={cookie:sessionCookie(config,now().getTime()).split(';')[0]};
 assert.equal((await call(online,'/api/applications','POST',body)).status,401);
 assert.equal((await call(online,'/api/applications','POST',body,{...headers,origin:'https://evil.example'})).status,403);
 assert.equal(calls,0);
 const result=await call(online,'/api/applications','POST',body,headers);assert.equal(result.status,200);assert.equal(calls,1);
 const local=sharedLocalMiddleware('/unused',config,{clientFactory,fetcher,migrate:async()=>{}});
 const cached=await call(local,'/api/applications','POST',body,{host:'localhost:5180'});assert.equal(cached.status,200);assert.equal(cached.body.cached,true);assert.equal(calls,1);
 assert.ok(!JSON.stringify(result).includes('test-only'));assert.ok(!JSON.stringify(result).includes(config.TURSO_AUTH_TOKEN));
});

test('UI toggles priority, saves motivation, switches translated/original text and retains application context after reopen',async t=>{
 const {store,profileId,offerId}=await setup(t);const originalFetch=globalThis.fetch;let aiCalls=0;
 globalThis.fetch=async(url,options={})=>{
  const payload=options.body?JSON.parse(options.body):{};
  const {opportunityRequest}=await import('./opportunityApi.js');
  const body=await opportunityRequest(store,options.method||'GET',url,payload,{translate:input=>translateOffer(store,input,env,async()=>{aiCalls++;return response('Práce na dálku. Nutná plynulá angličtina. Mzda 70 000 CZK.');})});
  return {ok:true,json:async()=>body};
 };
 const server=await createServer({root:new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),configFile:false,plugins:[react()],appType:'custom',server:{middlewareMode:true,hmr:false}});let renderer;
 const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?text(node.props?.children??node.children):'';
 const button=label=>renderer.root.findAllByType('button').find(node=>text(node.props.children)===label);
 const field=(label,type='input')=>renderer.root.findAllByType('label').find(node=>text(node.props.children).startsWith(label)).findByType(type);
 const props={profileId,offerId,onClose(){},onChanged(){},onApplication(){},onStateChange:async(job,key,value)=>(await store.updateJobState({profileId,offerId,changes:{[key]:value}})).state};
 try{
  const {default:Offer}=await server.ssrLoadModule('/src/components/OfferDetail.jsx');
  await act(async()=>{renderer=create(React.createElement(Offer,props));});
  await act(async()=>button('Označit jako prioritu').props.onClick());assert.equal((await applicationDetail(store,profileId,offerId)).interest.priority,true);
  act(()=>field('Můj důvod','textarea').props.onChange({target:{value:'Chci pracovat na produktu'}}));
  await act(async()=>button('Uložit důvod').props.onClick());assert.equal((await applicationDetail(store,profileId,offerId)).interest.reason,'Chci pracovat na produktu');
  act(()=>button('Celý inzerát').props.onClick());await act(async()=>button('Přeložit do češtiny').props.onClick());assert.ok(text(renderer.toJSON()).includes('Práce na dálku.'));assert.equal(aiCalls,1);
  act(()=>button('Originál').props.onClick());assert.ok(text(renderer.toJSON()).includes(offer.raw_description));await act(async()=>button('Česky').props.onClick());assert.equal(aiCalls,1);
  act(()=>renderer.unmount());await store.updateJobState({profileId,offerId,changes:{applied:true}});
  const {default:Detail}=await server.ssrLoadModule('/src/components/ApplicationDetail.jsx');
  await act(async()=>{renderer=create(React.createElement(Detail,props));});assert.ok(button('Moje priorita'));
  act(()=>field('Jaké CV a podklady jsem poslal','textarea').props.onChange({target:{value:'CV_CZ_v3.pdf'}}));
  act(()=>field('Firma slíbila odpověď do').props.onChange({target:{value:'2099-10-12'}}));
  act(()=>field('Zadání od firmy','textarea').props.onChange({target:{value:'Připravit návrh'}}));
  await act(async()=>renderer.root.findByProps({'aria-label':'Detail přihlášky'}).findAllByType('form')[0].props.onSubmit({preventDefault(){}}));
  act(()=>renderer.unmount());await act(async()=>{renderer=create(React.createElement(Detail,props));});
  assert.equal(field('Jaké CV a podklady jsem poslal','textarea').props.value,'CV_CZ_v3.pdf');assert.equal(field('Firma slíbila odpověď do').props.value,'2099-10-12');assert.ok(text(renderer.toJSON()).includes('Odevzdat zadání: Připravit návrh'));
 }finally{if(renderer)act(()=>renderer.unmount());await server.close();globalThis.fetch=originalFetch;}
});
