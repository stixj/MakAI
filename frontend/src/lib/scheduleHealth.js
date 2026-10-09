// A saved plan and a connected worker are separate states.
export function scheduleHealth(schedule, { profileUpdated = false, now = Date.now() } = {}) {
  if (!schedule) return { label: 'Načítám stav automatiky…', warning: false };
  if (!schedule.enabled) return {
    label: profileUpdated ? 'Automatika pozastavena po uložení profilu' : 'Automatika vypnutá',
    warning: false,
  };
  const seen = Date.parse(schedule.workerSeenAt);
  if (!Number.isFinite(seen)) return { label: 'Automatika čeká na připojení', warning: true };
  if (now - seen > 45 * 60000) return { label: 'Automatika má zpoždění', warning: true };
  return { label: 'Automatika zapnutá', warning: false };
}
