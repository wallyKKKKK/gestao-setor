'use client';

import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Boxes, RefreshCw, Search, X } from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-headers';

interface ErpInventoryViewItem {
  id: string;
  branch_code: string;
  branch_name: string;
  ean: string;
  erp_code: string | null;
  product_description: string;
  manufacturer: string;
  classification_path: string;
  line: string;
  department: string;
  category: string;
  stock_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  average_cost: number;
  sale_price: number;
  monthly_avg_sales: number;
  stock_days: number;
  curve: string;
  last_sale_days: number;
  last_purchase_days: number;
  updated_at: string;
  purchase_suspended: boolean;
}

interface ErpInventorySummary {
  totalItems: number;
  listedItems: number;
  totalStock: number;
  totalAvailable: number;
  branches: number;
  lastUpdatedAt: string | null;
}

interface ErpInventoryResponse {
  items: ErpInventoryViewItem[];
  summary: ErpInventorySummary | null;
  missingTable?: boolean;
  error?: string;
}

interface FilterOption {
  value: string;
  label: string;
}

interface ErpInventoryFilterOptionsResponse {
  branches: FilterOption[];
  manufacturers: FilterOption[];
  lines: FilterOption[];
  departments: FilterOption[];
  categories: FilterOption[];
  curves: FilterOption[];
  missingTable?: boolean;
  error?: string;
}

type FilterKey = 'branch' | 'manufacturer' | 'line' | 'department' | 'category' | 'curve';
type FilterOptionsState = Record<'branches' | 'manufacturers' | 'lines' | 'departments' | 'categories' | 'curves', FilterOption[]>;
type SortDirection = 'asc' | 'desc';
type SuspendedFilterMode = 'yes' | 'no' | 'all';
type ColumnKey = 'branch' | 'ean' | 'erpCode' | 'product' | 'manufacturer' | 'classification' | 'stock' | 'available' | 'monthlySales' | 'stockDays' | 'curve' | 'purchaseStatus' | 'cost' | 'salePrice' | 'lastSale' | 'lastPurchase';

interface InventoryColumnDefinition {
  key: ColumnKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
  align?: 'left' | 'right' | 'center';
  render: (item: ErpInventoryViewItem) => string;
  title?: (item: ErpInventoryViewItem) => string;
  sortValue: (item: ErpInventoryViewItem) => string | number;
  cellClassName?: string;
}

