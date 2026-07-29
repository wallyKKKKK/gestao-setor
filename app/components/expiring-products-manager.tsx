'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BadgePercent, Calculator, Check, ChevronDown, Download, Edit3, Save, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { strToU8, zipSync } from 'fflate';
import {
  deleteExpiringDiscountRule,
  fetchExpiringDiscountRules,
  fetchExpiringInventoryItems,
  fetchPricingBranches,
  fetchPricingProducts,
  fetchReallocationAttributeOptions,
  fetchReallocationAttributeSummary,
  fetchReallocationProducts,
  saveExpiringDiscountRule,
  type ExpiringDiscountRuleInput,
} from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-headers';
import type { ExpiringDiscountRule, ExpiringDiscountType, ExpiringInventoryItem, ExpiringRuleScopeType, PricingBranch, PricingProduct, ReallocationProduct } from '@/lib/types';
import { MultiCheckboxFilter } from '@/app/components/multi-checkbox-filter';

interface RuleSelectOption {
  value: string;
  label: string;
}

type ExpiringTab = 'rules' | 'import' | 'calculate' | 'report' | 'export';
type ExportMode = 'single' | 'byBranch';

type ExpiringManagerCache = {
  items: ExpiringInventoryItem[];
  rules: ExpiringDiscountRule[];
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
};

const blankRule: ExpiringDiscountRuleInput = {
  name: '',
  scope_type: 'category',
  scope_value: '',
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
  return String(Number(Number(value || 0).toFixed(2)));
}


function safeFilePart(value: string) {
  return normalize(value).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'loja';
}
function numericValue(value: string) {
  return Number(value.replace(',', '.')) || 0;
}

