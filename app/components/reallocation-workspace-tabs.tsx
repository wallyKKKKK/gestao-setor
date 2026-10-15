'use client';

import { Check, FileSpreadsheet, Shuffle } from 'lucide-react';

export type ReallocationWorkspaceView = 'draft' | 'confirmed' | 'orders';

export function ReallocationWorkspaceTabs({ value, counts, onChange }: {
  value: ReallocationWorkspaceView;
  counts: Record<ReallocationWorkspaceView, number>;
  onChange: (view: ReallocationWorkspaceView) => void;
}) {
  const tabs = [
    { id: 'draft', label: 'Sugestões', Icon: Shuffle },
    { id: 'confirmed', label: 'Confirmadas', Icon: Check },
    { id: 'orders', label: 'Pedidos', Icon: FileSpreadsheet },
  ] as const;
  return (
    <nav role="tablist" aria-label="Telas do remanejamento" className="flex shrink-0 overflow-x-auto border-b border-slate-200 bg-white">
      {tabs.map(({ id, label, Icon }, index) => (
        <button
          key={id}
          id={`reallocation-tab-${id}`}
          type="button"
          role="tab"
          aria-selected={value === id}
          aria-controls={`reallocation-panel-${id}`}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            let target = index;
            if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') target = 0;
            else if (event.key === 'End') target = tabs.length - 1;
            else return;
            event.preventDefault();
            onChange(tabs[target].id);
            document.getElementById(`reallocation-tab-${tabs[target].id}`)?.focus();
          }}
          className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 sm:gap-2 sm:px-5 ${value === id ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
        >
          <Icon size={15} className="hidden sm:block" /> {label}
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${value === id ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>{counts[id].toLocaleString('pt-BR')}</span>
        </button>
      ))}
    </nav>
  );
}
