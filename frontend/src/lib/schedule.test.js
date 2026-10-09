import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEDULE, validateSchedule, nextOccurrence } from './schedule.js';

test('Prague schedule follows summer and winter clocks, skips unselected days', () => {
  const schedule = { ...DEFAULT_SCHEDULE, enabled: true };
  assert.equal(nextOccurrence(schedule, new Date('2026-10-09T03:00:00Z')), '2026-10-09T03:30:00.000Z');
  assert.equal(nextOccurrence(schedule, new Date('2026-10-09T03:30:00Z')), '2026-10-12T03:30:00.000Z');
  assert.equal(nextOccurrence(schedule, new Date('2026-10-26T00:00:00Z')), '2026-10-26T04:30:00.000Z');
  assert.equal(nextOccurrence({ ...schedule, enabled: false }), null);
});
test('nonexistent spring-forward time is skipped rather than shifted to another hour', () => {
  const schedule = { ...DEFAULT_SCHEDULE, enabled: true, days: [0], times: ['02:30'] };
  assert.equal(nextOccurrence(schedule, new Date('2026-03-28T23:00:00Z')), '2026-04-05T00:30:00.000Z');
});
test('multiple times are sorted and invalid frequency or budgets rejected', () => {
  const clean = validateSchedule({ ...DEFAULT_SCHEDULE, times: ['17:00', '05:30', '05:30'] });
  assert.deepEqual(clean.times, ['05:30', '17:00']);
  for (const invalid of [{ times: ['25:00'] }, { times: ['05:31'] }, { days: [] }, { maxDailyRuns: 0 }, { maxEvaluations: 0 }, { portals: ['secret'] }, { timezone: '../profile' }, { enabled: 'true' }])
    assert.throws(() => validateSchedule({ ...DEFAULT_SCHEDULE, ...invalid }));
});
