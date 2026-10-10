import { useState } from 'react';
import { applyTextSizePreference, readTextSizePreference } from '../lib/textSize.js';

const OPTIONS = [
  { value: 'small', label: 'Malá' },
  { value: 'medium', label: 'Střední' },
  { value: 'large', label: 'Velká' },
];

export default function TextSizeControl() {
  const [textSize, setTextSize] = useState(readTextSizePreference);

  function chooseSize(size) {
    setTextSize(applyTextSizePreference(size));
  }

  return <fieldset className="border-b border-border-subtle pb-3">
    <legend className="mb-2 text-sm font-medium text-ink">Velikost textu</legend>
    <div className="grid grid-cols-3 gap-1" role="group" aria-label="Velikost textu">
      {OPTIONS.map(option => <button key={option.value} type="button" aria-pressed={textSize === option.value} className={'min-h-10 rounded-lg border px-2 text-xs transition-colors ' + (textSize === option.value ? 'border-brand bg-surface-subtle font-semibold text-brand' : 'border-transparent text-ink-secondary hover:bg-surface-subtle')} onClick={() => chooseSize(option.value)}>{option.label}</button>)}
    </div>
  </fieldset>;
}
