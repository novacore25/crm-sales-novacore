'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * A text input that also offers suggestions.
 *
 * The office has a handful of values it uses constantly and changes rarely, so
 * a plain select would block the rare new one and a plain text field would make
 * them retype the usual every time. This accepts both: pick from the list, or
 * type something that does not exist yet.
 *
 * Typing a new value is not an error here. The caller saves it, and it appears
 * in the list next time - which is the whole point. The prop is called
 * `allowCustom` so that behaviour is visible at the call site rather than
 * something the component quietly does.
 */
export function ComboBox({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  allowCustom = true,
  className,
  inputClassName,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  disabled?: boolean;
  allowCustom?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on an outside click. Without this the list stays open behind a modal
  // and the next click lands on an option the user cannot see.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      o =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // The exact value is in the list already, so typing it again changes nothing
  // and the caller should not treat it as new.
  const isExisting = options.some(
    o => o.value.toLowerCase() === value.trim().toLowerCase() && value.trim() !== '',
  );

  const pick = (v: string) => {
    onChange(v);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onChange={(e) => {
            if (!allowCustom) return;
            onChange(e.target.value);
            setQuery(e.target.value);
            setOpen(true);
          }}
          autoComplete="off"
          className={cn(
            'w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 pr-8',
            inputClassName,
          )}
        />
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            disabled={disabled}
            tabIndex={-1}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 rounded transition"
            aria-label="Lihat pilihan"
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition', open && 'rotate-180')} />
          </button>
        )}
      </div>

      {open && options.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-auto py-1">
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-[10px] text-slate-400 italic">
              {allowCustom
                ? 'Tidak ada yang cocok. Ketik saja, akan tersimpan untuk lain-lain.'
                : 'Tidak ada pilihan yang cocok.'}
            </p>
          )}

          {filtered.map((o) => {
            const active = o.value.toLowerCase() === value.trim().toLowerCase();
            return (
              <button
                key={o.value}
                type="button"
                onMouseDown={(e) => {
                  // mousedown, not click: the input's blur would close the list
                  // before the click landed.
                  e.preventDefault();
                  pick(o.value);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 hover:bg-slate-50 transition flex items-center justify-between gap-2',
                  active && 'bg-indigo-50',
                )}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-slate-700 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="block text-[9px] text-slate-400 truncate">{o.hint}</span>
                  )}
                </span>
                {active && <span className="text-[9px] font-black text-indigo-600 shrink-0">dipakai</span>}
              </button>
            );
          })}

          {allowCustom && value.trim() && !isExisting && (
            <p className="px-3 py-2 border-t border-slate-100 text-[10px] text-emerald-700 font-bold">
              &ldquo;{value.trim()}&rdquo; baru &mdash; akan tersimpan di daftar
            </p>
          )}
        </div>
      )}
    </div>
  );
}
