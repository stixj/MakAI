import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const digest = value => createHmac('sha256', 'makai-constant-time-comparison').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
export function sessionCookie(env, now = Date.now()) {
  const value = `${Math.floor(now / 1000) + 604800}.${randomBytes(24).toString('hex')}`;
  const signature = createHmac('sha256', env.MAKAI_SESSION_SECRET).update(value).digest('hex');
  return `makai_session=${value}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`;
}
export function authenticated(request, env, now = Date.now()) {
  if (!env.MAKAI_SESSION_SECRET || env.MAKAI_SESSION_SECRET.length < 32) return false;
  const cookie = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('makai_session='))?.slice(14);
  if (!cookie || !/^\d+\.[a-f0-9]{48}\.[a-f0-9]{64}$/.test(cookie)) return false;
  const [expiry, nonce, signature] = cookie.split('.');
  return Number(expiry) > now / 1000 && Number(expiry) <= now / 1000 + 604800 &&
    equalSecret(signature, createHmac('sha256', env.MAKAI_SESSION_SECRET).update(`${expiry}.${nonce}`).digest('hex'));
}
export function sameOrigin(request) {
  if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) return false;
  if (!request.headers.origin) return true;
  try { return new URL(request.headers.origin).protocol === 'https:' && new URL(request.headers.origin).host === request.headers.host; }
  catch { return false; }
}
