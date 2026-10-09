import { opportunityRequest, opportunityHistory } from './opportunityApi.js';
import { createClient } from '@libsql/client/http';
import { CloudStore, UserError } from './cloudStore.js';
import { profileTable } from './cloudProfile.js';
import { localRequest } from './localJobs.js';
import { readBody, dispatchWorker } from './cloudApi.js';
import { historyQuery, historyView, readHistoryPage } from './historyQuery.js';
import { migrateLocalData } from './sharedMigration.js';

export function sharedLocalMiddleware(root, env, { clientFactory = createClient, migrate = migrateLocalData, fetcher = fetch } = {}) {
  let client, ready;
  async function storage() {
    if (!env.DATABASE_URL || !env.TURSO_AUTH_TOKEN) throw new UserError('Chybí společné Turso v kořenovém .env. Nastav stejnou databázi jako na Vercelu.', 503);
    if (!ready) ready = (async () => {
      client ??= clientFactory({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
      const store = new CloudStore(client);
      await store.initialize();
      await migrate(store, root);
      return store;
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  const routes = new Set(['/api/profile', '/api/jobs', '/api/schedule', '/api/hunt', '/api/applications']);
  const middleware = async (request, response, next) => {
    const route = request.url?.split('?')[0];
    if (!routes.has(route)) return next();
    const send = (status, payload) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(payload)); };
    // The same loopback/origin boundary as the previous local backend; online authentication is unchanged.
    if (!localRequest(request)) return send(403, { error: 'Přístup je povolen pouze z localhostu.' });
    try {
      const store = await storage();
      if (route === '/api/applications') return send(200, await opportunityRequest(store, request.method, request.url, request.method === 'GET' ? undefined : await readBody(request), { dispatch: () => dispatchWorker(env, fetcher) }));
      if (route === '/api/profile') {
        if (request.method === 'GET') return send(200, new URL(request.url, 'http://localhost').searchParams.get('list') === '1' ? await store.profiles() : await store.profile());
        if (request.method === 'POST') return send(200, await store.saveProfile(await readBody(request)));
        if (request.method === 'PUT') return send(200, await store.activateProfile((await readBody(request)).id));
      }
      if (route === '/api/schedule') {
        if (request.method === 'GET') return send(200, await store.getSchedule());
        if (request.method === 'PUT') return send(200, await store.saveSchedule(await readBody(request)));
      }
      if (route === '/api/hunt') {
        if (request.method === 'GET') { const runs = await store.runs(); return send(200, { ...(runs[0] || { status: 'idle' }), runs }); }
        if (request.method === 'DELETE') return send(200, await store.stop());
        if (request.method === 'POST') {
          const run = await store.manual(await readBody(request));
          return send(202, { ...run, ...await dispatchWorker(env, fetcher) });
        }
      }
      if (route === '/api/jobs' && request.method === 'PATCH') return send(200, await store.updateJobState(await readBody(request)));
      if (route === '/api/jobs' && request.method === 'GET') {
        const query = historyQuery(request.url);
        if (!query) throw new UserError('Použij stránkovaný přehled.');
        return send(200, await opportunityHistory(store, query));
      }
      return send(405, { error: 'Nepodporovaná metoda.' });
    } catch (error) {
      return send(error instanceof UserError ? error.status : /^Neplatné filtry/.test(error.message) ? 400 : 503, { error: error instanceof UserError || /^Neplatné filtry/.test(error.message) ? error.message : 'Společné úložiště se nepodařilo připravit. Původní data zůstala zachovaná; ověř Turso a místní historii.' });
    }
  };
  middleware.close = () => client?.close();
  return middleware;
}
export function sharedLocalPlugin(root, env) {
  const middleware = sharedLocalMiddleware(root, env);
  const install = server => {
    server.middlewares.use(middleware);
    (server.httpServer || server.watcher)?.once('close', middleware.close);
  };
  return { name: 'makai-shared-local', configureServer: install, configurePreviewServer: install };
}
