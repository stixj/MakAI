import test from 'node:test';
import assert from 'node:assert/strict';
import { localJobsMiddleware } from './localJobs.js';

const config = { url: 'libsql://test.turso.io', authToken: 'private-backend-token' };
function request(updates = {}) {
  return { url: '/api/jobs', method: 'GET', headers: { host: 'localhost:4173' },
    socket: { remoteAddress: '127.0.0.1' }, ...updates };
}
async function invoke(req, factory, settings = config) {
  const result = { passed: false };
  await localJobsMiddleware(settings, factory)(req, {
    writeHead: (status, headers) => { Object.assign(result, { status, headers }); },
    end: body => { result.body = JSON.parse(body); },
  }, () => { result.passed = true; });
  return result;
}

test('local endpoint reads stored rows with SELECT only and never returns credentials', async () => {
  const statements = [];
  let closed = false;
  const rows = [{ offer_id: 'one', offer: '{}', evaluation: '{}', evaluated_at: '2026-10-09' }];
  const result = await invoke(request(), received => {
    assert.equal(received.authToken, config.authToken);
    return { execute: async statement => {
      statements.push(statement);
      return { rows: statements.length === 1 ? [{ name: 'makai_job_evaluations' }] : rows };
    }, close: () => { closed = true; } };
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { rows, nextOffset: null });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.ok(statements.every(statement => statement.sql.startsWith('SELECT')));
  assert.deepEqual(statements[1].args, [51, 0]);
  assert.equal(closed, true);
  assert.ok(!JSON.stringify(result).includes(config.authToken));
});

test('empty database returns empty rows and does not create a table', async () => {
  const result = await invoke(request(), () => ({ execute: async () => ({ rows: [] }), close() {} }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { rows: [], nextOffset: null });
});

test('external requests, DNS rebinding hosts, cross origins and writes never connect', async () => {
  let connected = false;
  for (const req of [request({ socket: { remoteAddress: '192.168.1.1' } }),
    request({ headers: { host: 'attacker.example:4173' } }),
    request({ headers: { host: 'localhost:4173', origin: 'https://attacker.example' } }),
    request({ method: 'POST' })]) {
    const result = await invoke(req, () => { connected = true; });
    assert.ok([403, 405].includes(result.status));
  }
  assert.equal(connected, false);
});

test('transport failure is redacted and closes the client', async () => {
  let closed = false;
  const result = await invoke(request(), () => ({ execute: async () => { throw new Error(config.authToken); },
    close: () => { closed = true; } }));
  assert.equal(result.status, 502);
  assert.ok(!JSON.stringify(result).includes(config.authToken));
  assert.equal(closed, true);
});

test('missing configuration is reported and unrelated routes pass through', async () => {
  const unexpected = () => { throw new Error('Should not connect'); };
  assert.equal((await invoke(request(), unexpected, {})).status, 503);
  assert.equal((await invoke(request({ url: '/' }), unexpected)).passed, true);
});


test('older history is paged without dropping the boundary row and invalid offsets do not connect', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ offer_id: String(i + 50) }));
  const statements = [];
  const result = await invoke(request({ url: '/api/jobs?offset=50' }), () => ({
    execute: async statement => { statements.push(statement); return { rows: statements.length === 1 ? [{ name: 'makai_job_evaluations' }] : rows }; }, close() {},
  }));
  assert.equal(result.body.rows.length, 50);
  assert.equal(result.body.nextOffset, 100);
  assert.deepEqual(statements[1].args, [51, 50]);
  assert.match(statements[1].sql, /ORDER BY evaluated_at DESC, offer_id ASC LIMIT \? OFFSET \?/);
  for (const offset of ['-1', 'oops', '1.5', '999999999999999999999']) {
    assert.equal((await invoke(request({ url: '/api/jobs?offset=' + offset }), () => { throw new Error('Should not connect'); })).status, 400);
  }
});
