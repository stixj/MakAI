import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { CloudStore } from './cloudStore.js';
import { profileTable } from './cloudProfile.js';

const content = await readFile(new URL('../public/templates/candidate-profile-template.json', import.meta.url), 'utf8');
async function setup(t) {
  const url = 'file::memory:';
  const client = createClient({ url });
  let instant = new Date('2026-10-09T03:00:00Z');
  const store = new CloudStore(client, { now: () => instant });
  await store.initialize();
  const profile = await store.saveProfile({ name: 'Test profile', content });
  t.after(() => client.close());
  return { store, client, url, profile, time: value => { instant = new Date(value); } };
}
test('schedule persists across server instances, stale edits fail, profile changes pause automation', async t => {
  const { store, client, profile } = await setup(t);
  const schedule = await store.getSchedule();
  const saved = await store.saveSchedule({ ...schedule, enabled: true });
  assert.equal(saved.nextAt, '2026-10-09T03:30:00.000Z');
  assert.equal((await new CloudStore(client).getSchedule()).enabled, true);
  await assert.rejects(store.saveSchedule(schedule), error => error.status === 409);
  const other = await store.saveProfile({ name: 'Changed', content: content.replace('Účetní', 'Analytik') });
  assert.notEqual(other.id, profile.id);
  assert.notEqual(profileTable(other.id), profileTable(profile.id));
  assert.equal((await store.getSchedule()).enabled, false);
  assert.equal((await store.getSchedule()).nextAt, null);
});
test('manual and automatic searches share one persistent queue and immutable snapshots', async t => {
  const { store, profile } = await setup(t);
  const run = await store.manual({ profileId: profile.id });
  await assert.rejects(store.manual({ profileId: profile.id }), error => error.status === 409);
  await assert.rejects(store.saveProfile({ name: 'Changed', content }), error => error.status === 409);
  const claimed = await store.claim();
  assert.equal(claimed.id, run.id);
  assert.equal(claimed.profile.content, content);
  assert.equal(await store.claim(), null);
  await assert.rejects(store.finish({ id: run.id, token: 'wrong', status: 'done', result: { errors: [], found: 1, saved: 1, evaluated: 1 } }), error => error.status === 409);
  await store.finish({ id: claimed.id, token: claimed.token, status: 'done', result: { errors: [], found: 1, saved: 1, evaluated: 1 } });
  assert.equal((await store.runs())[0].status, 'done');
});
test('scheduled slot runs once and delayed ticks coalesce instead of replaying every missed slot', async t => {
  const { store, time } = await setup(t);
  await store.saveSchedule({ ...await store.getSchedule(), enabled: true, times: ['05:30', '06:00', '07:00'] });
  time('2026-10-09T05:10:00Z');
  const run = await store.claim();
  assert.ok(run);
  assert.equal((await store.runs()).length, 1);
  assert.equal((await store.runs())[0].source, 'scheduled');
  assert.equal((await store.getSchedule()).nextAt, '2026-10-12T03:30:00.000Z');
  assert.equal(await store.claim(), null);
});
test('repeated autumn wall-clock time does not evaluate twice', async t => {
  const { store, time } = await setup(t);
  time('2026-10-24T23:00:00Z');
  await store.saveSchedule({ ...await store.getSchedule(), enabled: true, days: [0], times: ['02:30'] });
  time('2026-10-25T00:37:00Z');
  const run = await store.claim();
  await store.finish({ ...run, status: 'done', result: { errors: [], found: 0, saved: 0, evaluated: 0 } });
  time('2026-10-25T01:37:00Z');
  assert.equal(await store.claim(), null);
  assert.equal((await store.runs()).length, 1);
});
test('daily budget includes manual runs and resets at the selected timezone midnight', async t => {
  const { store, time } = await setup(t);
  await store.saveSchedule({ ...await store.getSchedule(), maxDailyRuns: 1 });
  await store.manual({}); const run = await store.claim();
  await store.finish({ ...run, status: 'error' });
  await assert.rejects(store.manual({}), error => error.status === 429);
  time('2026-10-09T22:01:00Z');
  assert.equal((await store.manual({})).status, 'queued');
});
test('queued cancellation is immediate, running cancellation locks until worker acknowledgement', async t => {
  const { store } = await setup(t);
  await store.manual({}); assert.equal((await store.stop()).status, 'cancelled');
  await store.manual({}); const run = await store.claim();
  assert.equal((await store.stop()).status, 'stopping');
  assert.equal((await store.workerStatus(run.id, run.token)).status, 'stopping');
  await assert.rejects(store.manual({}), error => error.status === 409);
  await store.finish({ ...run, status: 'done', result: { errors: [], found: 1, evaluated: 1, saved: 1 } });
  assert.ok((await store.runs()).some(item => item.id === run.id && item.status === 'cancelled'));
  assert.equal((await store.manual({})).status, 'queued');
});
test('lost workers expire, old leases cannot overwrite a later run', async t => {
  const { store, time } = await setup(t);
  await store.manual({}); const old = await store.claim();
  time('2026-10-09T03:46:00Z');
  assert.equal((await store.runs())[0].status, 'error');
  await store.manual({}); const current = await store.claim();
  assert.notEqual(old.id, current.id);
  await assert.rejects(store.finish({ ...old, status: 'error' }), error => error.status === 409);
  assert.equal((await store.workerStatus(current.id, current.token)).status, 'running');
});
