import { createClient } from '@libsql/client/web';
import { decodeJobRows } from './jobs.js';

export const JOB_LIMIT = 500;
export function getTursoConfig(env = import.meta.env ?? {}) {
  return { url: env.VITE_TURSO_DATABASE_URL?.trim() ?? '', authToken: env.VITE_TURSO_AUTH_TOKEN?.trim() ?? '' };
}
export function hasTursoConfig(config = getTursoConfig()) { return Boolean(config.url && config.authToken); }
function validateConfig(config) {
  if (!hasTursoConfig(config)) throw new Error('Chybí konfigurace Turso.');
  try {
    const url = new URL(config.url);
    if (!['libsql:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
        !['', '/'].includes(url.pathname) || url.search || url.hash) throw new Error();
  } catch { throw new Error('Neplatná adresa databáze Turso.'); }
}
export async function loadJobs(config = getTursoConfig(), clientFactory = createClient) {
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
