'use client';

import { SortableTableHeader, useColumnSort } from '@/app/components/table-sort';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgePercent, Calculator, Check, ChevronDown, Download, Edit3, Save, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { strToU8, zipSync } from 'fflate';
import {
  deleteExpiringDiscountRule,
  fetchExpiringDiscountRules,
  fetchPricingBranches,
  fetchPricingProducts,
  fetchReallocationAttributeSummary,
  fetchReallocationProducts,
  saveExpiringDiscountRule,
  type ExpiringDiscountRuleInput,
} from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-headers';
import type { ExpiringDiscountRule, ExpiringDiscountType, ExpiringInventoryItem, ExpiringRuleScopeType, PricingBranch, PricingProduct, ReallocationProduct } from '@/lib/types';
import { MultiCheckboxFilter } from '@/app/components/multi-checkbox-filter';
import { expiringClassificationParts } from '@/lib/expiring-classification';
import { expiringRuleTargets } from '@/lib/expiring-rule-targets';
import { classifyExpiringItem, sortExpiringRules } from '@/lib/expiring-rule-calculation';
import { expiringA7Kind, isMarkupOffer, isStructuredOffer, quantityOfferTypes } from '@/lib/expiring-a7-offer';
import { RuleTargetFilter } from '@/app/components/rule-target-filter';
import { ruleTargetPlacement, type RuleTargetPlacement } from '@/lib/rule-target-placement';

interface RuleSelectOption {
  value: string;
  label: string;
}

type ExpiringTab = 'rules' | 'import' | 'calculate' | 'report' | 'export';
type ExportMode = 'single' | 'byBranch';

type ExpiringManagerCache = {
  items: ExpiringInventoryItem[];
  rules: ExpiringDiscountRule[];
  disabledRuleIds: string[];
  branches: PricingBranch[];
  pricingProducts: PricingProduct[];
  masterProducts: ReallocationProduct[];
  catalogManufacturers: string[];
  catalogClassifications: string[];
  missingTable: boolean;
};

let expiringManagerCache: ExpiringManagerCache | null = null;

const SCOPE_LABELS: Record<ExpiringRuleScopeType, string> = {
  product: 'Produto / EAN',
  manufacturer: 'Fabricante',
  line: 'Linha',
  department: 'Departamento',
  category: 'Categoria',
  classification: 'Classificacao completa',
  validity: 'Validade',
};

const blankRule: ExpiringDiscountRuleInput = {
  name: '',
  scope_type: 'category',
  scope_value: '',
  scope_values: [],
  discount_type: 'percent',
  discount_value: 0,
  min_days_to_expire: 0,
  max_days_to_expire: 90,
  priority: 100,
  is_active: true,
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatTxtNumber(value: number) {
  return String(Number(Number(value || 0).toFixed(4)));
}


function safeFilePart(value: string) {
  return normalize(value).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'loja';
}
function numericValue(value: string) {
  return Number(value.replace(',', '.')) || 0;
}

function monthsToDays(value: string) {
  return Math.max(0, Math.round(numericValue(value) * 30));
}

function daysToEditableMonths(value: number) {
  const months = Number(value || 0) / 30;
  if (!months) return '';
  return Number.isInteger(months) ? String(months) : months.toFixed(1).replace('.', ',');
}

function monthsRangeLabel(minDays: number, maxDays: number) {
  const minMonths = Number(minDays || 0) / 30;
  const maxMonths = Number(maxDays || 0) / 30;
  const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ','));
  return `${format(minMonths)}-${format(maxMonths)} meses`;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBinaryFile(filename: string, content: Uint8Array, type: string) {
  const payload = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  const blob = new Blob([payload], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function dateLabel(value: string | null) {
  if (!value) return '-';
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR');
}

function uniqueOptions(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((value) => ({ value, label: value }));
}
function normalizeBranchCode(value: string) {
  const text = value.trim().toUpperCase();
  return /^\d$/.test(text) ? `0${text}` : text;
}

function basePriceForItem(item: ExpiringInventoryItem, pricingByEan: Map<string, PricingProduct>) {
  if (Number(item.sale_price || 0) > 0) return Number(item.sale_price || 0);
  const product = pricingByEan.get(item.ean);
  if (!product) return 0;
  return Number(product.store_prices?.[item.branch_code] || product.sale_price || 0);
}

function discountLabel(rule: ExpiringDiscountRule) {
  if (rule.discount_type === 'buy_pay') return `C - Leve ${rule.offer_config?.take}, pague ${rule.offer_config?.pay}`;
  if (rule.discount_type === 'quantity_discount') return `D - ${rule.offer_config?.tiers?.length ?? 0} faixa(s)`;
  if (isMarkupOffer(rule.discount_type)) return `${expiringA7Kind[rule.discount_type]} - ${Number(rule.discount_value)}% markup`;
  if (rule.discount_type === 'half_cost_price') return 'A - 50% do custo';
  if (rule.discount_type === 'cost_percent_price' || rule.discount_type === 'sale_percent_price') {
    return `A - ${formatTxtNumber(Number(rule.discount_value))}% ${rule.discount_type === 'cost_percent_price' ? 'do custo' : 'da venda'}`;
  }
  if (rule.discount_type === 'fixed_price') return `A - ${money(Number(rule.discount_value || 0))}`;
  return `B - ${formatTxtNumber(Number(rule.discount_value || 0))}%`;
}

function productScopeLabel(product: ReallocationProduct) {
  return `${product.description} - ${product.ean}`;
}
function RuleSearchableSelect({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: RuleSelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<RuleTargetPlacement | null>(null);
  const positionPanel = useCallback(() => {
    if (!triggerRef.current) return;
    setPlacement(ruleTargetPlacement(triggerRef.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  }, []);
  const selectedOption = options.find((option) => option.value === value);
  const displayValue = selectedOption?.label || value;
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return options;
    return options.filter((option) => normalize(option.label + ' ' + option.value).includes(normalizedQuery));
  }, [options, query]);
  const visibleOptions = filteredOptions.slice(0, 80);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) positionPanel();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', positionPanel);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, positionPanel]);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setQuery('');
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) positionPanel();
          setOpen(!open);
        }}
        title={displayValue || placeholder}
        className={['flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border-2 px-3 py-2 text-left text-[10px] font-black uppercase leading-snug outline-none transition', open ? 'border-blue-200 bg-white text-slate-950 shadow-sm shadow-blue-100/70' : 'border-slate-100 bg-slate-50 text-slate-700 hover:border-blue-100 hover:bg-white'].join(' ')}
      >
        <span className="min-w-0 whitespace-normal break-words">{displayValue || placeholder}</span>
        <ChevronDown size={15} className={['shrink-0 transition', open ? 'rotate-180 text-blue-600' : 'text-slate-400'].join(' ')} />
      </button>

      {open && placement && createPortal(
        <div ref={panelRef} role="dialog" aria-label={placeholder} style={placement} className="fixed z-[311] flex flex-col overflow-hidden rounded-2xl border-2 border-slate-100 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
          <div className="shrink-0 border-b border-slate-100 p-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar..."
                className="h-10 w-full rounded-xl border-2 border-slate-100 bg-slate-50 pl-9 pr-3 text-xs font-bold uppercase text-slate-700 outline-none focus:border-blue-300 focus:bg-white"
              />
            </div>
          </div>

          <div className="min-h-0 overflow-auto overscroll-contain p-2">
            <button
              type="button"
              onClick={() => selectOption('')}
              className={['mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase transition', !value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'].join(' ')}
            >
              <span className="whitespace-normal break-words">{placeholder}</span>
              {!value && <Check size={14} />}
            </button>

            {visibleOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => selectOption(option.value)}
                className={['flex w-full items-start justify-between gap-3 rounded-xl px-3 py-3 text-left text-[10px] font-black uppercase leading-snug transition', value === option.value ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-50'].join(' ')}
                title={option.label}
              >
                <span className="min-w-0 whitespace-normal break-words">{option.label}</span>
                {value === option.value && <Check size={14} className="mt-0.5 shrink-0" />}
              </button>
            ))}

            {filteredOptions.length === 0 && (
              <p className="px-3 py-6 text-center text-[10px] font-black uppercase text-slate-400">
                Nenhuma opcao encontrada
              </p>
            )}
          </div>

          {filteredOptions.length > visibleOptions.length && (
            <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase text-slate-400">
              Mostrando {visibleOptions.length.toLocaleString('pt-BR')} de {filteredOptions.length.toLocaleString('pt-BR')}. Pesquise para refinar.
            </div>
          )}
        </div>, document.body
      )}
    </div>
  );
}

