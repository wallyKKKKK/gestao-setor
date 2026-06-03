'use client';

import { CalendarDays, ClipboardList, Clock3, Database, ListTodo, Moon, Shuffle, Sun, Tags, Truck } from 'lucide-react';
import type { UserRole } from '@/lib/types';

export type AppSection = 'TAREFAS' | 'REUNIAO' | 'CADASTROS' | 'PRECIFICACAO' | 'PRAZOS' | 'TRANSPORTE' | 'BALACUBACO' | 'AUDITORIA';

interface AppSidebarProps {
  activeSection: AppSection;
  userRole: UserRole;
  userSector: string;
  isSupremeAdmin: boolean;
  theme: 'light' | 'dark';
  onSectionChange: (section: AppSection) => void;
  onThemeToggle: () => void;
}

const items = [
  { id: 'TAREFAS' as const, label: 'Tarefas', icon: ListTodo },
  { id: 'REUNIAO' as const, label: 'Reunião', icon: CalendarDays },
  { id: 'CADASTROS' as const, label: 'Cadastros', icon: Database, registryOnly: true },
  { id: 'PRECIFICACAO' as const, label: 'Price', icon: Tags, priceOnly: true },
  { id: 'PRAZOS' as const, label: 'Prazos', icon: Clock3, purchaseOnly: true },
  { id: 'TRANSPORTE' as const, label: 'Transporte', icon: Truck, transportOnly: true },
  { id: 'BALACUBACO' as const, label: 'Balacubaco', icon: Shuffle, transferOnly: true },
  { id: 'AUDITORIA' as const, label: 'Auditoria', icon: ClipboardList, adminOnly: true },
];

function normalizeSector(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function AppSidebar({
  activeSection,
  userRole,
  userSector,
  isSupremeAdmin,
  theme,
  onSectionChange,
  onThemeToggle,
}: AppSidebarProps) {
  const normalizedSector = normalizeSector(userSector);
  const canAccessPricing = userRole === 'admin' || ['precificacao', 'price'].includes(normalizedSector);
  const canAccessPaymentTerms = userRole === 'admin' || normalizedSector.startsWith('compras');
  const canAccessTransport = isSupremeAdmin || (normalizedSector.includes('compras') && normalizedSector.includes('perfumaria'));
  const canAccessRegistries = userRole === 'admin' || canAccessPricing || canAccessPaymentTerms;
  const visibleItems = items.filter((item) => {
    if (item.adminOnly && userRole !== 'admin') return false;
    if (item.registryOnly && !canAccessRegistries) return false;
    if (item.priceOnly && !canAccessPricing) return false;
    if (item.purchaseOnly && !canAccessPaymentTerms) return false;
    if (item.transportOnly && !canAccessTransport) return false;
    if (item.transferOnly && !isSupremeAdmin) return false;
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

        <button
          type="button"
          onClick={onThemeToggle}
          className="hidden md:flex mt-auto w-12 h-12 rounded-2xl items-center justify-center border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition-all"
          aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
          title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>
    </aside>
  );
}
