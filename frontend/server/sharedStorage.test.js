import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { CloudStore } from './cloudStore.js';
import { parseCloudProfile, profileTable } from './cloudProfile.js';
import { importSnapshot, migrateLocalData } from './sharedMigration.js';
import { sharedLocalMiddleware } from './sharedLocal.js';
import { createCloudHandler } from './cloudApi.js';
import { sessionCookie } from './cloudAuth.js';

const content = await readFile(new URL('../public/templates/candidate-profile-template.json', import.meta.url), 'utf8');
const row = (id = 'one') => ({ offer_id: id, offer: JSON.stringify({ id, title: 'Analyst', company: 'Example', url: 'https://example.com/' + id, raw_description: 'Real offer text' }),
  evaluation: JSON.stringify({ score: 85, verdict: 'STRONG_FIT', fit_reasons: ['Relevant experience', 'Suitable work'], gap_analysis: [], tailored_cv_highlights: [] }),
  evaluated_at: '2026-10-09T10:00:00Z' });
const snapshot = { name: 'Local profile', content, rows: [row()], selected: true };
async function setup(t) {
  const client = createClient({ url: 'file::memory:' });
  t.after(() => client.close());
  const store = new CloudStore(client); await store.initialize();
  return { store, client };
}
test('migration preserves local files, moves selected profile/history and is safe to repeat', async t => {
  const { store, client } = await setup(t);
  const root = await mkdtemp(join(tmpdir(), 'makai-shared-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = parseCloudProfile('Local profile', content);
  await mkdir(join(root, 'data', 'profiles', profile.id), { recursive: true });
  await writeFile(join(root, 'candidate_profile.md'), content + '\n');
  await writeFile(join(root, 'data', 'profiles', 'active.json'), JSON.stringify({ id: profile.id }));
  const profilePath = join(root, 'data', 'profiles', profile.id, 'profile.json');
  await writeFile(profilePath, JSON.stringify({ name: snapshot.name, content }));
  const historyPath = join(root, 'data', 'profiles', profile.id, 'results.json');
  const history = JSON.stringify({ saved_at: row().evaluated_at, results: [{ offer: JSON.parse(row().offer), evaluation: JSON.parse(row().evaluation) }] });
  await writeFile(historyPath, history);
  await migrateLocalData(store, root);
  assert.equal((await store.profile()).id, profile.id);
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM ' + profileTable(profile.id))).rows[0].n, 1);
  const repeated = await migrateLocalData(store, root);
  assert.equal(repeated.reduce((sum, item) => sum + item.inserted, 0), 0);
  assert.equal(await readFile(historyPath, 'utf8'), history);
  assert.equal(JSON.parse(await readFile(profilePath, 'utf8')).content, content);
});
test('legacy Turso history is copied, existing online results and selection are never overwritten', async t => {
  const { store, client } = await setup(t);
  const online = await store.saveProfile({ name: 'Online', content: content + '\n' });
  await store.saveSchedule({ ...await store.getSchedule(), enabled: true });
  await client.execute('CREATE TABLE makai_job_evaluations (offer_id TEXT PRIMARY KEY, offer TEXT, evaluation TEXT, evaluated_at TEXT)');
  const legacy = row('legacy');
  await client.execute({ sql: 'INSERT INTO makai_job_evaluations VALUES(?,?,?,?)', args: Object.values(legacy) });
  const first = await importSnapshot(store, { ...snapshot, legacy: true });
  assert.equal(first.inserted, 2);
  const table = profileTable(first.id);
  const changed = { ...row(), evaluation: JSON.stringify({ ...JSON.parse(row().evaluation), score: 90 }), evaluated_at: '2026-10-10T10:00:00Z' };
  assert.equal((await importSnapshot(store, { ...snapshot, rows: [changed] })).inserted, 0);
  const saved = (await client.execute("SELECT * FROM " + table + " WHERE offer_id='one'")).rows[0];
  assert.equal(saved.evaluation, row().evaluation); assert.equal(saved.evaluated_at, row().evaluated_at);
  assert.equal((await store.profile()).id, online.id);
  assert.equal((await store.getSchedule()).enabled, true);
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM makai_job_evaluations')).rows[0].n, 1);
  assert.equal((await store.profiles()).length, 2);
});
test('invalid imports roll back without affecting existing records or selecting another profile', async t => {
  const { store, client } = await setup(t);
  const online = await store.saveProfile({ name: 'Online', content: content + '\n' });
  await assert.rejects(importSnapshot(store, { ...snapshot, rows: [row(), { ...row('broken'), evaluation: '{}' }] }));
  assert.equal((await store.profiles()).length, 1);
  assert.equal((await store.profile()).id, online.id);
  assert.equal((await client.execute({ sql: "SELECT name FROM sqlite_master WHERE name=?", args: [profileTable(parseCloudProfile(snapshot.name, content).id)] })).rows.length, 0);
});
test('localhost and online API share the active profile, history, schedule and run queue', async t => {
  const { store, client } = await setup(t);
  await importSnapshot(store, snapshot);
  const env = { DATABASE_URL: 'libsql://example.turso.io', TURSO_AUTH_TOKEN: 'secret-db', MAKAI_LOGIN_PASSWORD: 'long-password-123', MAKAI_SESSION_SECRET: 's'.repeat(32), MAKAI_WORKER_SECRET: 'w'.repeat(32) };
  const clientFactory = () => new Proxy(client, { get(target, key) { if (key === 'close') return () => {}; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
  const local = sharedLocalMiddleware('/unused', env, { clientFactory, migrate: async () => {} });
  async function call(handler, url, method = 'GET', body, remote = false, headers = {}) {
    const result = {};
    await handler({ url, method, body, socket: { remoteAddress: '127.0.0.1' }, headers: { host: remote ? 'makai.vercel.app' : 'localhost:5174',
      'content-type': 'application/json', ...(remote ? { cookie: sessionCookie(env).split(';')[0] } : {}), ...headers } },
      { writeHead: status => { result.status = status; }, end: value => { result.body = JSON.parse(value); } }, () => { throw new Error('Unexpected fallthrough'); });
    return result;
  }
  const onlineProfile = createCloudHandler('profile', { env, clientFactory });
  assert.equal((await call(local, '/api/profile')).body.id, (await call(onlineProfile, '/api/profile', 'GET', undefined, true)).body.id);
  const onlineJobs = createCloudHandler('jobs', { env, clientFactory });
  assert.deepEqual((await call(local, '/api/jobs?view=paged')).body, (await call(onlineJobs, '/api/jobs?view=paged', 'GET', undefined, true)).body);
  const second = await store.saveProfile({ name: 'Second', content: content + '\n' });
  const original = parseCloudProfile(snapshot.name, content);
  assert.equal((await call(local, '/api/profile', 'PUT', { id: original.id })).status, 200);
  assert.equal((await call(onlineProfile, '/api/profile', 'GET', undefined, true)).body.id, original.id);
  assert.equal((await call(onlineProfile, '/api/profile', 'PUT', { id: second.id }, true)).status, 200);
  assert.equal((await call(local, '/api/profile')).body.id, second.id);
  const plan = (await call(local, '/api/schedule')).body;
  await call(local, '/api/schedule', 'PUT', { ...plan, enabled: true });
  assert.equal((await call(createCloudHandler('schedule', { env, clientFactory }), '/api/schedule', 'GET', undefined, true)).body.enabled, true);
  const queued = await call(local, '/api/hunt', 'POST', { profileId: second.id });
  assert.equal(queued.status, 202);
  assert.equal((await call(createCloudHandler('hunt', { env, clientFactory }), '/api/hunt', 'GET', undefined, true)).body.id, queued.body.id);
  assert.equal((await call(local, '/api/profile', 'PUT', { id: original.id })).status, 409);
  assert.equal((await call(local, '/api/profile', 'GET', undefined, false, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(createCloudHandler('profile', { env, clientFactory }), '/api/profile', 'GET', undefined, true, { cookie: '' })).status, 401);
  assert.ok(!JSON.stringify(queued).includes(env.TURSO_AUTH_TOKEN));
});
