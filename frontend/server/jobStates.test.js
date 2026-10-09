import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { readFile } from 'node:fs/promises';
import { CloudStore } from './cloudStore.js';
import { profileTable } from './cloudProfile.js';
import { createCloudHandler } from './cloudApi.js';
import { sharedLocalMiddleware } from './sharedLocal.js';
import { importSnapshot } from './sharedMigration.js';
import { sessionCookie } from './cloudAuth.js';

const content = await readFile(new URL('../public/templates/candidate-profile-template.json', import.meta.url), 'utf8');
const makeRow = id => ({ offer_id: id, offer: JSON.stringify({ id, title: 'Analyst ' + id, company: 'Example', url: 'https://example.com/' + id, raw_description: 'Offer text' }),
  evaluation: JSON.stringify({ score: 85, verdict: 'STRONG_FIT', fit_reasons: ['Experience matches', 'Conditions match'], gap_analysis: [], tailored_cv_highlights: [] }), evaluated_at: '2026-10-09T10:00:00Z' });
async function setup(t) {
  const client = createClient({ url: 'file::memory:' }); t.after(() => client.close());
  const store = new CloudStore(client); await store.initialize();
  const imported = await importSnapshot(store, { name: 'Mine', content, selected: true, rows: Array.from({ length: 17 }, (_, i) => makeRow(String(i))) });
  return { client, store, profileId: imported.id };
}
test('independent reversible states persist without changing offers, scores or evaluation dates', async t => {
  const { client, store, profileId } = await setup(t);
  const table = profileTable(profileId);
  const before = (await client.execute('SELECT * FROM ' + table + ' ORDER BY offer_id')).rows;
  const patch = changes => store.updateJobState({ profileId, offerId: '0', changes });
  await patch({ saved: true });
  const anotherServer = new CloudStore(client);
  const applied = await anotherServer.updateJobState({ profileId, offerId: '0', changes: { applied: true } });
  assert.deepEqual(applied.state, { saved: true, applied: true, hidden: false, priority: false });
  assert.deepEqual((await patch({ hidden: true })).state, { saved: true, applied: true, hidden: true, priority: false });
  assert.deepEqual((await patch({ hidden: false })).state, { saved: true, applied: true, hidden: false, priority: false });
  assert.deepEqual((await patch({ saved: false, applied: false })).state, { saved: false, applied: false, hidden: false, priority: false });
  assert.deepEqual((await client.execute('SELECT * FROM ' + table + ' ORDER BY offer_id')).rows, before);
});
test('state writes reject missing offers, invalid fields and stale profile selections', async t => {
  const { store, profileId } = await setup(t);
  for (const changes of [{}, { score: 0 }, { saved: 1 }, { hidden: 'true' }])
    await assert.rejects(store.updateJobState({ profileId, offerId: '0', changes }), error => error.status === 400);
  await assert.rejects(store.updateJobState({ profileId, offerId: 'missing', changes: { saved: true } }), error => error.status === 404);
  const second = await store.saveProfile({ name: 'Second', content: content + '\n' });
  await assert.rejects(store.updateJobState({ profileId, offerId: '0', changes: { saved: true } }), error => error.status === 409);
  assert.deepEqual(await store.jobStates(profileId), []);
  assert.deepEqual(await store.jobStates(second.id), []);
});
test('online and localhost share filtering before pagination; hidden offers remain recoverable', async t => {
  const { client, store, profileId } = await setup(t);
  const env = { DATABASE_URL: 'libsql://example.turso.io', TURSO_AUTH_TOKEN: 'private-db', MAKAI_LOGIN_PASSWORD: 'long-password-123', MAKAI_SESSION_SECRET: 's'.repeat(32), MAKAI_WORKER_SECRET: 'w'.repeat(32) };
  const clientFactory = () => new Proxy(client, { get(target, key) { if (key === 'close') return () => {}; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
  const online = createCloudHandler('jobs', { env, clientFactory });
  const local = sharedLocalMiddleware('/unused', env, { clientFactory, migrate: async () => {} });
  async function call(handler, url, method = 'GET', body, remote = false, extra = {}) {
    const result = {};
    await handler({ url, method, body, socket: { remoteAddress: '127.0.0.1' }, headers: { host: remote ? 'makai.vercel.app' : 'localhost:5174', 'content-type': 'application/json',
      ...(remote ? { cookie: sessionCookie(env).split(';')[0] } : {}), ...extra } },
      { writeHead: status => { result.status = status; }, end: value => { result.body = JSON.parse(value); } }, () => { throw new Error('Unexpected fallthrough'); });
    return result;
  }
  for (let i = 0; i < 14; i++) {
    const saved = await call(local, '/api/jobs', 'PATCH', { profileId, offerId: String(i), changes: { saved: true } });
    assert.equal(saved.status, 200);
  }
  const page1 = await call(online, '/api/jobs?view=paged&collection=saved&pageSize=6', 'GET', undefined, true);
  const page2 = await call(local, '/api/jobs?view=paged&collection=saved&pageSize=6&page=2');
  assert.equal(page1.body.total, 14); assert.equal(page2.body.rows.length, 6);
  assert.equal(new Set([...page1.body.rows, ...page2.body.rows].map(row => row.offer_id)).size, 12);
  assert.ok(page1.body.rows.every(row => row.state.saved));
  await call(online, '/api/jobs', 'PATCH', { profileId, offerId: '0', changes: { hidden: true, applied: true } }, true);
  const active = await call(local, '/api/jobs?view=paged&pageSize=48');
  assert.equal(active.body.total, 16); assert.equal(active.body.totalStored, 17);
  assert.ok(!active.body.rows.some(row => row.offer_id === '0'));
  assert.equal((await call(local, '/api/jobs?view=paged&collection=saved')).body.total, 13);
  const hidden = await call(local, '/api/jobs?view=paged&collection=hidden');
  assert.equal(hidden.body.total, 1);
  assert.deepEqual(hidden.body.rows[0].state, { saved: true, applied: true, hidden: true, priority: false });
  await call(local, '/api/jobs', 'PATCH', { profileId, offerId: '0', changes: { hidden: false, priority: false } });
  assert.equal((await call(online, '/api/jobs?view=paged&collection=applied', 'GET', undefined, true)).body.total, 1);
  assert.equal((await call(local, '/api/jobs?view=paged&collection=saved')).body.total, 14);
  assert.equal((await call(local, '/api/jobs?view=paged&collection=unknown')).status, 400);
  assert.equal((await call(online, '/api/jobs', 'PATCH', { profileId, offerId: '0', changes: { saved: false } }, true, { cookie: '' })).status, 401);
  assert.equal((await call(local, '/api/jobs', 'PATCH', { profileId, offerId: '0', changes: { saved: false } }, false, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await store.jobStates(profileId)).length, 14);
});
