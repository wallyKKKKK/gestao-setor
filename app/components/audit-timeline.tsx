'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Pencil, Search, Trash2, UserCog } from 'lucide-react';
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
  meeting_updated: 'Reuniao editada',
  permission_blocked: 'Permissao bloqueada',
  profile_updated: 'Usuario alterado',
};

const ACTION_TONE: Record<string, { label: string; className: string; icon: typeof ClipboardList }> = {
  task_deleted: { label: 'Critico', className: 'border-red-200 bg-red-50 text-red-700', icon: Trash2 },
  permission_blocked: { label: 'Bloqueio', className: 'border-amber-300 bg-amber-100 text-amber-800', icon: AlertTriangle },
  task_updated: { label: 'Edicao', className: 'border-blue-200 bg-blue-50 text-blue-700', icon: Pencil },
  subtask_updated: { label: 'Edicao', className: 'border-blue-200 bg-blue-50 text-blue-700', icon: Pencil },
  profile_updated: { label: 'Usuario', className: 'border-amber-200 bg-amber-50 text-amber-700', icon: UserCog },
  task_completed: { label: 'Concluido', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
  meeting_created: { label: 'Agenda', className: 'border-sky-200 bg-sky-50 text-sky-700', icon: ClipboardList },
};

const QUICK_FILTERS = [
  { id: 'blocked', label: 'Permissoes bloqueadas' },
  { id: 'deletes', label: 'Exclusoes' },
  { id: 'imports', label: 'Importacoes' },
  { id: 'exports', label: 'Exportacoes' },
  { id: 'tasks', label: 'Tarefas' },
  { id: 'transport', label: 'Transporte' },
  { id: 'reallocation', label: 'Remanejamento' },
] as const;

type QuickFilterId = typeof QUICK_FILTERS[number]['id'];

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getLogText(log: AuditLog) {
  return [
    log.action,
    log.entity_type,
    log.entity_title,
    log.details,
    log.sector,
    ACTION_LABELS[log.action],
  ].join(' ').toLowerCase();
}

function isSensitiveLog(log: AuditLog) {
  return log.action === 'permission_blocked'
    || log.action.includes('deleted')
    || log.action === 'profile_updated';
}

function matchesQuickFilter(log: AuditLog, filter: QuickFilterId | 'all') {
  if (filter === 'all') return true;

  const text = getLogText(log);

  if (filter === 'blocked') return log.action === 'permission_blocked';
  if (filter === 'deletes') return log.action.includes('deleted') || text.includes('exclu');
  if (filter === 'imports') return text.includes('import');
  if (filter === 'exports') return text.includes('export') || text.includes('txt') || text.includes('csv') || text.includes('pdf');
  if (filter === 'tasks') return log.entity_type === 'task' || text.includes('tarefa');
  if (filter === 'transport') return text.includes('transporte');
  if (filter === 'reallocation') return text.includes('remanejamento');

  return true;
}

export function AuditTimeline({ logs }: AuditTimelineProps) {
  const [actionFilters, setActionFilters] = useState<string[]>([]);
  const [sectorFilters, setSectorFilters] = useState<string[]>([]);
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'critical'>('all');
  const [quickFilter, setQuickFilter] = useState<QuickFilterId | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const actions = useMemo(() => Array.from(new Set(logs.map((log) => log.action))).sort(), [logs]);
  const sectors = useMemo(() => Array.from(new Set(logs.map((log) => log.sector))).sort(), [logs]);

  const stats = useMemo(() => {
    const todayStart = startOfToday();
    const todayLogs = logs.filter((log) => new Date(log.created_at) >= todayStart);
    const criticalLogs = logs.filter(isSensitiveLog);
    const changedActors = new Set(logs.map((log) => log.actor_id || log.actor_name));

    return {
      total: logs.length,
      today: todayLogs.length,
      critical: criticalLogs.length,
      actors: changedActors.size,
    };
  }, [logs]);

  const quickFilterCounts = useMemo(() => {
    return Object.fromEntries(
      QUICK_FILTERS.map((filter) => [filter.id, logs.filter((log) => matchesQuickFilter(log, filter.id)).length]),
    ) as Record<QuickFilterId, number>;
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const todayStart = startOfToday();

    return logs.filter((log) => {
      if (periodFilter === 'today' && new Date(log.created_at) < todayStart) return false;
      if (periodFilter === 'critical' && !isSensitiveLog(log)) return false;
      if (!matchesQuickFilter(log, quickFilter)) return false;
      if (actionFilters.length > 0 && !actionFilters.includes(log.action)) return false;
      if (sectorFilters.length > 0 && !sectorFilters.includes(log.sector)) return false;
      if (!normalizedSearch) return true;

      return [
        log.actor_name,
        log.entity_title,
        log.entity_type,
        log.details,
        log.sector,
        ACTION_LABELS[log.action],
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
    });
  }, [actionFilters, logs, periodFilter, quickFilter, searchTerm, sectorFilters]);

  const recentCriticalLogs = useMemo(
    () => logs.filter(isSensitiveLog).slice(0, 4),
    [logs],
  );

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-2 pb-20 pt-2 sm:px-4">
      <section className="grid gap-2 md:grid-cols-4">
        <AuditStat label="Registros" value={stats.total} tone="blue" />
        <AuditStat label="Hoje" value={stats.today} tone="emerald" />
        <AuditStat label="Sensiveis" value={stats.critical} tone="red" />
        <AuditStat label="Usuarios" value={stats.actors} tone="slate" />
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(150px,180px)_minmax(180px,220px)_minmax(180px,220px)]">
        <div className="relative min-w-0">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar usuario, item ou detalhe..."
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-xs font-black uppercase outline-none transition focus:border-blue-500 focus:bg-white"
          />
        </div>

        <select
          value={periodFilter}
          onChange={(event) => setPeriodFilter(event.target.value as 'all' | 'today' | 'critical')}
          className="h-12 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-[10px] font-black uppercase text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white"
        >
          <option value="all">Todos periodos</option>
          <option value="today">Somente hoje</option>
          <option value="critical">Sensiveis</option>
        </select>

        <MultiCheckboxFilter
          label="Acao"
          allLabel="Todas acoes"
          selectedValues={actionFilters}
          onChange={setActionFilters}
          options={actions.map((action) => ({ value: action, label: ACTION_LABELS[action] || action }))}
          className="min-w-0"
          buttonClassName="border-slate-200 bg-slate-50"
        />

        <MultiCheckboxFilter
          label="Setor"
          allLabel="Todos setores"
          selectedValues={sectorFilters}
          onChange={setSectorFilters}
          options={sectors.map((sector) => ({ value: sector, label: sector }))}
          className="min-w-0"
          buttonClassName="border-slate-200 bg-slate-50"
          dropdownAlign="right"
        />
      </section>

      <section className="flex flex-wrap items-center gap-2 rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
        <button
          type="button"
          onClick={() => setQuickFilter('all')}
          className={`h-9 rounded-2xl border px-3 text-[10px] font-black uppercase tracking-widest transition ${
            quickFilter === 'all'
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-200 hover:text-blue-700'
          }`}
        >
          Todos
        </button>
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setQuickFilter((current) => current === filter.id ? 'all' : filter.id)}
            className={`inline-flex h-9 items-center gap-2 rounded-2xl border px-3 text-[10px] font-black uppercase tracking-widest transition ${
              quickFilter === filter.id
                ? filter.id === 'blocked' || filter.id === 'deletes'
                  ? 'border-amber-300 bg-amber-100 text-amber-800'
                  : 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-200 hover:text-blue-700'
            }`}
          >
            {filter.label}
            <span className={`rounded-full px-2 py-0.5 text-[9px] ${
              quickFilter === filter.id ? 'bg-white/70' : 'bg-white text-slate-400'
            }`}>
              {quickFilterCounts[filter.id] || 0}
            </span>
          </button>
        ))}
      </section>

      {recentCriticalLogs.length > 0 && (
        <section className="rounded-[24px] border border-amber-200 bg-amber-50/70 p-3">
          <div className="mb-2 flex items-center gap-2 text-amber-700">
            <AlertTriangle size={17} />
            <p className="text-[10px] font-black uppercase tracking-widest">Eventos sensiveis recentes</p>
          </div>
          <div className="grid gap-2 lg:grid-cols-4">
            {recentCriticalLogs.map((log) => (
              <button
                key={log.id}
                type="button"
                onClick={() => {
                  setPeriodFilter('critical');
                  setQuickFilter(log.action === 'permission_blocked' ? 'blocked' : log.action.includes('deleted') ? 'deletes' : 'all');
                  setSearchTerm(log.entity_title || log.actor_name || '');
                }}
                className="rounded-2xl border border-amber-200 bg-white px-3 py-2 text-left transition hover:border-amber-300 hover:shadow-sm"
              >
                <p className="truncate text-[10px] font-black uppercase text-slate-900">{ACTION_LABELS[log.action] || log.action}</p>
                <p className="mt-1 truncate text-[11px] font-bold text-slate-500">{log.entity_title || log.actor_name}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Linha do tempo</p>
          <span className="rounded-full bg-slate-900 px-3 py-1 text-[9px] font-black uppercase text-white">
            {filteredLogs.length}/{logs.length}
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredLogs.map((log) => {
            const tone = ACTION_TONE[log.action] || { label: 'Evento', className: 'border-slate-200 bg-slate-50 text-slate-600', icon: ClipboardList };
            const Icon = tone.icon;
            const sensitive = isSensitiveLog(log);

            return (
              <article
                key={log.id}
                className={`grid gap-3 border-l-4 px-4 py-3 transition lg:grid-cols-[44px_minmax(220px,1fr)_170px_140px] lg:items-center ${
                  sensitive
                    ? log.action === 'permission_blocked'
                      ? 'border-l-amber-400 bg-amber-50/40 hover:bg-amber-50/70'
                      : 'border-l-red-400 bg-red-50/30 hover:bg-red-50/60'
                    : 'border-l-transparent hover:bg-slate-50'
                }`}
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${tone.className}`}>
                  <Icon size={17} />
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${tone.className}`}>
                      {tone.label}
                    </span>
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">
                      {ACTION_LABELS[log.action] || log.action}
                    </p>
                  </div>
                  <h3 className="mt-1 truncate text-sm font-black uppercase text-slate-950">
                    {log.entity_title || log.entity_type}
                  </h3>
                  <p className="mt-0.5 line-clamp-2 text-[11px] font-bold leading-snug text-slate-500">
                    {log.details || 'Sem detalhes adicionais.'}
                  </p>
                </div>

                <div className="text-[10px] font-black uppercase text-slate-500 lg:text-right">
                  <p className="text-slate-900">{log.actor_name}</p>
                  <p className="mt-1 text-slate-400">{log.sector}</p>
                </div>

                <div className="text-[10px] font-black uppercase text-slate-400 lg:text-right">
                  {formatDate(log.created_at)}
                </div>
              </article>
            );
          })}
        </div>

        {filteredLogs.length === 0 && (
          <div className="px-5 py-20 text-center">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-300">Nenhum evento encontrado</p>
          </div>
        )}
      </section>
    </div>
  );
}

function AuditStat({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'emerald' | 'red' | 'slate' }) {
  const toneClass = {
    blue: 'text-blue-600 bg-blue-50 border-blue-100',
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    red: 'text-red-600 bg-red-50 border-red-100',
    slate: 'text-slate-700 bg-slate-50 border-slate-200',
  }[tone];

  return (
    <div className={`rounded-[22px] border p-4 shadow-sm ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight">{value}</p>
    </div>
  );
}
