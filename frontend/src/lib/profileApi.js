export async function profileApi(route, options = {}, timeout = 60000) {
  const response = await fetch(route, { cache: 'no-store', signal: AbortSignal.timeout(timeout), ...options });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Server nevrátil použitelnou odpověď. Zkus obnovit stránku.'); }
  if (!response.ok) throw new Error(result.error || 'Požadavek se nepodařilo dokončit.');
  return result;
}
