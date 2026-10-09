import { createClient } from '@libsql/client/web';
import { decodeJobRows } from './jobs.js';

export const JOB_LIMIT = 500;
export function getTursoConfig(env = import.meta.env ?? {}) {
  return { url: env.VITE_TURSO_DATABASE_URL?.trim() ?? '', authToken: env.VITE_TURSO_AUTH_TOKEN?.trim() ?? '',
    ...(['local', 'cloud'].includes(env.VITE_JOB_SOURCE) ? { apiUrl: '/api/jobs' } : {}) };
}
export function hasTursoConfig(config = getTursoConfig()) { return Boolean(config.url && config.authToken); }
export function hasJobSource(config = getTursoConfig()) { return config.apiUrl === '/api/jobs' || hasTursoConfig(config); }

export async function loadLocalJobs(fetcher = fetch, offset = 0) {
  try {
    const response = await fetcher(offset ? '/api/jobs?offset=' + offset : '/api/jobs', { signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (!Array.isArray(result.rows)) throw new Error();
    return { ...decodeJobRows(result.rows), limitReached: result.nextOffset != null, nextOffset: result.nextOffset ?? null };
  } catch {
    throw new Error('Nabídky se nepodařilo načíst. Zkontroluj místní server a připojení k databázi.');
  }
}
function validateConfig(config) {
  if (!hasTursoConfig(config)) throw new Error('Chybí konfigurace Turso.');
  try {
    const url = new URL(config.url);
    if (!['libsql:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
        !['', '/'].includes(url.pathname) || url.search || url.hash) throw new Error();
  } catch { throw new Error('Neplatná adresa databáze Turso.'); }
}
export async function loadJobs(config = getTursoConfig(), clientFactory = createClient) {
  if (config.apiUrl === '/api/jobs') return loadLocalJobs();
  validateConfig(config);
  const client = clientFactory({ ...config, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) });
  try {
    const table = await client.execute({ sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", args: ['makai_job_evaluations'] });
    if (table.rows.length === 0) return { jobs: [], invalidCount: 0, limitReached: false };
    const result = await client.execute({
      sql: 'SELECT offer_id, offer, evaluation, evaluated_at FROM makai_job_evaluations ORDER BY evaluated_at DESC, offer_id ASC LIMIT ?',
      args: [JOB_LIMIT],
    });
    return { ...decodeJobRows(result.rows), limitReached: result.rows.length === JOB_LIMIT };
  } catch {
    throw new Error('Nabídky se nepodařilo načíst. Zkontroluj připojení a nastavení databáze a zkus to znovu.');
  } finally { client.close(); }
}


export async function loadHistoryPage(options = {}, fetcher = fetch) {
  const params = new URLSearchParams({ view: 'paged', page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 12), verdict: options.verdict ?? 'all',
    sort: options.sort ?? 'score', collection: options.collection ?? 'active', period: options.historyPeriod ?? 'all', search: options.search ?? '' });
  if (options.since) params.set('since', options.since);
  try {
    const response = await fetcher('/api/jobs?' + params, { signal: AbortSignal.timeout(25000), cache: 'no-store' });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (!Array.isArray(result.rows) || !Number.isInteger(result.total) || !Number.isInteger(result.pageCount) ||
        !Number.isInteger(result.page) || !result.counts) throw new Error();
    return { ...result, ...decodeJobRows(result.rows) };
  } catch { throw new Error('Historii se nepodařilo načíst. Zkus přehled obnovit.'); }
}
