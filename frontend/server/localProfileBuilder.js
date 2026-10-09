import { localRequest } from './localJobs.js';
import { readBody } from './cloudApi.js';
import { builderConfig, analyseCv, generateDraft } from './profileBuilder.js';
export function localProfileBuilderPlugin(env) {
  let day = '', count = 0, busy = false;
  const middleware = async (request, response, next) => {
    const route = request.url?.split('?')[0];
    if (!['/api/profile/draft', '/api/profile/cv'].includes(route)) return next();
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    if (!localRequest(request)) return send(403, { error: 'Přístup je povolen pouze z localhostu.' });
    if (request.method === 'GET' && route.endsWith('/draft')) return send(200, builderConfig(env));
    if (request.method !== 'POST') return send(405, { error: 'Nepodporovaná metoda.' });
    if (busy) return send(409, { error: 'AI právě zpracovává profil. Počkej na dokončení.' });
    busy = true;
    try {
      const payload = await readBody(request, route.endsWith('/cv') ? 3000000 : 300000);
      const today = new Date().toISOString().slice(0, 10); if (day !== today) { day = today; count = 0; }
      if (++count > 20) return send(429, { error: 'Dnešní limit tvorby profilu byl dosažen.' });
      return send(200, await (route.endsWith('/cv') ? analyseCv(payload, env) : generateDraft(payload, env)));
    } catch (error) { return send(error.status || 503, { error: error.status ? error.message : 'Profil se nepodařilo zpracovat. Zkus to znovu.' }); }
    finally { busy = false; }
  };
  const install = server => { server.middlewares.use(middleware); };
  return { name: 'makai-local-profile-builder', configureServer: install, configurePreviewServer: install };
}
