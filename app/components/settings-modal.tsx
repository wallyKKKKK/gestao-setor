'use client';

import { useMemo, useState } from 'react';
import {
  Ban,
  Check,
  ChevronRight,
  Clock3,
  LogOut,
  Search,
  ShieldCheck,
  User,
  UserCheck,
  UserRoundCog,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { SECTORS, USER_ROLES } from '@/app/constants';
import { getAppPermissions, type AppPermissions } from '@/lib/permissions';
import type { AccountStatus, Profile, UserRole } from '@/lib/types';

const PERMISSION_ITEMS: Array<{ key: keyof AppPermissions; label: string }> = [
  { key: 'canManageUsers', label: 'Usuarios' },
  { key: 'canViewAudit', label: 'Auditoria' },
  { key: 'canDeleteTasks', label: 'Excluir tarefas' },
  { key: 'canDeleteMeetings', label: 'Excluir reunioes' },
  { key: 'canImportTransport', label: 'Importar transporte' },
  { key: 'canExportTransport', label: 'Exportar transporte' },
  { key: 'canBulkEditTransport', label: 'Editar transporte' },
  { key: 'canDeleteTransportEntries', label: 'Excluir transporte' },
  { key: 'canImportReallocationData', label: 'Importar remanej.' },
  { key: 'canGenerateReallocationSuggestions', label: 'Gerar sugestoes' },
  { key: 'canExportReallocation', label: 'Exportar remanej.' },
];

const PERMISSION_PRESETS: Array<{
  title: string;
  description: string;
  role: UserRole;
  sector: string;
  isSupremeAdmin: boolean;
}> = [
  {
    title: 'Admin supremo',
    description: 'Acesso total',
    role: 'admin',
    sector: 'Compras Perfumaria',
    isSupremeAdmin: true,
  },
  {
    title: 'Admin',
    description: 'Gestao do app',
    role: 'admin',
    sector: 'Geral',
    isSupremeAdmin: false,
  },
  {
    title: 'Gerente',
    description: 'Revisao operacional',
    role: 'gerente',
    sector: 'Geral',
    isSupremeAdmin: false,
  },
  {
    title: 'Compras perfumaria',
    description: 'Transporte',
    role: 'membro',
    sector: 'Compras Perfumaria',
    isSupremeAdmin: false,
  },
  {
    title: 'Membro',
    description: 'Uso diario',
    role: 'membro',
    sector: 'Geral',
    isSupremeAdmin: false,
  },
];

interface SettingsModalProps {
  profiles: Profile[];
  userRole: UserRole;
  onClose: () => void;
  onRoleChange: (profileId: string, role: UserRole) => void;
  onSectorChange: (profileId: string, sector: string) => void;
  onAccountStatusChange: (profileId: string, accountStatus: AccountStatus) => void;
  onActiveChange: (profileId: string, isActive: boolean) => void;
  onSignOut: () => void;
}

function getProfileStatus(profile: Profile) {
  if (profile.is_active === false) return 'blocked';
  return profile.account_status || 'approved';
}

function getStatusMeta(status: ReturnType<typeof getProfileStatus>) {
  if (status === 'blocked') {
    return {
      label: 'Bloqueado',
      className: 'border-red-100 bg-red-50 text-red-700',
      icon: Ban,
    };
  }

  if (status === 'pending') {
    return {
      label: 'Pendente',
      className: 'border-amber-100 bg-amber-50 text-amber-700',
      icon: Clock3,
    };
  }

  if (status === 'rejected') {
    return {
      label: 'Rejeitado',
      className: 'border-slate-200 bg-slate-100 text-slate-500',
      icon: UserX,
    };
  }

  return {
    label: 'Aprovado',
    className: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    icon: Check,
  };
}

export function SettingsModal({
  profiles,
  userRole,
  onClose,
  onRoleChange,
  onSectorChange,
  onAccountStatusChange,
  onActiveChange,
  onSignOut,
}: SettingsModalProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const summary = useMemo(() => {
    const pending = profiles.filter((profile) => getProfileStatus(profile) === 'pending').length;
    const blocked = profiles.filter((profile) => getProfileStatus(profile) === 'blocked').length;
    const admins = profiles.filter((profile) => profile.role === 'admin').length;

    return {
      total: profiles.length,
      pending,
      blocked,
      admins,
    };
  }, [profiles]);

  const filteredProfiles = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return profiles;

    return profiles.filter((profile) => [
      profile.full_name,
      profile.role,
      profile.sector,
      getStatusMeta(getProfileStatus(profile)).label,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [profiles, searchTerm]);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/18 p-3 backdrop-blur-[2px] animate-in fade-in">
      <div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-[#F8FAFC] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)]">
              <UserRoundCog size={22} strokeWidth={3} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Painel de controle</p>
              <h2 className="truncate text-2xl font-black uppercase italic tracking-tight text-slate-950">Configuracoes</h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
            aria-label="Fechar configuracoes"
          >
            <X size={23} strokeWidth={3} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-4">
          <div className="space-y-4">
            <section className="min-w-0 space-y-4">
              <div className="grid gap-2 sm:grid-cols-4">
                <SettingsStat label="Usuarios" value={summary.total} icon={<Users size={15} />} tone="blue" />
                <SettingsStat label="Pendentes" value={summary.pending} icon={<Clock3 size={15} />} tone="amber" />
                <SettingsStat label="Bloqueados" value={summary.blocked} icon={<Ban size={15} />} tone="red" />
                <SettingsStat label="Admins" value={summary.admins} icon={<ShieldCheck size={15} />} tone="slate" />
              </div>

              <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <User size={18} className="text-blue-600" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Gestao de usuarios</h3>
                  </div>
                  <label className="flex h-10 min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 sm:w-64">
                    <Search size={15} className="text-slate-400" />
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Buscar usuario..."
                      className="h-full min-w-0 flex-1 bg-transparent text-[11px] font-bold text-slate-800 outline-none placeholder:text-slate-400"
                    />
                  </label>
                </div>

                {userRole === 'admin' ? (
                  <div className="divide-y divide-slate-100">
                    {filteredProfiles.map((profile) => (
                      <ProfileAdminRow
                        key={profile.id}
                        profile={profile}
                        onRoleChange={onRoleChange}
                        onSectorChange={onSectorChange}
                        onAccountStatusChange={onAccountStatusChange}
                        onActiveChange={onActiveChange}
                      />
                    ))}

                    {filteredProfiles.length === 0 && (
                      <div className="px-4 py-12 text-center">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-300">Nenhum usuario encontrado</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-8 text-center">
                    <p className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-5 text-xs font-black uppercase text-blue-800">
                      Gestao restrita ao Admin
                    </p>
                  </div>
                )}
              </div>
            </section>

            <aside className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-stretch">
              <section className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className="text-blue-600" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Permissoes</h3>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[9px] font-black uppercase text-slate-500">Leitura</span>
                </div>

                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  {PERMISSION_PRESETS.map((preset) => {
                    const permissions = getAppPermissions({
                      role: preset.role,
                      sector: preset.sector,
                      isSupremeAdmin: preset.isSupremeAdmin,
                    });
                    const allowedItems = PERMISSION_ITEMS.filter((item) => permissions[item.key]);

                    return (
                      <div key={preset.title} className="min-w-0 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black uppercase text-slate-950">{preset.title}</p>
                            <p className="truncate text-[9px] font-black uppercase tracking-wide text-slate-400">{preset.description}</p>
                          </div>
                          <span className="rounded-xl bg-white px-2 py-1 text-[9px] font-black text-blue-700">
                            {allowedItems.length}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {allowedItems.slice(0, 5).map((item) => (
                            <span key={item.key} className="rounded-full border border-blue-100 bg-white px-2 py-1 text-[8px] font-black uppercase text-blue-700">
                              {item.label}
                            </span>
                          ))}
                          {allowedItems.length > 5 && (
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[8px] font-black uppercase text-slate-500">
                              +{allowedItems.length - 5}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <button
                type="button"
                onClick={onSignOut}
                className="flex w-full items-center justify-between rounded-[24px] border border-red-100 bg-red-50 p-4 text-left shadow-sm transition hover:border-red-200 hover:bg-red-100"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-red-600">
                    <LogOut size={22} />
                  </div>
                  <div>
                    <p className="text-sm font-black uppercase text-red-600">Sair do sistema</p>
                    <p className="text-[10px] font-bold uppercase text-red-400">Encerrar sessao atual</p>
                  </div>
                </div>
                <ChevronRight className="text-red-300" />
              </button>
            </aside>
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-3 text-center">
          <p className="text-[9px] font-black uppercase tracking-[0.35em] text-slate-400">
            WALLY Task Builder - v2.0
          </p>
        </div>
      </div>
    </div>
  );
}

function SettingsStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'blue' | 'amber' | 'red' | 'slate';
}) {
  const toneClass = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    red: 'border-red-100 bg-red-50 text-red-700',
    slate: 'border-slate-200 bg-white text-slate-700',
  }[tone];

  return (
    <div className={`rounded-2xl border px-3 py-2 shadow-sm ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-black uppercase tracking-widest opacity-70">{label}</p>
        {icon}
      </div>
      <p className="mt-1 text-xl font-black tracking-tight">{value}</p>
    </div>
  );
}

function ProfileAdminRow({
  profile,
  onRoleChange,
  onSectorChange,
  onAccountStatusChange,
  onActiveChange,
}: {
  profile: Profile;
  onRoleChange: (profileId: string, role: UserRole) => void;
  onSectorChange: (profileId: string, sector: string) => void;
  onAccountStatusChange: (profileId: string, accountStatus: AccountStatus) => void;
  onActiveChange: (profileId: string, isActive: boolean) => void;
}) {
  const status = getProfileStatus(profile);
  const statusMeta = getStatusMeta(status);
  const StatusIcon = statusMeta.icon;

  return (
    <div className={`grid gap-3 px-3 py-3 lg:grid-cols-[minmax(190px,1fr)_minmax(260px,1.4fr)_auto] lg:items-center ${
      status === 'blocked' ? 'bg-red-50/40' : status === 'pending' ? 'bg-amber-50/40' : 'bg-white'
    }`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black uppercase text-white">
          {profile.full_name?.charAt(0) || '?'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-black uppercase text-slate-950">{profile.full_name || 'Sem nome'}</p>
          <p className="truncate text-[9px] font-black uppercase tracking-wide text-slate-400">
            {profile.role || 'membro'} - {profile.sector || 'Geral'}
          </p>
        </div>
      </div>

      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(180px,1fr)_minmax(190px,1fr)]">
        <div className="flex min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-1">
          {USER_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => onRoleChange(profile.id, role)}
              className={`h-8 flex-1 rounded-xl px-2 text-[9px] font-black uppercase transition ${
                profile.role === role
                  ? 'bg-slate-950 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-white hover:text-blue-700'
              }`}
            >
              {role}
            </button>
          ))}
        </div>

        <select
          value={profile.sector || 'Geral'}
          onChange={(event) => onSectorChange(profile.id, event.target.value)}
          className="h-10 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-[10px] font-black uppercase text-slate-800 outline-none transition focus:border-blue-400"
        >
          {SECTORS.map((sector) => (
            <option key={sector} value={sector}>
              {sector}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <span className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[9px] font-black uppercase ${statusMeta.className}`}>
          <StatusIcon size={12} />
          {statusMeta.label}
        </span>

        <div className="flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
          <IconAction
            label="Aprovar"
            title="Aprovar usuario"
            tone="green"
            onClick={() => onAccountStatusChange(profile.id, 'approved')}
          >
            <UserCheck size={14} />
          </IconAction>
          <IconAction
            label="Pendente"
            title="Marcar como pendente"
            tone="amber"
            onClick={() => onAccountStatusChange(profile.id, 'pending')}
          >
            <Clock3 size={14} />
          </IconAction>
          <IconAction
            label="Rejeitar"
            title="Rejeitar usuario"
            tone="slate"
            onClick={() => onAccountStatusChange(profile.id, 'rejected')}
          >
            <UserX size={14} />
          </IconAction>
          <IconAction
            label={profile.is_active === false ? 'Ativar' : 'Bloquear'}
            title={profile.is_active === false ? 'Ativar usuario' : 'Bloquear usuario'}
            tone={profile.is_active === false ? 'blue' : 'red'}
            onClick={() => onActiveChange(profile.id, profile.is_active === false)}
          >
            {profile.is_active === false ? <Check size={14} /> : <Ban size={14} />}
          </IconAction>
        </div>
      </div>
    </div>
  );
}

function IconAction({
  label,
  title,
  tone,
  onClick,
  children,
}: {
  label: string;
  title: string;
  tone: 'green' | 'amber' | 'slate' | 'red' | 'blue';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const toneClass = {
    green: 'text-emerald-700 hover:bg-emerald-50',
    amber: 'text-amber-700 hover:bg-amber-50',
    slate: 'text-slate-500 hover:bg-white hover:text-slate-800',
    red: 'text-red-700 hover:bg-red-50',
    blue: 'text-blue-700 hover:bg-blue-50',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-xl transition ${toneClass}`}
    >
      {children}
    </button>
  );
}
