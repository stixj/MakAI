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
  if (!Number.isSafeInteger(page) || page < 1 || !PAGE_SIZES.includes(pageSize) ||
      !['all', ...Object.keys(VERDICTS)].includes(verdict) || !['score', 'newest'].includes(sort) ||
      !['all', '24h', '7d', '30d'].includes(historyPeriod) || search.length > 200 ||
      (since !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(since) || !Number.isFinite(Date.parse(since))))) {
    throw new Error('Neplatné filtry nebo stránka historie.');
  }
  return { page, pageSize, verdict, sort, historyPeriod, search, ...(since ? { since } : {}) };
}

export function historyView(metadata, query) {
  const jobs = metadata.filter(row => typeof row.title === 'string' && typeof row.company === 'string' &&
    VERDICTS[row.verdict] && Number.isFinite(Number(row.score))).map(row => ({
    id: row.offer_id, offer: { title: row.title, company: row.company },
    evaluation: { verdict: row.verdict, score: Number(row.score) }, evaluatedAt: row.evaluated_at,
  }));
  const base = filterJobs(jobs, { ...query, verdict: 'all' }).filter(job =>
    !query.since || Date.parse(job.evaluatedAt.includes('T') ? job.evaluatedAt : job.evaluatedAt.replace(' ', 'T') + 'Z') > Date.parse(query.since));
  const counts = Object.fromEntries(Object.keys(VERDICTS).map(key => [key, base.filter(job => job.evaluation.verdict === key).length]));
  const filtered = query.verdict === 'all' ? base : base.filter(job => job.evaluation.verdict === query.verdict);
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  const ids = filtered.slice((page - 1) * query.pageSize, page * query.pageSize).map(job => job.id);
  return { ids, total, totalAll: jobs.length, counts, pageCount, page, pageSize: query.pageSize };
}

export async function readHistoryPage(client, query) {
  const metadata = await client.execute({ sql: "SELECT offer_id, json_extract(offer, '$.title') AS title, json_extract(offer, '$.company') AS company, json_extract(evaluation, '$.score') AS score, json_extract(evaluation, '$.verdict') AS verdict, evaluated_at FROM makai_job_evaluations ORDER BY offer_id", args: [] });
  const { ids, ...view } = historyView(metadata.rows, query);
  if (!ids.length) return { rows: [], ...view };
  const result = await client.execute({ sql: 'SELECT offer_id, offer, evaluation, evaluated_at FROM makai_job_evaluations WHERE offer_id IN (' + ids.map(() => '?').join(',') + ')', args: ids });
  const byId = new Map(result.rows.map(row => [row.offer_id, row]));
  return { rows: ids.map(id => byId.get(id)).filter(Boolean), ...view };
}
