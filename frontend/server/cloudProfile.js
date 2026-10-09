import { createHash } from 'node:crypto';

const lists = ['target_roles', 'skills', 'working_style', 'preferences', 'no_go_criteria',
  'location_preferences', 'language_preferences', 'evidence_limitations'];
const salaryKeys = ['monthly_gross_target_czk', 'standard_minimum_czk', 'interesting_minimum_czk',
  'exceptional_minimum_czk', 'long_term_target_czk', 'long_term_horizon_years', 'historical_fixed_monthly_czk', 'notes'];

export function parseCloudProfile(name, raw) {
  if (typeof name !== 'string' || !name.trim() || typeof raw !== 'string' || Buffer.byteLength(raw) > 250000)
    throw new Error('Profil potřebuje název a obsah do 250 kB.');
  const content = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const blocks = [...content.matchAll(/^```json\s*\n([\s\S]*?)^```\s*$/gm)];
  let profile;
  try {
    if (content.trimStart().startsWith('{')) profile = JSON.parse(content);
    else if (blocks.length === 1) profile = JSON.parse(blocks[0][1]);
    else throw new Error();
  } catch { throw new Error('Profil musí být JSON nebo Markdown s právě jedním JSON blokem.'); }
  if (!profile || Array.isArray(profile) || Object.keys(profile).some(key => ![...lists, 'salary'].includes(key)) ||
      lists.some(key => !Array.isArray(profile[key]) || profile[key].some(value => typeof value !== 'string')) ||
      !profile.target_roles.some(value => value.trim())) throw new Error('Zkontroluj strukturu profilu a alespoň jednu cílovou roli.');
  const salary = profile.salary;
  if (!salary || Object.keys(salary).some(key => !salaryKeys.includes(key)) ||
      !Array.isArray(salary.monthly_gross_target_czk) || salary.monthly_gross_target_czk.length !== 2 || typeof salary.notes !== 'string')
    throw new Error('Zkontroluj mzdové preference.');
  const ordered = [salary.exceptional_minimum_czk, salary.standard_minimum_czk, salary.interesting_minimum_czk, ...salary.monthly_gross_target_czk];
  if (ordered.some((value, index) => !Number.isSafeInteger(value) || value < 0 || (index > 0 && value < ordered[index - 1])) ||
      ['long_term_target_czk', 'historical_fixed_monthly_czk', 'long_term_horizon_years'].some(key =>
        salary[key] != null && (!Number.isSafeInteger(salary[key]) || salary[key] < (key === 'long_term_horizon_years' ? 1 : 0))))
    throw new Error('Mzdové hranice musí být nezáporné a správně uspořádané.');
  return { id: createHash('sha256').update(content).digest('hex'), name: name.trim().slice(0, 120), content,
    profile, isDefault: false, searchTerms: profile.target_roles.map(value => value.trim()).filter(Boolean) };
}

export function profileTable(id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Neplatný profil.');
  return `makai_profile_${id}`;
}
