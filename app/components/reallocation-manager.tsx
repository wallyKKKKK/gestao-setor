'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Check, Clock, Database, Download, FileSpreadsheet, Filter, Loader2, Plus, RefreshCcw, RotateCcw, Search, Shuffle, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import { countReallocationProducts, fetchLatestReallocationStockSnapshot, fetchPricingBranches, fetchReallocationAttributeOptions, fetchReallocationProducts, fetchReallocationStockItems } from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-headers';
import { getPermissionDeniedMessage } from '@/lib/permissions';
import type { PricingBranch, ReallocationProduct, ReallocationStockItem, ReallocationStockSnapshot } from '@/lib/types';

function txtLine(origin: string, destination: string, erpCode: string, quantity: number) {
  return `${origin};${destination};${erpCode};${quantity}`;
}

function decimal(value: number | null | undefined, minimumFractionDigits = 2) {
  const parsed = Number(value || 0);
  return (Number.isFinite(parsed) ? parsed : 0).toLocaleString('pt-BR', {
    minimumFractionDigits,
    maximumFractionDigits: 2,
  });
}

function wholeNumber(value: number | null | undefined) {
  const parsed = Number(value || 0);
  return Math.round(Number.isFinite(parsed) ? parsed : 0).toLocaleString('pt-BR');
}

function csvValue(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadTimestamp(date = new Date()) {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    pad(date.getMilliseconds(), 3),
  ].join('');
}

function loadReallocationAuditLog() {
  if (typeof window === 'undefined') return [];

  const stored = window.localStorage.getItem(REALLOCATION_AUDIT_STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as ReallocationAuditLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    window.localStorage.removeItem(REALLOCATION_AUDIT_STORAGE_KEY);
    return [];
  }
}

function getNetworkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    return 'Não foi possível conectar ao servidor agora. Tente atualizar novamente em alguns segundos.';
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

interface QuickFilterItem {
  id: string;
  columns: string[];
  searchText: string;
  source?: ReallocationProduct;
}

type SuggestionProfile = 'safe' | 'balanced' | 'strong';
const DEFAULT_SUGGESTION_PROFILE: SuggestionProfile = 'balanced';
const STOCK_CURVES = ['A', 'B', 'C', 'D', 'E'] as const;

const SUGGESTION_PROFILES: Record<SuggestionProfile, {
  label: string;
  description: string;
  originMinimumDays: number;
  destinationTargetDays: number;
  maxRoutePriority: number;
}> = {
  safe: {
    label: 'Conservador',
    description: 'Poucas transferencias, preserva mais estoque na origem.',
    originMinimumDays: 30,
    destinationTargetDays: 30,
    maxRoutePriority: 2,
  },
  balanced: {
    label: 'Equilibrado',
    description: 'Bom padrao para rotina: reduz excesso sem forcar tanto a logistica.',
    originMinimumDays: 20,
    destinationTargetDays: 30,
    maxRoutePriority: 6,
  },
  strong: {
    label: 'Agressivo',
    description: 'Gera mais sugestões e aceita rotas mais abertas.',
    originMinimumDays: 15,
    destinationTargetDays: 35,
    maxRoutePriority: 10,
  },
};

interface TransferSuggestion {
  id: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  erpCode: string;
  ean: string;
  description: string;
  quantity: number;
  maxQuantity: number;
  originStock: number;
  originConfirmedStock: number;
  originMonthlyAvgSales: number;
  originCurve: string;
  originConfirmedPurchase: number;
  originConfirmedTransfer: number;
  destinationStock: number;
  destinationConfirmedStock: number;
  destinationMonthlyAvgSales: number;
  destinationCurve: string;
  destinationConfirmedPurchase: number;
  destinationConfirmedTransfer: number;
  originDailySales: number;
  destinationDailySales: number;
  originStockDays: number;
  destinationStockDays: number;
  destinationNeed: number;
  routePriority: number;
}

interface SuggestionDiagnostic {
  engine: 'python' | 'typescript' | 'fallback';
  stockRows: number;
  productGroups: number;
  eligibleOrigins: number;
  eligibleDestinations: number;
  missingErpCode: number;
  blockedDifferentUf: number;
  blockedRoute: number;
  attributeProducts: number;
  filteredProducts: number;
  branchLogistics: number;
  suggestions: number;
}

interface ExportValidationIssue {
  id: string;
  title: string;
  detail: string;
  severity: 'block' | 'warn';
}

interface ReallocationAuditLog {
  id: string;
  at: string;
  action: string;
  detail: string;
  count?: number;
  units?: number;
}

const REALLOCATION_AUDIT_STORAGE_KEY = 'reallocation-audit-v1';
const REALLOCATION_PREFERENCES_STORAGE_KEY = 'reallocation-preferences-v1';

const SUGGESTION_COLUMNS = [
  { key: 'selection', label: '', align: 'center', width: 52 },
  { key: 'description', label: 'Produto', align: 'left', width: 280 },
  { key: 'ean', label: 'EAN', align: 'left', width: 145 },
  { key: 'originName', label: 'Apelido Un. Neg. Orig.', align: 'left', width: 190 },
  { key: 'originStock', label: 'Estoque Orig.', align: 'right', width: 130 },
  { key: 'originConfirmedStock', label: 'Estoque Conf. Orig.', align: 'right', width: 150 },
  { key: 'originCurve', label: 'Curva Orig.', align: 'center', width: 110 },
  { key: 'originMonthlyAvgSales', label: 'Media Venda Mensal Orig.', align: 'right', width: 190 },
  { key: 'originStockDays', label: 'Dias Orig.', align: 'right', width: 120 },
  { key: 'adjustedOriginDays', label: 'Dias Orig. Apos', align: 'right', width: 145 },
  { key: 'quantity', label: 'Transferir', align: 'right', width: 130, highlight: 'transfer' },
  { key: 'destinationName', label: 'Apelido Un. Neg. Dest.', align: 'left', width: 190 },
  { key: 'destinationMonthlyAvgSales', label: 'Media Venda Mensal Dest.', align: 'right', width: 190 },
  { key: 'destinationConfirmedStock', label: 'Estoque Conf. Dest.', align: 'right', width: 150 },
  { key: 'destinationCurve', label: 'Curva Dest.', align: 'center', width: 110 },
  { key: 'destinationStock', label: 'Estoque Dest.', align: 'right', width: 130 },
  { key: 'destinationStockDays', label: 'Dias Dest.', align: 'right', width: 120 },
  { key: 'adjustedDestinationDays', label: 'Dias Dest. Apos', align: 'right', width: 145 },
  { key: 'originConfirmedPurchase', label: 'Compra Conf. Orig.', align: 'right', width: 155 },
  { key: 'originConfirmedTransfer', label: 'Transf. Conf. Orig.', align: 'right', width: 155 },
  { key: 'erpCode', label: 'Cod. ERP', align: 'left', width: 120 },
  { key: 'routePriority', label: 'Rota', align: 'center', width: 130 },
  { key: 'actions', label: 'Ações', align: 'center', width: 95 },
] as const;

type SuggestionColumnKey = typeof SUGGESTION_COLUMNS[number]['key'];
type SuggestionColumn = typeof SUGGESTION_COLUMNS[number];
type SuggestionView = 'draft' | 'confirmed';
type SuggestionSort = {
  key: SuggestionColumnKey;
  direction: 'asc' | 'desc';
} | null;

interface ReallocationPreferences {
  productFilters: QuickFilterItem[];
  originFilters: QuickFilterItem[];
  destinationFilters: QuickFilterItem[];
  classificationFilters: QuickFilterItem[];
  manufacturerFilters: QuickFilterItem[];
  suggestionProfile: SuggestionProfile;
  showAdvancedRules: boolean;
  originMinimumDays: number;
  destinationTargetDays: number;
  maxRoutePriority: number;
  originCurvePriority: string[];
  destinationCurvePriority: string[];
  showOnlyProblemSuggestions: boolean;
  suggestionTableSearch: string;
  suggestionColumnOrder: SuggestionColumnKey[];
  suggestionColumnWidths: Record<SuggestionColumnKey, number>;
  suggestionSort: SuggestionSort;
}

function isQuickFilterItem(value: unknown): value is QuickFilterItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<QuickFilterItem>;
  return typeof item.id === 'string'
    && Array.isArray(item.columns)
    && item.columns.every((column) => typeof column === 'string')
    && typeof item.searchText === 'string';
}

function readQuickFilterItems(value: unknown) {
  return Array.isArray(value) ? value.filter(isQuickFilterItem) : [];
}

function readCurveList(value: unknown) {
  return Array.isArray(value) ? value.filter((curve): curve is string => STOCK_CURVES.includes(curve as typeof STOCK_CURVES[number])) : [];
}

function clampPreferenceNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(9999, Math.round(parsed)));
}

function defaultSuggestionColumnWidths() {
  return Object.fromEntries(SUGGESTION_COLUMNS.map((column) => [column.key, column.width])) as Record<SuggestionColumnKey, number>;
}

function defaultReallocationPreferences(): ReallocationPreferences {
  const preset = SUGGESTION_PROFILES[DEFAULT_SUGGESTION_PROFILE];

  return {
    productFilters: [],
    originFilters: [],
    destinationFilters: [],
    classificationFilters: [],
    manufacturerFilters: [],
    suggestionProfile: DEFAULT_SUGGESTION_PROFILE,
    showAdvancedRules: false,
    originMinimumDays: preset.originMinimumDays,
    destinationTargetDays: preset.destinationTargetDays,
    maxRoutePriority: preset.maxRoutePriority,
    originCurvePriority: [],
    destinationCurvePriority: [],
    showOnlyProblemSuggestions: false,
    suggestionTableSearch: '',
    suggestionColumnOrder: SUGGESTION_COLUMNS.map((column) => column.key),
    suggestionColumnWidths: defaultSuggestionColumnWidths(),
    suggestionSort: null,
  };
}

function loadReallocationPreferences() {
  if (typeof window === 'undefined') return defaultReallocationPreferences();

  try {
    const stored = window.localStorage.getItem(REALLOCATION_PREFERENCES_STORAGE_KEY);
    if (!stored) return defaultReallocationPreferences();
    const parsed = JSON.parse(stored) as Partial<ReallocationPreferences>;
    const defaults = defaultReallocationPreferences();
    const validColumnKeys = new Set(SUGGESTION_COLUMNS.map((column) => column.key));
    const columnOrder = Array.isArray(parsed.suggestionColumnOrder)
      ? parsed.suggestionColumnOrder.filter((key): key is SuggestionColumnKey => validColumnKeys.has(key as SuggestionColumnKey))
      : defaults.suggestionColumnOrder;
    const columnWidths = { ...defaults.suggestionColumnWidths };

    if (parsed.suggestionColumnWidths && typeof parsed.suggestionColumnWidths === 'object') {
      for (const column of SUGGESTION_COLUMNS) {
        const width = Number((parsed.suggestionColumnWidths as Partial<Record<SuggestionColumnKey, number>>)[column.key]);
        if (Number.isFinite(width)) columnWidths[column.key] = Math.max(80, Math.min(520, width));
      }
    }

    const profile = parsed.suggestionProfile && parsed.suggestionProfile in SUGGESTION_PROFILES
      ? parsed.suggestionProfile
      : DEFAULT_SUGGESTION_PROFILE;
    const sortKey = parsed.suggestionSort?.key;
    const suggestionSort = sortKey && validColumnKeys.has(sortKey) && (parsed.suggestionSort?.direction === 'asc' || parsed.suggestionSort?.direction === 'desc')
      ? parsed.suggestionSort
      : null;

    return {
      productFilters: readQuickFilterItems(parsed.productFilters),
      originFilters: readQuickFilterItems(parsed.originFilters),
      destinationFilters: readQuickFilterItems(parsed.destinationFilters),
      classificationFilters: readQuickFilterItems(parsed.classificationFilters),
      manufacturerFilters: readQuickFilterItems(parsed.manufacturerFilters),
      suggestionProfile: profile,
      showAdvancedRules: Boolean(parsed.showAdvancedRules),
      originMinimumDays: clampPreferenceNumber(parsed.originMinimumDays, defaults.originMinimumDays),
      destinationTargetDays: clampPreferenceNumber(parsed.destinationTargetDays, defaults.destinationTargetDays),
      maxRoutePriority: clampPreferenceNumber(parsed.maxRoutePriority, defaults.maxRoutePriority),
      originCurvePriority: readCurveList(parsed.originCurvePriority),
      destinationCurvePriority: readCurveList(parsed.destinationCurvePriority),
      showOnlyProblemSuggestions: Boolean(parsed.showOnlyProblemSuggestions),
      suggestionTableSearch: typeof parsed.suggestionTableSearch === 'string' ? parsed.suggestionTableSearch : '',
      suggestionColumnOrder: columnOrder.length > 0 ? columnOrder : defaults.suggestionColumnOrder,
      suggestionColumnWidths: columnWidths,
      suggestionSort,
    };
  } catch {
    window.localStorage.removeItem(REALLOCATION_PREFERENCES_STORAGE_KEY);
    return defaultReallocationPreferences();
  }
}

function getSuggestionSortValue(
  suggestion: TransferSuggestion,
  key: SuggestionColumnKey,
) {
  switch (key) {
    case 'adjustedOriginDays':
      return getAdjustedOriginDays(suggestion);
    case 'adjustedDestinationDays':
      return getAdjustedDestinationDays(suggestion);
    case 'selection':
    case 'actions':
      return '';
    default:
      return suggestion[key as keyof TransferSuggestion] ?? '';
  }
}

function getAdjustedOriginDays(suggestion: TransferSuggestion, allocatedQuantity = Number(suggestion.quantity || 0)) {
  const dailySales = Number(suggestion.originDailySales || 0);
  if (dailySales <= 0) return Number(suggestion.originStockDays || 0);
  const currentCoverageStock = Number(suggestion.originStockDays || 0) * dailySales;
  return Math.max(0, (currentCoverageStock - allocatedQuantity) / dailySales);
}

function getAdjustedDestinationDays(suggestion: TransferSuggestion, allocatedQuantity = Number(suggestion.quantity || 0)) {
  const dailySales = Number(suggestion.destinationDailySales || 0);
  if (dailySales <= 0) return Number(suggestion.destinationStockDays || 0);
  const currentCoverageStock = Number(suggestion.destinationStockDays || 0) * dailySales;
  return (currentCoverageStock + allocatedQuantity) / dailySales;
}

function suggestionIdentityKey(suggestion: TransferSuggestion) {
  return [
    suggestion.ean,
    suggestion.erpCode,
    suggestion.originCode,
    suggestion.destinationCode,
  ].map((part) => String(part || '').trim().toUpperCase()).join('|');
}