export function ExpiringProductsManager() {
  const [items, setItems] = useState<ExpiringInventoryItem[]>(() => expiringManagerCache?.items || []);
  const [rules, setRules] = useState<ExpiringDiscountRule[]>(() => expiringManagerCache?.rules || []);
  const rulesRef = useRef<ExpiringDiscountRule[]>(expiringManagerCache?.rules || []);
  const [disabledRuleIds, setDisabledRuleIds] = useState<string[]>(() => expiringManagerCache?.disabledRuleIds || []);
  const [branches, setBranches] = useState<PricingBranch[]>(() => expiringManagerCache?.branches || []);
  const [pricingProducts, setPricingProducts] = useState<PricingProduct[]>(() => expiringManagerCache?.pricingProducts || []);
  const [masterProducts, setMasterProducts] = useState<ReallocationProduct[]>(() => expiringManagerCache?.masterProducts || []);
  const [catalogManufacturers, setCatalogManufacturers] = useState<string[]>(() => expiringManagerCache?.catalogManufacturers || []);
  const [catalogClassifications, setCatalogClassifications] = useState<string[]>(() => expiringManagerCache?.catalogClassifications || []);
  const [loading, setLoading] = useState(() => !expiringManagerCache);
  const [loadError, setLoadError] = useState('');
  const loadRequest = useRef(0);
  const [importing, setImporting] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [missingTable, setMissingTable] = useState(() => expiringManagerCache?.missingTable || false);
  const [query, setQuery] = useState('');
  const [branchFilters, setBranchFilters] = useState<string[]>([]);
  const [manufacturerFilters, setManufacturerFilters] = useState<string[]>([]);
  const [maxDays, setMaxDays] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [calculatedItemIds, setCalculatedItemIds] = useState<string[]>([]);
  const [calculatedAt, setCalculatedAt] = useState<string | null>(null);
  const [reportMode, setReportMode] = useState<'offers' | 'excluded'>('offers');
  const [ruleDraft, setRuleDraft] = useState<ExpiringDiscountRuleInput>(blankRule);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpiringTab>('rules');
  const [exportMode, setExportMode] = useState<ExportMode>('single');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchExpiringDiscountRules(),
        fetchPricingBranches(),
        fetchPricingProducts(),
        fetchReallocationProducts({ limit: 2000 }),
        fetchReallocationAttributeSummary('manufacturer'),
        fetchReallocationAttributeSummary('classification'),
      ]);
      if (request !== loadRequest.current) return;
      const [ruleLoad, branchLoad, pricingLoad, masterLoad, manufacturerLoad, classificationLoad] = results;
      const ruleResult = ruleLoad.status === 'fulfilled' ? ruleLoad.value : { rules: rulesRef.current, missingTable: expiringManagerCache?.missingTable || false };
      const branchRows = branchLoad.status === 'fulfilled' ? branchLoad.value : expiringManagerCache?.branches || [];
      const pricingRows = pricingLoad.status === 'fulfilled' ? pricingLoad.value : expiringManagerCache?.pricingProducts || [];
      const masterRows = masterLoad.status === 'fulfilled' ? masterLoad.value : expiringManagerCache?.masterProducts || [];
      const nextRules = ruleResult.missingTable ? rulesRef.current : ruleResult.rules;
      const nextManufacturers = manufacturerLoad.status === 'fulfilled' ? manufacturerLoad.value.map(item => item.value) : expiringManagerCache?.catalogManufacturers || [];
      const nextClassifications = classificationLoad.status === 'fulfilled' ? classificationLoad.value.map(item => item.value) : expiringManagerCache?.catalogClassifications || [];
      const nextMissingTable = ruleResult.missingTable;
      const nextItems = expiringManagerCache?.items || [];
      const nextDisabledRuleIds = expiringManagerCache?.disabledRuleIds || [];
      const sources = ['regras', 'lojas', 'preços', 'produtos', 'fabricantes', 'categorias e classificações'];
      const failures = results.flatMap((result, index) => result.status === 'rejected' ? [sources[index]] : []);
      setLoadError(failures.length ? `Não foi possível atualizar: ${failures.join(', ')}. Os dados anteriores foram mantidos. Tente atualizar novamente.` : '');

      expiringManagerCache = {
        items: nextItems,
        rules: nextRules,
        disabledRuleIds: nextDisabledRuleIds,
        branches: branchRows,
        pricingProducts: pricingRows,
        masterProducts: masterRows,
        catalogManufacturers: nextManufacturers,
        catalogClassifications: nextClassifications,
        missingTable: nextMissingTable,
      };

      setItems(nextItems);
      setDisabledRuleIds(nextDisabledRuleIds);
      rulesRef.current = nextRules;
      setRules(nextRules);
      setBranches(branchRows);
      setPricingProducts(pricingRows);
      setMasterProducts(masterRows);
      setCatalogManufacturers(nextManufacturers);
      setCatalogClassifications(nextClassifications);
      setMissingTable(nextMissingTable);
    } catch (error) {
      if (request === loadRequest.current) setLoadError(error instanceof Error ? error.message : 'Erro ao carregar pré-vencidos.');
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => { window.clearTimeout(timer); loadRequest.current += 1; };
  }, [loadData]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadData();
    };

    window.addEventListener('wally:app-refresh', handleRefresh);
    return () => window.removeEventListener('wally:app-refresh', handleRefresh);
  }, [loadData]);

  const disabledRuleSet = useMemo(() => new Set(disabledRuleIds), [disabledRuleIds]);
  const activeProcessRules = useMemo(() => rules.filter((rule) => rule.is_active && !disabledRuleSet.has(rule.id)), [disabledRuleSet, rules]);
  const pricingByEan = useMemo(() => new Map(pricingProducts.map((product) => [product.ean, product])), [pricingProducts]);
  const branchByCode = useMemo(() => {
    const map = new Map<string, PricingBranch>();
    branches.forEach((branch) => {
      map.set(branch.code, branch);
      map.set(normalizeBranchCode(branch.code), branch);
    });
    return map;
  }, [branches]);
  const scopeTypeOptions = useMemo<RuleSelectOption[]>(() => Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label })), []);
  const discountTypeOptions = useMemo<RuleSelectOption[]>(() => [
    { value: 'percent', label: 'B - Desconto %' },
    { value: 'fixed_price', label: 'A - Preco fixo' },
    { value: 'half_cost_price', label: 'A - Metade do custo' },
    { value: 'cost_percent_price', label: 'A - Preço final: % do custo importado' },
    { value: 'sale_percent_price', label: 'A - Preço final: % da venda importada' },
    { value: 'buy_pay', label: 'C - Leve e pague' },
    { value: 'quantity_discount', label: 'D - Desconto por quantidade' },
    { value: 'cost_markup', label: 'E - Markup sobre custo' },
    { value: 'average_cost_markup', label: 'F - Markup sobre custo médio' },
    { value: 'reference_price_markup', label: 'G - Markup sobre preço referencial' },
  ], []);

  const masterClassificationPaths = useMemo(() => Array.from(new Set([
    ...catalogClassifications,
    ...masterProducts.map((item) => item.classification),
  ].filter(Boolean))), [catalogClassifications, masterProducts]);

  const manufacturerOptions = useMemo(() => uniqueOptions([
    ...catalogManufacturers,
    ...items.map((item) => item.manufacturer),
    ...masterProducts.map((item) => item.manufacturer),
  ]), [catalogManufacturers, items, masterProducts]);

  const ruleScopeOptions = useMemo(() => {
    const products = masterProducts.map((product) => ({ value: product.ean, label: productScopeLabel(product) }));
    return {
      product: products,
      manufacturer: manufacturerOptions,
      line: uniqueOptions([...items.map((item) => item.line), ...masterClassificationPaths.map(classification => expiringClassificationParts(classification).line)]),
      department: uniqueOptions([...items.map((item) => item.department), ...masterClassificationPaths.map(classification => expiringClassificationParts(classification).department)]),
      category: uniqueOptions([...items.map((item) => item.category), ...masterClassificationPaths.map(classification => expiringClassificationParts(classification).category)]),
      classification: uniqueOptions([...items.map((item) => item.classification_path), ...masterClassificationPaths]),
      validity: [{ value: 'VALIDADE', label: 'Todos os produtos dentro do periodo' }],
    } satisfies Record<ExpiringRuleScopeType, Array<{ value: string; label: string }>>;
  }, [items, manufacturerOptions, masterClassificationPaths, masterProducts]);

  const classifiedRows = useMemo(() => {
    const sortedRules = sortExpiringRules(activeProcessRules);
    return items.map(item => classifyExpiringItem(item, sortedRules, basePriceForItem(item, pricingByEan)));
  }, [activeProcessRules, items, pricingByEan]);

  const eligibleRows = useMemo(() => classifiedRows.filter(row => row.line !== null), [classifiedRows]);
  const calculatedSet = useMemo(() => new Set(calculatedItemIds), [calculatedItemIds]);
  const reportRows = useMemo(() => calculatedAt ? eligibleRows.filter(({ item }) => calculatedSet.has(item.id)) : [], [calculatedAt, calculatedSet, eligibleRows]);
  const excludedRows = useMemo(() => calculatedAt ? classifiedRows.filter(row => !row.rule) : [], [calculatedAt, classifiedRows]);

  const exportExcluded = async () => {
    try {
      const XLSX = await import('xlsx-js-style');
      const sheet = XLSX.utils.json_to_sheet(excludedRows.map(({ item, exclusionReason, rejectedRule }) => ({
        EAN: item.ean,
        Produto: item.description,
        Lote: item.lot,
        Loja: item.branch_code,
        Fabricante: item.manufacturer,
        Linha: item.line,
        Departamento: item.department,
        Categoria: item.category,
        Classificação: item.classification_path,
        Validade: dateLabel(item.expiration_date),
        'Dias para vencer': item.days_to_expire,
        Saldo: Number(item.balance_quantity),
        Custo: Number(item.cost_price) || null,
        Venda: Number(item.sale_price) || null,
        'Regra não aplicada': rejectedRule?.name || '',
        Motivo: exclusionReason,
      })));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Fora das regras');
      XLSX.writeFile(workbook, 'pre-vencidos-fora-das-regras.xlsx');
    } catch {
      alert('Não foi possível exportar a planilha.');
    }
  };

  const visibleRows = useMemo(() => {
    const normalizedQuery = normalize(query);
    const maxDaysValue = maxDays.trim() ? Number(maxDays.replace(',', '.')) : null;
    return reportRows.filter(({ item }) => {
      if (normalizedQuery && !normalize(`${item.description} ${item.ean} ${item.lot} ${item.manufacturer}`).includes(normalizedQuery)) return false;
      if (maxDaysValue !== null && Number.isFinite(maxDaysValue) && item.days_to_expire > maxDaysValue) return false;
      if (branchFilters.length && !branchFilters.includes(normalizeBranchCode(item.branch_code))) return false;
      if (manufacturerFilters.length) {
        const itemManufacturer = normalize(item.manufacturer);
        const matchesManufacturer = manufacturerFilters.some((manufacturer) => {
          const selectedManufacturer = normalize(manufacturer);
          return itemManufacturer === selectedManufacturer || itemManufacturer.includes(selectedManufacturer) || selectedManufacturer.includes(itemManufacturer);
        });
        if (!matchesManufacturer) return false;
      }
      return true;
    });
  }, [branchFilters, manufacturerFilters, maxDays, query, reportRows]);

  const reportSort = useColumnSort();
  const excludedSort = useColumnSort();
  const exportSort = useColumnSort();
  const sortedVisibleRows = reportSort.sortRowsBy(visibleRows, ({ item, rule, basePrice, price }) => ({
    description: item.description, branch: item.branch_code, balance: Number(item.balance_quantity || 0),
    days: item.days_to_expire, expiration: item.expiration_date, manufacturer: item.manufacturer, rule: rule?.name,
    base: basePrice, offer: price,
  }));
  const visibleItems = useMemo(() => visibleRows.map((row) => row.item), [visibleRows]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rowsForExport = selectedIds.length ? visibleRows.filter(({ item }) => selectedSet.has(item.id)) : visibleRows;
  const exportableRows = rowsForExport;
  const exportBranchCount = useMemo(() => new Set(exportableRows.map(({ item }) => normalizeBranchCode(item.branch_code))).size, [exportableRows]);

  const branchOptions = useMemo(() => {
    const registered = branches
      .filter((branch) => branch.is_active)
      .map((branch) => ({ value: normalizeBranchCode(branch.code), label: `${branch.code} - ${branch.name}` }));
    const registeredCodes = new Set(registered.map((option) => option.value));
    const importedWithoutRegistration = uniqueOptions(items.map((item) => normalizeBranchCode(item.branch_code)))
      .filter((option) => !registeredCodes.has(option.value))
      .map((option) => {
        const item = items.find((row) => normalizeBranchCode(row.branch_code) === option.value);
        return { value: option.value, label: `${option.value} - ${item?.branch_name || 'LOJA NAO CADASTRADA'}` };
      });
    return [...registered, ...importedWithoutRegistration];
  }, [branches, items]);

  const summary = useMemo(() => {
    const units = visibleRows.reduce((sum, { item }) => sum + Number(item.balance_quantity || 0), 0);
    return {
      imported: items.length,
      eligible: reportRows.length,
      matchedRules: eligibleRows.length,
      ignored: Math.max(0, items.length - eligibleRows.length),
      visible: visibleRows.length,
      units,
      rules: activeProcessRules.length,
    };
  }, [activeProcessRules.length, eligibleRows.length, items.length, reportRows.length, visibleRows]);

  const importFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/expiring-products/import', { method: 'POST', headers: await getAuthHeaders(), body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Erro ao importar pre-vencidos.');
      const importedItems = (data?.items || []) as ExpiringInventoryItem[];
      setItems(importedItems);
      setDisabledRuleIds([]);
      if (expiringManagerCache) expiringManagerCache = { ...expiringManagerCache, items: importedItems, disabledRuleIds: [] };
      else expiringManagerCache = {
        items: importedItems,
        rules,
        disabledRuleIds: [],
        branches,
        pricingProducts,
        masterProducts,
        catalogManufacturers,
        catalogClassifications,
        missingTable,
      };
      setCalculatedItemIds([]);
      setCalculatedAt(null);
      setSelectedIds([]);
      setActiveTab('calculate');
      const duplicateText = data?.duplicatesIgnored ? ` ${data.duplicatesIgnored} duplicatas ignoradas.` : '';
      alert(`${data.imported || importedItems.length || 0} lotes importados para este processo.${duplicateText} Clique em calcular para aplicar as regras ativas.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erro ao importar pre-vencidos.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const saveRule = async () => {
    setSavingRule(true);
    try {
      const payload: ExpiringDiscountRuleInput = ruleDraft.scope_type === 'validity'
        ? { ...ruleDraft, name: ruleDraft.name || 'VALIDADE', scope_value: 'VALIDADE', scope_values: ['VALIDADE'], priority: 100, is_active: true }
        : { ...ruleDraft, priority: 100, is_active: true };
      const savedRule = await saveExpiringDiscountRule(payload);
      setRules((current) => {
        const withoutSaved = current.filter((rule) => rule.id !== savedRule.id);
        const nextRules = [savedRule, ...withoutSaved].sort((left, right) => left.priority - right.priority || new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
        rulesRef.current = nextRules;
        if (expiringManagerCache) expiringManagerCache = { ...expiringManagerCache, rules: nextRules };
        return nextRules;
      });
      setRuleDraft(blankRule);
      setRuleEditorOpen(false);
      setCalculatedItemIds([]);
      setCalculatedAt(null);
      alert('Regra salva com sucesso.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erro ao salvar regra.');
    } finally {
      setSavingRule(false);
    }
  };

  const editRule = (rule: ExpiringDiscountRule) => {
    setRuleDraft({
      id: rule.id,
      name: rule.name,
      scope_type: rule.scope_type,
      scope_value: rule.scope_value,
      scope_values: expiringRuleTargets(rule),
      discount_type: rule.discount_type,
      discount_value: Number(rule.discount_value || 0),
      offer_config: rule.offer_config,
      min_days_to_expire: Number(rule.min_days_to_expire || 0),
      max_days_to_expire: Number(rule.max_days_to_expire || 0),
      priority: Number(rule.priority || 100),
      is_active: rule.is_active,
    });
    setActiveTab('rules');
    setRuleEditorOpen(true);
  };
  const removeRule = async (ruleId: string) => {
    if (!confirm('Excluir esta regra de desconto?')) return;

    const previousRules = rules;
    const nextRules = rules.filter((rule) => rule.id !== ruleId);
    const nextDisabledRuleIds = disabledRuleIds.filter((id) => id !== ruleId);
    rulesRef.current = nextRules;
    setRules(nextRules);
    setDisabledRuleIds(nextDisabledRuleIds);
    if (expiringManagerCache) expiringManagerCache = { ...expiringManagerCache, rules: nextRules, disabledRuleIds: nextDisabledRuleIds };
    setCalculatedItemIds([]);
    setCalculatedAt(null);

    try {
      await deleteExpiringDiscountRule(ruleId);
    } catch (error) {
      rulesRef.current = previousRules;
      setRules(previousRules);
      setDisabledRuleIds(disabledRuleIds);
      if (expiringManagerCache) expiringManagerCache = { ...expiringManagerCache, rules: previousRules, disabledRuleIds };
      alert(error instanceof Error ? error.message : 'Erro ao excluir regra.');
    }
  };


  const toggleRuleForCurrentImport = (ruleId: string) => {
    setDisabledRuleIds((current) => {
      const next = current.includes(ruleId) ? current.filter((id) => id !== ruleId) : [...current, ruleId];
      if (expiringManagerCache) expiringManagerCache = { ...expiringManagerCache, disabledRuleIds: next };
      return next;
    });
    setCalculatedItemIds([]);
    setCalculatedAt(null);
    setSelectedIds([]);
  };

  const calculateExpiringItems = () => {
    if (!items.length) {
      alert('Importe um arquivo de produtos antes de calcular.');
      return;
    }

    const ids = eligibleRows.map(({ item }) => item.id);
    setCalculatedItemIds(ids);
    setCalculatedAt(new Date().toISOString());
    setSelectedIds([]);
    setReportMode(ids.length ? 'offers' : 'excluded');
    setActiveTab('report');

    if (!ids.length) {
      alert('Calculo concluido: nenhum item importado bateu nas regras ativas.');
      return;
    }

    alert('Calculo concluido: ' + ids.length + ' item' + (ids.length === 1 ? '' : 's') + ' entraram no relatorio.');
  };
  const clearImportedProcess = () => {
    setItems([]);
    setCalculatedItemIds([]);
    setCalculatedAt(null);
    setSelectedIds([]);
    setDisabledRuleIds([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (expiringManagerCache) expiringManagerCache = { ...expiringManagerCache, items: [], disabledRuleIds: [] };
    setActiveTab('import');
  };

  const exportTxt = () => {
    const lineForRow = (row: (typeof exportableRows)[number]) => row.line;
    const ruleFilePart = (rows: typeof exportableRows) => {
      const names = Array.from(new Set(rows.map(({ rule }) => rule?.name || '').filter(Boolean)));
      if (names.length > 1) return 'multiplas-regras';
      if (names.length === 0) return 'sem-regra';
      return safeFilePart(names[0]).slice(0, 70).replace(/-+$/g, '') || 'regra';
    };
    const kindFilePart = (rows: typeof exportableRows) => {
      const kinds = Array.from(new Set(rows.flatMap(({ rule }) => rule ? [expiringA7Kind[rule.discount_type]] : [])));
      return kinds.length === 1 ? kinds[0] : 'misto';
    };

    if (!exportableRows.length) {
      alert(calculatedAt ? 'Nenhum pre-vencido com desconto valido para exportar.' : 'Calcule os pre-vencidos antes de exportar.');
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const exportedRule = ruleFilePart(exportableRows);

    if (exportMode === 'single') {
      downloadTextFile(`pre-vencidos-${kindFilePart(exportableRows)}-${exportedRule}-${date}.txt`, exportableRows.map(lineForRow).join('\r\n'));
      clearImportedProcess();
      return;
    }

    const rowsByBranch = new Map<string, typeof exportableRows>();
    exportableRows.forEach((row) => {
      const code = normalizeBranchCode(row.item.branch_code);
      rowsByBranch.set(code, [...(rowsByBranch.get(code) || []), row]);
    });

    const zipEntries: Record<string, Uint8Array> = {};
    rowsByBranch.forEach((rows, code) => {
      const branchName = branchByCode.get(code)?.name || rows[0]?.item.branch_name || code;
      const filename = `pre-vencidos-${kindFilePart(rows)}-${code}-${safeFilePart(branchName)}-${ruleFilePart(rows)}-${date}.txt`;
      zipEntries[filename] = strToU8(rows.map(lineForRow).join('\r\n'));
    });

    const zip = zipSync(zipEntries, { level: 6 });
    downloadBinaryFile(`pre-vencidos-por-loja-${exportedRule}-${date}.zip`, zip, 'application/zip');
    clearImportedProcess();
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleAllVisible = () => {
    const ids = visibleRows.map(({ item }) => item.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedSet.has(id));
    setSelectedIds(allSelected ? selectedIds.filter((id) => !ids.includes(id)) : Array.from(new Set([...selectedIds, ...ids])));
  };

  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem)] max-w-[1760px] flex-col overflow-hidden px-3 py-3 pb-24 md:pb-3">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        {loadError && <div role="alert" className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{loadError}</div>}
        {missingTable && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-black uppercase text-amber-700">
            Rode o SQL <span className="font-mono">supabase/expiring-products.sql</span> no Supabase para ativar a aba de pre-vencidos.
          </div>
        )}

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="shrink-0 p-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-black uppercase italic tracking-tight text-slate-950">Pre-vencidos</h1>
            <p className="text-xs font-bold text-slate-500">Fluxo simples: regra, arquivo, calculo, relatorio e TXT de desconto para o ERP.</p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            {([
              { id: 'rules', step: '01', title: 'Regras', detail: `${summary.rules} ativas` },
              { id: 'import', step: '02', title: 'Importar', detail: `${summary.imported.toLocaleString('pt-BR')} lotes` },
              { id: 'calculate', step: '03', title: 'Calcular', detail: `${eligibleRows.length.toLocaleString('pt-BR')} batem regra` },
              { id: 'report', step: '04', title: 'Relatorio', detail: `${summary.visible.toLocaleString('pt-BR')} na lista` },
              { id: 'export', step: '05', title: 'Exportar', detail: `${exportableRows.length.toLocaleString('pt-BR')} linhas` },
            ] satisfies Array<{ id: ExpiringTab; step: string; title: string; detail: string }>).map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    'flex min-h-16 items-center gap-3 rounded-2xl border px-3 py-2 text-left transition',
                    isActive ? 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-200 hover:bg-white',
                  ].join(' ')}
                >
                  <span className={['flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[10px] font-black', isActive ? 'bg-white/20 text-white' : 'bg-white text-blue-600'].join(' ')}>{tab.step}</span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-black uppercase tracking-wide">{tab.title}</span>
                    <span className={['block truncate text-[10px] font-bold', isActive ? 'text-blue-50' : 'text-slate-400'].join(' ')}>{tab.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden border-t border-slate-100 p-3">
          <div className="h-full min-h-0">
            {activeTab === 'import' && (
              <section className="flex h-full min-h-0 items-center justify-center overflow-auto p-4">
                <div className="w-full max-w-2xl rounded-[28px] border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void importFile(event.target.files?.[0] || null)} />
                  <UploadCloud size={34} className="mx-auto text-blue-600" />
                  <h2 className="mt-3 text-lg font-black uppercase italic text-slate-950">Importar arquivo</h2>
                  <p className="mx-auto mt-1 max-w-lg text-xs font-bold leading-relaxed text-slate-500">Importe EAN, loja, lote, saldo e validade. Para as regras sobre custo ou venda, inclua as colunas Custo e Preço de Venda.</p>
                  <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
                    <UploadCloud size={16} /> {importing ? 'Importando...' : 'Selecionar arquivo'}
                  </button>
                  <div className="mt-5 grid grid-cols-2 gap-2 text-left">
                    <div className="rounded-2xl bg-white px-4 py-3"><p className="text-[9px] font-black uppercase text-slate-400">Itens importados</p><p className="text-2xl font-black text-slate-950">{summary.imported.toLocaleString('pt-BR')}</p></div>
                    <div className="rounded-2xl bg-white px-4 py-3"><p className="text-[9px] font-black uppercase text-slate-400">Regras ativas</p><p className="text-2xl font-black text-slate-950">{summary.rules.toLocaleString('pt-BR')}</p></div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'calculate' && (
              <section className="flex h-full min-h-0 items-center justify-center overflow-auto p-4">
                <div className="w-full max-w-3xl rounded-[28px] border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                  <Calculator size={34} className="mx-auto text-[var(--section-accent)]" />
                  <h2 className="mt-3 text-xl font-black uppercase italic text-slate-950">Calcular pre-vencidos</h2>
                  <p className="mx-auto mt-1 max-w-2xl text-sm font-bold leading-relaxed text-slate-500">O sistema cruza o arquivo importado com as regras ativas e gera o relatorio dos itens que entram em oferta.</p>
                  <div className="mt-5 grid grid-cols-2 gap-2 text-left md:grid-cols-4">
                    <div className="rounded-2xl bg-white px-4 py-3"><p className="text-[9px] font-black uppercase text-slate-400">Importados</p><p className="text-2xl font-black text-slate-950">{summary.imported.toLocaleString('pt-BR')}</p></div>
                    <div className="rounded-2xl bg-white px-4 py-3"><p className="text-[9px] font-black uppercase text-slate-400">Regras</p><p className="text-2xl font-black text-slate-950">{summary.rules.toLocaleString('pt-BR')}</p></div>
                    <div className="rounded-2xl bg-[color-mix(in_srgb,var(--section-accent)_10%,white)] px-4 py-3"><p className="text-[9px] font-black uppercase text-[var(--section-accent)]">Entrariam</p><p className="text-2xl font-black text-slate-950">{eligibleRows.length.toLocaleString('pt-BR')}</p></div>
                    <div className="rounded-2xl bg-amber-50 px-4 py-3"><p className="text-[9px] font-black uppercase text-amber-600">Fora regra</p><p className="text-2xl font-black text-slate-950">{summary.ignored.toLocaleString('pt-BR')}</p></div>
                  </div>
                  <button onClick={calculateExpiringItems} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--section-accent)] px-6 text-xs font-black uppercase tracking-widest text-white transition hover:brightness-95">
                    <Calculator size={16} /> Aplicar regras e gerar relatorio
                  </button>
                </div>
              </section>
            )}

            {activeTab === 'report' && (
              <section className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 p-3">
              {([['offers', 'Em oferta', reportRows.length], ['excluded', 'Fora das regras', excludedRows.length]] as const).map(([mode, label, count]) => (
                <button key={mode} type="button" aria-pressed={reportMode === mode} onClick={() => setReportMode(mode)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${reportMode === mode ? 'border-[var(--section-accent)] text-[var(--section-accent)]' : 'border-slate-200 text-slate-600'}`}>{label} ({count})</button>
              ))}
              {reportMode === 'excluded' && <button type="button" disabled={!excludedRows.length} onClick={() => void exportExcluded()} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Download size={15} /> Exportar XLSX</button>}
            </div>
            {reportMode === 'excluded' ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[850px] text-left text-xs">
                  <thead className="text-slate-600"><tr>
                    {['Produto / lote', 'Loja', 'Validade', 'Fabricante', 'Classificação', 'Motivo'].map(label => <SortableTableHeader key={label} sort={excludedSort} column={label} className="px-3 py-3" />)}
                  </tr></thead>
                  <tbody>
                    {excludedSort.sortRowsBy(excludedRows, ({ item, exclusionReason }) => ({
                      'Produto / lote': item.description, Loja: item.branch_code, Validade: item.expiration_date,
                      Fabricante: item.manufacturer, 'Classificação': item.classification_path, Motivo: exclusionReason,
                    })).map(({ item, exclusionReason, rejectedRule }) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-3 py-3"><strong>{item.description}</strong><p>{item.ean} · {item.lot}</p></td>
                        <td className="px-3 py-3">{item.branch_code}</td>
                        <td className="px-3 py-3">{dateLabel(item.expiration_date)}</td>
                        <td className="px-3 py-3">{item.manufacturer || '-'}</td>
                        <td className="px-3 py-3">{item.classification_path || '-'}</td>
                        <td className="px-3 py-3">{exclusionReason}{rejectedRule && <p className="text-slate-500">{rejectedRule.name}</p>}</td>
                      </tr>
                    ))}
                    {!excludedRows.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">{calculatedAt ? 'Todos os itens entraram em oferta.' : 'Calcule para listar os itens fora das regras.'}</td></tr>}
                  </tbody>
                </table>
              </div>
            ) : <>
            <div className="shrink-0 border-b border-slate-100 p-3">
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(260px,1fr)_150px_minmax(190px,240px)_minmax(190px,240px)]">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nos pre-vencidos gerados..." className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 pl-10 pr-3 text-xs font-black uppercase outline-none focus:border-blue-500" />
                </div>
                <label className="h-12 rounded-2xl border-2 border-slate-100 bg-white px-3 py-1 text-[8px] font-black uppercase text-slate-400">
                  Filtro prazo ate dias
                  <input value={maxDays} onChange={(event) => setMaxDays(event.target.value)} className="block w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                </label>
                <MultiCheckboxFilter label="Loja" options={branchOptions} selectedValues={branchFilters} onChange={setBranchFilters} allLabel="Todas as lojas" />
                <MultiCheckboxFilter label="Fabricante" options={manufacturerOptions} selectedValues={manufacturerFilters} onChange={setManufacturerFilters} allLabel="Todos fabricantes" />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1180px] text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-3 text-left"><input type="checkbox" checked={visibleItems.length > 0 && visibleItems.every((item) => selectedSet.has(item.id))} onChange={toggleAllVisible} /></th>
                    <SortableTableHeader sort={reportSort} column="description" className="px-3 py-3 text-left">Produto / lote</SortableTableHeader>
                    <SortableTableHeader sort={reportSort} column="branch" className="px-3 py-3 text-left">Loja</SortableTableHeader>
                    <SortableTableHeader sort={reportSort} column="balance" className="px-3 py-3 text-right">Saldo</SortableTableHeader>
                    <SortableTableHeader sort={reportSort} column="days" className="px-3 py-3 text-right">Dias</SortableTableHeader>
                    <SortableTableHeader sort={reportSort} column="expiration" className="px-3 py-3 text-left">Validade</SortableTableHeader>
                    <SortableTableHeader sort={reportSort} column="manufacturer" className="px-3 py-3 text-left">Fabricante</SortableTableHeader>
                    <SortableTableHeader sort={reportSort} column="rule" className="px-3 py-3 text-left">Regra</SortableTableHeader>
                    <SortableTableHeader sort={reportSort} column="base" className="px-3 py-3 text-right">Preco base</SortableTableHeader>
                    <SortableTableHeader sort={reportSort} column="offer" className="px-3 py-3 text-right">Oferta</SortableTableHeader>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={10} className="px-4 py-12 text-center font-black uppercase text-slate-300">Carregando...</td></tr>
                  ) : visibleItems.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-12 text-center font-black uppercase text-slate-300">{calculatedAt ? 'Nenhum item bateu nas regras ativas' : 'Importe o arquivo e clique em calcular para gerar o relatorio'}</td></tr>
                  ) : sortedVisibleRows.map(({ item, rule, basePrice: base, price }) => (
                    <tr key={item.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                      <td className="px-3 py-3"><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggleSelected(item.id)} /></td>
                      <td className="px-3 py-3"><p className="font-black uppercase text-slate-950">{item.description}</p><p className="mt-1 text-[10px] font-bold text-slate-400">EAN {item.ean} - Lote {item.lot}</p></td>
                      <td className="px-3 py-3 font-bold text-slate-600">{normalizeBranchCode(item.branch_code)} - {branchByCode.get(normalizeBranchCode(item.branch_code))?.name || item.branch_name || 'LOJA NAO CADASTRADA'}</td>
                      <td className="px-3 py-3 text-right font-black">{Number(item.balance_quantity || 0).toLocaleString('pt-BR')}</td>
                      <td className={['px-3 py-3 text-right font-black', item.days_to_expire <= 60 ? 'text-red-600' : item.days_to_expire <= 120 ? 'text-amber-600' : 'text-slate-700'].join(' ')}>{item.days_to_expire}</td>
                      <td className="px-3 py-3 font-bold text-slate-600">{dateLabel(item.expiration_date)}</td>
                      <td className="px-3 py-3 font-bold text-slate-600">{item.manufacturer || '-'}</td>
                      <td className="px-3 py-3"><span className="rounded-full bg-[color-mix(in_srgb,var(--section-accent)_10%,white)] px-2 py-1 text-[10px] font-black uppercase text-[var(--section-accent)]">{rule?.name}</span></td>
                      <td className="px-3 py-3 text-right font-bold">{base ? money(base) : '-'}</td>
                      <td className="px-3 py-3 text-right font-black text-blue-600">{price ? money(price) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>}
          </section>
        )}

        {activeTab === 'rules' && (
          <section className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <BadgePercent size={18} className="text-blue-600" />
                    <h2 className="text-sm font-black uppercase tracking-widest text-slate-950">Regras de desconto</h2>
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-500">Crie regras e escolha quais entram no calculo da importacao atual.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRuleDraft(blankRule);
                    setRuleEditorOpen(true);
                  }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-[11px] font-black uppercase tracking-widest text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700"
                >
                  <BadgePercent size={15} /> Nova regra
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-50/60 p-3">
              {rules.length === 0 ? (
                <div className="flex h-full min-h-44 items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-white text-xs font-black uppercase tracking-widest text-slate-300">
                  Nenhuma regra cadastrada
                </div>
              ) : (
                <div className="grid gap-2">
                  {rules.map((rule) => {
                    const disabledForCurrentImport = disabledRuleSet.has(rule.id);
                    const usableInCurrentImport = rule.is_active && !disabledForCurrentImport;
                    return (
                      <article key={rule.id} className={['grid grid-cols-1 gap-3 rounded-3xl border bg-white px-4 py-3 shadow-sm shadow-slate-200/70 transition hover:shadow-md md:grid-cols-[minmax(180px,1fr)_minmax(260px,1.4fr)_130px_110px_150px_auto] md:items-center', usableInCurrentImport ? 'border-blue-100 hover:border-blue-200' : 'border-slate-100 opacity-70'].join(' ')}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black uppercase text-slate-950" title={rule.name}>{rule.name}</p>
                          <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400 md:hidden">{SCOPE_LABELS[rule.scope_type]}</p>
                        </div>
                        <div className="min-w-0 rounded-2xl bg-slate-50 px-3 py-2">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{SCOPE_LABELS[rule.scope_type]}</p>
                          <p className="mt-1 truncate text-xs font-black uppercase text-slate-700" title={rule.scope_type === 'validity' ? 'Todos os produtos dentro do periodo' : expiringRuleTargets(rule).join(', ')}>{rule.scope_type === 'validity' ? 'Todos os produtos dentro do periodo' : expiringRuleTargets(rule).join(', ')}</p>
                        </div>
                        <span className="text-xs font-black uppercase text-slate-700 md:text-right">{monthsRangeLabel(rule.min_days_to_expire, rule.max_days_to_expire)}</span>
                        <span className="rounded-2xl bg-[color-mix(in_srgb,var(--section-accent)_10%,white)] px-3 py-2 text-center text-sm font-black text-[var(--section-accent)]">{discountLabel(rule)}</span>
                        <button
                          type="button"
                          disabled={!rule.is_active}
                          onClick={() => toggleRuleForCurrentImport(rule.id)}
                          className={['inline-flex h-10 items-center justify-center rounded-2xl px-3 text-[10px] font-black uppercase tracking-widest transition', !rule.is_active ? 'cursor-not-allowed bg-slate-100 text-slate-300' : usableInCurrentImport ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100 hover:bg-blue-100' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100 hover:bg-amber-100'].join(' ')}
                          title={!rule.is_active ? 'Regra inativa no cadastro' : usableInCurrentImport ? 'Clique para ignorar esta regra neste processo' : 'Clique para usar esta regra neste processo'}
                        >
                          {!rule.is_active ? 'Inativa' : usableInCurrentImport ? 'Usando agora' : 'Ignorada agora'}
                        </button>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => editRule(rule)} className="p-2 text-slate-300 transition hover:text-blue-600" title="Editar regra"><Edit3 size={20} /></button>
                          <button onClick={() => void removeRule(rule.id)} className="p-2 text-slate-200 transition hover:text-red-600" title="Excluir regra"><Trash2 size={20} /></button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {ruleEditorOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
            <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col rounded-[28px] bg-white shadow-2xl shadow-slate-950/20">
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-5">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-600">Regra de desconto</p>
                  <h2 className="mt-1 text-xl font-black uppercase italic tracking-tight text-slate-950">{ruleDraft.id ? 'Editar regra' : 'Nova regra'}</h2>
                  <p className="mt-1 text-xs font-bold text-slate-500">Configure o alvo, prazo de vencimento e desconto que sera aplicado automaticamente.</p>
                  {loading && <p role="status" className="mt-2 text-xs text-slate-500">Carregando opções do banco...</p>}
                  {loadError && <p role="alert" className="mt-2 text-xs font-normal text-amber-700">{loadError}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRuleEditorOpen(false);
                    setRuleDraft(blankRule);
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                  aria-label="Fechar regra"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto p-5 lg:grid-cols-2">
                <div className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Identificacao</p>
                  <input value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} placeholder="Nome da regra" className="h-12 w-full min-w-0 rounded-2xl border-0 bg-white px-4 text-xs font-black uppercase text-slate-900 outline-none ring-1 ring-slate-100 transition placeholder:text-slate-400 hover:ring-blue-100 focus:ring-2 focus:ring-blue-200" />
                </div>

                <div className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4 lg:col-span-2">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Alvo da regra</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
                    <RuleSearchableSelect value={ruleDraft.scope_type} options={scopeTypeOptions} placeholder="Tipo" onChange={(value) => {
                      const nextScope = (value || 'category') as ExpiringRuleScopeType;
                      setRuleDraft({ ...ruleDraft, scope_type: nextScope, scope_value: nextScope === 'validity' ? 'VALIDADE' : '', scope_values: nextScope === 'validity' ? ['VALIDADE'] : [] });
                    }} />
                    {ruleDraft.scope_type === 'validity' ? (
                      <div className="flex h-12 items-center rounded-2xl bg-white px-4 text-xs font-black uppercase text-slate-500 ring-1 ring-slate-100">Todos os produtos dentro do periodo</div>
                    ) : (
                      <RuleTargetFilter key={ruleDraft.scope_type} label={SCOPE_LABELS[ruleDraft.scope_type]} options={ruleScopeOptions[ruleDraft.scope_type]} selectedValues={ruleDraft.scope_values ?? (ruleDraft.scope_value ? [ruleDraft.scope_value] : [])} onChange={values => setRuleDraft({ ...ruleDraft, scope_value: values[0] || '', scope_values: values })} />
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Prazo para vencer</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Min. meses<input value={daysToEditableMonths(ruleDraft.min_days_to_expire)} onChange={(event) => setRuleDraft({ ...ruleDraft, min_days_to_expire: monthsToDays(event.target.value) })} placeholder="0" className="mt-1 h-12 w-full rounded-2xl border-0 bg-white px-4 text-xs font-black text-slate-900 outline-none ring-1 ring-slate-100 transition hover:ring-blue-100 focus:ring-2 focus:ring-blue-200" /></label>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Max. meses<input value={daysToEditableMonths(ruleDraft.max_days_to_expire)} onChange={(event) => setRuleDraft({ ...ruleDraft, max_days_to_expire: monthsToDays(event.target.value) })} placeholder="3" className="mt-1 h-12 w-full rounded-2xl border-0 bg-white px-4 text-xs font-black text-slate-900 outline-none ring-1 ring-slate-100 transition hover:ring-blue-100 focus:ring-2 focus:ring-blue-200" /></label>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Tipo de oferta A7</p>
                  <div className="grid gap-3">
                    <RuleSearchableSelect value={ruleDraft.discount_type} options={discountTypeOptions} placeholder="Tipo de oferta" onChange={(value) => {
                      const type = (value || 'percent') as ExpiringDiscountType;
                      if (type === ruleDraft.discount_type) return;
                      setRuleDraft({ ...ruleDraft, discount_type: type, discount_value: 0, offer_config: type === 'quantity_discount' ? { quantityType: 'A', aboveQuantity: 'A', tiers: [{ quantity: 1, value: 0 }] } : null });
                    }} />
                    {!isStructuredOffer(ruleDraft.discount_type) && (
                      <label className="text-xs font-bold text-slate-600">
                        {ruleDraft.discount_type === 'fixed_price' ? 'Preço (R$)' : 'Percentual (%)'}
                        <input type="number" min="0.0001" step="0.0001" value={ruleDraft.discount_type === 'half_cost_price' ? 50 : ruleDraft.discount_value || ''} onChange={(event) => setRuleDraft({ ...ruleDraft, discount_value: Number(event.target.value) })} disabled={ruleDraft.discount_type === 'half_cost_price'} className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 disabled:opacity-60" />
                      </label>
                    )}
                    {ruleDraft.discount_type === 'buy_pay' && (
                      <div className="grid grid-cols-2 gap-2">
                        {(['take', 'pay'] as const).map((key) => (
                          <label key={key} className="text-xs font-bold text-slate-600">{key === 'take' ? 'Leve' : 'Pague'}
                            <input type="number" min="1" step="1" value={ruleDraft.offer_config?.[key] || ''} onChange={event => setRuleDraft({ ...ruleDraft, offer_config: { ...ruleDraft.offer_config, [key]: Number(event.target.value) } })} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3" />
                          </label>
                        ))}
                      </div>
                    )}
                    {ruleDraft.discount_type === 'quantity_discount' && (() => {
                      const config = ruleDraft.offer_config ?? {};
                      const tiers = config.tiers ?? [];
                      const update = (patch: Partial<typeof config>) => setRuleDraft({ ...ruleDraft, offer_config: { ...config, ...patch } });
                      return (
                        <div className="grid gap-2 text-xs font-bold text-slate-600">
                          <label>Tipo de desconto
                            <select value={config.quantityType} onChange={event => update({ quantityType: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2">
                              {Object.entries(quantityOfferTypes).map(([code, label]) => <option key={code} value={code}>{code} - {label}</option>)}
                            </select>
                          </label>
                          <label>Venda acima da última faixa
                            <select value={config.aboveQuantity} onChange={event => update({ aboveQuantity: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2">
                              <option value="A">A - Voltar à primeira regra</option>
                              <option value="B">B - Manter a última regra</option>
                            </select>
                          </label>
                          {tiers.map((tier, index) => (
                            <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                              {(['quantity', 'value'] as const).map(key => (
                                <label key={key}>{key === 'quantity' ? 'Qtd.' : 'Valor'}
                                  <input type="number" min={key === 'quantity' ? 1 : 0.0001} step={key === 'quantity' ? 1 : 0.0001} value={tier[key] || ''} onChange={event => update({ tiers: tiers.map((current, i) => i === index ? { ...current, [key]: Number(event.target.value) } : current) })} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2" />
                                </label>
                              ))}
                              <button type="button" title="Remover faixa" aria-label={`Remover faixa ${index + 1}`} disabled={tiers.length <= 1} onClick={() => update({ tiers: tiers.filter((_, i) => i !== index) })} className="h-10 px-2 text-red-600 disabled:opacity-30"><Trash2 size={16} /></button>
                            </div>
                          ))}
                          <button type="button" disabled={tiers.length >= 3} onClick={() => update({ tiers: [...tiers, { quantity: (tiers.at(-1)?.quantity ?? 0) + 1, value: 0 }] })} className="justify-self-start rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-40">Adicionar faixa</button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-100 p-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setRuleEditorOpen(false);
                    setRuleDraft(blankRule);
                  }}
                  className="inline-flex h-12 min-w-[180px] items-center justify-center rounded-2xl bg-slate-100 px-5 text-[11px] font-black uppercase tracking-widest text-slate-600 transition hover:bg-slate-200"
                >
                  Cancelar
                </button>
                <button onClick={() => void saveRule()} disabled={savingRule} className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:opacity-50"><Save size={16} /> {savingRule ? 'Salvando...' : ruleDraft.id ? 'Salvar edicao' : 'Salvar regra'}</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'export' && (
          <section className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-100 p-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-black uppercase tracking-widest text-slate-950">Exportacao TXT</h2>
                    <span className="rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-black uppercase text-blue-700">{exportableRows.length} linhas prontas</span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-500">A exportacao considera itens selecionados; sem selecao, usa os filtros atuais.</p>
                  <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-500">Modelo: B|EAN|||desconto ou A|EAN|||preco fixo. {exportMode === 'byBranch' ? `Sera gerado 1 ZIP com ${exportBranchCount} TXT${exportBranchCount === 1 ? '' : 's'}, um por loja.` : 'Todas as lojas filtradas saem em um TXT.'}</p>
                </div>
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(320px,520px)_220px] xl:w-auto xl:shrink-0">
                  <div className="grid grid-cols-2 gap-2 rounded-3xl bg-slate-100 p-1.5">
                    <button type="button" onClick={() => setExportMode('single')} className={['min-h-12 rounded-2xl px-4 text-[11px] font-black uppercase tracking-widest transition', exportMode === 'single' ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-white/70 text-slate-500 hover:bg-white'].join(' ')}>Arquivo unico</button>
                    <button type="button" onClick={() => setExportMode('byBranch')} className={['min-h-12 rounded-2xl px-4 text-[11px] font-black uppercase tracking-widest transition', exportMode === 'byBranch' ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-white/70 text-slate-500 hover:bg-white'].join(' ')}>Separado por loja</button>
                  </div>
                  <button onClick={exportTxt} className="inline-flex h-[54px] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-blue-200"><Download size={15} /> Exportar Arquivo</button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[920px] text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    <SortableTableHeader sort={exportSort} column="ean" className="px-3 py-3 text-left">EAN</SortableTableHeader>
                    <SortableTableHeader sort={exportSort} column="description" className="px-3 py-3 text-left">Produto</SortableTableHeader>
                    <SortableTableHeader sort={exportSort} column="branch" className="px-3 py-3 text-left">Loja</SortableTableHeader>
                    <SortableTableHeader sort={exportSort} column="rule" className="px-3 py-3 text-left">Regra</SortableTableHeader>
                    <SortableTableHeader sort={exportSort} column="price" className="px-3 py-3 text-right">Preco</SortableTableHeader>
                    <SortableTableHeader sort={exportSort} column="discount" className="px-3 py-3 text-right">Tipo / valor</SortableTableHeader>
                    <SortableTableHeader sort={exportSort} column="line" className="px-3 py-3 text-left">Linha TXT</SortableTableHeader>
                  </tr>
                </thead>
                <tbody>
                  {exportableRows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center font-black uppercase text-slate-300">Nenhum item pronto para exportar</td></tr>
                  ) : exportSort.sortRowsBy(exportableRows, ({ item, rule, price, line }) => ({
                    ean: item.ean, description: item.description, branch: item.branch_code, rule: rule?.name, price,
                    discount: rule ? discountLabel(rule) : '', line,
                  })).map(({ item, rule, price, line }) => (
                      <tr key={item.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                        <td className="px-3 py-3 font-black">{item.ean}</td>
                        <td className="px-3 py-3 font-bold uppercase text-slate-700">{item.description}</td>
                        <td className="px-3 py-3 font-bold text-slate-500">{normalizeBranchCode(item.branch_code)} - {branchByCode.get(normalizeBranchCode(item.branch_code))?.name || item.branch_name || 'LOJA NAO CADASTRADA'}</td>
                        <td className="px-3 py-3 font-bold uppercase text-slate-500">{rule?.name}</td>
                        <td className="px-3 py-3 text-right font-black text-blue-700">{price ? money(price) : '-'}</td>
                        <td className="px-3 py-3 text-right font-black text-[var(--section-accent)]">{rule ? discountLabel(rule) : '-'}</td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-500">{line}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
          </div>
          </div>
        </section>
      </div>
    </main>
  );
}











