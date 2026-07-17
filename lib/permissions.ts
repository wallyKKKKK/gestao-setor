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

function repairMojibake(value: string) {
  return value
    .replace(/\u00c3\u2021/g, "\u00c7")
    .replace(/\u00c3\u00a7/g, "\u00e7")
    .replace(/\u00c3\u00a3/g, "\u00e3")
    .replace(/\u00c3\u00a1/g, "\u00e1")
    .replace(/\u00c3\u00a9/g, "\u00e9")
    .replace(/\u00c3\u00aa/g, "\u00ea")
    .replace(/\u00c3\u00ad/g, "\u00ed")
    .replace(/\u00c3\u00b3/g, "\u00f3")
    .replace(/\u00c3\u00b4/g, "\u00f4")
    .replace(/\u00c3\u00ba/g, "\u00fa");
}

export function normalizePermissionSector(value: string) {
  return repairMojibake(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isPricingSector(value: string) {
  const normalizedSector = normalizePermissionSector(value);
  const compactSector = normalizedSector.replace(/\s+/g, '');
  return compactSector === 'price' || compactSector.startsWith('precifica');
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
    canImportReallocationData: true,
    canGenerateReallocationSuggestions: true,
    canExportReallocation: true,
  };
}
