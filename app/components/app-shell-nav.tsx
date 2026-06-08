'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bell,
  CalendarDays,
  ClipboardList,
  Clock3,
  Database,
  ListTodo,
  Moon,
  Search,
  Settings,
  Shuffle,
  Sun,
  Tags,
  Truck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { NAV_CATEGORIES } from '@/app/constants';
import { MultiCheckboxFilter } from '@/app/components/multi-checkbox-filter';
import type { AppSection } from '@/app/components/app-sidebar';
import type { AppNotification, Profile, UserRole } from '@/lib/types';

interface AppShellNavProps {
  section: AppSection;
  sectionTitle: string;
  sectionSubtitle?: string;
  showTaskTools: boolean;
  taskAction?: ReactNode;
  userId: string;
  userRole: UserRole;
  profiles: Profile[];
  activeTab: string;
  filterUsers: string[];
  userSector: string;
  searchTerm: string;
  theme: 'light' | 'dark';
  onActiveTabChange: (tab: string) => void;
  onFilterUsersChange: (userIds: string[]) => void;
  onSearchTermChange: (term: string) => void;
  onThemeToggle: () => void;
  onOpenGlobalSearch: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  notifications: AppNotification[];
  unreadNotificationIds: string[];
  browserNotificationPermission: NotificationPermission | "unsupported";
  onNotificationSelect: (notification: AppNotification) => void;
  onMarkAllNotificationsRead: () => void;
  onRequestBrowserNotifications: () => void;
}

const SECTION_NAV_META: Record<AppSection, { icon: LucideIcon; iconClassName: string }> = {
  TAREFAS: { icon: ListTodo, iconClassName: 'bg-blue-600 text-white' },
  REUNIAO: { icon: CalendarDays, iconClassName: 'bg-sky-600 text-white' },
  CADASTROS: { icon: Database, iconClassName: 'bg-slate-700 text-white' },
  PRECIFICACAO: { icon: Tags, iconClassName: 'bg-indigo-600 text-white' },
  PRAZOS: { icon: Clock3, iconClassName: 'bg-emerald-600 text-white' },
  TRANSPORTE: { icon: Truck, iconClassName: 'bg-blue-600 text-white' },
  BALACUBACO: { icon: Shuffle, iconClassName: 'bg-violet-600 text-white' },
  AUDITORIA: { icon: ClipboardList, iconClassName: 'bg-amber-600 text-white' },
};

const NOTIFICATION_GROUPS = [
  { id: 'today', label: 'Hoje', helper: 'Lembretes do dia' },
  { id: 'alerts', label: 'Avisos', helper: 'Comunicados internos' },
  { id: 'system', label: 'Sistema', helper: 'Movimentos e atualizações' },
] as const;

function getNotificationGroupId(notification: AppNotification) {
  if (
    notification.id.startsWith('daily-')
    || notification.id.startsWith('meeting-reminder:')
    || notification.id.startsWith('one-off-task:')
  ) return 'today';
  if (notification.id.startsWith('announcement:')) return 'alerts';
  return 'system';
}

