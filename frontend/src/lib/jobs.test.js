import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJobRows, filterJobs, parseJobRow, safeOfferUrl, formatDate } from './jobs.js';
import { loadJobs, getTursoConfig } from './turso.js';

const config = { url: 'libsql://test.turso.io', authToken: 'test-only-token' };
function row(score = 80, verdict = 'STRONG_FIT') {
  return { offer_id: 'one', offer: JSON.stringify({ id: 'one', title: 'Procesní analytik', company: 'Tým', url: 'https://example.com/job', raw_description: 'Popis nabídky', published_at: '2026-01-01T09:00:00Z' }),
    evaluation: JSON.stringify({ score, verdict, fit_reasons: ['Důvod 1', 'Důvod 2'], gap_analysis: [], tailored_cv_highlights: [] }),
    evaluated_at: '2026-01-02T09:00:00Z' };
}
test('reads persisted backend JSON and all score boundaries', () => {
  for (const [score, verdict] of [[0, 'NO_GO'], [49, 'NO_GO'], [50, 'POTENTIAL_FIT'], [79, 'POTENTIAL_FIT'], [80, 'STRONG_FIT'], [100, 'STRONG_FIT']]) {
    assert.equal(parseJobRow(row(score, verdict)).evaluation.verdict, verdict);
  }
});
test('corrupt JSON and inconsistent verdicts are reported without dropping valid rows', () => {
  const result = decodeJobRows([row(), { ...row(), offer: '{' }, row(50, 'STRONG_FIT'), { ...row(), offer_id: 'mismatch' }, row(101)]);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.invalidCount, 4);
});
test('untrusted values cannot create executable or credentialed links', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,<script>', '//example.com', 'https://user:password@example.com', null]) assert.equal(safeOfferUrl(value), null);
  assert.equal(safeOfferUrl('https://example.com/job'), 'https://example.com/job');
  const bad = row();
  bad.offer = JSON.stringify({ ...JSON.parse(bad.offer), url: 'javascript:alert(1)' });
  assert.throws(() => parseJobRow(bad));
});
test('search ignores Czech accents, combines with verdict, and preserves original order', () => {
  const strong = parseJobRow(row());
  const potential = { ...parseJobRow(row(50, 'POTENTIAL_FIT')), id: 'two' };
  const original = [potential, strong];
  assert.deepEqual(filterJobs(original, { search: 'procesni', verdict: 'STRONG_FIT' }), [strong]);
  assert.deepEqual(filterJobs(original).map(job => job.id), ['one', 'two']);
  assert.deepEqual(original.map(job => job.id), ['two', 'one']);
});
test('formats SQLite UTC timestamps and handles invalid dates', () => {
  assert.equal(formatDate('2026-01-01 23:30:00'), formatDate('2026-01-02T00:30:00+01:00'));
  assert.equal(formatDate('bad-date'), 'Datum neuvedeno');
});
test('configuration is independent of Python environment and validated before requests', async () => {
  assert.deepEqual(getTursoConfig({ DATABASE_URL: 'libsql://backend', TURSO_AUTH_TOKEN: 'private' }), { url: '', authToken: '' });
  let called = false;
  for (const bad of [{ url: '', authToken: '' }, { ...config, url: 'file:local.db' }, { ...config, url: 'https://test.turso.io/path' }]) {
    await assert.rejects(loadJobs(bad, () => { called = true; }));
  }
  assert.equal(called, false);
});
test('empty database is read without creating a table', async () => {
  const statements = [];
  let closed = false;
  const result = await loadJobs(config, () => ({
    execute: async statement => { statements.push(statement); return { rows: [] }; },
    close: () => { closed = true; },
  }));
  assert.deepEqual(result.jobs, []);
  assert.equal(statements.length, 1);
  assert.ok(statements[0].sql.startsWith('SELECT'));
  assert.equal(closed, true);
});
test('database reader is read only, closes client, and redacts transport failures', async () => {
  const statements = [];
  let closed = false;
  const result = await loadJobs(config, () => ({
    execute: async statement => { statements.push(statement); return { rows: statements.length === 1 ? [{ name: 'makai_job_evaluations' }] : [row()] }; },
    close: () => { closed = true; },
  }));
  assert.equal(result.jobs.length, 1);
  assert.ok(statements.every(statement => statement.sql.startsWith('SELECT')));
  assert.deepEqual(statements[1].args, [500]);
  assert.equal(closed, true);
  closed = false;
  await assert.rejects(loadJobs(config, () => ({
    execute: async () => { throw new Error('secret-token-server-response'); },
    close: () => { closed = true; },
  })), error => !error.message.includes('secret-token') && error.message.includes('nepodařilo'));
  assert.equal(closed, true);
});

test('newest sorting compares SQLite UTC and ISO offsets consistently', () => {
  const later = { ...parseJobRow(row()), id: 'later', evaluatedAt: '2026-01-01 23:30:00' };
  const earlier = { ...parseJobRow(row()), id: 'earlier', evaluatedAt: '2026-01-02T00:00:00+01:00' };
  assert.deepEqual(filterJobs([earlier, later], { sort: 'newest' }).map(job => job.id), ['later', 'earlier']);
});
test('real web SDK converts libsql URL to HTTPS and decodes persisted JSON via mocked HTTP', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let executeCount = 0;
  globalThis.fetch = async (request) => {
    assert.equal(new URL(request.url).protocol, 'https:');
    assert.equal(request.headers.get('Authorization'), 'Bearer test-only-token');
    const body = JSON.parse(await request.text());
    requests.push(...body.requests);
    const results = body.requests.map(item => {
      if (item.type === 'close') return { type: 'ok', response: { type: 'close' } };
      assert.equal(item.type, 'execute');
      executeCount += 1;
      const source = row();
      const cols = executeCount === 1 ? ['name'] : ['offer_id', 'offer', 'evaluation', 'evaluated_at'];
      const values = executeCount === 1 ? ['makai_job_evaluations'] : cols.map(key => source[key]);
      return { type: 'ok', response: { type: 'execute', result: {
        cols: cols.map(name => ({ name, decltype: 'TEXT' })),
        rows: [values.map(value => ({ type: 'text', value }))],
        affected_row_count: 0, last_insert_rowid: null,
      } } };
    });
    return new Response(JSON.stringify({ baton: null, base_url: null, results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await loadJobs(config);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].offer.title, 'Procesní analytik');
    assert.equal(executeCount, 2);
    assert.ok(requests.filter(item => item.type === 'execute').every(item => item.stmt.sql.startsWith('SELECT')));
  } finally { globalThis.fetch = originalFetch; }
});
