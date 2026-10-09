import {applyOfferEdit} from './offerEditing.js';
import { inCollection, normalizeJobState } from '../src/lib/jobState.js';
import { filterJobs, VERDICTS } from '../src/lib/jobs.js';

export const PAGE_SIZES = [6, 12, 24, 48];
export function historyQuery(url) {
  const params = new URL(url, 'http://localhost').searchParams;
  if (params.get('view') !== 'paged') return null;
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? 12);
  const verdict = params.get('verdict') ?? 'all';
  const sort = params.get('sort') ?? 'score';
  const historyPeriod = params.get('period') ?? 'all';
  const search = params.get('search') ?? '';
  const since = params.get('since');
  const collection = params.get('collection') ?? 'active';
  if (!['active', 'saved', 'priority', 'applied', 'hidden', 'all'].includes(collection) || !Number.isSafeInteger(page) || page < 1 || !PAGE_SIZES.includes(pageSize) ||
      !['all', ...Object.keys(VERDICTS)].includes(verdict) || !['score', 'newest', 'priority'].includes(sort) ||
      !['all', '24h', '7d', '30d'].includes(historyPeriod) || search.length > 200 ||
      (since !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(since) || !Number.isFinite(Date.parse(since))))) {
    throw new Error('Neplatné filtry nebo stránka historie.');
  }
  return { page, pageSize, verdict, sort, historyPeriod, search, collection, ...(since ? { since } : {}) };
}

export function historyView(metadata, query) {
  const jobs = metadata.filter(row => typeof row.title === 'string' && typeof row.company === 'string' &&
    (row.manual === true && row.verdict == null || VERDICTS[row.verdict] && Number.isFinite(Number(row.score)))).map(row => ({
    id: row.offer_id, state: normalizeJobState(row.state), offer: { title: row.title, company: row.company },
    evaluation: row.verdict ? { verdict: row.verdict, score: Number(row.score) } : null, evaluatedAt: row.evaluated_at,
  }));
  const collectionJobs = jobs.filter(job => inCollection(job.state, query.collection));
  const base = filterJobs(collectionJobs, { ...query, verdict: 'all' }).filter(job =>
    !query.since || job.evaluatedAt && Date.parse(job.evaluatedAt.includes('T') ? job.evaluatedAt : job.evaluatedAt.replace(' ', 'T') + 'Z') > Date.parse(query.since));
  const counts = Object.fromEntries(Object.keys(VERDICTS).map(key => [key, base.filter(job => job.evaluation?.verdict === key).length]));
  const filtered = query.verdict === 'all' ? base : base.filter(job => job.evaluation?.verdict === query.verdict);
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  const ids = filtered.slice((page - 1) * query.pageSize, page * query.pageSize).map(job => job.id);
  return { ids, total, totalAll: collectionJobs.length, totalStored: jobs.length, counts, pageCount, page, pageSize: query.pageSize };
}

export async function readHistoryPage(client, query, states, extraRows = [], edits = []) {
  const stateById = new Map((states || []).map(row => [row.offer_id, normalizeJobState(row)]));
  const metadata = await client.execute({ sql: "SELECT offer_id, json_extract(offer, '$.title') AS title, json_extract(offer, '$.company') AS company, json_extract(evaluation, '$.score') AS score, json_extract(evaluation, '$.verdict') AS verdict, evaluated_at FROM makai_job_evaluations ORDER BY offer_id", args: [] });
  const extraMetadata = extraRows.map(row => { const offer = JSON.parse(row.offer), evaluation = JSON.parse(row.evaluation); return { offer_id: row.offer_id, title: offer.title, company: offer.company, score: evaluation?.score, verdict: evaluation?.verdict, manual: true, evaluated_at: row.evaluated_at || row.created_at }; });
  const { ids, ...view } = historyView([...metadata.rows, ...extraMetadata].map(row => {const edit=edits.find(item=>item.offer_id===row.offer_id);const offer=edit?JSON.parse(edit.payload):{};return ({ ...row, ...Object.fromEntries(['title','company'].filter(key=>key in offer).map(key=>[key,offer[key]])), state: stateById.get(row.offer_id) });}), query);
  if (!ids.length) return { rows: [], ...view };
  const result = await client.execute({ sql: 'SELECT offer_id, offer, evaluation, evaluated_at FROM makai_job_evaluations WHERE offer_id IN (' + ids.map(() => '?').join(',') + ')', args: ids });
  const byId = new Map([...result.rows, ...extraRows].map(row => [row.offer_id, row]));
  return { rows: ids.map(id => { const original = byId.get(id); const row = original && applyOfferEdit(original,edits); return row && { ...row, ...(states ? { state: stateById.get(id) || normalizeJobState() } : {}) }; }).filter(Boolean), ...view };
}
