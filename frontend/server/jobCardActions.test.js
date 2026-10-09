import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const job = { id: 'one', offer: { title: 'Analyst', company: 'Example', url: 'https://example.com/job', raw_description: 'Description' }, evaluation: { score: 85, verdict: 'STRONG_FIT', fit_reasons: ['Match', 'Another match'], gap_analysis: [], tailored_cv_highlights: [] }, state: { saved: false, applied: false, hidden: false } };
test('card actions remain pending until storage confirms, show errors, and can reverse saved states', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], appType: 'custom', server: { middlewareMode: true } });
  let renderer;
  try {
    const { default: Card } = await server.ssrLoadModule('/src/components/JobCard.jsx');
    let finish;
    const writes = [];
    const onStateChange = (item, key, value) => { writes.push({ id: item.id, key, value }); return new Promise(resolve => { finish = resolve; }); };
    act(() => { renderer = create(React.createElement(Card, { job, onStateChange })); });
    const save = () => renderer.root.findByProps({ 'aria-label': 'Uložit nabídku' });
    let pending;
    act(() => { pending = save().props.onClick(); });
    assert.equal(save().props.disabled, true);
    assert.equal(save().props['aria-pressed'], false);
    await act(async () => { finish(); await pending; });
    assert.deepEqual(writes[0], { id: 'one', key: 'saved', value: true });
    act(() => renderer.update(React.createElement(Card, { job: { ...job, state: { ...job.state, saved: true } }, onStateChange })));
    const undo = renderer.root.findByProps({ 'aria-label': 'Zrušit uložení nabídky' });
    act(() => { pending = undo.props.onClick(); });
    await act(async () => { finish(); await pending; });
    assert.equal(writes[1].value, false);
    act(() => renderer.update(React.createElement(Card, { job, onStateChange: async () => { throw new Error('Network unavailable'); } })));
    await act(async () => { await save().props.onClick(); });
    assert.equal(save().props['aria-pressed'], false);
    assert.equal(save().props.disabled, false);
    assert.equal(renderer.root.findByProps({ role: 'alert' }).props.children, 'Network unavailable');
    act(() => renderer.update(React.createElement(Card, { job: { ...job, demo: true }, onStateChange })));
    assert.equal(renderer.root.findAllByType('button').length, 0);
  } finally { if (renderer) act(() => renderer.unmount()); await server.close(); }
});
