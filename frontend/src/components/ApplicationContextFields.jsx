const fieldClass='mt-1 w-full min-w-0 rounded-xl border border-viatix-line bg-white p-3 text-sm';
export const APPLICATION_CONTEXT_LABELS={sentDocuments:'odeslané podklady',applicationChannel:'způsob přihlášení',responseExpectedAt:'slíbený termín odpovědi',applicationDeadline:'uzávěrka přihlášek',selectionStage:'kolo výběrového řízení',assignment:'zadání od firmy',assignmentDue:'termín zadání',assignmentDone:'odevzdání zadání',questions:'otázky pro firmu',offeredConditions:'nabídnuté podmínky',outcomeReason:'výsledek a zpětná vazba'};
export default function ApplicationContextFields({draft,update}) {
  const input=(key,label,type='text',placeholder='')=><label key={key} className="block min-w-0 text-xs">{label}<input type={type} value={draft[key]||''} maxLength={200} placeholder={placeholder} onChange={e=>update(key,e.target.value||(type==='date'?null:''))} className={fieldClass} /></label>;
  const area=(key,label,maxLength,placeholder)=><label key={key} className="mt-3 block text-xs">{label}<textarea rows={3} value={draft[key]||''} maxLength={maxLength} placeholder={placeholder} onChange={e=>update(key,e.target.value)} className={fieldClass} /></label>;
  return <>
    <details className="rounded-xl border border-viatix-line p-4"><summary className="cursor-pointer text-sm font-semibold text-viatix-teal">Odeslané podklady a způsob přihlášení</summary>
      {area('sentDocuments','Jaké CV a podklady jsem poslal',3000,'Např. CV_analytik_CZ_v3.pdf, motivační dopis, odkaz na portfolio…')}
      <p className="mt-2 text-xs text-muted-foreground">Zapiš názvy, verze a jazyk podkladů. Toto pole eviduje text, soubory se sem nenahrávají.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{input('applicationChannel','Kde a jak jsem reagoval','text','Např. Jobs.cz, e-mail, doporučení')}{input('applicationDeadline','Uzávěrka přihlášek','date')}</div>
    </details>
    <details className="rounded-xl border border-viatix-line p-4"><summary className="cursor-pointer text-sm font-semibold text-viatix-teal">Dohody s firmou a příprava</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{input('responseExpectedAt','Firma slíbila odpověď do','date')}{input('selectionStage','Aktuální kolo výběrového řízení','text','Např. druhé kolo s vedoucím týmu')}</div>
      {area('assignment','Zadání od firmy',4000,'Co mám připravit nebo odevzdat…')}
      <div className="mt-3">{input('assignmentDue','Termín odevzdání zadání','date')}</div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.assignmentDone} onChange={e=>update('assignmentDone',e.target.checked)} />Zadání odevzdáno</label>
      {area('questions','Co chci zjistit od firmy',4000,'Např. náplň běžného dne, vedení týmu, práce z domova, další postup…')}
      <p className="mt-2 text-xs text-muted-foreground">Uložený termín zadání a slíbená odpověď se promítnou do přehledu dalších kroků.</p>
    </details>
    <details className="rounded-xl border border-viatix-line p-4"><summary className="cursor-pointer text-sm font-semibold text-viatix-teal">Nabídnuté podmínky a výsledek</summary>
      {area('offeredConditions','Co mi firma skutečně nabídla',5000,'Mzda a měna, hrubá/čistá, bonusy, typ smlouvy, místo a režim práce, nástup…')}
      {area('outcomeReason','Moje rozhodnutí nebo zpětná vazba firmy',2000,'Proč nabídku přijímám či odmítám, co mi firma sdělila…')}
    </details>
  </>;
}
