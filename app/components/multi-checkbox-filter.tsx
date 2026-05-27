'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';

export interface MultiCheckboxOption {
  value: string;
  label: string;
  helper?: string;
}

interface MultiCheckboxFilterProps {
  label: string;
  options: MultiCheckboxOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  allLabel?: string;
  className?: string;
  buttonClassName?: string;
  emptyMeansAll?: boolean;
}

export function MultiCheckboxFilter({
  label,
  options,
  selectedValues,
  onChange,
  allLabel = 'Todos',
  className = '',
  buttonClassName = '',
  emptyMeansAll = true,
}: MultiCheckboxFilterProps) {
  const [open, setOpen] = useState(false);
  const allValues = useMemo(() => options.map((option) => option.value), [options]);
  const effectiveSelectedValues = emptyMeansAll && selectedValues.length === 0 ? allValues : selectedValues;
  const selectedSet = useMemo(() => new Set(effectiveSelectedValues), [effectiveSelectedValues]);
  const selectedLabels = options.filter((option) => selectedSet.has(option.value)).map((option) => option.label);
  const hasSelection = emptyMeansAll ? selectedValues.length > 0 : effectiveSelectedValues.length > 0;
  const isAllSelected = effectiveSelectedValues.length === options.length;
  const summary = isAllSelected
    ? allLabel
    : selectedLabels.length === 1
      ? selectedLabels[0]
      : `${selectedLabels.length} selecionados`;

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(effectiveSelectedValues.filter((item) => item !== value));
      return;
    }

    onChange([...effectiveSelectedValues, value]);
  };

  const selectAll = () => {
    onChange(emptyMeansAll ? [] : allValues);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`h-12 w-full rounded-2xl border-2 px-4 text-left font-black text-[10px] uppercase flex items-center justify-between gap-3 transition-all ${
          hasSelection
            ? 'border-blue-600 bg-blue-50 text-blue-700'
            : 'border-slate-100 bg-white text-slate-700'
        } ${buttonClassName}`}
      >
        <span className="min-w-0">
          <span className="block text-[8px] text-slate-400">{label}</span>
          <span className="block truncate">{summary}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-[24px] border-2 border-slate-900 bg-white p-3 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={selectAll}
                className={`rounded-xl px-3 py-2 text-[9px] font-black uppercase ${
                  isAllSelected ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {allLabel}
              </button>
              {!isAllSelected && (
                <button
                  type="button"
                  onClick={() => emptyMeansAll ? selectAll() : onChange([])}
                  className="rounded-xl bg-red-50 p-2 text-red-600"
                  aria-label="Limpar filtro"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto pr-1">
              {options.map((option) => {
                const checked = selectedSet.has(option.value);

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleValue(option.value)}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all ${
                      checked ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-blue-50'
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                      checked ? 'border-white bg-white text-blue-600' : 'border-slate-200 bg-white text-transparent'
                    }`}>
                      <Check size={13} strokeWidth={4} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] font-black uppercase">{option.label}</span>
                      {option.helper && <span className={`block truncate text-[8px] font-bold uppercase ${checked ? 'text-blue-100' : 'text-slate-400'}`}>{option.helper}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
