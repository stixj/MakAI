import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pythonBridge, localProfilesMiddleware } from './localProfiles.js';

function request(route, method = 'GET', payload = {}, updates = {}) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), {
    url: route, method, headers: { host: 'localhost:4173', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' }, ...updates,
  });
}
async function invoke(middleware, req) {
  const result = {};
  await middleware(req, { writeHead: status => { result.status = status; },
    end: body => { result.body = JSON.parse(body); } }, () => { result.passed = true; });
  return result;
}

test('default jobs continue to Turso while uploaded profile gets isolated rows', async () => {
  let custom = false;
  const calls = [];
  const middleware = localProfilesMiddleware('root', async (root, action, payload) => {
    calls.push([action, payload]);
    return action === 'profile' ? { id: custom ? 'other' : 'default', isDefault: !custom } : { rows: [{ offer_id: 'other-job' }] };
  });
  assert.equal((await invoke(middleware, request('/api/jobs'))).passed, true);
  custom = true;
  const result = await invoke(middleware, request('/api/jobs'));
  assert.equal(result.body.rows[0].offer_id, 'other-job');
  assert.deepEqual(calls.at(-1), ['rows', { profileId: 'other', offset: 0, limit: 50 }]);
});

test('remote and cross origin profile writes never reach the backend', async () => {
  let called = false;
  const middleware = localProfilesMiddleware('root', async () => { called = true; });
  for (const updates of [{ socket: { remoteAddress: '192.168.0.2' } },
    { headers: { host: 'localhost:4173', origin: 'https://example.com' } }]) {
    assert.equal((await invoke(middleware, request('/api/profile', 'POST', {}, updates))).status, 403);
  }
  assert.equal(called, false);
});

test('search captures active profile, rejects stale profile and blocks switches and duplicate starts', async () => {
  let finish;
  const middleware = localProfilesMiddleware('root', async (root, action, payload) => {
    if (action === 'profile') return { id: 'default', isDefault: true };
    if (action === 'hunt') { assert.equal(payload.profileId, 'default'); assert.equal(payload.portals, undefined); return new Promise(resolve => { finish = resolve; }); }
    throw new Error('Unexpected mutation');
  });
  assert.equal((await invoke(middleware, request('/api/hunt', 'POST', { profileId: 'stale' }))).status, 409);
  assert.equal((await invoke(middleware, request('/api/hunt', 'POST', { profileId: 'default' }))).status, 202);
  assert.equal((await invoke(middleware, request('/api/profile', 'DELETE'))).status, 409);
  assert.equal((await invoke(middleware, request('/api/hunt', 'POST', { profileId: 'default' }))).status, 409);
  finish({ errors: [], evaluated: 2, saved: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await invoke(middleware, request('/api/hunt'))).body.status, 'done');
});

test('draft generation does not activate a profile and concurrent generation is blocked', async () => {
  const calls = [];
  let finish;
  const middleware = localProfilesMiddleware('root', async (root, action) => {
    calls.push(action);
    if (action === 'builder-config') return { configured: true, provider: 'OpenAI' };
    if (action === 'generate-profile') return new Promise(resolve => { finish = resolve; });
    throw new Error('Unexpected activation');
  });
  assert.equal((await invoke(middleware, request('/api/profile/draft'))).body.configured, true);
  const pending = invoke(middleware, request('/api/profile/draft', 'POST', { career_goal: 'Účetní' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await invoke(middleware, request('/api/profile/draft', 'POST'))).status, 409);
  finish({ profile: { target_roles: ['Účetní'] }, context: 'Návrh', missingInformation: [] });
  assert.equal((await pending).status, 200);
  assert.deepEqual(calls, ['builder-config', 'generate-profile']);
});


test('search forwards selected publication window and rejects unsupported windows before starting', async () => {
  const calls = [];
  const middleware = localProfilesMiddleware('root', async (root, action, payload) => {
    if (action === 'profile') return { id: 'default', isDefault: true };
    calls.push(payload);
    return { errors: [], evaluated: 0, saved: 0 };
  });
  assert.equal((await invoke(middleware, request('/api/hunt', 'POST', { profileId: 'default', period: 'yesterday' }))).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await invoke(middleware, request('/api/hunt', 'POST', { profileId: 'default', period: '24h', includeUnknownDates: true, limit: 5 }))).status, 202);
  assert.deepEqual(calls[0], { profileId: 'default', period: '24h', includeUnknownDates: true, limit: 5 });
});


test('blocked AI evaluation is not reported as completed with zero results', async () => {
  const middleware = localProfilesMiddleware('root', async (root, action) => action === 'profile'
    ? { id: 'default', isDefault: true }
    : { found: 40, evaluated: 0, saved: 0, errors: ['Gemini: vyčerpán denní limit'],
        evaluationBlocked: { kind: 'daily_quota', message: 'Gemini: vyčerpán denní limit', notEvaluated: 40 } });
  await invoke(middleware, request('/api/hunt', 'POST', { profileId: 'default' }));
  await new Promise(resolve => setImmediate(resolve));
  const status = (await invoke(middleware, request('/api/hunt'))).body;
  assert.equal(status.status, 'blocked');
  assert.equal(status.result.found, 40);
  assert.equal(status.result.evaluationBlocked.kind, 'daily_quota');
});


test('stop aborts the active worker, locks new starts until exit, and allows a new run afterwards',async()=>{
 let signal,fail;
 const middleware=localProfilesMiddleware('root',async(root,action,payload,options)=>{
 if(action==='profile') return {id:'default',isDefault:true};
 assert.equal(action,'hunt');signal=options.signal;
 return new Promise((resolve,reject)=>{fail=reject;});
 });
 await invoke(middleware,request('/api/hunt','POST',{profileId:'default'}));
 const stop=await invoke(middleware,request('/api/hunt','DELETE'));
 assert.equal(stop.status,202);assert.equal(stop.body.status,'stopping');assert.equal(signal.aborted,true);
 assert.equal((await invoke(middleware,request('/api/hunt','POST',{profileId:'default'}))).status,409);
 assert.equal((await invoke(middleware,request('/api/profile','DELETE'))).status,409);
 fail(new Error('worker exited'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await invoke(middleware,request('/api/hunt'))).body.status,'cancelled');
 assert.equal((await invoke(middleware,request('/api/hunt','DELETE'))).status,200);
 assert.equal((await invoke(middleware,request('/api/hunt','POST',{profileId:'default'}))).status,202);
 fail(new Error('cleanup'));await new Promise(resolve=>setImmediate(resolve));
});

test('bridge cancellation actually terminates a child process before reporting completion',async()=>{
 const controller=new AbortController();let worker;
 const promise=pythonBridge('unused','hunt',{}, {signal:controller.signal,timeout:5000,spawnProcess:()=>{
 worker=spawn(process.execPath,['-e',"process.stdin.resume(); setInterval(()=>{},1000)"],{windowsHide:true,stdio:['pipe','pipe','pipe']});return worker;
 }});
 const result=assert.rejects(promise,error=>error.name==='AbortError');
 await once(worker,'spawn');controller.abort();await result;
 assert.ok(worker.exitCode!==null || worker.signalCode!==null);
});

test('cross origin stop never reaches or cancels a worker',async()=>{
 let calls=0;const middleware=localProfilesMiddleware('root',async()=>{calls++;});
 assert.equal((await invoke(middleware,request('/api/hunt','DELETE',{}, {headers:{host:'localhost:4173',origin:'https://example.com'}}))).status,403);
 assert.equal(calls,0);
});
