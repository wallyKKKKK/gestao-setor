'use client';

import { CalendarDays, ClipboardList, ListTodo, PackageSearch, Shuffle } from 'lucide-react';
import type { UserRole } from '@/lib/types';
import { getSectionTheme } from '@/lib/section-theme';

export type AppSection = 'INICIO' | 'TAREFAS' | 'REUNIAO' | 'COMPRAS_IA' | 'CADASTROS' | 'ESTOQUE_ERP' | 'PRECIFICACAO' | 'PRE_VENCIDOS' | 'PRAZOS' | 'TRANSPORTE' | 'BALACUBACO' | 'AUDITORIA';

interface AppSidebarProps {
  activeSection: AppSection;
  userRole: UserRole;
  userSector: string;
  isSupremeAdmin: boolean;
  onSectionChange: (section: AppSection) => void;
}

const items = [
  { id: 'TAREFAS' as const, label: 'Tarefas', icon: ListTodo },
  { id: 'REUNIAO' as const, label: 'Reuniao', icon: CalendarDays },
  { id: 'ESTOQUE_ERP' as const, label: 'Estoque', icon: PackageSearch, adminOnly: true },
  { id: 'BALACUBACO' as const, label: 'Remanej.', icon: Shuffle },
  { id: 'AUDITORIA' as const, label: 'Auditoria', icon: ClipboardList, adminOnly: true },
];

export function AppSidebar({
  activeSection,
  userRole,
  onSectionChange,
}: AppSidebarProps) {
  const visibleItems = items.filter((item) => !item.adminOnly || userRole === 'admin');
  const homeTheme = getSectionTheme('INICIO');

  return (
    <aside className="fixed bottom-0 left-0 right-0 md:top-0 md:bottom-0 md:right-auto md:w-20 bg-[#151D33] text-white z-50 border-t md:border-t-0 md:border-r border-white/10">
      <div className="h-full min-h-0 flex md:flex-col items-center justify-around md:justify-start md:gap-3 md:overflow-y-auto md:py-3 px-3 md:px-0 no-scrollbar">
        <button
          type="button"
          onClick={() => onSectionChange('INICIO')}
          className={[
            'hidden h-10 w-10 shrink-0 items-center justify-center rounded-2xl font-black italic shadow-lg transition-all md:flex',
            activeSection === 'INICIO' ? 'bg-white ring-2 ring-white/30' : 'text-white hover:brightness-110',
          ].join(' ')}
          style={activeSection === 'INICIO' ? { color: homeTheme.accent } : { backgroundColor: homeTheme.accent }}
          aria-label="Voltar para o inicio"
          title="Inicio"
        >
          W
        </button>

        <div className="flex md:flex-col items-center justify-around md:justify-start gap-2 w-full">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const itemTheme = getSectionTheme(item.id);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSectionChange(item.id)}
                className={[
                  'h-16 md:h-[60px] flex-1 md:flex-none md:w-16 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all border',
                  isActive ? 'bg-white border-white' : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white',
                ].join(' ')}
                style={isActive ? { color: itemTheme.accent, boxShadow: '0 8px 24px ' + itemTheme.accent + '40' } : undefined}
              >
                <Icon size={20} strokeWidth={isActive ? 3 : 2} />
                <span className="text-[8px] font-black uppercase tracking-widest">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
