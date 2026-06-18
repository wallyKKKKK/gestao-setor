'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Bell, CalendarDays, CheckCircle2, Clock3, Target, TrendingUp } from 'lucide-react';
import { DashboardCard } from '@/app/components/dashboard-card';
import type { SectorStat } from '@/lib/task-selectors';

interface DailyOverview {
  todayTasks: number;
  overdueTasks: number;
  oneOffTasks: number;
  futureTasks: number;
  completedToday: number;
  meetingsToday: number;
  nextMeetingTitle: string;
  nextMeetingTime: string;
  unreadNotifications: number;
  focusItems: Array<{
    title: string;
    detail: string;
    tab: string;
  }>;
}

interface DashboardViewProps {
  filter: 'HOJE' | 'SEMANAL';
  onFilterChange: (filter: 'HOJE' | 'SEMANAL') => void;
  stats: {
    total: number;
    concluidas: number;
    pendentes: number;
    porcentagem: number;
  };
  sectorStats: SectorStat[];
  dailyOverview: DailyOverview;
  onOpenTab: (tab: string) => void;
  onOpenMeetings: () => void;
}

export function DashboardView({ filter, onFilterChange, stats, sectorStats, dailyOverview, onOpenTab, onOpenMeetings }: DashboardViewProps) {
  return (
    <div className="mt-4 space-y-4 animate-in fade-in duration-500">
      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Resumo diario</p>
            <h2 className="text-2xl font-black uppercase italic tracking-tight text-slate-950">Painel do dia</h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenTab('HOJE')}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_10px_22px_rgba(37,99,235,0.22)] transition hover:bg-blue-700"
          >
            <CalendarDays size={16} />
            Ver hoje
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <OverviewCard
            label="Hoje"
            value={dailyOverview.todayTasks}
            detail="vencem hoje"
            icon={<CalendarDays size={18} />}
            tone="blue"
            onClick={() => onOpenTab('HOJE')}
          />
          <OverviewCard
            label="Atrasadas"
            value={dailyOverview.overdueTasks}
            detail="precisam de atencao"
            icon={<AlertTriangle size={18} />}
            tone="red"
            onClick={() => onOpenTab('ATRASADOS')}
          />
          <OverviewCard
            label="Pontuais"
            value={dailyOverview.oneOffTasks}
            detail="sem repeticao"
            icon={<Target size={18} />}
            tone="amber"
            onClick={() => onOpenTab(dailyOverview.oneOffTasks > 0 && dailyOverview.overdueTasks > 0 ? 'ATRASADOS' : 'HOJE')}
          />
          <OverviewCard
            label="Futuras"
            value={dailyOverview.futureTasks}
            detail="agendadas"
            icon={<Clock3 size={18} />}
            tone="slate"
            onClick={() => onOpenTab('Todas')}
          />
          <OverviewCard
            label="Concluidas"
            value={dailyOverview.completedToday}
            detail="baixadas hoje"
            icon={<CheckCircle2 size={18} />}
            tone="green"
            onClick={() => onOpenTab('HISTÓRICO')}
          />
          <OverviewCard
            label="Reunioes"
            value={dailyOverview.meetingsToday}
            detail={dailyOverview.nextMeetingTime ? `${dailyOverview.nextMeetingTime} ${dailyOverview.nextMeetingTitle}` : 'agenda do dia'}
            icon={<Clock3 size={18} />}
            tone="emerald"
            onClick={onOpenMeetings}
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center gap-2 text-slate-700">
              <CheckCircle2 size={16} className="text-blue-600" />
              <p className="text-[10px] font-black uppercase tracking-widest">Foco rapido</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {dailyOverview.focusItems.map((item) => (
                <button
                  key={`${item.tab}-${item.title}`}
                  type="button"
                  onClick={() => onOpenTab(item.tab)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-blue-300 hover:shadow-sm"
                >
                  <p className="truncate text-[11px] font-black uppercase text-slate-950">{item.title}</p>
                  <p className="mt-1 truncate text-[10px] font-bold uppercase text-slate-400">{item.detail}</p>
                </button>
              ))}
              {dailyOverview.focusItems.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-5 text-center md:col-span-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Sem foco critico agora</p>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenTab('COMUNICADOS')}
            className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-left transition hover:border-blue-300"
          >
            <div className="flex items-center justify-between">
              <Bell size={18} className="text-blue-600" />
              <span className="rounded-full bg-blue-600 px-2 py-1 text-[9px] font-black text-white">{dailyOverview.unreadNotifications}</span>
            </div>
            <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-blue-600">Notificacoes</p>
            <p className="mt-1 text-sm font-black uppercase text-slate-950">Pendentes de leitura</p>
          </button>
        </div>
      </section>

      <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-2">
        <h2 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-2">
          <TrendingUp className="text-blue-600" /> Performance
        </h2>
        <div className="flex bg-slate-200 p-1 rounded-2xl border-2 border-slate-900 shadow-sm w-full md:w-auto">
          <button
            onClick={() => onFilterChange('HOJE')}
            className={`flex-1 px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${
              filter === 'HOJE' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'
            }`}
          >
            Hoje
          </button>
          <button
            onClick={() => onFilterChange('SEMANAL')}
            className={`flex-1 px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${
              filter === 'SEMANAL' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'
            }`}
          >
            Semanal
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <DashboardCard label={filter === 'HOJE' ? 'Total Hoje' : 'Pendencias Ativas'} val={stats.total} color="border-slate-200 bg-white" />
        <DashboardCard label="Concluídas" val={stats.concluidas} color="border-green-600 bg-green-50 text-green-700" />
        <DashboardCard label={filter === 'HOJE' ? 'Pendentes Hoje' : 'Pendentes Agora'} val={stats.pendentes} color="border-blue-600 bg-blue-50 text-blue-700" />
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h3 className="mb-5 text-7xl font-black tracking-tighter">{stats.porcentagem}%</h3>
        <div className="h-14 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-1 shadow-inner">
          <div
            className="bg-green-500 h-full rounded-2xl transition-all duration-1000"
            style={{ width: `${stats.porcentagem}%` }}
          />
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-black uppercase italic tracking-tight">Performance por setor</h3>
          <span className="text-[10px] font-black uppercase text-slate-400">{filter}</span>
        </div>
        <div className="space-y-3">
          {sectorStats.map((item) => (
            <div key={item.sector} className="rounded-2xl bg-slate-50 border-2 border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="font-black uppercase text-xs text-slate-900">{item.sector}</p>
                <p className="font-black text-xs text-blue-600">{item.porcentagem}%</p>
              </div>
              <div className="h-3 bg-white rounded-full border border-slate-200 overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${item.porcentagem}%` }} />
              </div>
              <p className="mt-2 text-[10px] font-black uppercase text-slate-400">
                {item.concluidas} concluídas • {item.pendentes} pendentes • {item.total} total
              </p>
            </div>
          ))}
          {sectorStats.length === 0 && (
            <p className="py-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
              Nenhum dado no período
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewCard({
  label,
  value,
  detail,
  icon,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
  tone: 'blue' | 'red' | 'amber' | 'emerald' | 'green' | 'slate';
  onClick: () => void;
}) {
  const toneClass = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    red: 'border-red-100 bg-red-50 text-red-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    green: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
          <p className="mt-1 text-3xl font-black tracking-tight">{value}</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70">
          {icon}
        </span>
      </div>
      <p className="mt-3 truncate text-[10px] font-black uppercase opacity-70">{detail}</p>
    </button>
  );
}
