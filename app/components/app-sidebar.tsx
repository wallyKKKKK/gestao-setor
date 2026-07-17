'use client';

import { CalendarDays, ClipboardList, Clock3, Database, ListTodo, ShoppingCart, Shuffle, Tags, Truck } from 'lucide-react';
import { isPerfumePurchasingSector, isPricingSector } from '@/lib/permissions';
import type { UserRole } from '@/lib/types';

export type AppSection = 'TAREFAS' | 'REUNIAO' | 'COMPRAS_IA' | 'CADASTROS' | 'PRECIFICACAO' | 'PRAZOS' | 'TRANSPORTE' | 'BALACUBACO' | 'AUDITORIA';

interface AppSidebarProps {
  activeSection: AppSection;
  userRole: UserRole;
  userSector: string;
  isSupremeAdmin: boolean;
  onSectionChange: (section: AppSection) => void;
}

const items = [
  { id: 'TAREFAS' as const, label: 'Tarefas', icon: ListTodo },
  { id: 'COMPRAS_IA' as const, label: 'Compras IA', icon: ShoppingCart, purchaseOnly: true },
  { id: 'REUNIAO' as const, label: 'Reunião', icon: CalendarDays },
  { id: 'CADASTROS' as const, label: 'Cadastros', icon: Database, registryOnly: true },
  { id: 'PRECIFICACAO' as const, label: 'Price', icon: Tags, priceOnly: true },
  { id: 'PRAZOS' as const, label: 'Prazos', icon: Clock3, purchaseOnly: true },
  { id: 'TRANSPORTE' as const, label: 'Transporte', icon: Truck, transportOnly: true },
  { id: 'BALACUBACO' as const, label: 'Remanej.', icon: Shuffle },
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
  onSectionChange,
}: AppSidebarProps) {
  const normalizedSector = normalizeSector(userSector);
  const canAccessPricing = userRole === 'admin' || isPricingSector(userSector);
  const canAccessPaymentTerms = userRole === 'admin' || normalizedSector.startsWith('compras');
  const isPerfumePurchasing = isPerfumePurchasingSector(userSector);
  const canAccessTransport = isSupremeAdmin || isPerfumePurchasing;
  const visibleItems = items.filter((item) => {
    if (item.adminOnly && userRole !== 'admin') return false;
    if (item.priceOnly && !canAccessPricing) return false;
    if (item.purchaseOnly && !canAccessPaymentTerms) return false;
    if (item.transportOnly && !canAccessTransport) return false;
    return true;
  });

  return (
    <aside className="fixed bottom-0 left-0 right-0 md:top-0 md:bottom-0 md:right-auto md:w-20 bg-[#151D33] text-white z-50 border-t md:border-t-0 md:border-r border-white/10">
      <div className="h-full min-h-0 flex md:flex-col items-center justify-around md:justify-start md:gap-3 md:overflow-y-auto md:py-3 px-3 md:px-0 no-scrollbar">
        <div className="hidden md:flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 font-black italic shadow-lg">
          W
        </div>

        <div className="flex md:flex-col items-center justify-around md:justify-start gap-2 w-full">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                className={`h-16 md:h-[60px] flex-1 md:flex-none md:w-16 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all border ${
                  isActive
                    ? 'bg-white text-blue-600 border-white shadow-[0_8px_24px_rgba(37,99,235,0.25)]'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                }`}
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
