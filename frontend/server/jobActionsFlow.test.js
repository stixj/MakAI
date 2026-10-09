import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SCHEDULE } from '../src/lib/schedule.js';
import { historyQuery, historyView } from './historyQuery.js';

const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.props?.children ?? node.children) : '';
test('hiding removes a card, undo restores it and saved collection survives a new dashboard instance', async () => {
  const originalFetch = globalThis.fetch;
  const preferences = JSON.parse(await readFile(new URL('../public/templates/candidate-profile-template.json', import.meta.url), 'utf8'));
  const profile = { id: 'a'.repeat(64), name: 'Mine', profile: preferences, content: JSON.stringify(preferences), searchTerms: preferences.target_roles };
  const row = { offer_id: 'one', offer: JSON.stringify({ id: 'one', title: 'Analyst', company: 'Example', url: 'https://example.com/one', raw_description: 'Offer description' }),
    evaluation: JSON.stringify({ score: 85, verdict: 'STRONG_FIT', fit_reasons: ['Experience', 'Conditions'], gap_analysis: [], tailored_cv_highlights: [] }), evaluated_at: '2026-10-09T10:00:00Z' };
  let state = { saved: false, applied: false, hidden: false };
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    let body;
    if (url.startsWith('/api/jobs') && options.method === 'PATCH') {
      const patch = JSON.parse(options.body);
      assert.equal(patch.profileId, profile.id); writes.push(patch);
      state = { ...state, ...patch.changes }; body = { state, offerId: 'one', profileId: profile.id };
    } else if (url.startsWith('/api/jobs')) {
      const query = historyQuery(url);
      const { ids, ...view } = historyView([{ offer_id: 'one', title: 'Analyst', company: 'Example', score: 85, verdict: 'STRONG_FIT', evaluated_at: row.evaluated_at, state }], query);
      body = { ...view, rows: ids.length ? [{ ...row, state }] : [] };
    } else if (url === '/api/profile?list=1') body = [{ id: profile.id, name: profile.name }];
    else if (url === '/api/profile') body = profile;
    else if (url === '/api/schedule') body = { ...DEFAULT_SCHEDULE };
    else body = { status: 'idle', runs: [] };
    return { ok: true, json: async () => body };
  };
  const server = await createServer({ configFile: false, plugins: [react()], appType: 'custom', server: { middlewareMode: true },
    define: { 'import.meta.env.VITE_JOB_SOURCE': JSON.stringify('local'), 'import.meta.env.VITE_SHARED_STORAGE': 'true' } });
  let renderer;
  const button = label => renderer.root.findAllByType('button').find(node => text(node.props.children) === label);
  async function waitFor(predicate) {
    for (let i = 0; i < 50; i++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      if (predicate()) return;
    }
    assert.fail('Dashboard did not reach the expected state');
  }
  try {
    const { Dashboard } = await server.ssrLoadModule('/src/App.jsx');
    await act(async () => { renderer = create(React.createElement(Dashboard)); });
    await waitFor(() => button('Skrýt') && !button('Skrýt').props.disabled);
    await act(async () => { await button('Skrýt').props.onClick(); });
    await waitFor(() => renderer.root.findAllByType('article').length === 0);
    assert.equal(state.hidden, true);
    assert.ok(button('Vrátit změnu'));
    await act(async () => { await button('Vrátit změnu').props.onClick(); });
    await waitFor(() => renderer.root.findAllByType('article').length === 1 && !button('Uložit').props.disabled);
    assert.equal(state.hidden, false);
    await act(async () => { await button('Uložit').props.onClick(); });
    await waitFor(() => button('Uloženo') && !button('Uloženo').props.disabled);
    act(() => renderer.unmount());
    await act(async () => { renderer = create(React.createElement(Dashboard)); });
    await waitFor(() => button('Uloženo') && !button('Uloženo').props.disabled);
    act(() => button('Uložené').props.onClick());
    await waitFor(() => renderer.root.findAllByType('article').length === 1);
    assert.equal(state.saved, true);
    assert.deepEqual(writes.map(item => item.changes), [{ hidden: true }, { hidden: false }, { saved: true }]);
  } finally {
    if (renderer) act(() => renderer.unmount());
    await server.close(); globalThis.fetch = originalFetch;
  }
});
