import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export default function SelectMenu({ value, options, onChange, ariaLabel, className = '', containerClassName = '', disabled = false, variant = 'field' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const selectedIndex = Math.max(0, options.findIndex(option => String(option.value) === String(value)));

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const closeOutside = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    menuRef.current?.querySelector(`[data-option-index="${selectedIndex}"]`)?.focus();
  }, [open, selectedIndex]);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function choose(option) {
    onChange(option.value);
    close(true);
  }

  function onTriggerKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      else menuRef.current?.querySelector(`[data-option-index="${selectedIndex}"]`)?.focus();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  }

  function onMenuKeyDown(event) {
    const optionsInMenu = [...event.currentTarget.querySelectorAll('[role="option"]')];
    const currentIndex = optionsInMenu.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      optionsInMenu[(currentIndex + step + optionsInMenu.length) % optionsInMenu.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      optionsInMenu[event.key === 'Home' ? 0 : optionsInMenu.length - 1]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = optionsInMenu[currentIndex];
      if (option) choose(options[Number(option.dataset.optionIndex)]);
    }
  }

  const triggerStyle = variant === 'pill'
    ? 'rounded-full bg-surface-subtle px-3.5 text-xs font-semibold text-brand hover:border-brand/30 hover:bg-white'
    : 'w-full rounded-xl bg-surface px-3 py-3 text-sm text-ink';

  return <div ref={rootRef} className={'relative ' + (containerClassName || 'w-full')}>
    <button ref={triggerRef} type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} disabled={disabled} onClick={() => setOpen(current => !current)} onKeyDown={onTriggerKeyDown} className={'select-menu-trigger inline-flex min-h-11 items-center justify-between gap-2 border border-border-subtle text-left transition-[background-color,border-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ' + triggerStyle + ' ' + className}>
      <span className="truncate">{options[selectedIndex]?.label ?? ''}</span>
      <ChevronDown className={'h-4 w-4 shrink-0 text-ink-secondary transition-transform duration-150 ' + (open ? 'rotate-180' : '')} aria-hidden="true" />
    </button>
    {open && <div ref={menuRef} id={menuId} role="listbox" aria-label={ariaLabel} onKeyDown={onMenuKeyDown} className="select-menu-popover absolute left-1/2 top-[calc(100%+10px)] z-40 w-full min-w-[13rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-border-subtle bg-surface shadow-popover">
      <span aria-hidden="true" className="select-menu-arrow absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-border-subtle bg-surface" />
      <div className="max-h-72 overflow-y-auto p-1.5">
      {options.map((option, index) => <div key={String(option.value)} data-option-index={index} role="option" aria-selected={String(option.value) === String(value)} tabIndex={-1} onClick={() => choose(option)} className={'relative z-10 flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-xl px-3 text-sm transition-colors focus:bg-surface-subtle focus:outline-none ' + (String(option.value) === String(value) ? 'bg-surface-subtle font-semibold text-brand' : 'text-ink hover:bg-surface-subtle')}>
        <span>{option.label}</span>{String(option.value) === String(value) && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
      </div>)}
      </div>
    </div>}
  </div>;
}
