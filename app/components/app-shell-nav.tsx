'use client';

import Image from 'next/image';
import { Moon, Search, Settings, Sun, X } from 'lucide-react';
import { NAV_CATEGORIES } from '@/app/constants';
import { MultiCheckboxFilter } from '@/app/components/multi-checkbox-filter';
import type { Profile, UserRole } from '@/lib/types';

interface AppShellNavProps {
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
  onOpenProfile: () => void;
  onOpenSettings: () => void;
}

export function AppShellNav({
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
  onOpenProfile,
  onOpenSettings,
}: AppShellNavProps) {
  const currentProfile = profiles.find((profile) => profile.id === userId);
  const visibleProfiles = profiles.filter((profile) => userRole === 'admin' || profile.sector === userSector);

  return (
    <>
      <nav className="bg-[#232D4A] text-white sticky top-0 z-30 shadow-white-100xl border-b border-white/10 px-3 sm:px-6 h-16 sm:h-20 flex justify-between items-center">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Image
            src="/icon.png"
            alt="Logo"
            width={40}
            height={40}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl shadow-lg object-contain bg-blue-600 p-1"
          />

          <h1 className="text-lg sm:text-xl font-black italic tracking-tighter uppercase leading-none">
            WALLY<span className="text-blue-500 text-[11px] sm:text-sm block not-italic font-medium">Task Manager</span>
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
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

      <div className="sticky top-16 sm:top-20 z-30 w-full">
        <div className="bg-[#DCE7F5] border-b border-slate-200 pt-3 sm:pt-6 px-3 sm:px-4">
          <div className="max-w-[99%] mx-auto flex items-end justify-start xl:justify-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
            {NAV_CATEGORIES.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => onActiveTabChange(tab.id)}
                  className={`flex flex-col items-center justify-center min-w-[84px] sm:min-w-[109px] h-16 sm:h-[80px] gap-1 px-2 sm:px-4 transition-all duration-2 relative rounded-t-2xl border-x-2 border-t-0 border-transparent ${
                    isActive
                      ? 'bg-[var(--app-surface)] border-blue-500 border-t-2 border-b-0 z-40 -mb-[2px] h-[70px] sm:h-[85px] shadow-[0_-4px_10px_rgba(0,0,0,0.02)]'
                      : 'bg-gradient-to-b from-white to-slate-200 border-slate-300 text-slate-500 hover:to-white'
                  }`}
                >
                  <Icon
                    size={isActive ? 22 : 18}
                    className={isActive ? 'text-blue-500' : ''}
                    strokeWidth={isActive ? 3 : 2}
                  />
                  <span className={`text-[10px] font-black uppercase tracking-tight ${isActive ? 'text-blue-500' : ''}`}>
                    {tab.label}
                  </span>

                  {isActive && <div className="absolute -bottom-[4px] left-0 right-0 h-[6px] bg-[var(--app-surface)] z-[50]" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-[var(--app-surface)] border-b-2 border-slate-200 pt-4 sm:pt-10 pb-5 sm:pb-8 px-4 sm:px-10 relative z-10 -mt-[2px]">
          <div className="max-w-[98%] mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-8">
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
              className="w-full sm:w-72"
              buttonClassName="shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]"
            />

            <div className="w-full sm:w-96 group">
              <div className="relative flex items-center h-12">
                <Search size={18} className={`absolute left-5 top-1/2 -translate-y-1/2 transition-colors duration-300 z-10 ${searchTerm ? 'text-blue-600' : 'text-slate-400'}`} />
                <input
                  type="text"
                  placeholder="DIGITE PARA BUSCAR TAREFAS..."
                  value={searchTerm}
                  onChange={(event) => onSearchTermChange(event.target.value)}
                  className={`w-full h-full pl-14 pr-12 bg-white border-2 border-transparent rounded-2xl font-black text-[11px] text-slate-900 outline-none transition-all placeholder:text-slate-300 shadow-[5px_5px_0px_0px_rgba(15,23,42,1)] ${
                    searchTerm
                      ? 'border-blue-600 bg-white shadow-[0_0_20px_rgba(37,99,235,0.1)]'
                      : 'border-transparent shadow-[0px_0px_0px_1px_rgba(15,23,42,1)] focus:border-slate-200 focus:shadow-none focus:translate-x-[1px] focus:translate-y-[1px]'
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
    </>
  );
}
