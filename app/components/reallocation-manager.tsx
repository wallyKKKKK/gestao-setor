'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronDown, ChevronUp, Database, Download, FileSpreadsheet, Filter, PackageSearch, Plus, RefreshCcw, Search, Shuffle, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
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
    maxRoutePriority: 10,
  },
  balanced: {
    label: 'Equilibrado',
    description: 'Bom padrao para rotina: reduz excesso sem forcar tanto a logistica.',
    originMinimumDays: 20,
    needDaysThreshold: 25,
    destinationTargetDays: 30,
    maxRoutePriority: 50,
  },
  strong: {
    label: 'Agressivo',
    description: 'Gera mais sugestoes e aceita rotas mais abertas.',
    originMinimumDays: 15,
    needDaysThreshold: 30,
    destinationTargetDays: 35,
    maxRoutePriority: 99,
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
  const [stockSearchTerm, setStockSearchTerm] = useState('');
  const [showStockScenario, setShowStockScenario] = useState(false);
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
      void loadStockSnapshot('');
    });
  }, [loadStockSnapshot]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadProducts(searchTerm);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [classificationFilters, loadProducts, manufacturerFilters, searchTerm]);

  useEffect(() => {
    if (!showStockScenario && !stockSearchTerm.trim()) return;
    const timeout = window.setTimeout(() => {
      loadStockSnapshot(stockSearchTerm, showStockScenario);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [loadStockSnapshot, showStockScenario, stockSearchTerm]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (showAdvancedRules) {
        setShowAdvancedRules(false);
        return;
      }
      if (showStockScenario) {
        setShowStockScenario(false);
        return;
      }
      if (stockSearchTerm) {
        setStockSearchTerm('');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showAdvancedRules, showStockScenario, stockSearchTerm]);

  useEffect(() => {
    queueMicrotask(() => {
      setTransferSuggestions([]);
      setSuggestionMessage('');
      setSuggestionDiagnostic(null);
    });
  }, [stockSnapshot?.id, stockSearchTerm, originFilters, destinationFilters, productFilters, originMinimumDays, needDaysThreshold, destinationTargetDays, maxRoutePriority]);

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
  const stockSummary = useMemo(() => ({
    stores: new Set(stockItems.map((item) => item.store_code)).size,
    products: new Set(stockItems.map((item) => item.ean)).size,
    totalStock: stockItems.reduce((sum, item) => sum + Number(item.stock || 0), 0),
  }), [stockItems]);
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
      await loadStockSnapshot(stockSearchTerm, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
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
      const response = await fetch('/api/reallocation-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() },
        body: JSON.stringify({
          snapshotId: stockSnapshot?.id,
          filters: {
            origins: Array.from(selectedOrigins),
            destinations: Array.from(selectedDestinations),
            products: Array.from(selectedProducts),
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
      setSuggestionMessage(error instanceof Error ? error.message : 'Nao foi possivel gerar sugestoes.');
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
        className={`relative select-none px-3 py-3 ${alignClass} ${highlightClass}`}
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
    const baseClass = `border border-slate-200 px-3 py-2 ${alignClass}`;

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
          <td key={column.key} className={`border-2 px-3 py-3 text-right ${isOverAllocated ? 'border-red-300 bg-red-50' : isSuggestionManuallyChanged(suggestion) ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
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
                className={`h-8 w-full bg-transparent px-2 text-right font-black outline-none ${isOverAllocated ? 'text-red-700' : isSuggestionManuallyChanged(suggestion) ? 'text-amber-700' : 'text-emerald-700'}`}
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
        return <td key={column.key} className={baseClass}>{suggestion.routePriority === 0 ? 'Mesmo grupo' : suggestion.routePriority === 10 ? 'Mesma cidade' : suggestion.routePriority}</td>;
      case 'actions':
        return (
          <td key={column.key} className="border border-slate-200 px-3 py-3 text-center">
            <button
              type="button"
              onClick={() => removeSuggestion(suggestion.id)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600"
              title="Remover sugestao"
            >
              <Trash2 size={15} />
            </button>
          </td>
        );
    }
  };

  return (
    <main className="w-full max-w-none px-3 sm:px-5 py-6 sm:py-8 pb-24 md:pb-8">
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Produtos importados</p>
          <p className="text-2xl font-black">{totalProducts.toLocaleString('pt-BR')}</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Estoque carregado</p>
          <p className="text-2xl font-black text-indigo-700">{stockItems.length.toLocaleString('pt-BR')}</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Sugestoes geradas</p>
          <p className="text-2xl font-black text-violet-700">{transferSuggestions.length.toLocaleString('pt-BR')}</p>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-5 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          {errorMessage}
        </div>
      )}

      <section className="mt-6 rounded-[28px] border-2 border-slate-100 bg-white p-4 shadow-sm">
        <div className={`flex flex-col xl:flex-row xl:items-center justify-between gap-4 ${showStockScenario ? 'mb-4' : ''}`}>
          <div>
            <h2 className="text-lg font-black uppercase text-slate-900">Cenario de estoque</h2>
            <p className="text-xs font-bold text-slate-500">
              {stockSnapshot
                ? `Ultima importacao: ${new Date(stockSnapshot.imported_at).toLocaleString('pt-BR')} - ${stockSnapshot.source_file || 'arquivo sem nome'}`
                : 'Importe a planilha de estoque/venda media para montar a base de remanejamento.'}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
            {showStockScenario && (
              <div className="relative w-full xl:w-96">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={stockSearchTerm}
                  onChange={(event) => setStockSearchTerm(event.target.value)}
                  placeholder="BUSCAR LOJA, PRODUTO, EAN OU CURVA..."
                  className="w-full h-11 rounded-2xl bg-slate-50 border-2 border-slate-100 pl-11 pr-4 text-xs font-bold outline-none focus:border-violet-600"
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                const nextValue = !showStockScenario;
                setShowStockScenario(nextValue);
                if (nextValue && stockSnapshot && stockItems.length === 0) {
                  loadStockSnapshot(stockSearchTerm, true);
                }
              }}
              className="h-11 shrink-0 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-[10px] font-black uppercase text-slate-700 flex items-center justify-center gap-2 hover:border-violet-200 hover:text-violet-700"
            >
              {showStockScenario ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showStockScenario ? 'Ocultar cenario' : 'Mostrar cenario'}
            </button>
          </div>
        </div>

        {showStockScenario && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-[10px] font-black uppercase text-slate-400">Lojas na amostra</p>
                <p className="text-xl font-black text-slate-900">{stockSummary.stores.toLocaleString('pt-BR')}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-[10px] font-black uppercase text-slate-400">Produtos na amostra</p>
                <p className="text-xl font-black text-slate-900">{stockSummary.products.toLocaleString('pt-BR')}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-[10px] font-black uppercase text-slate-400">Estoque total exibido</p>
                <p className="text-xl font-black text-slate-900">{stockSummary.totalStock.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</p>
              </div>
            </div>

            <div className="max-h-[calc(100vh-260px)] overflow-auto rounded-md border border-slate-300">
              <table className="w-full min-w-[1280px] border-collapse text-sm">
                <thead className="bg-indigo-50 text-[10px] uppercase text-slate-600">
                  <tr>
                    <th className="border border-slate-300 px-3 py-3 text-left">Loja</th>
                    <th className="border border-slate-300 px-3 py-3 text-left">Produto</th>
                    <th className="border border-slate-300 px-3 py-3 text-left">EAN</th>
                    <th className="border border-slate-300 px-3 py-3 text-left">Cod. ERP</th>
                    <th className="border border-slate-300 px-3 py-3 text-right">Estoque</th>
                    <th className="border border-slate-300 px-3 py-3 text-right">Estoque conf.</th>
                    <th className="border border-slate-300 px-3 py-3 text-right">Media mensal</th>
                    <th className="border border-slate-300 px-3 py-3 text-right">Dias estoque</th>
                    <th className="border border-slate-300 px-3 py-3 text-center">Curva</th>
                    <th className="border border-slate-300 px-3 py-3 text-right">Compra conf.</th>
                    <th className="border border-slate-300 px-3 py-3 text-right">Transf. conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {stockItems.map((item) => (
                    <tr key={item.id} className="even:bg-slate-50 hover:bg-indigo-50/70">
                      <td className="border border-slate-200 px-3 py-3 font-black text-slate-900">{item.store_code} - {item.store_name}</td>
                      <td className="border border-slate-200 px-3 py-3 font-bold uppercase text-slate-800">{item.product_description}</td>
                      <td className="border border-slate-200 px-3 py-3 font-mono text-slate-700">{item.ean}</td>
                      <td className="border border-slate-200 px-3 py-3 font-black text-violet-700">{item.erp_code || '-'}</td>
                      <td className="border border-slate-200 px-3 py-3 text-right font-bold">{Number(item.stock || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="border border-slate-200 px-3 py-3 text-right">{Number(item.confirmed_stock || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="border border-slate-200 px-3 py-3 text-right text-blue-700 font-bold">{Number(item.monthly_avg_sales || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="border border-slate-200 px-3 py-3 text-right text-orange-600 font-bold">{wholeNumber(item.stock_days)}</td>
                      <td className="border border-slate-200 px-3 py-3 text-center font-black">{item.curve || '-'}</td>
                      <td className="border border-slate-200 px-3 py-3 text-right">{Number(item.confirmed_purchase || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="border border-slate-200 px-3 py-3 text-right">{Number(item.confirmed_transfer || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {!stockLoading && stockItems.length === 0 && (
                    <tr>
                      <td colSpan={11} className="border border-slate-200 px-3 py-12 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                        Nenhum estoque importado ainda
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="mt-6 rounded-[28px] border-2 border-violet-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-black uppercase text-slate-900">Sugestao de transferencia</h2>
            <p className="text-xs font-bold text-slate-500">
              Ajuste os criterios, gere as sugestoes e revise as quantidades antes de exportar para o ERP.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={generateTransferSuggestions}
              disabled={!stockSnapshot || stockLoading || generatingSuggestions}
              className="h-11 px-4 rounded-2xl bg-violet-600 text-white font-black uppercase text-[10px] flex items-center gap-2 disabled:opacity-40"
            >
              <Shuffle size={16} /> {stockLoading ? 'Carregando...' : generatingSuggestions ? 'Processando...' : 'Gerar sugestoes'}
            </button>
            <button
              type="button"
              onClick={exportSuggestionsTxt}
              disabled={transferSuggestions.length === 0}
              className="h-11 px-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] flex items-center gap-2 disabled:opacity-40"
            >
              <Download size={16} /> Exportar TXT
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <div className="mb-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black uppercase text-slate-900">Filtros da sugestao</h3>
              <p className="text-xs font-bold text-slate-500">Restrinja produto, origem, destino, fabricante ou classificacao antes de gerar a transferencia.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setProductFilters([]);
                setOriginFilters([]);
                setDestinationFilters([]);
                setClassificationFilters([]);
                setManufacturerFilters([]);
              }}
              className="h-10 px-4 rounded-2xl bg-white text-slate-600 border border-slate-200 font-black uppercase text-[10px] flex items-center gap-2"
            >
              <Trash2 size={15} /> Limpar filtros
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
            <QuickFilterBox
              title="Produto"
              columns={['Descricao', 'Codigo ERP', 'EAN', 'Fabricante', 'Classificacao']}
              placeholder="Informe Cod. de Barras, codigo ERP ou descricao"
              options={productOptions}
              selected={productFilters}
              onChange={setProductFilters}
              onQuickSearch={searchProductOptions}
              hideInitialOptions
            />
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
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-4">
            <div>
              <p className="text-[10px] font-black uppercase text-violet-500">Como sugerir</p>
              <p className="text-sm font-bold text-slate-700">Escolha um perfil simples. Lojas de UFs diferentes nao entram na sugestao.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedRules((value) => !value)}
              className="h-10 px-4 rounded-2xl bg-white border border-violet-100 text-violet-700 font-black uppercase text-[10px] flex items-center gap-2"
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
                  className={`rounded-2xl border-2 p-4 text-left transition ${isSelected ? 'border-violet-600 bg-white shadow-sm' : 'border-white bg-white/70 hover:border-violet-200'}`}
                >
                  <span className={`block text-sm font-black uppercase ${isSelected ? 'text-violet-700' : 'text-slate-800'}`}>{preset.label}</span>
                  <span className="mt-1 block text-xs font-bold text-slate-500">{preset.description}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
            <label className="block">
              <span className="text-[10px] font-black uppercase text-violet-500">Estoque de seguranca origem</span>
              <span className="block text-xs font-bold text-slate-500 mt-1">A origem mantem produtos suficientes para esses dias. O que passar disso pode ser transferido.</span>
              <input
                type="range"
                value={originMinimumDays}
                min={0}
                max={90}
                step={1}
                onChange={(event) => setOriginMinimumDays(Number(event.target.value))}
                className="mt-3 w-full accent-violet-600"
              />
            </label>
            <div className="rounded-2xl bg-white border border-violet-100 px-5 py-3 text-center">
              <p className="text-[10px] font-black uppercase text-slate-400">Seguranca</p>
              <p className="text-2xl font-black text-violet-700">{originMinimumDays} dias</p>
            </div>
          </div>

          {showAdvancedRules && (
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
                max={99}
              />
            </div>
          )}
        </div>

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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="rounded-2xl bg-violet-50 border border-violet-100 p-4">
            <p className="text-[10px] font-black uppercase text-violet-400">Transferencias sugeridas</p>
            <p className="text-xl font-black text-violet-900">{transferSuggestions.length.toLocaleString('pt-BR')}</p>
          </div>
          <div className="rounded-2xl bg-violet-50 border border-violet-100 p-4">
            <p className="text-[10px] font-black uppercase text-violet-400">Unidades sugeridas</p>
            <p className="text-xl font-black text-violet-900">{transferSuggestions.reduce((sum, item) => sum + item.quantity, 0).toLocaleString('pt-BR')}</p>
          </div>
          <div className="rounded-2xl bg-violet-50 border border-violet-100 p-4">
            <p className="text-[10px] font-black uppercase text-violet-400">Produtos movimentados</p>
            <p className="text-xl font-black text-violet-900">{new Set(transferSuggestions.map((item) => item.ean)).size.toLocaleString('pt-BR')}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
            <p className="text-[10px] font-black uppercase text-emerald-500">Linhas exportaveis</p>
            <p className="text-xl font-black text-emerald-900">{suggestionExportStats.exportableLines.toLocaleString('pt-BR')}</p>
            <p className="mt-1 text-[10px] font-bold text-emerald-700">{suggestionExportStats.exportableUnits.toLocaleString('pt-BR')} unidades com ERP</p>
          </div>
          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
            <p className="text-[10px] font-black uppercase text-amber-500">Pendentes de ERP</p>
            <p className="text-xl font-black text-amber-900">{suggestionExportStats.missingErpCodeLines.toLocaleString('pt-BR')}</p>
            <p className="mt-1 text-[10px] font-bold text-amber-700">nao entram no TXT</p>
          </div>
          <div className="rounded-2xl bg-red-50 border border-red-100 p-4">
            <p className="text-[10px] font-black uppercase text-red-500">Origem excedida</p>
            <p className="text-xl font-black text-red-900">{overAllocatedOrigins.length.toLocaleString('pt-BR')}</p>
            <p className="mt-1 text-[10px] font-bold text-red-700">bloqueia exportacao</p>
          </div>
        </div>

        {overAllocatedOrigins.length > 0 && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
            Existem produtos com soma de transferencias maior que o estoque da origem. Ajuste as linhas em vermelho antes de exportar.
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Arraste cabeçalhos para ordenar. Puxe a borda direita para ajustar largura.
          </p>
          <button
            type="button"
            onClick={resetSuggestionColumns}
            className="h-9 rounded-xl bg-slate-100 px-4 text-[10px] font-black uppercase text-slate-600"
          >
            Restaurar colunas
          </button>
        </div>

        <div className="max-h-[calc(100vh-240px)] overflow-auto rounded-md border border-slate-300">
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
    <label className="rounded-2xl border border-violet-100 bg-violet-50/60 p-3">
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
        className="mt-2 h-10 w-full rounded-xl border-2 border-white bg-white px-3 text-sm font-black text-slate-900 outline-none [appearance:textfield] focus:border-violet-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

function DiagnosticCard({ label, value, suffix = '', accent = false, warning = false }: { label: string; value: number; suffix?: string; accent?: boolean; warning?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${warning ? 'border-amber-200 bg-amber-50' : accent ? 'border-violet-200 bg-violet-50' : 'border-slate-100 bg-slate-50'}`}>
      <p className={`text-[9px] font-black uppercase ${warning ? 'text-amber-500' : accent ? 'text-violet-500' : 'text-slate-400'}`}>{label}</p>
      <p className={`text-lg font-black ${warning ? 'text-amber-800' : accent ? 'text-violet-900' : 'text-slate-900'}`}>
        {value.toLocaleString('pt-BR')}{suffix}
      </p>
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
}) {
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
    <div className={`${expanded ? 'md:col-span-2' : ''} overflow-hidden rounded-2xl border-2 ${selected.length ? 'border-violet-200 bg-violet-50/40' : 'border-slate-100 bg-slate-50'} text-slate-950 min-h-[126px] transition-colors`}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full h-11 px-4 flex items-center justify-between text-left border-b border-slate-200 bg-white"
      >
        <span className="text-[11px] font-black uppercase tracking-widest leading-none text-slate-700">{title}</span>
        <span className={`w-8 h-8 rounded-xl border flex items-center justify-center ${selected.length ? 'bg-violet-600 border-violet-600 text-white' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
          <Filter size={12} />
        </span>
      </button>

      {!expanded ? (
        <div className="h-[82px] flex flex-col items-center justify-center gap-1 px-4 text-center">
          <span className={`text-sm font-bold ${selected.length ? 'text-violet-700' : 'text-slate-500'}`}>{summary}</span>
          {selectedPreview && <span className="max-w-full truncate text-[11px] font-bold text-slate-500">{selectedPreview}</span>}
        </div>
      ) : (
        <div className="bg-white">
          <div className="p-3 grid grid-cols-1 md:grid-cols-[1fr_44px] items-center gap-2 border-b border-slate-200 bg-slate-50">
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
                className="h-10 w-full rounded-xl border-2 border-slate-200 bg-white px-3 pr-20 text-sm font-bold outline-none focus:border-violet-500"
              />
              {searching && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
                  buscando
                </span>
              )}
            </div>
            <button type="button" onClick={addQuickValue} className="h-10 w-full md:w-11 rounded-xl bg-violet-600 text-white flex items-center justify-center">
              <Plus size={14} />
            </button>
          </div>

          <div className="max-h-80 overflow-auto border-b border-slate-200 bg-white p-2">
            {visibleOptions.filter((item) => !selected.some((current) => current.id === item.id)).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addItem(item)}
                className="mb-1 grid w-full grid-cols-[1fr_auto] gap-3 rounded-xl border border-transparent px-3 py-2 text-left hover:border-violet-200 hover:bg-violet-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-slate-900">{item.columns[0] || item.id}</span>
                  <span className="mt-1 block truncate text-[11px] font-bold text-slate-500">
                    {columns.slice(1).map((column, index) => `${column}: ${item.columns[index + 1] || '-'}`).join(' | ')}
                  </span>
                </span>
                <Plus size={16} className="mt-1 text-violet-600" />
              </button>
            ))}
            {visibleOptions.filter((item) => !selected.some((current) => current.id === item.id)).length === 0 && (
              <div className="flex h-24 items-center justify-center rounded-xl bg-slate-50 px-4 text-center text-xs font-bold text-slate-400">
                {searching ? 'Buscando...' : normalizedQuickValue ? (allowManual ? 'Nenhum resultado. Aperte + para usar o texto digitado.' : 'Nenhum resultado direto.') : 'Digite pelo menos 2 caracteres para buscar.'}
              </div>
            )}
          </div>

          {selected.length > 0 && (
            <div className="border-b border-slate-200 bg-violet-50/70 p-3">
              <p className="mb-2 text-[10px] font-black uppercase text-violet-500">Selecionados</p>
              <div className="flex flex-wrap gap-2">
                {selected.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChange(selected.filter((current) => current.id !== item.id))}
                    className="inline-flex max-w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-violet-700 shadow-sm"
                    title="Remover filtro"
                  >
                    <span className="max-w-52 truncate">{item.columns[0]}</span>
                    <X size={13} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-3 flex flex-wrap justify-between gap-2 bg-white">
            <button type="button" onClick={removeLast} disabled={selected.length === 0} className="h-10 px-4 rounded-xl bg-slate-100 text-xs font-black uppercase text-slate-600 disabled:text-slate-300">
              Remover ultimo
            </button>
            <button type="button" onClick={() => onChange([])} disabled={selected.length === 0} className="h-10 px-4 rounded-xl bg-slate-100 text-xs font-black uppercase text-slate-600 disabled:text-slate-300">
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
