import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleHealth } from './scheduleHealth.js';

const now = Date.parse('2026-10-09T12:00:00Z');
test('an enabled plan requires a recent worker heartbeat before it is presented as connected', () => {
  assert.equal(scheduleHealth({ enabled: true }, { now }).warning, true);
  assert.equal(scheduleHealth({ enabled: true, workerSeenAt: 'invalid' }, { now }).warning, true);
  assert.equal(scheduleHealth({ enabled: true, workerSeenAt: '2026-10-09T11:14:59Z' }, { now }).label, 'Automatika má zpoždění');
  assert.equal(scheduleHealth({ enabled: true, workerSeenAt: '2026-10-09T11:15:00Z' }, { now }).label, 'Automatika zapnutá');
});
test('saving a profile explains the pause, but enabling its schedule clears that explanation', () => {
  assert.equal(scheduleHealth({ enabled: false }, { profileUpdated: true, now }).label, 'Automatika pozastavena po uložení profilu');
  assert.equal(scheduleHealth({ enabled: false }, { now }).label, 'Automatika vypnutá');
  assert.equal(scheduleHealth({ enabled: true, workerSeenAt: '2026-10-09T11:59:00Z' }, { profileUpdated: true, now }).label, 'Automatika zapnutá');
});
