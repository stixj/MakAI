import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_SCHEDULE } from '../src/lib/schedule.js';

const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.props?.children ?? node.children) : '';
async function setup() {
  return createServer({ configFile: false, plugins: [react()], appType: 'custom', server: { middlewareMode: true }, define: { 'import.meta.env.VITE_JOB_SOURCE': JSON.stringify('cloud') } });
}
test('first visit offers profile creation directly and does not offer search before a profile exists', async () => {
  const originalFetch = globalThis.fetch;
  const server = await setup();
  let renderer;
  globalThis.fetch = async url => ({ ok: true, json: async () => url === '/api/profile' ? null : url === '/api/profile/draft' ? { configured: true } : { status: 'idle', runs: [] } });
  try {
    const { default: Panel } = await server.ssrLoadModule('/src/components/ProfilePanel.jsx');
    await act(async () => { renderer = create(React.createElement(Panel, { onJobsChanged() {} })); });
    const button = renderer.root.findAllByType('button').find(node => text(node.props.children).includes('Vytvořit můj profil'));
    assert.ok(button);
    assert.equal(renderer.root.findAllByType('button').some(node => text(node.props.children).includes('Hledat nové nabídky')), false);
    assert.equal(renderer.root.findAllByType('ol')[0].findAllByType('li').length, 3);
    await act(async () => { button.props.onClick(); });
    assert.ok(renderer.root.findAllByType('button').some(node => text(node.props.children).includes('Vyplnit krátký dotazník')));
    assert.ok(renderer.root.findByProps({ type: 'file' }));
  } finally {
    if (renderer) act(() => renderer.unmount());
    await server.close();
    globalThis.fetch = originalFetch;
  }
});
test('worker problems remain visible while schedule settings are collapsed; profile changes lead to schedule review', async () => {
  const originalFetch = globalThis.fetch;
  const server = await setup();
  let renderer;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...DEFAULT_SCHEDULE, enabled: true, workerSeenAt: new Date(Date.now() - 46 * 60000).toISOString() }) });
  try {
    const { default: Panel } = await server.ssrLoadModule('/src/components/SchedulePanel.jsx');
    await act(async () => { renderer = create(React.createElement(Panel, { hasProfile: true })); });
    const settings = renderer.root.findAllByType('details').find(node => node.props.open !== undefined);
    assert.equal(settings.props.open, false);
    const status = renderer.root.findByProps({ role: 'status' });
    assert.ok(!status.findAllByType('details').length);
    assert.match(text(status.props.children), /Automatika má zpoždění/);
    for (let ancestor = status.parent; ancestor; ancestor = ancestor.parent) assert.notEqual(ancestor.type, 'details');
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...DEFAULT_SCHEDULE }) });
    act(() => renderer.unmount());
    await act(async () => { renderer = create(React.createElement(Panel, { hasProfile: true, profileUpdated: true })); });
    assert.match(text(renderer.root.findByProps({ role: 'status' }).props.children), /pozastavena/);
    const review = renderer.root.findAllByType('button').find(node => text(node.props.children) === 'Zkontrolovat plán a zapnout');
    act(() => review.props.onClick());
    assert.equal(renderer.root.findAllByType('details').find(node => node.props.open !== undefined).props.open, true);
    // Opening the review must not silently enable the schedule.
    assert.equal(renderer.root.findAllByProps({ type: 'checkbox' })[0].props.checked, false);
  } finally {
    if (renderer) act(() => renderer.unmount());
    await server.close();
    globalThis.fetch = originalFetch;
  }
});
