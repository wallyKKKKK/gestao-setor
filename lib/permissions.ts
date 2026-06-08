import type { UserRole } from '@/lib/types';

export interface AppPermissions {
  canDeleteTasks: boolean;
  canDeleteMeetings: boolean;
  canManageUsers: boolean;
  canViewAudit: boolean;
  canImportTransport: boolean;
  canExportTransport: boolean;
  canBulkEditTransport: boolean;
  canDeleteTransportEntries: boolean;
  canImportReallocationData: boolean;
  canGenerateReallocationSuggestions: boolean;
  canExportReallocation: boolean;
}

export type PermissionRequirement =
  | 'admin'
  | 'managerOrAdmin'
  | 'supremeAdmin'
  | 'perfumePurchasingOrSupreme'
  | 'transportBulk'
  | 'managerOrSupreme';

const PERMISSION_REQUIREMENT_TEXT: Record<PermissionRequirement, string> = {
  admin: 'apenas administradores.',
  managerOrAdmin: 'administradores ou gerentes.',
  supremeAdmin: 'apenas o Admin Supremo.',
  perfumePurchasingOrSupreme: 'Admin Supremo ou setor Compras Perfumaria.',
  transportBulk: 'Admin Supremo, gerentes ou setor Compras Perfumaria.',
  managerOrSupreme: 'Admin Supremo ou gerentes.',
};

export function getPermissionDeniedMessage(action: string, requirement: PermissionRequirement) {
  return `Acao bloqueada: ${action}. Permissao necessaria: ${PERMISSION_REQUIREMENT_TEXT[requirement]}`;
}

function normalizePermissionSector(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function getAppPermissions({
  role,
  sector,
  isSupremeAdmin,
}: {
  role: UserRole;
  sector: string;
  isSupremeAdmin: boolean;
}): AppPermissions {
  const normalizedSector = normalizePermissionSector(sector);
  const isAdmin = role === 'admin';
  const isManager = role === 'gerente';
  const isPerfumePurchasing = normalizedSector.includes('compras') && normalizedSector.includes('perfumaria');

  return {
    canDeleteTasks: isAdmin || isManager,
    canDeleteMeetings: isAdmin || isManager,
    canManageUsers: isAdmin,
    canViewAudit: isAdmin,
    canImportTransport: isSupremeAdmin || isPerfumePurchasing,
    canExportTransport: isSupremeAdmin || isPerfumePurchasing,
    canBulkEditTransport: isSupremeAdmin || isManager || isPerfumePurchasing,
    canDeleteTransportEntries: isSupremeAdmin || isManager,
    canImportReallocationData: isSupremeAdmin,
    canGenerateReallocationSuggestions: isSupremeAdmin,
    canExportReallocation: isSupremeAdmin,
  };
}
