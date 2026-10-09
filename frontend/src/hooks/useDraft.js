import { useEffect, useState } from 'react';
const drafts = new Map();
const lifetime = 24 * 60 * 60 * 1000;
export function readDraft(key) {
  try {
    const item = drafts.get(key) || JSON.parse(sessionStorage.getItem('makai-draft:' + key) || 'null');
    if (item && Date.now() - item.at < lifetime) return item.value;
  } catch {}
  return null;
}
export function writeDraft(key, value) {
  const item = { at: Date.now(), value };
  drafts.set(key, item);
  try { sessionStorage.setItem('makai-draft:' + key, JSON.stringify(item)); } catch {}
}
export function clearDraft(key) {
  drafts.delete(key);
  try { sessionStorage.removeItem('makai-draft:' + key); } catch {}
}
export function useDraftState(key, initial) {
  const [value, setValue] = useState(() => readDraft(key) ?? initial);
  const update = next => setValue(previous => {
    const updated = typeof next === 'function' ? next(previous) : next;
    writeDraft(key, updated);
    return updated;
  });
  return [value, update];
}
export function useUnsavedWarning(dirty) {
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

export function clearAllDrafts() {
  drafts.clear();
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('makai-draft:')) sessionStorage.removeItem(key);
  } catch {}
}
