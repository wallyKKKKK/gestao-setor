'use client';

import { useMemo, useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { MultiCheckboxFilter } from '@/app/components/multi-checkbox-filter';
import type { AuditLog } from '@/lib/types';

interface AuditTimelineProps {
  logs: AuditLog[];
}

const ACTION_LABELS: Record<string, string> = {
  task_created: 'Tarefa criada',
  task_updated: 'Tarefa editada',
  task_deleted: 'Tarefa excluida',
  task_completed: 'Tarefa concluida',
  task_reopened: 'Tarefa reaberta',
  subtask_updated: 'Subtarefa alterada',
  meeting_created: 'Reuniao criada',
  profile_updated: 'Usuario alterado',
};

export function AuditTimeline({ logs }: AuditTimelineProps) {
  const [actionFilters, setActionFilters] = useState<string[]>([]);
  const [sectorFilters, setSectorFilters] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const actions = useMemo(() => Array.from(new Set(logs.map((log) => log.action))).sort(), [logs]);
  const sectors = useMemo(() => Array.from(new Set(logs.map((log) => log.sector))).sort(), [logs]);
  const filteredLogs = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase();

    return logs.filter((log) => {
      if (actionFilters.length > 0 && !actionFilters.includes(log.action)) return false;
      if (sectorFilters.length > 0 && !sectorFilters.includes(log.sector)) return false;
      if (!normalizedSearch) return true;

      return [
        log.actor_name,
        log.entity_title,
        log.details,
        ACTION_LABELS[log.action],
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
    });
  }, [actionFilters, logs, searchTerm, sectorFilters]);

  return (
    <div className="mt-8 space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4">
        <div>
          <h2 className="text-3xl font-black uppercase italic tracking-tighter">Auditoria</h2>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Eventos administrativos e operacionais
          </p>
        </div>
        <div className="bg-slate-900 text-white px-4 py-1.5 rounded-full font-black text-[10px] uppercase shadow-md">
          {filteredLogs.length}/{logs.length} registros
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_180px] gap-3 bg-white border-2 border-slate-100 rounded-[28px] p-4">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="BUSCAR POR USUARIO, ITEM OU DETALHE..."
            className="w-full h-12 rounded-2xl bg-slate-50 border-2 border-slate-100 pl-11 pr-4 text-[10px] font-black uppercase outline-none focus:border-blue-600"
          />
        </div>
        <MultiCheckboxFilter
          label="Acao"
          allLabel="Todas acoes"
          selectedValues={actionFilters}
          onChange={setActionFilters}
          options={actions.map((action) => ({ value: action, label: ACTION_LABELS[action] || action }))}
          buttonClassName="bg-slate-50"
        />
        <MultiCheckboxFilter
          label="Setor"
          allLabel="Todos setores"
          selectedValues={sectorFilters}
          onChange={setSectorFilters}
          options={sectors.map((sector) => ({ value: sector, label: sector }))}
          buttonClassName="bg-slate-50"
        />
      </div>

      <div className="space-y-3">
        {filteredLogs.map((log) => (
          <div key={log.id} className="bg-white border-2 border-slate-100 rounded-[28px] p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                  <ClipboardList size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">
                    {ACTION_LABELS[log.action] || log.action}
                  </p>
                  <h3 className="font-black text-slate-900 uppercase leading-tight">
                    {log.entity_title || log.entity_type}
                  </h3>
                  <p className="text-[11px] font-bold text-slate-500 mt-1">
                    {log.details || 'Sem detalhes adicionais.'}
                  </p>
                </div>
              </div>

              <div className="sm:text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase">
                  {new Date(log.created_at).toLocaleString('pt-BR')}
                </p>
                <p className="text-[10px] font-black text-slate-700 uppercase mt-1">
                  {log.actor_name}
                </p>
                <span className="inline-flex mt-2 rounded-lg bg-slate-100 px-2 py-1 text-[8px] font-black uppercase text-slate-500">
                  {log.sector}
                </span>
              </div>
            </div>
          </div>
        ))}

        {filteredLogs.length === 0 && (
          <div className="text-center py-20 opacity-30">
            <p className="font-black uppercase tracking-widest text-slate-400">Nenhum evento registrado ainda...</p>
          </div>
        )}
      </div>
    </div>
  );
}
