import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJobRows, filterJobs, paginateJobs, pageNumbers, getOfferSources, parseJobRow, safeOfferUrl, formatDate } from './jobs.js';
import { loadJobs, getTursoConfig, hasJobSource, loadLocalJobs, loadHistoryPage } from './turso.js';

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

test('portal links accept arrays or JSON and keep one valid link per portal', () => {
  const sources = [
    { portal: ' Jobs.cz ', url: 'https://www.jobs.cz/rpd/123/' },
    { portal: 'jobs.cz', url: 'https://www.jobs.cz/rpd/456/' },
    { portal: 'Prace.cz', url: 'https://www.prace.cz/nabidka/123/' },
    { portal: 'Unsafe', url: 'javascript:alert(1)' },
    { portal: 'Credentialed', url: 'https://user:password@example.com' },
    null, {},
  ];
  const expected = [
    { portal: 'Jobs.cz', url: 'https://www.jobs.cz/rpd/123/' },
    { portal: 'Prace.cz', url: 'https://www.prace.cz/nabidka/123/' },
  ];
  for (const value of [sources, JSON.stringify(sources)]) {
    assert.deepEqual(getOfferSources({ sources: value, url: 'https://example.com/job' }), expected);
  }
});

test('missing, empty or malformed sources fall back to the original safe URL', () => {
  for (const sources of [undefined, null, [], '', 'invalid JSON', 'null', '{}', 123,
    [{ portal: 'Jobs.cz', url: 'javascript:alert(1)' }]]) {
    assert.deepEqual(getOfferSources({ sources, url: 'https://www.jobs.cz/rpd/123/' }),
      [{ portal: 'jobs.cz', url: 'https://www.jobs.cz/rpd/123/' }]);
  }
  assert.deepEqual(getOfferSources({ url: 'javascript:alert(1)' }), []);
  assert.deepEqual(getOfferSources({ sources: '{"portal":"Jobs.cz","url":"https://www.jobs.cz/rpd/123/"}' }),
    [{ portal: 'Jobs.cz', url: 'https://www.jobs.cz/rpd/123/' }]);
});

test('unknown publication dates from the backend remain visible', () => {
  for (const value of [null, undefined]) {
    const source = row();
    source.offer = JSON.stringify({ ...JSON.parse(source.offer), published_at: value });
    assert.equal(parseJobRow(source).id, 'one');
    assert.equal(formatDate(value), 'Datum neuvedeno');
  }
  for (const value of ['', 'bad-date']) {
    const source = row();
    source.offer = JSON.stringify({ ...JSON.parse(source.offer), published_at: value });
    assert.throws(() => parseJobRow(source));
  }
});
test('configuration is independent of Python environment and validated before requests', async () => {
  assert.deepEqual(getTursoConfig({ DATABASE_URL: 'libsql://backend', TURSO_AUTH_TOKEN: 'private' }), { url: '', authToken: '' });
  let called = false;
  for (const bad of [{ url: '', authToken: '' }, { ...config, url: 'file:local.db' }, { ...config, url: 'https://test.turso.io/path' }]) {
    await assert.rejects(loadJobs(bad, () => { called = true; }));
  }
  assert.equal(called, false);
});

test('local source needs no browser token and reads the same persisted rows', async () => {
  const local = getTursoConfig({ VITE_JOB_SOURCE: 'local' });
  assert.equal(hasJobSource(local), true);
  assert.equal(local.authToken, '');
  const result = await loadLocalJobs(async (url, options) => {
    assert.equal(url, '/api/jobs');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers, undefined);
    return { ok: true, json: async () => ({ rows: [row()] }) };
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.invalidCount, 0);
});

test('local endpoint errors and malformed responses are redacted', async () => {
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ changed: true }) }]) {
    await assert.rejects(loadLocalJobs(async () => response), /místní server/);
  }
  await assert.rejects(loadLocalJobs(async () => { throw new Error('private-token'); }),
    error => !error.message.includes('private-token'));
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


test('history window uses evaluation timestamp rather than publication date', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  const job = parseJobRow(row());
  const recent = { ...job, id: 'recent', evaluatedAt: '2026-10-09 11:00:00' };
  const boundary = { ...job, id: 'boundary', evaluatedAt: '2026-10-08T12:00:00Z' };
  const old = { ...job, id: 'old', evaluatedAt: '2026-10-08T11:59:59Z' };
  assert.deepEqual(filterJobs([recent, old, boundary], { historyPeriod: '24h', now }).map(j => j.id), ['recent', 'boundary']);
  assert.equal(filterJobs([recent, old, boundary], { historyPeriod: 'all', now }).length, 3);
});

test('local history reader follows next offset and keeps stored dates intact', async () => {
  const source = row();
  const result = await loadLocalJobs(async url => {
    assert.equal(url, '/api/jobs?offset=50');
    return { ok: true, json: async () => ({ rows: [source], nextOffset: 100 }) };
  }, 50);
  assert.equal(result.nextOffset, 100);
  assert.equal(result.limitReached, true);
  assert.equal(result.jobs[0].evaluatedAt, source.evaluated_at);
});


test('pagination clamps last page and keeps filtered records separate', () => {
 const jobs=Array.from({length:19},(_,i)=>({...parseJobRow(row(i<17?30:60,i<17?'NO_GO':'POTENTIAL_FIT')),id:String(i)}));
 const filtered=filterJobs(jobs,{verdict:'NO_GO'});
 const first=paginateJobs(filtered,1,12),last=paginateJobs(filtered,99,12);
 assert.equal(first.jobs.length,12);assert.equal(last.jobs.length,5);assert.equal(last.page,2);
 assert.equal(new Set([...first.jobs,...last.jobs].map(j=>j.id)).size,17);
 assert.deepEqual(pageNumbers(5,10),[1,'gap-4',4,5,6,'gap-10',10]);
 assert.equal(paginateJobs([],1,12).pageCount,1);
});
test('paged local reader sends all filters and decodes stored records',async()=>{
 const result=await loadHistoryPage({page:2,pageSize:6,verdict:'NO_GO',search:'Český',historyPeriod:'7d',sort:'newest'},async url=>{
 const p=new URL(url,'http://localhost').searchParams;
 assert.equal(p.get('page'),'2');assert.equal(p.get('pageSize'),'6');assert.equal(p.get('verdict'),'NO_GO');assert.equal(p.get('search'),'Český');assert.equal(p.get('period'),'7d');assert.equal(p.get('sort'),'newest');
 return {ok:true,json:async()=>({rows:[row(30,'NO_GO')],total:7,totalAll:19,counts:{NO_GO:7},page:2,pageCount:2,pageSize:6})};
 });assert.equal(result.jobs[0].evaluation.verdict,'NO_GO');assert.equal(result.total,7);
});
