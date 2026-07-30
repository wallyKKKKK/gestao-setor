'use client';

import {
  ArrowRight,
  BadgePercent,
  Bell,
  CalendarDays,
  ClipboardList,
  Clock3,
  Database,
  LayoutGrid,
  ListTodo,
  PackageSearch,
  Search,
  ShoppingCart,
  Shuffle,
  Tags,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import type { AppSection } from '@/app/components/app-sidebar';
import { getSectionTheme } from '@/lib/section-theme';

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
  focusItems: Array<{ title: string; detail: string; tab: string }>;
}

interface ModuleMeta {
  section: AppSection;
  title: string;
  description: string;
  icon: LucideIcon;
  defaultTab?: string;
}

interface ModuleHomeProps {
  availableSections: AppSection[];
  dailyOverview: DailyOverview;
  userName: string;
  userSector: string;
  onOpenSection: (section: AppSection, tab?: string) => void;
  onOpenGlobalSearch: () => void;
}

const MODULES: ModuleMeta[] = [
  { section: 'TAREFAS', title: 'Tarefas', description: 'Rotina, prioridades e acompanhamento.', icon: ListTodo, defaultTab: 'HOJE' },
  { section: 'REUNIAO', title: 'Reunioes', description: 'Agenda mensal e compromissos.', icon: CalendarDays },
  { section: 'COMPRAS_IA', title: 'Compras IA', description: 'Cotacoes e analise de fornecedores.', icon: ShoppingCart },
  { section: 'CADASTROS', title: 'Cadastros', description: 'Produtos, lojas e regras base.', icon: Database },
  { section: 'ESTOQUE_ERP', title: 'Estoque ERP', description: 'Saldo por loja, curva e produto.', icon: PackageSearch },
  { section: 'PRECIFICACAO', title: 'Price', description: 'Precos, ofertas e exportacoes.', icon: Tags },
  { section: 'PRE_VENCIDOS', title: 'Pre-vencidos', description: 'Descontos por validade e TXT.', icon: BadgePercent },
  { section: 'PRAZOS', title: 'Prazos', description: 'Condicoes comerciais e fornecedores.', icon: Clock3 },
  { section: 'TRANSPORTE', title: 'Transporte', description: 'Fretes, debitos e conferencias.', icon: Truck },
  { section: 'BALACUBACO', title: 'Remanejamento', description: 'Sugestoes e pedidos de transferencia.', icon: Shuffle },
  { section: 'AUDITORIA', title: 'Auditoria', description: 'Logs e rastreabilidade do sistema.', icon: ClipboardList },
];

function moduleMetric(section: AppSection, overview: DailyOverview) {
  if (section === 'TAREFAS') return { value: overview.todayTasks, label: 'hoje' };
  if (section === 'REUNIAO') return { value: overview.meetingsToday, label: 'reunioes' };
  if (section === 'AUDITORIA') return { value: overview.unreadNotifications, label: 'avisos' };
  if (section === 'BALACUBACO') return { value: overview.overdueTasks, label: 'atencao' };
  return null;
}

