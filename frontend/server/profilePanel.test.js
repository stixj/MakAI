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
    const upload = renderer.root.findByProps({ type: 'file' });
    await act(async () => { await upload.props.onChange({ target: { files: [{ name: 'profile.json', size: 100, text: async () => JSON.stringify(preferences) }], value: '' } }); });
    assert.equal(buttons('Upravit profil').length, 1);
    assert.equal(buttons('Vytvořit profil').length, 0);
    assert.equal(renderer.root.findAllByType('summary').filter(node => node.children.includes('Nastavení hledání a automatizace')).length, 1);
    assert.ok(!warnings.some(message => /same key|unique.*key/i.test(message)), warnings.join('\n'));
  } finally {
    if (renderer) act(() => renderer.unmount());
    await server.close(); globalThis.fetch = originalFetch; console.error = originalError;
  }
});
