import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { historyQuery, readHistoryPage } from './historyQuery.js';

test('filters the entire history before paging and returns only selected full records', async () => {
 const db = new DatabaseSync(':memory:');
 db.exec('CREATE TABLE makai_job_evaluations (offer_id TEXT PRIMARY KEY, offer TEXT, evaluation TEXT, evaluated_at TEXT)');
 const insert = db.prepare('INSERT INTO makai_job_evaluations VALUES (?,?,?,?)');
 for (let i=0;i<73;i++) insert.run(String(i),JSON.stringify({title:'Procesní analytik '+i,company:'Český tým'}),JSON.stringify({score:i,verdict:i<50?'NO_GO':'POTENTIAL_FIT'}),'2026-01-01 12:00:00');
 const statements=[];
 const client={execute:async q=>{statements.push(q);return {rows:db.prepare(q.sql).all(...q.args)};}};
 try {
 const query=historyQuery('/api/jobs?view=paged&pageSize=12&verdict=NO_GO&search=cesky');
 const pages=await Promise.all([1,2,3,4,5].map(page=>readHistoryPage(client,{...query,page})));
 assert.equal(pages[0].total,50);assert.equal(pages[0].totalAll,73);assert.equal(pages[0].counts.POTENTIAL_FIT,23);
 assert.deepEqual(pages.map(p=>p.rows.length),[12,12,12,12,2]);
 const ids=pages.flatMap(p=>p.rows.map(r=>r.offer_id));assert.equal(new Set(ids).size,50);assert.equal(ids[0],'49');assert.equal(ids.at(-1),'0');
 assert.ok(statements.every(q=>q.sql.startsWith('SELECT')));
 assert.ok(statements.filter(q=>q.sql.includes('WHERE')).every(q=>q.args.length<=12));
 const last=await readHistoryPage(client,{...query,page:999});assert.equal(last.page,5);
 const empty=await readHistoryPage(client,{...query,verdict:'STRONG_FIT'});assert.equal(empty.total,0);assert.equal(empty.page,1);assert.deepEqual(empty.rows,[]);
 } finally { db.close(); }
});
test('rejects invalid paging and filters before querying',()=>{
 for(const suffix of ['page=0','page=1.5','pageSize=500','verdict=unknown','sort=unknown','period=unknown','search='+ 'x'.repeat(201)]) assert.throws(()=>historyQuery('/api/jobs?view=paged&'+suffix));
 assert.equal(historyQuery('/api/jobs?offset=50'),null);
});

test('last-visit filter keeps only newer evaluations across the entire history', async () => {
 const db = new DatabaseSync(':memory:');
 db.exec('CREATE TABLE makai_job_evaluations (offer_id TEXT PRIMARY KEY, offer TEXT, evaluation TEXT, evaluated_at TEXT)');
 const insert = db.prepare('INSERT INTO makai_job_evaluations VALUES (?,?,?,?)');
 for (const [id, date] of [['old','2026-10-08 05:00:00'],['boundary','2026-10-09T05:00:00Z'],['new','2026-10-09T05:01:00Z']])
   insert.run(id, JSON.stringify({title:'Analytik',company:'Tým'}), JSON.stringify({score:80,verdict:'STRONG_FIT'}),date);
 const client = { execute: async stmt => ({ rows: db.prepare(stmt.sql).all(...stmt.args) }) };
 try {
   const query = historyQuery('/api/jobs?view=paged&since=2026-10-09T05%3A00%3A00Z');
   const result = await readHistoryPage(client, query);
   assert.equal(result.totalAll, 3); assert.equal(result.total, 1);
   assert.deepEqual(result.rows.map(row => row.offer_id), ['new']);
   assert.throws(() => historyQuery('/api/jobs?view=paged&since=bad'));
 } finally { db.close(); }
});
