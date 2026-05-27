'use client';

import { CalendarDays, ClipboardList, Clock3, ListTodo, Tags } from 'lucide-react';
import type { UserRole } from '@/lib/types';

export type AppSection = 'TAREFAS' | 'REUNIAO' | 'PRECIFICACAO' | 'PRAZOS' | 'AUDITORIA';

interface AppSidebarProps {
  activeSection: AppSection;
  userRole: UserRole;
  userSector: string;
  onSectionChange: (section: AppSection) => void;
}

const items = [
  { id: 'TAREFAS' as const, label: 'Tarefas', icon: ListTodo },
  { id: 'REUNIAO' as const, label: 'Reunião', icon: CalendarDays },
  { id: 'PRECIFICACAO' as const, label: 'Price', icon: Tags, priceOnly: true },
  { id: 'PRAZOS' as const, label: 'Prazos', icon: Clock3, purchaseOnly: true },
  { id: 'AUDITORIA' as const, label: 'Auditoria', icon: ClipboardList, adminOnly: true },
];

export function AppSidebar({ activeSection, userRole, userSector, onSectionChange }: AppSidebarProps) {
  const canAccessPricing = userRole === 'admin' || ['precificação', 'price'].includes(userSector.toLowerCase());
  const canAccessPaymentTerms = userRole === 'admin' || userSector.toLowerCase().startsWith('compras');
  const visibleItems = items.filter((item) => {
    if (item.adminOnly && userRole !== 'admin') return false;
    if (item.priceOnly && !canAccessPricing) return false;
    if (item.purchaseOnly && !canAccessPaymentTerms) return false;
    return true;
  });

  return (
    <aside className="fixed bottom-0 left-0 right-0 md:top-0 md:bottom-0 md:right-auto md:w-24 bg-[#151D33] text-white z-50 border-t md:border-t-0 md:border-r border-white/10">
      <div className="h-full flex md:flex-col items-center justify-around md:justify-start md:gap-4 md:py-6 px-3 md:px-0">
        <div className="hidden md:flex w-12 h-12 rounded-2xl bg-blue-600 items-center justify-center font-black italic shadow-lg">
          W
        </div>

        <div className="flex md:flex-col items-center justify-around md:justify-start gap-2 md:gap-3 w-full">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                className={`h-16 md:h-[76px] flex-1 md:flex-none md:w-20 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all border ${
                  isActive
                    ? 'bg-white text-blue-600 border-white shadow-[0_8px_24px_rgba(37,99,235,0.25)]'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon size={22} strokeWidth={isActive ? 3 : 2} />
                <span className="text-[9px] font-black uppercase tracking-widest">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
