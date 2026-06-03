'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Database, Download, FileSpreadsheet, Filter, PackageSearch, Plus, RefreshCcw, Shuffle, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import { countReallocationProducts, fetchLatestReallocationStockSnapshot, fetchPricingBranches, fetchReallocationAttributeOptions, fetchReallocationProducts, fetchReallocationStockItems } from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-headers';
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

function getNetworkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    return 'Nao foi possivel conectar ao servidor agora. Tente atualizar novamente em alguns segundos.';
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

const SUGGESTION_PROFILES: Record<SuggestionProfile, {
  label: string;
  description: string;
  originMinimumDays: number;
  needDaysThreshold: number;
  destinationTargetDays: number;
  maxRoutePriority: number;
}> = {
  safe: {
    label: 'Conservador',
    description: 'Poucas transferencias, preserva mais estoque na origem.',
    originMinimumDays: 30,
    needDaysThreshold: 20,
    destinationTargetDays: 30,
    maxRoutePriority: 2,
  },
  balanced: {
    label: 'Equilibrado',
    description: 'Bom padrao para rotina: reduz excesso sem forcar tanto a logistica.',
    originMinimumDays: 20,
    needDaysThreshold: 25,
    destinationTargetDays: 30,
    maxRoutePriority: 6,
  },
  strong: {
    label: 'Agressivo',
    description: 'Gera mais sugestoes e aceita rotas mais abertas.',
    originMinimumDays: 15,
    needDaysThreshold: 30,
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
  suggestions: number;
}

const SUGGESTION_COLUMNS = [
  { key: 'description', label: 'Produto', align: 'left', width: 280 },
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
  { key: 'actions', label: 'Acoes', align: 'center', width: 95 },
] as const;

type SuggestionColumnKey = typeof SUGGESTION_COLUMNS[number]['key'];
type SuggestionColumn = typeof SUGGESTION_COLUMNS[number];
type SuggestionSort = {
  key: SuggestionColumnKey;
  direction: 'asc' | 'desc';
} | null;

function getSuggestionSortValue(
  suggestion: TransferSuggestion,
  key: SuggestionColumnKey,
) {
  switch (key) {
    case 'adjustedOriginDays':
      return getAdjustedOriginDays(suggestion);
    case 'adjustedDestinationDays':
      return getAdjustedDestinationDays(suggestion);
    case 'actions':
      return '';
    default:
      return suggestion[key as keyof TransferSuggestion] ?? '';
  }
}

function getAdjustedOriginDays(suggestion: TransferSuggestion) {
  const dailySales = Number(suggestion.originDailySales || 0);
  if (dailySales <= 0) return Number(suggestion.originStockDays || 0);
  return Math.max(0, (Number(suggestion.originStock || 0) - Number(suggestion.quantity || 0)) / dailySales);
}

function getAdjustedDestinationDays(suggestion: TransferSuggestion) {
  const dailySales = Number(suggestion.destinationDailySales || 0);
  if (dailySales <= 0) return Number(suggestion.destinationStockDays || 0);
  return (Number(suggestion.destinationStock || 0) + Number(suggestion.quantity || 0)) / dailySales;
}

function sortTransferSuggestions(suggestions: TransferSuggestion[], sort: SuggestionSort) {
  if (!sort || sort.key === 'actions' || sort.key === 'quantity') return suggestions;

  const directionFactor = sort.direction === 'asc' ? 1 : -1;
  return [...suggestions].sort((left, right) => {
    const leftValue = getSuggestionSortValue(left, sort.key);
    const rightValue = getSuggestionSortValue(right, sort.key);

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return (leftValue - rightValue) * directionFactor;
    }

    return String(leftValue).localeCompare(String(rightValue), 'pt-BR', { numeric: true, sensitivity: 'base' }) * directionFactor;
  });
}

