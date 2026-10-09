import test from 'node:test';
import assert from 'node:assert/strict';
import { questionnairePayload, draftProfileContent } from './profileDraft.js';

const answers = { career_goal: 'Účetní', experience: 'Fakturace', skills: 'Excel', location: 'Praha', languages: 'Čeština', salary_minimum: '40000', salary_target_lower: '50000', salary_target_upper: '60000' };
test('questionnaire rejects missing answers and salary coercion before sending to OpenAI', () => {
  for (const update of [{ skills: ' ' }, { salary_minimum: '' }, { salary_minimum: '1e4' }, { salary_minimum: '60000.5' }, { salary_minimum: '70000' }]) {
    assert.throws(() => questionnairePayload({ ...answers, ...update }));
  }
  assert.equal(questionnairePayload(answers).salary_minimum, 40000);
  assert.equal(questionnairePayload(answers).no_go, '');
});
test('review content preserves changes, cleans empty list rows and escapes Markdown JSON fence injection', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const draft = { profile: { target_roles: [' Účetní ', ''], skills: ['Excel'], working_style: [], preferences: [], no_go_criteria: [], location_preferences: ['Praha'], language_preferences: ['Čeština'], evidence_limitations: [], salary: { exceptional_minimum_czk: 40000, standard_minimum_czk: 40000, interesting_minimum_czk: 50000, monthly_gross_target_czk: [50000, 60000] } }, context: 'Odpověď:\n' + fence + 'json\n{"injected":true}\n' + fence };
  const content = draftProfileContent(draft);
  assert.equal(content.match(new RegExp('^' + fence + 'json', 'gm')).length, 1);
  const data = JSON.parse(content.split(fence)[1].slice(5));
  assert.deepEqual(data.target_roles, ['Účetní']);
  assert.deepEqual(draft.profile.target_roles, [' Účetní ', '']);
  assert.throws(() => draftProfileContent({ ...draft, profile: { ...draft.profile, target_roles: [' '] } }));
});
