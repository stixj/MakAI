import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler, dispatchWorker } from './cloudApi.js';
import { authenticated, sessionCookie } from './cloudAuth.js';
import { parseCloudProfile } from './cloudProfile.js';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';

const env = { DATABASE_URL: 'libsql://example.turso.io', TURSO_AUTH_TOKEN: 'private-db', MAKAI_LOGIN_PASSWORD: 'private-password-123', MAKAI_SESSION_SECRET: 's'.repeat(32), MAKAI_WORKER_SECRET: 'w'.repeat(32) };
const now = 1791514800000;
const cookie = sessionCookie(env, now).split(';')[0];
async function invoke(route, request = {}, options = {}) {
  const result = {};
  await createCloudHandler(route, { env, now: () => new Date(now), ...options })({ method: 'GET', url: `/api/${route}`, headers: { host: 'makai.vercel.app', ...request.headers }, ...request }, {
    writeHead: (status, headers) => Object.assign(result, { status, headers }),
    end: value => { result.body = JSON.parse(value); },
  });
  return result;
}
test('no profile, results or worker actions reach storage without authentication', async () => {
  let calls = 0;
  for (const route of ['profile', 'jobs', 'schedule', 'hunt', 'worker', 'profile-draft', 'profile-cv']) {
    const result = await invoke(route, { method: route === 'worker' ? 'POST' : 'GET' }, { clientFactory: () => { calls++; throw new Error(); } });
    assert.equal(result.status, 401);
  }
  assert.equal(calls, 0);
});
test('sessions are signed, expire, and reject tampering; cross-origin writes fail', async () => {
  assert.equal(authenticated({ headers: { cookie } }, env, now), true);
  assert.equal(authenticated({ headers: { cookie: cookie + 'x' } }, env, now), false);
  assert.equal(authenticated({ headers: { cookie } }, env, now + 604801000), false);
  const result = await invoke('hunt', { method: 'POST', headers: { cookie, host: 'makai.vercel.app', origin: 'https://evil.example' } });
  assert.equal(result.status, 403);
});
test('missing server configuration and SDK errors never expose secrets', async () => {
  const missing = await invoke('session', {}, { env: {} });
  assert.equal(missing.status, 503); assert.equal(missing.body.code, 'SETUP_REQUIRED');
  const broken = await invoke('schedule', { headers: { cookie } }, { clientFactory: () => { throw new Error('private-db at libsql://example.turso.io'); } });
  assert.equal(broken.status, 503); assert.ok(!JSON.stringify(broken).includes('private-db'));
});
test('manual dispatch sends only a workflow ref, preserves queue when GitHub is unavailable', async () => {
  const unconfigured = await dispatchWorker({});
  assert.equal(unconfigured.dispatch, 'scheduled');
  assert.match(unconfigured.notice, /MAKAI_GITHUB_TOKEN/);
  let seen;
  const dispatched = await dispatchWorker({ MAKAI_GITHUB_TOKEN: 'private-token' }, async (url, options) => { seen = { url, options }; return { ok: true }; });
  assert.equal(dispatched.dispatch, 'requested');
  assert.deepEqual(JSON.parse(seen.options.body), { ref: 'main' });
  assert.ok(!seen.options.body.includes('profile'));
  const failed = await dispatchWorker({ MAKAI_GITHUB_TOKEN: 'private-token' }, async () => { throw new Error(); });
  assert.equal(failed.dispatch, 'scheduled');
  assert.match(failed.notice, /Actions: write/);
});
test('profile parser preserves context and rejects invalid salary, SQL ids and personal CV injection', async () => {
  const raw = await readFile(new URL('../public/templates/candidate-profile-template.json', import.meta.url), 'utf8');
  const content = '# Profile\n\n```json\n' + raw + '\n```\n\nMy experience';
  const profile = parseCloudProfile('Mine', content);
  assert.equal(profile.content, content); assert.equal(profile.id.length, 64);
  const data = JSON.parse(raw);
  assert.throws(() => parseCloudProfile('Mine', JSON.stringify({ ...data, cv_source: 'another person' })));
  assert.throws(() => parseCloudProfile('Mine', JSON.stringify({ ...data, salary: { ...data.salary, standard_minimum_czk: -1 } })));
});

