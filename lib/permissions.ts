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

export function normalizePermissionSector(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isPerfumePurchasingSector(value: string) {
  const normalizedSector = normalizePermissionSector(value);
  return normalizedSector.includes('compras') && normalizedSector.includes('perfumaria');
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
  const isAdmin = role === 'admin';
  const isManager = role === 'gerente';
  const isPerfumePurchasing = isPerfumePurchasingSector(sector);

  return {
    canDeleteTasks: isAdmin || isManager,
    canDeleteMeetings: isAdmin || isManager,
    canManageUsers: isAdmin,
    canViewAudit: isAdmin,
    canImportTransport: isSupremeAdmin || isPerfumePurchasing,
    canExportTransport: isSupremeAdmin || isPerfumePurchasing,
    canBulkEditTransport: isSupremeAdmin || isManager || isPerfumePurchasing,
    canDeleteTransportEntries: isSupremeAdmin || isManager,
    canImportReallocationData: isSupremeAdmin || isPerfumePurchasing,
    canGenerateReallocationSuggestions: isSupremeAdmin || isPerfumePurchasing,
    canExportReallocation: isSupremeAdmin || isPerfumePurchasing,
  };
}
