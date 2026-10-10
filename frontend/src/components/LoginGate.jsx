import { clearAllDrafts } from '../hooks/useDraft.js';
import { cloneElement, useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { profileApi } from '../lib/profileApi.js';
function AccountMenu({ busy, onChangePassword, onLogout }) {
  return <div className="mt-3 border-t border-border-subtle pt-3">
    <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-ink-tertiary">Účet</p>
    <button type="button" className="w-full rounded-lg px-3 py-3 text-left text-sm hover:bg-surface-subtle" disabled={busy} onClick={onChangePassword}>Změnit heslo</button>
    <button type="button" className="w-full rounded-lg px-3 py-3 text-left text-sm hover:bg-surface-subtle" disabled={busy} onClick={onLogout}>Odhlásit se</button>
  </div>;
}

export default function LoginGate({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
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
    try { await profileApi('/api/session', { method: 'DELETE' }); clearAllDrafts(); setAuthenticated(false); closeChange(); setNotice(''); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function closeChange() { setChanging(false); setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setError(''); }
  async function changePassword(event) {
    event.preventDefault(); setError(''); setNotice('');
    if (newPassword !== confirmation) { setError('Nová hesla se neshodují.'); return; }
    setBusy(true);
    try {
      await profileApi('/api/session', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: currentPassword, newPassword }) });
      closeChange(); setNotice('Heslo bylo změněno. Ostatní zařízení se musí přihlásit znovu.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  if (authenticated) return <>

    {changing && <section aria-labelledby="password-title" className="mx-auto mt-5 max-w-lg rounded-2xl border border-border-subtle bg-surface p-5"><h2 id="password-title" className="font-display text-xl font-semibold">Změna hesla</h2><form onSubmit={changePassword} className="mt-4 space-y-4"><fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">Současné heslo<input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-border-subtle bg-surface px-3 py-3" /></label>
      <label className="block text-sm">Nové heslo (alespoň 12 znaků)<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-border-subtle bg-surface px-3 py-3" /></label>
      <label className="block text-sm">Nové heslo znovu<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-border-subtle bg-surface px-3 py-3" /></label>
      <div className="flex gap-3"><button className="button-primary">{busy ? 'Ukládám…' : 'Uložit nové heslo'}</button><button type="button" className="button-secondary" onClick={closeChange}>Zrušit</button></div>
    </fieldset></form></section>}
    {error && <p role="alert" className="mx-auto mt-3 max-w-6xl px-5 text-danger">{error}</p>}{notice && <p role="status" className="mx-auto mt-3 max-w-6xl px-5 text-brand">{notice}</p>}{cloneElement(children, { accountControls: <AccountMenu busy={busy} onChangePassword={event => { event.currentTarget.closest('details').open = false; setChanging(true); setError(''); setNotice(''); }} onLogout={logout} /> })}</>;
  return <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12"><section className="w-full rounded-3xl border border-border-subtle bg-surface p-7">
    <img src={`${import.meta.env.BASE_URL}brand/01_MakAI_logo_original_V0.svg`} alt="MakAI" width="2048" height="682" className="mb-8 h-auto w-36" />
    <LockKeyhole className="mb-4 h-7 w-7 text-brand" aria-hidden="true" />
    <h1 className="font-display text-2xl font-semibold">{setup ? 'Dokončení připojení' : 'Tvůj pracovní přehled'}</h1>
    <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{checking ? 'Ověřuji přihlášení…' : setup ? 'Aplikace je připravená. Pro online hledání je potřeba dokončit serverové nastavení.' : 'Přihlas se pro nabídky, úpravu profilu a automatické hledání.'}</p>
    {!checking && !setup && <form onSubmit={login} className="mt-6 space-y-4"><label className="block text-sm">Heslo<input autoComplete="current-password" type={showPassword ? 'text' : 'password'} required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-border-subtle bg-surface px-3 py-3" /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} />Zobrazit heslo</label><button className="button-primary" disabled={busy}>{busy ? 'Přihlašuji…' : 'Přihlásit se'}</button></form>}
    {!checking && !setup && <details className="mt-5 text-sm text-ink-secondary"><summary className="cursor-pointer py-2 text-brand">Nemůžu se přihlásit</summary><p className="mt-2 leading-relaxed">Pokud heslo neznáš nebo jsi ho zapomněl/a, požádej správce svého MakAI o obnovení přístupu.</p></details>}
    {setup && <button className="button-secondary mt-5" onClick={() => window.location.reload()}>Ověřit připojení znovu</button>}
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
  </section></main>;
}
