export const PORTALS = {
  jobs: 'Jobs.cz', pracezarohem: 'Práce za rohem', dobraprace: 'DobráPráce.cz',
  jenprace: 'JenPrace.cz', atmoskop: 'Atmoskop', prace: 'Prace.cz', startupjobs: 'StartupJobs',
};
export const DEFAULT_SCHEDULE = {
  enabled: false, timezone: 'Europe/Prague', days: [1, 2, 3, 4, 5], times: ['05:30'],
  limit: 5, maxEvaluations: 20, maxDailyRuns: 3, period: '24h', includeUnknownDates: false,
  portals: Object.keys(PORTALS).filter(key => key !== 'startupjobs'),
};

export function validateHunt(input) {
  const { limit = 5, maxEvaluations = 20, period = '24h', includeUnknownDates = false,
    portals = DEFAULT_SCHEDULE.portals } = input ?? {};
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(maxEvaluations) || maxEvaluations < 1 || maxEvaluations > 100 ||
      !['all', '24h', '7d', '30d'].includes(period) || typeof includeUnknownDates !== 'boolean' ||
      !Array.isArray(portals) || !portals.length || portals.some(key => !Object.hasOwn(PORTALS, key)))
    throw new Error('Zkontroluj portály, stáří nabídek a limity (1–100).');
  return { limit, maxEvaluations, period, includeUnknownDates, portals: [...new Set(portals)] };
}

export function validateSchedule(input) {
  if (!input || typeof input.enabled !== 'boolean' ||
      !['Europe/Prague', 'UTC'].includes(input.timezone) ||
      !Array.isArray(input.days) || !input.days.length || input.days.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
      !Array.isArray(input.times) || !input.times.length || input.times.length > 6 ||
      input.times.some(time => typeof time !== 'string' || !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(time)) ||
      !Number.isInteger(input.maxDailyRuns) || input.maxDailyRuns < 1 || input.maxDailyRuns > 24)
    throw new Error('Vyber dny, 1–6 časů po 15 minutách a denní limit 1–24.');
  return { enabled: input.enabled, timezone: input.timezone, days: [...new Set(input.days)].sort(),
    times: [...new Set(input.times)].sort(), maxDailyRuns: input.maxDailyRuns, ...validateHunt(input) };
}

const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function clockParts(date, timezone = 'Europe/Prague') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { day: weekdays[parts.weekday], date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function nextOccurrence(schedule, after = new Date()) {
  if (!schedule.enabled) return null;
  const start = Math.floor(after.getTime() / 900000) * 900000 + 900000;
  for (let time = start; time <= start + 8 * 86400000; time += 900000) {
    const date = new Date(time), local = clockParts(date, schedule.timezone);
    if (schedule.days.includes(local.day) && schedule.times.includes(local.time)) return date.toISOString();
  }
  return null;
}
