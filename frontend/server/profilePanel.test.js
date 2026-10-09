import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SCHEDULE } from '../src/lib/schedule.js';

test('loading and replacing online profile leaves exactly one editor and one schedule', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const warnings = [];
  const preferences = JSON.parse(await readFile(new URL('../public/templates/candidate-profile-template.json', import.meta.url), 'utf8'));
  let profile = { id: 'a'.repeat(64), name: 'Mine', profile: preferences, content: JSON.stringify(preferences), searchTerms: preferences.target_roles };
  const server = await createServer({ configFile: false, plugins: [react()], appType: 'custom', server: { middlewareMode: true }, define: { 'import.meta.env.VITE_JOB_SOURCE': JSON.stringify('cloud') } });
  let renderer;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/profile' && options.method === 'POST') profile = { ...profile, id: 'b'.repeat(64) };
    const body = url === '/api/profile' ? profile : url === '/api/schedule' ? { ...DEFAULT_SCHEDULE, revision: 0 } : { status: 'idle', runs: [] };
    return { ok: true, json: async () => body };
  };
  console.error = (...args) => { warnings.push(args.join(' ')); };
  try {
    const { default: ProfilePanel } = await server.ssrLoadModule('/src/components/ProfilePanel.jsx');
    await act(async () => { renderer = create(React.createElement(ProfilePanel, { onJobsChanged() {}, onProfileChanged() {} })); });
    const buttons = label => renderer.root.findAllByType('button').filter(node => node.children.includes(label));
    assert.equal(buttons('Upravit profil').length, 1);
    assert.equal(buttons('Vytvořit profil').length, 0);
    const editor = renderer.root.findAll(node => typeof node.props.onSave === 'function')[0];
    await act(async () => { await editor.props.onSave({ name: 'Changed', content: JSON.stringify(preferences) }); });
    assert.equal(buttons('Upravit profil').length, 1);
    assert.equal(buttons('Vytvořit profil').length, 0);
    assert.equal(renderer.root.findAllByType('summary').filter(node => node.children.includes('Nastavení hledání a automatizace')).length, 1);
    assert.ok(!warnings.some(message => /same key|unique.*key/i.test(message)), warnings.join('\n'));
  } finally {
    if (renderer) act(() => renderer.unmount());
    await server.close(); globalThis.fetch = originalFetch; console.error = originalError;
  }
});

test('AI wizard offers CV and questionnaire paths and asks follow-ups before draft creation', async () => {
  const originalFetch = globalThis.fetch;
  const originalReader = globalThis.FileReader;
  const server = await createServer({ configFile: false, plugins: [react()], appType: 'custom', server: { middlewareMode: true } });
  let renderer;
  globalThis.FileReader = class { readAsDataURL() { this.result = 'data:text/plain;base64,Y3Y='; this.onload(); } };
  const prefilled = { career_goal: '', experience: 'Project manager, five years', skills: 'SQL basics', location: '', languages: 'English B2', working_style: '', no_go: '' };
  globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/cv') ? { answers: prefilled, cvText: 'Synthetic CV', summary: 'Project manager', questions: ['Which project outcome can you document?'] } : { configured: true } });
  try {
    const { default: Wizard } = await server.ssrLoadModule('/src/components/ProfileWizard.jsx');
    await act(async () => { renderer = create(React.createElement(Wizard, { disabled: false, onActivate() {} })); });
    const button = label => renderer.root.findAllByType('button').find(node => node.children.includes(label));
    await act(async () => { button('Vytvořit profil s AI').props.onClick(); });
    assert.ok(button('Vyplnit krátký dotazník')); assert.ok(button('Načíst životopis pomocí AI'));
    await act(async () => { renderer.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [{ name: 'cv.txt', size: 100 }] } }); });
    await act(async () => { await button('Načíst životopis pomocí AI').props.onClick(); });
    assert.equal(renderer.root.findAllByType('textarea')[1].props.value, prefilled.experience);
    assert.equal(renderer.root.findAllByType('textarea')[0].props.value, '');
    await act(async () => { renderer.root.findAllByType('textarea')[0].props.onChange({ target: { value: 'Project Manager' } }); });
    act(() => button('Pokračovat').props.onClick());
    assert.ok(renderer.root.findAllByType('label').some(node => node.children.includes('Which project outcome can you document?')));
    act(() => button('Zpět').props.onClick()); act(() => button('Zpět').props.onClick());
    act(() => button('Vyplnit krátký dotazník').props.onClick());
    assert.ok(renderer.root.findAllByType('textarea').every(node => !node.props.value));
  } finally { if (renderer) act(() => renderer.unmount()); await server.close(); globalThis.fetch = originalFetch; globalThis.FileReader = originalReader; }
});
