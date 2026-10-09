import { historyQuery } from './historyQuery.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { localRequest, historyOffset, HISTORY_PAGE_SIZE } from './localJobs.js';

export function pythonBridge(projectRoot, action, payload = {}, { timeout = 30000, signal, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(join(projectRoot, 'venv', 'Scripts', 'python.exe'),
      [join(projectRoot, 'backend', 'local_api.py'), action],
      { cwd: projectRoot, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    const cancel = () => { child.kill(); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => { child.kill(); reject(new Error('Zpracování překročilo časový limit.')); }, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2000000) child.kill(); });
    child.stderr.resume();
    child.on('error', () => { signal?.removeEventListener('abort', cancel); clearTimeout(timer); reject(new Error('Python backend se nepodařilo spustit.')); });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (signal?.aborted) {
        const error = new Error('Hledání bylo zastaveno.'); error.name = 'AbortError';
        return reject(error);
      }
      try {
        const result = JSON.parse(stdout);
        if (code !== 0 || result.error) reject(new Error(result.error || 'Backend selhal.'));
        else resolve(result);
      } catch { reject(new Error('Backend nevrátil platný výsledek.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Použij JSON formát požadavku.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 1500000) throw new Error('Soubor profilu je příliš velký.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8')); }
  catch { throw new Error('Neplatný JSON požadavku.'); }
}

export function localProfilesMiddleware(projectRoot, bridge = pythonBridge) {
  let hunt = { status: 'idle' };
  let mutating = false;
  let huntController = null;
  const huntActive = () => ['running', 'stopping'].includes(hunt.status);
  const call = (action, payload, options) => bridge(projectRoot, action, payload, options);
  return async (request, response, next) => {
    const route = request.url?.split('?')[0];
    if (!['/api/profile', '/api/profile/draft', '/api/hunt', '/api/jobs'].includes(route)) return next();
    const send = (status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(payload));
    };
    if (!localRequest(request)) return send(403, { error: 'Přístup je povolen pouze z localhostu.' });
    try {
      if (route === '/api/profile/draft') {
        if (request.method === 'GET') return send(200, await call('builder-config'));
        if (request.method !== 'POST') return send(405, { error: 'Nepodporovaná metoda.' });
        if (mutating) return send(409, { error: 'Vytvoření nebo změna profilu již probíhá.' });
        mutating = true;
        try {
          const payload = await readBody(request);
          return send(200, await call('generate-profile', payload, { timeout: 150000 }));
        } finally { mutating = false; }
      }
      if (route === '/api/jobs') {
        if (request.method !== 'GET') return next();
        const profile = await call('profile');
        if (profile.isDefault) return next();
        const query = historyQuery(request.url);
        if (query) return send(200, await call('history-page', { profileId: profile.id, ...query }));
        return send(200, await call('rows', { profileId: profile.id, offset: historyOffset(request.url), limit: HISTORY_PAGE_SIZE }));
      }
      if (route === '/api/profile') {
        if (request.method === 'GET') return send(200, await call('profile'));
        if (!['POST', 'DELETE'].includes(request.method)) return send(405, { error: 'Nepodporovaná metoda.' });
        if (mutating || huntActive()) return send(409, { error: 'Počkej na dokončení aktuálního hledání nebo změny profilu.' });
        mutating = true;
        try {
          const payload = request.method === 'POST' ? await readBody(request) : {};
          const result = await call(request.method === 'POST' ? 'upload' : 'reset', payload);
          hunt = { status: 'idle' };
          return send(200, result);
        } finally { mutating = false; }
      }
      if (request.method === 'GET') return send(200, hunt);
      if (request.method === 'DELETE') {
        if (huntActive() && huntController) {
          hunt = { ...hunt, status: 'stopping' };
          huntController.abort();
        }
        return send(huntActive() ? 202 : 200, hunt);
      }
      if (request.method !== 'POST') return send(405, { error: 'Nepodporovaná metoda.' });
      if (mutating || huntActive()) return send(409, { error: 'Hledání nebo změna profilu již probíhá.' });
      mutating = true;
      try {
        const payload = await readBody(request);
        const profile = await call('profile');
        if (payload.profileId !== profile.id) return send(409, { error: 'Aktivní profil se změnil. Obnov stránku.' });
        const limit = payload.limit ?? 10;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return send(400, { error: 'Limit musí být 1–100.' });
        const period = payload.period ?? 'all';
        const includeUnknownDates = payload.includeUnknownDates ?? false;
        if (!['all', '24h', '7d', '30d'].includes(period) || typeof includeUnknownDates !== 'boolean') return send(400, { error: 'Neplatné časové vymezení hledání.' });
        hunt = { status: 'running', profileId: profile.id, startedAt: new Date().toISOString() };
        const controller = new AbortController();
        huntController = controller;
        call('hunt', { profileId: profile.id, limit, period, includeUnknownDates }, { timeout: 1800000, signal: controller.signal })
          .then(result => { if (controller.signal.aborted) { hunt = { ...hunt, status: 'cancelled' }; return; } hunt = { ...hunt, status: result.evaluationBlocked && result.evaluated === 0 ? 'blocked' : result.errors.length ? 'partial' : 'done', result }; })
          .catch(error => { hunt = controller.signal.aborted
            ? { ...hunt, status: 'cancelled', stoppedAt: new Date().toISOString() }
            : { ...hunt, status: 'error', error: error.message }; })
          .finally(() => { if (huntController === controller) huntController = null; });
        return send(202, hunt);
      } finally { mutating = false; }
    } catch (error) { return send(400, { error: error.message }); }
  };
}

export function localProfilesPlugin(projectRoot) {
  const middleware = localProfilesMiddleware(projectRoot);
  const install = server => { server.middlewares.use(middleware); };
  return { name: 'makai-local-profiles', configureServer: install, configurePreviewServer: install };
}
