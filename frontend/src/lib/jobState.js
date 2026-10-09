export const COLLECTIONS = { active: 'Nabídky', saved: 'Uložené', priority: 'Moje priority', applied: 'Reagoval jsem', hidden: 'Skryté' };
export function normalizeJobState(value = {}) {
  return Object.fromEntries(['saved', 'applied', 'hidden', 'priority'].map(key => [key, value?.[key] === true || value?.[key] === 1]));
}
export function inCollection(state, collection = 'active') {
  const value = normalizeJobState(state);
  if (collection === 'all') return true;
  if (collection === 'hidden') return value.hidden;
  if (value.hidden) return false;
  return collection === 'priority' ? value.priority : collection === 'saved' ? value.saved : collection === 'applied' ? value.applied : true;
}