function clampSuggestionQuantity(
  suggestions: TransferSuggestion[],
  targetSuggestion: TransferSuggestion,
  requestedQuantity: number,
) {
  const originStockLimit = Math.max(
    0,
    Math.floor(Number(targetSuggestion.originStock || 0)),
  );
  const targetKey = `${targetSuggestion.ean}:${targetSuggestion.originCode}`;
  const allocatedElsewhere = suggestions.reduce((sum, suggestion) => {
    if (suggestion.id === targetSuggestion.id) return sum;
    if (`${suggestion.ean}:${suggestion.originCode}` !== targetKey) return sum;
    return sum + Math.max(0, Math.floor(Number(suggestion.quantity || 0)));
  }, 0);
  const availableForRow = Math.max(0, originStockLimit - allocatedElsewhere);
  return Math.max(0, Math.min(availableForRow, Math.floor(Number(requestedQuantity) || 0)));
}

function getSuggestionExportIssues(
  suggestions: TransferSuggestion[],
  overAllocated: Array<{ allocated: number; stock: number; originCode: string; ean: string; originName: string; description: string }>,
  maxRoutePriority: number,
) {
  const issues: ExportValidationIssue[] = [];
  const missingErp = suggestions.filter((suggestion) => !suggestion.erpCode && suggestion.quantity > 0);
  const invalidQuantity = suggestions.filter((suggestion) => suggestion.quantity <= 0 || !Number.isFinite(Number(suggestion.quantity)));
  const manualChanges = suggestions.filter((suggestion) => suggestion.quantity !== suggestion.maxQuantity);
  const routeLimit = suggestions.filter((suggestion) => suggestion.routePriority >= maxRoutePriority && suggestion.quantity > 0);

  overAllocated.slice(0, 3).forEach((allocation, index) => {
    issues.push({
      id: `over-allocated-${index}`,
      title: 'Origem excedida',
      detail: `${allocation.originName}: ${wholeNumber(allocation.allocated)} un. de ${allocation.description}, estoque ${wholeNumber(allocation.stock)}.`,
      severity: 'block',
    });
  });

  if (missingErp.length > 0) {
    issues.push({
      id: 'missing-erp',
      title: 'Produtos sem ERP',
      detail: `${missingErp.length} linha${missingErp.length === 1 ? '' : 's'} com quantidade não entram no TXT.`,
      severity: 'block',
    });
  }

  if (invalidQuantity.length > 0 && suggestions.some((suggestion) => suggestion.quantity > 0)) {
    issues.push({
      id: 'invalid-quantity',
      title: 'Quantidade zerada',
      detail: `${invalidQuantity.length} linha${invalidQuantity.length === 1 ? '' : 's'} está${invalidQuantity.length === 1 ? '' : 'o'} sem quantidade para exportar.`,
      severity: 'warn',
    });
  }

  if (manualChanges.length > 0) {
    issues.push({
      id: 'manual-changes',
      title: 'Ajustes manuais',
      detail: `${manualChanges.length} linha${manualChanges.length === 1 ? '' : 's'} com quantidade alterada manualmente.`,
      severity: 'warn',
    });
  }

  if (routeLimit.length > 0) {
    issues.push({
      id: 'route-limit',
      title: 'Rotas no limite',
      detail: `${routeLimit.length} linha${routeLimit.length === 1 ? '' : 's'} usando prioridade máxima do perfil.`,
      severity: 'warn',
    });
  }

  return issues;
}

interface ReallocationManagerProps {
  canImportData?: boolean;
  canGenerateSuggestions?: boolean;
  canExport?: boolean;
  onPermissionBlocked?: (action: string, details: string) => void;
}

