'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Filter, Search, X } from 'lucide-react';
import { ruleTargetPlacement, type RuleTargetPlacement } from '@/lib/rule-target-placement';

interface TargetOption { value: string; label: string }
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');

export function RuleTargetFilter({ label, options, selectedValues, onChange, compact = false }: {
  label: string;
  options: TargetOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<RuleTargetPlacement>({ left: 12, top: 12, width: 560, maxHeight: 440 });
  const positionPanel = useCallback(() => {
    if (!trigger.current) return;
    setPlacement(ruleTargetPlacement(trigger.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  }, []);
  const allOptions = useMemo(() => {
    const map = new Map(options.map(option => [option.value, option]));
    selectedValues.forEach(value => { if (!map.has(value)) map.set(value, { value, label: value }); });
    return [...map.values()];
  }, [options, selectedValues]);
  const visible = useMemo(() => allOptions.filter(option => normalize(`${option.label} ${option.value}`).includes(normalize(query))), [allOptions, query]);
  const selected = new Set(draft);
  const allMarked = visible.length > 0 && visible.every(option => selected.has(option.value));
  const summary = selectedValues.length === 1 ? allOptions.find(option => option.value === selectedValues[0])?.label || selectedValues[0]
    : selectedValues.length ? `${selectedValues.length} selecionados` : 'Nenhum selecionado';

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', close);
    window.addEventListener('resize', positionPanel);
    const scroll = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-rule-target-popup]')) positionPanel();
    };
    document.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('resize', positionPanel);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [open, positionPanel]);

  const toggleVisible = () => {
    const ids = new Set(visible.map(option => option.value));
    setDraft(current => allMarked ? current.filter(value => !ids.has(value)) : [...new Set([...current, ...ids])]);
  };

  return <div className="relative min-w-0">
    {compact ? <button ref={trigger} type="button" aria-label={`Filtrar ${label}: ${summary}`} aria-haspopup="dialog" aria-expanded={open} title={`Filtrar ${label}: ${summary}`} onClick={() => { setDraft([...selectedValues]); setQuery(''); positionPanel(); setOpen(true); }} className={`grid size-5 shrink-0 place-items-center rounded border ${selectedValues.length ? 'border-amber-500 bg-amber-100 text-amber-900' : 'border-slate-200 text-slate-500 hover:text-slate-900'}`}><Filter size={12} /></button> :
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setDraft([...selectedValues]); setQuery(''); positionPanel(); setOpen(true); }} title={summary}
      className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left ${selectedValues.length ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-700'}`}>
      <span className="min-w-0"><span className="block text-[9px] font-bold uppercase text-slate-500">{label}</span><span className="block truncate text-xs font-semibold">{summary}</span></span><ChevronDown size={16} className="shrink-0" />
    </button>}
    {open && createPortal(<>
      <div className="fixed inset-0 z-[310]" onClick={() => setOpen(false)} />
      <div role="dialog" data-rule-target-popup aria-label={`Selecionar ${label.toLowerCase()}`} style={placement} className="fixed z-[311] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-3 text-slate-800 shadow-xl">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2"><span className="min-w-0 break-words text-xs font-semibold">{label} <span className="ml-1 text-slate-400">{draft.length} selecionados</span></span><button type="button" title="Fechar seleção" aria-label="Fechar seleção de alvos" onClick={() => setOpen(false)} className="shrink-0 rounded p-1 hover:bg-slate-100"><X size={17} /></button></div>
        <div className="relative mb-2 shrink-0"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input autoFocus aria-label={`Pesquisar ${label.toLowerCase()}`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar..." className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-amber-500" /></div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 pb-2"><label className="flex cursor-pointer items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={allMarked} disabled={!visible.length} onChange={toggleVisible} className="h-4 w-4 accent-amber-600" />{query.trim() ? 'Marcar filtrados' : 'Marcar todos'}</label><button type="button" onClick={() => setDraft([])} disabled={!draft.length} className="text-xs font-semibold text-red-600 disabled:opacity-40">Limpar</button></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {visible.map(option => <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-xs ${selected.has(option.value) ? 'bg-amber-50 text-amber-800' : 'hover:bg-slate-50'}`}><input type="checkbox" checked={selected.has(option.value)} onChange={() => setDraft(current => current.includes(option.value) ? current.filter(value => value !== option.value) : [...current, option.value])} className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600" /><span className="min-w-0 break-words">{option.label}</span></label>)}
          {!visible.length && <p className="px-3 py-7 text-center text-xs text-slate-500">Nenhuma opção encontrada.</p>}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 pt-3"><button type="button" onClick={() => setOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold">Cancelar</button><button type="button" onClick={() => { onChange(draft); setOpen(false); }} className="flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white"><Check size={14} /> Aplicar</button></div>
      </div>
    </>, document.body)}
  </div>;
}