function editableNumber(value: number) {
  return value ? String(value).replace('.', ',') : '';
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

function scopeValueForItem(item: ExpiringInventoryItem, scope: ExpiringRuleScopeType) {
  if (scope === 'product') return item.ean;
  if (scope === 'manufacturer') return item.manufacturer;
  if (scope === 'line') return item.line;
  if (scope === 'department') return item.department;
  if (scope === 'category') return item.category;
  return item.classification_path;
}

function scopeRank(scope: ExpiringRuleScopeType) {
  return { product: 0, manufacturer: 1, category: 2, department: 3, line: 4, classification: 5 }[scope] ?? 9;
}

function ruleMatchesItem(rule: ExpiringDiscountRule, item: ExpiringInventoryItem) {
  if (!rule.is_active) return false;
  if (item.days_to_expire < rule.min_days_to_expire || item.days_to_expire > rule.max_days_to_expire) return false;
  return normalize(scopeValueForItem(item, rule.scope_type)) === normalize(rule.scope_value);
}

function bestRuleForItem(item: ExpiringInventoryItem, rules: ExpiringDiscountRule[]) {
  return rules
    .filter((rule) => ruleMatchesItem(rule, item))
    .sort((left, right) => left.priority - right.priority || scopeRank(left.scope_type) - scopeRank(right.scope_type))[0] || null;
}

function basePriceForItem(item: ExpiringInventoryItem, pricingByEan: Map<string, PricingProduct>) {
  const product = pricingByEan.get(item.ean);
  if (!product) return 0;
  return Number(product.store_prices?.[item.branch_code] || product.sale_price || 0);
}

function offerPrice(basePrice: number, rule: ExpiringDiscountRule | null) {
  if (!rule) return 0;
  if (rule.discount_type === 'fixed_price') return Number(rule.discount_value || 0);
  if (!basePrice) return 0;
  return Math.max(0, basePrice * (1 - Number(rule.discount_value || 0) / 100));
}

function discountPercent(basePrice: number, rule: ExpiringDiscountRule | null) {
  if (!rule) return 0;
  if (rule.discount_type === 'percent') return Number(rule.discount_value || 0);
  if (!basePrice) return 0;
  return Math.max(0, ((basePrice - Number(rule.discount_value || 0)) / basePrice) * 100);
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
  const containerRef = useRef<HTMLDivElement>(null);
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
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={displayValue || placeholder}
        className={['flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border-2 px-3 py-2 text-left text-[10px] font-black uppercase leading-snug outline-none transition', open ? 'border-blue-200 bg-white text-slate-950 shadow-sm shadow-blue-100/70' : 'border-slate-100 bg-slate-50 text-slate-700 hover:border-blue-100 hover:bg-white'].join(' ')}
      >
        <span className="min-w-0 whitespace-normal break-words">{displayValue || placeholder}</span>
        <ChevronDown size={15} className={['shrink-0 transition', open ? 'rotate-180 text-blue-600' : 'text-slate-400'].join(' ')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[90] mt-2 w-[min(560px,calc(100vw-2rem))] min-w-full overflow-hidden rounded-2xl border-2 border-slate-100 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
          <div className="border-b border-slate-100 p-2">
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

          <div className="max-h-72 overflow-auto p-2">
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
                className={['flex w-full items-start justify-between gap-3 rounded-xl px-3 py-3 text-left text-[10px] font-black uppercase leading-snug transition', value === option.value ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'].join(' ')}
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
            <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase text-slate-400">
              Mostrando {visibleOptions.length.toLocaleString('pt-BR')} de {filteredOptions.length.toLocaleString('pt-BR')}. Pesquise para refinar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ExpiringProductsManager() {
  const [items, setItems] = useState<ExpiringInventoryItem[]>(() => expiringManagerCache?.items || []);
  const [rules, setRules] = useState<ExpiringDiscountRule[]>(() => expiringManagerCache?.rules || []);
  const rulesRef = useRef<ExpiringDiscountRule[]>(expiringManagerCache?.rules || []);
  const [branches, setBranches] = useState<PricingBranch[]>(() => expiringManagerCache?.branches || []);
  const [pricingProducts, setPricingProducts] = useState<PricingProduct[]>(() => expiringManagerCache?.pricingProducts || []);
  const [masterProducts, setMasterProducts] = useState<ReallocationProduct[]>(() => expiringManagerCache?.masterProducts || []);
  const [catalogManufacturers, setCatalogManufacturers] = useState<string[]>(() => expiringManagerCache?.catalogManufacturers || []);
  const [catalogClassifications, setCatalogClassifications] = useState<string[]>(() => expiringManagerCache?.catalogClassifications || []);
  const [loading, setLoading] = useState(() => !expiringManagerCache);
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
  const [ruleDraft, setRuleDraft] = useState<ExpiringDiscountRuleInput>(blankRule);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpiringTab>('rules');
  const [exportMode, setExportMode] = useState<ExportMode>('single');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setLoading(!expiringManagerCache);
    try {
      const [itemResult, ruleResult, branchRows, pricingRows, masterRows, quickManufacturers, quickClassifications, manufacturerRows, classificationRows] = await Promise.all([
        fetchExpiringInventoryItems(),
        fetchExpiringDiscountRules(),
        fetchPricingBranches(),
        fetchPricingProducts(),
        fetchReallocationProducts({ limit: 2000 }),
        fetchReallocationAttributeOptions('manufacturer', '', 1000).catch(() => []),
        fetchReallocationAttributeOptions('classification', '', 1000).catch(() => []),
        fetchReallocationAttributeSummary('manufacturer').catch(() => []),
        fetchReallocationAttributeSummary('classification').catch(() => []),
      ]);
      const nextRules = ruleResult.missingTable ? rulesRef.current : ruleResult.rules;
      const nextManufacturers = Array.from(new Set([...quickManufacturers, ...manufacturerRows.map((item) => item.value)].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const nextClassifications = Array.from(new Set([...quickClassifications, ...classificationRows.map((item) => item.value)].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const nextMissingTable = itemResult.missingTable || ruleResult.missingTable;

      expiringManagerCache = {
        items: itemResult.items,
        rules: nextRules,
        branches: branchRows,
        pricingProducts: pricingRows,
        masterProducts: masterRows,
        catalogManufacturers: nextManufacturers,
        catalogClassifications: nextClassifications,
        missingTable: nextMissingTable,
      };

      setItems(itemResult.items);
      rulesRef.current = nextRules;
      setRules(nextRules);
      setBranches(branchRows);
      setPricingProducts(pricingRows);
      setMasterProducts(masterRows);
      setCatalogManufacturers(nextManufacturers);
      setCatalogClassifications(nextClassifications);
      setMissingTable(nextMissingTable);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erro ao carregar pre-vencidos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

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
    { value: 'percent', label: 'Desconto %' },
    { value: 'fixed_price', label: 'Preco fixo' },
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
      line: uniqueOptions([...items.map((item) => item.line), ...masterClassificationPaths.map((classification) => classification.split('>').map((part) => part.trim()).filter(Boolean)[1] || '')]),
      department: uniqueOptions([...items.map((item) => item.department), ...masterClassificationPaths.map((classification) => classification.split('>').map((part) => part.trim()).filter(Boolean)[2] || '')]),
      category: uniqueOptions([...items.map((item) => item.category), ...masterClassificationPaths.map((classification) => classification.split('>').map((part) => part.trim()).filter(Boolean)[3] || '')]),
      classification: uniqueOptions([...items.map((item) => item.classification_path), ...masterClassificationPaths]),
    } satisfies Record<ExpiringRuleScopeType, Array<{ value: string; label: string }>>;
  }, [items, manufacturerOptions, masterClassificationPaths, masterProducts]);

  const classifiedRows = useMemo(() => items.map((item) => {
    const rule = bestRuleForItem(item, rules);
    const basePrice = basePriceForItem(item, pricingByEan);
    const price = offerPrice(basePrice, rule);
    const discount = discountPercent(basePrice, rule);
    return { item, rule, basePrice, price, discount };
  }), [items, pricingByEan, rules]);

  const eligibleRows = useMemo(() => classifiedRows.filter((row) => row.rule), [classifiedRows]);
  const calculatedSet = useMemo(() => new Set(calculatedItemIds), [calculatedItemIds]);
  const reportRows = useMemo(() => calculatedAt ? eligibleRows.filter(({ item }) => calculatedSet.has(item.id)) : [], [calculatedAt, calculatedSet, eligibleRows]);

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

  const visibleItems = useMemo(() => visibleRows.map((row) => row.item), [visibleRows]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rowsForExport = selectedIds.length ? visibleRows.filter(({ item }) => selectedSet.has(item.id)) : visibleRows;
  const exportableRows = rowsForExport.filter((row) => row.discount > 0);
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
      rules: rules.filter((rule) => rule.is_active).length,
    };
  }, [eligibleRows.length, items.length, reportRows.length, rules, visibleRows]);

  const importFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/expiring-products/import', { method: 'POST', headers: await getAuthHeaders(), body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Erro ao importar pre-vencidos.');
      await loadData();
      setCalculatedItemIds([]);
      setCalculatedAt(null);
      setSelectedIds([]);
      setActiveTab('calculate');
      const duplicateText = data?.duplicatesIgnored ? ` ${data.duplicatesIgnored} duplicatas ignoradas.` : '';
      alert(`${data.imported || 0} lotes importados.${duplicateText} Clique em calcular para aplicar as regras ativas.`);
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
      const savedRule = await saveExpiringDiscountRule({ ...ruleDraft, priority: 100, is_active: true });
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
      discount_type: rule.discount_type,
      discount_value: Number(rule.discount_value || 0),
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
    rulesRef.current = nextRules;
    setRules(nextRules);
    if (expiringManagerCache) expiringManagerCache = { ...expiringManagerCache, rules: nextRules };
    setCalculatedItemIds([]);
    setCalculatedAt(null);

    try {
      await deleteExpiringDiscountRule(ruleId);
    } catch (error) {
      rulesRef.current = previousRules;
      setRules(previousRules);
      if (expiringManagerCache) expiringManagerCache = { ...expiringManagerCache, rules: previousRules };
      alert(error instanceof Error ? error.message : 'Erro ao excluir regra.');
    }
  };

  const calculateExpiringItems = () => {
    if (!items.length) {
      alert('Importe um arquivo de produtos antes de calcular.');
      return;
    }

    if (!rules.some((rule) => rule.is_active)) {
      alert('Cadastre ao menos uma regra ativa antes de calcular.');
      return;
    }

    const ids = eligibleRows.map(({ item }) => item.id);
    setCalculatedItemIds(ids);
    setCalculatedAt(new Date().toISOString());
    setSelectedIds([]);
    setActiveTab('report');

    if (!ids.length) {
      alert('Calculo concluido: nenhum item importado bateu nas regras ativas.');
      return;
    }

    alert('Calculo concluido: ' + ids.length + ' item' + (ids.length === 1 ? '' : 's') + ' entraram no relatorio.');
  };
  const exportTxt = () => {
    const lineForRow = ({ item, discount }: (typeof exportableRows)[number]) => `B|${item.ean}|||${formatTxtNumber(discount)}`;
    const ruleFilePart = (rows: typeof exportableRows) => {
      const names = Array.from(new Set(rows.map(({ rule }) => rule?.name || '').filter(Boolean)));
      if (names.length > 1) return 'multiplas-regras';
      if (names.length === 0) return 'sem-regra';
      return safeFilePart(names[0]).slice(0, 70).replace(/-+$/g, '') || 'regra';
    };

    if (!exportableRows.length) {
      alert(calculatedAt ? 'Nenhum pre-vencido com desconto valido para exportar.' : 'Calcule os pre-vencidos antes de exportar.');
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const exportedRule = ruleFilePart(exportableRows);

    if (exportMode === 'single') {
      downloadTextFile(`pre-vencidos-B-${exportedRule}-${date}.txt`, exportableRows.map(lineForRow).join('\r\n'));
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
      const filename = `pre-vencidos-B-${code}-${safeFilePart(branchName)}-${ruleFilePart(rows)}-${date}.txt`;
      zipEntries[filename] = strToU8(rows.map(lineForRow).join('\r\n'));
    });

    const zip = zipSync(zipEntries, { level: 6 });
    downloadBinaryFile(`pre-vencidos-B-por-loja-${exportedRule}-${date}.zip`, zip, 'application/zip');
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
              { id: 'export', step: '05', title: 'Exportar', detail: `${exportableRows.length.toLocaleString('pt-BR')} linhas B` },
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
                  <p className="mx-auto mt-1 max-w-lg text-xs font-bold leading-relaxed text-slate-500">Suba a planilha com EAN, loja, lote, saldo, validade e demais informacoes necessarias. Depois va para calcular.</p>
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
                <div className="w-full max-w-3xl">
                  <div className="rounded-[28px] bg-slate-950 p-6 text-white shadow-xl shadow-slate-950/10">
                    <Calculator size={34} className="text-emerald-300" />
                    <h2 className="mt-3 text-xl font-black uppercase italic">Calcular pre-vencidos</h2>
                    <p className="mt-1 text-sm font-bold text-slate-300">O sistema cruza o arquivo importado com as regras ativas e gera o relatorio dos itens que entram em oferta.</p>
                    <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
                      <div className="rounded-2xl bg-white/10 px-4 py-3"><p className="text-[9px] font-black uppercase text-slate-300">Importados</p><p className="text-2xl font-black">{summary.imported.toLocaleString('pt-BR')}</p></div>
                      <div className="rounded-2xl bg-white/10 px-4 py-3"><p className="text-[9px] font-black uppercase text-slate-300">Regras</p><p className="text-2xl font-black">{summary.rules.toLocaleString('pt-BR')}</p></div>
                      <div className="rounded-2xl bg-emerald-400/15 px-4 py-3"><p className="text-[9px] font-black uppercase text-emerald-200">Entrariam</p><p className="text-2xl font-black">{eligibleRows.length.toLocaleString('pt-BR')}</p></div>
                      <div className="rounded-2xl bg-amber-400/15 px-4 py-3"><p className="text-[9px] font-black uppercase text-amber-200">Fora regra</p><p className="text-2xl font-black">{summary.ignored.toLocaleString('pt-BR')}</p></div>
                    </div>
                    <button onClick={calculateExpiringItems} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-400">
                      <Calculator size={16} /> Aplicar regras e gerar relatorio
                    </button>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'report' && (
              <section className="flex h-full min-h-0 flex-col overflow-hidden">
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
                    <th className="px-3 py-3 text-left">Produto / lote</th>
                    <th className="px-3 py-3 text-left">Loja</th>
                    <th className="px-3 py-3 text-right">Saldo</th>
                    <th className="px-3 py-3 text-right">Dias</th>
                    <th className="px-3 py-3 text-left">Validade</th>
                    <th className="px-3 py-3 text-left">Fabricante</th>
                    <th className="px-3 py-3 text-left">Regra</th>
                    <th className="px-3 py-3 text-right">Preco base</th>
                    <th className="px-3 py-3 text-right">Oferta</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={10} className="px-4 py-12 text-center font-black uppercase text-slate-300">Carregando...</td></tr>
                  ) : visibleItems.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-12 text-center font-black uppercase text-slate-300">{calculatedAt ? 'Nenhum item bateu nas regras ativas' : 'Importe o arquivo e clique em calcular para gerar o relatorio'}</td></tr>
                  ) : visibleRows.map(({ item, rule, basePrice: base, price }) => (
                    <tr key={item.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                      <td className="px-3 py-3"><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggleSelected(item.id)} /></td>
                      <td className="px-3 py-3"><p className="font-black uppercase text-slate-950">{item.description}</p><p className="mt-1 text-[10px] font-bold text-slate-400">EAN {item.ean} - Lote {item.lot}</p></td>
                      <td className="px-3 py-3 font-bold text-slate-600">{normalizeBranchCode(item.branch_code)} - {branchByCode.get(normalizeBranchCode(item.branch_code))?.name || item.branch_name || 'LOJA NAO CADASTRADA'}</td>
                      <td className="px-3 py-3 text-right font-black">{Number(item.balance_quantity || 0).toLocaleString('pt-BR')}</td>
                      <td className={['px-3 py-3 text-right font-black', item.days_to_expire <= 60 ? 'text-red-600' : item.days_to_expire <= 120 ? 'text-amber-600' : 'text-slate-700'].join(' ')}>{item.days_to_expire}</td>
                      <td className="px-3 py-3 font-bold text-slate-600">{dateLabel(item.expiration_date)}</td>
                      <td className="px-3 py-3 font-bold text-slate-600">{item.manufacturer || '-'}</td>
                      <td className="px-3 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase text-emerald-700">{rule?.name}</span></td>
                      <td className="px-3 py-3 text-right font-bold">{base ? money(base) : '-'}</td>
                      <td className="px-3 py-3 text-right font-black text-blue-600">{price ? money(price) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                  <p className="mt-1 text-xs font-bold text-slate-500">Crie regras por produto, fabricante, linha, departamento ou categoria.</p>
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
                  {rules.map((rule) => (
                    <article key={rule.id} className="grid grid-cols-1 gap-3 rounded-3xl border border-slate-100 bg-white px-4 py-3 shadow-sm shadow-slate-200/70 transition hover:border-blue-100 hover:shadow-md md:grid-cols-[minmax(180px,1fr)_minmax(260px,1.4fr)_130px_110px_auto] md:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black uppercase text-slate-950" title={rule.name}>{rule.name}</p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400 md:hidden">{SCOPE_LABELS[rule.scope_type]}</p>
                      </div>
                      <div className="min-w-0 rounded-2xl bg-slate-50 px-3 py-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{SCOPE_LABELS[rule.scope_type]}</p>
                        <p className="mt-1 truncate text-xs font-black uppercase text-slate-700" title={rule.scope_value}>{rule.scope_value}</p>
                      </div>
                      <span className="text-xs font-black uppercase text-slate-700 md:text-right">{monthsRangeLabel(rule.min_days_to_expire, rule.max_days_to_expire)}</span>
                      <span className="rounded-2xl bg-emerald-50 px-3 py-2 text-center text-sm font-black text-emerald-700">{rule.discount_type === 'percent' ? String(rule.discount_value) + '%' : money(rule.discount_value)}</span>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => editRule(rule)} className="p-2 text-slate-300 transition hover:text-blue-600" title="Editar regra"><Edit3 size={20} /></button>
                        <button onClick={() => void removeRule(rule.id)} className="p-2 text-slate-200 transition hover:text-red-600" title="Excluir regra"><Trash2 size={20} /></button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {ruleEditorOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
            <div className="w-full max-w-5xl overflow-visible rounded-[28px] bg-white shadow-2xl shadow-slate-950/20">
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-600">Regra de desconto</p>
                  <h2 className="mt-1 text-xl font-black uppercase italic tracking-tight text-slate-950">{ruleDraft.id ? 'Editar regra' : 'Nova regra'}</h2>
                  <p className="mt-1 text-xs font-bold text-slate-500">Configure o alvo, prazo de vencimento e desconto que sera aplicado automaticamente.</p>
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

              <div className="grid grid-cols-1 gap-3 p-5 lg:grid-cols-2">
                <div className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Identificacao</p>
                  <input value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} placeholder="Nome da regra" className="h-12 w-full min-w-0 rounded-2xl border-0 bg-white px-4 text-xs font-black uppercase text-slate-900 outline-none ring-1 ring-slate-100 transition placeholder:text-slate-400 hover:ring-blue-100 focus:ring-2 focus:ring-blue-200" />
                </div>

                <div className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4 lg:col-span-2">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Alvo da regra</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
                    <RuleSearchableSelect value={ruleDraft.scope_type} options={scopeTypeOptions} placeholder="Tipo" onChange={(value) => setRuleDraft({ ...ruleDraft, scope_type: (value || 'category') as ExpiringRuleScopeType, scope_value: '' })} />
                    <RuleSearchableSelect value={ruleDraft.scope_value} options={ruleScopeOptions[ruleDraft.scope_type]} placeholder="Escolha o alvo" onChange={(value) => setRuleDraft({ ...ruleDraft, scope_value: value })} />
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
                  <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Desconto aplicado</p>
                  <div className="grid grid-cols-[minmax(150px,1fr)_120px] gap-3">
                    <RuleSearchableSelect value={ruleDraft.discount_type} options={discountTypeOptions} placeholder="Desconto" onChange={(value) => setRuleDraft({ ...ruleDraft, discount_type: (value || 'percent') as ExpiringDiscountType })} />
                    <input value={editableNumber(ruleDraft.discount_value)} onChange={(event) => setRuleDraft({ ...ruleDraft, discount_value: numericValue(event.target.value) })} placeholder="Valor" className="h-11 w-full min-w-0 rounded-2xl border-0 bg-white px-4 text-xs font-black uppercase text-slate-900 outline-none ring-1 ring-slate-100 transition placeholder:text-slate-400 hover:ring-blue-100 focus:ring-2 focus:ring-blue-200" />
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-slate-100 p-5 sm:flex-row sm:justify-end">
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
                  <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-500">Modelo: B|EAN|||desconto. {exportMode === 'byBranch' ? `Sera gerado 1 ZIP com ${exportBranchCount} TXT${exportBranchCount === 1 ? '' : 's'}, um por loja.` : 'Todas as lojas filtradas saem em um TXT.'}</p>
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
                    <th className="px-3 py-3 text-left">EAN</th>
                    <th className="px-3 py-3 text-left">Produto</th>
                    <th className="px-3 py-3 text-left">Loja</th>
                    <th className="px-3 py-3 text-left">Regra</th>
                    <th className="px-3 py-3 text-right">Preco</th>
                    <th className="px-3 py-3 text-right">Desconto</th>
                    <th className="px-3 py-3 text-left">Linha TXT</th>
                  </tr>
                </thead>
                <tbody>
                  {exportableRows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center font-black uppercase text-slate-300">Nenhum item pronto para exportar</td></tr>
                  ) : exportableRows.map(({ item, rule, price, discount }) => ( 
                      <tr key={item.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                        <td className="px-3 py-3 font-black">{item.ean}</td>
                        <td className="px-3 py-3 font-bold uppercase text-slate-700">{item.description}</td>
                        <td className="px-3 py-3 font-bold text-slate-500">{normalizeBranchCode(item.branch_code)} - {branchByCode.get(normalizeBranchCode(item.branch_code))?.name || item.branch_name || 'LOJA NAO CADASTRADA'}</td>
                        <td className="px-3 py-3 font-bold uppercase text-slate-500">{rule?.name}</td>
                        <td className="px-3 py-3 text-right font-black text-blue-700">{price ? money(price) : '-'}</td>
                        <td className="px-3 py-3 text-right font-black text-emerald-700">{discount ? formatTxtNumber(discount) + '%' : '-'}</td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-500">B|{item.ean}|||{formatTxtNumber(discount)}</td>
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