const INVENTORY_COLUMNS: InventoryColumnDefinition[] = [
  {
    key: 'branch',
    label: 'Loja',
    defaultWidth: 112,
    minWidth: 86,
    render: (item) => `${item.branch_code} - ${item.branch_name}`,
    sortValue: (item) => `${item.branch_code} ${item.branch_name}`,
    cellClassName: 'font-black text-slate-700',
  },
  { key: 'ean', label: 'EAN', defaultWidth: 112, minWidth: 92, render: (item) => item.ean, sortValue: (item) => item.ean, cellClassName: 'font-bold text-slate-600' },
  { key: 'erpCode', label: 'Codigo', defaultWidth: 68, minWidth: 58, render: (item) => item.erp_code || '-', sortValue: (item) => item.erp_code || '', cellClassName: 'font-bold text-slate-600' },
  { key: 'product', label: 'Produto', defaultWidth: 300, minWidth: 180, render: (item) => item.product_description, sortValue: (item) => item.product_description, cellClassName: 'font-black text-slate-950' },
  { key: 'manufacturer', label: 'Fabricante', defaultWidth: 150, minWidth: 110, render: (item) => item.manufacturer || '-', sortValue: (item) => item.manufacturer || '', cellClassName: 'font-bold text-slate-600' },
  { key: 'classification', label: 'Classificacao', defaultWidth: 210, minWidth: 130, render: compactClassification, sortValue: compactClassification, cellClassName: 'font-bold text-slate-500' },
  { key: 'stock', label: 'Estoque', defaultWidth: 70, minWidth: 60, align: 'right', render: (item) => numberFormat(item.stock_quantity), sortValue: (item) => item.stock_quantity, cellClassName: 'font-black text-slate-950 tabular-nums' },
  { key: 'available', label: 'Dispon.', defaultWidth: 78, minWidth: 66, align: 'right', render: (item) => numberFormat(item.available_quantity), sortValue: (item) => item.available_quantity, cellClassName: 'font-black text-emerald-700 tabular-nums' },
  { key: 'monthlySales', label: 'Media mes', defaultWidth: 88, minWidth: 72, align: 'right', render: (item) => decimalFormat(item.monthly_avg_sales), sortValue: (item) => item.monthly_avg_sales, cellClassName: 'font-bold text-slate-600 tabular-nums' },
  { key: 'stockDays', label: 'Dias', defaultWidth: 60, minWidth: 52, align: 'right', render: (item) => wholeNumberFormat(item.stock_days), sortValue: (item) => item.stock_days, cellClassName: 'font-bold text-slate-600 tabular-nums' },
  { key: 'curve', label: 'Curva', defaultWidth: 50, minWidth: 46, align: 'center', render: (item) => item.curve || '-', sortValue: (item) => item.curve || '', cellClassName: 'font-black text-blue-700' },
  { key: 'purchaseStatus', label: 'Compra', defaultWidth: 92, minWidth: 82, align: 'center', render: (item) => item.purchase_suspended ? 'Suspenso' : 'Liberado', sortValue: (item) => item.purchase_suspended ? 1 : 0, cellClassName: 'font-black' },
  { key: 'cost', label: 'Custo', defaultWidth: 76, minWidth: 70, align: 'right', render: (item) => money(item.average_cost), sortValue: (item) => item.average_cost, cellClassName: 'font-bold text-slate-600 tabular-nums' },
  { key: 'salePrice', label: 'Venda', defaultWidth: 76, minWidth: 70, align: 'right', render: (item) => money(item.sale_price), sortValue: (item) => item.sale_price, cellClassName: 'font-bold text-slate-600 tabular-nums' },
  { key: 'lastSale', label: 'Ult. venda', defaultWidth: 70, minWidth: 64, align: 'right', render: (item) => numberFormat(item.last_sale_days), sortValue: (item) => item.last_sale_days, cellClassName: 'font-bold text-slate-600 tabular-nums' },
  { key: 'lastPurchase', label: 'Ult. compra', defaultWidth: 70, minWidth: 64, align: 'right', render: (item) => numberFormat(item.last_purchase_days), sortValue: (item) => item.last_purchase_days, cellClassName: 'font-bold text-slate-600 tabular-nums' },
];

const DEFAULT_COLUMN_ORDER = INVENTORY_COLUMNS.map((column) => column.key);
const DEFAULT_COLUMN_WIDTHS = INVENTORY_COLUMNS.reduce<Record<ColumnKey, number>>((widths, column) => {
  widths[column.key] = column.defaultWidth;
  return widths;
}, {} as Record<ColumnKey, number>);

const EMPTY_FILTER_OPTIONS: FilterOptionsState = {
  branches: [],
  manufacturers: [],
  lines: [],
  departments: [],
  categories: [],
  curves: [],
};

const SUSPENDED_FILTER_OPTIONS: FilterOption[] = [
  { value: 'no', label: 'Nao' },
  { value: 'yes', label: 'Sim' },
  { value: 'all', label: 'Ambos' },
];

