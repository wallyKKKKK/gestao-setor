'use client';

import { TrendingUp } from 'lucide-react';
import { DashboardCard } from '@/app/components/dashboard-card';
import type { SectorStat } from '@/lib/task-selectors';

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
}

export function DashboardView({ filter, onFilterChange, stats, sectorStats }: DashboardViewProps) {
  return (
    <div className="mt-6 space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-2">
        <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-2">
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
        <DashboardCard label={`Total ${filter}`} val={stats.total} color="border-slate-900 bg-white" />
        <DashboardCard label="Concluídas" val={stats.concluidas} color="border-green-600 bg-green-50 text-green-700" />
        <DashboardCard label="Pendentes" val={stats.pendentes} color="border-blue-600 bg-blue-50 text-blue-700" />
      </div>

      <div className="bg-white p-12 rounded-[48px] border-4 border-slate-900 shadow-[15px_15px_0px_0px_rgba(15,23,42,1)] text-center">
        <h3 className="text-9xl font-black mb-8 tracking-tighter">{stats.porcentagem}%</h3>
        <div className="w-full bg-slate-100 h-16 rounded-3xl border-4 border-slate-900 overflow-hidden shadow-inner p-1">
          <div
            className="bg-green-500 h-full rounded-2xl transition-all duration-1000"
            style={{ width: `${stats.porcentagem}%` }}
          />
        </div>
      </div>

      <div className="bg-white p-6 rounded-[32px] border-4 border-slate-900 shadow-[10px_10px_0px_0px_rgba(15,23,42,1)]">
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
