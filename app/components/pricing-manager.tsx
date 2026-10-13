'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { AlertTriangle, BarChart3, Building2, Check, Download, Edit3, Eye, EyeOff, FileSpreadsheet, Filter, FilterX, PackagePlus, RefreshCw, Save, Search, Tags, Trash2, X } from 'lucide-react';
import {
  deletePricingBranch,
  deletePricingRule,
  fetchPricingBranches,
  fetchPricingProducts,
  fetchPricingRules,
  fetchReallocationAttributeOptions,
  fetchReallocationAttributeSummary,
  fetchReallocationProducts,
  savePricingBranch,
  savePricingProduct,
  savePricingRule,
  type PricingBranchInput,
  type PricingProductInput,
} from '@/lib/api';
import { MultiCheckboxFilter } from '@/app/components/multi-checkbox-filter';
import { getAuthHeaders } from '@/lib/auth-headers';
import type { DiscountMode, PricingBranch, PricingProduct, PricingRule, PricingRuleBasis, PricingRuleScope, ReallocationProduct } from '@/lib/types';

const COMPETITORS = ['TEM TUDO', 'BEM POPULAR', 'EXTRAFARMA', 'DROGASIL', 'AMERICANAS'];
const PRICING_HIDDEN_GROUPS_STORAGE_KEY = 'wally-pricing-hidden-groups';
const LEGACY_PRICING_RULES_STORAGE_KEY = 'wally-pricing-rules';
const EXPORT_OPTIONS = [
  { id: 'full_table', label: 'Tabela completa' },
  { id: 'branch_prices', label: 'PreÃ§os por filial' },
  { id: 'month_end_price', label: 'Fecha mÃªs' },
  { id: 'baby_wednesday_price', label: 'Quarta da Fralda' },
  { id: 'sale_price', label: 'Novo PreÃ§o' },
  { id: 'purchase_price', label: 'PreÃ§o' },
  { id: 'final_price', label: 'Custo LanÃ§ado (calculado)' },
] as const;

const COLUMN_OPTIONS = [
  { value: 'select', label: 'SeleÃ§Ã£o' },
  { value: 'index', label: '#' },
  { value: 'product', label: 'DescriÃ§Ã£o' },
  { value: 'competitors', label: 'Concorrentes' },
  { value: 'purchase_price', label: 'Preco' },
  { value: 'sell_in', label: 'Sell-in' },
  { value: 'calculation', label: 'Calculo' },
  { value: 'sell_out', label: 'Sell-out' },
  { value: 'trade', label: 'Trade' },
  { value: 'real_cost', label: 'Custo Real' },
  { value: 'launched_cost', label: 'Custo Lancado' },
  { value: 'sale_price', label: 'Novo Preco' },
  { value: 'baby_wednesday_price', label: 'Quarta da Fralda' },
  { value: 'month_end_price', label: 'Fecha mes' },
  { value: 'branches', label: 'Filiais' },
  { value: 'markup', label: 'Markup' },
  { value: 'actions', label: 'AÃ§Ãµes' },
];

const DEFAULT_VISIBLE_COLUMNS = COLUMN_OPTIONS
  .filter((column) => !['competitors', 'branches'].includes(column.value))
  .map((column) => column.value);

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  select: 44,
  index: 38,
  product: 390,
  competitors: 86,
  purchase_price: 86,
  sell_in: 72,
  calculation: 86,
  sell_out: 76,
  trade: 72,
  real_cost: 90,
  launched_cost: 96,
  sale_price: 90,
  baby_wednesday_price: 108,
  month_end_price: 86,
  branches: 96,
  markup: 72,
  actions: 76,
};

const HEADER_COLORS: Record<string, string> = {
  real_cost: '#059669',
  launched_cost: '#059669',
  sale_price: '#2563eb',
  baby_wednesday_price: '#d97706',
  month_end_price: '#d97706',
  markup: '#2563eb',
};

const blankProduct: PricingProductInput = {
  ean: '',
  description: '',
  brand: '',
  purchase_price: 0,
  sell_in_value: 0,
  sell_in_mode: 'currency',
  sell_out_value: 0,
  sell_out_mode: 'currency',
  trade_value: 0,
  trade_mode: 'percent',
  sale_price: 0,
  baby_wednesday_price: 0,
  month_end_price: 0,
  competitor_prices: Object.fromEntries(COMPETITORS.map((item) => [item, 0])),
  store_prices: {},
  promotion_group: '',
  is_active: true,
};

const blankBranch: PricingBranchInput = {
  name: '',
  code: '',
  city: '',
  legal_name: '',
  uf: '',
  cnpj: '',
  logistics_group: '',
  sends_stock: true,
  receives_stock: true,
  is_active: true,
};

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function discount(base: number, value: number, mode: DiscountMode) {
  return mode === 'percent' ? base * (value / 100) : value;
}

function finalPrice(product: PricingProduct | PricingProductInput) {
  return Math.max(
    0,
    product.purchase_price -
      discount(product.purchase_price, product.sell_in_value, product.sell_in_mode) -
      discount(product.purchase_price, product.sell_out_value, product.sell_out_mode) -
      discount(product.purchase_price, product.trade_value, product.trade_mode),
  );
}

function markup(product: PricingProduct | PricingProductInput) {
  const final = finalPrice(product);
  if (!final) return 0;
  return ((product.sale_price - final) / final) * 100;
}

function numericValue(value: string) {
  return Number(value.replace(',', '.')) || 0;
}

function editableNumber(value: string | number) {
  if (typeof value === 'number') return value === 0 ? '' : String(value).replace('.', ',');
  return value;
}

function serializeCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\n');
}

type PriceExportType = 'A' | 'B';
type TxtPriceSource = 'sale_price' | 'baby_wednesday_price' | 'month_end_price' | 'branch_price';

interface PricingCityCluster {
  id: string;
  code: string;
  name: string;
  branchCodes: string[];
  branchNames: string[];
}


type PricingRuleDraft = Omit<PricingRule, 'id' | 'created_at' | 'updated_at' | 'created_by'> & { id?: string };
type ImportedPricingProductInput = PricingProductInput & { classification_path?: string };

interface PricingProductGroup {
  id: string;
  description: string;
  descriptions: string[];
  brand: string;
  classification: string;
  brands: string[];
  classifications: string[];
  promotionGroup: string;
  promotionGroups: string[];
  products: PricingProduct[];
  primaryProduct: PricingProduct;
  eans: string[];
  erpCodes: string[];
}