export function ModuleHome({ availableSections, dailyOverview, userName, userSector, onOpenSection, onOpenGlobalSearch }: ModuleHomeProps) {
  const availableSet = new Set(availableSections);
  const modules = MODULES.filter((module) => availableSet.has(module.section));
  const firstName = userName.trim().split(/\s+/)[0] || 'Usuario';

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#E8EEF7] px-3 py-3 text-slate-950 sm:px-4 lg:px-5 dark:bg-[#111827] dark:text-white">
      <section className="mx-auto flex max-w-[1540px] flex-col gap-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_270px_360px]">
          <div className="rounded-2xl border border-white/75 bg-white/92 p-4 shadow-[0_12px_34px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#1f2937]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
                  <LayoutGrid size={13} /> Central de modulos
                </div>
                <h1 className="mt-2 text-2xl font-black italic tracking-tight text-slate-950 sm:text-3xl dark:text-white">Bom dia, {firstName}</h1>
                <p className="mt-1 max-w-3xl text-[12px] font-bold leading-snug text-slate-500 dark:text-slate-300">
                  Escolha o modulo que quer abrir. Esta tela vira a entrada principal do sistema.
                </p>
              </div>

              <button
                type="button"
                onClick={onOpenGlobalSearch}
                className="inline-flex h-11 min-w-[190px] items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-950 px-5 text-[9px] font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-blue-600 dark:border-white/10 dark:bg-white/10 dark:hover:bg-blue-600"
              >
                <Search size={15} /> Buscar no sistema
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryPill label="Tarefas hoje" value={dailyOverview.todayTasks} />
              <SummaryPill label="Atrasadas" value={dailyOverview.overdueTasks} tone="amber" />
              <SummaryPill label="Reunioes" value={dailyOverview.meetingsToday} tone="sky" />
              <SummaryPill label="Avisos" value={dailyOverview.unreadNotifications} tone="blue" />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/75 bg-white shadow-[0_12px_34px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#1f2937]">
            <div className="bg-[#151D33] px-4 py-3 text-white">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-200">Perfil ativo</p>
              <p className="mt-1 truncate text-xl font-black italic uppercase">{userName || 'Usuario'}</p>
              <p className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-300">{userSector || 'Sem setor'}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              <MiniAction label="Hoje" value={dailyOverview.todayTasks} onClick={() => onOpenSection('TAREFAS', 'HOJE')} />
              <MiniAction label="Semana" value={dailyOverview.futureTasks} onClick={() => onOpenSection('TAREFAS', 'SEMANA')} />
              <MiniAction label="Agenda" value={dailyOverview.meetingsToday} onClick={() => onOpenSection('REUNIAO')} />
              <MiniAction label="Avisos" value={dailyOverview.unreadNotifications} onClick={() => onOpenSection('TAREFAS', 'COMUNICADOS')} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/75 bg-white p-4 shadow-[0_12px_34px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#1f2937]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-950 dark:text-white">Foco do dia</p>
                <p className="mt-0.5 text-[9px] font-bold text-slate-400">Pendencias mais proximas</p>
              </div>
              <Bell size={16} className="text-blue-600" />
            </div>
            <div className="mt-3 space-y-2">
              {dailyOverview.focusItems.length > 0 ? dailyOverview.focusItems.slice(0, 2).map((item) => (
                <button
                  key={`${item.title}-${item.tab}`}
                  type="button"
                  onClick={() => onOpenSection('TAREFAS', item.tab)}
                  className="w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-blue-500/10"
                >
                  <span className="block truncate text-[11px] font-black uppercase text-slate-950 dark:text-white">{item.title}</span>
                  <span className="mt-0.5 block truncate text-[8px] font-bold uppercase text-slate-400">{item.detail}</span>
                </button>
              )) : (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-[10px] font-black uppercase tracking-widest text-slate-300 dark:border-white/10">
                  Nada urgente por aqui
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {modules.map((module) => {
            const Icon = module.icon;
            const metric = moduleMetric(module.section, dailyOverview);
            const theme = getSectionTheme(module.section);

            return (
              <button
                key={module.section}
                type="button"
                onClick={() => onOpenSection(module.section, module.defaultTab)}
                className="group min-h-[138px] overflow-hidden rounded-2xl border border-white/75 bg-white text-left shadow-[0_10px_28px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(15,23,42,0.14)] dark:border-white/10 dark:bg-[#1f2937]"
              >
                <div className={`flex h-[58px] items-center justify-between bg-gradient-to-br ${theme.gradientClassName} px-4 text-white`}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/18 shadow-inner">
                    <Icon size={22} strokeWidth={2.7} />
                  </div>
                  <span className="max-w-[145px] truncate rounded-full bg-white/18 px-3 py-1 text-[8px] font-black uppercase tracking-widest">{theme.helper}</span>
                </div>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-black italic uppercase text-slate-950 dark:text-white">{module.title}</h2>
                      <p className="mt-1 line-clamp-2 text-[11px] font-bold leading-snug text-slate-500 dark:text-slate-300">{module.description}</p>
                    </div>
                    {metric ? (
                      <span className="shrink-0 rounded-xl bg-slate-100 px-2.5 py-1.5 text-center dark:bg-white/10">
                        <span className="block text-base font-black text-slate-950 dark:text-white">{metric.value}</span>
                        <span className="block text-[7px] font-black uppercase tracking-widest text-slate-400">{metric.label}</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                    <span>Abrir modulo</span>
                    <ArrowRight size={15} className="transition group-hover:translate-x-1" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function SummaryPill({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'blue' | 'sky' | 'amber' }) {
  const classes = {
    slate: 'bg-slate-50 text-slate-700 dark:bg-white/5 dark:text-slate-200',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200',
    sky: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200',
  }[tone];

  return (
    <div className={`rounded-xl px-3 py-2 ${classes}`}>
      <p className="text-[8px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="text-lg font-black leading-tight">{value}</p>
    </div>
  );
}

function MiniAction({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-blue-500/10"
    >
      <span className="block text-base font-black text-slate-950 dark:text-white">{value}</span>
      <span className="mt-0.5 block text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</span>
    </button>
  );
}