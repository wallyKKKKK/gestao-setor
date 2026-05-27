'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  addAuditLog,
  updateProfileAccountStatus,
  updateProfileActive,
  updateProfileName,
  updateProfileRole,
  updateProfileSector,
} from '@/lib/api';
import type { AccountStatus, Profile, UserRole } from '@/lib/types';

interface UseProfileActionsInput {
  user: SupabaseUser | null;
  onProfilesChanged: () => void;
  onRoleChanged: (role: UserRole) => void;
  onProfileSaved: () => void;
  setProfiles: Dispatch<SetStateAction<Profile[]>>;
}

export function useProfileActions({
  user,
  onProfilesChanged,
  onRoleChanged,
  onProfileSaved,
  setProfiles,
}: UseProfileActionsInput) {
  const [newName, setNewName] = useState('');

  const changeRole = useCallback(async (profileId: string, newRole: UserRole) => {
    try {
      await updateProfileRole(profileId, newRole);
      await addAuditLog({
        actorId: user?.id || profileId,
        actorName: user?.email || 'Usuário',
        action: 'profile_updated',
        entityType: 'profile',
        entityId: profileId,
        entityTitle: 'Cargo alterado',
        sector: 'Geral',
        details: `Novo cargo: ${newRole}`,
      }).catch((error) => console.error('Erro ao registrar auditoria:', error));

      setProfiles((prevProfiles) =>
        prevProfiles.map((profile) => (profile.id === profileId ? { ...profile, role: newRole } : profile)),
      );

      if (profileId === user?.id) {
        onRoleChanged(newRole);
      }

      alert('Cargo atualizado com sucesso!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao mudar cargo: ' + message);
    }
  }, [onRoleChanged, setProfiles, user]);

  const changeSector = useCallback(async (profileId: string, sector: string) => {
    await updateProfileSector(profileId, sector);
    await addAuditLog({
      actorId: user?.id || profileId,
      actorName: user?.email || 'Usuário',
      action: 'profile_updated',
      entityType: 'profile',
      entityId: profileId,
      entityTitle: 'Setor alterado',
      sector,
      details: `Novo setor: ${sector}`,
    }).catch((error) => console.error('Erro ao registrar auditoria:', error));
    onProfilesChanged();
  }, [onProfilesChanged, user]);

  const changeAccountStatus = useCallback(async (profileId: string, accountStatus: AccountStatus) => {
    await updateProfileAccountStatus(profileId, accountStatus);
    await addAuditLog({
      actorId: user?.id || profileId,
      actorName: user?.email || 'Usuário',
      action: 'profile_updated',
      entityType: 'profile',
      entityId: profileId,
      entityTitle: 'Status de conta alterado',
      sector: 'Geral',
      details: `Novo status: ${accountStatus}`,
    }).catch((error) => console.error('Erro ao registrar auditoria:', error));
    setProfiles((prevProfiles) =>
      prevProfiles.map((profile) =>
        profile.id === profileId ? { ...profile, account_status: accountStatus } : profile,
      ),
    );
    onProfilesChanged();
  }, [onProfilesChanged, setProfiles, user]);

  const changeActive = useCallback(async (profileId: string, isActive: boolean) => {
    await updateProfileActive(profileId, isActive);
    await addAuditLog({
      actorId: user?.id || profileId,
      actorName: user?.email || 'Usuário',
      action: 'profile_updated',
      entityType: 'profile',
      entityId: profileId,
      entityTitle: 'Acesso alterado',
      sector: 'Geral',
      details: isActive ? 'Conta ativada' : 'Conta bloqueada',
    }).catch((error) => console.error('Erro ao registrar auditoria:', error));
    setProfiles((prevProfiles) =>
      prevProfiles.map((profile) =>
        profile.id === profileId ? { ...profile, is_active: isActive } : profile,
      ),
    );
    onProfilesChanged();
  }, [onProfilesChanged, setProfiles, user]);

  const updateProfile = useCallback(async () => {
    if (!user?.id) return;

    try {
      await updateProfileName(user.id, newName);
      alert('Perfil atualizado com sucesso!');
      onProfileSaved();

      setProfiles((prevProfiles) =>
        prevProfiles.map((profile) => (profile.id === user.id ? { ...profile, full_name: newName } : profile)),
      );

      onProfilesChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro do Banco: ' + message);
      console.error('Erro completo:', error);
    }
  }, [newName, onProfileSaved, onProfilesChanged, setProfiles, user]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    window.location.reload();
  }, []);

  return {
    newName,
    setNewName,
    changeRole,
    changeSector,
    changeAccountStatus,
    changeActive,
    updateProfile,
    signOut,
  };
}
