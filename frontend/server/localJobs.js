import { historyQuery, historyView, readHistoryPage } from './historyQuery.js';
import { createClient } from '@libsql/client/http';

export const HISTORY_PAGE_SIZE = 50;
export function historyOffset(url) {
  const value = new URL(url, 'http://localhost').searchParams.get('offset') ?? '0';
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Neplatná stránka historie.');
  return Number(value);
}
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function localRequest(request) {
  if (!LOOPBACK.has(request.socket.remoteAddress)) return false;
  try {
    const host = new URL('http://' + request.headers.host);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
    return !request.headers.origin || new URL(request.headers.origin).origin === host.origin;
  } catch { return false; }
}

export function localJobsMiddleware(config, clientFactory = createClient) {
  return async (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/jobs') return next();
    const send = (status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(payload));
    };
    if (!localRequest(request)) return send(403, { error: 'Přístup je povolen pouze z localhostu.' });
    if (request.method !== 'GET') return send(405, { error: 'Tento endpoint umožňuje pouze čtení.' });
    if (!config.url || !config.authToken) return send(503, { error: 'Chybí konfigurace Turso v backendu.' });
    let offset, query;
    try { offset = historyOffset(request.url); query = historyQuery(request.url); } catch (error) { return send(400, { error: error.message }); }
    let client;
    try {
      const url = new URL(config.url);
      if (!['libsql:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
          !['', '/'].includes(url.pathname) || url.search || url.hash) throw new Error();
      client = clientFactory({ ...config, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) });
      const table = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", args: ['makai_job_evaluations'],
      });
      if (!table.rows.length) {
        if (query) { const { ids, ...view } = historyView([], query); return send(200, { rows: [], ...view }); }
        return send(200, { rows: [], nextOffset: null });
      }
      if (query) return send(200, await readHistoryPage(client, query));
      const result = await client.execute({
        sql: 'SELECT offer_id, offer, evaluation, evaluated_at FROM makai_job_evaluations ORDER BY evaluated_at DESC, offer_id ASC LIMIT ? OFFSET ?',
        args: [HISTORY_PAGE_SIZE + 1, offset],
      });
      send(200, { rows: result.rows.slice(0, HISTORY_PAGE_SIZE),
        nextOffset: result.rows.length > HISTORY_PAGE_SIZE ? offset + HISTORY_PAGE_SIZE : null });
    } catch {
      send(502, { error: 'Nabídky se nepodařilo načíst z Turso.' });
    } finally { client?.close(); }
  };
}

export function localJobsPlugin(config) {
  const install = server => { server.middlewares.use(localJobsMiddleware(config)); };
  return { name: 'makai-local-jobs', configureServer: install, configurePreviewServer: install };
}
