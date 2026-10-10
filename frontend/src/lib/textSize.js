const STORAGE_KEY = 'makai-text-size';
const VALID_SIZES = new Set(['small', 'medium', 'large']);

export function readTextSizePreference() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return VALID_SIZES.has(saved) ? saved : 'medium';
  } catch {
    return 'medium';
  }
}

export function applyTextSizePreference(size) {
  const selected = VALID_SIZES.has(size) ? size : 'medium';
  document.documentElement.dataset.textSize = selected;
  try { localStorage.setItem(STORAGE_KEY, selected); } catch {}
  return selected;
}

export function initializeTextSizePreference() {
  document.documentElement.dataset.textSize = readTextSizePreference();
}
