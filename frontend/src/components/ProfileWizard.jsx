import { useState } from 'react';
import { ArrowLeft, Check, Loader2, Sparkles, X } from 'lucide-react';
import { profileApi } from '../lib/profileApi.js';
import { QUESTION_FIELDS, REVIEW_FIELDS, questionnairePayload, draftProfileContent } from '../lib/profileDraft.js';

const inputClass = 'mt-2 w-full rounded-xl border border-viatix-line bg-white/50 px-3 py-2.5 text-sm placeholder:text-muted-foreground';
const numeric = value => value === '' ? null : Number(value);

export default function ProfileWizard({ disabled, onActivate, onBusyChange }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [name, setName] = useState('');
  const [draft, setDraft] = useState(null);
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  async function checkConfig() {
    setChecking(true); setError('');
    try { setConfig(await profileApi('/api/profile/draft')); }
    catch (failure) { setError(failure.message); }
    finally { setChecking(false); }
  }
  function openWizard() { setOpen(true); checkConfig(); }
  function updateAnswer(key, value) { setAnswers(previous => ({ ...previous, [key]: value })); setDraft(null); setConfirmed(false); setError(''); }
  function updateProfile(key, value) { setDraft(previous => ({ ...previous, profile: { ...previous.profile, [key]: value } })); setConfirmed(false); }
  function updateSalary(key, value) { setDraft(previous => ({ ...previous, profile: { ...previous.profile, salary: { ...previous.profile.salary, [key]: value } } })); setConfirmed(false); }
  function stepValid(index) {
    const keys = index === 0 ? ['career_goal', 'experience', 'skills'] : ['location', 'languages'];
    if (keys.some(key => !answers[key]?.trim())) { setError('Vyplň prosím povinné otázky v tomto kroku.'); return false; }
    setError(''); return true;
  }
  async function generate(event) {
    event.preventDefault(); setError('');
    let payload;
    try { payload = questionnairePayload(answers); }
    catch (failure) { setError(failure.message); return; }
    setBusy(true); onBusyChange(true);
    try {
      const result = await profileApi('/api/profile/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 160000);
      setDraft(result); setConfirmed(false); setStep(3);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); onBusyChange(false); }
  }
  async function activate() {
    setError('');
    if (!confirmed) { setError('Před aktivací potvrď kontrolu návrhu.'); return; }
    try {
      const content = draftProfileContent(draft);
      const success = await onActivate({ name: (name.trim() || 'Profil z dotazníku') + '.md', content });
      if (success) { setOpen(false); setDraft(null); setAnswers({}); setStep(0); setName(''); setConfirmed(false); }
      else setError('Profil se nepodařilo aktivovat. Zkontroluj návrh a chybovou zprávu pod panelem.');
    } catch (failure) { setError(failure.message); }
  }
  const fields = step === 0 ? QUESTION_FIELDS.slice(0, 3) : QUESTION_FIELDS.slice(3);

  if (!open) return <div className="mt-4"><button type="button" className="button-secondary" disabled={disabled} onClick={openWizard}><Sparkles className="h-4 w-4" aria-hidden="true" />Vytvořit profil s AI</button><span className="ml-3 inline-block pt-2 text-xs text-muted-foreground">Krátký dotazník místo vyplňování šablony</span></div>;
  return <section aria-labelledby="wizard-title" className="mt-5 rounded-2xl border border-viatix-teal/25 bg-white/40 p-4 sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><h3 id="wizard-title" className="font-display text-lg font-semibold">Tvůj profil z krátkého dotazníku</h3><p className="mt-1 text-xs text-muted-foreground">{step < 3 ? 'Krok ' + (step + 1) + ' ze 3 · ' + ['Směr a zkušenosti', 'Pracovní podmínky', 'Mzda a vytvoření návrhu'][step] : 'Kontrola návrhu před aktivací'}</p></div>
      <button type="button" aria-label="Zavřít dotazník" disabled={busy || disabled} className="rounded-lg p-2 text-viatix-teal" onClick={() => setOpen(false)}><X className="h-4 w-4" aria-hidden="true" /></button></div>
    {step < 3 ? <form className="mt-5" onSubmit={generate}>
      <fieldset disabled={busy || disabled} className="space-y-4">
        {step < 2 && fields.map(field => <label key={field.key} className="block text-sm font-medium">{field.title}{field.required && <span aria-hidden="true"> *</span>}
          <textarea value={answers[field.key] || ''} onChange={event => updateAnswer(field.key, event.target.value)} rows={field.key === 'experience' ? 3 : 2} maxLength={field.key === 'experience' ? 5000 : field.key === 'career_goal' || field.key === 'skills' ? 3000 : 2000} required={field.required} className={inputClass} aria-describedby={'hint-' + field.key} />
          <span id={'hint-' + field.key} className="mt-1 block text-xs font-normal text-muted-foreground">{field.hint}</span>
        </label>)}
        {step === 2 && <>
          <p className="text-sm text-muted-foreground">Jaké jsou tvoje mzdové představy? Částky jsou za měsíc hrubého v Kč.</p>
          <div className="grid gap-4 sm:grid-cols-3">{[['salary_minimum', 'Běžné minimum'], ['salary_target_lower', 'Cílová mzda od'], ['salary_target_upper', 'Cílová mzda do']].map(([key, label]) => <label className="text-sm font-medium" key={key}>{label} *<input type="number" inputMode="numeric" min="0" max="10000000" step="1" required value={answers[key] ?? ''} onChange={event => updateAnswer(key, event.target.value)} className={inputClass} /></label>)}</div>
          <label className="block text-sm font-medium">Název profilu <span className="font-normal text-muted-foreground">(volitelné)</span><input value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Například Můj kariérní profil" className={inputClass} /></label>
          <p className="text-xs leading-relaxed text-muted-foreground">Odpovědi se po kliknutí na „Sestavit návrh přes OpenAI“ odešlou do OpenAI pro vytvoření profilu. Návrh si poté zkontroluješ a můžeš upravit. Generování používá nastavené API a může být zpoplatněné. Osobní kontaktní údaje nejsou potřeba.</p>
          {config && !config.configured && <p role="status" className="rounded-xl bg-viatix-amber/15 p-3 text-sm">OpenAI zatím není připojené. Provozovatel aplikace musí nastavit jeho API klíč; potom ověř nastavení znovu.</p>}
        </>}
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {step > 0 && <button type="button" className="button-secondary" disabled={busy || disabled} onClick={() => { setStep(step - 1); setError(''); }}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zpět</button>}
        {step < 2 ? <button type="button" className="button-primary" disabled={busy || disabled} onClick={() => { if (stepValid(step)) setStep(step + 1); }}>Pokračovat</button> : <>
          <button type="submit" className="button-primary" disabled={busy || disabled || !config?.configured}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{busy ? 'Sestavuji návrh…' : 'Sestavit návrh přes OpenAI'}</button>
          <button type="button" className="button-secondary" disabled={checking || busy || disabled} onClick={checkConfig}>{checking ? 'Ověřuji…' : 'Ověřit nastavení'}</button>
        </>}
      </div>
      {busy && <p role="status" className="mt-3 text-sm text-viatix-teal">OpenAI zpracovává odpovědi. Aktivní profil se změní až po kontrole a aktivaci návrhu.</p>}
    </form> : draft && <div className="mt-5 space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">Zkontroluj navržené role, dovednosti a podmínky. Všechny položky můžeš upravit; v seznamech piš každou položku na samostatný řádek.</p>
      {draft.missingInformation.length > 0 && <div className="rounded-xl bg-viatix-amber/15 p-3 text-sm"><p className="font-medium">Co ještě doplnit nebo ověřit</p><ul className="mt-2 list-disc space-y-1 pl-5">{draft.missingInformation.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">{REVIEW_FIELDS.map(([key, label]) => <label key={key} className="block text-sm font-medium">{label}<textarea rows={3} value={draft.profile[key].join('\n')} onChange={event => updateProfile(key, event.target.value.split('\n'))} className={inputClass} /></label>)}</fieldset>
      <fieldset disabled={disabled}><legend className="text-sm font-semibold">Mzda za měsíc hrubého v Kč</legend><div className="mt-2 grid gap-4 sm:grid-cols-3">{[['standard_minimum_czk', 'Běžné minimum'], ['lower', 'Cílová mzda od'], ['upper', 'Cílová mzda do']].map(([key, label]) => <label key={key} className="text-sm font-medium">{label}<input type="number" min="0" step="1" className={inputClass} value={(key === 'lower' || key === 'upper' ? draft.profile.salary.monthly_gross_target_czk[key === 'lower' ? 0 : 1] : draft.profile.salary[key]) ?? ''} onChange={event => {
        const value = numeric(event.target.value);
        if (key === 'lower' || key === 'upper') { const range = [...draft.profile.salary.monthly_gross_target_czk]; range[key === 'lower' ? 0 : 1] = value; updateSalary('monthly_gross_target_czk', range); if (key === 'lower') updateSalary('interesting_minimum_czk', value); }
        else { updateSalary(key, value); updateSalary('exceptional_minimum_czk', value); }
      }} /></label>)}</div></fieldset>
      <details className="rounded-xl border border-viatix-line p-3"><summary className="cursor-pointer text-sm font-medium text-viatix-teal">Další mzdové podmínky</summary><fieldset disabled={disabled} className="mt-3 grid gap-3 sm:grid-cols-2">{[['exceptional_minimum_czk', 'Výjimečné minimum'], ['interesting_minimum_czk', 'Finančně zajímavá mzda od'], ['long_term_target_czk', 'Dlouhodobý cíl (volitelné)'], ['long_term_horizon_years', 'Horizont v letech (volitelné)']].map(([key, label]) => <label key={key} className="text-sm">{label}<input type="number" min={key === 'long_term_horizon_years' ? 1 : 0} step="1" value={draft.profile.salary[key] ?? ''} onChange={event => updateSalary(key, numeric(event.target.value))} className={inputClass} /></label>)}<label className="text-sm sm:col-span-2">Poznámky ke mzdě<textarea rows={2} value={draft.profile.salary.notes} onChange={event => updateSalary('notes', event.target.value)} className={inputClass} /></label></fieldset></details>
      <label className="block text-sm font-medium">Profesní shrnutí a podklady<textarea rows={8} disabled={disabled} value={draft.context} onChange={event => { setDraft(previous => ({ ...previous, context: event.target.value })); setConfirmed(false); }} className={inputClass} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-viatix-teal" /><span>Zkontroloval/a jsem návrh a údaje odpovídají mým zkušenostem a preferencím.</span></label>
      <div className="flex flex-wrap gap-3"><button type="button" className="button-primary" disabled={disabled || !confirmed} onClick={activate}><Check className="h-4 w-4" aria-hidden="true" />Aktivovat profil pro hledání</button><button type="button" className="button-secondary" disabled={disabled} onClick={() => { setStep(0); setConfirmed(false); setError(''); }}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Upravit odpovědi</button></div>
    </div>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
  </section>;
}
