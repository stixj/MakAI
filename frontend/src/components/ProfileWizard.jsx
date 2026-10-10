import { clearDraft, useDraftState, useUnsavedWarning } from '../hooks/useDraft.js';
import { useState } from 'react';
import { ArrowLeft, Check, Loader2, Sparkles, X, FileUp } from 'lucide-react';
import { profileApi } from '../lib/profileApi.js';
import { QUESTION_FIELDS, REVIEW_FIELDS, questionnairePayload, draftProfileContent, manualProfileDraft } from '../lib/profileDraft.js';

const inputClass = 'mt-2 w-full rounded-xl border border-border-subtle bg-surface px-3 py-2.5 text-sm placeholder:text-ink-secondary';
const numeric = value => value === '' ? null : Number(value);

export default function ProfileWizard({ disabled, onActivate, onBusyChange = () => {}, triggerLabel = 'Vytvořit profil s AI', primary = false, draftKey = 'profile-wizard:new' }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useDraftState(draftKey + ':step', -1);
  const [cvFile, setCvFile] = useState(null);
  const [cvDocument, setCvDocument] = useState(null);
  const [cvText, setCvText] = useState('');
  const [cvSummary, setCvSummary] = useDraftState(draftKey + ':cvSummary', '');
  const [clarifications, setClarifications] = useDraftState(draftKey + ':clarifications', []);
  const [answers, setAnswers] = useDraftState(draftKey + ':answers', {});
  const [name, setName] = useDraftState(draftKey + ':name', '');
  const [draft, setDraft] = useDraftState(draftKey + ':draft', null);
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
  async function readCv() {
    if (!cvFile) { setError('Nejdřív vyber životopis.'); return; }
    if (cvFile.size > 2000000 || !/\.(pdf|docx|txt|md)$/i.test(cvFile.name)) { setError('Vyber PDF, DOCX, TXT nebo Markdown do 2 MB.'); return; }
    setBusy(true); onBusyChange(true); setError('');
    try {
      const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(cvFile); });
      const result = await profileApi('/api/profile/cv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: cvFile.name, base64 }) }, 120000);
      setAnswers(result.answers); setCvText(result.cvText); setCvSummary(result.summary); setCvDocument({ name: cvFile.name, base64, extractedText: result.cvText });
      setClarifications(result.questions.map(question => ({ question, answer: '' }))); setStep(0);
    } catch (failure) { setError(failure.message || 'Životopis se nepodařilo přečíst.'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  function updateAnswer(key, value) { setAnswers(previous => ({ ...previous, [key]: value })); setDraft(null); setConfirmed(false); setError(''); }
  function updateProfile(key, value) { setDraft(previous => ({ ...previous, profile: { ...previous.profile, [key]: value } })); setConfirmed(false); }
  function updateSalary(key, value) { setDraft(previous => ({ ...previous, profile: { ...previous.profile, salary: { ...previous.profile.salary, [key]: value } } })); setConfirmed(false); }
  function stepValid(index) {
    const keys = index === 0 ? ['career_goal', 'experience', 'skills'] : ['location', 'languages'];
    if (keys.some(key => !answers[key]?.trim())) { setError('Vyplň prosím povinné otázky v tomto kroku.'); return false; }
    if (index === 1 && clarifications.some(item => !item.answer.trim())) { setError('Doplň také otázky k životopisu. Pokud odpověď neznáš, napiš „nevím“.'); return false; }
    setError(''); return true;
  }
  async function generate(event) {
    event.preventDefault(); setError('');
    let payload;
    try { payload = questionnairePayload(answers); }
    catch (failure) { setError(failure.message); return; }
    setBusy(true); onBusyChange(true);
    try {
      const result = await profileApi('/api/profile/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: payload, cvText, clarifications }) }, 120000);
      setDraft(result); setConfirmed(false); setStep(3);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); onBusyChange(false); }
  }
  function manualDraft() {
    try { setDraft(manualProfileDraft(answers)); setConfirmed(false); setStep(3); setError(''); } catch(failure) { setError(failure.message); }
  }
  async function activate() {
    setError('');
    if (!confirmed) { setError('Před aktivací potvrď kontrolu návrhu.'); return; }
    try {
      const content = draftProfileContent(draft);
      const success = await onActivate({ name: (name.trim() || 'Můj pracovní profil') + '.md', content, ...(cvDocument ? { cvDocument } : {}) });
      if (success) { setOpen(false); setDraft(null); setAnswers({}); setStep(-1); setName(''); setConfirmed(false); setCvText(''); setCvSummary(''); setCvFile(null); setCvDocument(null); setClarifications([]); ['step','cvText','cvSummary','clarifications','answers','name','draft'].forEach(key => clearDraft(draftKey + ':' + key)); }
      else setError('Profil se nepodařilo aktivovat. Zkontroluj návrh a chybovou zprávu pod panelem.');
    } catch (failure) { setError(failure.message); }
  }
  useUnsavedWarning(open && (Object.keys(answers).length > 0 || !!draft));
  const fields = step === 0 ? QUESTION_FIELDS.slice(0, 3) : QUESTION_FIELDS.slice(3);

  if (!open) return <div className="mt-4"><button type="button" className={primary ? 'button-primary' : 'button-secondary'} disabled={disabled} onClick={openWizard}><Sparkles className="h-4 w-4" aria-hidden="true" />{triggerLabel}</button><span className="ml-3 inline-block pt-2 text-xs text-ink-secondary">Ze životopisu nebo pomocí krátkých otázek</span></div>;
  return <section aria-labelledby="wizard-title" className="mt-5 rounded-2xl border border-border-subtle bg-surface p-4 sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><h3 id="wizard-title" className="font-display text-lg font-semibold">Tvůj profil pro hledání</h3><p className="mt-1 text-xs text-ink-secondary">{step === -1 ? 'Vyber, jak začít' : step < 3 ? 'Krok ' + (step + 1) + ' ze 3 · ' + ['Směr a zkušenosti', 'Pracovní podmínky', 'Mzda a vytvoření návrhu'][step] : 'Kontrola návrhu před aktivací'}</p></div>
      <button type="button" aria-label="Zavřít dotazník" disabled={busy || disabled} className="rounded-lg p-2 text-brand" onClick={() => setOpen(false)}><X className="h-4 w-4" aria-hidden="true" /></button></div>
    {step === -1 ? <div className="mt-5 space-y-5">
      <p className="text-sm text-ink-secondary">Začni životopisem. Doplníš jen to, co hledáš dál, a před uložením zkontroluješ návrh.</p>
      <div className="rounded-xl border border-border-subtle p-4"><h4 className="font-semibold">Mám životopis</h4><p className="mt-2 text-xs text-ink-secondary">PDF s čitelným textem, DOCX, TXT nebo Markdown · do 2 MB. Naskenované PDF bez textu použít nelze.</p>
        <label className="mt-3 block text-sm">Vyber životopis<input type="file" accept=".pdf,.docx,.txt,.md" disabled={busy || disabled} onChange={event => { setCvFile(event.target.files?.[0] || null); setError(''); }} className="mt-2 block w-full text-sm" /></label>
        {(import.meta.env.VITE_JOB_SOURCE === 'cloud' || import.meta.env.VITE_SHARED_STORAGE === true) && <p className="mt-3 rounded-lg bg-fit-potential-bg px-3 py-2 text-xs leading-relaxed text-fit-potential-text">Tato prototypová online verze má společné přihlášení a profily. Uložené CV proto zatím není soukromé vůči ostatním přihlášeným uživatelům.</p>}
        <p className="mt-3 text-xs text-ink-secondary">Text životopisu se odešle AI poskytovateli {config?.provider || 'nastavenému v aplikaci'}. Po aktivaci profilu se uloží také původní soubor a jeho text, aby šel později znovu stáhnout, nahradit nebo použít při přípravě odpovědi na nabídku.</p>
        <button type="button" className="button-primary mt-3" disabled={busy || disabled || !cvFile || !config?.configured} onClick={readCv}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}{busy ? 'Čtu a vyhodnocuji životopis…' : 'Načíst životopis pomocí AI'}</button>
      </div>
      <div className="rounded-xl border border-border-subtle p-4"><h4 className="font-semibold">Začnu bez životopisu</h4><p className="mt-2 text-xs text-ink-secondary">Odpovíš na hlavní otázky o zkušenostech, cílech a pracovních podmínkách.</p><button type="button" className="button-secondary mt-3" disabled={busy || disabled} onClick={() => { setStep(0); setCvText(''); setCvSummary(''); setCvDocument(null); setClarifications([]); }}>Vyplnit krátký dotazník</button></div>
      {config && !config.configured && <p role="status" className="text-sm text-fit-potential-text">AI zatím není připojená. Odpovědi můžeš připravit; návrh můžeš dokončit i bez AI.</p>}
    </div> : step < 3 ? <form className="mt-5" onSubmit={generate}>
      {cvSummary && step === 0 && <div className="mb-5 rounded-xl bg-surface-subtle p-4 text-sm"><p className="font-semibold">Co AI přečetla ze životopisu</p><p className="mt-2 whitespace-pre-wrap">{cvSummary}</p><p className="mt-2 text-xs">Zkontroluj předvyplněné údaje a doplň, co hledáš dál.</p></div>}
      <fieldset disabled={busy || disabled} className="space-y-4">
        {step < 2 && fields.map(field => <label key={field.key} className="block text-sm font-medium">{field.title}{field.required && <span aria-hidden="true"> *</span>}
          <textarea value={answers[field.key] || ''} onChange={event => updateAnswer(field.key, event.target.value)} rows={field.key === 'experience' ? 3 : 2} maxLength={field.key === 'experience' ? 5000 : field.key === 'career_goal' || field.key === 'skills' ? 3000 : 2000} required={field.required} className={inputClass} aria-describedby={'hint-' + field.key} />
          <span id={'hint-' + field.key} className="mt-1 block text-xs font-normal text-ink-secondary">{field.hint}</span>
        </label>)}
        {step === 1 && clarifications.length > 0 && <div className="space-y-4 border-t border-border-subtle pt-4"><h4 className="font-semibold">Doplňující otázky k životopisu</h4>{clarifications.map((item, index) => <label key={index} className="block text-sm">{item.question}<textarea required maxLength={3000} rows={2} value={item.answer} onChange={event => { setClarifications(previous => previous.map((value, i) => i === index ? { ...value, answer: event.target.value } : value)); setConfirmed(false); }} className={inputClass} /><span className="mt-1 block text-xs text-ink-secondary">Pokud odpověď neznáš, napiš „nevím“.</span></label>)}</div>}
        {step === 2 && <>
          <p className="text-sm text-ink-secondary">Jaké jsou tvoje mzdové představy? Částky jsou za měsíc hrubého v Kč.</p>
          <div className="grid gap-4 sm:grid-cols-3">{[['salary_minimum', 'Běžné minimum'], ['salary_target_lower', 'Cílová mzda od'], ['salary_target_upper', 'Cílová mzda do']].map(([key, label]) => <label className="text-sm font-medium" key={key}>{label} *<input type="number" inputMode="numeric" min="0" max="10000000" step="1" required value={answers[key] ?? ''} onChange={event => updateAnswer(key, event.target.value)} className={inputClass} /></label>)}</div>
          <label className="block text-sm font-medium">Název profilu <span className="font-normal text-ink-secondary">(volitelné)</span><input value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Například Můj kariérní profil" className={inputClass} /></label>
          <p className="text-xs leading-relaxed text-ink-secondary">Odpovědi a případné podklady ze životopisu se po kliknutí na „Sestavit návrh pomocí AI“ odešlou AI poskytovateli {config?.provider || 'nastavenému v aplikaci'}. Návrh si poté zkontroluješ a můžeš upravit. Generování používá nastavené API a může být zpoplatněné. Osobní kontaktní údaje nejsou potřeba.</p>
          {config && !config.configured && <p role="status" className="rounded-xl bg-fit-potential-bg text-fit-potential-text p-3 text-sm">AI zatím není připojená. Pokračuj tlačítkem Dokončit bez AI, nebo ověř připojení znovu.</p>}
        </>}
      </fieldset>
      <div className="sticky bottom-3 z-10 mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-surface-subtle p-3">
        {step >= 0 && <button type="button" className="button-secondary" disabled={busy || disabled} onClick={() => { setStep(step - 1); setError(''); }}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zpět</button>}
        {step < 2 ? <button type="button" className="button-primary" disabled={busy || disabled} onClick={() => { if (stepValid(step)) setStep(step + 1); }}>Pokračovat</button> : <>
          <button type="submit" className="button-primary" disabled={busy || disabled || !config?.configured}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{busy ? 'Sestavuji návrh…' : 'Sestavit návrh pomocí AI'}</button>
          <button type="button" className="button-secondary" disabled={busy || disabled} onClick={manualDraft}>Dokončit bez AI</button>
          <button type="button" className="button-secondary" disabled={checking || busy || disabled} onClick={checkConfig}>{checking ? 'Ověřuji…' : 'Ověřit nastavení'}</button>
        </>}
      </div>
      {busy && <p role="status" className="mt-3 text-sm text-brand">AI zpracovává odpovědi. Aktivní profil se změní až po kontrole a aktivaci návrhu.</p>}
    </form> : draft && <div className="mt-5 space-y-4">
      <p className="text-sm leading-relaxed text-ink-secondary">Zkontroluj navržené role, dovednosti a podmínky. Všechny položky můžeš upravit; v seznamech piš každou položku na samostatný řádek.</p>
      {draft.missingInformation.length > 0 && <div className="rounded-xl bg-fit-potential-bg text-fit-potential-text p-3 text-sm"><p className="font-medium">Co ještě doplnit nebo ověřit</p><ul className="mt-2 list-disc space-y-1 pl-5">{draft.missingInformation.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">{REVIEW_FIELDS.slice(0,4).map(([key, label]) => <label key={key} className="block text-sm font-medium">{label}<textarea rows={3} value={draft.profile[key].join('\n')} onChange={event => updateProfile(key, event.target.value.split('\n'))} className={inputClass} /></label>)}</fieldset>
      <details className="rounded-xl border border-border-subtle p-4"><summary className="cursor-pointer text-sm font-medium text-brand">Pracovní styl a další preference</summary><fieldset disabled={disabled} className="mt-4 grid gap-4 sm:grid-cols-2">{REVIEW_FIELDS.slice(4).map(([key,label]) => <label key={key} className="text-sm">{label}<textarea rows={2} value={draft.profile[key].join('\n')} onChange={e => updateProfile(key,e.target.value.split('\n'))} className={inputClass} /></label>)}</fieldset></details>
      <fieldset disabled={disabled}><legend className="text-sm font-semibold">Mzda za měsíc hrubého v Kč</legend><div className="mt-2 grid gap-4 sm:grid-cols-3">{[['standard_minimum_czk', 'Běžné minimum'], ['lower', 'Cílová mzda od'], ['upper', 'Cílová mzda do']].map(([key, label]) => <label key={key} className="text-sm font-medium">{label}<input type="number" min="0" step="1" className={inputClass} value={(key === 'lower' || key === 'upper' ? draft.profile.salary.monthly_gross_target_czk[key === 'lower' ? 0 : 1] : draft.profile.salary[key]) ?? ''} onChange={event => {
        const value = numeric(event.target.value);
        if (key === 'lower' || key === 'upper') { const range = [...draft.profile.salary.monthly_gross_target_czk]; range[key === 'lower' ? 0 : 1] = value; updateSalary('monthly_gross_target_czk', range); if (key === 'lower') updateSalary('interesting_minimum_czk', value); }
        else { updateSalary(key, value); updateSalary('exceptional_minimum_czk', value); }
      }} /></label>)}</div></fieldset>
      <details className="rounded-xl border border-border-subtle p-3"><summary className="cursor-pointer text-sm font-medium text-brand">Další mzdové podmínky</summary><fieldset disabled={disabled} className="mt-3 grid gap-3 sm:grid-cols-2">{[['exceptional_minimum_czk', 'Výjimečné minimum'], ['interesting_minimum_czk', 'Finančně zajímavá mzda od'], ['long_term_target_czk', 'Dlouhodobý cíl (volitelné)'], ['long_term_horizon_years', 'Horizont v letech (volitelné)']].map(([key, label]) => <label key={key} className="text-sm">{label}<input type="number" min={key === 'long_term_horizon_years' ? 1 : 0} step="1" value={draft.profile.salary[key] ?? ''} onChange={event => updateSalary(key, numeric(event.target.value))} className={inputClass} /></label>)}<label className="text-sm sm:col-span-2">Poznámky ke mzdě<textarea rows={2} value={draft.profile.salary.notes} onChange={event => updateSalary('notes', event.target.value)} className={inputClass} /></label></fieldset></details>
      <label className="block text-sm font-medium">Profesní shrnutí a podklady<textarea rows={4} disabled={disabled} value={draft.context} onChange={event => { setDraft(previous => ({ ...previous, context: event.target.value })); setConfirmed(false); }} className={inputClass} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-brand" /><span>Zkontroloval/a jsem návrh a údaje odpovídají mým zkušenostem a preferencím.</span></label>
      <div className="flex flex-wrap gap-3"><button type="button" className="button-primary" disabled={disabled || !confirmed} onClick={activate}><Check className="h-4 w-4" aria-hidden="true" />Aktivovat profil pro hledání</button><button type="button" className="button-secondary" disabled={disabled} onClick={() => { setStep(0); setConfirmed(false); setError(''); }}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Upravit odpovědi</button></div>
    </div>}
    {step >= 0 && <p className="mt-4 text-xs text-ink-secondary">Rozpracovaný profil je uchovaný v této kartě prohlížeče po dobu 24 hodin. Uložení do MakAI potvrdíš na konci.</p>}
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
  </section>;
}