function normalizeKey(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

const PRODUCT_VARIANT_SUFFIXES = new Set([
  'ABACAXI',
  'BANANA',
  'BAUNILHA',
  'CHOCOLATE',
  'COCO',
  'COOKIES',
  'CREAM',
  'FRUTAS',
  'LARANJA',
  'LIMAO',
  'LIMÃƒO',
  'MANGA',
  'MENTA',
  'MORANGO',
  'NEUTRO',
  'ORIGINAL',
  'UVA',
]);

function productFamilyDescription(value: string) {
  const normalized = normalizeKey(value)
    .replace(/[.,;:]+/g, ' ')
    .replace(/\b(P\/M|G\/XG|P-M|G-XG|RN|PP|P|M|G|GG|XG|XXG|XGG|EXG|EG)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = normalized.split(' ').filter(Boolean);
  while (parts.length > 2 && PRODUCT_VARIANT_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }

  return parts.join(' ') || normalizeKey(value);
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function includesNormalized(values: string[], selectedValues: string[]) {
  if (selectedValues.length === 0) return true;
  const normalizedValues = new Set(values.filter(Boolean).map(normalizeSearchText));
  return selectedValues.some((selectedValue) => {
    const normalizedSelected = normalizeSearchText(selectedValue);
    return Array.from(normalizedValues).some((normalizedValue) => (
      normalizedValue === normalizedSelected ||
      (normalizedValue.length >= 3 && normalizedSelected.includes(normalizedValue)) ||
      (normalizedSelected.length >= 3 && normalizedValue.includes(normalizedSelected))
    ));
  });
}

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface ClassificationParts {
  line: string;
  department: string;
  category: string;
}

function splitClassificationPath(value: string): ClassificationParts {
  const parts = value
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean);

  if (normalizeSearchText(parts[0] || '') === 'principal') {
    return {
      line: parts[1] || '',
      department: parts.length >= 4 ? parts[2] || '' : '',
      category: parts.length >= 4 ? parts.slice(3).join(' > ') : parts.slice(2).join(' > '),
    };
  }

  if (parts.length >= 3) {
    return {
      line: parts[0] || '',
      department: parts[1] || '',
      category: parts.slice(2).join(' > '),
    };
  }

  if (parts.length === 2) {
    return {
      line: parts[0] || '',
      department: parts[1] || '',
      category: '',
    };
  }

  return {
    line: value.trim(),
    department: '',
    category: '',
  };
}

function classificationMatchesFilters(
  classifications: string[],
  lineFilters: string[],
  departmentFilters: string[],
  categoryFilters: string[],
) {
  if (!lineFilters.length && !departmentFilters.length && !categoryFilters.length) return true;

  return classifications.some((classification) => {
    const parts = splitClassificationPath(classification);
    return includesNormalized([parts.line], lineFilters)
      && includesNormalized([parts.department], departmentFilters)
      && includesNormalized([parts.category], categoryFilters);
  });
}

function canonicalizeAttributeOptions(values: string[]) {
  const uniqueValues = Array.from(new Set(values.filter(Boolean).map((value) => value.trim()).filter(Boolean)));
  return uniqueValues
    .filter((value) => {
      const normalizedValue = normalizeSearchText(value);
      if (normalizedValue.length < 3) return true;
      return !uniqueValues.some((candidate) => {
        const normalizedCandidate = normalizeSearchText(candidate);
        return normalizedCandidate !== normalizedValue &&
          normalizedCandidate.length > normalizedValue.length &&
          normalizedCandidate.includes(normalizedValue);
      });
    })
    .sort();
}

function canonicalAttribute(value: string, canonicalOptions: string[]) {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) return value;
  return canonicalOptions.find((option) => {
    const normalizedOption = normalizeSearchText(option);
    return normalizedOption === normalizedValue ||
      (normalizedValue.length >= 3 && normalizedOption.includes(normalizedValue)) ||
      (normalizedOption.length >= 3 && normalizedValue.includes(normalizedOption));
  }) || value;
}

function downloadTextFile(filename: string, content: string, type = 'text/plain;charset=utf-8;') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatTxtNumber(value: number) {
  return Number(value || 0).toFixed(2);
}

function blankPricingRuleDraft(): PricingRuleDraft {
  return {
    name: '',
    scope: 'all',
    scopeValue: '',
    targetMarkup: 25,
    minMarkup: 15,
    competitorBuffer: 2,
    basis: 'cost',
    active: true,
  };
}

function loadLegacyPricingRules() {
  if (typeof window === 'undefined') return [] as PricingRule[];

  try {
    const stored = window.localStorage.getItem(LEGACY_PRICING_RULES_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((rule): rule is PricingRule => Boolean(rule && typeof rule === 'object' && typeof rule.name === 'string'))
      .map((rule) => ({
        id: String(rule.id || ('pricing-rule-' + Date.now() + '-' + Math.random().toString(36).slice(2))),
        name: String(rule.name || '').toUpperCase(),
        scope: (['all', 'brand', 'line', 'department', 'category', 'quote_group'] as PricingRuleScope[]).includes(rule.scope) ? rule.scope : 'all',
        scopeValue: String(rule.scopeValue || '').toUpperCase(),
        targetMarkup: Number(rule.targetMarkup || 0),
        minMarkup: Number(rule.minMarkup || 0),
        competitorBuffer: Number(rule.competitorBuffer || 0),
        basis: (['cost', 'lowest_competitor', 'average_competitor'] as PricingRuleBasis[]).includes(rule.basis) ? rule.basis : 'cost',
        active: rule.active !== false,
      }));
  } catch {
    return [];
  }
}

function normalizeCityCode(value: string) {
  return normalizeKey(value || 'SEM CIDADE');
}

function cityPriceForProduct(product: Pick<PricingProduct, 'sale_price' | 'store_prices'> | Pick<PricingProductInput, 'sale_price' | 'store_prices'>, city: PricingCityCluster | null) {
  if (!city) return Number(product.sale_price || 0);

  const cityValues = city.branchCodes
    .map((code) => Number(product.store_prices?.[code] || 0))
    .filter((value) => value > 0);

  return cityValues[0] || Number(product.sale_price || 0);
}

function roundPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

function competitorValues(product: Pick<PricingProductInput, 'competitor_prices'> | Pick<PricingProduct, 'competitor_prices'>) {
  return Object.values(product.competitor_prices || {})
    .map((value) => Number(value || 0))
    .filter((value) => value > 0);
}

function suggestedPriceByRule(product: PricingProductInput, rule: PricingRule) {
  const cost = finalPrice(product);
  const competitors = competitorValues(product);
  const costPrice = cost * (1 + Number(rule.targetMarkup || 0) / 100);
  const minPrice = cost * (1 + Number(rule.minMarkup || 0) / 100);
  let referencePrice = costPrice;

  if (rule.basis === 'lowest_competitor' && competitors.length > 0) {
    referencePrice = Math.min(...competitors) * (1 - Number(rule.competitorBuffer || 0) / 100);
  }

  if (rule.basis === 'average_competitor' && competitors.length > 0) {
    referencePrice = (competitors.reduce((sum, value) => sum + value, 0) / competitors.length) * (1 - Number(rule.competitorBuffer || 0) / 100);
  }

  return roundPrice(Math.max(referencePrice, minPrice));
}

export function PricingManager() {
  const [products, setProducts] = useState<PricingProduct[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<ReallocationProduct[]>([]);
  const [catalogManufacturers, setCatalogManufacturers] = useState<string[]>([]);
  const [catalogClassifications, setCatalogClassifications] = useState<string[]>([]);
  const [branches, setBranches] = useState<PricingBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [productFilterInput, setProductFilterInput] = useState('');
  const [productFilterIds, setProductFilterIds] = useState<string[]>([]);
  const [priceStatusFilter, setPriceStatusFilter] = useState<'all' | 'priced' | 'missing' | 'negative'>('all');
  const [activeStatusFilter, setActiveStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [hiddenGroupIds, setHiddenGroupIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = window.localStorage.getItem(PRICING_HIDDEN_GROUPS_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  const [brandFilters, setBrandFilters] = useState<string[]>([]);
  const [lineFilters, setLineFilters] = useState<string[]>([]);
  const [departmentFilters, setDepartmentFilters] = useState<string[]>([]);
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [branchFilters, setBranchFilters] = useState<string[]>([]);
  const [promotionGroupFilters, setPromotionGroupFilters] = useState<string[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [pricingRulesLoading, setPricingRulesLoading] = useState(false);
  const [pricingRulesMissingTable, setPricingRulesMissingTable] = useState(false);
  const [pricingRulesError, setPricingRulesError] = useState('');
  const [showPricingRules, setShowPricingRules] = useState(false);
  const [editingPricingRule, setEditingPricingRule] = useState<PricingRuleDraft>(() => blankPricingRuleDraft());
  const [activeBranchCode, setActiveBranchCode] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [showBranches, setShowBranches] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PricingProductInput | null>(null);
  const [productLaunchSearch, setProductLaunchSearch] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedLaunchBranchCodes, setSelectedLaunchBranchCodes] = useState<string[]>([]);
  const [editingBranch, setEditingBranch] = useState<PricingBranchInput | null>(null);
  const [exportPrice, setExportPrice] = useState<(typeof EXPORT_OPTIONS)[number]['id']>('full_table');
  const [showExportModal, setShowExportModal] = useState(false);
  const [txtExportType, setTxtExportType] = useState<PriceExportType>('A');
  const [txtPriceSource, setTxtPriceSource] = useState<TxtPriceSource>('branch_price');
  const [txtBranchCode, setTxtBranchCode] = useState('');
  const [txtDiscountPercent, setTxtDiscountPercent] = useState(50);
  const [showPriceResults, setShowPriceResults] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resizingColumnRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(PRICING_HIDDEN_GROUPS_STORAGE_KEY, JSON.stringify(hiddenGroupIds));
  }, [hiddenGroupIds]);

  const loadCatalogProducts = useCallback(async () => {
    try {
      const data = await fetchReallocationProducts({ limit: 1000 });
      setCatalogProducts(data);
    } catch {
      setCatalogProducts([]);
    }
  }, []);

  const mergeCatalogProducts = useCallback((rows: ReallocationProduct[]) => {
    if (rows.length === 0) return;

    setCatalogProducts((current) => {
      const byKey = new Map<string, ReallocationProduct>();
      [...current, ...rows].forEach((product) => {
        const key = product.id || product.ean || `${product.erp_code}:${product.description}`;
        byKey.set(key, product);
      });
      return Array.from(byKey.values());
    });
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPricingProducts();
      setProducts(data);
      setErrorMessage('');
    } catch {
      setProducts([]);
      setErrorMessage('Tabela de precificaÃ§Ã£o nÃ£o encontrada. Rode o SQL enviado para ativar esta Ã¡rea.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const data = await fetchPricingBranches();
      setBranches(data);
    } catch {
      setBranches([]);
    }
  }, []);

  const loadCatalogAttributes = useCallback(async () => {
    try {
      const [quickManufacturers, quickClassifications] = await Promise.all([
        fetchReallocationAttributeOptions('manufacturer', '', 500).catch(() => []),
        fetchReallocationAttributeOptions('classification', '', 500).catch(() => []),
      ]);
      setCatalogManufacturers((current) => Array.from(new Set([
        ...current,
        ...quickManufacturers,
      ].filter(Boolean))).sort());
      setCatalogClassifications((current) => Array.from(new Set([
        ...current,
        ...quickClassifications,
      ].filter(Boolean))).sort());

      const [manufacturerRows, classificationRows] = await Promise.all([
        fetchReallocationAttributeSummary('manufacturer').catch(() => []),
        fetchReallocationAttributeSummary('classification').catch(() => []),
      ]);
      setCatalogManufacturers(Array.from(new Set([
        ...quickManufacturers,
        ...manufacturerRows.map((item) => item.value),
      ].filter(Boolean))).sort());
      setCatalogClassifications(Array.from(new Set([
        ...quickClassifications,
        ...classificationRows.map((item) => item.value),
      ].filter(Boolean))).sort());
    } catch (error) {
      console.error('Erro ao carregar filtros da base mestre:', error);
      setCatalogManufacturers([]);
      setCatalogClassifications([]);
    }
  }, []);

  const loadPricingRulesFromApi = useCallback(async () => {
    setPricingRulesLoading(true);
    try {
      const data = await fetchPricingRules();
      setPricingRulesMissingTable(data.missingTable);
      setPricingRulesError('');

      if (!data.missingTable && data.rules.length === 0) {
        const legacyRules = loadLegacyPricingRules();
        if (legacyRules.length > 0) {
          const migratedRules: PricingRule[] = [];
          for (const legacyRule of legacyRules) {
            const { id: _legacyId, ...ruleInput } = legacyRule;
            void _legacyId;
            migratedRules.push(await savePricingRule(ruleInput));
          }
          window.localStorage.removeItem(LEGACY_PRICING_RULES_STORAGE_KEY);
          setPricingRules(migratedRules);
          return;
        }
      }

      setPricingRules(data.rules);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nao foi possivel carregar regras de preco.';
      setPricingRulesError(message);
      setPricingRules([]);
    } finally {
      setPricingRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadProducts();
      void loadBranches();
      void loadCatalogProducts();
      void loadPricingRulesFromApi();
    });
  }, [loadBranches, loadCatalogProducts, loadPricingRulesFromApi, loadProducts]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadCatalogAttributes();
    });
  }, [loadCatalogAttributes]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadProducts();
      void loadBranches();
      void loadCatalogProducts();
      void loadCatalogAttributes();
      void loadPricingRulesFromApi();
    };

    window.addEventListener('wally:app-refresh', handleRefresh);
    return () => window.removeEventListener('wally:app-refresh', handleRefresh);
  }, [loadBranches, loadCatalogAttributes, loadCatalogProducts, loadPricingRulesFromApi, loadProducts]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (editingProduct) {
        setEditingProduct(null);
        return;
      }
      if (editingBranch) {
        setEditingBranch(null);
        return;
      }
      if (showExportModal) {
        setShowExportModal(false);
        return;
      }
      if (showBranches) {
        setShowBranches(false);
        return;
      }
      if (productFilterInput) {
        setProductFilterInput('');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editingBranch, editingProduct, productFilterInput, showBranches, showExportModal]);

  const brands = useMemo(() => canonicalizeAttributeOptions([
    ...products.map((item) => item.brand).filter(Boolean),
    ...catalogProducts.map((item) => item.manufacturer).filter(Boolean),
    ...catalogManufacturers,
  ]), [catalogManufacturers, catalogProducts, products]);
  const promotionGroups = useMemo(() => canonicalizeAttributeOptions(products.map((item) => item.promotion_group || '').filter(Boolean)), [products]);
  const classifications = useMemo(() => canonicalizeAttributeOptions([
    ...catalogProducts.map((item) => item.classification).filter(Boolean),
    ...catalogClassifications,
  ]), [catalogClassifications, catalogProducts]);
  const classificationParts = useMemo(() => (
    classifications.map((classification) => ({
      raw: classification,
      ...splitClassificationPath(classification),
    }))
  ), [classifications]);
  const lineOptions = useMemo(() => canonicalizeAttributeOptions(
    classificationParts.map((item) => item.line).filter(Boolean),
  ), [classificationParts]);
  const departmentOptions = useMemo(() => canonicalizeAttributeOptions(
    classificationParts
      .filter((item) => includesNormalized([item.line], lineFilters))
      .map((item) => item.department)
      .filter(Boolean),
  ), [classificationParts, lineFilters]);
  const categoryOptions = useMemo(() => canonicalizeAttributeOptions(
    classificationParts
      .filter((item) => includesNormalized([item.line], lineFilters))
      .filter((item) => includesNormalized([item.department], departmentFilters))
      .map((item) => item.category)
      .filter(Boolean),
  ), [classificationParts, departmentFilters, lineFilters]);
  const classificationLookupTerms = useMemo(() => {
    if (categoryFilters.length > 0) return categoryFilters;
    if (departmentFilters.length > 0) return departmentFilters;
    return lineFilters;
  }, [categoryFilters, departmentFilters, lineFilters]);
  useEffect(() => {
    queueMicrotask(() => {
      setDepartmentFilters((current) => {
        const next = current.filter((value) => departmentOptions.includes(value));
        return sameStringList(current, next) ? current : next;
      });
      setCategoryFilters((current) => {
        const next = current.filter((value) => categoryOptions.includes(value));
        return sameStringList(current, next) ? current : next;
      });
    });
  }, [categoryOptions, departmentOptions]);

  useEffect(() => {
    if (classificationLookupTerms.length === 0 && brandFilters.length === 0) return;

    let cancelled = false;
    fetchReallocationProducts({
      classifications: classificationLookupTerms,
      manufacturers: brandFilters,
      limit: 5000,
    })
      .then((rows) => {
        if (!cancelled) mergeCatalogProducts(rows);
      })
      .catch(() => {
        if (!cancelled) mergeCatalogProducts([]);
      });

    return () => {
      cancelled = true;
    };
  }, [brandFilters, classificationLookupTerms, mergeCatalogProducts]);

  useEffect(() => {
    const searchTerms = Array.from(new Set([productFilterInput, productLaunchSearch]
      .map((term) => term.trim())
      .filter((term) => {
        const digitTerm = term.replace(/\D/g, '');
        return term.length >= 3 || digitTerm.length >= 6;
      })));

    if (searchTerms.length === 0) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void Promise.all(searchTerms.map((searchTerm) => fetchReallocationProducts(searchTerm, 300).catch(() => [])))
        .then((results) => {
          if (!cancelled) mergeCatalogProducts(results.flat());
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [mergeCatalogProducts, productFilterInput, productLaunchSearch]);

  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches]);
  const activeCityClusters = useMemo<PricingCityCluster[]>(() => {
    const cityMap = new Map<string, PricingCityCluster>();

    activeBranches.forEach((branch) => {
      const cityName = (branch.city || 'SEM CIDADE').trim().toUpperCase();
      const code = normalizeCityCode(cityName);
      const current = cityMap.get(code) || { id: code, code, name: cityName, branchCodes: [], branchNames: [] };
      current.branchCodes.push(branch.code);
      current.branchNames.push(branch.name);
      cityMap.set(code, current);
    });

    return Array.from(cityMap.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [activeBranches]);
  const selectedBranch = useMemo(() => activeCityClusters.find((city) => city.code === activeBranchCode) || null, [activeBranchCode, activeCityClusters]);
  const displayPrice = useCallback((product: PricingProduct) => (activeBranchCode ? cityPriceForProduct(product, selectedBranch) : product.sale_price), [activeBranchCode, selectedBranch]);
  const catalogByEan = useMemo(() => new Map(catalogProducts.filter((item) => item.ean).map((item) => [item.ean, item])), [catalogProducts]);
  const catalogByDescription = useMemo(() => new Map(catalogProducts.map((item) => [normalizeKey(item.description), item])), [catalogProducts]);
  const catalogItemsByDescription = useMemo(() => {
    const map = new Map<string, ReallocationProduct[]>();
    catalogProducts.forEach((product) => {
      const key = normalizeKey(product.description);
      const current = map.get(key) || [];
      current.push(product);
      map.set(key, current);
    });
    return map;
  }, [catalogProducts]);
  const masterProductInfo = useCallback((product: PricingProduct) => {
    const catalogProduct = catalogByEan.get(product.ean) || catalogByDescription.get(normalizeKey(product.description));
    return {
      ean: catalogProduct?.ean || product.ean,
      description: catalogProduct?.description || product.description,
      brand: catalogProduct?.manufacturer || product.brand,
      classification: catalogProduct?.classification || '',
      erpCode: catalogProduct?.erp_code || '',
    };
  }, [catalogByDescription, catalogByEan]);
  const tableProducts = useMemo<PricingProduct[]>(() => {
    const pricingEans = new Set(products.map((product) => product.ean).filter(Boolean));
    const pricingDescriptions = new Set(products.map((product) => normalizeKey(product.description)));
    const catalogOnlyProducts = catalogProducts
      .filter((product) => !pricingEans.has(product.ean) && !pricingDescriptions.has(normalizeKey(product.description)))
      .map((product) => ({
        id: `catalog:${product.id}`,
        ean: product.ean,
        description: product.description,
        brand: product.manufacturer,
        purchase_price: 0,
        sell_in_value: 0,
        sell_in_mode: 'currency' as DiscountMode,
        sell_out_value: 0,
        sell_out_mode: 'currency' as DiscountMode,
        trade_value: 0,
        trade_mode: 'percent' as DiscountMode,
        sale_price: 0,
        baby_wednesday_price: 0,
        month_end_price: 0,
        competitor_prices: Object.fromEntries(COMPETITORS.map((item) => [item, 0])),
        store_prices: {},
        promotion_group: '',
        is_active: true,
      }));

    return [...products, ...catalogOnlyProducts].sort((left, right) => left.description.localeCompare(right.description));
  }, [catalogProducts, products]);
  const productGroups = useMemo<PricingProductGroup[]>(() => {
    const groups = new Map<string, PricingProductGroup>();

    tableProducts.forEach((product) => {
      const master = masterProductInfo(product);
      const exactDescriptionKey = normalizeKey(master.description || product.description);
      const familyDescription = productFamilyDescription(master.description || product.description);
      const canonicalBrand = canonicalAttribute(master.brand || product.brand, brands);
      const key = `${canonicalBrand ? normalizeKey(canonicalBrand) : 'SEM_MARCA'}::${familyDescription}`;
      const relatedCatalogItems = catalogItemsByDescription.get(exactDescriptionKey) || [];
      const existing = groups.get(key);
      const eans = new Set(existing?.eans || []);
      const erpCodes = new Set(existing?.erpCodes || []);
      const brandSet = new Set(existing?.brands || []);
      const classifications = new Set(existing?.classifications || []);
      const promotionGroups = new Set(existing?.promotionGroups || []);
      const descriptions = new Set(existing?.descriptions || []);

      if (master.ean) eans.add(master.ean);
      if (product.ean) eans.add(product.ean);
      if (master.erpCode) {
        erpCodes.add(master.erpCode);
      }
      if (master.brand) brandSet.add(master.brand);
      if (product.brand) brandSet.add(product.brand);
      if (master.classification) classifications.add(master.classification);
      if (product.promotion_group) promotionGroups.add(product.promotion_group);
      if (master.description) descriptions.add(master.description);
      if (product.description) descriptions.add(product.description);

      relatedCatalogItems.forEach((item) => {
        if (item.ean) eans.add(item.ean);
        if (item.erp_code) erpCodes.add(item.erp_code);
        if (item.manufacturer) brandSet.add(item.manufacturer);
        if (item.classification) classifications.add(item.classification);
        if (item.description) descriptions.add(item.description);
      });

      if (!existing) {
        const brandList = Array.from(new Set(Array.from(brandSet).map((value) => canonicalAttribute(value, brands)))).sort();
        const classificationList = Array.from(classifications).sort();
        const promotionGroupList = Array.from(promotionGroups).sort();
        groups.set(key, {
          id: key,
          description: familyDescription,
          descriptions: Array.from(descriptions).sort(),
          brand: brandList[0] || master.brand || product.brand,
          classification: classificationList[0] || master.classification,
          brands: brandList,
          classifications: classificationList,
          promotionGroup: promotionGroupList[0] || product.promotion_group || '',
          promotionGroups: promotionGroupList,
          products: [product],
          primaryProduct: product,
          eans: Array.from(eans).sort(),
          erpCodes: Array.from(erpCodes).sort(),
        });
        return;
      }

      const shouldPromote = existing.primaryProduct.id.startsWith('catalog:') && !product.id.startsWith('catalog:');
      const brandList = Array.from(new Set(Array.from(brandSet).map((value) => canonicalAttribute(value, brands)))).sort();
      const classificationList = Array.from(classifications).sort();
      const promotionGroupList = Array.from(promotionGroups).sort();
      groups.set(key, {
        ...existing,
        brand: existing.brand || brandList[0] || master.brand || product.brand,
        classification: existing.classification || classificationList[0] || master.classification,
        descriptions: Array.from(descriptions).sort(),
        brands: brandList,
        classifications: classificationList,
        promotionGroup: existing.promotionGroup || promotionGroupList[0] || product.promotion_group || '',
        promotionGroups: promotionGroupList,
        products: [...existing.products, product],
        primaryProduct: shouldPromote ? product : existing.primaryProduct,
        eans: Array.from(eans).sort(),
        erpCodes: Array.from(erpCodes).sort(),
      });
    });

    return Array.from(groups.values()).sort((left, right) => left.description.localeCompare(right.description));
  }, [brands, catalogItemsByDescription, masterProductInfo, tableProducts]);
  const tableBranches = useMemo(() => {
    if (branchFilters.length === 0) return activeCityClusters;
    const selected = new Set(branchFilters);
    return activeCityClusters.filter((city) => selected.has(city.code));
  }, [activeCityClusters, branchFilters]);
  const isColumnVisible = useCallback((column: string) => visibleColumns.includes(column), [visibleColumns]);
  const showCompetitors = isColumnVisible('competitors');
  const showBranchColumns = isColumnVisible('branches') || branchFilters.length > 0;
  const visibleTableColumnCount = useMemo(() => {
    return visibleColumns.reduce((total, column) => {
      if (column === 'competitors') return total + COMPETITORS.length;
      if (column === 'branches') return total + tableBranches.length;
      return total + 1;
    }, branchFilters.length > 0 && !visibleColumns.includes('branches') ? tableBranches.length : 0);
  }, [branchFilters.length, tableBranches.length, visibleColumns]);
  const getColumnWidth = useCallback((key: string, baseKey = key) => {
    return columnWidths[key] || columnWidths[baseKey] || DEFAULT_COLUMN_WIDTHS[baseKey] || 86;
  }, [columnWidths]);
  const tableColumns = useMemo(() => {
    const columns: Array<{ key: string; baseKey: string }> = [
      { key: 'select', baseKey: 'select' },
      { key: 'index', baseKey: 'index' },
      { key: 'product', baseKey: 'product' },
    ];

    if (showCompetitors) {
      COMPETITORS.forEach((competitor) => columns.push({ key: `competitor:${competitor}`, baseKey: 'competitors' }));
    }

    columns.push(
      { key: 'purchase_price', baseKey: 'purchase_price' },
      { key: 'sell_in', baseKey: 'sell_in' },
      { key: 'calculation', baseKey: 'calculation' },
      { key: 'sell_out', baseKey: 'sell_out' },
      { key: 'trade', baseKey: 'trade' },
      { key: 'real_cost', baseKey: 'real_cost' },
      { key: 'launched_cost', baseKey: 'launched_cost' },
      { key: 'sale_price', baseKey: 'sale_price' },
      { key: 'baby_wednesday_price', baseKey: 'baby_wednesday_price' },
      { key: 'month_end_price', baseKey: 'month_end_price' },
    );

    if (showBranchColumns) {
      tableBranches.forEach((branch) => columns.push({ key: `branch:${branch.code}`, baseKey: 'branches' }));
    }

    columns.push(
      { key: 'markup', baseKey: 'markup' },
      { key: 'actions', baseKey: 'actions' },
    );

    return columns;
  }, [showBranchColumns, showCompetitors, tableBranches]);
  const tableWidth = useMemo(() => {
    return tableColumns.reduce((total, column) => total + getColumnWidth(column.key, column.baseKey), 0);
  }, [getColumnWidth, tableColumns]);
  const startColumnResize = useCallback((event: ReactMouseEvent, key: string, baseKey = key) => {
    event.preventDefault();
    event.stopPropagation();

    resizingColumnRef.current = {
      key,
      startX: event.clientX,
      startWidth: getColumnWidth(key, baseKey),
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      const current = resizingColumnRef.current;
      if (!current) return;

      const nextWidth = Math.max(42, Math.min(520, current.startWidth + moveEvent.clientX - current.startX));
      setColumnWidths((previous) => ({ ...previous, [current.key]: nextWidth }));
    };

    const onUp = () => {
      resizingColumnRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getColumnWidth]);
  const resetColumnWidth = useCallback((key: string) => {
    setColumnWidths((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }, []);
  const pricingTableCss = useMemo(() => {
    let index = 0;
    const hiddenIndexes: number[] = [];
    const addColumn = (column: string) => {
      index += 1;
      if (!visibleColumns.includes(column)) hiddenIndexes.push(index);
    };

    index += 1;
    addColumn('index');
    addColumn('product');
    if (showCompetitors) COMPETITORS.forEach(() => { index += 1; });
    addColumn('purchase_price');
    addColumn('sell_in');
    addColumn('calculation');
    addColumn('sell_out');
    addColumn('trade');
    addColumn('real_cost');
    addColumn('launched_cost');
    addColumn('sale_price');
    addColumn('baby_wednesday_price');
    addColumn('month_end_price');
    if (showBranchColumns) tableBranches.forEach(() => { index += 1; });
    addColumn('markup');
    addColumn('actions');

    const densityCss = visibleTableColumnCount > 14
      ? `
        #pricing-products-table th,
        #pricing-products-table td {
          padding: 0.35rem 0.3rem !important;
          font-size: 0.7rem !important;
          line-height: 1.18 !important;
        }
        #pricing-products-table button {
          padding: 0.25rem !important;
        }
      `
      : `
        #pricing-products-table th,
        #pricing-products-table td {
          padding: 0.45rem 0.45rem !important;
          font-size: 0.82rem !important;
          line-height: 1.25 !important;
        }
      `;

    return `
      .price-input-shell {
        display: flex;
        min-height: 3rem;
        flex-direction: column;
        justify-content: center;
        border-radius: 1rem;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        padding: 0.45rem 0.75rem;
      }
      .price-input-shell span {
        margin-bottom: 0.18rem;
        font-size: 0.56rem;
        font-weight: 900;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .price-input-shell select {
        width: 100%;
        border: 0;
        background: transparent;
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
        color: #0f172a;
        outline: none;
      }
      #pricing-products-table {
        table-layout: fixed;
        width: max(100%, ${tableWidth}px);
        min-width: ${tableWidth}px;
        border-collapse: collapse;
        border-spacing: 0;
        background: #ffffff;
      }
      #pricing-products-table th,
      #pricing-products-table td {
        border: 1px solid #cbd5e1;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: middle;
      }
      #pricing-products-table th {
        position: relative;
        background: #eaf1fb;
        color: #334155;
        font-weight: 900;
        white-space: normal;
        letter-spacing: 0;
        text-align: center;
      }
      #pricing-products-table td {
        white-space: nowrap;
        color: #0f172a;
        background: #ffffff;
      }
      #pricing-products-table tbody tr:nth-child(even) td {
        background: #f8fafc;
      }
      #pricing-products-table tbody tr:hover td {
        background: #dbeafe;
      }
      #pricing-products-table th:nth-child(1),
      #pricing-products-table td:nth-child(1) {
        text-align: center;
      }
      #pricing-products-table th:nth-child(3),
      #pricing-products-table td:nth-child(3) {
        text-align: left;
      }
      #pricing-products-table td:nth-child(3) {
        white-space: nowrap;
      }
      #pricing-products-table .product-description {
        display: block;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #pricing-products-table .column-resizer {
        position: absolute;
        top: 0;
        right: -3px;
        width: 7px;
        height: 100%;
        cursor: col-resize;
        z-index: 2;
      }
      #pricing-products-table .column-resizer:hover,
      #pricing-products-table .column-resizer:active {
        background: #2563eb;
      }
      #pricing-products-table .excel-final {
        color: #059669 !important;
        font-weight: 900;
      }
      #pricing-products-table .excel-sale {
        color: #1d4ed8 !important;
        font-weight: 900;
      }
      #pricing-products-table .excel-offer {
        color: #d97706 !important;
        font-weight: 900;
      }
      #pricing-products-table .excel-markup-negative {
        color: #dc2626 !important;
        font-weight: 900;
      }
      #pricing-products-table .excel-markup-positive {
        color: #0f172a !important;
        font-weight: 900;
      }
      ${densityCss}
      ${hiddenIndexes
      .map((columnIndex) => `#pricing-products-table th:nth-child(${columnIndex}), #pricing-products-table td:nth-child(${columnIndex}){display:none}`)
      .join('\n')}
    `;
  }, [showBranchColumns, showCompetitors, tableBranches, tableWidth, visibleColumns, visibleTableColumnCount]);

  const selectedProductFilterSet = useMemo(() => new Set(productFilterIds), [productFilterIds]);
  const selectedProductFilterGroups = useMemo(() => (
    productGroups.filter((group) => selectedProductFilterSet.has(group.id))
  ), [productGroups, selectedProductFilterSet]);
  const productFilterOptions = useMemo(() => {
    const normalizedSearch = normalizeSearchText(productFilterInput);
    const searchTokens = normalizedSearch.split(' ').filter((token) => token.length >= 2);
    const digitSearch = normalizedSearch.replace(/\D/g, '');
    if (normalizedSearch.length < 3 && digitSearch.length < 6) return [];

    return productGroups
      .filter((group) => {
        if (selectedProductFilterSet.has(group.id)) return false;
        const searchValues = [
          group.description,
          ...group.descriptions,
          group.brand,
          group.classification,
          ...group.eans,
          ...group.erpCodes,
        ].map(normalizeSearchText);
        const joinedValues = searchValues.join(' ');
        return searchValues.some((value) => value.includes(normalizedSearch))
          || (searchTokens.length > 0 && searchTokens.every((token) => joinedValues.includes(token)))
          || (digitSearch.length >= 6 && [...group.eans, ...group.erpCodes].some((value) => value.replace(/\D/g, '').includes(digitSearch)));
      })
      .slice(0, 18);
  }, [productFilterInput, productGroups, selectedProductFilterSet]);

  const hiddenGroupSet = useMemo(() => new Set(hiddenGroupIds), [hiddenGroupIds]);
  const isGroupHidden = useCallback((group: PricingProductGroup) => hiddenGroupSet.has(group.id), [hiddenGroupSet]);
  const productsForActiveFilter = useCallback((group: PricingProductGroup) => {
    const hidden = isGroupHidden(group);
    if (activeStatusFilter === 'active' && hidden) return [];
    if (activeStatusFilter === 'inactive' && !hidden) return [];
    return group.products;
  }, [activeStatusFilter, isGroupHidden]);

  const primaryProductForGroup = useCallback((group: PricingProductGroup) => (
    productsForActiveFilter(group)[0] || group.primaryProduct
  ), [productsForActiveFilter]);

  const filteredProductGroups = useMemo(() => {

    return productGroups.filter((group) => {
      const matchingStatusProducts = productsForActiveFilter(group);
      if (matchingStatusProducts.length === 0) return false;
      const product = matchingStatusProducts[0];
      if (selectedProductFilterSet.size > 0 && !selectedProductFilterSet.has(group.id)) return false;
      if (!includesNormalized(group.brands.length ? group.brands : [group.brand], brandFilters)) return false;
      if (!includesNormalized(group.promotionGroups.length ? group.promotionGroups : [group.promotionGroup], promotionGroupFilters)) return false;
      if (branchFilters.length > 0 && !matchingStatusProducts.some((item) => tableBranches.some((city) => city.branchCodes.some((code) => Number(item.store_prices?.[code] || 0) > 0)))) return false;
      if (!classificationMatchesFilters(
        group.classifications.length ? group.classifications : [group.classification],
        lineFilters,
        departmentFilters,
        categoryFilters,
      )) return false;
      if (priceStatusFilter === 'priced' && (!product.purchase_price || !product.sale_price)) return false;
      if (priceStatusFilter === 'missing' && (product.purchase_price > 0 && product.sale_price > 0)) return false;
      if (priceStatusFilter === 'negative' && markup(product) >= 0) return false;
      return true;
    });
  }, [brandFilters, branchFilters, categoryFilters, departmentFilters, lineFilters, priceStatusFilter, productGroups, productsForActiveFilter, promotionGroupFilters, selectedProductFilterSet, tableBranches]);
  const hasPriceFilters = productFilterIds.length > 0 || brandFilters.length > 0 || promotionGroupFilters.length > 0 || lineFilters.length > 0 || departmentFilters.length > 0 || categoryFilters.length > 0 || branchFilters.length > 0 || priceStatusFilter !== 'all' || activeStatusFilter !== 'active';
  const visibleProductGroups = useMemo(() => (hasPriceFilters || showPriceResults ? filteredProductGroups : []), [filteredProductGroups, hasPriceFilters, showPriceResults]);
  const visibleProducts = useMemo(() => visibleProductGroups.flatMap(productsForActiveFilter), [productsForActiveFilter, visibleProductGroups]);
  const selectedGroups = useMemo(() => {
    const selected = new Set(selectedGroupIds);
    return productGroups.filter((group) => selected.has(group.id));
  }, [productGroups, selectedGroupIds]);
  const visibleGroupIds = useMemo(() => visibleProductGroups.map((group) => group.id), [visibleProductGroups]);
  const allVisibleSelected = visibleGroupIds.length > 0 && visibleGroupIds.every((id) => selectedGroupIds.includes(id));
  const selectedLaunchBranches = useMemo(() => new Set(selectedLaunchBranchCodes), [selectedLaunchBranchCodes]);
  const cityCodesWithStorePrice = useCallback((storePrices: Record<string, number>) => (
    activeCityClusters
      .filter((city) => city.branchCodes.some((code) => Number(storePrices?.[code] || 0) > 0))
      .map((city) => city.code)
  ), [activeCityClusters]);
  const branchCodesForSelectedCities = useCallback((cityCodes: string[]) => {
    const selected = new Set(cityCodes);
    return activeCityClusters
      .filter((city) => selected.has(city.code))
      .flatMap((city) => city.branchCodes);
  }, [activeCityClusters]);
  const productLaunchOptions = useMemo(() => {
    const normalizedSearch = productLaunchSearch.trim().toLowerCase();

    return productGroups
      .filter((group) => {
        if (!normalizedSearch) return true;
        const searchValues = [
          group.description,
          ...group.descriptions,
          group.brand,
          group.classification,
          ...group.eans,
          ...group.erpCodes,
        ];
        return searchValues.some((value) => value.toLowerCase().includes(normalizedSearch));
      })
      .slice(0, 80);
  }, [productGroups, productLaunchSearch]);

  const pricingRuleTargetOptions = useMemo(() => {
    if (editingPricingRule.scope === 'brand') return brands;
    if (editingPricingRule.scope === 'line') return lineOptions;
    if (editingPricingRule.scope === 'department') return departmentOptions;
    if (editingPricingRule.scope === 'category') return categoryOptions;
    if (editingPricingRule.scope === 'quote_group') return promotionGroups;
    return [];
  }, [brands, categoryOptions, departmentOptions, editingPricingRule.scope, lineOptions, promotionGroups]);

  const classificationForProductInput = useCallback((product: PricingProductInput | ImportedPricingProductInput) => {
    const transientClassification = (product as ImportedPricingProductInput).classification_path;
    if (transientClassification) return transientClassification;
    return catalogByEan.get(product.ean)?.classification || catalogByDescription.get(normalizeKey(product.description))?.classification || '';
  }, [catalogByDescription, catalogByEan]);

  const ruleMatchesProduct = useCallback((rule: PricingRule, product: PricingProductInput | ImportedPricingProductInput) => {
    if (!rule.active) return false;
    if (rule.scope === 'all') return true;

    const expected = rule.scopeValue;
    if (!expected) return false;
    if (rule.scope === 'brand') return includesNormalized([product.brand], [expected]);
    if (rule.scope === 'quote_group') return includesNormalized([product.promotion_group || ''], [expected]);

    const parts = splitClassificationPath(classificationForProductInput(product));
    if (rule.scope === 'line') return includesNormalized([parts.line], [expected]);
    if (rule.scope === 'department') return includesNormalized([parts.department], [expected]);
    if (rule.scope === 'category') return includesNormalized([parts.category], [expected]);
    return false;
  }, [classificationForProductInput]);

  const activePricingRules = useMemo(() => pricingRules.filter((rule) => rule.active), [pricingRules]);

  const bestPricingRule = useCallback((product: PricingProductInput | ImportedPricingProductInput) => (
    activePricingRules.find((rule) => ruleMatchesProduct(rule, product)) || null
  ), [activePricingRules, ruleMatchesProduct]);

  const applyBestPricingRule = useCallback((product: PricingProductInput | ImportedPricingProductInput) => {
    const rule = bestPricingRule(product);
    if (!rule) return { product, rule: null };

    const suggestedPrice = suggestedPriceByRule(product, rule);
    if (!suggestedPrice) return { product, rule };
    return { product: { ...product, sale_price: suggestedPrice }, rule };
  }, [bestPricingRule]);

  const toggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((current) => (
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId]
    ));
  };

  const toggleVisibleSelection = () => {
    setSelectedGroupIds((current) => {
      const currentSet = new Set(current);
      if (allVisibleSelected) {
        visibleGroupIds.forEach((id) => currentSet.delete(id));
      } else {
        visibleGroupIds.forEach((id) => currentSet.add(id));
      }
      return Array.from(currentSet);
    });
  };

  const openPriceLaunchForSelection = () => {
    const firstGroup = selectedGroups[0];
    if (!firstGroup) {
      alert('Selecione ao menos uma descriÃ§Ã£o para lanÃ§ar preÃ§o.');
      return;
    }
    const product = firstGroup.primaryProduct;
    setProductLaunchSearch('');
    setEditingProduct(editableProduct(product));
    setSelectedLaunchBranchCodes(cityCodesWithStorePrice(product.store_prices || {}));
  };

  const editableProduct = (product: PricingProduct): PricingProductInput => {
    const catalogProduct = catalogByEan.get(product.ean) || catalogByDescription.get(normalizeKey(product.description));
    const { id, created_at, updated_at, ...input } = product;
    void created_at;
    void updated_at;

    if (id.startsWith('catalog:')) {
      return {
        ...input,
        brand: catalogProduct?.manufacturer || input.brand,
      };
    }

    return { id, ...input };
  };

  const applyProductGroupToLaunch = (group: PricingProductGroup) => {
    setEditingProduct(editableProduct(group.primaryProduct));
    setProductLaunchSearch('');
    setSelectedLaunchBranchCodes(cityCodesWithStorePrice(group.primaryProduct.store_prices || {}));
  };

  const summary = useMemo(() => {
    const totalPurchase = visibleProducts.reduce((sum, product) => sum + product.purchase_price, 0);
    const negativeMargins = visibleProducts.filter((product) => markup(product) < 0).length;
    const averageMarkup = visibleProducts.length
      ? visibleProducts.reduce((sum, product) => sum + markup(product), 0) / visibleProducts.length
      : 0;

    return { totalPurchase, negativeMargins, averageMarkup };
  }, [visibleProducts]);

  const clearPriceFilters = () => {
    setProductFilterInput('');
    setProductFilterIds([]);
    setBrandFilters([]);
    setPromotionGroupFilters([]);
    setActiveBranchCode('');
    setLineFilters([]);
    setDepartmentFilters([]);
    setCategoryFilters([]);
    setBranchFilters([]);
    setPriceStatusFilter('all');
    setActiveStatusFilter('active');
  };

  const addProductFilterGroup = (group: PricingProductGroup) => {
    setProductFilterIds((current) => (
      current.includes(group.id) ? current : [...current, group.id]
    ));
    setProductFilterInput('');
    setShowPriceResults(true);
  };

  const addProductFiltersFromText = (text: string) => {
    const tokens = text
      .split(/[\s,;|\n\r\t]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3);
    if (tokens.length === 0) return;

    const matchedIds = new Set<string>();
    tokens.forEach((token) => {
      const normalizedToken = token.toLowerCase();
      const digitToken = normalizedToken.replace(/\D/g, '');
      productGroups.forEach((group) => {
        const values = [...group.eans, ...group.erpCodes];
        const exactMatch = values.some((value) => value.toLowerCase() === normalizedToken);
        const digitMatch = digitToken.length >= 6 && values.some((value) => value.replace(/\D/g, '') === digitToken);
        if (exactMatch || digitMatch) matchedIds.add(group.id);
      });
    });

    if (matchedIds.size === 0 && productFilterOptions.length === 1) {
      matchedIds.add(productFilterOptions[0].id);
    }

    if (matchedIds.size === 0) return;
    setProductFilterIds((current) => Array.from(new Set([...current, ...matchedIds])));
    setProductFilterInput('');
    setShowPriceResults(true);
  };

  const removeProductFilter = (groupId: string) => {
    setProductFilterIds((current) => current.filter((id) => id !== groupId));
  };

  const updateEditing = <K extends keyof PricingProductInput>(key: K, value: PricingProductInput[K]) => {
    setEditingProduct((current) => current ? { ...current, [key]: value } : current);
  };

  const updateNestedPrice = (field: 'competitor_prices' | 'store_prices', key: string, value: number) => {
    setEditingProduct((current) => current ? {
      ...current,
      [field]: { ...current[field], [key]: value },
    } : current);
  };

  const updateCityPrice = (cityCode: string, value: number) => {
    const city = activeCityClusters.find((item) => item.code === cityCode);
    if (!city) return;
    setEditingProduct((current) => {
      if (!current) return current;
      const nextStorePrices = { ...current.store_prices };
      city.branchCodes.forEach((code) => {
        nextStorePrices[code] = value;
      });
      return { ...current, store_prices: nextStorePrices };
    });
  };

  const savePricingRuleDefinition = async () => {
    const name = editingPricingRule.name.trim().toUpperCase();
    if (!name) {
      alert('Informe o nome da regra.');
      return;
    }
    if (editingPricingRule.scope !== 'all' && !editingPricingRule.scopeValue.trim()) {
      alert('Escolha o alvo da regra.');
      return;
    }

    setSaving(true);
    try {
      const savedRule = await savePricingRule({
        id: editingPricingRule.id,
        name,
        scope: editingPricingRule.scope,
        scopeValue: editingPricingRule.scope === 'all' ? '' : editingPricingRule.scopeValue.trim().toUpperCase(),
        targetMarkup: Number(editingPricingRule.targetMarkup || 0),
        minMarkup: Number(editingPricingRule.minMarkup || 0),
        competitorBuffer: Number(editingPricingRule.competitorBuffer || 0),
        basis: editingPricingRule.basis,
        active: editingPricingRule.active !== false,
      });

      setPricingRules((current) => {
        const exists = current.some((rule) => rule.id === savedRule.id);
        return exists ? current.map((rule) => rule.id === savedRule.id ? savedRule : rule) : [savedRule, ...current];
      });
      setEditingPricingRule(blankPricingRuleDraft());
      setPricingRulesError('');
      setPricingRulesMissingTable(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      setPricingRulesError(message);
      alert('Erro ao salvar regra de preco: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const editPricingRuleDefinition = (rule: PricingRule) => {
    setEditingPricingRule(rule);
    setShowPricingRules(true);
  };

  const removePricingRuleDefinition = async (ruleId: string) => {
    const previousRules = pricingRules;
    setPricingRules((current) => current.filter((rule) => rule.id !== ruleId));
    setEditingPricingRule((current) => current.id === ruleId ? blankPricingRuleDraft() : current);
    try {
      await deletePricingRule(ruleId);
      setPricingRulesError('');
    } catch (error) {
      setPricingRules(previousRules);
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      setPricingRulesError(message);
      alert('Erro ao excluir regra de preco: ' + message);
    }
  };

  const togglePricingRuleDefinition = async (ruleId: string) => {
    const rule = pricingRules.find((item) => item.id === ruleId);
    if (!rule) return;
    const nextRule = { ...rule, active: !rule.active };
    setPricingRules((current) => current.map((item) => item.id === ruleId ? nextRule : item));
    try {
      const savedRule = await savePricingRule(nextRule);
      setPricingRules((current) => current.map((item) => item.id === ruleId ? savedRule : item));
      setPricingRulesError('');
    } catch (error) {
      setPricingRules((current) => current.map((item) => item.id === ruleId ? rule : item));
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      setPricingRulesError(message);
      alert('Erro ao atualizar regra de preco: ' + message);
    }
  };

  const applyRulesToCurrentSelection = async () => {
    const targetProducts = selectedGroups.length > 0 ? selectedGroups.flatMap((group) => group.products) : visibleProducts;
    if (targetProducts.length === 0) {
      alert('Filtre ou selecione itens antes de aplicar regras.');
      return;
    }

    let applied = 0;
    setSaving(true);
    try {
      for (const product of targetProducts) {
        const editable = editableProduct(product);
        const result = applyBestPricingRule(editable);
        if (!result.rule) continue;
        applied += 1;
        await savePricingProduct(result.product);
      }
      await loadProducts();
      alert(applied ? applied + ' precos recalculados pelas regras.' : 'Nenhuma regra ativa bateu com os itens atuais.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao aplicar regras: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const assignSelectedGroupsToQuoteGroup = async () => {
    if (selectedGroups.length === 0) {
      alert('Selecione ao menos uma descricao para criar o grupo de cotacao.');
      return;
    }

    const rawName = window.prompt('Nome do grupo de cotacao');
    const quoteGroup = rawName?.trim().toUpperCase();
    if (!quoteGroup) return;

    setSaving(true);
    try {
      for (const group of selectedGroups) {
        for (const product of group.products) {
          await savePricingProduct({
            ...editableProduct(product),
            promotion_group: quoteGroup,
          });
        }
      }
      await loadProducts();
      setPromotionGroupFilters([quoteGroup]);
      setShowPriceResults(true);
      setSelectedGroupIds([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao criar grupo de cotacao: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const saveProduct = async () => {
    if (!editingProduct?.ean || !editingProduct.description) {
      alert('Preencha EAN e descriÃ§Ã£o.');
      return;
    }

    setSaving(true);
    try {
      await savePricingProduct(editingProduct);
      await loadProducts();
      void loadCatalogProducts();
      void loadCatalogAttributes();
      setEditingProduct(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao salvar lanÃ§amento de preÃ§o: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const savePriceLaunch = async () => {
    if (selectedGroups.length === 0) {
      await saveProduct();
      return;
    }

    if (!editingProduct) return;

    setSaving(true);
    try {
      const applyBranchPrices = (storePrices: Record<string, number>) => {
        if (selectedLaunchBranchCodes.length === 0) return storePrices;
        const next = { ...storePrices };
        branchCodesForSelectedCities(selectedLaunchBranchCodes).forEach((code) => {
          next[code] = editingProduct.sale_price;
        });
        return next;
      };

      for (const group of selectedGroups) {
        for (const product of group.products) {
          const baseProduct = editableProduct(product);
          await savePricingProduct({
            ...baseProduct,
            purchase_price: editingProduct.purchase_price,
            sell_in_value: editingProduct.sell_in_value,
            sell_in_mode: editingProduct.sell_in_mode,
            sell_out_value: editingProduct.sell_out_value,
            sell_out_mode: editingProduct.sell_out_mode,
            trade_value: editingProduct.trade_value,
            trade_mode: editingProduct.trade_mode,
            sale_price: editingProduct.sale_price,
            baby_wednesday_price: editingProduct.baby_wednesday_price,
            month_end_price: editingProduct.month_end_price,
            competitor_prices: editingProduct.competitor_prices,
            store_prices: applyBranchPrices(baseProduct.store_prices || {}),
            promotion_group: editingProduct.promotion_group || baseProduct.promotion_group || '',
          });
        }
      }

      await loadProducts();
      void loadCatalogProducts();
      void loadCatalogAttributes();
      setEditingProduct(null);
      setSelectedGroupIds([]);
      setSelectedLaunchBranchCodes([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao salvar lanÃ§amento de preÃ§o: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const saveBranch = async () => {
    if (!editingBranch?.name || !editingBranch.code) {
      alert('Preencha nome e cÃ³digo da filial.');
      return;
    }

    try {
      await savePricingBranch(editingBranch);
      await loadBranches();
      setEditingBranch(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao salvar filial: ' + message);
    }
  };

  const removeBranch = async (branch: PricingBranch) => {
    if (!confirm(`Excluir filial ${branch.name}?`)) return;
    await deletePricingBranch(branch.id);
    await loadBranches();
  };

  const setProductGroupVisible = (group: PricingProductGroup, visible: boolean) => {
    setHiddenGroupIds((current) => {
      const next = new Set(current);
      if (visible) {
        next.delete(group.id);
      } else {
        next.add(group.id);
      }
      return Array.from(next);
    });
  };

  const importExcel = async (file: File) => {
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/pricing/import', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: formData,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.products?.length) {
        alert(data?.error || 'Nenhum lanÃ§amento de preÃ§o encontrado na planilha.');
        return;
      }

      let rulesApplied = 0;
      for (const rawProduct of data.products as ImportedPricingProductInput[]) {
        const result = applyBestPricingRule(rawProduct);
        if (result.rule) rulesApplied += 1;
        await savePricingProduct(result.product);
      }

      await loadProducts();
      void loadCatalogProducts();
      void loadCatalogAttributes();
      alert(`${data.products.length} lancamentos de preco importados com sucesso.${rulesApplied ? ` ${rulesApplied} precos sugeridos por regra.` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao importar planilha: ' + message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const exportCsv = () => {
    const option = EXPORT_OPTIONS.find((item) => item.id === exportPrice);
    const selectedLabel = option?.label || 'ExportaÃ§Ã£o';
    const selectedValue = (product: PricingProduct) => {
      if (exportPrice === 'full_table') return null;
      if (exportPrice === 'branch_prices') return null;
      return exportPrice === 'final_price' ? finalPrice(product) : Number(product[exportPrice] || 0);
    };
    const rows = [
      exportPrice === 'full_table'
        ? ['BARRAS', 'PRODUTO', 'GRUPO PROMOCAO', ...COMPETITORS, 'PreÃ§o', 'Sell in', 'CÃ¡lculo', 'Sell out', 'Trade', 'Custo Real', 'Custo LanÃ§ado', 'Novo PreÃ§o', 'Quarta da Fralda', 'Fecha mÃªs', 'Margem (%)']
        : exportPrice === 'branch_prices'
          ? ['BARRAS', 'PRODUTO', 'MARCA', 'GRUPO PROMOCAO', ...tableBranches.map((branch) => branch.name)]
        : ['BARRAS', 'PRODUTO', 'MARCA', 'GRUPO PROMOCAO', selectedLabel],
      ...visibleProducts.map((product) => {
        if (exportPrice === 'branch_prices') {
          return [
            masterProductInfo(product).ean,
            masterProductInfo(product).description,
            masterProductInfo(product).brand,
            product.promotion_group || '',
            ...tableBranches.map((city) => String(cityPriceForProduct(product, city) || product.sale_price || 0).replace('.', ',')),
          ];
        }

        if (exportPrice !== 'full_table') {
          const master = masterProductInfo(product);
          return [master.ean, master.description, master.brand, product.promotion_group || '', String(selectedValue(product) || 0).replace('.', ',')];
        }

        const calculated = finalPrice(product);
        const master = masterProductInfo(product);
        return [
          master.ean,
          master.description,
          product.promotion_group || '',
          ...COMPETITORS.map((competitor) => String(product.competitor_prices?.[competitor] || '').replace('.', ',')),
          String(product.purchase_price).replace('.', ','),
          String(product.sell_in_value || '').replace('.', ','),
          String(product.purchase_price - discount(product.purchase_price, product.sell_in_value, product.sell_in_mode)).replace('.', ','),
          String(product.sell_out_value || '').replace('.', ','),
          String(product.trade_value || '').replace('.', ','),
          String(calculated).replace('.', ','),
          String(calculated).replace('.', ','),
          String(product.sale_price).replace('.', ','),
          String(product.baby_wednesday_price || '').replace('.', ','),
          String(product.month_end_price || '').replace('.', ','),
          markup(product).toFixed(2).replace('.', ','),
        ];
      }),
    ];
    const blob = new Blob([serializeCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `precificacao-${selectedLabel}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  const priceForTxt = (product: PricingProduct) => {
    if (txtPriceSource === 'baby_wednesday_price') return product.baby_wednesday_price;
    if (txtPriceSource === 'month_end_price') return product.month_end_price;
    if (txtPriceSource === 'branch_price') {
      const city = activeCityClusters.find((item) => item.code === txtBranchCode) || null;
      return txtBranchCode ? cityPriceForProduct(product, city) || product.sale_price || 0 : product.sale_price;
    }
    return product.sale_price;
  };

  const exportTxt = () => {
    if (visibleProductGroups.length === 0) {
      alert('Use a busca ou um filtro para selecionar os lanÃ§amentos antes de exportar.');
      return;
    }

    const lines = visibleProductGroups.flatMap((group) => {
      const product = primaryProductForGroup(group);
      const value = txtExportType === 'B'
        ? String(Number(txtDiscountPercent || 0))
        : formatTxtNumber(priceForTxt(product));
      const eans = Array.from(new Set(productsForActiveFilter(group)
        .map((product) => masterProductInfo(product).ean || product.ean)
        .filter(Boolean)));

      return eans.map((ean) => `${txtExportType}|${ean}|||${value}`);
    });

    if (lines.length === 0) {
      alert('Nenhum EAN encontrado para exportar.');
      return;
    }

    const branch = activeCityClusters.find((item) => item.code === txtBranchCode);
    const branchLabel = branch ? branch.code : 'todas';
    downloadTextFile(`price-${txtExportType}-${branchLabel}.txt`, lines.join('\r\n'));
    setShowExportModal(false);
  };

  const renderHeader = (label: string, key: string, baseKey = key, align: 'left' | 'right' | 'center' = 'right') => (
    <th key={key} className={`px-4 py-4 ${align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'}`}>
      <span className="block truncate pr-1" style={{ color: HEADER_COLORS[baseKey] }}>{label}</span>
      <span
        className="column-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Ajustar largura da coluna ${label}`}
        onMouseDown={(event) => startColumnResize(event, key, baseKey)}
        onDoubleClick={() => resetColumnWidth(key)}
      />
    </th>
  );

  return (
    <main className="w-full max-w-none px-2 py-3 pb-24 sm:px-4 md:pb-6">
      <section className="mb-3 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap gap-2">
                {[
                  { id: 'all', label: 'Todos', icon: BarChart3, className: 'text-slate-600' },
                  { id: 'priced', label: 'Com preco', icon: Tags, className: 'text-blue-600' },
                  { id: 'missing', label: 'Sem preco', icon: AlertTriangle, className: 'text-amber-600' },
                  { id: 'negative', label: 'Margem negativa', icon: AlertTriangle, className: 'text-red-600' },
                ].map((option) => {
                  const Icon = option.icon;
                  const active = priceStatusFilter === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setPriceStatusFilter(option.id as typeof priceStatusFilter);
                        setShowPriceResults(true);
                      }}
                      className={`flex h-8 items-center gap-2 rounded-2xl border px-3 text-[10px] font-black uppercase transition ${
                        active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-blue-100 hover:bg-blue-50'
                      }`}
                    >
                      <Icon size={14} className={active ? 'text-blue-600' : option.className} />
                      {option.label}
                    </button>
                  );
                })}
                {[
                  { id: 'active', label: 'Ativos', dotClass: 'bg-emerald-600' },
                  { id: 'inactive', label: 'Inativos', dotClass: 'bg-slate-400' },
                  { id: 'all', label: 'Todos status', dotClass: 'bg-blue-600' },
                ].map((option) => {
                  const active = activeStatusFilter === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setActiveStatusFilter(option.id as typeof activeStatusFilter);
                        setShowPriceResults(true);
                      }}
                      className={`flex h-8 items-center gap-2 rounded-2xl border px-3 text-[10px] font-black uppercase transition ${
                        active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-emerald-100 hover:bg-emerald-50'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-600' : option.dotClass}`} />
                      {option.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={clearPriceFilters}
                  disabled={!hasPriceFilters}
                  className="flex h-8 items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 text-[10px] font-black uppercase text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <FilterX size={14} /> Limpar filtros
                </button>
          </div>
          <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importExcel(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="h-10 px-3 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2 disabled:opacity-50"
          >
            <FileSpreadsheet size={16} /> {importing ? 'Importando...' : 'Importar Excel'}
          </button>
          <button onClick={() => setShowExportModal(true)} className="h-10 px-3 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2">
            <Download size={16} /> Exportar
          </button>
          <button onClick={() => setShowPricingRules((value) => !value)} className={`h-10 px-3 rounded-2xl border-2 font-black uppercase text-[10px] flex items-center gap-2 ${showPricingRules ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-100 bg-white text-slate-700'}`}>
            <Filter size={16} /> Regras
          </button>
          <button
            onClick={async () => {
              await loadProducts();
              if (classificationLookupTerms.length > 0 || brandFilters.length > 0) {
                const filteredCatalogRows = await fetchReallocationProducts({
                  classifications: classificationLookupTerms,
                  manufacturers: brandFilters,
                  limit: 5000,
                }).catch(() => []);
                mergeCatalogProducts(filteredCatalogRows);
              }
              void loadCatalogProducts();
              void loadCatalogAttributes();
              setShowPriceResults(true);
            }}
            className="h-10 px-3 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2"
          >
            <RefreshCw size={16} /> Atualizar
          </button>
          <button onClick={() => setShowBranches((value) => !value)} className="h-10 px-3 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2">
            <Building2 size={16} /> Filiais
          </button>
          <button
            onClick={() => setVisibleColumns((current) => (
              current.includes('competitors')
                ? current.filter((column) => column !== 'competitors')
                : [...current, 'competitors']
            ))}
            className={`h-10 px-3 rounded-2xl border-2 font-black uppercase text-[10px] flex items-center gap-2 ${
              isColumnVisible('competitors') ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-100'
            }`}
          >
            <Eye size={16} /> Concorrentes
          </button>
          {selectedGroupIds.length > 0 && (
            <>
              <button onClick={assignSelectedGroupsToQuoteGroup} className="h-10 px-3 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] flex items-center gap-2 shadow-sm">
                <Tags size={16} /> Grupo cotacao
              </button>
              <button onClick={openPriceLaunchForSelection} className="h-10 px-3 rounded-2xl bg-emerald-600 text-white font-black uppercase text-[10px] flex items-center gap-2 shadow-sm">
                <Tags size={16} /> Lancar preco ({selectedGroupIds.length})
              </button>
            </>
          )}
          <button onClick={() => { setSelectedGroupIds([]); setSelectedLaunchBranchCodes([]); setProductLaunchSearch(''); setEditingProduct({ ...blankProduct }); }} className="h-10 px-3 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] flex items-center gap-2 shadow-sm">
            <PackagePlus size={16} /> Novo PreÃ§o
          </button>
          </div>
        </div>
      </section>

      {showPricingRules && (
        <section className="mb-3 rounded-[22px] border border-blue-100 bg-white p-3 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase italic tracking-tight text-slate-900">Regras de preco</h2>
              <p className="text-[10px] font-bold text-slate-500">Use custo interno e concorrentes para sugerir markup e preco de venda. As regras ficam salvas no banco.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={loadPricingRulesFromApi} disabled={pricingRulesLoading} className="h-9 rounded-2xl bg-slate-100 px-4 text-[10px] font-black uppercase text-slate-600 disabled:opacity-45">
                {pricingRulesLoading ? 'Carregando...' : 'Atualizar regras'}
              </button>
              <button type="button" onClick={applyRulesToCurrentSelection} disabled={saving || activePricingRules.length === 0 || pricingRulesMissingTable} className="h-9 rounded-2xl bg-blue-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-45">
                Aplicar regras nos itens
              </button>
            </div>
          </div>
          {pricingRulesMissingTable && (
            <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] font-black uppercase text-amber-700">
              Rode o SQL supabase/pricing-rules.sql no Supabase para ativar regras compartilhadas.
            </div>
          )}
          {pricingRulesError && !pricingRulesMissingTable && (
            <div className="mb-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[10px] font-black uppercase text-red-600">{pricingRulesError}</div>
          )}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.1fr_0.8fr_1.2fr_0.7fr_0.7fr_0.8fr_0.7fr_auto]">
            <PriceInput label="Nome" value={editingPricingRule.name} onChange={(value) => setEditingPricingRule((current) => ({ ...current, name: value }))} text />
            <label className="price-input-shell">
              <span>Escopo</span>
              <select value={editingPricingRule.scope} onChange={(event) => setEditingPricingRule((current) => ({ ...current, scope: event.target.value as PricingRuleScope, scopeValue: '' }))}>
                <option value="all">Todos</option>
                <option value="brand">Fabricante</option>
                <option value="line">Linha</option>
                <option value="department">Departamento</option>
                <option value="category">Categoria</option>
                <option value="quote_group">Grupo cotacao</option>
              </select>
            </label>
            <label className="price-input-shell">
              <span>Alvo</span>
              <select value={editingPricingRule.scopeValue} onChange={(event) => setEditingPricingRule((current) => ({ ...current, scopeValue: event.target.value }))} disabled={editingPricingRule.scope === 'all'}>
                <option value="">{editingPricingRule.scope === 'all' ? 'Todos os itens' : 'Escolha o alvo'}</option>
                {pricingRuleTargetOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <PriceInput label="Markup alvo %" value={editingPricingRule.targetMarkup} onChange={(value) => setEditingPricingRule((current) => ({ ...current, targetMarkup: numericValue(value) }))} />
            <PriceInput label="Markup min. %" value={editingPricingRule.minMarkup} onChange={(value) => setEditingPricingRule((current) => ({ ...current, minMarkup: numericValue(value) }))} />
            <label className="price-input-shell">
              <span>Referencia</span>
              <select value={editingPricingRule.basis} onChange={(event) => setEditingPricingRule((current) => ({ ...current, basis: event.target.value as PricingRuleBasis }))}>
                <option value="cost">Custo</option>
                <option value="lowest_competitor">Menor concorrente</option>
                <option value="average_competitor">Media concorrentes</option>
              </select>
            </label>
            <PriceInput label="Ajuste %" value={editingPricingRule.competitorBuffer} onChange={(value) => setEditingPricingRule((current) => ({ ...current, competitorBuffer: numericValue(value) }))} />
            <button type="button" onClick={savePricingRuleDefinition} disabled={saving || pricingRulesMissingTable} className="h-12 rounded-2xl bg-slate-900 px-4 text-[10px] font-black uppercase text-white disabled:opacity-45">
              {saving ? 'Salvando...' : 'Salvar regra'}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
            {pricingRules.map((rule) => (
              <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black uppercase text-slate-900">{rule.name}</p>
                  <p className="text-[10px] font-bold uppercase text-slate-500">{rule.scope === 'all' ? 'Todos os itens' : rule.scope.replace('_', ' ') + ': ' + rule.scopeValue} | markup {rule.targetMarkup}% | min. {rule.minMarkup}%</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => togglePricingRuleDefinition(rule.id)} className={rule.active ? 'rounded-full bg-emerald-50 px-3 py-1 text-[9px] font-black uppercase text-emerald-700' : 'rounded-full bg-slate-200 px-3 py-1 text-[9px] font-black uppercase text-slate-500'}>
                    {rule.active ? 'Ativa' : 'Inativa'}
                  </button>
                  <button type="button" onClick={() => editPricingRuleDefinition(rule)} className="p-2 text-slate-300 transition hover:text-blue-600" title="Editar regra"><Edit3 size={17} /></button>
                  <button type="button" onClick={() => removePricingRuleDefinition(rule.id)} className="p-2 text-slate-300 transition hover:text-red-600" title="Excluir regra"><Trash2 size={17} /></button>
                </div>
              </div>
            ))}
            {pricingRules.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-center text-[10px] font-black uppercase text-slate-300">Nenhuma regra cadastrada</div>}
          </div>
        </section>
      )}

      {activeCityClusters.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 overflow-x-auto px-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setActiveBranchCode('');
                setBranchFilters([]);
                setShowPriceResults(true);
              }}
              className={`relative h-9 shrink-0 rounded-t-xl border px-4 text-[10px] font-black uppercase transition ${!activeBranchCode ? 'border-blue-300 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-700'}`}
            >
              Geral
            </button>
            {activeCityClusters.map((city) => {
              const active = activeBranchCode === city.code;
              return (
                <button
                  key={city.id}
                  type="button"
                  onClick={() => {
                    setActiveBranchCode(city.code);
                    setBranchFilters([city.code]);
                    setShowPriceResults(true);
                  }}
                  className={`relative h-9 max-w-[190px] shrink-0 truncate rounded-t-xl border px-4 text-[10px] font-black uppercase transition ${active ? 'border-blue-300 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-700'}`}
                  title={city.branchNames.join(', ')}
                >
                  {city.name}
                </button>
              );
            })}
          </div>
          <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase text-slate-500">
            {selectedBranch ? `Visualizando preco da cidade ${selectedBranch.name} (${selectedBranch.branchNames.length} lojas)` : 'Visualizando preco geral. Escolha uma cidade para trabalhar preco por cluster.'}
          </div>
        </div>
      )}
      <div className="hidden">
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">LanÃ§amentos exibidos</p>
          <p className="text-2xl font-black">{visibleProducts.length}</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Markup MÃ©dio</p>
          <p className="text-2xl font-black">{summary.averageMarkup.toFixed(1).replace('.', ',')}%</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Margem Negativa</p>
          <p className="text-2xl font-black text-red-600">{summary.negativeMargins}</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Total Compras</p>
          <p className="text-2xl font-black">{money(summary.totalPurchase)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 mb-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        <PriceProductFilterBox
          selectedGroups={selectedProductFilterGroups}
          inputValue={productFilterInput}
          options={productFilterOptions}
          onInputChange={setProductFilterInput}
          onAdd={addProductFilterGroup}
          onAddFromText={addProductFiltersFromText}
          onRemove={removeProductFilter}
          onClear={() => setProductFilterIds([])}
        />
        <MultiCheckboxFilter
          label="Fabricante"
          allLabel="Todos fabricantes"
          selectedValues={brandFilters}
          onChange={setBrandFilters}
          options={brands.map((brand) => ({ value: brand, label: brand }))}
        />
        <MultiCheckboxFilter
          label="Grupo cotacao"
          allLabel="Todos os grupos"
          selectedValues={promotionGroupFilters}
          onChange={setPromotionGroupFilters}
          options={promotionGroups.map((group) => ({ value: group, label: group }))}
        />
        <MultiCheckboxFilter
          label="Linha"
          allLabel="Todas linhas"
          selectedValues={lineFilters}
          onChange={setLineFilters}
          options={lineOptions.map((line) => ({ value: line, label: line }))}
        />
        <MultiCheckboxFilter
          label="Departamento"
          allLabel="Todos departamentos"
          selectedValues={departmentFilters}
          onChange={setDepartmentFilters}
          options={departmentOptions.map((department) => ({ value: department, label: department }))}
        />
        <MultiCheckboxFilter
          label="Categoria"
          allLabel="Todas categorias"
          selectedValues={categoryFilters}
          onChange={setCategoryFilters}
          options={categoryOptions.map((category) => ({ value: category, label: category }))}
        />
        <MultiCheckboxFilter
          label="Cidade"
          allLabel="Todas as cidades"
          selectedValues={branchFilters}
          onChange={setBranchFilters}
          options={activeCityClusters.map((city) => ({ value: city.code, label: city.name }))}
        />
        <MultiCheckboxFilter
          label="Colunas"
          allLabel="Todas colunas"
          selectedValues={visibleColumns}
          onChange={(columns) => setVisibleColumns(columns.length ? columns : ['product'])}
          options={COLUMN_OPTIONS}
          emptyMeansAll={false}
          dropdownAlign="right"
        />
      </div>

      {errorMessage && (
        <div className="mb-5 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          {errorMessage}
        </div>
      )}

      {showBranches && (
        <div className="mb-5 bg-white border-2 border-slate-100 rounded-[28px] p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-black uppercase text-xl">Filiais</h2>
              <p className="text-xs font-bold text-slate-500">Cadastre as lojas que terÃ£o preÃ§o prÃ³prio por item.</p>
            </div>
            <button onClick={() => setEditingBranch({ ...blankBranch })} className="h-10 px-4 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] flex items-center gap-2">
              <Building2 size={15} /> Nova filial
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {branches.map((branch) => (
              <div key={branch.id} className={`rounded-2xl border-2 p-4 ${branch.is_active ? 'border-slate-100 bg-slate-50' : 'border-red-100 bg-red-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black uppercase text-slate-900">{branch.name}</p>
                    <p className="text-[10px] font-black uppercase text-slate-400">{branch.code} {branch.uf ? `Ã¢â‚¬Â¢ ${branch.uf}` : ''}</p>
                    {branch.cnpj && <p className="text-[10px] font-bold text-slate-400 mt-1">{branch.cnpj}</p>}
                    {branch.logistics_group && <p className="text-[10px] font-black text-blue-600 mt-1">Grupo: {branch.logistics_group}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${branch.sends_stock !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>Envia</span>
                      <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${branch.receives_stock !== false ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>Recebe</span>
                    </div>
                    <p className={`text-[9px] font-black uppercase mt-2 ${branch.is_active ? 'text-green-600' : 'text-red-600'}`}>{branch.is_active ? 'Ativa' : 'Inativa'}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditingBranch(branch)} className="p-2 text-slate-300 transition hover:text-blue-600" title="Editar filial"><Edit3 size={18} /></button>
                    <button onClick={() => removeBranch(branch)} className="p-2 text-slate-200 transition hover:text-red-600" title="Excluir filial"><Trash2 size={18} /></button>
                  </div>
                </div>
              </div>
            ))}
            {branches.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                Nenhuma filial cadastrada
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-300 rounded-md max-h-[calc(100dvh-210px)] overflow-auto shadow-sm">
        <style>{pricingTableCss}</style>
        <table id="pricing-products-table" className="w-full text-sm">
          <colgroup>
            {tableColumns.map((column) => (
              <col key={column.key} style={{ width: `${getColumnWidth(column.key, column.baseKey)}px` }} />
            ))}
          </colgroup>
          <thead className="text-[10px] uppercase text-slate-600">
            <tr>
              <th className="px-3 py-4 text-center">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleVisibleSelection}
                  className="h-4 w-4 accent-blue-600"
                  aria-label="Selecionar lanÃ§amentos visÃ­veis"
                />
              </th>
              {renderHeader('#', 'index', 'index', 'center')}
              {renderHeader('DescriÃ§Ã£o', 'product', 'product', 'left')}
              {showCompetitors && COMPETITORS.map((competitor) => renderHeader(competitor, `competitor:${competitor}`, 'competitors'))}
              {renderHeader('Preco', 'purchase_price')}
              {renderHeader('Sell-in', 'sell_in')}
              {renderHeader('Calculo', 'calculation')}
              {renderHeader('Sell-out', 'sell_out')}
              {renderHeader('Trade', 'trade')}
              {renderHeader('Custo Real', 'real_cost')}
              {renderHeader('Custo Lancado', 'launched_cost')}
              {renderHeader(selectedBranch ? `Novo Preco ${selectedBranch.name}` : 'Novo Preco', 'sale_price')}
              {renderHeader('Quarta da Fralda', 'baby_wednesday_price')}
              {renderHeader('Fecha mes', 'month_end_price')}
              {showBranchColumns && tableBranches.map((branch) => renderHeader(branch.name, `branch:${branch.code}`, 'branches'))}
              {renderHeader('Markup', 'markup')}
              {renderHeader('AÃ§Ãµes', 'actions')}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleProductGroups.map((group, index) => {
              const product = primaryProductForGroup(group);
              const displayedActive = !isGroupHidden(group);
              const rowSalePrice = displayPrice(product);
              const currentMarkup = markup({ ...product, sale_price: rowSalePrice });
              const master = {
                description: group.description,
              };
              return (
                <tr key={group.id} className={`${displayedActive ? 'hover:bg-blue-50/40' : 'bg-slate-100 text-slate-400 opacity-75 hover:bg-slate-100'}`}>
                  <td className="px-3 py-4 text-center">
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(group.id)}
                      onChange={() => toggleGroupSelection(group.id)}
                      className="h-4 w-4 accent-blue-600"
                      aria-label={`Selecionar ${master.description}`}
                    />
                  </td>
                  <td className="px-4 py-4 text-slate-400">{index + 1}</td>
                  <td className="px-4 py-4 font-black uppercase" title={master.description}>
                    <span className="product-description">{master.description}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {group.promotionGroup && <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-black uppercase text-blue-700">{group.promotionGroup}</span>}
                      {!displayedActive && <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-black uppercase text-slate-500">Inativo</span>}
                    </div>
                  </td>
                  {showCompetitors && COMPETITORS.map((competitor) => (
                    <td key={competitor} className="px-4 py-4 text-right">{product.competitor_prices?.[competitor] ? money(product.competitor_prices[competitor]) : '-'}</td>
                  ))}
                  <td className="px-4 py-4 text-right font-bold">{money(product.purchase_price)}</td>
                  <td className="px-4 py-4 text-right">{product.sell_in_mode === 'percent' ? `${product.sell_in_value}%` : money(product.sell_in_value)}</td>
                  <td className="px-4 py-4 text-right">{money(product.purchase_price - discount(product.purchase_price, product.sell_in_value, product.sell_in_mode))}</td>
                  <td className="px-4 py-4 text-right">{product.sell_out_mode === 'percent' ? `${product.sell_out_value}%` : money(product.sell_out_value)}</td>
                  <td className="px-4 py-4 text-right">{product.trade_mode === 'percent' ? `${product.trade_value}%` : money(product.trade_value)}</td>
                  <td className="px-4 py-4 text-right excel-final">{money(finalPrice(product))}</td>
                  <td className="px-4 py-4 text-right excel-final">{money(finalPrice(product))}</td>
                  <td className="px-4 py-4 text-right excel-sale">{rowSalePrice > 0 ? money(rowSalePrice) : '-'}</td>
                  <td className="px-4 py-4 text-right excel-offer">{money(product.baby_wednesday_price)}</td>
                  <td className="px-4 py-4 text-right excel-offer">{money(product.month_end_price)}</td>
                  {showBranchColumns && tableBranches.map((city) => (
                    <td key={city.id} className="px-4 py-4 text-right">{money(cityPriceForProduct(product, city) || product.sale_price || 0)}</td>
                  ))}
                  <td className={`px-4 py-4 text-right ${currentMarkup < 0 ? 'excel-markup-negative' : 'excel-markup-positive'}`}>{currentMarkup.toFixed(2).replace('.', ',')}%</td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setSelectedGroupIds([group.id]); setProductLaunchSearch(''); setSelectedLaunchBranchCodes(cityCodesWithStorePrice(product.store_prices || {})); setEditingProduct(editableProduct(product)); }} className="p-2 text-slate-300 transition hover:text-blue-600" title="Editar lanÃ§amento"><Edit3 size={20} /></button>
                      <button
                        onClick={() => setProductGroupVisible(group, !displayedActive)}
                        className={`p-2 transition ${displayedActive ? 'text-slate-200 hover:text-red-600' : 'text-slate-300 hover:text-emerald-600'}`}
                        title={displayedActive ? 'Ocultar item' : 'Mostrar item'}
                      >
                        {displayedActive ? <EyeOff size={20} /> : <RefreshCw size={20} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && visibleProductGroups.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, visibleTableColumnCount)} className="px-4 py-16 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                  {hasPriceFilters ? 'Nenhum lanÃ§amento encontrado' : 'Use a busca, escolha um filtro rÃ¡pido ou clique em atualizar para mostrar a tabela'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCompetitors && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {COMPETITORS.map((competitor) => (
            <div key={competitor} className="bg-white border-2 border-slate-100 rounded-2xl p-4">
              <p className="text-[10px] font-black uppercase text-slate-400">{competitor}</p>
              <p className="text-sm font-bold text-slate-700 mt-1">{visibleProducts.filter((product) => (product.competitor_prices?.[competitor] || 0) > 0).length} preÃ§os cadastrados</p>
            </div>
          ))}
        </div>
      )}

      {editingProduct && (
        <div className="app-modal-viewport fixed inset-0 z-[80] flex justify-center bg-slate-900/16 backdrop-blur-sm">
          <div className="app-modal-card flex w-full max-w-[min(900px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <h2 className="text-lg font-black uppercase italic tracking-tighter">{editingProduct.id ? 'Editar LanÃ§amento' : 'LanÃ§ar PreÃ§o'}</h2>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Item, custo, oferta e preÃ§o para exportaÃ§Ã£o</p>
              </div>
              <button onClick={() => setEditingProduct(null)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"><X size={19} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-5">
              <div className="mb-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <h3 className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Item do lanÃ§amento</h3>
                {selectedGroups.length > 0 ? (
                  <div className="rounded-2xl border border-blue-100 bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-blue-600 px-3 py-1 text-[9px] font-black uppercase text-white">
                        {selectedGroups.length} descriÃ§Ãµes selecionadas
                      </span>
                      <span className="text-[10px] font-bold uppercase text-slate-400">LanÃ§amento em lote</span>
                    </div>
                    <div className="flex max-h-24 flex-col gap-1 overflow-y-auto pr-1">
                      {selectedGroups.slice(0, 8).map((group) => (
                        <div key={group.id} className="rounded-xl bg-slate-50 px-3 py-2">
                          <p className="text-[11px] font-black uppercase leading-snug text-slate-800">{group.description}</p>
                          <p className="mt-1 text-[9px] font-bold uppercase text-slate-400">{group.eans.slice(0, 3).join(' | ') || 'Sem EAN'}{group.eans.length > 3 ? ' +' + (group.eans.length - 3) : ''}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : editingProduct.id ? (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[150px_1fr_180px]">
                    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                      <p className="text-[9px] font-black uppercase text-slate-400">EAN</p>
                      <p className="truncate text-[11px] font-black text-slate-800">{editingProduct.ean || '-'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                      <p className="text-[9px] font-black uppercase text-slate-400">DescriÃ§Ã£o</p>
                      <p className="text-[11px] font-black leading-snug text-slate-800">{editingProduct.description || '-'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                      <p className="text-[9px] font-black uppercase text-slate-400">Fabricante</p>
                      <p className="text-[11px] font-black leading-snug text-slate-800">{editingProduct.brand || '-'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <div className="relative">
                      <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={productLaunchSearch}
                        onChange={(event) => setProductLaunchSearch(event.target.value)}
                        placeholder="Buscar por descriÃ§Ã£o, EAN, fabricante ou cÃ³digo..."
                        className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-xs font-black uppercase text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2">
                      {productLaunchOptions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-[10px] font-black uppercase text-slate-300">
                          Nenhum produto encontrado
                        </div>
                      ) : (
                        productLaunchOptions.map((group) => {
                          const selected = normalizeKey(editingProduct.description) === group.id;
                          return (
                            <button
                              key={group.id}
                              type="button"
                              onClick={() => applyProductGroupToLaunch(group)}
                              className={`mb-1 w-full rounded-xl border px-3 py-2 text-left transition last:mb-0 ${
                                selected ? 'border-blue-300 bg-blue-50' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <p className="text-[11px] font-black uppercase leading-snug text-slate-900">{group.description}</p>
                              <p className="mt-1 text-[9px] font-bold uppercase leading-relaxed text-slate-400">
                                {group.brand || 'Sem fabricante'}{group.eans.length ? ' | EAN ' + group.eans.slice(0, 4).join(', ') : ''}
                              </p>
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[150px_1fr_180px]">
                      <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                        <p className="text-[9px] font-black uppercase text-slate-400">EAN</p>
                        <p className="truncate text-[11px] font-black text-slate-800">{editingProduct.ean || '-'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                        <p className="text-[9px] font-black uppercase text-slate-400">DescriÃ§Ã£o</p>
                        <p className="text-[11px] font-black leading-snug text-slate-800">{editingProduct.description || '-'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                        <p className="text-[9px] font-black uppercase text-slate-400">Fabricante</p>
                        <p className="text-[11px] font-black leading-snug text-slate-800">{editingProduct.brand || '-'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(180px,0.7fr)_1fr]">
                <PriceInput label="Grupo de cotacao" value={editingProduct.promotion_group || ''} onChange={(value) => updateEditing('promotion_group', value.toUpperCase())} text />
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[9px] font-black uppercase text-slate-400">Uso</p>
                  <p className="text-[11px] font-bold text-slate-500">Use grupos como FRALDAS TESTE PA, FECHA MES ou CAMPANHA JULHO para filtrar e exportar lotes.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <PriceInput label="Preco de compra" value={editingProduct.purchase_price} onChange={(value) => updateEditing('purchase_price', numericValue(value))} />
              <DiscountInput label="Sell-in" value={editingProduct.sell_in_value} mode={editingProduct.sell_in_mode} onValue={(value) => updateEditing('sell_in_value', numericValue(value))} onMode={(mode) => updateEditing('sell_in_mode', mode)} />
              <DiscountInput label="Sell-out" value={editingProduct.sell_out_value} mode={editingProduct.sell_out_mode} onValue={(value) => updateEditing('sell_out_value', numericValue(value))} onMode={(mode) => updateEditing('sell_out_mode', mode)} />
              <DiscountInput label="Trade" value={editingProduct.trade_value} mode={editingProduct.trade_mode} onValue={(value) => updateEditing('trade_value', numericValue(value))} onMode={(mode) => updateEditing('trade_mode', mode)} />
              <PriceInput label="Novo PreÃ§o" value={editingProduct.sale_price} onChange={(value) => updateEditing('sale_price', numericValue(value))} />
              <div className="rounded-2xl border border-green-100 bg-green-50 p-3">
                <p className="text-[10px] font-black uppercase text-green-700">Custo LanÃ§ado</p>
                <p className="text-xl font-black text-green-800">{money(finalPrice(editingProduct))}</p>
              </div>
              <PriceInput label="Quarta da Fralda" value={editingProduct.baby_wednesday_price} onChange={(value) => updateEditing('baby_wednesday_price', numericValue(value))} />
              <PriceInput label="Fecha mÃªs" value={editingProduct.month_end_price} onChange={(value) => updateEditing('month_end_price', numericValue(value))} />
            </div>
            <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Lojas desse preÃ§o</p>
                  <p className="text-[10px] font-bold text-slate-500">Marque as lojas onde o novo preÃ§o deve entrar.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelectedLaunchBranchCodes(activeCityClusters.map((city) => city.code))} className="rounded-xl bg-white px-3 py-2 text-[9px] font-black uppercase text-blue-700">
                    Todas
                  </button>
                  <button type="button" onClick={() => setSelectedLaunchBranchCodes([])} className="rounded-xl bg-white px-3 py-2 text-[9px] font-black uppercase text-slate-500">
                    Limpar
                  </button>
                </div>
              </div>
              <div className="grid max-h-32 grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-3">
                {activeCityClusters.map((city) => (
                  <label key={city.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[9px] font-black uppercase ${selectedLaunchBranches.has(city.code) ? 'border-blue-300 bg-white text-blue-700' : 'border-white bg-white/70 text-slate-500'}`}>
                    <input
                      type="checkbox"
                      checked={selectedLaunchBranches.has(city.code)}
                      onChange={(event) => {
                        setSelectedLaunchBranchCodes((current) => (
                          event.target.checked
                            ? Array.from(new Set([...current, city.code]))
                            : current.filter((code) => code !== city.code)
                        ));
                      }}
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    <span className="truncate" title={city.branchNames.join(', ')}>{city.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <PriceGroup title="PreÃ§os Concorrentes" items={COMPETITORS} values={editingProduct.competitor_prices} onChange={(key, value) => updateNestedPrice('competitor_prices', key, value)} />
              <PriceGroup title="PreÃ§os por Cidade" items={activeCityClusters.map((city) => city.code)} labels={Object.fromEntries(activeCityClusters.map((city) => [city.code, city.name]))} values={Object.fromEntries(activeCityClusters.map((city) => [city.code, cityPriceForProduct(editingProduct, city)]))} onChange={updateCityPrice} />
            </div>
            </div>
            <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 bg-white px-5 py-3">
              <button onClick={() => setEditingProduct(null)} className="h-11 min-w-[140px] rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200">Cancelar</button>
              <button onClick={savePriceLaunch} disabled={saving} className="flex h-11 min-w-[180px] items-center justify-center gap-2 rounded-2xl bg-blue-600 text-xs font-black uppercase text-white transition hover:bg-blue-700 disabled:opacity-50">
                <Save size={16} /> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingBranch && (
        <div className="app-modal-viewport fixed inset-0 z-[85] flex justify-center bg-slate-900/16 backdrop-blur-sm">
          <div className="app-modal-card flex w-full max-w-[min(900px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
            <div className="flex items-center justify-between border-b-2 border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-xl font-black uppercase italic tracking-tighter">Filial</h2>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Cadastro de loja</p>
              </div>
              <button onClick={() => setEditingBranch(null)} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"><X size={21} /></button>
            </div>
            <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto px-5 py-4 md:grid-cols-2">
              <PriceInput label="Nome da filial" value={editingBranch.name} onChange={(value) => setEditingBranch((current) => current ? { ...current, name: value } : current)} text />
              <PriceInput label="CÃ³digo" value={editingBranch.code} onChange={(value) => setEditingBranch((current) => current ? { ...current, code: value } : current)} text />
              <PriceInput label="Cidade" value={editingBranch.city} onChange={(value) => setEditingBranch((current) => current ? { ...current, city: value } : current)} text />
              <PriceInput label="UF" value={editingBranch.uf} onChange={(value) => setEditingBranch((current) => current ? { ...current, uf: value } : current)} text />
              <PriceInput label="Grupo logistico" value={editingBranch.logistics_group || ''} onChange={(value) => setEditingBranch((current) => current ? { ...current, logistics_group: value } : current)} text />
              <PriceInput label="CNPJ" value={editingBranch.cnpj} onChange={(value) => setEditingBranch((current) => current ? { ...current, cnpj: value } : current)} text />
              <PriceInput label="RazÃ£o Social" value={editingBranch.legal_name} onChange={(value) => setEditingBranch((current) => current ? { ...current, legal_name: value } : current)} text />
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 border-2 border-slate-100 p-4">
                <input
                  type="checkbox"
                  checked={editingBranch.is_active}
                  onChange={(event) => setEditingBranch((current) => current ? { ...current, is_active: event.target.checked } : current)}
                  className="w-5 h-5"
                />
                <span className="text-[10px] font-black uppercase text-slate-500">Filial ativa</span>
              </label>
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 border-2 border-slate-100 p-4">
                <input
                  type="checkbox"
                  checked={editingBranch.sends_stock !== false}
                  onChange={(event) => setEditingBranch((current) => current ? { ...current, sends_stock: event.target.checked } : current)}
                  className="w-5 h-5"
                />
                <span className="text-[10px] font-black uppercase text-slate-500">Envia estoque</span>
              </label>
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 border-2 border-slate-100 p-4">
                <input
                  type="checkbox"
                  checked={editingBranch.receives_stock !== false}
                  onChange={(event) => setEditingBranch((current) => current ? { ...current, receives_stock: event.target.checked } : current)}
                  className="w-5 h-5"
                />
                <span className="text-[10px] font-black uppercase text-slate-500">Recebe estoque</span>
              </label>
            </div>
            <div className="flex justify-end gap-3 border-t-2 border-slate-100 px-5 py-4">
              <button onClick={() => setEditingBranch(null)} className="h-12 min-w-[160px] rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200">Cancelar</button>
              <button onClick={saveBranch} className="flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-2xl bg-blue-600 text-xs font-black uppercase text-white transition hover:bg-blue-700">
                <Save size={16} /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportModal && (
        <div className="app-modal-viewport fixed inset-0 z-[80] flex justify-center bg-slate-900/16 backdrop-blur-sm">
          <div className="app-modal-card flex w-full max-w-[min(680px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[24px] bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-black uppercase italic tracking-tight">Exportar Price</h2>
              <button onClick={() => setShowExportModal(false)}><X size={22} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="mb-4 rounded-2xl border-2 border-blue-100 bg-blue-50/50 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">TXT de oferta</p>
                    <p className="text-xs font-bold text-slate-500">Modelo: A|EAN|||preÃ§o ou B|EAN|||desconto</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase text-slate-500">{visibleProductGroups.length} descriÃ§Ãµes</span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-slate-400">Tipo</span>
                    <select value={txtExportType} onChange={(event) => setTxtExportType(event.target.value as PriceExportType)} className="h-11 w-full rounded-2xl border-2 border-white bg-white px-4 text-xs font-black uppercase outline-none focus:border-blue-600">
                      <option value="A">A - PreÃ§o</option>
                      <option value="B">B - Desconto</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-slate-400">Cidade</span>
                    <select value={txtBranchCode} onChange={(event) => setTxtBranchCode(event.target.value)} className="h-11 w-full rounded-2xl border-2 border-white bg-white px-4 text-xs font-black uppercase outline-none focus:border-blue-600">
                      <option value="">PreÃ§o geral</option>
                      {activeCityClusters.map((city) => (
                        <option key={city.id} value={city.code}>{city.name}</option>
                      ))}
                    </select>
                  </label>
                  {txtExportType === 'A' ? (
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-[9px] font-black uppercase text-slate-400">PreÃ§o para exportar</span>
                      <select value={txtPriceSource} onChange={(event) => setTxtPriceSource(event.target.value as TxtPriceSource)} className="h-11 w-full rounded-2xl border-2 border-white bg-white px-4 text-xs font-black uppercase outline-none focus:border-blue-600">
                        <option value="branch_price">Preco da cidade selecionada</option>
                        <option value="sale_price">Novo preÃ§o</option>
                        <option value="baby_wednesday_price">Quarta da Fralda</option>
                        <option value="month_end_price">Fecha mÃªs</option>
                      </select>
                    </label>
                  ) : (
                    <PriceInput label="Desconto %" value={txtDiscountPercent} onChange={(value) => setTxtDiscountPercent(numericValue(value))} />
                  )}
                </div>
                <button onClick={exportTxt} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-700">
                  <Download size={16} /> Baixar TXT
                </button>
              </div>
              <p className="mb-3 text-xs font-bold text-slate-500">
                A planilha seguirÃ¡ o modelo escolhido, incluindo preÃ§os por filial quando selecionado.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {EXPORT_OPTIONS.map((option) => (
                  <button key={option.id} onClick={() => setExportPrice(option.id)} className={`w-full rounded-2xl border-2 px-3 py-3 text-left text-sm font-black ${exportPrice === option.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-100 text-slate-600'}`}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3">
              <p className="text-xs font-bold text-slate-500">{visibleProductGroups.length} descriÃ§Ãµes - {visibleProducts.length} itens</p>
              <button onClick={exportCsv} className="flex rounded-2xl bg-green-600 px-5 py-3 text-xs font-black uppercase text-white items-center gap-2">
                <Download size={16} /> Baixar CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function PriceProductFilterBox({
  selectedGroups,
  inputValue,
  options,
  onInputChange,
  onAdd,
  onAddFromText,
  onRemove,
  onClear,
}: {
  selectedGroups: PricingProductGroup[];
  inputValue: string;
  options: PricingProductGroup[];
  onInputChange: (value: string) => void;
  onAdd: (group: PricingProductGroup) => void;
  onAddFromText: (value: string) => void;
  onRemove: (groupId: string) => void;
  onClear: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [markedIds, setMarkedIds] = useState<Set<string>>(() => new Set());
  const markedVisibleCount = selectedGroups.filter((group) => markedIds.has(group.id)).length;
  const summary = selectedGroups.length === 0
    ? 'Nenhum item filtrado.'
    : `${selectedGroups.length} ${selectedGroups.length === 1 ? 'item filtrado' : 'itens filtrados'}`;
  const preview = selectedGroups.slice(0, 2).map((group) => group.description).join(', ');
  const canSearch = inputValue.trim().length >= 3 || inputValue.replace(/\D/g, '').length >= 6;

  useEffect(() => {
    if (!expanded) return;

    const handlePointerDown = (event: globalThis.MouseEvent | TouchEvent) => {
      if (!containerRef.current || containerRef.current.contains(event.target as Node)) return;
      setExpanded(false);
      onInputChange('');
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [expanded, onInputChange]);

  const toggleMarked = (groupId: string) => {
    setMarkedIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const removeMarked = () => {
    markedIds.forEach((id) => onRemove(id));
    setMarkedIds(new Set());
  };

  const clearAll = () => {
    onClear();
    setMarkedIds(new Set());
  };

  const addQuickValue = () => {
    if (options.length > 0) {
      onAdd(options[0]);
      return;
    }
    onAddFromText(inputValue);
  };

  return (
    <div ref={containerRef} className={`relative text-slate-950 ${expanded ? 'z-[70]' : 'z-10'}`}>
      <div className={`h-12 overflow-hidden rounded-2xl border-2 bg-white transition ${selectedGroups.length ? 'border-blue-600 bg-blue-50' : 'border-slate-100'}`}>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-full w-full items-center justify-between gap-3 px-4 text-left"
        >
          <span className="min-w-0">
            <span className="block text-[8px] font-black uppercase text-slate-400">Produto</span>
            <span className={`block truncate text-[10px] font-black uppercase leading-tight ${selectedGroups.length ? 'text-blue-700' : 'text-slate-950'}`}>{summary}</span>
          </span>
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${selectedGroups.length ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-400'}`}>
            <Filter size={13} />
          </span>
        </button>
      </div>

      {expanded && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-[90] w-[min(680px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex h-11 items-center justify-between border-b border-slate-100 bg-white px-4">
            <div className="min-w-0">
              <span className="block text-xs font-black uppercase text-slate-950">Produto</span>
              {preview && <span className="block max-w-[420px] truncate text-[10px] font-bold uppercase text-slate-400">{preview}</span>}
            </div>
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                onInputChange('');
              }}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-50 text-slate-500 hover:bg-red-50 hover:text-red-600"
              aria-label="Fechar filtro"
            >
              <X size={15} />
            </button>
          </div>

          <div className="max-h-56 min-h-36 overflow-auto border-b border-slate-100 bg-white">
            <div className="sticky top-0 z-10 grid grid-cols-[36px_1.4fr_0.7fr_0.9fr_1fr_1fr] border-b border-slate-200 bg-slate-50 text-[9px] font-black uppercase text-slate-500">
              <span className="border-r border-slate-100 px-2 py-2" />
              <span className="border-r border-slate-100 px-2 py-2">DescriÃ§Ã£o</span>
              <span className="border-r border-slate-100 px-2 py-2">CÃ³digo ERP</span>
              <span className="border-r border-slate-100 px-2 py-2">EAN</span>
              <span className="border-r border-slate-100 px-2 py-2">Fabricante</span>
              <span className="px-2 py-2">ClassificaÃ§Ã£o</span>
            </div>
            {selectedGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => toggleMarked(group.id)}
                className={`grid w-full grid-cols-[36px_1.4fr_0.7fr_0.9fr_1fr_1fr] border-b border-slate-100 text-left text-[10px] font-bold uppercase last:border-b-0 ${markedIds.has(group.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
              >
                <span className="flex items-center justify-center border-r border-slate-100 py-2">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-md border ${markedIds.has(group.id) ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-transparent'}`}>
                    <Check size={11} />
                  </span>
                </span>
                <span className="truncate border-r border-slate-100 px-2 py-2 font-black text-slate-900">{group.description}</span>
                <span className="truncate border-r border-slate-100 px-2 py-2 text-slate-600">{group.erpCodes[0] || '-'}</span>
                <span className="truncate border-r border-slate-100 px-2 py-2 text-slate-600">{group.eans[0] || '-'}</span>
                <span className="truncate border-r border-slate-100 px-2 py-2 text-slate-600">{group.brand || '-'}</span>
                <span className="truncate px-2 py-2 text-slate-600">{group.classification || '-'}</span>
              </button>
            ))}
            {selectedGroups.length === 0 && (
              <div className="flex h-28 items-center justify-center bg-slate-50 text-xs font-black uppercase tracking-widest text-slate-300">
                Sem dados
              </div>
            )}
          </div>

          <div className="relative border-b border-slate-100 bg-slate-50 p-3">
            <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[110px_1fr_40px]">
              <span className="text-[10px] font-black uppercase text-slate-500">InclusÃ£o rÃ¡pida</span>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={inputValue}
                  onChange={(event) => onInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addQuickValue();
                    }
                  }}
                  onPaste={(event) => {
                    const text = event.clipboardData.getData('text');
                    if (!/[,\s;\n\r\t]/.test(text)) return;
                    event.preventDefault();
                    onAddFromText(text);
                  }}
                  placeholder="Informe Cod. de Barras, cÃ³digo ERP ou descriÃ§Ã£o"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-9 text-xs font-bold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                />
                {inputValue && (
                  <button
                    type="button"
                    onClick={() => onInputChange('')}
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg bg-slate-100 text-slate-400 hover:text-red-600"
                    aria-label="Limpar busca"
                  >
                    <X size={11} />
                  </button>
                )}
                {canSearch && (
                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[110] max-h-56 overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                    {options.length > 0 ? options.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => onAdd(group)}
                        className="mb-1 grid w-full grid-cols-[1.4fr_0.55fr_0.9fr] items-center gap-2 rounded-xl px-3 py-2 text-left text-[10px] font-bold uppercase last:mb-0 hover:bg-blue-50"
                      >
                        <span className="min-w-0 truncate text-slate-500">
                          DescriÃ§Ã£o: <strong className="text-slate-900">{group.description}</strong>
                        </span>
                        <span className="truncate text-slate-400">{group.erpCodes[0] || '-'}</span>
                        <span className="truncate text-slate-400">{group.eans[0] || '-'}</span>
                      </button>
                    )) : (
                      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                        Nenhuma opÃ§Ã£o encontrada
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={addQuickValue}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                title="Adicionar filtro"
              >
                <PlusIcon />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between bg-white px-3 py-3">
            <span className="text-[10px] font-black uppercase text-slate-400">
              {selectedGroups.length} selecionados - {markedVisibleCount} marcados
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={clearAll}
                disabled={selectedGroups.length === 0}
                className="h-9 rounded-xl bg-slate-100 px-3 text-[10px] font-black uppercase text-slate-500 disabled:opacity-45"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={removeMarked}
                disabled={markedVisibleCount === 0}
                className="h-9 rounded-xl bg-slate-100 px-3 text-[10px] font-black uppercase text-slate-500 disabled:opacity-45"
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
function PlusIcon() {
  return <span className="text-lg font-black leading-none">+</span>;
}

function PriceInput({ label, value, onChange, text = false, wide = false, compact = false }: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  text?: boolean;
  wide?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(text ? String(value) : editableNumber(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      queueMicrotask(() => setDraft(text ? String(value) : editableNumber(value)));
    }
  }, [focused, text, value]);

  return (
    <label className={`space-y-1 ${wide ? 'md:col-span-2' : ''}`}>
      <span className="text-[9px] font-black uppercase text-slate-400">{label}</span>
      <input
        value={text ? value : draft}
        type="text"
        inputMode={text ? undefined : 'decimal'}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (!text) setDraft(editableNumber(numericValue(draft)));
        }}
        onChange={(event) => {
          if (!text) setDraft(event.target.value);
          onChange(event.target.value);
        }}
        className={`w-full rounded-2xl border border-slate-100 bg-slate-50 font-bold outline-none focus:border-blue-600 ${compact ? 'px-3 py-2.5 text-sm' : 'p-3 text-sm'}`}
      />
    </label>
  );
}

function DiscountInput({ label, value, mode, onValue, onMode }: {
  label: string;
  value: number;
  mode: DiscountMode;
  onValue: (value: string) => void;
  onMode: (mode: DiscountMode) => void;
}) {
  const [draft, setDraft] = useState(editableNumber(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      queueMicrotask(() => setDraft(editableNumber(value)));
    }
  }, [focused, value]);

  return (
    <label className="space-y-1">
      <span className="text-[9px] font-black uppercase text-slate-400">{label}</span>
      <div className="flex overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 focus-within:border-blue-600">
        <input
          value={draft}
          type="text"
          inputMode="decimal"
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDraft(editableNumber(numericValue(draft)));
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            onValue(event.target.value);
          }}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-bold outline-none"
        />
        <button type="button" onClick={() => onMode('percent')} className={`w-10 font-black ${mode === 'percent' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>%</button>
        <button type="button" onClick={() => onMode('currency')} className={`w-10 font-black ${mode === 'currency' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>R$</button>
      </div>
    </label>
  );
}

function PriceGroup({ title, items, labels, values, onChange }: {
  title: string;
  items: string[];
  labels?: Record<string, string>;
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
}) {
  const shouldScroll = items.length > 8;

  return (
    <div className="rounded-2xl border border-slate-100 p-3">
      <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</h3>
      <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${shouldScroll ? 'max-h-56 overflow-y-auto pr-1' : ''}`}>
        {items.map((item) => (
          <PriceInput key={item} label={labels?.[item] || item} value={values?.[item] || 0} onChange={(value) => onChange(item, numericValue(value))} compact />
        ))}
      </div>
    </div>
  );
}





