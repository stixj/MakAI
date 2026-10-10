import {translateOffer} from './offerTranslation.js';
import { opportunityRequest, opportunityHistory } from './opportunityApi.js';
import { builderConfig, analyseCv, extractCv, generateDraft } from './profileBuilder.js';
import { createClient } from '@libsql/client/http';
import { createHash } from 'node:crypto';
import { CloudStore, UserError } from './cloudStore.js';
import { authenticated, equalSecret, sameOrigin, sessionCookie, hashPassword, verifyPassword } from './cloudAuth.js';
import { profileTable } from './cloudProfile.js';
import { historyQuery, readHistoryPage, historyView } from './historyQuery.js';

export async function readBody(request, maxBytes = 300000) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new UserError('Použij JSON požadavek.');
  if (request.body !== undefined) {
    if (Buffer.byteLength(JSON.stringify(request.body)) > maxBytes) throw new UserError('Požadavek je příliš velký.');
    if (typeof request.body === 'string') { try { return JSON.parse(request.body); } catch { throw new UserError('Neplatný JSON.'); } }
    return request.body;
  }
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += Buffer.byteLength(chunk);
    if (length > maxBytes) throw new UserError('Požadavek je příliš velký.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new UserError('Neplatný JSON.'); }
}

export async function dispatchWorker(env, fetcher = fetch) {
  if (!env.MAKAI_GITHUB_TOKEN) return { dispatch: 'scheduled', notice: 'Okamžité spuštění není nakonfigurované. Přidej MAKAI_GITHUB_TOKEN do produkčního prostředí Vercelu; do té doby hledání převezme plánovaný worker.' };
  const repository = env.MAKAI_GITHUB_REPOSITORY || 'stixj/MakAI';
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw new Error('Invalid repository');
  try {
    const response = await fetcher(`https://api.github.com/repos/${repository}/actions/workflows/hunt.yml/dispatches`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${env.MAKAI_GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (!response.ok) throw new Error();
    return { dispatch: 'requested', notice: 'Hledání je ve frontě. Zpracování se spustí, jakmile GitHub přidělí pracovníka.' };
  } catch {
    return { dispatch: 'scheduled', notice: 'Okamžité spuštění pracovníka se nepodařilo. Zkontroluj MAKAI_GITHUB_TOKEN a oprávnění Actions: write; hledání zůstává ve frontě.' };
  }
}

export function createCloudHandler(route, { env = process.env, clientFactory = createClient, now = () => new Date(), fetcher = fetch } = {}) {
  return async (request, response) => {
    let client;
    const send = (status, body, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
      response.end(JSON.stringify(body));
    };
    try {
      const configured = env.DATABASE_URL && env.TURSO_AUTH_TOKEN && env.MAKAI_LOGIN_PASSWORD?.length >= 12 && env.MAKAI_SESSION_SECRET?.length >= 32 && env.MAKAI_WORKER_SECRET?.length >= 32;
      if (!configured) return send(503, { error: 'Online provoz ještě není nakonfigurovaný. Chybí serverové připojení nebo přihlašovací údaje.', code: 'SETUP_REQUIRED' });
      if (route !== 'worker' && !sameOrigin(request)) return send(403, { error: 'Požadavek musí pocházet z aplikace.' });
      if (route === 'worker') {
        if (request.method !== 'POST') return send(405, { error: 'Nepodporovaná metoda.' });
        if (!equalSecret(request.headers.authorization, `Bearer ${env.MAKAI_WORKER_SECRET}`)) return send(401, { error: 'Neplatné přihlášení pracovníka.' });
      } else if (route !== 'session' && !authenticated(request, env, now().getTime())) return send(401, { error: 'Přihlas se do MakAI.', code: 'LOGIN_REQUIRED' });
      client = clientFactory({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
      const store = new CloudStore(client, { now });
      await store.initialize();
      const auth = route === 'worker' ? null : await store.auth();
      const sessionEnv = auth ? { ...env, MAKAI_AUTH_VERSION: auth.version } : env;
      if (route !== 'worker' && route !== 'session' && !authenticated(request, sessionEnv, now().getTime())) return send(401, { error: 'Přihlas se znovu.', code: 'LOGIN_REQUIRED' });
      if (route === 'session') {
        if (request.method === 'GET') return send(200, { authenticated: authenticated(request, sessionEnv, now().getTime()) });
        if (request.method === 'DELETE') return send(200, { authenticated: false }, { 'Set-Cookie': 'makai_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
        if (!['POST', 'PUT'].includes(request.method)) return send(405, { error: 'Nepodporovaná metoda.' });
        if (request.method === 'PUT' && !authenticated(request, sessionEnv, now().getTime())) return send(401, { error: 'Přihlas se do MakAI.', code: 'LOGIN_REQUIRED' });
        const payload = await readBody(request);
        const ip = request.headers['x-forwarded-for']?.split(',')[0] || request.socket?.remoteAddress || 'unknown';
        const bucket = createHash('sha256').update(`${ip}:${Math.floor(now().getTime() / 900000)}`).digest('hex');
        const attempts = await client.execute({ sql: 'INSERT INTO makai_login_attempts(bucket,count) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count', args: [bucket] });
        if (Number(attempts.rows[0].count) > 10) return send(429, { error: 'Příliš mnoho pokusů. Zkus přihlášení za 15 minut.' });
        if (!await verifyPassword(payload.password, auth?.password_hash, env.MAKAI_LOGIN_PASSWORD)) return send(401, { error: 'Nesprávné heslo.' });
        if (request.method === 'PUT') {
          if (typeof payload.newPassword !== 'string' || payload.newPassword.length < 12 || payload.newPassword.length > 128 || Buffer.byteLength(payload.newPassword) > 512) throw new UserError('Nové heslo musí mít 12–128 znaků.');
          if (equalSecret(payload.password, payload.newPassword)) throw new UserError('Zvol jiné heslo než současné.');
          const version = await store.changePassword(await hashPassword(payload.newPassword), auth?.version || null);
          return send(200, { authenticated: true }, { 'Set-Cookie': sessionCookie({ ...env, MAKAI_AUTH_VERSION: version }, now().getTime()) });
        }
        return send(200, { authenticated: true }, { 'Set-Cookie': sessionCookie(sessionEnv, now().getTime()) });
      }
      if (route === 'worker') {
        const payload = await readBody(request);
        if (payload.action === 'claim') return send(200, { run: await store.claim() });
        if (typeof payload.id !== 'string' || typeof payload.token !== 'string') throw new UserError('Neplatný běh.');
        if (payload.action === 'status') return send(200, await store.workerStatus(payload.id, payload.token));
        if (payload.action === 'finish') return send(200, await store.finish(payload));
        throw new UserError('Neznámá akce.');
      }
      if (['profile-draft', 'profile-cv'].includes(route)) {
        if (request.method === 'GET' && route === 'profile-draft') return send(200, builderConfig(env));
        if (request.method !== 'POST') return send(405, { error: 'Nepodporovaná metoda.' });
        const payload = await readBody(request, route === 'profile-cv' ? 3000000 : 300000);
        const bucket = 'builder:' + now().toISOString().slice(0, 10);
        const quota = await client.execute({ sql: 'INSERT INTO makai_login_attempts(bucket,count) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count', args: [bucket] });
        if (Number(quota.rows[0].count) > 20) return send(429, { error: 'Dnešní limit tvorby profilu byl dosažen. Pokračuj zítra.' });
        return send(200, await (route === 'profile-cv' ? analyseCv(payload, env, fetcher) : generateDraft(payload, env, fetcher)));
      }
      if (route === 'applications') return send(200, await opportunityRequest(store, request.method, request.url, request.method === 'GET' ? undefined : await readBody(request), { dispatch: () => dispatchWorker(env, fetcher), translate: payload => translateOffer(store,payload,env,fetcher) }));
      if (route === 'documents') {
        const url=new URL(request.url,'https://localhost'),profileId=url.searchParams.get('profileId')||undefined,id=url.searchParams.get('id');
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
      if (route === 'profile') {
        if (request.method === 'GET') return send(200, new URL(request.url, 'https://localhost').searchParams.get('list') === '1' ? await store.profiles() : await store.profileView());
        if (request.method === 'PUT') return send(200, await store.activateProfile((await readBody(request)).id));
        if (request.method === 'POST') {
          const payload = await readBody(request, 3000000);
          if (payload.cvDocument) payload.cvDocument.extractedText = await extractCv(payload.cvDocument);
          return send(200, await store.saveProfile(payload));
        }
        return send(405, { error: 'Profil uprav nebo nahraj jeho novou verzi.' });
      }
      if (route === 'profile-document') {
        const documentUrl = new URL(request.url, 'https://localhost');
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
      if (route === 'schedule') {
        if (request.method === 'GET') return send(200, await store.getSchedule());
        if (request.method === 'PUT') return send(200, await store.saveSchedule(await readBody(request)));
        return send(405, { error: 'Nepodporovaná metoda.' });
      }
      if (route === 'hunt') {
        if (request.method === 'GET') { const runs = await store.runs(); return send(200, { ...(runs[0] || { status: 'idle' }), runs }); }
        if (request.method === 'DELETE') return send(200, await store.stop());
        if (request.method === 'POST') {
          const payload = await readBody(request);
          if (payload.action === 'dispatch') {
            const run = (await store.runs()).find(item => item.status === 'queued');
            if (!run) throw new UserError('Ve frontě není žádné čekající hledání.', 409);
            return send(202, { ...run, ...await dispatchWorker(env, fetcher) });
          }
          const run = await store.manual(payload);
          return send(202, { ...run, ...await dispatchWorker(env, fetcher) });
        }
        return send(405, { error: 'Nepodporovaná metoda.' });
      }
      if (route === 'jobs') {
        if (request.method === 'PATCH') return send(200, await store.updateJobState(await readBody(request)));
        if (request.method !== 'GET') return send(405, { error: 'Nepodporovaná metoda.' });
        const query = historyQuery(request.url);
        if (!query) throw new UserError('Použij stránkovaný přehled.');
        return send(200, await opportunityHistory(store, query));
      }
      return send(404, { error: 'Neznámá cesta.' });
    } catch (error) {
      if (error instanceof UserError) return send(error.status, { error: error.message });
      // Our pure validators produce actionable messages; SDK/transport errors stay private.
      if (error.constructor === Error && /^(Zkontroluj|Vyber|Profil |Mzdové|Neplatné filtry)/.test(error.message)) return send(400, { error: error.message });
      return send(503, { error: 'Server požadavek nedokončil. Zkus to znovu; ověř připojení a konfiguraci.' });
    } finally { client?.close(); }
  };
}
