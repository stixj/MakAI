import { useState } from 'react';
import { Pencil, Save } from 'lucide-react';
import { REVIEW_FIELDS, draftProfileContent } from '../lib/profileDraft.js';

const input = 'mt-2 w-full rounded-xl border border-viatix-line bg-white/60 px-3 py-2.5 text-sm';
export default function ProfileEditor({ profile, disabled, onSave }) {
  const cloud = import.meta.env.VITE_JOB_SOURCE === 'cloud' || import.meta.env.VITE_SHARED_STORAGE === true;
  const [draft, setDraft] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function open() {
    setError(''); setBusy(true);
    try {
      const data = profile?.profile || await fetch(import.meta.env.BASE_URL + 'templates/candidate-profile-template.json').then(response => { if (!response.ok) throw new Error(); return response.json(); });
      const context = profile?.content.trimStart().startsWith('{') ? '' : (profile?.content || '').replace(/^```json\s*\n[\s\S]*?^```\s*$/gm, '').trim();
      setDraft({ profile: structuredClone(data), context }); setName(profile?.name || 'Můj profil');
    } catch { setError('Profil se nepodařilo otevřít. Zkus to znovu.'); }
    finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); setError('');
    let content;
    try { content = draftProfileContent(draft); } catch (failure) { setError(failure.message); return; }
    setBusy(true);
    try { if (await onSave({ name, content })) setDraft(null); }
    finally { setBusy(false); }
  }
  function change(key, value) { setDraft(previous => ({ ...previous, profile: { ...previous.profile, [key]: value } })); }
  function salary(key, value) { setDraft(previous => ({ ...previous, profile: { ...previous.profile, salary: { ...previous.profile.salary, [key]: value } } })); }
  return <div className="mt-4">{!draft ? <button className="button-secondary" disabled={disabled || busy} onClick={open}><Pencil className="h-4 w-4" />{profile ? 'Upravit profil' : 'Vytvořit profil'}</button> : <form onSubmit={save} className="rounded-2xl border border-viatix-line/60 bg-white/25 p-4 sm:p-5">
    <h3 className="font-display text-lg font-semibold">{profile ? 'Upravit profil' : 'Tvůj profil pro hledání'}</h3>
    {!profile && <p className="mt-2 text-xs text-amber-800">Formulář obsahuje ukázkové údaje. Před uložením je nahraď svými zkušenostmi a preferencemi.</p>}
    <p className="mt-2 text-xs text-muted-foreground">Každou roli nebo preferenci napiš na samostatný řádek.{cloud ? ' Po uložení změn se automatika pozastaví; znovu ji zapni po kontrole profilu.' : ' Uložení změn aktivuje novou verzi místního profilu.'}</p>
    <fieldset disabled={disabled || busy} className="mt-5 space-y-4">
      <label className="block text-sm">Název profilu<input required maxLength="120" value={name} onChange={event => setName(event.target.value)} className={input} /></label>
      <div className="grid gap-4 sm:grid-cols-2">{REVIEW_FIELDS.map(([key, label]) => <label key={key} className="text-sm">{label}<textarea rows={3} value={draft.profile[key].join('\n')} onChange={event => change(key, event.target.value.split('\n'))} className={input} /></label>)}</div>
      <div className="grid gap-4 sm:grid-cols-3">{[['exceptional_minimum_czk', 'Výjimečné minimum'], ['standard_minimum_czk', 'Běžné minimum'], ['interesting_minimum_czk', 'Zajímavá mzda od']].map(([key, label]) => <label key={key} className="text-sm">{label}<input required type="number" min="0" step="1" value={draft.profile.salary[key]} onChange={event => salary(key, event.target.value === '' ? null : Number(event.target.value))} className={input} /></label>)}</div>
      <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map(index => <label key={index} className="text-sm">Cílová mzda {index ? 'do' : 'od'} (Kč hrubého / měsíc)<input required type="number" min="0" step="1" value={draft.profile.salary.monthly_gross_target_czk[index] ?? ''} onChange={event => salary('monthly_gross_target_czk', draft.profile.salary.monthly_gross_target_czk.map((value, i) => i === index ? event.target.value === '' ? null : Number(event.target.value) : value))} className={input} /></label>)}</div>
      <label className="block text-sm">Poznámky ke mzdě<textarea rows={2} value={draft.profile.salary.notes} onChange={event => salary('notes', event.target.value)} className={input} /></label>
      <label className="block text-sm">Profesní shrnutí, zkušenosti a projekty<textarea rows={8} value={draft.context} onChange={event => setDraft(previous => ({ ...previous, context: event.target.value }))} className={input} /></label>
      <div className="flex flex-wrap gap-3"><button className="button-primary"><Save className="h-4 w-4" />{busy ? 'Ukládám…' : 'Uložit profil'}</button><button type="button" className="button-secondary" onClick={() => setDraft(null)}>Zrušit</button></div>
    </fieldset>
  </form>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</div>;
}