function numberFormat(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function decimalFormat(value: number, digits = 2) {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function wholeNumberFormat(value: number) {
  return Math.round(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dateTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function compactClassification(item: ErpInventoryViewItem) {
  return [item.line, item.department, item.category].filter(Boolean).join(' > ') || item.classification_path || '-';
}

function inventoryRowKey(item: ErpInventoryViewItem) {
  return `${item.branch_code}::${item.ean}`;
}

function filterLabel(value: string, placeholder: string) {
  return value || placeholder;
}

function StatusMetric({ label, value, helper, tone = 'slate' }: { label: string; value: string; helper?: string; tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' }) {
  const toneClass = {
    slate: 'border-slate-200 bg-white text-slate-700',
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    green: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    red: 'border-red-100 bg-red-50 text-red-700',
  }[tone];

  return (
    <div className={`min-h-[54px] rounded-lg border px-3 py-2 shadow-sm ${toneClass}`}>
      <p className="text-[8px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="text-lg font-black leading-tight text-slate-950">{value}</p>
      {helper ? <p className="text-[8px] font-black uppercase tracking-wide opacity-70">{helper}</p> : null}
    </div>
  );
}

function FilterCard({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="group flex h-[58px] min-w-[138px] flex-col justify-center rounded-lg border border-slate-200 bg-white px-3 shadow-sm transition hover:border-blue-200">
      <span className="text-[8px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-w-0 cursor-pointer bg-transparent text-[10px] font-black uppercase text-slate-950 outline-none"
        title={filterLabel(value, placeholder)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ErpInventoryManager() {
  const [items, setItems] = useState<ErpInventoryViewItem[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptionsState>(EMPTY_FILTER_OPTIONS);
  const [summary, setSummary] = useState<ErpInventorySummary | null>(null);
  const [search, setSearch] = useState('');
  const [suspendedFilter, setSuspendedFilter] = useState<SuspendedFilterMode>('no');
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(() => new Set());
  const [suspensionSaving, setSuspensionSaving] = useState(false);
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    branch: '',
    manufacturer: '',
    line: '',
    department: '',
    category: '',
    curve: '',
  });
  const [loading, setLoading] = useState(false);
  const [hasLoadedInventory, setHasLoadedInventory] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [error, setError] = useState('');
  const [missingTable, setMissingTable] = useState(false);
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(DEFAULT_COLUMN_ORDER);
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(DEFAULT_COLUMN_WIDTHS);
  const [sortConfig, setSortConfig] = useState<{ key: ColumnKey; direction: SortDirection } | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<ColumnKey | null>(null);

  const loadFilterOptions = useCallback(async () => {
    setLoadingFilters(true);

    try {
      const response = await fetch('/api/erp/inventory/filters', {
        headers: await getAuthHeaders(),
      });
      const payload = await response.json() as ErpInventoryFilterOptionsResponse;

      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel carregar filtros do estoque ERP.');

      setFilterOptions({
        branches: payload.branches || [],
        manufacturers: payload.manufacturers || [],
        lines: payload.lines || [],
        departments: payload.departments || [],
        categories: payload.categories || [],
        curves: payload.curves || [],
      });
      setMissingTable(Boolean(payload.missingTable));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nao foi possivel carregar filtros do estoque ERP.');
    } finally {
      setLoadingFilters(false);
    }
  }, []);

  const loadInventory = useCallback(async (options: { quiet?: boolean } = {}) => {
    setHasLoadedInventory(true);
    if (!options.quiet) setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      params.set('suspended', suspendedFilter);
      params.set('limit', '1000');

      const response = await fetch(`/api/erp/inventory/current?${params.toString()}`, {
        headers: await getAuthHeaders(),
      });
      const payload = await response.json() as ErpInventoryResponse;

      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel carregar estoque ERP.');

      setItems(payload.items || []);
      setSelectedRowKeys(new Set());
      setSummary(payload.summary || null);
      setMissingTable(Boolean(payload.missingTable));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nao foi possivel carregar estoque ERP.');
    } finally {
      setLoading(false);
    }
  }, [filters, search, suspendedFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFilterOptions();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadFilterOptions]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadFilterOptions();
      void loadInventory();
    };

    window.addEventListener('wally:app-refresh', handleRefresh);
    return () => window.removeEventListener('wally:app-refresh', handleRefresh);
  }, [loadFilterOptions, loadInventory]);

  const tableSummary = useMemo(() => ({
    rows: summary?.listedItems ?? items.length,
    stock: summary?.totalStock ?? items.reduce((sum, item) => sum + item.stock_quantity, 0),
    available: summary?.totalAvailable ?? items.reduce((sum, item) => sum + item.available_quantity, 0),
    zeroStock: items.filter((item) => item.available_quantity <= 0).length,
    updatedAt: summary?.lastUpdatedAt || null,
  }), [items, summary]);

  const columnByKey = useMemo(() => new Map(INVENTORY_COLUMNS.map((column) => [column.key, column])), []);

  const orderedColumns = useMemo(() => columnOrder
    .map((key) => columnByKey.get(key))
    .filter((column): column is InventoryColumnDefinition => Boolean(column)), [columnByKey, columnOrder]);

  const tableWidth = useMemo(() => orderedColumns.reduce((sum, column) => sum + (columnWidths[column.key] || column.defaultWidth), 42), [columnWidths, orderedColumns]);

  const sortedItems = useMemo(() => {
    if (!sortConfig) return items;
    const column = columnByKey.get(sortConfig.key);
    if (!column) return items;

    return [...items].sort((a, b) => {
      const left = column.sortValue(a);
      const right = column.sortValue(b);
      const direction = sortConfig.direction === 'asc' ? 1 : -1;

      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * direction;
      }

      return String(left || '').localeCompare(String(right || ''), 'pt-BR', { numeric: true, sensitivity: 'base' }) * direction;
    });
  }, [columnByKey, items, sortConfig]);

  const selectedItems = useMemo(() => items.filter((item) => selectedRowKeys.has(inventoryRowKey(item))), [items, selectedRowKeys]);
  const allVisibleSelected = sortedItems.length > 0 && sortedItems.every((item) => selectedRowKeys.has(inventoryRowKey(item)));
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (search.trim() ? 1 : 0) + (suspendedFilter !== 'no' ? 1 : 0);

  function resetInventoryResults() {
    setItems([]);
    setSummary(null);
    setSelectedRowKeys(new Set());
    setHasLoadedInventory(false);
  }

  function setFilter(key: FilterKey, value: string) {
    resetInventoryResults();
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    resetInventoryResults();
    setSearch('');
    setSuspendedFilter('no');
    setFilters({ branch: '', manufacturer: '', line: '', department: '', category: '', curve: '' });
  }

  function refreshAll() {
    void loadFilterOptions();
    void loadInventory();
  }

  function toggleRowSelection(item: ErpInventoryViewItem) {
    const key = inventoryRowKey(item);
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllVisibleSelection() {
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        sortedItems.forEach((item) => next.delete(inventoryRowKey(item)));
      } else {
        sortedItems.forEach((item) => next.add(inventoryRowKey(item)));
      }
      return next;
    });
  }

  async function updatePurchaseSuspension(suspended: boolean) {
    if (!selectedItems.length) return;

    setSuspensionSaving(true);
    setError('');

    try {
      const response = await fetch('/api/erp/inventory/suspensions', {
        method: 'PATCH',
        headers: {
          ...(await getAuthHeaders()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          suspended,
          items: selectedItems.map((item) => ({ branchCode: item.branch_code, ean: item.ean })),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };

      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel alterar a suspensao de compra.');

      await loadInventory({ quiet: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nao foi possivel alterar a suspensao de compra.');
    } finally {
      setSuspensionSaving(false);
    }
  }

  function toggleSort(key: ColumnKey) {
    setSortConfig((current) => {
      if (!current || current.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

  function moveColumn(source: ColumnKey, target: ColumnKey) {
    if (source === target) return;
    setColumnOrder((current) => {
      const next = current.filter((key) => key !== source);
      const targetIndex = next.indexOf(target);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
      return next;
    });
  }

  function startColumnResize(event: ReactMouseEvent<HTMLButtonElement>, column: InventoryColumnDefinition) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidths[column.key] || column.defaultWidth;

    function handleMouseMove(moveEvent: MouseEvent) {
      const nextWidth = Math.max(column.minWidth, startWidth + moveEvent.clientX - startX);
      setColumnWidths((current) => ({ ...current, [column.key]: nextWidth }));
    }

    function handleMouseUp() {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  function resetColumns() {
    setColumnOrder(DEFAULT_COLUMN_ORDER);
    setColumnWidths(DEFAULT_COLUMN_WIDTHS);
    setSortConfig(null);
  }

  return (
    <main className="flex h-[calc(100vh-4rem)] min-h-[620px] w-full flex-col overflow-hidden bg-[#E8EEF7] p-2 text-slate-950 sm:p-3">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-[0_4px_14px_rgba(15,23,42,0.08)]">
        <div className="grid gap-2 border-b border-slate-200 bg-white p-2 xl:grid-cols-[1fr_420px_142px]">
          <div className="min-w-0">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <FilterCard label="Loja" value={filters.branch} placeholder="Todas as lojas" options={filterOptions.branches} onChange={(value) => setFilter('branch', value)} />
              <FilterCard label="Fabricante" value={filters.manufacturer} placeholder="Todos fabricantes" options={filterOptions.manufacturers} onChange={(value) => setFilter('manufacturer', value)} />
              <FilterCard label="Linha" value={filters.line} placeholder="Todas linhas" options={filterOptions.lines} onChange={(value) => setFilter('line', value)} />
              <FilterCard label="Departamento" value={filters.department} placeholder="Todos departamentos" options={filterOptions.departments} onChange={(value) => setFilter('department', value)} />
              <FilterCard label="Categoria" value={filters.category} placeholder="Todas categorias" options={filterOptions.categories} onChange={(value) => setFilter('category', value)} />
              <FilterCard label="Curva" value={filters.curve} placeholder="Todas curvas" options={filterOptions.curves} onChange={(value) => setFilter('curve', value)} />
              <FilterCard label="Mostrar suspensos" value={suspendedFilter} placeholder="Nao" options={SUSPENDED_FILTER_OPTIONS} onChange={(value) => { resetInventoryResults(); setSuspendedFilter((value || 'no') as SuspendedFilterMode); }} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase">
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[9px] text-blue-700 shadow-sm hover:border-blue-300 disabled:opacity-40"
                disabled={activeFilterCount === 0}
              >
                <X size={12} /> Limpar filtros
              </button>
              <span className={activeFilterCount > 0 ? 'text-red-600' : 'text-slate-400'}>{activeFilterCount} filtros selecionados</span>
              <span className="hidden text-slate-400 sm:inline">{hasLoadedInventory ? `Atualizado: ${dateTime(tableSummary.updatedAt)}` : 'Consulta nao carregada'}</span>
              {loadingFilters ? <span className="text-blue-600">Carregando filtros...</span> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-2">
            <StatusMetric label="Registros" value={numberFormat(tableSummary.rows)} helper={`${numberFormat(summary?.totalItems || 0)} base`} tone="blue" />
            <StatusMetric label="Estoque" value={numberFormat(tableSummary.stock)} helper="fisico" tone="green" />
            <StatusMetric label="Disponivel" value={numberFormat(tableSummary.available)} helper="saldo" tone="slate" />
            <StatusMetric label="Sem saldo" value={numberFormat(tableSummary.zeroStock)} helper="atencao" tone="amber" />
          </div>

          <div className="grid grid-cols-2 gap-1 xl:grid-cols-1">
            <button
              type="button"
              onClick={refreshAll}
              disabled={loading || loadingFilters}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-black uppercase text-slate-700 shadow-sm hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
            >
              <RefreshCw size={13} className={`mr-1 inline-block ${loading || loadingFilters ? 'animate-spin' : ''}`} /> Atualizar
            </button>
            <StatusMetric label="Lojas" value={numberFormat(summary?.branches || filterOptions.branches.length)} helper="ERP" />
          </div>
        </div>

        {missingTable ? (
          <div className="mx-2 mt-2 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest">Tabela ERP nao encontrada</p>
              <p className="mt-1 text-xs font-bold">Rode o SQL do nucleo ERP no Supabase antes de usar essa tela.</p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mx-2 mt-2 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest">Nao foi possivel carregar</p>
              <p className="mt-1 text-xs font-bold">{error}</p>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 shadow-sm focus-within:border-blue-300">
            <Search size={17} className="text-slate-400" />
            <input
              value={search}
              onChange={(event) => { resetInventoryResults(); setSearch(event.target.value); }}
              placeholder="Informe EAN, codigo ERP ou descricao e clique em Atualizar..."
              className="h-full min-w-0 flex-1 bg-transparent text-[11px] font-black text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <span className="hidden items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-blue-700 lg:flex">
            <Boxes size={13} /> Estoque ERP
          </span>
        </div>

        <div className="border-b border-slate-200 bg-slate-50 px-2 py-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
            <span>Arraste colunas para realocar. Clique no cabecalho para ordenar. Puxe a borda para expandir.</span>
            <div className="flex flex-wrap items-center gap-2">
              {selectedItems.length > 0 ? <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700">{selectedItems.length} selecionados</span> : null}
              <button
                type="button"
                onClick={() => void updatePurchaseSuspension(true)}
                disabled={!selectedItems.length || suspensionSaving}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-red-100 bg-red-50 px-2 text-[9px] font-black uppercase text-red-700 shadow-sm hover:border-red-200 disabled:opacity-40"
              >
                <Ban size={12} /> Suspender de compra
              </button>
              <button
                type="button"
                onClick={() => void updatePurchaseSuspension(false)}
                disabled={!selectedItems.length || suspensionSaving}
                className="h-7 rounded-md border border-emerald-100 bg-emerald-50 px-2 text-[9px] font-black uppercase text-emerald-700 shadow-sm hover:border-emerald-200 disabled:opacity-40"
              >
                Remover suspensao
              </button>
              <button
                type="button"
                onClick={resetColumns}
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[9px] font-black uppercase text-blue-700 shadow-sm hover:border-blue-300"
              >
                Restaurar colunas
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-white">
          <table className="table-fixed border-separate border-spacing-0 text-[11px] leading-tight whitespace-nowrap" style={{ width: tableWidth, minWidth: tableWidth }}>
            <colgroup>
              {orderedColumns.map((column) => (
                <col key={column.key} style={{ width: columnWidths[column.key] || column.defaultWidth }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-100 text-[9px] font-black uppercase tracking-wide text-slate-600 shadow-[0_1px_0_rgba(148,163,184,0.55)]">
              <tr>
                <th className="border-b border-r border-slate-300 bg-slate-100 px-2 text-center">
                  <input
                    type="checkbox"
                    aria-label="Selecionar itens visiveis"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisibleSelection}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                </th>
                {orderedColumns.map((column) => {
                  const isSorted = sortConfig?.key === column.key;
                  const alignment = column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left';
                  const sortIcon = isSorted ? (sortConfig.direction === 'asc' ? 'â–²' : 'â–¼') : 'â†•';

                  return (
                    <th
                      key={column.key}
                      draggable
                      onDragStart={(event) => {
                        setDraggedColumn(column.key);
                        event.dataTransfer.setData('text/plain', column.key);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const source = (event.dataTransfer.getData('text/plain') || draggedColumn) as ColumnKey | null;
                        if (source) moveColumn(source, column.key);
                        setDraggedColumn(null);
                      }}
                      onDragEnd={() => setDraggedColumn(null)}
                      className={`relative border-b border-r border-slate-300 bg-slate-100 px-0 py-0 ${alignment} ${draggedColumn === column.key ? 'opacity-50' : ''}`}
                      title="Clique para ordenar, arraste para realocar ou puxe a borda para expandir."
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={`flex h-8 w-full items-center gap-1 px-2 text-[9px] font-black uppercase tracking-wide text-slate-600 hover:bg-blue-50 hover:text-blue-700 ${column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : 'justify-start'}`}
                      >
                        <span className="truncate">{column.label}</span>
                        <span className={isSorted ? 'text-blue-700' : 'text-slate-300'}>{sortIcon}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Redimensionar coluna ${column.label}`}
                        onMouseDown={(event) => startColumnResize(event, column)}
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-blue-500/70"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {loading && !items.length ? (
                <tr>
                  <td colSpan={orderedColumns.length + 1} className="h-72 border-b border-slate-100 px-3 text-center align-middle text-[10px] font-black uppercase tracking-widest text-slate-400">Carregando estoque ERP...</td>
                </tr>
              ) : !hasLoadedInventory ? (
                <tr>
                  <td colSpan={orderedColumns.length + 1} className="h-72 border-b border-slate-100 px-3 text-center align-middle text-[10px] font-black uppercase tracking-widest text-slate-400">Clique em Atualizar para carregar o estoque ERP</td>
                </tr>
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={orderedColumns.length + 1} className="h-72 border-b border-slate-100 px-3 text-center align-middle text-[10px] font-black uppercase tracking-widest text-slate-950">Nenhum estoque encontrado com os filtros atuais</td>
                </tr>
              ) : sortedItems.map((item) => (
                <tr key={item.id} className={`group h-8 bg-white transition-colors odd:bg-white even:bg-slate-50/80 hover:bg-blue-50 ${item.purchase_suspended ? 'opacity-75' : ''}`}>
                  <td className="border-b border-r border-slate-200 px-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${item.product_description}`}
                      checked={selectedRowKeys.has(inventoryRowKey(item))}
                      onChange={() => toggleRowSelection(item)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                  </td>
                  {orderedColumns.map((column) => {
                    const value = column.render(item);
                    const title = column.title?.(item) || value;
                    const alignment = column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left';

                    return (
                      <td key={column.key} className={`border-b border-r border-slate-200 px-2 py-1.5 ${alignment} ${column.cellClassName || ''}`} title={title}>
                        {column.key === 'purchaseStatus' ? (
                          <span className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${item.purchase_suspended ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{value}</span>
                        ) : (
                          <span className="block truncate">{value}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
