'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
  dropdownAlign?: 'left' | 'right';
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
  dropdownAlign = 'left',
}: MultiCheckboxFilterProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const allValues = useMemo(() => options.map((option) => option.value), [options]);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const selectedLabels = options.filter((option) => selectedSet.has(option.value)).map((option) => option.label);
  const filteredOptions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return options;

    return options.filter((option) => (
      option.label.toLowerCase().includes(normalizedSearch) ||
      option.value.toLowerCase().includes(normalizedSearch) ||
      option.helper?.toLowerCase().includes(normalizedSearch)
    ));
  }, [options, searchTerm]);
  const hasSelection = selectedValues.length > 0;
  const isAllSelected = emptyMeansAll
    ? selectedValues.length === 0 || selectedValues.length === options.length
    : selectedValues.length === options.length;
  const isFilteredSelectionComplete = filteredOptions.length > 0 && filteredOptions.every((option) => selectedSet.has(option.value));
  const summary = selectedValues.length === 0 && emptyMeansAll
    ? allLabel
    : selectedLabels.length === 1
      ? selectedLabels[0]
      : `${selectedLabels.length} selecionados`;

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((item) => item !== value));
      return;
    }

    onChange([...selectedValues, value]);
  };

  const selectAll = () => {
    onChange(emptyMeansAll ? [] : allValues);
  };

  const toggleFilteredOptions = () => {
    const filteredValues = filteredOptions.map((option) => option.value);
    if (filteredValues.length === 0) return;

    if (isFilteredSelectionComplete) {
      onChange(selectedValues.filter((value) => !filteredValues.includes(value)));
      return;
    }

    onChange(Array.from(new Set([...selectedValues, ...filteredValues])));
  };

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setSearchTerm('');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open]);

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`h-12 w-full rounded-2xl border-2 px-4 text-left font-black text-[10px] uppercase flex items-center justify-between gap-3 transition-all ${
          hasSelection
            ? 'border-blue-600 bg-blue-50 text-blue-700'
            : 'border-slate-100 bg-white text-slate-700'
        } ${buttonClassName}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[8px] text-slate-400">{label}</span>
          <span className="line-clamp-2 leading-tight">{summary}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute top-full z-50 mt-2 w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl ${
            dropdownAlign === 'right' ? 'right-0' : 'left-0'
          }`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={toggleFilteredOptions}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left text-[9px] font-black uppercase ${
                  isFilteredSelectionComplete ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
                  isFilteredSelectionComplete ? 'border-white bg-white text-slate-900' : 'border-slate-300 bg-white text-transparent'
                }`}>
                  <Check size={11} strokeWidth={4} />
                </span>
                <span className="min-w-0 whitespace-normal break-words leading-tight">{searchTerm.trim() ? 'Marcar filtrados' : allLabel}</span>
              </button>
              <button
                type="button"
                onClick={selectAll}
                className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-black uppercase ${
                  isAllSelected ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'
                }`}
              >
                Tudo
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

            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={`Buscar ${label.toLowerCase()}...`}
                className="h-10 w-full rounded-xl border-2 border-slate-100 bg-slate-50 pl-9 pr-3 text-xs font-bold outline-none focus:border-blue-500"
              />
            </div>

            <div className="max-h-72 overflow-y-auto pr-1">
              {filteredOptions.map((option) => {
                const checked = selectedSet.has(option.value);

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleValue(option.value)}
                    title={[option.label, option.helper].filter(Boolean).join(' - ')}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all ${
                      checked ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-blue-50'
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                      checked ? 'border-white bg-white text-blue-600' : 'border-slate-200 bg-white text-transparent'
                    }`}>
                      <Check size={13} strokeWidth={4} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-normal break-words text-[10px] font-black uppercase leading-snug">{option.label}</span>
                      {option.helper && <span className={`mt-0.5 block whitespace-normal break-words text-[8px] font-bold uppercase leading-snug ${checked ? 'text-blue-100' : 'text-slate-400'}`}>{option.helper}</span>}
                    </span>
                  </button>
                );
              })}
              {filteredOptions.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-slate-100 px-3 py-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                  Nenhum item encontrado
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
