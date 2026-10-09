import { useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { profileApi } from '../lib/profileApi.js';

export default function LoginGate({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    let active = true;
    profileApi('/api/session').then(state => { if (active) setAuthenticated(state.authenticated); })
      .catch(failure => { if (active) { setError(failure.message); setSetup(failure.code === 'SETUP_REQUIRED'); } })
      .finally(() => { if (active) setChecking(false); });
    const expired = () => { setAuthenticated(false); setError('Přihlášení vypršelo. Přihlas se znovu.'); };
    window.addEventListener('makai-session-expired', expired);
    return () => { active = false; window.removeEventListener('makai-session-expired', expired); };
  }, []);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await profileApi('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      setPassword(''); setAuthenticated(true);
    } catch (failure) { setError(failure.message); setSetup(failure.code === 'SETUP_REQUIRED'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await profileApi('/api/session', { method: 'DELETE' }); setAuthenticated(false); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  if (authenticated) return <><div className="mx-auto flex max-w-6xl justify-end px-5 pt-3"><button className="button-secondary" disabled={busy} onClick={logout}>Odhlásit se</button></div>{error && <p role="alert" className="mx-auto max-w-6xl px-5 text-red-700">{error}</p>}{children}</>;
  return <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12"><section className="w-full rounded-3xl border border-viatix-line bg-viatix-sand2 p-7">
    <img src={import.meta.env.BASE_URL + 'brand/makai-logo-v1.png'} alt="MakAI" className="mb-8 w-40" />
    <LockKeyhole className="mb-4 h-7 w-7 text-viatix-teal" aria-hidden="true" />
    <h1 className="font-display text-2xl font-semibold">{setup ? 'Dokončení připojení' : 'Tvůj pracovní přehled'}</h1>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{checking ? 'Ověřuji přihlášení…' : setup ? 'Aplikace je připravená. Pro online hledání je potřeba dokončit serverové nastavení.' : 'Přihlas se pro nabídky, úpravu profilu a automatické hledání.'}</p>
    {!checking && !setup && <form onSubmit={login} className="mt-6 space-y-4"><label className="block text-sm">Heslo<input autoComplete="current-password" type="password" required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-viatix-line bg-white/60 px-3 py-3" /></label><button className="button-primary" disabled={busy}>{busy ? 'Přihlašuji…' : 'Přihlásit se'}</button></form>}
    {setup && <button className="button-secondary mt-5" onClick={() => window.location.reload()}>Ověřit připojení znovu</button>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
  </section></main>;
}