export function AppShellNav({
  section,
  sectionTitle,
  sectionSubtitle,
  showTaskTools,
  taskAction,
  userId,
  userRole,
  profiles,
  activeTab,
  filterUsers,
  userSector,
  searchTerm,
  theme,
  onActiveTabChange,
  onFilterUsersChange,
  onSearchTermChange,
  onThemeToggle,
  onOpenGlobalSearch,
  onOpenProfile,
  onOpenSettings,
  notifications,
  unreadNotificationIds,
  browserNotificationPermission,
  onNotificationSelect,
  onMarkAllNotificationsRead,
  onRequestBrowserNotifications,
}: AppShellNavProps) {
  const currentProfile = profiles.find((profile) => profile.id === userId);
  const visibleProfiles = profiles.filter((profile) => userRole === 'admin' || profile.sector === userSector);
  const SectionIcon = SECTION_NAV_META[section].icon;
  const [showNotifications, setShowNotifications] = useState(false);
  const unreadCount = unreadNotificationIds.length;
  const groupedNotifications = useMemo(() => {
    const unreadSet = new Set(unreadNotificationIds);

    return NOTIFICATION_GROUPS.map((group) => {
      const items = notifications.filter((notification) => getNotificationGroupId(notification) === group.id);

      return {
        ...group,
        items,
        unreadCount: items.filter((notification) => unreadSet.has(notification.id)).length,
      };
    }).filter((group) => group.items.length > 0);
  }, [notifications, unreadNotificationIds]);

  useEffect(() => {
    if (!showNotifications) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowNotifications(false);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showNotifications]);

  return (
    <>
      <nav className="bg-[#151D33] text-white sticky top-0 z-[200] border-b border-white/10 px-3 sm:px-5 h-16 flex justify-between items-center">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-visible">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-lg ${SECTION_NAV_META[section].iconClassName}`}>
            <SectionIcon size={22} strokeWidth={2.8} />
          </div>

          <div className="min-w-0 overflow-visible pr-3">
            <p className="overflow-visible whitespace-nowrap py-1 pr-2 text-[15px] sm:text-lg font-black italic tracking-tight uppercase leading-[1.35]">
              {sectionTitle}
            </p>
            {sectionSubtitle && (
              <p className="mt-0.5 truncate text-[9px] font-black uppercase tracking-[0.18em] text-blue-300">
                {sectionSubtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={onOpenGlobalSearch}
            className="hidden h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-[10px] font-black uppercase tracking-widest text-slate-300 transition-all hover:bg-white/10 hover:text-white lg:flex"
            aria-label="Abrir busca global"
            title="Busca global"
          >
            <Search size={16} />
            Buscar
            <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] text-slate-400">Ctrl K</span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotifications((current) => !current)}
              className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition-all hover:bg-white/10 hover:text-white"
              aria-label="Abrir notificações"
              title="Notificações"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#151D33] bg-blue-500 px-1 text-[9px] font-black text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <>
                <div className="fixed inset-0 z-[120]" onMouseDown={() => setShowNotifications(false)} />
                <div
                  className="fixed right-3 top-[4.5rem] z-[130] flex max-h-[min(520px,calc(100vh-5.25rem))] w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-[0_24px_70px_rgba(15,23,42,0.24)] sm:right-5"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-widest text-blue-600">Notificações</p>
                      <p className="text-[10px] font-bold text-slate-400">{unreadCount} nova{unreadCount === 1 ? '' : 's'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={onMarkAllNotificationsRead}
                      disabled={notifications.length === 0}
                      className="rounded-full bg-slate-100 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500 transition hover:bg-slate-200 disabled:opacity-40"
                    >
                      Marcar lidas
                    </button>
                  </div>

                  {browserNotificationPermission !== 'granted' && (
                    <div className="border-b border-slate-100 bg-slate-50 px-3 py-3">
                      <button
                        type="button"
                        onClick={onRequestBrowserNotifications}
                        disabled={browserNotificationPermission === 'unsupported' || browserNotificationPermission === 'denied'}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-white px-3 py-2 text-left transition hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <span className="min-w-0">
                          <span className="block text-[10px] font-black uppercase tracking-widest text-slate-900">
                            Notificações do navegador
                          </span>
                          <span className="mt-0.5 block text-[10px] font-bold text-slate-400">
                            {browserNotificationPermission === 'denied'
                              ? 'Permissão bloqueada no navegador'
                              : browserNotificationPermission === 'unsupported'
                                ? 'Navegador sem suporte'
                                : 'Receba avisos mesmo em outra janela'}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-[9px] font-black uppercase text-white">
                          Ativar
                        </span>
                      </button>
                    </div>
                  )}

                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-[11px] font-black uppercase tracking-widest text-slate-300">
                        Nada novo por aqui
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {groupedNotifications.map((group) => (
                          <section key={group.id} className="rounded-2xl bg-slate-50/80 p-1.5">
                            <div className="flex items-center justify-between px-2 py-1.5">
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{group.label}</p>
                                <p className="text-[9px] font-bold uppercase tracking-wide text-slate-300">{group.helper}</p>
                              </div>
                              {group.unreadCount > 0 && (
                                <span className="rounded-full bg-blue-600 px-2 py-1 text-[9px] font-black text-white">
                                  {group.unreadCount}
                                </span>
                              )}
                            </div>

                            <div className="space-y-1">
                              {group.items.map((notification) => {
                                const isUnread = unreadNotificationIds.includes(notification.id);
                                const toneClass = {
                                  blue: 'bg-blue-500',
                                  amber: 'bg-amber-500',
                                  red: 'bg-red-500',
                                  green: 'bg-emerald-500',
                                  slate: 'bg-slate-500',
                                }[notification.tone];

                                return (
                                  <button
                                    key={notification.id}
                                    type="button"
                                    onClick={() => {
                                      onNotificationSelect(notification);
                                      setShowNotifications(false);
                                    }}
                                    className={`flex w-full gap-3 rounded-2xl p-3 text-left transition hover:bg-white ${
                                      isUnread ? 'bg-blue-50/80 shadow-sm' : 'bg-white/70'
                                    }`}
                                  >
                                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${toneClass}`} />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[12px] font-black uppercase text-slate-900">
                                        {notification.title}
                                      </span>
                                      <span className="mt-1 line-clamp-2 block text-[11px] font-bold leading-snug text-slate-500">
                                        {notification.description}
                                      </span>
                                    </span>
                                    {isUnread && <span className="mt-1 h-2 w-2 rounded-full bg-blue-600" />}
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={onOpenProfile}
            className="flex items-center gap-3 bg-white/5 p-1.5 sm:pl-2 sm:pr-4 sm:py-1.5 rounded-full border border-white/10 hover:bg-white/10 transition-all shadow-sm"
          >
            <div className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black shadow-lg">
              {currentProfile?.full_name?.charAt(0) || 'U'}
            </div>
            <span className="text-[11px] font-bold uppercase text-slate-300 hidden md:block">
              {currentProfile?.full_name || 'Meu Perfil'}
              {userRole === 'admin' ? ' ADMIN' : userRole === 'gerente' ? ' GERENTE' : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={onThemeToggle}
            className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
            aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          <button
            onClick={onOpenSettings}
            className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
          >
            <Settings size={20} />
          </button>
        </div>
      </nav>

      {showTaskTools && (
        <div className="sticky top-16 z-30 w-full">
          <div className="bg-[#DCE7F5] px-3 pt-3 sm:px-5">
            <div className="mx-auto flex h-[82px] max-w-[1180px] items-end justify-start gap-2 overflow-x-auto no-scrollbar lg:justify-center">
                {NAV_CATEGORIES.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      onClick={() => onActiveTabChange(tab.id)}
                      className={`flex min-w-[104px] flex-col items-center justify-center gap-1.5 rounded-t-[16px] border px-4 transition-all ${
                        isActive
                          ? 'h-[82px] bg-white text-blue-600 border-white shadow-[0_14px_28px_rgba(37,99,235,0.16)]'
                          : 'h-[66px] bg-slate-100 text-slate-600 border-slate-200/80 hover:bg-slate-50 hover:text-blue-600'
                      }`}
                    >
                      <Icon
                        size={isActive ? 25 : 21}
                        className={isActive ? 'text-blue-500' : 'text-slate-500'}
                        strokeWidth={isActive ? 3 : 2.4}
                      />
                      <span className={`text-[10px] font-black uppercase tracking-tight ${isActive ? 'text-blue-600' : ''}`}>
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>

          <div className="border-b border-slate-200 bg-white px-3 py-4 sm:px-5">
            <div className="mx-auto grid max-w-[1760px] grid-cols-1 items-center gap-3 lg:grid-cols-[260px_minmax(280px,1fr)_340px]">
              <MultiCheckboxFilter
                label="Equipe"
                allLabel={userRole === 'admin' ? 'Equipe Total' : `Equipe ${userSector}`}
                selectedValues={filterUsers}
                onChange={onFilterUsersChange}
                options={visibleProfiles.map((profile) => ({
                  value: profile.id,
                  label: profile.full_name || 'Usuario',
                  helper: profile.sector || 'Geral',
                }))}
                className="w-full"
                buttonClassName="h-12 rounded-2xl border-2 border-slate-200 bg-white text-slate-900 shadow-[0_4px_12px_rgba(15,23,42,0.06)] hover:border-blue-200 hover:text-blue-700"
              />

              <div className="flex justify-center">
                {taskAction}
              </div>

              <div className="group w-full">
                <div className="relative flex h-12 items-center">
                  <Search size={18} className={`absolute left-5 top-1/2 -translate-y-1/2 transition-colors duration-300 z-10 ${searchTerm ? 'text-blue-600' : 'text-slate-400'}`} />
                  <input
                    type="text"
                    placeholder="DIGITE PARA BUSCAR TAREFAS..."
                    value={searchTerm}
                    onChange={(event) => onSearchTermChange(event.target.value)}
                    className={`h-full w-full rounded-2xl border-2 border-slate-200 bg-white pl-14 pr-12 text-[11px] font-black text-slate-900 outline-none transition-all placeholder:text-slate-400 shadow-[0_4px_12px_rgba(15,23,42,0.06)] ${
                      searchTerm
                        ? 'ring-2 ring-blue-500'
                        : 'hover:border-blue-200 focus:border-blue-300 focus:ring-2 focus:ring-blue-100'
                    }`}
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => onSearchTermChange('')}
                      className="absolute right-4 bg-slate-100 hover:bg-red-100 text-slate-400 p-1.5 rounded-lg transition-all"
                    >
                      <X size={14} strokeWidth={3} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      )}
    </>
  );
}