test('real API login, profile, plan, manual queue and worker result flow use only server credentials', async t => {
  const client = createClient({ url: 'file::memory:' });
  t.after(() => client.close());
  const options = { clientFactory: () => ({ execute: statement => client.execute(statement), batch: (...args) => client.batch(...args), transaction: mode => client.transaction(mode), close() {} }) };
  const headers = { host: 'makai.vercel.app', origin: 'https://makai.vercel.app', 'content-type': 'application/json' };
  const bad = await invoke('session', { method: 'POST', headers, body: { password: 'bad' } }, options);
  assert.equal(bad.status, 401);
  const login = await invoke('session', { method: 'POST', headers, body: { password: env.MAKAI_LOGIN_PASSWORD } }, options);
  assert.equal(login.status, 200); assert.ok(login.headers['Set-Cookie'].includes('HttpOnly'));
  const authHeaders = { ...headers, cookie: login.headers['Set-Cookie'].split(';')[0] };
  const raw = await readFile(new URL('../public/templates/candidate-profile-template.json', import.meta.url), 'utf8');
  const upload = await invoke('profile', { method: 'POST', headers: authHeaders, body: { name: 'Test', content: raw } }, options);
  assert.equal(upload.status, 200);
  const schedule = await invoke('schedule', { headers: authHeaders }, options);
  assert.equal(schedule.body.enabled, false);
  const start = await invoke('hunt', { method: 'POST', headers: authHeaders, body: { ...schedule.body, profileId: upload.body.id } }, options);
  assert.equal(start.status, 202);
  assert.equal(start.body.dispatch, 'scheduled');
  let dispatchRequest;
  const retry = await invoke('hunt', { method: 'POST', headers: authHeaders, body: { action: 'dispatch' } }, {
    ...options, env: { ...env, MAKAI_GITHUB_TOKEN: 'private-token' },
    fetcher: async (url, request) => { dispatchRequest = { url, request }; return { ok: true }; },
  });
  assert.equal(retry.status, 202);
  assert.equal(retry.body.id, start.body.id);
  assert.equal(retry.body.dispatch, 'requested');
  assert.deepEqual(JSON.parse(dispatchRequest.request.body), { ref: 'main' });
  const workerHeaders = { authorization: `Bearer ${env.MAKAI_WORKER_SECRET}`, 'content-type': 'application/json' };
  const claim = await invoke('worker', { method: 'POST', headers: workerHeaders, body: { action: 'claim' } }, options);
  assert.equal(claim.status, 200);
  assert.equal(claim.body.run.profile.id, upload.body.id);
  const done = await invoke('worker', { method: 'POST', headers: workerHeaders, body: { action: 'finish', ...claim.body.run, status: 'done', result: { found: 0, evaluated: 0, saved: 0, errors: [] } } }, options);
  assert.equal(done.status, 200);
  const state = await invoke('hunt', { headers: authHeaders }, options);
  assert.equal(state.body.status, 'done');
  assert.ok(!JSON.stringify(state.body).includes('private-db'));
  const jobs = await invoke('jobs', { headers: authHeaders, url: '/api/jobs?view=paged' }, options);
  assert.equal(jobs.status, 200); assert.deepEqual(jobs.body.rows, []);
});

test('password change requires current credentials, stores only hash and revokes previous sessions', async () => {
  const client = createClient({ url: 'file::memory:' });
  const options = {};
  // Keep prototype methods on the real SDK client while suppressing per-request close.
  options.clientFactory = () => new Proxy(client, { get(target, key) { if (key === 'close') return () => {}; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
  const jsonHeaders = { cookie, host: 'makai.vercel.app', 'content-type': 'application/json' };
  try {
    assert.equal((await invoke('session', { method: 'PUT', headers: { ...jsonHeaders, cookie: '' }, body: {} }, options)).status, 401);
    assert.equal((await invoke('session', { method: 'PUT', headers: jsonHeaders, body: { password: 'wrong', newPassword: 'changed-password-456' } }, options)).status, 401);
    assert.equal((await invoke('session', { method: 'PUT', headers: jsonHeaders, body: { password: env.MAKAI_LOGIN_PASSWORD, newPassword: 'short' } }, options)).status, 400);
    const changed = await invoke('session', { method: 'PUT', headers: jsonHeaders, body: { password: env.MAKAI_LOGIN_PASSWORD, newPassword: 'changed-password-456' } }, options);
    assert.equal(changed.status, 200);
    const stored = (await client.execute('SELECT * FROM makai_auth')).rows[0];
    assert.ok(!stored.password_hash.includes('changed-password-456'));
    assert.equal((await invoke('session', { headers: { cookie } }, options)).body.authenticated, false);
    assert.equal((await invoke('profile', { headers: { cookie } }, options)).status, 401);
    const freshCookie = changed.headers['Set-Cookie'].split(';')[0];
    assert.equal((await invoke('session', { headers: { cookie: freshCookie } }, options)).body.authenticated, true);
    const login = password => invoke('session', { method: 'POST', headers: jsonHeaders, body: { password } }, options);
    assert.equal((await login(env.MAKAI_LOGIN_PASSWORD)).status, 401);
    assert.equal((await login('changed-password-456')).status, 200);
  } finally { client.close(); }
});
