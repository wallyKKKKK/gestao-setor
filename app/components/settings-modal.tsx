'use client';

import { ChevronRight, LogOut, User, X } from 'lucide-react';
import { SECTORS, USER_ROLES } from '@/app/constants';
import type { Profile, UserRole } from '@/lib/types';

interface SettingsModalProps {
  profiles: Profile[];
  userRole: UserRole;
  onClose: () => void;
  onRoleChange: (profileId: string, role: UserRole) => void;
  onSectorChange: (profileId: string, sector: string) => void;
  onSignOut: () => void;
}

export function SettingsModal({
  profiles,
  userRole,
  onClose,
  onRoleChange,
  onSectorChange,
  onSignOut,
}: SettingsModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-900/95 z-[60] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-[48px] border-4 border-slate-900 shadow-[20px_20px_0px_0px_rgba(37,99,235,1)] flex flex-col max-h-[90vh] overflow-hidden">
        <div className="p-8 border-b-4 border-slate-100 flex justify-between items-center bg-slate-50">
          <div>
            <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-900">Configurações</h2>
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Painel de Controle</p>
          </div>
          <button onClick={onClose}>
            <X size={32} strokeWidth={3} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-10">
          {userRole === 'admin' ? (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <User size={20} className="text-blue-600" />
                <h3 className="font-black uppercase text-sm tracking-widest text-slate-900">Gestão de Tropa</h3>
              </div>
              <div className="space-y-3">
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-slate-50 rounded-3xl border-2 border-slate-100 gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-900 text-white rounded-2xl flex items-center justify-center font-black text-xs">
                        {profile.full_name?.charAt(0)}
                      </div>
                      <div>
                        <p className="font-black text-slate-900 text-sm leading-tight">
                          {profile.full_name || 'Sem Nome'}
                        </p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">
                          {profile.role || 'membro'}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-1.5">
                      {USER_ROLES.map((role) => (
                        <button
                          key={role}
                          onClick={() => onRoleChange(profile.id, role)}
                          className={`px-3 py-1.5 rounded-xl font-black text-[9px] uppercase border-2 transition-all ${
                            profile.role === role
                              ? 'bg-slate-900 border-slate-900 text-white'
                              : 'bg-white border-slate-200 text-slate-400'
                          }`}
                        >
                          {role}
                        </button>
                      ))}

                      <select
                        value={profile.sector || 'Geral'}
                        onChange={(event) => onSectorChange(profile.id, event.target.value)}
                        className="text-[9px] font-black uppercase bg-white border-2 border-slate-900 rounded-lg px-2 py-1"
                      >
                        {SECTORS.map((sector) => (
                          <option key={sector} value={sector}>
                            {sector}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 bg-blue-50 rounded-[32px] text-center text-xs font-black text-blue-900 uppercase">
              Gestão restrita ao Admin
            </div>
          )}

          <div className="space-y-6 pt-6 border-t-2 border-slate-100">
            <button
              onClick={onSignOut}
              className="w-full flex items-center justify-between p-6 bg-red-50 hover:bg-red-100 border-2 border-red-100 rounded-3xl transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-white rounded-2xl text-red-600 border-2 border-red-50">
                  <LogOut size={24} />
                </div>
                <div className="text-left">
                  <p className="font-black text-red-600 uppercase text-sm">Sair do Sistema</p>
                </div>
              </div>
              <ChevronRight className="text-red-300" />
            </button>
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t-4 border-slate-100 text-center">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em]">
            WALLY Task Builder • v2.0
          </p>
        </div>
      </div>
    </div>
  );
}
