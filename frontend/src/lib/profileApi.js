export async function profileApi(route, options = {}, timeout = 60000) {
  const response = await fetch(route, { cache: 'no-store', signal: AbortSignal.timeout(timeout), ...options });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Server nevrátil použitelnou odpověď. Zkus obnovit stránku.'); }
  if (!response.ok) {
    const failure = new Error(result.error || 'Požadavek se nepodařilo dokončit.');
    failure.code = result.code;
    if (result.code === 'LOGIN_REQUIRED' && typeof window !== 'undefined') window.dispatchEvent(new Event('makai-session-expired'));
    throw failure;
  }
  return result;
}
