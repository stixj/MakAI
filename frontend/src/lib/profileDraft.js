export const QUESTION_FIELDS = [
  { key: 'career_goal', title: 'Jakou práci hledáš a kam se chceš posunout?', hint: 'Pozice, obor nebo typ práce. Pokud neznáš název role, popiš, co chceš dělat.', required: true },
  { key: 'experience', title: 'Jaké máš dosavadní zkušenosti?', hint: 'Předchozí práce, hlavní náplň, přibližná délka praxe a konkrétní projekty.', required: true },
  { key: 'skills', title: 'Co umíš a jak dobře?', hint: 'Dovednosti, nástroje a technologie. Rozliš pokročilou praxi, základy a to, co se teprve učíš.', required: true },
  { key: 'location', title: 'Kde a v jakém režimu chceš pracovat?', hint: 'Město, dojíždění, kancelář, hybrid nebo remote; případně relokace.', required: true },
  { key: 'languages', title: 'Jaké jazyky můžeš při práci používat?', hint: 'Úroveň a situace: dokumentace, psaní, schůzky či prezentace. Pokud nevíš úroveň, popiš možnosti.', required: true },
  { key: 'working_style', title: 'Co od práce očekáváš?', hint: 'Samostatnost, tým, typ firmy, růst, pracovní doba nebo další preference.', required: false },
  { key: 'no_go', title: 'Co je pro tebe nepřijatelné?', hint: 'Jen skutečné překážky, například směny nebo pravidelné cestování. Jinak nech prázdné.', required: false },
];
export const REVIEW_FIELDS = [
  ['target_roles', 'Navržené role pro hledání'], ['skills', 'Dovednosti a úroveň zkušeností'],
  ['location_preferences', 'Lokalita a pracovní režim'], ['language_preferences', 'Jazyky'],
  ['working_style', 'Pracovní styl'], ['preferences', 'Další preference'],
  ['no_go_criteria', 'Nepřijatelné podmínky'], ['evidence_limitations', 'Nejistoty a omezení podkladů'],
];
const salaryKeys = ['salary_minimum', 'salary_target_lower', 'salary_target_upper'];
export function questionnairePayload(answers) {
  const result = Object.fromEntries(QUESTION_FIELDS.map(field => [field.key, (answers[field.key] || '').trim()]));
  if (QUESTION_FIELDS.some(field => field.required && !result[field.key])) throw new Error('Vyplň prosím všechny povinné otázky.');
  for (const key of salaryKeys) {
    const raw = String(answers[key] ?? '').trim();
    if (!/^\d+$/.test(raw) || Number(raw) > 10000000) throw new Error('Mzdy zadej jako nezáporná celá čísla v Kč za měsíc hrubého.');
    result[key] = Number(raw);
  }
  if (result.salary_minimum > result.salary_target_lower || result.salary_target_lower > result.salary_target_upper)
    throw new Error('Minimum musí být nejvýše dolní cíl a dolní cíl nejvýše horní cíl.');
  return result;
}
export function draftProfileContent(draft) {
  if (!draft.profile.target_roles.some(role => role.trim())) throw new Error('Doplň alespoň jednu roli pro hledání.');
  const cleaned = { ...draft.profile };
  for (const [key] of REVIEW_FIELDS) cleaned[key] = draft.profile[key].map(value => value.trim()).filter(Boolean);
  const s = cleaned.salary;
  const boundaries = [s.exceptional_minimum_czk, s.standard_minimum_czk, s.interesting_minimum_czk, ...s.monthly_gross_target_czk];
  if (boundaries.some((value, index) => !Number.isInteger(value) || value < 0 || (index > 0 && value < boundaries[index - 1])))
    throw new Error('Zkontroluj pořadí mzdových hranic: výjimečné minimum ≤ běžné minimum ≤ zajímavá mzda ≤ dolní cíl ≤ horní cíl.');
  const fence = String.fromCharCode(96).repeat(3);
  const context = draft.context.replace(new RegExp('^' + fence, 'gm'), String.fromCharCode(92, 96, 92, 96, 92, 96));
  return '# Kandidátský profil\n\n' + fence + 'json\n' + JSON.stringify(cleaned, null, 2) + '\n' + fence + '\n\n' + context + '\n';
}

export function manualProfileDraft(input) {
  const a = questionnairePayload(input);
  const lines = value => value.split(/\n/).map(item => item.trim()).filter(Boolean);
  return { profile: { target_roles: lines(a.career_goal), skills: lines(a.skills), location_preferences: lines(a.location), language_preferences: lines(a.languages), working_style: lines(a.working_style), preferences: [], no_go_criteria: lines(a.no_go), evidence_limitations: ['Profil je sestavený ručně z odpovědí kandidáta. Údaje nebyly ověřeny proti samostatnému CV.'], salary: { exceptional_minimum_czk: a.salary_minimum, standard_minimum_czk: a.salary_minimum, interesting_minimum_czk: a.salary_target_lower, monthly_gross_target_czk: [a.salary_target_lower,a.salary_target_upper], long_term_target_czk:null,long_term_horizon_years:null,historical_fixed_monthly_czk:null,notes:'Hrubá měsíční mzda v Kč podle odpovědí kandidáta.' } }, context: '## Dosavadní zkušenosti\n\n' + a.experience, missingInformation: [], provider: 'Ručně' };
}