export function ReallocationManager({
  canImportData = true,
  canGenerateSuggestions = true,
  canExport = true,
  onPermissionBlocked,
}: ReallocationManagerProps) {
  const initialPreferences = useMemo(() => loadReallocationPreferences(), []);
  const [products, setProducts] = useState<ReallocationProduct[]>([]);
  const [branches, setBranches] = useState<PricingBranch[]>([]);
  const searchTerm = '';
  const [productFilters, setProductFilters] = useState<QuickFilterItem[]>(initialPreferences.productFilters);
  const [originFilters, setOriginFilters] = useState<QuickFilterItem[]>(initialPreferences.originFilters);
  const [destinationFilters, setDestinationFilters] = useState<QuickFilterItem[]>(initialPreferences.destinationFilters);
  const [classificationFilters, setClassificationFilters] = useState<QuickFilterItem[]>(initialPreferences.classificationFilters);
  const [manufacturerFilters, setManufacturerFilters] = useState<QuickFilterItem[]>(initialPreferences.manufacturerFilters);
  const [totalProducts, setTotalProducts] = useState(0);
  const [stockSnapshot, setStockSnapshot] = useState<ReallocationStockSnapshot | null>(null);
  const [stockItems, setStockItems] = useState<ReallocationStockItem[]>([]);
  const [transferSuggestions, setTransferSuggestions] = useState<TransferSuggestion[]>([]);
  const [confirmedSuggestions, setConfirmedSuggestions] = useState<TransferSuggestion[]>([]);
  const [suggestionView, setSuggestionView] = useState<SuggestionView>('draft');
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [suggestionMessage, setSuggestionMessage] = useState('');
  const [suggestionDiagnostic, setSuggestionDiagnostic] = useState<SuggestionDiagnostic | null>(null);
  const [appliedSuggestionSignature, setAppliedSuggestionSignature] = useState('');
  const [suggestionProfile, setSuggestionProfile] = useState<SuggestionProfile>(initialPreferences.suggestionProfile);
  const [showAdvancedRules, setShowAdvancedRules] = useState(initialPreferences.showAdvancedRules);
  const [originMinimumDays, setOriginMinimumDays] = useState(initialPreferences.originMinimumDays);
  const [destinationTargetDays, setDestinationTargetDays] = useState(initialPreferences.destinationTargetDays);
  const [maxRoutePriority, setMaxRoutePriority] = useState(initialPreferences.maxRoutePriority);
  const [originCurvePriority, setOriginCurvePriority] = useState<string[]>(initialPreferences.originCurvePriority);
  const [destinationCurvePriority, setDestinationCurvePriority] = useState<string[]>(initialPreferences.destinationCurvePriority);
  const [stockLoading, setStockLoading] = useState(true);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stockImporting, setStockImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showOnlyProblemSuggestions, setShowOnlyProblemSuggestions] = useState(initialPreferences.showOnlyProblemSuggestions);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [showRecalculateConfirm, setShowRecalculateConfirm] = useState(false);
  const [showReallocationHistory, setShowReallocationHistory] = useState(false);
  const [showDataActions, setShowDataActions] = useState(false);
  const [showTopPanel, setShowTopPanel] = useState(true);
  const [reallocationAuditLog, setReallocationAuditLog] = useState<ReallocationAuditLog[]>(loadReallocationAuditLog);
  const [suggestionTableSearch, setSuggestionTableSearch] = useState(initialPreferences.suggestionTableSearch);
  const [suggestionColumnOrder, setSuggestionColumnOrder] = useState<SuggestionColumnKey[]>(initialPreferences.suggestionColumnOrder);
  const [suggestionColumnWidths, setSuggestionColumnWidths] = useState<Record<SuggestionColumnKey, number>>(initialPreferences.suggestionColumnWidths);
  const [suggestionSort, setSuggestionSort] = useState<SuggestionSort>(initialPreferences.suggestionSort);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stockInputRef = useRef<HTMLInputElement>(null);
  const resizingSuggestionColumnRef = useRef<{ key: SuggestionColumnKey; startX: number; startWidth: number } | null>(null);
  const draggedSuggestionColumnRef = useRef<SuggestionColumnKey | null>(null);

  const loadProducts = useCallback(async (term = searchTerm) => {
    try {
      const manufacturers = manufacturerFilters.map((item) => item.columns[0]).filter(Boolean);
      const classifications = classificationFilters.map((item) => item.columns[0]).filter(Boolean);
      const shouldListProducts = term.trim() || manufacturers.length > 0 || classifications.length > 0;
      const [rows, total] = await Promise.all([
        shouldListProducts
          ? fetchReallocationProducts({
            searchTerm: term,
            manufacturers,
            classifications,
            limit: 120,
          })
          : Promise.resolve([]),
        countReallocationProducts().catch(() => 0),
      ]);
      setProducts(rows);
      setTotalProducts(total);
      setErrorMessage('');
    } catch {
      setProducts([]);
      setTotalProducts(0);
      setErrorMessage('Tabela de remanejamento não encontrada. Rode o SQL de produtos do remanejamento no Supabase.');
    } finally {
    }
  }, [classificationFilters, manufacturerFilters, searchTerm]);

  const loadStockSnapshot = useCallback(async (term = '', includeItems = false) => {
    setStockLoading(true);
    try {
      const snapshot = await fetchLatestReallocationStockSnapshot();
      setStockSnapshot(snapshot);

      if (!snapshot) {
        setStockItems([]);
        return;
      }

      if (includeItems) {
        const rows = await fetchReallocationStockItems(snapshot.id, term, 5000);
        setStockItems(rows);
      }
    } catch {
      setStockSnapshot(null);
      setStockItems([]);
    } finally {
      setStockLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadProducts('');
    });
  }, [loadProducts]);

  useEffect(() => {
    fetchPricingBranches()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadStockSnapshot('', true);
    });
  }, [loadStockSnapshot]);

  useEffect(() => {
    window.localStorage.setItem(REALLOCATION_AUDIT_STORAGE_KEY, JSON.stringify(reallocationAuditLog));
  }, [reallocationAuditLog]);

  useEffect(() => {
    const preferences: ReallocationPreferences = {
      productFilters,
      originFilters,
      destinationFilters,
      classificationFilters,
      manufacturerFilters,
      suggestionProfile,
      showAdvancedRules,
      originMinimumDays,
      destinationTargetDays,
      maxRoutePriority,
      originCurvePriority,
      destinationCurvePriority,
      showOnlyProblemSuggestions,
      suggestionTableSearch,
      suggestionColumnOrder,
      suggestionColumnWidths,
      suggestionSort,
    };

    window.localStorage.setItem(REALLOCATION_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  }, [
    classificationFilters,
    destinationCurvePriority,
    destinationFilters,
    destinationTargetDays,
    manufacturerFilters,
    maxRoutePriority,
    originCurvePriority,
    originFilters,
    originMinimumDays,
    productFilters,
    showAdvancedRules,
    showOnlyProblemSuggestions,
    suggestionColumnOrder,
    suggestionColumnWidths,
    suggestionProfile,
    suggestionSort,
    suggestionTableSearch,
  ]);

  const addReallocationAuditLog = useCallback((event: Omit<ReallocationAuditLog, 'id' | 'at'>) => {
    setReallocationAuditLog((current) => [{
      id: `reallocation-audit|${Date.now()}|${Math.random().toString(36).slice(2)}`,
      at: new Date().toISOString(),
      ...event,
    }, ...current].slice(0, 80));
  }, []);

  const getBlockedMessage = useCallback((action: string, requirement: Parameters<typeof getPermissionDeniedMessage>[1]) => {
    const message = getPermissionDeniedMessage(action, requirement);
    onPermissionBlocked?.(action, message);
    addReallocationAuditLog({
      action: 'Acao bloqueada',
      detail: message,
      count: 1,
    });
    return message;
  }, [addReallocationAuditLog, onPermissionBlocked]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadProducts(searchTerm);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [classificationFilters, loadProducts, manufacturerFilters, searchTerm]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (showAdvancedRules) {
        setShowAdvancedRules(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showAdvancedRules]);

  useEffect(() => {
    const handleUnhandledFetchError = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (!(reason instanceof TypeError) || !reason.message.toLowerCase().includes('fetch')) return;
      event.preventDefault();
      setSuggestionMessage('Não foi possível conectar ao servidor agora. Tente atualizar novamente em alguns segundos.');
      setGeneratingSuggestions(false);
    };

    window.addEventListener('unhandledrejection', handleUnhandledFetchError);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledFetchError);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setTransferSuggestions([]);
      setConfirmedSuggestions([]);
      setSelectedSuggestionIds([]);
      setSuggestionView('draft');
      setSuggestionMessage('');
      setSuggestionDiagnostic(null);
      setAppliedSuggestionSignature('');
    });
  }, [stockSnapshot?.id]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizing = resizingSuggestionColumnRef.current;
      if (!resizing) return;

      const nextWidth = Math.max(72, resizing.startWidth + event.clientX - resizing.startX);
      setSuggestionColumnWidths((current) => ({ ...current, [resizing.key]: nextWidth }));
    };

    const handleMouseUp = () => {
      resizingSuggestionColumnRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const productOptions = useMemo<QuickFilterItem[]>(() => products.map((product) => ({
    id: `${product.erp_code}:${product.ean}`,
    columns: [product.description, product.erp_code, product.ean || '-', product.manufacturer || '-', product.classification || '-'],
    searchText: `${product.description} ${product.erp_code} ${product.ean} ${product.manufacturer} ${product.classification}`.toLowerCase(),
    source: product,
  })), [products]);
  const branchOptions = useMemo<QuickFilterItem[]>(() => branches.map((branch) => ({
    id: branch.code,
    columns: [branch.code, branch.name, branch.city || '-'],
    searchText: `${branch.code} ${branch.name} ${branch.city} ${branch.cnpj}`.toLowerCase(),
  })), [branches]);
  const activeSuggestionRows = suggestionView === 'confirmed' ? confirmedSuggestions : transferSuggestions;
  const selectedSuggestionIdSet = useMemo(() => new Set(selectedSuggestionIds), [selectedSuggestionIds]);
  const filteredProducts = useMemo(() => {
    const baseProducts = productFilters.length > 0
      ? productFilters
        .map((item) => item.source)
        .filter((product): product is ReallocationProduct => Boolean(product))
      : products;

    return baseProducts.filter((product) => {
      const text = `${product.description} ${product.erp_code} ${product.ean} ${product.manufacturer} ${product.classification}`.toLowerCase();
      if (classificationFilters.length > 0 && !classificationFilters.some((item) => text.includes(item.searchText))) return false;
      if (manufacturerFilters.length > 0 && !manufacturerFilters.some((item) => text.includes(item.searchText))) return false;
      return true;
    });
  }, [classificationFilters, manufacturerFilters, productFilters, products]);
  const suggestionExportStats = useMemo(() => {
    const exportable = activeSuggestionRows.filter((suggestion) => suggestion.erpCode && suggestion.quantity > 0);
    const missingErpCode = activeSuggestionRows.filter((suggestion) => !suggestion.erpCode && suggestion.quantity > 0);
    return {
      exportableLines: exportable.length,
      exportableUnits: exportable.reduce((sum, suggestion) => sum + suggestion.quantity, 0),
      missingErpCodeLines: missingErpCode.length,
    };
  }, [activeSuggestionRows]);
  const confirmedExportStats = useMemo(() => {
    const exportable = confirmedSuggestions.filter((suggestion) => suggestion.erpCode && suggestion.quantity > 0);
    const missingErpCode = confirmedSuggestions.filter((suggestion) => !suggestion.erpCode && suggestion.quantity > 0);
    return {
      exportableLines: exportable.length,
      exportableUnits: exportable.reduce((sum, suggestion) => sum + suggestion.quantity, 0),
      missingErpCodeLines: missingErpCode.length,
    };
  }, [confirmedSuggestions]);
  const originAllocationByProduct = useMemo(() => {
    const allocations = new Map<string, { allocated: number; stock: number; originCode: string; ean: string; originName: string; description: string; destinationCodes: Set<string> }>();

    for (const suggestion of activeSuggestionRows) {
      const key = `${suggestion.ean}:${suggestion.originCode}`;
      const originStockLimit = Math.max(0, Number(suggestion.originStock || 0));
      const current = allocations.get(key) || {
        allocated: 0,
        stock: originStockLimit,
        originCode: suggestion.originCode,
        ean: suggestion.ean,
        originName: suggestion.originName,
        description: suggestion.description,
        destinationCodes: new Set<string>(),
      };

      current.allocated += Number(suggestion.quantity || 0);
      current.stock = Math.max(current.stock, originStockLimit);
      current.destinationCodes.add(suggestion.destinationCode);
      allocations.set(key, current);
    }

    return allocations;
  }, [activeSuggestionRows]);
  const destinationAllocationByProduct = useMemo(() => {
    const allocations = new Map<string, { allocated: number; destinationCode: string; ean: string; destinationName: string; description: string; originCodes: Set<string> }>();

    for (const suggestion of activeSuggestionRows) {
      const key = `${suggestion.ean}:${suggestion.destinationCode}`;
      const current = allocations.get(key) || {
        allocated: 0,
        destinationCode: suggestion.destinationCode,
        ean: suggestion.ean,
        destinationName: suggestion.destinationName,
        description: suggestion.description,
        originCodes: new Set<string>(),
      };

      current.allocated += Number(suggestion.quantity || 0);
      current.originCodes.add(suggestion.originCode);
      allocations.set(key, current);
    }

    return allocations;
  }, [activeSuggestionRows]);
  const confirmedOriginAllocationByProduct = useMemo(() => {
    const allocations = new Map<string, { allocated: number; stock: number; originCode: string; ean: string; originName: string; description: string; destinationCodes: Set<string> }>();

    for (const suggestion of confirmedSuggestions) {
      const key = `${suggestion.ean}:${suggestion.originCode}`;
      const originStockLimit = Math.max(0, Number(suggestion.originStock || 0));
      const current = allocations.get(key) || {
        allocated: 0,
        stock: originStockLimit,
        originCode: suggestion.originCode,
        ean: suggestion.ean,
        originName: suggestion.originName,
        description: suggestion.description,
        destinationCodes: new Set<string>(),
      };

      current.allocated += Number(suggestion.quantity || 0);
      current.stock = Math.max(current.stock, originStockLimit);
      current.destinationCodes.add(suggestion.destinationCode);
      allocations.set(key, current);
    }

    return allocations;
  }, [confirmedSuggestions]);
  const overAllocatedOrigins = useMemo(() => {
    return Array.from(originAllocationByProduct.values()).filter((allocation) => allocation.allocated > allocation.stock);
  }, [originAllocationByProduct]);
  const confirmedOverAllocatedOrigins = useMemo(() => {
    return Array.from(confirmedOriginAllocationByProduct.values()).filter((allocation) => allocation.allocated > allocation.stock);
  }, [confirmedOriginAllocationByProduct]);
  const confirmedExportIssues = useMemo(() => getSuggestionExportIssues(confirmedSuggestions, confirmedOverAllocatedOrigins, maxRoutePriority), [confirmedOverAllocatedOrigins, confirmedSuggestions, maxRoutePriority]);
  const confirmedBlockingExportIssues = useMemo(() => confirmedExportIssues.filter((issue) => issue.severity === 'block'), [confirmedExportIssues]);
  const problemSuggestionIds = useMemo(() => {
    const ids = new Set<string>();
    const overAllocatedKeys = new Set(overAllocatedOrigins.map((allocation) => `${allocation.ean}:${allocation.originCode}`));

    activeSuggestionRows.forEach((suggestion) => {
      const overKey = `${suggestion.ean}:${suggestion.originCode}`;
      if (!suggestion.erpCode && suggestion.quantity > 0) ids.add(suggestion.id);
      if (suggestion.quantity <= 0 || !Number.isFinite(Number(suggestion.quantity))) ids.add(suggestion.id);
      if (suggestion.quantity !== suggestion.maxQuantity) ids.add(suggestion.id);
      if (suggestion.routePriority >= maxRoutePriority && suggestion.quantity > 0) ids.add(suggestion.id);
      if (overAllocatedKeys.has(overKey)) ids.add(suggestion.id);
    });

    return ids;
  }, [activeSuggestionRows, maxRoutePriority, overAllocatedOrigins]);
  const originSummary = useMemo(() => {
    const map = new Map<string, { originName: string; rows: number; units: number; stock: number; exceeded: number }>();

    activeSuggestionRows.forEach((suggestion) => {
      const current = map.get(suggestion.originCode) || {
        originName: suggestion.originName,
        rows: 0,
        units: 0,
        stock: 0,
        exceeded: 0,
      };
      current.rows += 1;
      current.units += Number(suggestion.quantity || 0);
      current.stock += Number(suggestion.originStock || 0);
      map.set(suggestion.originCode, current);
    });

    overAllocatedOrigins.forEach((allocation) => {
      const item = Array.from(map.values()).find((origin) => origin.originName === allocation.originName);
      if (item) item.exceeded += Math.max(0, allocation.allocated - allocation.stock);
    });

    return Array.from(map.values())
      .sort((left, right) => right.units - left.units)
      .slice(0, 6);
  }, [activeSuggestionRows, overAllocatedOrigins]);
  const activeSuggestionFilterCount = productFilters.length + originFilters.length + destinationFilters.length + classificationFilters.length + manufacturerFilters.length + originCurvePriority.length + destinationCurvePriority.length;
  const suggestionSettingsSignature = useMemo(() => JSON.stringify({
    snapshotId: stockSnapshot?.id || '',
    products: productFilters.map((item) => item.id),
    origins: originFilters.map((item) => item.id),
    destinations: destinationFilters.map((item) => item.id),
    classifications: classificationFilters.map((item) => item.id),
    manufacturers: manufacturerFilters.map((item) => item.id),
    originCurves: originCurvePriority,
    destinationCurves: destinationCurvePriority,
    originMinimumDays,
    destinationTargetDays,
    maxRoutePriority,
  }), [
    classificationFilters,
    destinationCurvePriority,
    destinationFilters,
    destinationTargetDays,
    manufacturerFilters,
    maxRoutePriority,
    originCurvePriority,
    originFilters,
    originMinimumDays,
    productFilters,
    stockSnapshot?.id,
  ]);
  const hasPendingSuggestionSettings = Boolean(appliedSuggestionSignature && suggestionSettingsSignature !== appliedSuggestionSignature);

  const branchLogisticsByCode = useMemo(() => new Map(branches.map((branch) => [
    branch.code.padStart(2, '0'),
    {
      city: branch.city,
      group: (branch.logistics_group || '').trim().toUpperCase(),
      uf: (branch.uf || '').trim().toUpperCase(),
    },
  ])), [branches]);
  const orderedSuggestionColumns = useMemo(() => {
    const byKey = new Map(SUGGESTION_COLUMNS.map((column) => [column.key, column]));
    const selectionColumn = byKey.get('selection');
    const currentColumns = suggestionColumnOrder
      .map((key) => byKey.get(key))
      .filter((column): column is SuggestionColumn => column !== undefined && column.key !== 'selection');
    const currentKeys = new Set(currentColumns.map((column) => column.key));
    const newColumns = SUGGESTION_COLUMNS.filter((column) => column.key !== 'selection' && !currentKeys.has(column.key));
    return selectionColumn ? [selectionColumn, ...currentColumns, ...newColumns] : [...currentColumns, ...newColumns];
  }, [suggestionColumnOrder]);
  const suggestionTableWidth = useMemo(() => orderedSuggestionColumns.reduce((sum, column) => sum + (suggestionColumnWidths[column.key] || column.width), 0), [orderedSuggestionColumns, suggestionColumnWidths]);

  const applySuggestionProfile = (profile: SuggestionProfile) => {
    const preset = SUGGESTION_PROFILES[profile];
    setSuggestionProfile(profile);
    setOriginMinimumDays(preset.originMinimumDays);
    setDestinationTargetDays(preset.destinationTargetDays);
    setMaxRoutePriority(preset.maxRoutePriority);
  };

  const importCatalog = async (file: File) => {
    if (!canImportData) {
      alert(getBlockedMessage('importar cadastro do remanejamento inteligente', 'perfumePurchasingOrSupreme'));
      return;
    }
    setImporting(true);
    setErrorMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/reallocation/products/import', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: formData,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Erro ao importar catalogo.');
      }

      alert(`${data.imported || 0} produtos importados. ${data.enriched || 0} produtos enriquecidos. ${data.unmatched || 0} EANs sem vinculo. ${data.skipped || 0} linhas ignoradas/duplicadas.`);
      addReallocationAuditLog({
        action: 'Catalogo importado',
        detail: file.name,
        count: Number(data.imported || 0),
      });
      await loadProducts(searchTerm);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      setErrorMessage(message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const importStock = async (file: File) => {
    if (!canImportData) {
      alert(getBlockedMessage('importar estoque do remanejamento inteligente', 'perfumePurchasingOrSupreme'));
      return;
    }
    setStockImporting(true);
    setErrorMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/reallocation/stock/import', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: formData,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Erro ao importar estoque.');
      }

      alert(`${data.imported || 0} linhas de estoque importadas. ${data.matchedProducts || 0} vinculadas ao código ERP. ${data.unmatchedProducts || 0} sem vínculo. ${data.skipped || 0} ignoradas.`);
      addReallocationAuditLog({
        action: 'Estoque importado',
        detail: file.name,
        count: Number(data.imported || 0),
      });
      await loadStockSnapshot('', true);
    } catch (error) {
      const message = getNetworkErrorMessage(error, 'Erro desconhecido');
      setErrorMessage(message);
    } finally {
      setStockImporting(false);
      if (stockInputRef.current) stockInputRef.current.value = '';
    }
  };

  const searchProductOptions = useCallback(async (term: string) => {
    const normalizedTerm = normalizeAutocompleteText(term);
    if (normalizedTerm.length < 2) return [];

    const rows = await fetchReallocationProducts(term, 24);

    return rankAutocompleteOptions(
      rows.map((product) => ({
        id: `${product.erp_code}:${product.ean}`,
        columns: [product.description, product.erp_code, product.ean || '-', product.manufacturer || '-', product.classification || '-'],
        searchText: `${product.description} ${product.erp_code} ${product.ean} ${product.manufacturer} ${product.classification}`.toLowerCase(),
        source: product,
      })),
      normalizedTerm,
      12,
    );
  }, []);

  const searchManufacturerOptions = useCallback(async (term: string) => {
    const normalizedTerm = normalizeAutocompleteText(term);
    if (normalizedTerm.length < 2) return [];

    const rows = await fetchReallocationAttributeOptions('manufacturer', term, 60);
    return rankAutocompleteOptions(
      rows.map((manufacturer) => ({
        id: manufacturer,
        columns: [manufacturer],
        searchText: manufacturer.toLowerCase(),
      })),
      normalizedTerm,
      12,
    );
  }, []);

  const searchClassificationOptions = useCallback(async (term: string) => {
    const normalizedTerm = normalizeAutocompleteText(term);
    if (normalizedTerm.length < 2) return [];

    const rows = await fetchReallocationAttributeOptions('classification', term, 60);
    return rankAutocompleteOptions(
      rows.map((classification) => ({
        id: classification,
        columns: [classification],
        searchText: classification.toLowerCase(),
      })),
      normalizedTerm,
      12,
    );
  }, []);

  const exportExampleTxt = () => {
    const firstProduct = filteredProducts.find((product) => product.erp_code);
    const content = txtLine('01', '02', firstProduct?.erp_code || '109872', 1);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo-remanejamento.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const generateTransferSuggestions = async ({ preserveManualChanges = false }: { preserveManualChanges?: boolean } = {}) => {
    if (!canGenerateSuggestions) {
      alert(getBlockedMessage('gerar sugestoes de remanejamento inteligente', 'perfumePurchasingOrSupreme'));
      return;
    }
    const manualQuantityByKey = preserveManualChanges
      ? new Map(
        transferSuggestions
          .filter((suggestion) => suggestion.quantity !== suggestion.maxQuantity)
          .map((suggestion) => [suggestionIdentityKey(suggestion), suggestion.quantity]),
      )
      : new Map<string, number>();

    setGeneratingSuggestions(true);
    setSuggestionMessage('');
    setSuggestionDiagnostic(null);

    try {
      if (!stockSnapshot) {
        setTransferSuggestions([]);
        setAppliedSuggestionSignature('');
        setSuggestionMessage('Importe um estoque antes de gerar sugestões.');
        return;
      }

      const selectedOrigins = new Set(originFilters.map((item) => item.id.padStart(2, '0')));
      const selectedDestinations = new Set(destinationFilters.map((item) => item.id.padStart(2, '0')));
      const selectedProducts = new Set(productFilters.map((item) => item.source?.ean).filter(Boolean) as string[]);
      const selectedClassifications = classificationFilters.map((item) => item.columns[0]).filter(Boolean);
      const selectedManufacturers = manufacturerFilters.map((item) => item.columns[0]).filter(Boolean);
      const response = await fetch('/api/reallocation-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() },
        body: JSON.stringify({
          snapshotId: stockSnapshot?.id,
          filters: {
            origins: Array.from(selectedOrigins),
            destinations: Array.from(selectedDestinations),
            products: Array.from(selectedProducts),
            classifications: selectedClassifications,
            manufacturers: selectedManufacturers,
          },
          rules: {
            originMinimumDays,
            destinationTargetDays,
            maxRoutePriority,
            originCurves: originCurvePriority,
            destinationCurves: destinationCurvePriority,
          },
          branchLogistics: Object.fromEntries(branchLogisticsByCode),
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !Array.isArray(data?.suggestions)) {
        throw new Error(data?.error || 'Não foi possível gerar sugestões.');
      }

      const suggestionEngine: SuggestionDiagnostic['engine'] = ['python', 'typescript', 'fallback'].includes(data.engine)
        ? data.engine
        : 'typescript';
      let nextSuggestions = data.suggestions as TransferSuggestion[];
      if (manualQuantityByKey.size > 0) {
        nextSuggestions = nextSuggestions.map((suggestion) => {
          const manualQuantity = manualQuantityByKey.get(suggestionIdentityKey(suggestion));
          if (manualQuantity === undefined) return suggestion;

          return { ...suggestion, quantity: manualQuantity };
        });

        nextSuggestions = nextSuggestions.map((suggestion) => {
          const manualQuantity = manualQuantityByKey.get(suggestionIdentityKey(suggestion));
          if (manualQuantity === undefined) return suggestion;

          return { ...suggestion, quantity: clampSuggestionQuantity(nextSuggestions, suggestion, manualQuantity) };
        });
      }

      setTransferSuggestions(nextSuggestions);
      setSuggestionView('draft');
      setSelectedSuggestionIds([]);
      setAppliedSuggestionSignature(suggestionSettingsSignature);
      setSuggestionDiagnostic({
        engine: suggestionEngine,
        stockRows: Number(data.stockRows || stockItems.length),
        productGroups: Number(data.productGroups || 0),
        eligibleOrigins: Number(data.eligibleOrigins || 0),
        eligibleDestinations: Number(data.eligibleDestinations || 0),
        missingErpCode: Number(data.missingErpCode || 0),
        blockedDifferentUf: Number(data.blockedDifferentUf || 0),
        blockedRoute: Number(data.blockedRoute || 0),
        attributeProducts: Number(data.attributeProducts || 0),
        filteredProducts: Number(data.filteredProducts || 0),
        branchLogistics: Number(data.branchLogistics || 0),
        suggestions: nextSuggestions.length,
      });
      if (nextSuggestions.length === 0) {
        setSuggestionMessage(`Nenhuma sugestão gerada pelo motor ${data.engine || 'TypeScript'}. Origens elegíveis: ${data.eligibleOrigins || 0}. Destinos elegíveis: ${data.eligibleDestinations || 0}. Itens sem código ERP: ${data.missingErpCode || 0}.`);
        return;
      }

      const keptManualCount = nextSuggestions.filter((suggestion) => manualQuantityByKey.has(suggestionIdentityKey(suggestion)) && suggestion.quantity !== suggestion.maxQuantity).length;
      setSuggestionMessage(`${nextSuggestions.length} sugestões geradas pelo motor ${data.engine || 'TypeScript'}.${keptManualCount > 0 ? ` ${keptManualCount} ajustes manuais mantidos.` : ''} Revise as quantidades antes de exportar.`);
      addReallocationAuditLog({
        action: 'Sugestão gerada',
        detail: `Motor ${data.engine || 'TypeScript'}`,
        count: nextSuggestions.length,
        units: nextSuggestions.reduce((sum, suggestion) => sum + suggestion.quantity, 0),
      });
    } catch (error) {
      setTransferSuggestions([]);
      setAppliedSuggestionSignature('');
      setSuggestionMessage(getNetworkErrorMessage(error, 'Não foi possível gerar sugestões.'));
    } finally {
      setGeneratingSuggestions(false);
    }
  };

  const updateActiveSuggestions = (updater: (current: TransferSuggestion[]) => TransferSuggestion[]) => {
    if (suggestionView === 'confirmed') {
      setConfirmedSuggestions(updater);
      return;
    }

    setTransferSuggestions(updater);
  };

  const updateSuggestionQuantity = (suggestionId: string, quantity: number) => {
    updateActiveSuggestions((current) => current.map((suggestion) => {
      if (suggestion.id !== suggestionId) return suggestion;
      const nextQuantity = clampSuggestionQuantity(current, suggestion, quantity);
      return { ...suggestion, quantity: nextQuantity };
    }));
  };

  const focusSuggestionCell = (suggestionIndex: number) => {
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-transfer-index="${suggestionIndex}"]`);
      input?.focus();
      input?.select();
    }, 0);
  };

  const pasteSuggestionQuantities = (startIndex: number, text: string) => {
    const quantities = text
      .split(/\r?\n/)
      .map((line) => Number(line.split(/\t|;/)[0]?.replace(/\D/g, '') || 0))
      .filter((value) => Number.isFinite(value));

    if (quantities.length === 0) return;
    const targetIds = sortedTransferSuggestions.slice(startIndex, startIndex + quantities.length).map((suggestion) => suggestion.id);

    updateActiveSuggestions((current) => {
      const requestedById = new Map(targetIds.map((id, index) => [id, quantities[index]]));
      let nextSuggestions = current;

      for (const targetId of targetIds) {
        const target = nextSuggestions.find((suggestion) => suggestion.id === targetId);
        if (!target) continue;
        const nextQuantity = clampSuggestionQuantity(nextSuggestions, target, requestedById.get(targetId) || 0);
        nextSuggestions = nextSuggestions.map((suggestion) => (
          suggestion.id === targetId ? { ...suggestion, quantity: nextQuantity } : suggestion
        ));
      }

      return nextSuggestions;
    });

    addReallocationAuditLog({
      action: 'Quantidades coladas',
      detail: `${quantities.length} linha${quantities.length === 1 ? '' : 's'}`,
      count: quantities.length,
      units: quantities.reduce((sum, value) => sum + value, 0),
    });
    focusSuggestionCell(Math.min(startIndex + quantities.length - 1, sortedTransferSuggestions.length - 1));
  };

  const adjustedOriginDays = useCallback((suggestion: TransferSuggestion) => {
    const allocation = originAllocationByProduct.get(`${suggestion.ean}:${suggestion.originCode}`);
    return getAdjustedOriginDays(suggestion, allocation?.allocated);
  }, [originAllocationByProduct]);

  const adjustedDestinationDays = useCallback((suggestion: TransferSuggestion) => {
    const allocation = destinationAllocationByProduct.get(`${suggestion.ean}:${suggestion.destinationCode}`);
    return getAdjustedDestinationDays(suggestion, allocation?.allocated);
  }, [destinationAllocationByProduct]);

  const tableSearchBaseCount = useMemo(() => (
    showOnlyProblemSuggestions
      ? activeSuggestionRows.filter((suggestion) => problemSuggestionIds.has(suggestion.id)).length
      : activeSuggestionRows.length
  ), [activeSuggestionRows, problemSuggestionIds, showOnlyProblemSuggestions]);
  const displayedTransferSuggestions = useMemo(() => {
    const baseSuggestions = showOnlyProblemSuggestions
      ? activeSuggestionRows.filter((suggestion) => problemSuggestionIds.has(suggestion.id))
      : activeSuggestionRows;
    const query = normalizeAutocompleteText(suggestionTableSearch);
    if (!query) return baseSuggestions;

    return baseSuggestions.filter((suggestion) => {
      const searchable = [
        suggestion.description,
        suggestion.ean,
        suggestion.erpCode,
        suggestion.originName,
        suggestion.originCode,
        suggestion.originCurve,
        suggestion.destinationName,
        suggestion.destinationCode,
        suggestion.destinationCurve,
        suggestion.quantity,
        suggestion.routePriority,
      ].join(' ');
      return normalizeAutocompleteText(searchable).includes(query);
    });
  }, [activeSuggestionRows, problemSuggestionIds, showOnlyProblemSuggestions, suggestionTableSearch]);
  const sortedTransferSuggestions = [...displayedTransferSuggestions];
  if (suggestionSort && suggestionSort.key !== 'actions' && suggestionSort.key !== 'quantity') {
    const directionFactor = suggestionSort.direction === 'asc' ? 1 : -1;
    sortedTransferSuggestions.sort((left, right) => {
      const leftValue = getSuggestionSortValue(left, suggestionSort.key);
      const rightValue = getSuggestionSortValue(right, suggestionSort.key);

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * directionFactor;
      }

      return String(leftValue).localeCompare(String(rightValue), 'pt-BR', { numeric: true, sensitivity: 'base' }) * directionFactor;
    });
  }
  const visibleSuggestionIds = sortedTransferSuggestions.map((suggestion) => suggestion.id);
  const selectedVisibleSuggestionCount = visibleSuggestionIds.filter((id) => selectedSuggestionIdSet.has(id)).length;
  const allVisibleSuggestionsSelected = visibleSuggestionIds.length > 0 && selectedVisibleSuggestionCount === visibleSuggestionIds.length;

  const changeSuggestionView = (view: SuggestionView) => {
    setSuggestionView(view);
    setSelectedSuggestionIds([]);
  };

  const toggleSuggestionSelection = (suggestionId: string) => {
    setSelectedSuggestionIds((current) => (
      current.includes(suggestionId)
        ? current.filter((id) => id !== suggestionId)
        : [...current, suggestionId]
    ));
  };

  const toggleVisibleSuggestionSelection = () => {
    setSelectedSuggestionIds((current) => {
      const currentSet = new Set(current);
      const visibleSet = new Set(visibleSuggestionIds);

      if (allVisibleSuggestionsSelected) {
        return current.filter((id) => !visibleSet.has(id));
      }

      visibleSuggestionIds.forEach((id) => currentSet.add(id));
      return Array.from(currentSet);
    });
  };

  const confirmSelectedSuggestions = () => {
    const selectedRows = transferSuggestions.filter((suggestion) => selectedSuggestionIdSet.has(suggestion.id));
    if (selectedRows.length === 0) {
      alert('Selecione ao menos uma sugestão para confirmar.');
      return;
    }

    setConfirmedSuggestions((current) => {
      const byIdentity = new Map(current.map((suggestion) => [suggestionIdentityKey(suggestion), suggestion]));
      selectedRows.forEach((suggestion) => {
        byIdentity.set(suggestionIdentityKey(suggestion), suggestion);
      });
      return Array.from(byIdentity.values());
    });
    setTransferSuggestions((current) => current.filter((suggestion) => !selectedSuggestionIdSet.has(suggestion.id)));
    setSelectedSuggestionIds([]);
    setSuggestionView('confirmed');
    addReallocationAuditLog({
      action: 'Sugestão confirmada',
      detail: `${selectedRows.length} linhas enviadas para a etapa confirmada`,
      count: selectedRows.length,
      units: selectedRows.reduce((sum, suggestion) => sum + suggestion.quantity, 0),
    });
  };

  const removeSelectedConfirmedSuggestions = () => {
    if (selectedSuggestionIds.length === 0) return;
    const selectedSet = new Set(selectedSuggestionIds);
    const selectedRows = confirmedSuggestions.filter((suggestion) => selectedSet.has(suggestion.id));
    setConfirmedSuggestions((current) => current.filter((suggestion) => !selectedSet.has(suggestion.id)));
    setSelectedSuggestionIds([]);
    addReallocationAuditLog({
      action: 'Confirmadas removidas',
      detail: `${selectedRows.length} linhas removidas da etapa confirmada`,
      count: selectedRows.length,
      units: selectedRows.reduce((sum, suggestion) => sum + suggestion.quantity, 0),
    });
  };

  const removeSuggestion = (suggestionId: string) => {
    updateActiveSuggestions((current) => current.filter((suggestion) => suggestion.id !== suggestionId));
    setSelectedSuggestionIds((current) => current.filter((id) => id !== suggestionId));
  };

  const restoreSuggestionQuantity = (suggestionId: string) => {
    updateActiveSuggestions((current) => current.map((suggestion) => (
      suggestion.id === suggestionId
        ? { ...suggestion, quantity: clampSuggestionQuantity(current, suggestion, suggestion.maxQuantity) }
        : suggestion
    )));
  };

  const isSuggestionManuallyChanged = (suggestion: TransferSuggestion) => suggestion.quantity !== suggestion.maxQuantity;
  const manualSuggestionChangeCount = transferSuggestions.filter(isSuggestionManuallyChanged).length;
  const activeManualSuggestionChangeCount = activeSuggestionRows.filter(isSuggestionManuallyChanged).length;
  const requestGenerateTransferSuggestions = () => {
    if (manualSuggestionChangeCount > 0) {
      setShowRecalculateConfirm(true);
      return;
    }

    generateTransferSuggestions();
  };
  const getOriginAllocation = (suggestion: TransferSuggestion) => originAllocationByProduct.get(`${suggestion.ean}:${suggestion.originCode}`);
  const getDestinationAllocation = (suggestion: TransferSuggestion) => destinationAllocationByProduct.get(`${suggestion.ean}:${suggestion.destinationCode}`);
  const isSuggestionMultiDestination = (suggestion: TransferSuggestion) => (getOriginAllocation(suggestion)?.destinationCodes.size || 0) > 1;
  const isSuggestionMultiOrigin = (suggestion: TransferSuggestion) => (getDestinationAllocation(suggestion)?.originCodes.size || 0) > 1;
  const isSuggestionOverAllocated = (suggestion: TransferSuggestion) => {
    const allocation = getOriginAllocation(suggestion);
    return Boolean(allocation && allocation.allocated > allocation.stock);
  };
  const getSuggestionRowClass = (suggestion: TransferSuggestion) => {
    const multiDestination = isSuggestionMultiDestination(suggestion);
    const multiOrigin = isSuggestionMultiOrigin(suggestion);

    if (isSuggestionOverAllocated(suggestion)) {
      return 'shadow-[inset_4px_0_0_#dc2626]';
    }

    if (isSuggestionManuallyChanged(suggestion)) {
      return 'shadow-[inset_4px_0_0_#7c3aed]';
    }

    if (multiDestination && multiOrigin) {
      return 'shadow-[inset_4px_0_0_#0f766e]';
    }

    if (multiDestination) {
      return 'shadow-[inset_4px_0_0_#f59e0b]';
    }

    if (multiOrigin) {
      return 'shadow-[inset_4px_0_0_#2563eb]';
    }

    return '';
  };
  const getSuggestionCellToneClass = (suggestion: TransferSuggestion) => {
    const multiDestination = isSuggestionMultiDestination(suggestion);
    const multiOrigin = isSuggestionMultiOrigin(suggestion);

    if (isSuggestionOverAllocated(suggestion)) {
      return 'bg-[#fecaca] group-hover:bg-[#fca5a5]';
    }

    if (isSuggestionManuallyChanged(suggestion)) {
      return 'bg-[#ddd6fe] group-hover:bg-[#c4b5fd]';
    }

    if (multiDestination && multiOrigin) {
      return 'bg-[#99f6e4] group-hover:bg-[#5eead4]';
    }

    if (multiDestination) {
      return 'bg-[#fde68a] group-hover:bg-[#fcd34d]';
    }

    if (multiOrigin) {
      return 'bg-[#bae6fd] group-hover:bg-[#7dd3fc]';
    }

    return 'bg-white group-hover:bg-[#f8fafc]';
  };
  const visibleMultiDestinationCount = sortedTransferSuggestions.filter((suggestion) => isSuggestionMultiDestination(suggestion)).length;
  const visibleMultiOriginCount = sortedTransferSuggestions.filter((suggestion) => isSuggestionMultiOrigin(suggestion)).length;
  const visibleSharedRouteCount = sortedTransferSuggestions.filter((suggestion) => isSuggestionMultiDestination(suggestion) && isSuggestionMultiOrigin(suggestion)).length;

  const downloadSuggestionsTxt = () => {
    if (!canExport) {
      alert(getBlockedMessage('exportar TXT de remanejamento inteligente', 'perfumePurchasingOrSupreme'));
      return;
    }
    if (confirmedBlockingExportIssues.length > 0) {
      const first = confirmedBlockingExportIssues[0];
      alert(`${first.title}: ${first.detail}`);
      return;
    }

    const exportableSuggestions = confirmedSuggestions.filter((suggestion) => suggestion.erpCode && suggestion.quantity > 0);
    const missingCodeCount = confirmedSuggestions.filter((suggestion) => !suggestion.erpCode && suggestion.quantity > 0).length;
    const content = exportableSuggestions
      .filter((suggestion) => suggestion.erpCode && suggestion.quantity > 0)
      .map((suggestion) => txtLine(suggestion.originCode, suggestion.destinationCode, suggestion.erpCode, suggestion.quantity))
      .join('\n');

    if (!content) {
      if (confirmedSuggestions.length === 0) {
        alert('Confirme ao menos uma sugestão antes de exportar o TXT.');
        return;
      }

      alert(missingCodeCount > 0
        ? 'As sugestões foram geradas, mas estão sem código ERP. Reimporte/vincule o cadastro de produtos antes de exportar.'
        : 'Gere uma sugestão de transferência antes de exportar.');
      return;
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileName = `sugestao-remanejamento-${downloadTimestamp()}.txt`;
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    setShowExportConfirm(false);
    addReallocationAuditLog({
      action: 'TXT exportado',
      detail: `${fileName} - ${exportableSuggestions.length} linhas`,
      count: exportableSuggestions.length,
      units: exportableSuggestions.reduce((sum, suggestion) => sum + suggestion.quantity, 0),
    });
  };

  const exportSuggestionsTxt = () => {
    if (!canExport) {
      alert(getBlockedMessage('exportar TXT de remanejamento inteligente', 'perfumePurchasingOrSupreme'));
      return;
    }
    if (confirmedBlockingExportIssues.length > 0) {
      const first = confirmedBlockingExportIssues[0];
      alert(`${first.title}: ${first.detail}`);
      return;
    }

    if (confirmedSuggestions.length === 0) {
      alert('Confirme ao menos uma sugestão antes de exportar o TXT.');
      return;
    }

    if (confirmedSuggestions.some((suggestion) => !suggestion.erpCode && suggestion.quantity > 0)) {
      alert('Existem sugestões confirmadas sem código ERP. Reimporte/vincule o cadastro de produtos antes de exportar.');
      return;
    }

    if (confirmedSuggestions.filter((suggestion) => suggestion.erpCode && suggestion.quantity > 0).length === 0) {
      alert('Gere uma sugestão de transferência antes de exportar.');
      return;
    }

    setSuggestionView('confirmed');
    setSelectedSuggestionIds([]);
    setShowExportConfirm(true);
  };

  const exportConferenceCsv = () => {
    if (!canExport) {
      alert(getBlockedMessage('exportar conferencia de remanejamento inteligente', 'perfumePurchasingOrSupreme'));
      return;
    }
    const rows = [
      ['produto', 'origem', 'destino', 'codigo_erp', 'ean', 'quantidade', 'sugestao_original', 'estoque_origem', 'dias_origem_antes', 'dias_origem_depois', 'estoque_destino', 'dias_destino_antes', 'dias_destino_depois', 'rota', 'status'],
      ...activeSuggestionRows.map((suggestion) => [
        suggestion.description,
        suggestion.originName,
        suggestion.destinationName,
        suggestion.erpCode || '',
        suggestion.ean || '',
        suggestion.quantity,
        suggestion.maxQuantity,
        suggestion.originStock,
        decimal(suggestion.originStockDays),
        decimal(getAdjustedOriginDays(suggestion, getOriginAllocation(suggestion)?.allocated)),
        suggestion.destinationStock,
        decimal(suggestion.destinationStockDays),
        decimal(getAdjustedDestinationDays(suggestion, getDestinationAllocation(suggestion)?.allocated)),
        suggestion.routePriority,
        [
          !suggestion.erpCode && suggestion.quantity > 0 ? 'SEM_ERP' : '',
          suggestion.quantity !== suggestion.maxQuantity ? 'MANUAL' : '',
          suggestion.routePriority >= maxRoutePriority && suggestion.quantity > 0 ? 'ROTA_LIMITE' : '',
          problemSuggestionIds.has(suggestion.id) ? 'REVISAR' : 'OK',
        ].filter(Boolean).join('|'),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvValue).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'conferencia-remanejamento.csv';
    link.click();
    URL.revokeObjectURL(url);
    addReallocationAuditLog({
      action: 'CSV conferencia',
      detail: `${activeSuggestionRows.length} linhas exportadas (${suggestionView === 'confirmed' ? 'confirmadas' : 'sugestões'})`,
      count: activeSuggestionRows.length,
      units: activeSuggestionRows.reduce((sum, suggestion) => sum + suggestion.quantity, 0),
    });
  };

  const startSuggestionColumnResize = (event: ReactMouseEvent, key: SuggestionColumnKey) => {
    event.preventDefault();
    event.stopPropagation();
    resizingSuggestionColumnRef.current = {
      key,
      startX: event.clientX,
      startWidth: suggestionColumnWidths[key] || SUGGESTION_COLUMNS.find((column) => column.key === key)?.width || 120,
    };
  };

  const moveSuggestionColumn = (targetKey: SuggestionColumnKey) => {
    const sourceKey = draggedSuggestionColumnRef.current;
    draggedSuggestionColumnRef.current = null;
    if (!sourceKey || sourceKey === targetKey) return;
    if (sourceKey === 'selection' || sourceKey === 'actions' || targetKey === 'selection') return;

    setSuggestionColumnOrder((current) => {
      const sourceIndex = current.indexOf(sourceKey);
      const targetIndex = current.indexOf(targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return current;

      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const resetSuggestionColumns = () => {
    setSuggestionColumnOrder(SUGGESTION_COLUMNS.map((column) => column.key));
    setSuggestionColumnWidths(Object.fromEntries(SUGGESTION_COLUMNS.map((column) => [column.key, column.width])) as Record<SuggestionColumnKey, number>);
  };

  const renderSuggestionHeader = (column: SuggestionColumn) => {
    const highlightClass = 'highlight' in column && column.highlight === 'transfer'
      ? 'bg-emerald-50 text-emerald-700 shadow-[inset_0_-2px_0_#10b981]'
      : 'bg-slate-50 text-black';
    const isUtilityColumn = column.key === 'selection' || column.key === 'actions';

    return (
      <th
        key={column.key}
        draggable={!isUtilityColumn}
        onDoubleClick={() => {
          if (isUtilityColumn || column.key === 'quantity') return;
          setSuggestionSort((current) => ({
            key: column.key,
            direction: current?.key === column.key && current.direction === 'asc' ? 'desc' : 'asc',
          }));
        }}
        onDragStart={() => {
          if (isUtilityColumn) return;
          draggedSuggestionColumnRef.current = column.key;
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => {
          if (!isUtilityColumn) moveSuggestionColumn(column.key);
        }}
        className={`relative select-none border-b border-r border-slate-200 px-2.5 py-2.5 text-center text-[10px] font-black uppercase tracking-widest ${highlightClass}`}
        style={{ width: suggestionColumnWidths[column.key] || column.width }}
        title="Arraste para mover. Puxe a borda direita para ajustar a largura."
      >
        {column.key === 'selection' ? (
          <input
            type="checkbox"
            checked={allVisibleSuggestionsSelected}
            disabled={visibleSuggestionIds.length === 0}
            onChange={toggleVisibleSuggestionSelection}
            className="h-4 w-4 rounded border-slate-300 accent-violet-600 disabled:opacity-40"
            aria-label="Selecionar linhas visiveis"
          />
        ) : (
          <>
            <span className="block truncate pr-2">
              {column.label}
              {suggestionSort?.key === column.key && (
                <span className="ml-1 text-[9px]">{suggestionSort.direction === 'asc' ? 'A-Z' : 'Z-A'}</span>
              )}
            </span>
            {!isUtilityColumn && (
              <span
                className="absolute right-0 top-1/2 h-5 w-2 -translate-y-1/2 cursor-col-resize rounded-full transition hover:bg-blue-200"
                onMouseDown={(event) => startSuggestionColumnResize(event, column.key)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setSuggestionColumnWidths((current) => ({ ...current, [column.key]: column.width }));
                }}
              />
            )}
          </>
        )}
      </th>
    );
  };

  const renderSuggestionCell = (suggestion: TransferSuggestion, suggestionIndex: number, column: SuggestionColumn) => {
    const baseClass = 'overflow-hidden truncate whitespace-nowrap border-b border-r border-slate-100 px-2.5 py-1 text-center text-xs leading-tight text-black';
    const cellToneClass = getSuggestionCellToneClass(suggestion);
    const cellClass = `${baseClass} ${cellToneClass}`;

    switch (column.key) {
      case 'selection':
        return (
          <td key={column.key} className={`border-b border-r border-slate-100 px-2 py-1 text-center ${cellToneClass}`}>
            <input
              type="checkbox"
              checked={selectedSuggestionIdSet.has(suggestion.id)}
              onChange={() => toggleSuggestionSelection(suggestion.id)}
              className="h-4 w-4 rounded border-slate-300 accent-violet-600"
              aria-label={`Selecionar ${suggestion.description}`}
            />
          </td>
        );
      case 'description':
        return <td key={column.key} className={`${cellClass} font-bold uppercase`}>{suggestion.description}</td>;
      case 'ean':
        return <td key={column.key} className={`${cellClass} font-bold`}>{suggestion.ean || ''}</td>;
      case 'originName': {
        const allocation = getOriginAllocation(suggestion);
        const destinationCount = allocation?.destinationCodes.size || 0;
        const isMultiDestination = destinationCount > 1;
        return (
          <td
            key={column.key}
            className={`${cellClass} font-bold`}
            title={isMultiDestination ? `${suggestion.originName} envia este item para ${destinationCount} lojas` : undefined}
          >
            {suggestion.originName}
          </td>
        );
      }
      case 'originStock':
        return <td key={column.key} className={cellClass}>{decimal(suggestion.originStock)}</td>;
      case 'originConfirmedStock':
        return <td key={column.key} className={cellClass}>{decimal(suggestion.originConfirmedStock)}</td>;
      case 'originCurve':
        return <td key={column.key} className={`${cellClass} font-bold`}>{suggestion.originCurve || '-'}</td>;
      case 'originMonthlyAvgSales':
        return <td key={column.key} className={cellClass}>{decimal(suggestion.originMonthlyAvgSales)}</td>;
      case 'originStockDays':
        return <td key={column.key} className={`${cellClass} font-bold`}>{wholeNumber(suggestion.originStockDays)}</td>;
      case 'adjustedOriginDays': {
        const allocation = getOriginAllocation(suggestion);
        return (
          <td
            key={column.key}
            className={`${cellClass} font-black`}
            title={allocation ? `Considera ${wholeNumber(allocation.allocated)} un. totais saindo desta origem/produto` : undefined}
          >
            {wholeNumber(adjustedOriginDays(suggestion))}
          </td>
        );
      }
      case 'quantity':
        const allocation = getOriginAllocation(suggestion);
        const isOverAllocated = isSuggestionOverAllocated(suggestion);
        return (
          <td key={column.key} className={`border-b border-r border-slate-100 px-2.5 py-1 text-center ${cellToneClass}`}>
            <div className={`mx-auto w-20 rounded-md border bg-transparent shadow-none transition focus-within:bg-white/70 focus-within:ring-2 ${isOverAllocated ? 'border-red-600 focus-within:border-red-700 focus-within:ring-red-200' : isSuggestionManuallyChanged(suggestion) ? 'border-violet-600 focus-within:border-violet-700 focus-within:ring-violet-200' : 'border-emerald-600 focus-within:border-emerald-700 focus-within:ring-emerald-200'}`}>
              <input
                data-transfer-index={suggestionIndex}
                type="text"
                inputMode="numeric"
                value={suggestion.quantity}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => updateSuggestionQuantity(suggestion.id, Number(event.target.value.replace(/\D/g, '')))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    focusSuggestionCell(Math.min(suggestionIndex + 1, sortedTransferSuggestions.length - 1));
                  }

                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    focusSuggestionCell(Math.max(suggestionIndex - 1, 0));
                  }

                  if (event.key === 'Escape') {
                    event.currentTarget.blur();
                  }
                }}
                onPaste={(event) => {
                  const pastedText = event.clipboardData.getData('text');
                  if (!pastedText.includes('\n') && !pastedText.includes('\t') && !pastedText.includes(';')) return;
                  event.preventDefault();
                  pasteSuggestionQuantities(suggestionIndex, pastedText);
                }}
                className={`h-5 w-full bg-transparent px-2 text-center font-black leading-none outline-none ${isOverAllocated ? 'text-red-700' : isSuggestionManuallyChanged(suggestion) ? 'text-violet-700' : 'text-emerald-700'}`}
              />
            </div>
            {(isSuggestionManuallyChanged(suggestion) || isOverAllocated) && (
              <p className={`mt-0.5 text-[8px] font-black uppercase tracking-wide leading-none ${isOverAllocated ? 'text-red-700' : 'text-violet-700'}`}>
                {isOverAllocated ? `Excede ${wholeNumber((allocation?.allocated || 0) - (allocation?.stock || 0))}` : 'Manual'}
              </p>
            )}
          </td>
        );
      case 'destinationName': {
        const allocation = getDestinationAllocation(suggestion);
        const originCount = allocation?.originCodes.size || 0;
        const isMultiOrigin = originCount > 1;
        return (
          <td
            key={column.key}
            className={`${cellClass} font-bold`}
            title={isMultiOrigin ? `${suggestion.destinationName} recebe este item de ${originCount} origens` : undefined}
          >
            {suggestion.destinationName}
          </td>
        );
      }
      case 'destinationMonthlyAvgSales':
        return <td key={column.key} className={cellClass}>{decimal(suggestion.destinationMonthlyAvgSales)}</td>;
      case 'destinationConfirmedStock':
        return <td key={column.key} className={cellClass}>{decimal(suggestion.destinationConfirmedStock)}</td>;
      case 'destinationCurve':
        return <td key={column.key} className={`${cellClass} font-bold`}>{suggestion.destinationCurve || '-'}</td>;
      case 'destinationStock':
        return <td key={column.key} className={cellClass}>{decimal(suggestion.destinationStock)}</td>;
      case 'destinationStockDays':
        return <td key={column.key} className={`${cellClass} font-bold`}>{wholeNumber(suggestion.destinationStockDays)}</td>;
      case 'adjustedDestinationDays': {
        const allocation = getDestinationAllocation(suggestion);
        return (
          <td
            key={column.key}
            className={`${cellClass} font-black`}
            title={allocation ? `Considera ${wholeNumber(allocation.allocated)} un. totais chegando neste destino/produto` : undefined}
          >
            {wholeNumber(adjustedDestinationDays(suggestion))}
          </td>
        );
      }
      case 'originConfirmedPurchase':
        return <td key={column.key} className={cellClass}>{decimal(suggestion.originConfirmedPurchase)}</td>;
      case 'originConfirmedTransfer':
        return <td key={column.key} className={cellClass}>{decimal(suggestion.originConfirmedTransfer)}</td>;
      case 'erpCode':
        return <td key={column.key} className={`${cellClass} font-black`}>{suggestion.erpCode}</td>;
      case 'routePriority':
        return (
          <td key={column.key} className={`${cellClass} ${suggestion.routePriority >= maxRoutePriority && suggestion.quantity > 0 ? 'font-black' : ''}`}>
            {suggestion.routePriority}
          </td>
        );
      case 'actions':
        return (
          <td key={column.key} className={`border-b border-r border-slate-100 px-2 py-1 text-center ${cellToneClass}`}>
            <div className="flex items-center justify-center gap-1">
              {isSuggestionManuallyChanged(suggestion) && (
                <button
                  type="button"
                  onClick={() => restoreSuggestionQuantity(suggestion.id)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-violet-50 text-violet-700 transition hover:bg-violet-600 hover:text-white"
                  title="Restaurar sugestão original"
                >
                  <RotateCcw size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => removeSuggestion(suggestion.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-red-50 text-red-600 transition hover:bg-red-600 hover:text-white"
                title="Remover sugestão"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </td>
        );
    }
  };

  const toggleCurvePriority = (
    curve: string,
    selectedCurves: string[],
    setSelectedCurves: (value: string[]) => void,
  ) => {
    setSelectedCurves(
      selectedCurves.includes(curve)
        ? selectedCurves.filter((item) => item !== curve)
        : [...selectedCurves, curve],
    );
  };

  const dataImportPermissionTitle = canImportData ? undefined : getPermissionDeniedMessage('importar dados do remanejamento inteligente', 'perfumePurchasingOrSupreme');
  const generatePermissionTitle = canGenerateSuggestions ? undefined : getPermissionDeniedMessage('gerar sugestoes de remanejamento inteligente', 'perfumePurchasingOrSupreme');
  const exportPermissionTitle = canExport ? undefined : getPermissionDeniedMessage('exportar remanejamento inteligente', 'perfumePurchasingOrSupreme');
  const showBusyOverlay = stockImporting || generatingSuggestions;
  const busyOverlayTitle = stockImporting ? 'Importando estoque' : 'Atualizando sugestoes';
  const busyOverlayMessage = stockImporting
    ? 'Lendo o arquivo e atualizando a base de estoque.'
    : 'Recalculando as sugestoes com os filtros selecionados.';

  return (
    <main className="reallocation-workbench flex h-[calc(100dvh-4rem)] w-full max-w-none flex-col overflow-hidden px-2 py-2 sm:px-3 sm:py-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) importCatalog(file);
        }}
      />
      <input
        ref={stockInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) importStock(file);
        }}
      />

      {showBusyOverlay && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-white/80 p-4 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
          aria-label={busyOverlayTitle}
        >
          <div className="flex w-full max-w-[360px] flex-col items-center rounded-2xl border border-slate-200 bg-white px-8 py-7 text-center shadow-[0_22px_60px_rgba(15,23,42,0.18)]">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200">
              <Loader2 size={28} className="animate-spin" />
            </div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-900">{busyOverlayTitle}</p>
            <p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">{busyOverlayMessage}</p>
            <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-full animate-pulse rounded-full bg-violet-600" />
            </div>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="mb-5 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          {errorMessage}
        </div>
      )}

      <section className="flex min-h-0 flex-1 flex-col overflow-visible rounded-[12px] border border-slate-200 bg-white shadow-sm">
        {showTopPanel ? (
        <div className="relative z-[90] grid gap-1.5 border-b border-slate-300 bg-slate-100/80 p-1.5 xl:grid-cols-[minmax(980px,1fr)_420px_150px]">
          <div className="min-w-0">
            <div className="grid grid-cols-1 items-start gap-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              <QuickFilterBox
                title="Un. Negocio Origem"
                columns={['Codigo', 'Apelido', 'Cidade']}
                placeholder="Informe apelido, código ou CNPJ da loja origem"
                options={branchOptions}
                selected={originFilters}
                onChange={setOriginFilters}
                hideInitialOptions
              />
              <QuickFilterBox
                title="Un. Negocio Destino"
                columns={['Codigo', 'Apelido', 'Cidade']}
                placeholder="Informe apelido, código ou CNPJ da loja destino"
                options={branchOptions}
                selected={destinationFilters}
                onChange={setDestinationFilters}
                hideInitialOptions
              />
              <QuickFilterBox
                title="Produto"
                columns={['Descricao', 'Codigo ERP', 'EAN', 'Fabricante', 'Classificacao']}
                placeholder="Informe Cod. de Barras, código ERP ou descrição"
                options={productOptions}
                selected={productFilters}
                onChange={setProductFilters}
                onQuickSearch={searchProductOptions}
                hideInitialOptions
              />
              <QuickFilterBox
                title="Fabricante"
                columns={['Nome']}
                placeholder="Informe o nome do fabricante"
                options={[]}
                selected={manufacturerFilters}
                onChange={setManufacturerFilters}
                onQuickSearch={searchManufacturerOptions}
                allowManual
              />
              <QuickFilterBox
                title="Classificacao"
                columns={['Caminho']}
                placeholder="Informe o nome da classificacao"
                options={[]}
                selected={classificationFilters}
                onChange={setClassificationFilters}
                onQuickSearch={searchClassificationOptions}
                allowManual
                alignPopup="right"
              />
              <CurvePriorityBox
                title="Curva origem"
                selectedCurves={originCurvePriority}
                onToggle={(curve) => toggleCurvePriority(curve, originCurvePriority, setOriginCurvePriority)}
                onClear={() => setOriginCurvePriority([])}
                tone="violet"
              />
              <CurvePriorityBox
                title="Curva destino"
                selectedCurves={destinationCurvePriority}
                onToggle={(curve) => toggleCurvePriority(curve, destinationCurvePriority, setDestinationCurvePriority)}
                onClear={() => setDestinationCurvePriority([])}
                tone="emerald"
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase">
              <button
                type="button"
                onClick={() => {
                  setProductFilters([]);
                  setOriginFilters([]);
                  setDestinationFilters([]);
                  setClassificationFilters([]);
                  setManufacturerFilters([]);
                  setOriginCurvePriority([]);
                  setDestinationCurvePriority([]);
                }}
                className="h-6 rounded-md border border-slate-200 bg-white px-2 text-[9px] text-violet-700 shadow-sm hover:border-violet-300"
              >
                Limpar filtros
              </button>
              <span className={activeSuggestionFilterCount > 0 ? 'text-red-600' : 'text-slate-400'}>
                {activeSuggestionFilterCount} filtros selecionados
              </span>
              {hasPendingSuggestionSettings && (
                <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700">
                  pendente: atualizar
                </span>
              )}
              <span className="hidden sm:inline text-slate-400">Perfil: {SUGGESTION_PROFILES[suggestionProfile].label}</span>
              <span className="hidden sm:inline text-slate-400">Seguranca: {originMinimumDays} dias</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-4">
            <StatusMetric label="Exportaveis" value={suggestionExportStats.exportableLines.toLocaleString('pt-BR')} helper={`${suggestionExportStats.exportableUnits.toLocaleString('pt-BR')} un.`} tone="emerald" compact />
            <StatusMetric label="Sem ERP" value={suggestionExportStats.missingErpCodeLines.toLocaleString('pt-BR')} helper="fora TXT" tone="amber" compact />
            <StatusMetric label="Excedidas" value={overAllocatedOrigins.length.toLocaleString('pt-BR')} helper="bloqueia" tone="red" compact />
            <StatusMetric label="Estoque" value={stockItems.length.toLocaleString('pt-BR')} tone="indigo" compact />
            <StatusMetric label="Sugestões" value={transferSuggestions.length.toLocaleString('pt-BR')} tone="violet" compact />
            <StatusMetric label="Confirmadas" value={confirmedSuggestions.length.toLocaleString('pt-BR')} tone="emerald" compact />
            <StatusMetric label="Produtos mov." value={new Set(transferSuggestions.map((item) => item.ean)).size.toLocaleString('pt-BR')} tone="violet" compact />
            <StatusMetric label="Produtos" value={totalProducts.toLocaleString('pt-BR')} compact />
          </div>

          <div className="relative grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setShowTopPanel(false)}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-black uppercase text-slate-600 shadow-sm hover:border-violet-300 hover:text-violet-700"
              title="Ocultar filtros"
            >
              <X size={13} className="mr-1 inline-block" /> Ocultar
            </button>
            <button
              type="button"
              onClick={() => setShowAdvancedRules(true)}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-black uppercase text-slate-700 shadow-sm hover:border-violet-300 hover:text-violet-700"
            >
              <SlidersHorizontal size={13} className="mr-1 inline-block" /> Perfil
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowDataActions((current) => !current)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-black uppercase text-slate-700 shadow-sm hover:border-violet-300 hover:text-violet-700"
              >
                <Database size={13} className="mr-1 inline-block" /> Dados
              </button>
              {showDataActions && (
                <>
                  <div className="fixed inset-0 z-[95]" onClick={() => setShowDataActions(false)} />
                  <div className="absolute right-0 top-[calc(100%+6px)] z-[100] w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDataActions(false);
                        fileInputRef.current?.click();
                      }}
                      disabled={importing || !canImportData}
                      title={dataImportPermissionTitle}
                      className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[10px] font-black uppercase text-slate-700 hover:bg-violet-50 disabled:opacity-50"
                    >
                      <Upload size={13} /> {importing ? 'Importando...' : 'Importar CSV'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDataActions(false);
                        stockInputRef.current?.click();
                      }}
                      disabled={stockImporting || !canImportData}
                      title={dataImportPermissionTitle}
                      className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[10px] font-black uppercase text-slate-700 hover:bg-violet-50 disabled:opacity-50"
                    >
                      <Database size={13} /> {stockImporting ? 'Importando...' : 'Importar estoque'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDataActions(false);
                        loadProducts(searchTerm);
                      }}
                      className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[10px] font-black uppercase text-slate-700 hover:bg-violet-50"
                    >
                      <RefreshCcw size={13} /> Atualizar base
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDataActions(false);
                        exportExampleTxt();
                      }}
                      className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[10px] font-black uppercase text-violet-700 hover:bg-violet-50"
                    >
                      <Download size={13} /> Modelo TXT
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={exportSuggestionsTxt}
              disabled={!canExport || confirmedSuggestions.length === 0 || confirmedBlockingExportIssues.length > 0}
              title={!canExport ? exportPermissionTitle : confirmedBlockingExportIssues.length > 0 ? `${confirmedBlockingExportIssues[0].title}: ${confirmedBlockingExportIssues[0].detail}` : 'Exportar TXT das sugestões confirmadas'}
              className="h-9 rounded-md bg-slate-900 px-2 text-[10px] font-black uppercase text-white shadow-sm disabled:opacity-40"
            >
              <Download size={13} className="mr-1 inline-block" /> TXT
            </button>
            <button
              type="button"
              onClick={exportConferenceCsv}
              disabled={!canExport || activeSuggestionRows.length === 0}
              title={exportPermissionTitle}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-black uppercase text-slate-500 shadow-sm hover:border-violet-300 hover:text-violet-700 disabled:opacity-40"
            >
              <FileSpreadsheet size={13} className="mr-1 inline-block" /> CSV
            </button>
            <button
              type="button"
              onClick={() => setShowReallocationHistory(true)}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-black uppercase text-slate-700 shadow-sm hover:border-violet-300 hover:text-violet-700"
            >
              <Clock size={13} className="mr-1 inline-block" /> Histórico
            </button>
            <button
              type="button"
              onClick={requestGenerateTransferSuggestions}
              disabled={!canGenerateSuggestions || !stockSnapshot || stockLoading || generatingSuggestions}
              title={generatePermissionTitle}
              className="col-span-2 h-10 rounded-md bg-violet-600 px-2 text-[10px] font-black uppercase text-white shadow-sm disabled:opacity-40"
            >
              <Shuffle size={13} className="mr-1 inline-block" /> {stockLoading ? 'Carregando' : generatingSuggestions ? 'Gerando' : 'Atualizar'}
            </button>
          </div>
        </div>
        ) : (
          <div className="relative z-[70] flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="rounded-md bg-violet-50 px-2 py-1 text-violet-700">
                {activeSuggestionFilterCount} filtros selecionados
              </span>
              {hasPendingSuggestionSettings && (
                <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700">
                  pendente: atualizar
                </span>
              )}
              <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">
                Perfil: {SUGGESTION_PROFILES[suggestionProfile].label}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">
                Seguranca: {originMinimumDays} dias
              </span>
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
                {suggestionExportStats.exportableLines.toLocaleString('pt-BR')} exportaveis
              </span>
              <span className="rounded-md bg-violet-50 px-2 py-1 text-violet-700">
                {transferSuggestions.length.toLocaleString('pt-BR')} sugestões
              </span>
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
                {confirmedSuggestions.length.toLocaleString('pt-BR')} confirmadas
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowTopPanel(true)}
              className="h-7 rounded-md border border-violet-200 bg-violet-50 px-3 text-[9px] font-black uppercase tracking-wide text-violet-700 transition hover:border-violet-400 hover:bg-violet-100"
            >
              Mostrar filtros
            </button>
          </div>
        )}

        {(hasPendingSuggestionSettings || suggestionMessage || suggestionDiagnostic || originSummary.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase">
            {hasPendingSuggestionSettings && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                filtros alterados, clique em atualizar
              </span>
            )}
            {suggestionMessage && (
              <span className="max-w-full truncate rounded-md border border-violet-100 bg-violet-50 px-2 py-1 text-violet-700">
                {suggestionMessage}
              </span>
            )}
            {suggestionDiagnostic && (
              <>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">
                  {suggestionDiagnostic.engine === 'python' ? 'Python' : suggestionDiagnostic.engine === 'fallback' ? 'Fallback' : 'TypeScript'}
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">
                  {suggestionDiagnostic.stockRows.toLocaleString('pt-BR')} linhas
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">
                  {suggestionDiagnostic.productGroups.toLocaleString('pt-BR')} produtos
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">
                  {suggestionDiagnostic.filteredProducts.toLocaleString('pt-BR')} filtro prod.
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">
                  {suggestionDiagnostic.branchLogistics.toLocaleString('pt-BR')} rotas
                </span>
                <span className="rounded-md bg-violet-50 px-2 py-1 text-violet-700">
                  {suggestionDiagnostic.suggestions.toLocaleString('pt-BR')} sugestões
                </span>
                {(suggestionDiagnostic.missingErpCode > 0 || suggestionDiagnostic.blockedDifferentUf > 0 || suggestionDiagnostic.blockedRoute > 0) && (
                  <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700">
                    Alertas {(suggestionDiagnostic.missingErpCode + suggestionDiagnostic.blockedDifferentUf + suggestionDiagnostic.blockedRoute).toLocaleString('pt-BR')}
                  </span>
                )}
              </>
            )}
            {originSummary.slice(0, 4).map((origin) => (
              <span key={origin.originName} className={`rounded-md px-2 py-1 ${origin.exceeded > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>
                {origin.originName}: {wholeNumber(origin.units)} un.
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 overflow-hidden rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => changeSuggestionView('draft')}
                className={`rounded px-3 text-[10px] font-black uppercase transition ${suggestionView === 'draft' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                Sugestões {transferSuggestions.length > 0 ? `(${transferSuggestions.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => changeSuggestionView('confirmed')}
                className={`rounded px-3 text-[10px] font-black uppercase transition ${suggestionView === 'confirmed' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                Sugestão confirmada {confirmedSuggestions.length > 0 ? `(${confirmedSuggestions.length})` : ''}
              </button>
            </div>
            {suggestionView === 'draft' ? (
              <button
                type="button"
                onClick={confirmSelectedSuggestions}
                disabled={selectedSuggestionIds.length === 0}
                className="h-8 rounded-md bg-emerald-600 px-3 text-[10px] font-black uppercase text-white shadow-sm disabled:opacity-40"
              >
                <Check size={13} className="mr-1 inline-block" /> Confirmar sugestão
              </button>
            ) : (
              <button
                type="button"
                onClick={removeSelectedConfirmedSuggestions}
                disabled={selectedSuggestionIds.length === 0}
                className="h-8 rounded-md bg-red-50 px-3 text-[10px] font-black uppercase text-red-600 shadow-sm disabled:opacity-40"
              >
                <Trash2 size={13} className="mr-1 inline-block" /> Remover selecionadas
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowOnlyProblemSuggestions((current) => !current)}
              disabled={problemSuggestionIds.size === 0}
              className={`h-8 rounded-md px-3 text-[10px] font-black uppercase disabled:opacity-40 ${showOnlyProblemSuggestions ? 'bg-slate-900 text-white' : 'bg-amber-50 text-amber-700'}`}
            >
              {showOnlyProblemSuggestions ? 'Mostrar todos' : 'So problemas'}
            </button>
            <button
              type="button"
              onClick={resetSuggestionColumns}
              className="h-8 rounded-md bg-slate-100 px-3 text-[10px] font-black uppercase text-slate-600"
            >
              Restaurar colunas
            </button>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[10px] font-black uppercase text-teal-950">
                <span className="h-3 w-3 rounded-[3px] border border-teal-600 bg-teal-300" />
                Rota compartilhada nos dois lados {visibleSharedRouteCount > 0 ? `(${visibleSharedRouteCount})` : ''}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase text-amber-950">
                <span className="h-3 w-3 rounded-[3px] border border-amber-500 bg-amber-300" />
                Origem p/ varios destinos {visibleMultiDestinationCount > 0 ? `(${visibleMultiDestinationCount})` : ''}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-black uppercase text-sky-950">
                <span className="h-3 w-3 rounded-[3px] border border-sky-500 bg-sky-300" />
                Destino recebe varias origens {visibleMultiOriginCount > 0 ? `(${visibleMultiOriginCount})` : ''}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-black uppercase text-violet-950">
                <span className="h-3 w-3 rounded-[3px] border border-violet-500 bg-violet-300" />
                Manual {activeManualSuggestionChangeCount > 0 ? `(${activeManualSuggestionChangeCount})` : ''}
              </span>
            </div>
          </div>
          <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            {suggestionTableSearch && (
              <span className="rounded-md bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-500 shadow-sm">
                {sortedTransferSuggestions.length.toLocaleString('pt-BR')} de {tableSearchBaseCount.toLocaleString('pt-BR')}
              </span>
            )}
            <div className="relative w-full sm:w-[360px] xl:w-[440px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={suggestionTableSearch}
                onChange={(event) => setSuggestionTableSearch(event.target.value)}
                placeholder="Pesquisar na tabela..."
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-9 text-xs font-bold text-slate-800 outline-none shadow-sm placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              {suggestionTableSearch && (
                <button
                  type="button"
                  onClick={() => setSuggestionTableSearch('')}
                  className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded bg-slate-100 text-slate-500 hover:text-red-600"
                  aria-label="Limpar pesquisa da tabela"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
          <table className="table-fixed border-separate border-spacing-0 text-sm whitespace-nowrap" style={{ width: `${suggestionTableWidth}px`, minWidth: `${suggestionTableWidth}px` }}>
            <colgroup>
              {orderedSuggestionColumns.map((column) => (
                <col key={column.key} style={{ width: `${suggestionColumnWidths[column.key] || column.width}px` }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 text-[10px] uppercase">
              <tr>
                {orderedSuggestionColumns.map(renderSuggestionHeader)}
              </tr>
            </thead>
            <tbody>
              {sortedTransferSuggestions.map((suggestion, suggestionIndex) => (
                <tr key={suggestion.id} className={`group transition-colors ${getSuggestionRowClass(suggestion)}`}>
                  {orderedSuggestionColumns.map((column) => renderSuggestionCell(suggestion, suggestionIndex, column))}
                </tr>
              ))}
              {sortedTransferSuggestions.length === 0 && (
                <tr>
                  <td colSpan={orderedSuggestionColumns.length} className="h-72 border-b border-slate-100 px-3 text-center align-middle text-[10px] font-black uppercase tracking-widest text-black">
                    {suggestionTableSearch ? 'Nenhuma linha encontrada na pesquisa' : showOnlyProblemSuggestions ? 'Nenhuma linha com problema encontrada' : suggestionView === 'confirmed' ? 'Nenhuma sugestão confirmada ainda' : 'Gere as sugestões após importar o estoque'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showAdvancedRules && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={() => setShowAdvancedRules(false)}
        >
          <div
            className="w-full max-w-[900px] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-violet-600">Motor de sugestão</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {SUGGESTION_PROFILES[suggestionProfile].label} · segurança {originMinimumDays} dias
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvancedRules(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm hover:text-red-600"
                aria-label="Fechar ajustes"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {(Object.keys(SUGGESTION_PROFILES) as SuggestionProfile[]).map((profile) => {
                  const preset = SUGGESTION_PROFILES[profile];
                  const isSelected = suggestionProfile === profile;
                  return (
                    <button
                      key={profile}
                      type="button"
                      onClick={() => applySuggestionProfile(profile)}
                      className={`min-h-[88px] rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? 'border-violet-600 bg-violet-50 shadow-[0_8px_20px_rgba(124,58,237,0.12)]'
                          : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-black uppercase ${isSelected ? 'text-violet-700' : 'text-slate-900'}`}>{preset.label}</span>
                        <span className={`h-3 w-3 rounded-full border-2 ${isSelected ? 'border-violet-600 bg-violet-600' : 'border-slate-300 bg-white'}`} />
                      </span>
                      <span className="mt-2 block text-xs font-bold leading-snug text-slate-500">{preset.description}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[1.2fr_1fr_1fr]">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-violet-500">Segurança origem</p>
                  <NumberStepper
                    value={originMinimumDays}
                    onChange={setOriginMinimumDays}
                    min={0}
                    max={9999}
                    suffix="dias"
                  />
                </div>
                <TransferRuleInput
                  label="Meta destino"
                  value={destinationTargetDays}
                  onChange={setDestinationTargetDays}
                  min={1}
                  max={9999}
                />
                <TransferRuleInput
                  label="Limite rota"
                  value={maxRoutePriority}
                  onChange={setMaxRoutePriority}
                  min={0}
                  max={10}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowAdvancedRules(false)}
                className="h-9 rounded-md border border-slate-200 bg-white px-4 text-[10px] font-black uppercase text-slate-700 shadow-sm hover:border-violet-300 hover:text-violet-700"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdvancedRules(false);
                  requestGenerateTransferSuggestions();
                }}
                disabled={!canGenerateSuggestions || !stockSnapshot || stockLoading || generatingSuggestions}
                title={generatePermissionTitle}
                className="h-9 rounded-md bg-violet-600 px-4 text-[10px] font-black uppercase text-white shadow-sm disabled:opacity-40"
              >
                Aplicar e atualizar
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecalculateConfirm && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={() => setShowRecalculateConfirm(false)}
        >
          <div
            className="w-full max-w-[560px] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-900">Recalcular sugestões</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-600">
                  {manualSuggestionChangeCount} ajustes manuais encontrados
                </p>
              </div>
              <button type="button" onClick={() => setShowRecalculateConfirm(false)} className="rounded-md bg-white p-1 text-slate-500 hover:text-red-600">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800">
                Voce alterou quantidades manualmente. Quer manter esses ajustes nas linhas equivalentes ou resetar tudo antes de recalcular?
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRecalculateConfirm(false);
                    generateTransferSuggestions({ preserveManualChanges: true });
                  }}
                  className="min-h-[84px] rounded-lg border border-violet-200 bg-white p-3 text-left transition hover:border-violet-500 hover:bg-violet-50"
                >
                  <span className="block text-xs font-black uppercase tracking-widest text-violet-700">Manter ajustes</span>
                  <span className="mt-1 block text-xs font-bold leading-snug text-slate-500">Recalcula e tenta reaplicar as quantidades editadas nas mesmas rotas.</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRecalculateConfirm(false);
                    generateTransferSuggestions({ preserveManualChanges: false });
                  }}
                  className="min-h-[84px] rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-red-300 hover:bg-red-50"
                >
                  <span className="block text-xs font-black uppercase tracking-widest text-red-600">Resetar ajustes</span>
                  <span className="mt-1 block text-xs font-bold leading-snug text-slate-500">Descarta as edições manuais e usa somente o novo cálculo do motor.</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showExportConfirm && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={() => setShowExportConfirm(false)}
        >
          <div
            className="w-full max-w-[560px] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-900">Confirmar TXT</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Revise antes de enviar ao ERP</p>
              </div>
              <button type="button" onClick={() => setShowExportConfirm(false)} className="rounded-md bg-white p-1 text-slate-500">
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <DiagnosticCard label="Linhas TXT" value={confirmedExportStats.exportableLines} accent />
                <DiagnosticCard label="Unidades" value={confirmedExportStats.exportableUnits} />
                <DiagnosticCard label="Ajustes" value={confirmedSuggestions.filter(isSuggestionManuallyChanged).length} warning={confirmedSuggestions.some(isSuggestionManuallyChanged)} />
                <DiagnosticCard label="Avisos" value={confirmedExportIssues.length} warning={confirmedExportIssues.length > 0} />
              </div>
              {confirmedExportIssues.length > 0 && (
                <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-amber-200 bg-amber-50">
                  {confirmedExportIssues.map((issue) => (
                    <div key={issue.id} className="border-b border-amber-100 px-3 py-2 last:border-b-0">
                      <p className="text-[10px] font-black uppercase text-amber-700">{issue.title}</p>
                      <p className="text-xs font-bold text-slate-600">{issue.detail}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button type="button" onClick={() => setShowExportConfirm(false)} className="h-9 rounded-md border border-slate-300 bg-white px-4 text-[10px] font-black uppercase text-slate-600">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={downloadSuggestionsTxt}
                  disabled={!canExport}
                  title={exportPermissionTitle}
                  className="h-9 rounded-md bg-slate-900 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
                >
                  Baixar TXT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReallocationHistory && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={() => setShowReallocationHistory(false)}
        >
          <div
            className="w-full max-w-[620px] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-900">Histórico do remanejamento</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{reallocationAuditLog.length} eventos recentes</p>
              </div>
              <button type="button" onClick={() => setShowReallocationHistory(false)} className="rounded-md bg-white p-1 text-slate-500">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[460px] overflow-auto p-3">
              {reallocationAuditLog.map((event) => (
                <div key={event.id} className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-3 last:mb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black uppercase text-slate-900">{event.action}</p>
                      <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">{event.detail}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-black text-slate-400">{new Date(event.at).toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {typeof event.count === 'number' && <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-600">{event.count.toLocaleString('pt-BR')} linhas</span>}
                    {typeof event.units === 'number' && <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-violet-700">{wholeNumber(event.units)} un.</span>}
                  </div>
                </div>
              ))}
              {!reallocationAuditLog.length && (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Nenhum evento registrado ainda.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function TransferRuleInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
      <span className="block text-[10px] font-black uppercase text-violet-500">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const nextValue = Math.max(min, Math.min(max, Number(event.target.value) || 0));
          onChange(nextValue);
        }}
        className="mt-2 h-10 w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 text-sm font-black text-slate-900 outline-none [appearance:textfield] focus:border-violet-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

function NumberStepper({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  suffix: string;
}) {
  const clamp = (nextValue: number) => Math.max(min, Math.min(max, Math.round(nextValue || 0)));

  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        className="h-10 w-10 rounded-xl bg-slate-100 text-lg font-black text-slate-600 transition hover:bg-slate-200 disabled:opacity-40"
        disabled={value <= min}
        aria-label="Diminuir valor"
      >
        -
      </button>
      <label className="min-w-0 flex-1 text-center">
        <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Seguranca</span>
        <div className="mt-0.5 flex items-baseline justify-center gap-1">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            onChange={(event) => onChange(clamp(Number(event.target.value)))}
            className="w-16 bg-transparent text-center text-3xl font-black leading-none text-violet-700 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-[10px] font-black uppercase text-slate-400">{suffix}</span>
        </div>
      </label>
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        className="h-10 w-10 rounded-xl bg-violet-600 text-lg font-black text-white transition hover:bg-violet-700 disabled:opacity-40"
        disabled={value >= max}
        aria-label="Aumentar valor"
      >
        +
      </button>
    </div>
  );
}

function DiagnosticCard({ label, value, suffix = '', accent = false, warning = false }: { label: string; value: number; suffix?: string; accent?: boolean; warning?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-3 shadow-sm ${warning ? 'border-amber-200 bg-amber-50' : accent ? 'border-violet-200 bg-violet-50' : 'border-slate-100 bg-white'}`}>
      <p className={`text-[9px] font-black uppercase ${warning ? 'text-amber-500' : accent ? 'text-violet-500' : 'text-slate-400'}`}>{label}</p>
      <p className={`text-lg font-black ${warning ? 'text-amber-800' : accent ? 'text-violet-900' : 'text-slate-900'}`}>
        {value.toLocaleString('pt-BR')}{suffix}
      </p>
    </div>
  );
}

function StatusMetric({ label, value, helper, tone = 'slate', compact = false }: { label: string; value: string; helper?: string; tone?: 'slate' | 'indigo' | 'violet' | 'emerald' | 'amber' | 'red'; compact?: boolean }) {
  const toneClass = {
    slate: 'bg-white text-slate-900 [&_p:first-child]:text-slate-400',
    indigo: 'bg-white text-indigo-700 [&_p:first-child]:text-indigo-400',
    violet: 'bg-white text-violet-800 [&_p:first-child]:text-violet-400',
    emerald: 'bg-emerald-50 text-emerald-900 [&_p:first-child]:text-emerald-500',
    amber: 'bg-amber-50 text-amber-900 [&_p:first-child]:text-amber-500',
    red: 'bg-red-50 text-red-900 [&_p:first-child]:text-red-500',
  }[tone];

  return (
    <div className={`${compact ? 'min-h-[42px] rounded-md border border-slate-200 px-2 py-1 shadow-sm' : 'min-h-12 px-2.5 py-1.5'} ${toneClass}`}>
      <p className="truncate text-[9px] font-black uppercase leading-tight">{label}</p>
      <div className="flex items-end gap-1.5">
        <p className={`${compact ? 'text-sm' : 'text-base'} font-black leading-none`}>{value}</p>
        {helper && <p className="truncate pb-[1px] text-[9px] font-bold opacity-80">{helper}</p>}
      </div>
    </div>
  );
}

function CurvePriorityBox({
  title,
  selectedCurves,
  onToggle,
  onClear,
  tone,
}: {
  title: string;
  selectedCurves: string[];
  onToggle: (curve: string) => void;
  onClear: () => void;
  tone: 'violet' | 'emerald';
}) {
  const activeClass = tone === 'emerald'
    ? 'border-emerald-600 bg-emerald-600 text-white'
    : 'border-violet-600 bg-violet-600 text-white';
  const hoverClass = tone === 'emerald'
    ? 'hover:border-emerald-300 hover:text-emerald-700'
    : 'hover:border-violet-300 hover:text-violet-700';
  const selectedLabel = selectedCurves.length ? selectedCurves.join(', ') : 'Todas';

  return (
    <div className={`min-h-[82px] overflow-hidden rounded-[6px] border bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)] ${selectedCurves.length ? (tone === 'emerald' ? 'border-emerald-400' : 'border-violet-400') : 'border-slate-300'}`}>
      <div className="flex h-7 items-center justify-between border-b border-slate-200 bg-gradient-to-b from-white to-slate-50 px-2">
        <span className="truncate text-[12px] font-bold leading-none text-slate-950">{title}</span>
        <button
          type="button"
          onClick={onClear}
          disabled={selectedCurves.length === 0}
          className="rounded px-1 text-[9px] font-black uppercase text-slate-400 disabled:opacity-40"
        >
          Todas
        </button>
      </div>
      <div className="flex h-[55px] flex-col justify-center px-2 py-1.5">
        <div className="grid grid-cols-5 gap-1">
          {STOCK_CURVES.map((curve) => {
            const active = selectedCurves.includes(curve);
            return (
              <button
                key={`${title}-${curve}`}
                type="button"
                onClick={() => onToggle(curve)}
                className={`h-6 rounded-md border text-[11px] font-black ${active ? activeClass : `border-slate-200 bg-white text-slate-600 ${hoverClass}`}`}
              >
                {curve}
              </button>
            );
          })}
        </div>
        <p className="mt-0.5 truncate text-center text-[9px] font-bold text-slate-500">{selectedLabel}</p>
      </div>
    </div>
  );
}

function normalizeAutocompleteText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function autocompleteScore(item: QuickFilterItem, query: string) {
  const normalizedColumns = item.columns.map(normalizeAutocompleteText);
  const normalizedSearch = normalizeAutocompleteText(item.searchText);

  if (!query) return 0;
  if (normalizedColumns.some((column) => column === query)) return 0;
  if (normalizedColumns.some((column) => column.startsWith(query))) return 1;
  if (normalizedSearch.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (normalizedSearch.includes(query)) return 3;
  return 99;
}

function rankAutocompleteOptions(options: QuickFilterItem[], query: string, limit = 12) {
  if (!query) return options.slice(0, limit);

  return options
    .map((item) => ({ item, score: autocompleteScore(item, query) }))
    .filter(({ score }) => score < 99)
    .sort((left, right) => left.score - right.score || left.item.columns[0].localeCompare(right.item.columns[0]))
    .slice(0, limit)
    .map(({ item }) => item);
}

function QuickFilterBox({
  title,
  columns,
  placeholder,
  options,
  selected,
  onChange,
  onQuickSearch,
  hideInitialOptions = false,
  allowManual = false,
  alignPopup = 'left',
}: {
  title: string;
  columns: string[];
  placeholder: string;
  options: QuickFilterItem[];
  selected: QuickFilterItem[];
  onChange: (items: QuickFilterItem[]) => void;
  onQuickSearch?: (term: string) => Promise<QuickFilterItem[]>;
  hideInitialOptions?: boolean;
  allowManual?: boolean;
  alignPopup?: 'left' | 'right';
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [quickValue, setQuickValue] = useState('');
  const [remoteOptions, setRemoteOptions] = useState<QuickFilterItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [markedIds, setMarkedIds] = useState<Set<string>>(() => new Set());
  const normalizedQuickValue = normalizeAutocompleteText(quickValue);
  const availableOptions = onQuickSearch && normalizedQuickValue ? remoteOptions : options;
  const visibleOptions = useMemo(() => {
    if (hideInitialOptions && !normalizedQuickValue) return [];
    return rankAutocompleteOptions(availableOptions, normalizedQuickValue, 12);
  }, [availableOptions, hideInitialOptions, normalizedQuickValue]);
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);
  const listOptions = useMemo(() => {
    const merged = new Map<string, QuickFilterItem>();
    selected.forEach((item) => merged.set(item.id, item));
    visibleOptions.forEach((item) => merged.set(item.id, item));
    return Array.from(merged.values());
  }, [selected, visibleOptions]);
  const visibleSelectedIds = useMemo(() => new Set(listOptions.filter((item) => selectedIds.has(item.id)).map((item) => item.id)), [listOptions, selectedIds]);
  const visibleMarkedIds = useMemo(() => new Set(listOptions.filter((item) => selectedIds.has(item.id) && markedIds.has(item.id)).map((item) => item.id)), [listOptions, markedIds, selectedIds]);
  const optionGridTemplate = useMemo(() => {
    const valueColumnCount = Math.max(columns.length, 1);
    if (valueColumnCount === 1) return '24px minmax(0, 1fr)';
    return `24px repeat(${valueColumnCount}, minmax(0, 1fr))`;
  }, [columns.length]);

  useEffect(() => {
    if (!onQuickSearch) return;
    const term = quickValue.trim();

    if (term.length < 2) {
      queueMicrotask(() => {
        setRemoteOptions([]);
        setSearching(false);
      });
      return;
    }

    let isCurrent = true;
    const timeout = window.setTimeout(() => {
      setSearching(true);
      onQuickSearch(term)
        .then((items) => {
          if (isCurrent) setRemoteOptions(items);
        })
        .catch(() => {
          if (isCurrent) setRemoteOptions([]);
        })
        .finally(() => {
          if (isCurrent) setSearching(false);
        });
    }, 180);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeout);
    };
  }, [onQuickSearch, quickValue]);

  useEffect(() => {
    if (!expanded) return;

    const handlePointerDown = (event: globalThis.MouseEvent | TouchEvent) => {
      if (!containerRef.current || containerRef.current.contains(event.target as Node)) return;
      setExpanded(false);
      setQuickValue('');
      setRemoteOptions([]);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [expanded]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (expanded) {
        setExpanded(false);
        setQuickValue('');
        setRemoteOptions([]);
        return;
      }
      if (quickValue) {
        setQuickValue('');
        setRemoteOptions([]);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [expanded, quickValue]);

  const addItem = (item: QuickFilterItem) => {
    if (selectedIds.has(item.id)) return;
    onChange([...selected, item]);
    setMarkedIds((current) => {
      if (!current.has(item.id)) return current;
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    setQuickValue('');
    setRemoteOptions([]);
  };

  const toggleMarkedItem = (item: QuickFilterItem) => {
    if (!selectedIds.has(item.id)) {
      addItem(item);
      return;
    }

    setMarkedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  };

  const addQuickValue = () => {
    const match = visibleOptions[0];
    if (match) {
      addItem(match);
      return;
    }

    if (!allowManual || !quickValue.trim()) return;
    const manualValue = quickValue.trim().toUpperCase();
    addItem({
      id: `manual:${manualValue}`,
      columns: [manualValue],
      searchText: manualValue.toLowerCase(),
    });
  };

  const toggleVisibleMarkedItems = () => {
    if (visibleSelectedIds.size === 0) return;

    setMarkedIds((current) => {
      const next = new Set(current);
      const allVisibleSelectedMarked = Array.from(visibleSelectedIds).every((id) => next.has(id));

      visibleSelectedIds.forEach((id) => {
        if (allVisibleSelectedMarked) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });

      return next;
    });
  };

  const removeMarked = () => {
    if (visibleMarkedIds.size === 0) return;
    onChange(selected.filter((item) => !visibleMarkedIds.has(item.id)));
    setMarkedIds((current) => {
      const next = new Set(current);
      visibleMarkedIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const summary = selected.length === 0
    ? 'Nenhum item filtrado.'
    : `${selected.length} ${selected.length === 1 ? 'item filtrado' : 'itens filtrados'}`;
  const selectedPreview = selected.slice(0, 2).map((item) => item.columns[0]).join(', ');

  return (
    <div ref={containerRef} className={`relative text-slate-950 ${expanded ? 'z-[220]' : 'z-10'}`}>
      <div className={`overflow-hidden rounded-[6px] border ${selected.length ? 'border-violet-400 bg-violet-50' : 'border-slate-300 bg-white'} min-h-[82px] transition-colors shadow-[0_1px_0_rgba(15,23,42,0.04)]`}>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="w-full h-7 px-2 flex items-center justify-between text-left border-b border-slate-200 bg-gradient-to-b from-white to-slate-50"
        >
          <span className="truncate text-[12px] font-bold leading-none text-slate-950">{title}</span>
          <span className={`h-5 w-5 rounded-[4px] border flex items-center justify-center ${selected.length ? 'bg-violet-600 border-violet-600 text-white' : 'bg-slate-100 border-slate-300 text-slate-500'}`}>
            <Filter size={11} />
          </span>
        </button>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="h-[55px] w-full px-2 text-center transition-colors hover:bg-slate-50"
        >
          <span className={`block truncate text-xs font-bold ${selected.length ? 'text-violet-700' : 'text-slate-600'}`}>{summary}</span>
          {selectedPreview && <span className="mt-1 block max-w-full truncate text-[10px] font-bold text-slate-500">{selectedPreview}</span>}
        </button>
      </div>

      {expanded && (
        <div className={`absolute top-[calc(100%+4px)] z-[240] w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-[6px] border border-slate-400 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.22)] ${alignPopup === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="flex h-7 items-center justify-between border-b border-slate-300 bg-slate-100 px-2">
            <span className="truncate text-xs font-bold text-slate-900">{title}</span>
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                setQuickValue('');
                setRemoteOptions([]);
              }}
              className="h-5 w-5 rounded border border-slate-300 bg-white text-slate-500 hover:text-red-600"
              aria-label="Fechar filtro"
            >
              <X size={12} className="mx-auto" />
            </button>
          </div>

          <div className="p-2 grid grid-cols-1 md:grid-cols-[1fr_36px] items-center gap-2 border-b border-slate-200 bg-slate-50">
            <div className="relative">
              <input
                value={quickValue}
                onChange={(event) => setQuickValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addQuickValue();
                  }
                }}
                placeholder={placeholder}
                className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 pr-16 text-xs font-bold outline-none focus:border-violet-500"
              />
              {searching && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
                  buscando
                </span>
              )}
            </div>
            <button type="button" onClick={addQuickValue} className="h-8 w-full md:w-9 rounded-md bg-violet-600 text-white flex items-center justify-center">
              <Plus size={14} />
            </button>
          </div>

          <div className="max-h-64 min-h-40 overflow-auto border-b border-slate-200 bg-white">
            <div
              className="sticky top-0 z-10 grid items-center border-b border-slate-300 bg-white text-[11px] font-bold text-slate-900 shadow-[0_1px_0_rgba(15,23,42,0.08)]"
              style={{ gridTemplateColumns: optionGridTemplate }}
            >
              <button
                type="button"
                onClick={toggleVisibleMarkedItems}
                className="flex h-6 items-center justify-center border-r border-slate-200 hover:bg-blue-50"
                title="Marcar filtrados visíveis para remover"
              >
                <span className={`h-3.5 w-3.5 rounded-[2px] border ${visibleMarkedIds.size ? 'border-blue-600 bg-blue-600' : 'border-slate-400 bg-white'}`}>
                  {visibleMarkedIds.size ? <Check size={10} className="mx-auto mt-[1px] text-white" /> : null}
                </span>
              </button>
              {columns.map((column) => (
                <span key={column} className="truncate border-r border-slate-200 px-2 last:border-r-0">{column}</span>
              ))}
            </div>

            <div className="p-1">
            {listOptions.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const isMarked = markedIds.has(item.id);
              return (
              <button
                key={item.id}
                type="button"
                onClick={() => addItem(item)}
                className={`mb-1 grid w-full items-center rounded-[3px] border px-0 text-left ${
                  isMarked
                    ? 'border-blue-600 bg-blue-100 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.35)]'
                    : isSelected
                    ? 'border-blue-500 bg-blue-50 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.25)]'
                    : 'border-transparent hover:border-violet-200 hover:bg-violet-50'
                }`}
                style={{ gridTemplateColumns: optionGridTemplate }}
              >
                <span
                  className="flex h-7 items-center justify-center border-r border-slate-200"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleMarkedItem(item);
                  }}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded-[2px] border text-[11px] leading-none ${
                    isMarked ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'
                  }`}>
                    <Check size={12} />
                  </span>
                </span>
                {columns.map((column, index) => (
                  <span
                    key={`${item.id}-${column}-${index}`}
                    className={`h-7 truncate border-r border-slate-200 px-2 py-1.5 text-xs last:border-r-0 ${
                      index === 0 ? 'font-black text-slate-900' : 'font-bold text-slate-700'
                    }`}
                  >
                    {item.columns[index] || '-'}
                  </span>
                ))}
              </button>
              );
            })}
            </div>
            {listOptions.length === 0 && (
              <div className="flex h-20 items-center justify-center rounded-md bg-slate-50 px-3 text-center text-xs font-bold text-slate-400">
                {searching ? 'Buscando...' : normalizedQuickValue ? (allowManual ? 'Nenhum resultado. Aperte + para usar o texto digitado.' : 'Nenhum resultado direto.') : 'Digite pelo menos 2 caracteres para buscar.'}
              </div>
            )}
          </div>

          <div className="p-2 flex flex-wrap items-center justify-between gap-2 bg-white">
            <span className="text-[10px] font-black uppercase text-slate-400">
              {visibleMarkedIds.size} marcado{visibleMarkedIds.size === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onChange([]);
                  setMarkedIds(new Set());
                }}
                disabled={selected.length === 0}
                className="h-8 px-3 rounded-md bg-slate-100 text-[10px] font-black uppercase text-slate-600 disabled:text-slate-300"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={removeMarked}
                disabled={visibleMarkedIds.size === 0}
                className="h-8 w-9 rounded-md border border-slate-200 bg-white text-sm font-black text-slate-700 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:text-slate-300 disabled:hover:border-slate-200 disabled:hover:bg-white"
                title="Remover itens marcados"
              >
                -
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
