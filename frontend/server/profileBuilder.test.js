import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCv, analyseCv, generateDraft } from './profileBuilder.js';
import { QUESTION_FIELDS } from '../src/lib/profileDraft.js';
import { readFile } from 'node:fs/promises';
const env = { OPENAI_API_KEY: 'private-key', OPENAI_MODEL: 'gpt-4o-mini' };
const cv = { name: 'cv.txt', base64: Buffer.from('Project manager, 5 years of experience. English B2. SQL basics.').toString('base64') };
const answers = { career_goal: 'Project manager', experience: '5 years managing projects', skills: 'SQL basics', location: 'Brno, hybrid', languages: 'English B2', working_style: '', no_go: '', salary_minimum: 50000, salary_target_lower: 60000, salary_target_upper: 80000 };
const fake = result => async (url, request) => ({ ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }) });
test('CV extraction accepts text and real PDF/DOCX, refuses fake, oversized and unreadable files', async () => {
  assert.ok((await extractCv(cv)).includes('SQL basics'));
  for (const extension of ['pdf', 'docx']) {
    const buffer = await readFile(new URL('./fixtures/cv.' + extension, import.meta.url));
    assert.ok((await extractCv({ name: 'cv.' + extension, base64: buffer.toString('base64') })).includes('Project manager'));
  }
  await assert.rejects(extractCv({ ...cv, name: 'fake.pdf' }));
  await assert.rejects(extractCv({ ...cv, base64: Buffer.from('short').toString('base64') }));
  await assert.rejects(extractCv({ ...cv, base64: 'A'.repeat(2800004) }));
});
test('CV interview preserves unknowns and returns editable evidence plus follow-up questions', async () => {
  const result = await analyseCv(cv, env, fake({ answers: { ...Object.fromEntries(QUESTION_FIELDS.map(field => [field.key, null])), experience: '5 years managing projects', skills: 'SQL basics', languages: 'English B2' }, summary: 'Project manager', questions: ['What project outcomes can you describe?'] }));
  assert.equal(result.answers.career_goal, ''); assert.equal(result.answers.location, '');
  assert.equal(result.answers.skills, 'SQL basics'); assert.equal(result.questions.length, 1);
  assert.ok(result.cvText.includes('Project manager')); assert.equal(result.answers.salary_minimum, undefined);
});
test('draft copies candidate salary and conditions, sends only this candidate, persists no raw CV or contacts', async () => {
  const response = { target_roles: ['Project Manager'], skills: ['SQL basics'], preferences: [], evidence_limitations: [], professional_summary: 'Project manager with 5 years of experience.', missing_information: [] };
  let request;
  const result = await generateDraft({ answers, cvText: 'Private CV with phone +420123456789', clarifications: [{ question: 'Outcome?', answer: 'Finished migration' }] }, env, async (url, options) => { request = JSON.parse(options.body); return fake(response)(url, options); });
  assert.equal(request.store, false); assert.equal(request.text.format.strict, true);
  assert.equal(result.profile.salary.standard_minimum_czk, 50000);
  assert.deepEqual(result.profile.location_preferences, ['Brno, hybrid']);
  assert.ok(result.context.includes('Finished migration')); assert.ok(!result.context.includes('+420123456789'));
  assert.ok(!JSON.stringify(result).includes('private-key'));
  await assert.rejects(generateDraft({ answers: { ...answers, salary_target_lower: 100 } }, env, fake(response)));
});
test('AI transport, quota, refusal and malformed responses are redacted', async () => {
  for (const fetcher of [async () => { throw new Error('private-key'); }, async () => ({ ok: false, status: 429 }), fake({}), async () => ({ ok: true, json: async () => ({ status: 'incomplete' }) })]) {
    await assert.rejects(generateDraft({ answers }, env, fetcher), error => !error.message.includes('private-key'));
  }
});

test('Gemini uses configured dedicated profile model and accepts only completed JSON', async () => {
  let seen;
  const result = await analyseCv(cv, { GEMINI_API_KEY: 'private-gemini', GEMINI_MODEL: 'search-model', PROFILE_GEMINI_MODEL: 'gemini-3.1-flash-lite' }, async (url, options) => {
    seen = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ answers: Object.fromEntries(QUESTION_FIELDS.map(field => [field.key, null])), summary: 'Project manager', questions: [] }) }] } }] }) };
  });
  assert.ok(seen.url.includes('gemini-3.1-flash-lite:generateContent'));
  assert.equal(seen.options.headers['x-goog-api-key'], 'private-gemini');
  assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(!JSON.stringify(result).includes('private-gemini'));
});
