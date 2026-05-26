'use client';

import type { TaskHistory, UserRole } from '@/lib/types';

interface HistoryTimelineProps {
  history: TaskHistory[];
  userRole: UserRole;
  userSector: string;
}

export function HistoryTimeline({ history, userRole, userSector }: HistoryTimelineProps) {
  const visibleHistory = history.filter(
    (log) => userRole === 'admin' || log.sector === userSector || log.sector === 'Geral',
  );

  return (
    <div className="mt-8 space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="flex justify-between items-center px-4">
        <h2 className="text-3xl font-black uppercase italic tracking-tighter">Linha do Tempo</h2>
        <div className="bg-blue-600 text-white px-4 py-1.5 rounded-full font-black text-[10px] uppercase shadow-md">
          Setor: {userRole === 'admin' ? 'Global' : userSector}
        </div>
      </div>

      <div className="relative border-l-4 border-slate-200 ml-6 pl-8 space-y-8 py-4">
        {visibleHistory.map((log) => (
          <div key={log.id} className="relative">
            <div className="absolute -left-[42px] top-1 w-5 h-5 bg-blue-600 rounded-full border-4 border-white shadow-md" />

            <div className="bg-white p-6 rounded-[32px] border-2 border-slate-100 shadow-sm hover:border-blue-300 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                  {new Date(log.created_at).toLocaleString('pt-BR')}
                </p>
                <span className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">
                  {log.sector}
                </span>
              </div>

              <h4 className="text-xl font-black text-slate-900 mb-2 uppercase">{log.task_title}</h4>

              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[8px] font-bold">
                  {log.user_name?.charAt(0)}
                </div>
                <p className="text-[10px] font-black text-blue-600 uppercase">
                  Concluído por {log.user_name}
                </p>
              </div>
            </div>
          </div>
        ))}

        {visibleHistory.length === 0 && (
          <div className="text-center py-20 opacity-30">
            <p className="font-black uppercase tracking-widest text-slate-400">Nenhum registro neste setor...</p>
          </div>
        )}
      </div>
    </div>
  );
}