export function ReallocationManager() {
  const [products, setProducts] = useState<ReallocationProduct[]>([]);
  const [branches, setBranches] = useState<PricingBranch[]>([]);
  const searchTerm = '';
  const [productFilters, setProductFilters] = useState<QuickFilterItem[]>([]);
  const [originFilters, setOriginFilters] = useState<QuickFilterItem[]>([]);
  const [destinationFilters, setDestinationFilters] = useState<QuickFilterItem[]>([]);
  const [classificationFilters, setClassificationFilters] = useState<QuickFilterItem[]>([]);
  const [manufacturerFilters, setManufacturerFilters] = useState<QuickFilterItem[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [stockSnapshot, setStockSnapshot] = useState<ReallocationStockSnapshot | null>(null);
  const [stockItems, setStockItems] = useState<ReallocationStockItem[]>([]);
  const [transferSuggestions, setTransferSuggestions] = useState<TransferSuggestion[]>([]);
  const [suggestionMessage, setSuggestionMessage] = useState('');
  const [suggestionDiagnostic, setSuggestionDiagnostic] = useState<SuggestionDiagnostic | null>(null);
  const [suggestionProfile, setSuggestionProfile] = useState<SuggestionProfile>(DEFAULT_SUGGESTION_PROFILE);
  const [showAdvancedRules, setShowAdvancedRules] = useState(false);
  const [originMinimumDays, setOriginMinimumDays] = useState(SUGGESTION_PROFILES[DEFAULT_SUGGESTION_PROFILE].originMinimumDays);
  const [needDaysThreshold, setNeedDaysThreshold] = useState(SUGGESTION_PROFILES[DEFAULT_SUGGESTION_PROFILE].needDaysThreshold);
  const [destinationTargetDays, setDestinationTargetDays] = useState(SUGGESTION_PROFILES[DEFAULT_SUGGESTION_PROFILE].destinationTargetDays);
  const [maxRoutePriority, setMaxRoutePriority] = useState(SUGGESTION_PROFILES[DEFAULT_SUGGESTION_PROFILE].maxRoutePriority);
  const [stockLoading, setStockLoading] = useState(true);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stockImporting, setStockImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [suggestionColumnOrder, setSuggestionColumnOrder] = useState<SuggestionColumnKey[]>(() => SUGGESTION_COLUMNS.map((column) => column.key));
  const [suggestionColumnWidths, setSuggestionColumnWidths] = useState<Record<SuggestionColumnKey, number>>(() => Object.fromEntries(SUGGESTION_COLUMNS.map((column) => [column.key, column.width])) as Record<SuggestionColumnKey, number>);
  const [suggestionSort, setSuggestionSort] = useState<SuggestionSort>(null);
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
      setErrorMessage('Tabela de remanejamento nao encontrada. Rode o SQL de produtos do remanejamento no Supabase.');
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
      setSuggestionMessage('Nao foi possivel conectar ao servidor agora. Tente atualizar novamente em alguns segundos.');
      setGeneratingSuggestions(false);
    };

    window.addEventListener('unhandledrejection', handleUnhandledFetchError);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledFetchError);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setTransferSuggestions([]);
      setSuggestionMessage('');
      setSuggestionDiagnostic(null);
    });
  }, [stockSnapshot?.id, originFilters, destinationFilters, productFilters, classificationFilters, manufacturerFilters, originMinimumDays, needDaysThreshold, destinationTargetDays, maxRoutePriority]);

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
    const exportable = transferSuggestions.filter((suggestion) => suggestion.erpCode && suggestion.quantity > 0);
    const missingErpCode = transferSuggestions.filter((suggestion) => !suggestion.erpCode && suggestion.quantity > 0);
    return {
      exportableLines: exportable.length,
      exportableUnits: exportable.reduce((sum, suggestion) => sum + suggestion.quantity, 0),
      missingErpCodeLines: missingErpCode.length,
    };
  }, [transferSuggestions]);
  const originAllocationByProduct = useMemo(() => {
    const allocations = new Map<string, { allocated: number; stock: number; originName: string; description: string }>();

    for (const suggestion of transferSuggestions) {
      const key = `${suggestion.ean}:${suggestion.originCode}`;
      const current = allocations.get(key) || {
        allocated: 0,
        stock: Number(suggestion.originStock || 0),
        originName: suggestion.originName,
        description: suggestion.description,
      };

      current.allocated += Number(suggestion.quantity || 0);
      current.stock = Math.max(current.stock, Number(suggestion.originStock || 0));
      allocations.set(key, current);
    }

    return allocations;
  }, [transferSuggestions]);
  const overAllocatedOrigins = useMemo(() => {
    return Array.from(originAllocationByProduct.values()).filter((allocation) => allocation.allocated > allocation.stock);
  }, [originAllocationByProduct]);
  const activeSuggestionFilterCount = productFilters.length + originFilters.length + destinationFilters.length + classificationFilters.length + manufacturerFilters.length;

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
    return suggestionColumnOrder.map((key) => byKey.get(key)).filter((column): column is SuggestionColumn => Boolean(column));
  }, [suggestionColumnOrder]);
  const suggestionTableWidth = useMemo(() => orderedSuggestionColumns.reduce((sum, column) => sum + (suggestionColumnWidths[column.key] || column.width), 0), [orderedSuggestionColumns, suggestionColumnWidths]);

  const applySuggestionProfile = (profile: SuggestionProfile) => {
    const preset = SUGGESTION_PROFILES[profile];
    setSuggestionProfile(profile);
    setOriginMinimumDays(preset.originMinimumDays);
    setNeedDaysThreshold(preset.needDaysThreshold);
    setDestinationTargetDays(preset.destinationTargetDays);
    setMaxRoutePriority(preset.maxRoutePriority);
  };

  const importCatalog = async (file: File) => {
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

      alert(`${data.imported || 0} linhas de estoque importadas. ${data.matchedProducts || 0} vinculadas ao codigo ERP. ${data.unmatchedProducts || 0} sem vinculo. ${data.skipped || 0} ignoradas.`);
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

  const generateTransferSuggestions = async () => {
    setGeneratingSuggestions(true);
    setSuggestionMessage('');
    setSuggestionDiagnostic(null);

    try {
      if (!stockSnapshot) {
        setTransferSuggestions([]);
        setSuggestionMessage('Importe um estoque antes de gerar sugestoes.');
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
            needDaysThreshold,
            destinationTargetDays,
            maxRoutePriority,
          },
          branchLogistics: Object.fromEntries(branchLogisticsByCode),
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !Array.isArray(data?.suggestions)) {
        throw new Error(data?.error || 'Nao foi possivel gerar sugestoes.');
      }

      const suggestionEngine: SuggestionDiagnostic['engine'] = ['python', 'typescript', 'fallback'].includes(data.engine)
        ? data.engine
        : 'typescript';
      setTransferSuggestions(data.suggestions as TransferSuggestion[]);
      setSuggestionDiagnostic({
        engine: suggestionEngine,
        stockRows: Number(data.stockRows || stockItems.length),
        productGroups: Number(data.productGroups || 0),
        eligibleOrigins: Number(data.eligibleOrigins || 0),
        eligibleDestinations: Number(data.eligibleDestinations || 0),
        missingErpCode: Number(data.missingErpCode || 0),
        blockedDifferentUf: Number(data.blockedDifferentUf || 0),
        blockedRoute: Number(data.blockedRoute || 0),
        suggestions: data.suggestions.length,
      });
      if (data.suggestions.length === 0) {
        setSuggestionMessage(`Nenhuma sugestao gerada pelo motor ${data.engine || 'TypeScript'}. Origens elegiveis: ${data.eligibleOrigins || 0}. Destinos elegiveis: ${data.eligibleDestinations || 0}. Itens sem codigo ERP: ${data.missingErpCode || 0}.`);
        return;
      }

      setSuggestionMessage(`${data.suggestions.length} sugestoes geradas pelo motor ${data.engine || 'TypeScript'}. Revise as quantidades antes de exportar.`);
    } catch (error) {
      setTransferSuggestions([]);
      setSuggestionMessage(getNetworkErrorMessage(error, 'Nao foi possivel gerar sugestoes.'));
    } finally {
      setGeneratingSuggestions(false);
    }
  };

  const updateSuggestionQuantity = (suggestionId: string, quantity: number) => {
    setTransferSuggestions((current) => current.map((suggestion) => {
      if (suggestion.id !== suggestionId) return suggestion;
      const originStockLimit = Math.max(0, Math.floor(Number(suggestion.originStock || 0)));
      const nextQuantity = Math.max(0, Math.min(originStockLimit, Math.floor(quantity || 0)));
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

    setTransferSuggestions((current) => current.map((suggestion, index) => {
      const pastedIndex = targetIds.length ? targetIds.indexOf(suggestion.id) : index - startIndex;
      if (pastedIndex < 0 || pastedIndex >= quantities.length) return suggestion;
      const originStockLimit = Math.max(0, Math.floor(Number(suggestion.originStock || 0)));
      const nextQuantity = Math.max(0, Math.min(originStockLimit, Math.floor(quantities[pastedIndex] || 0)));
      return { ...suggestion, quantity: nextQuantity };
    }));

    focusSuggestionCell(Math.min(startIndex + quantities.length - 1, transferSuggestions.length - 1));
  };

  const adjustedOriginDays = useCallback((suggestion: TransferSuggestion) => {
    return getAdjustedOriginDays(suggestion);
  }, []);

  const adjustedDestinationDays = useCallback((suggestion: TransferSuggestion) => {
    return getAdjustedDestinationDays(suggestion);
  }, []);

  const sortedTransferSuggestions = sortTransferSuggestions(transferSuggestions, suggestionSort);

  const removeSuggestion = (suggestionId: string) => {
    setTransferSuggestions((current) => current.filter((suggestion) => suggestion.id !== suggestionId));
  };

  const isSuggestionManuallyChanged = (suggestion: TransferSuggestion) => suggestion.quantity !== suggestion.maxQuantity;
  const getOriginAllocation = (suggestion: TransferSuggestion) => originAllocationByProduct.get(`${suggestion.ean}:${suggestion.originCode}`);
  const isSuggestionOverAllocated = (suggestion: TransferSuggestion) => {
    const allocation = getOriginAllocation(suggestion);
    return Boolean(allocation && allocation.allocated > allocation.stock);
  };

  const exportSuggestionsTxt = () => {
    if (overAllocatedOrigins.length > 0) {
      const first = overAllocatedOrigins[0];
      alert(`Revise as quantidades: ${first.originName} esta transferindo ${wholeNumber(first.allocated)} un. de "${first.description}", mas o estoque origem e ${wholeNumber(first.stock)}.`);
      return;
    }

    const exportableSuggestions = transferSuggestions.filter((suggestion) => suggestion.erpCode && suggestion.quantity > 0);
    const missingCodeCount = transferSuggestions.filter((suggestion) => !suggestion.erpCode && suggestion.quantity > 0).length;
    const content = exportableSuggestions
      .filter((suggestion) => suggestion.erpCode && suggestion.quantity > 0)
      .map((suggestion) => txtLine(suggestion.originCode, suggestion.destinationCode, suggestion.erpCode, suggestion.quantity))
      .join('\n');

    if (!content) {
      alert(missingCodeCount > 0
        ? 'As sugestoes foram geradas, mas estao sem codigo ERP. Reimporte/vincule o cadastro de produtos antes de exportar.'
        : 'Gere uma sugestao de transferencia antes de exportar.');
      return;
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sugestao-remanejamento.txt';
    link.click();
    URL.revokeObjectURL(url);
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
    const alignClass = column.align === 'left' ? 'text-left' : column.align === 'center' ? 'text-center' : 'text-right';
    const highlightClass = 'highlight' in column && column.highlight === 'transfer'
      ? 'border-2 border-emerald-300 bg-emerald-100 text-emerald-800'
      : 'border border-slate-300 bg-slate-100 text-slate-700';

    return (
      <th
        key={column.key}
        draggable
        onDoubleClick={() => {
          if (column.key === 'actions' || column.key === 'quantity') return;
          setSuggestionSort((current) => ({
            key: column.key,
            direction: current?.key === column.key && current.direction === 'asc' ? 'desc' : 'asc',
          }));
        }}
        onDragStart={() => {
          draggedSuggestionColumnRef.current = column.key;
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => moveSuggestionColumn(column.key)}
        className={`relative select-none px-2 py-2 ${alignClass} ${highlightClass}`}
        style={{ width: suggestionColumnWidths[column.key] || column.width }}
        title="Arraste para mover. Puxe a borda direita para ajustar a largura."
      >
        <span className="block truncate pr-2">
          {column.label}
          {suggestionSort?.key === column.key && (
            <span className="ml-1 text-[9px]">{suggestionSort.direction === 'asc' ? 'A-Z' : 'Z-A'}</span>
          )}
        </span>
        <span
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
          onMouseDown={(event) => startSuggestionColumnResize(event, column.key)}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setSuggestionColumnWidths((current) => ({ ...current, [column.key]: column.width }));
          }}
        />
      </th>
    );
  };

  const renderSuggestionCell = (suggestion: TransferSuggestion, suggestionIndex: number, column: SuggestionColumn) => {
    const alignClass = column.align === 'left' ? 'text-left' : column.align === 'center' ? 'text-center' : 'text-right';
    const baseClass = `border border-slate-200 px-2 py-1.5 ${alignClass}`;

    switch (column.key) {
      case 'description':
        return <td key={column.key} className={`${baseClass} font-bold uppercase text-slate-900`}>{suggestion.description}</td>;
      case 'originName':
        return <td key={column.key} className={`${baseClass} font-bold text-slate-900`}>{suggestion.originName}</td>;
      case 'originStock':
        return <td key={column.key} className={baseClass}>{decimal(suggestion.originStock)}</td>;
      case 'originConfirmedStock':
        return <td key={column.key} className={baseClass}>{decimal(suggestion.originConfirmedStock)}</td>;
      case 'originCurve':
        return <td key={column.key} className={`${baseClass} font-bold`}>{suggestion.originCurve || '-'}</td>;
      case 'originMonthlyAvgSales':
        return <td key={column.key} className={baseClass}>{decimal(suggestion.originMonthlyAvgSales)}</td>;
      case 'originStockDays':
        return <td key={column.key} className={`${baseClass} font-bold text-orange-600`}>{wholeNumber(suggestion.originStockDays)}</td>;
      case 'adjustedOriginDays':
        return <td key={column.key} className={`${baseClass} bg-orange-50 font-black text-orange-700`}>{wholeNumber(adjustedOriginDays(suggestion))}</td>;
      case 'quantity':
        const allocation = getOriginAllocation(suggestion);
        const isOverAllocated = isSuggestionOverAllocated(suggestion);
        return (
          <td key={column.key} className={`border-2 px-2 py-1.5 text-right ${isOverAllocated ? 'border-red-300 bg-red-50' : isSuggestionManuallyChanged(suggestion) ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className={`mx-auto w-24 border-2 bg-white shadow-inner focus-within:ring-2 ${isOverAllocated ? 'border-red-300 focus-within:border-red-600 focus-within:ring-red-200' : isSuggestionManuallyChanged(suggestion) ? 'border-amber-300 focus-within:border-amber-600 focus-within:ring-amber-200' : 'border-emerald-300 focus-within:border-emerald-600 focus-within:ring-emerald-200'}`}>
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
                    focusSuggestionCell(Math.min(suggestionIndex + 1, transferSuggestions.length - 1));
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
                className={`h-7 w-full bg-transparent px-2 text-right font-black outline-none ${isOverAllocated ? 'text-red-700' : isSuggestionManuallyChanged(suggestion) ? 'text-amber-700' : 'text-emerald-700'}`}
              />
            </div>
            {(isSuggestionManuallyChanged(suggestion) || isOverAllocated) && (
              <p className={`mt-1 text-[9px] font-black uppercase ${isOverAllocated ? 'text-red-700' : 'text-amber-700'}`}>
                {isOverAllocated ? `Excede ${wholeNumber((allocation?.allocated || 0) - (allocation?.stock || 0))}` : 'Manual'}
              </p>
            )}
          </td>
        );
      case 'destinationName':
        return <td key={column.key} className={`${baseClass} font-bold text-slate-900`}>{suggestion.destinationName}</td>;
      case 'destinationMonthlyAvgSales':
        return <td key={column.key} className={baseClass}>{decimal(suggestion.destinationMonthlyAvgSales)}</td>;
      case 'destinationConfirmedStock':
        return <td key={column.key} className={baseClass}>{decimal(suggestion.destinationConfirmedStock)}</td>;
      case 'destinationCurve':
        return <td key={column.key} className={`${baseClass} font-bold`}>{suggestion.destinationCurve || '-'}</td>;
      case 'destinationStock':
        return <td key={column.key} className={baseClass}>{decimal(suggestion.destinationStock)}</td>;
      case 'destinationStockDays':
        return <td key={column.key} className={`${baseClass} font-bold text-blue-700`}>{wholeNumber(suggestion.destinationStockDays)}</td>;
      case 'adjustedDestinationDays':
        return <td key={column.key} className={`${baseClass} bg-blue-50 font-black text-blue-700`}>{wholeNumber(adjustedDestinationDays(suggestion))}</td>;
      case 'originConfirmedPurchase':
        return <td key={column.key} className={baseClass}>{decimal(suggestion.originConfirmedPurchase)}</td>;
      case 'originConfirmedTransfer':
        return <td key={column.key} className={baseClass}>{decimal(suggestion.originConfirmedTransfer)}</td>;
      case 'erpCode':
        return <td key={column.key} className={`${baseClass} font-black text-violet-700`}>{suggestion.erpCode}</td>;
      case 'routePriority':
        return <td key={column.key} className={baseClass}>{suggestion.routePriority}</td>;
      case 'actions':
        return (
          <td key={column.key} className="border border-slate-200 px-2 py-1.5 text-center">
            <button
              type="button"
              onClick={() => removeSuggestion(suggestion.id)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-red-50 text-red-600"
              title="Remover sugestao"
            >
              <Trash2 size={15} />
            </button>
          </td>
        );
    }
  };

  return (
    <main className="reallocation-workbench w-full max-w-none px-3 sm:px-5 py-6 sm:py-8 pb-24 md:pb-8">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-violet-600 text-white flex items-center justify-center shadow-md">
            <Shuffle size={28} />
          </div>
          <div>
            <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-slate-900">Balacubaco</h1>
            <p className="text-sm font-bold text-slate-500">Base de produtos e conversao EAN para codigo ERP do remanejamento.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
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
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="h-11 px-4 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2 disabled:opacity-50"
          >
            <Upload size={16} /> {importing ? 'Importando...' : 'Importar CSV'}
          </button>
          <button
            onClick={() => stockInputRef.current?.click()}
            disabled={stockImporting}
            className="h-11 px-4 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2 disabled:opacity-50"
          >
            <Database size={16} /> {stockImporting ? 'Importando...' : 'Importar estoque'}
          </button>
          <button onClick={() => loadProducts(searchTerm)} className="h-11 px-4 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2">
            <RefreshCcw size={16} /> Atualizar
          </button>
          <button onClick={exportExampleTxt} className="h-11 px-4 rounded-2xl bg-violet-600 text-white font-black uppercase text-[10px] flex items-center gap-2">
            <Download size={16} /> Modelo TXT
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-5 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          {errorMessage}
        </div>
      )}

      <section className="mt-6 overflow-visible rounded-[18px] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-3 py-1.5">
          <div>
            <h2 className="text-xs font-black uppercase text-slate-800">Remanejamento</h2>
            <p className="text-[10px] font-bold text-slate-500">Filtros, sugestoes e exportacao ERP em uma grade compacta.</p>
          </div>
          <span className="text-[10px] font-black uppercase text-slate-400">
            {transferSuggestions.length.toLocaleString('pt-BR')} linhas
          </span>
        </div>

        <div className="relative z-[90] border-b border-slate-300 bg-slate-100/70 px-1.5 py-1.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-1 items-start">
            <QuickFilterBox
              title="Un. Negocio Origem"
              columns={['Codigo', 'Apelido', 'Cidade']}
              placeholder="Informe apelido, codigo ou CNPJ da loja origem"
              options={branchOptions}
              selected={originFilters}
              onChange={setOriginFilters}
              hideInitialOptions
            />
            <QuickFilterBox
              title="Un. Negocio Destino"
              columns={['Codigo', 'Apelido', 'Cidade']}
              placeholder="Informe apelido, codigo ou CNPJ da loja destino"
              options={branchOptions}
              selected={destinationFilters}
              onChange={setDestinationFilters}
              hideInitialOptions
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
              title="Produto"
              columns={['Descricao', 'Codigo ERP', 'EAN', 'Fabricante', 'Classificacao']}
              placeholder="Informe Cod. de Barras, codigo ERP ou descricao"
              options={productOptions}
              selected={productFilters}
              onChange={setProductFilters}
              onQuickSearch={searchProductOptions}
              hideInitialOptions
              alignPopup="right"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-[10px] font-black uppercase">
            <button
              type="button"
              onClick={() => {
                setProductFilters([]);
                setOriginFilters([]);
                setDestinationFilters([]);
                setClassificationFilters([]);
                setManufacturerFilters([]);
              }}
              className="h-8 rounded-md border border-slate-200 bg-slate-50 px-3 text-slate-700 hover:border-violet-300 hover:text-violet-700"
            >
              Limpar filtros
            </button>
            <span className={activeSuggestionFilterCount > 0 ? 'text-red-600' : 'text-slate-400'}>
              {activeSuggestionFilterCount} filtros ativos
            </span>
            <span className="hidden sm:inline text-slate-400">Perfil: {SUGGESTION_PROFILES[suggestionProfile].label}</span>
            <span className="hidden sm:inline text-slate-400">Seguranca: {originMinimumDays} dias</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvancedRules((value) => !value)}
              className="h-8 rounded-md border border-slate-200 bg-slate-50 px-3 text-[10px] font-black uppercase text-slate-700 hover:border-violet-300 hover:text-violet-700"
            >
              <SlidersHorizontal size={13} className="inline-block mr-1" /> Perfil
            </button>
            <button
              type="button"
              onClick={generateTransferSuggestions}
              disabled={!stockSnapshot || stockLoading || generatingSuggestions}
              className="h-8 rounded-md bg-violet-600 px-3 text-[10px] font-black uppercase text-white disabled:opacity-40"
            >
              <Shuffle size={13} className="inline-block mr-1" /> {stockLoading ? 'Carregando' : generatingSuggestions ? 'Gerando' : 'Atualizar'}
            </button>
            <button
              type="button"
              onClick={exportSuggestionsTxt}
              disabled={transferSuggestions.length === 0}
              className="h-8 rounded-md bg-slate-900 px-3 text-[10px] font-black uppercase text-white disabled:opacity-40"
            >
              <Download size={13} className="inline-block mr-1" /> TXT
            </button>
          </div>
        </div>

        {showAdvancedRules && (
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-violet-500">Motor de sugestao</p>
              <p className="text-sm font-bold text-slate-700">Escolha a intensidade do remanejamento e preserve estoque minimo na origem.</p>
              <p className="mt-1 text-[11px] font-bold text-slate-400">Lojas de UFs diferentes continuam bloqueadas automaticamente.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedRules((value) => !value)}
              className="h-10 px-4 rounded-2xl bg-slate-900 border border-slate-900 text-white font-black uppercase text-[10px] flex items-center gap-2 shadow-sm"
            >
              <SlidersHorizontal size={15} /> {showAdvancedRules ? 'Ocultar ajustes' : 'Ajustes avancados'}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {(Object.keys(SUGGESTION_PROFILES) as SuggestionProfile[]).map((profile) => {
              const preset = SUGGESTION_PROFILES[profile];
              const isSelected = suggestionProfile === profile;
              return (
                <button
                  key={profile}
                  type="button"
                  onClick={() => applySuggestionProfile(profile)}
                  className={`rounded-2xl border-2 p-4 text-left transition-all ${
                    isSelected
                      ? 'border-violet-600 bg-violet-50 shadow-[0_10px_24px_rgba(124,58,237,0.12)]'
                      : 'border-slate-100 bg-slate-50/70 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <span className="mb-3 flex items-center justify-between gap-2">
                    <span className={`block text-sm font-black uppercase ${isSelected ? 'text-violet-700' : 'text-slate-800'}`}>{preset.label}</span>
                    <span className={`h-3 w-3 rounded-full border-2 ${isSelected ? 'border-violet-600 bg-violet-600' : 'border-slate-300 bg-white'}`} />
                  </span>
                  <span className="mt-1 block text-xs font-bold text-slate-500">{preset.description}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3 items-center rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-violet-500">Estoque de seguranca origem</span>
              <span className="block text-xs font-bold text-slate-500 mt-1">A origem mantem cobertura para esses dias; somente o excedente entra na sugestao.</span>
            </div>
            <NumberStepper
              value={originMinimumDays}
              onChange={setOriginMinimumDays}
              min={0}
              max={90}
              suffix="dias"
            />
          </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              <TransferRuleInput
                label="Destino ate dias"
                value={needDaysThreshold}
                onChange={setNeedDaysThreshold}
                min={0}
                max={365}
              />
              <TransferRuleInput
                label="Meta destino"
                value={destinationTargetDays}
                onChange={setDestinationTargetDays}
                min={1}
                max={365}
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
        </div>
        )}

        {suggestionMessage && (
          <div className="mb-4 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm font-bold text-violet-800">
            {suggestionMessage}
          </div>
        )}

        {suggestionDiagnostic && (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Diagnostico do calculo</p>
                <p className="text-xs font-bold text-slate-500">Motor usado: {suggestionDiagnostic.engine === 'python' ? 'Python' : suggestionDiagnostic.engine === 'fallback' ? 'Fallback local' : 'TypeScript server'}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase text-slate-500">
                {suggestionDiagnostic.stockRows.toLocaleString('pt-BR')} linhas analisadas
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
              <DiagnosticCard label="Produtos" value={suggestionDiagnostic.productGroups} />
              <DiagnosticCard label="Origens ok" value={suggestionDiagnostic.eligibleOrigins} />
              <DiagnosticCard label="Destinos ok" value={suggestionDiagnostic.eligibleDestinations} />
              <DiagnosticCard label="Sugestoes" value={suggestionDiagnostic.suggestions} accent />
              <DiagnosticCard label="Sem ERP" value={suggestionDiagnostic.missingErpCode} warning={suggestionDiagnostic.missingErpCode > 0} />
              <DiagnosticCard label="UF bloqueada" value={suggestionDiagnostic.blockedDifferentUf} warning={suggestionDiagnostic.blockedDifferentUf > 0} />
              <DiagnosticCard label="Rota bloqueada" value={suggestionDiagnostic.blockedRoute} warning={suggestionDiagnostic.blockedRoute > 0} />
              <DiagnosticCard label="Perfil" value={originMinimumDays} suffix=" dias" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-9 gap-px border-b border-slate-200 bg-slate-200">
          <StatusMetric label="Produtos" value={totalProducts.toLocaleString('pt-BR')} />
          <StatusMetric label="Estoque" value={stockItems.length.toLocaleString('pt-BR')} tone="indigo" />
          <StatusMetric label="Sugestoes" value={transferSuggestions.length.toLocaleString('pt-BR')} tone="violet" />
          <StatusMetric label="Unidades" value={transferSuggestions.reduce((sum, item) => sum + item.quantity, 0).toLocaleString('pt-BR')} tone="violet" />
          <StatusMetric label="Produtos mov." value={new Set(transferSuggestions.map((item) => item.ean)).size.toLocaleString('pt-BR')} tone="violet" />
          <StatusMetric label="Exportaveis" value={suggestionExportStats.exportableLines.toLocaleString('pt-BR')} helper={`${suggestionExportStats.exportableUnits.toLocaleString('pt-BR')} un.`} tone="emerald" />
          <StatusMetric label="Sem ERP" value={suggestionExportStats.missingErpCodeLines.toLocaleString('pt-BR')} helper="fora TXT" tone="amber" />
          <StatusMetric label="Excedidas" value={overAllocatedOrigins.length.toLocaleString('pt-BR')} helper="bloqueia" tone="red" />
          <StatusMetric label="Filtros" value={activeSuggestionFilterCount.toLocaleString('pt-BR')} />
        </div>

        {overAllocatedOrigins.length > 0 && (
          <div className="mx-3 mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
            Existem produtos com soma de transferencias maior que o estoque da origem. Ajuste as linhas em vermelho antes de exportar.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Arraste cabeçalhos para ordenar. Puxe a borda direita para ajustar largura.
          </p>
          <button
            type="button"
            onClick={resetSuggestionColumns}
            className="h-8 rounded-md bg-slate-100 px-3 text-[10px] font-black uppercase text-slate-600"
          >
            Restaurar colunas
          </button>
        </div>

        <div className="max-h-[calc(100vh-240px)] overflow-auto">
          <table className="w-full border-collapse text-sm whitespace-nowrap" style={{ minWidth: suggestionTableWidth }}>
            <colgroup>
              {orderedSuggestionColumns.map((column) => (
                <col key={column.key} style={{ width: suggestionColumnWidths[column.key] || column.width }} />
              ))}
            </colgroup>
            <thead className="bg-slate-100 text-[10px] uppercase text-slate-700">
              <tr>
                {orderedSuggestionColumns.map(renderSuggestionHeader)}
              </tr>
            </thead>
            <tbody>
              {sortedTransferSuggestions.map((suggestion, suggestionIndex) => (
                <tr key={suggestion.id} className={`${isSuggestionOverAllocated(suggestion) ? 'bg-red-50 hover:bg-red-100' : isSuggestionManuallyChanged(suggestion) ? 'bg-amber-50 hover:bg-amber-100' : 'even:bg-slate-50 hover:bg-yellow-50'}`}>
                  {orderedSuggestionColumns.map((column) => renderSuggestionCell(suggestion, suggestionIndex, column))}
                </tr>
              ))}
              {transferSuggestions.length === 0 && (
                <tr>
                  <td colSpan={orderedSuggestionColumns.length} className="border border-slate-200 px-3 py-12 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                    Gere as sugestoes apos importar o estoque
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-4">
          <PackageSearch size={18} className="text-violet-600 mb-2" />
          <p className="text-[10px] font-black uppercase text-slate-400">Proxima etapa</p>
          <p className="text-sm font-bold text-slate-700 mt-1">Importar estoque por filial, venda media e dias de cobertura.</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-4">
          <FileSpreadsheet size={18} className="text-violet-600 mb-2" />
          <p className="text-[10px] font-black uppercase text-slate-400">Motor de calculo</p>
          <p className="text-sm font-bold text-slate-700 mt-1">Cruzar excesso, demanda e prioridade logistica por rota.</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-4">
          <Download size={18} className="text-violet-600 mb-2" />
          <p className="text-[10px] font-black uppercase text-slate-400">Exportacao ERP</p>
          <p className="text-sm font-bold text-slate-700 mt-1">Gerar TXT no formato loja origem;loja destino;codigo ERP;quantidade.</p>
        </div>
      </div>
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

function StatusMetric({ label, value, helper, tone = 'slate' }: { label: string; value: string; helper?: string; tone?: 'slate' | 'indigo' | 'violet' | 'emerald' | 'amber' | 'red' }) {
  const toneClass = {
    slate: 'bg-white text-slate-900 [&_p:first-child]:text-slate-400',
    indigo: 'bg-white text-indigo-700 [&_p:first-child]:text-indigo-400',
    violet: 'bg-white text-violet-800 [&_p:first-child]:text-violet-400',
    emerald: 'bg-emerald-50 text-emerald-900 [&_p:first-child]:text-emerald-500',
    amber: 'bg-amber-50 text-amber-900 [&_p:first-child]:text-amber-500',
    red: 'bg-red-50 text-red-900 [&_p:first-child]:text-red-500',
  }[tone];

  return (
    <div className={`min-h-12 px-2.5 py-1.5 ${toneClass}`}>
      <p className="truncate text-[9px] font-black uppercase leading-tight">{label}</p>
      <div className="flex items-end gap-1.5">
        <p className="text-base font-black leading-none">{value}</p>
        {helper && <p className="truncate pb-[1px] text-[9px] font-bold opacity-80">{helper}</p>}
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
  const normalizedQuickValue = normalizeAutocompleteText(quickValue);
  const availableOptions = onQuickSearch && normalizedQuickValue ? remoteOptions : options;
  const visibleOptions = useMemo(() => {
    if (hideInitialOptions && !normalizedQuickValue) return [];
    return rankAutocompleteOptions(availableOptions, normalizedQuickValue, 12);
  }, [availableOptions, hideInitialOptions, normalizedQuickValue]);

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
    if (selected.some((current) => current.id === item.id)) return;
    onChange([...selected, item]);
    setQuickValue('');
    setRemoteOptions([]);
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

  const removeLast = () => {
    onChange(selected.slice(0, -1));
  };

  const summary = selected.length === 0
    ? 'Nenhum item filtrado.'
    : `${selected.length} ${selected.length === 1 ? 'item filtrado' : 'itens filtrados'}`;
  const selectedPreview = selected.slice(0, 2).map((item) => item.columns[0]).join(', ');

  return (
    <div ref={containerRef} className={`relative text-slate-950 ${expanded ? 'z-[220]' : 'z-10'}`}>
      <div className={`overflow-hidden rounded-[6px] border ${selected.length ? 'border-violet-400 bg-violet-50' : 'border-slate-300 bg-white'} min-h-[92px] transition-colors shadow-[0_1px_0_rgba(15,23,42,0.04)]`}>
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
          className="h-[65px] w-full px-2 text-center transition-colors hover:bg-slate-50"
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

          <div className="max-h-64 min-h-40 overflow-auto border-b border-slate-200 bg-white p-1.5">
            {visibleOptions.filter((item) => !selected.some((current) => current.id === item.id)).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addItem(item)}
                className="mb-1 grid w-full grid-cols-[1fr_auto] gap-2 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-violet-200 hover:bg-violet-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-black text-slate-900">{item.columns[0] || item.id}</span>
                  <span className="mt-0.5 block truncate text-[10px] font-bold text-slate-500">
                    {columns.slice(1).map((column, index) => `${column}: ${item.columns[index + 1] || '-'}`).join(' | ')}
                  </span>
                </span>
                <Plus size={16} className="mt-1 text-violet-600" />
              </button>
            ))}
            {visibleOptions.filter((item) => !selected.some((current) => current.id === item.id)).length === 0 && (
              <div className="flex h-20 items-center justify-center rounded-md bg-slate-50 px-3 text-center text-xs font-bold text-slate-400">
                {searching ? 'Buscando...' : normalizedQuickValue ? (allowManual ? 'Nenhum resultado. Aperte + para usar o texto digitado.' : 'Nenhum resultado direto.') : 'Digite pelo menos 2 caracteres para buscar.'}
              </div>
            )}
          </div>

          {selected.length > 0 && (
            <div className="border-b border-slate-200 bg-violet-50/70 p-2">
              <p className="mb-2 text-[10px] font-black uppercase text-violet-500">Selecionados</p>
              <div className="flex flex-wrap gap-2">
                {selected.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChange(selected.filter((current) => current.id !== item.id))}
                    className="inline-flex max-w-full items-center gap-2 rounded-md bg-white px-2 py-1 text-[10px] font-black text-violet-700 shadow-sm"
                    title="Remover filtro"
                  >
                    <span className="max-w-52 truncate">{item.columns[0]}</span>
                    <X size={13} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-2 flex flex-wrap justify-between gap-2 bg-white">
            <button type="button" onClick={removeLast} disabled={selected.length === 0} className="h-8 px-3 rounded-md bg-slate-100 text-[10px] font-black uppercase text-slate-600 disabled:text-slate-300">
              Remover ultimo
            </button>
            <button type="button" onClick={() => onChange([])} disabled={selected.length === 0} className="h-8 px-3 rounded-md bg-slate-100 text-[10px] font-black uppercase text-slate-600 disabled:text-slate-300">
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
