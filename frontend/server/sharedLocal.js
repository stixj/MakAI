import {translateOffer} from './offerTranslation.js';
import { opportunityRequest, opportunityHistory } from './opportunityApi.js';
import { createClient } from '@libsql/client/http';
import { CloudStore, UserError } from './cloudStore.js';
import { profileTable } from './cloudProfile.js';
import { localRequest } from './localJobs.js';
import { readBody, dispatchWorker } from './cloudApi.js';
import { extractCv } from './profileBuilder.js';
import { historyQuery, historyView, readHistoryPage } from './historyQuery.js';
import { migrateLocalData } from './sharedMigration.js';

export function sharedLocalMiddleware(root, env, { clientFactory = createClient, migrate = migrateLocalData, fetcher = fetch, preview } = {}) {
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
  const routes = new Set(['/api/profile', '/api/profile/document', '/api/documents', '/api/jobs', '/api/schedule', '/api/hunt', '/api/applications']);
  const middleware = async (request, response, next) => {
    const route = request.url?.split('?')[0];
    if (!routes.has(route)) return next();
    const send = (status, payload) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(payload)); };
    // The same loopback/origin boundary as the previous local backend; online authentication is unchanged.
    if (!localRequest(request)) return send(403, { error: 'Přístup je povolen pouze z localhostu.' });
    try {
      const store = await storage();
      if (route === '/api/applications') return send(200, await opportunityRequest(store, request.method, request.url, request.method === 'GET' ? undefined : await readBody(request), { dispatch: () => dispatchWorker(env, fetcher), translate: payload => translateOffer(store,payload,env,fetcher), ...(preview ? { preview } : {}) }));
      if (route === '/api/documents') {
        const url=new URL(request.url,'http://localhost'), profileId=url.searchParams.get('profileId')||undefined, id=url.searchParams.get('id');
        if(request.method==='GET')return send(200,id?(url.searchParams.get('snapshot')==='1'?await store.getApplicationDocument(profileId,url.searchParams.get('offerId'),id):await store.getDocument(id,profileId,url.searchParams.get('download')==='1')):await store.listDocuments(profileId));
        if(request.method==='POST'){
          const payload=await readBody(request,3000000);
          if(payload.action==='assign-cv-to-applications')return send(200,await store.documentsForAllApplications(payload.documentId));
          if(payload.kind==='cv')payload.extractedText=await extractCv(payload);
          return send(200,await store.saveDocument(payload));
        }
        if(request.method==='DELETE')return send(200,await store.deleteDocument(id,profileId));
        return send(405,{error:'Dokument můžeš zobrazit, přidat nebo smazat.'});
      }
      if (route === '/api/profile/document') {
        const documentUrl = new URL(request.url, 'http://localhost');
        const profileId = documentUrl.searchParams.get('profileId') || undefined;
        if (request.method === 'GET') return send(200, await store.currentProfileDocument({ download: documentUrl.searchParams.get('download') === '1', profileId }));
        if (request.method === 'POST') {
          const payload = await readBody(request, 3000000);
          payload.extractedText = await extractCv(payload);
          return send(200, await store.saveCurrentProfileDocument(payload));
        }
        if (request.method === 'DELETE') return send(200, await store.deleteCurrentProfileDocument(profileId));
        return send(405, { error: 'CV můžeš načíst, nahradit nebo smazat.' });
      }
      if (route === '/api/profile') {
        if (request.method === 'GET') return send(200, new URL(request.url, 'http://localhost').searchParams.get('list') === '1' ? await store.profiles() : await store.profileView());
        if (request.method === 'POST') {
          const payload = await readBody(request, 3000000);
          if (payload.cvDocument) payload.cvDocument.extractedText = await extractCv(payload.cvDocument);
          return send(200, await store.saveProfile(payload));
        }
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
