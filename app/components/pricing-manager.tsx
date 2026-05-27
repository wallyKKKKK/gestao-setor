'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Building2, Download, Eye, FileSpreadsheet, PackagePlus, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import {
  deletePricingBranch,
  deletePricingProduct,
  fetchPricingBranches,
  fetchPricingProducts,
  savePricingBranch,
  savePricingProduct,
  type PricingBranchInput,
  type PricingProductInput,
} from '@/lib/api';
import { MultiCheckboxFilter } from '@/app/components/multi-checkbox-filter';
import type { DiscountMode, PricingBranch, PricingProduct } from '@/lib/types';

const COMPETITORS = ['TEM TUDO', 'BEM POPULAR', 'EXTRAFARMA', 'DROGASIL', 'AMERICANAS'];
const EXPORT_OPTIONS = [
  { id: 'full_table', label: 'Tabela completa' },
  { id: 'branch_prices', label: 'Preços por filial' },
  { id: 'month_end_price', label: 'Fecha mês' },
  { id: 'baby_wednesday_price', label: 'Quarta da Fralda' },
  { id: 'sale_price', label: 'Novo Preço' },
  { id: 'purchase_price', label: 'Preço' },
  { id: 'final_price', label: 'Custo Lançado (calculado)' },
] as const;

const COLUMN_OPTIONS = [
  { value: 'index', label: '#' },
  { value: 'ean', label: 'Barras' },
  { value: 'product', label: 'Produto' },
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
  { value: 'actions', label: 'Acoes' },
];

const DEFAULT_VISIBLE_COLUMNS = COLUMN_OPTIONS
  .filter((column) => !['competitors', 'branches'].includes(column.value))
  .map((column) => column.value);

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  index: 38,
  ean: 132,
  product: 300,
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
};

const blankBranch: PricingBranchInput = {
  name: '',
  code: '',
  city: '',
  legal_name: '',
  uf: '',
  cnpj: '',
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

function serializeCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\n');
}

export function PricingManager() {
  const [products, setProducts] = useState<PricingProduct[]>([]);
  const [branches, setBranches] = useState<PricingBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [brandFilters, setBrandFilters] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [showBranches, setShowBranches] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PricingProductInput | null>(null);
  const [editingBranch, setEditingBranch] = useState<PricingBranchInput | null>(null);
  const [exportPrice, setExportPrice] = useState<(typeof EXPORT_OPTIONS)[number]['id']>('full_table');
  const [showExportModal, setShowExportModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resizingColumnRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPricingProducts();
      setProducts(data);
      setErrorMessage('');
    } catch {
      setProducts([]);
      setErrorMessage('Tabela de precificação não encontrada. Rode o SQL enviado para ativar esta área.');
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

  useEffect(() => {
    let isMounted = true;

    async function run() {
      setLoading(true);
      try {
        const data = await fetchPricingProducts();
        const branchData = await fetchPricingBranches().catch(() => []);
        if (!isMounted) return;
        setProducts(data);
        setBranches(branchData);
        setErrorMessage('');
      } catch {
        if (!isMounted) return;
        setProducts([]);
        setErrorMessage('Tabela de precificação não encontrada. Rode o SQL enviado para ativar esta área.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    run();

    return () => {
      isMounted = false;
    };
  }, []);

  const brands = useMemo(() => Array.from(new Set(products.map((item) => item.brand).filter(Boolean))).sort(), [products]);
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches]);
  const isColumnVisible = useCallback((column: string) => visibleColumns.includes(column), [visibleColumns]);
  const showCompetitors = isColumnVisible('competitors');
  const showBranchColumns = isColumnVisible('branches');
  const visibleTableColumnCount = useMemo(() => {
    return visibleColumns.reduce((total, column) => {
      if (column === 'competitors') return total + COMPETITORS.length;
      if (column === 'branches') return total + activeBranches.length;
      return total + 1;
    }, 0);
  }, [activeBranches.length, visibleColumns]);
  const getColumnWidth = useCallback((key: string, baseKey = key) => {
    return columnWidths[key] || columnWidths[baseKey] || DEFAULT_COLUMN_WIDTHS[baseKey] || 86;
  }, [columnWidths]);
  const tableColumns = useMemo(() => {
    const columns: Array<{ key: string; baseKey: string }> = [
      { key: 'index', baseKey: 'index' },
      { key: 'ean', baseKey: 'ean' },
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
      activeBranches.forEach((branch) => columns.push({ key: `branch:${branch.code}`, baseKey: 'branches' }));
    }

    columns.push(
      { key: 'markup', baseKey: 'markup' },
      { key: 'actions', baseKey: 'actions' },
    );

    return columns;
  }, [activeBranches, showBranchColumns, showCompetitors]);
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

    addColumn('index');
    addColumn('ean');
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
    if (showBranchColumns) activeBranches.forEach(() => { index += 1; });
    addColumn('markup');
    addColumn('actions');

    const densityCss = visibleTableColumnCount > 14
      ? `
        #pricing-products-table th,
        #pricing-products-table td {
          padding: 0.35rem 0.3rem !important;
          font-size: 0.62rem !important;
          line-height: 1.1 !important;
        }
        #pricing-products-table button {
          padding: 0.25rem !important;
        }
      `
      : `
        #pricing-products-table th,
        #pricing-products-table td {
          padding: 0.45rem 0.45rem !important;
          font-size: 0.72rem !important;
          line-height: 1.2 !important;
        }
      `;

    return `
      #pricing-products-table {
        table-layout: fixed;
        width: ${tableWidth}px;
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
      #pricing-products-table th:nth-child(2),
      #pricing-products-table td:nth-child(2) {
        text-align: center;
      }
      #pricing-products-table th:nth-child(3),
      #pricing-products-table td:nth-child(3) {
        text-align: left;
      }
      #pricing-products-table td:nth-child(3) {
        white-space: nowrap;
      }
      #pricing-products-table .product-description,
      #pricing-products-table .product-brand {
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
  }, [activeBranches, showBranchColumns, showCompetitors, tableWidth, visibleColumns, visibleTableColumnCount]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase();

    return products.filter((product) => {
      if (brandFilters.length > 0 && !brandFilters.includes(product.brand)) return false;
      if (normalizedSearch && ![product.ean, product.description, product.brand].some((value) => value.toLowerCase().includes(normalizedSearch))) {
        return false;
      }
      return true;
    });
  }, [brandFilters, products, searchTerm]);

  const summary = useMemo(() => {
    const totalPurchase = filteredProducts.reduce((sum, product) => sum + product.purchase_price, 0);
    const negativeMargins = filteredProducts.filter((product) => markup(product) < 0).length;
    const averageMarkup = filteredProducts.length
      ? filteredProducts.reduce((sum, product) => sum + markup(product), 0) / filteredProducts.length
      : 0;

    return { totalPurchase, negativeMargins, averageMarkup };
  }, [filteredProducts]);

  const updateEditing = <K extends keyof PricingProductInput>(key: K, value: PricingProductInput[K]) => {
    setEditingProduct((current) => current ? { ...current, [key]: value } : current);
  };

  const updateNestedPrice = (field: 'competitor_prices' | 'store_prices', key: string, value: number) => {
    setEditingProduct((current) => current ? {
      ...current,
      [field]: { ...current[field], [key]: value },
    } : current);
  };

  const saveProduct = async () => {
    if (!editingProduct?.ean || !editingProduct.description) {
      alert('Preencha EAN e descrição.');
      return;
    }

    setSaving(true);
    try {
      await savePricingProduct(editingProduct);
      await loadProducts();
      setEditingProduct(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao salvar produto: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const saveBranch = async () => {
    if (!editingBranch?.name || !editingBranch.code) {
      alert('Preencha nome e código da filial.');
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

  const removeProduct = async (product: PricingProduct) => {
    if (!confirm(`Excluir ${product.description}?`)) return;
    await deletePricingProduct(product.id);
    await loadProducts();
  };

  const importExcel = async (file: File) => {
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/pricing/import', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.products?.length) {
        alert(data?.error || 'Nenhum produto encontrado na planilha.');
        return;
      }

      for (const product of data.products as PricingProductInput[]) {
        await savePricingProduct(product);
      }

      await loadProducts();
      alert(`${data.products.length} produtos importados com sucesso.`);
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
    const selectedLabel = option?.label || 'Exportação';
    const selectedValue = (product: PricingProduct) => {
      if (exportPrice === 'full_table') return null;
      if (exportPrice === 'branch_prices') return null;
      return exportPrice === 'final_price' ? finalPrice(product) : Number(product[exportPrice] || 0);
    };
    const rows = [
      exportPrice === 'full_table'
        ? ['BARRAS', 'PRODUTO', ...COMPETITORS, 'Preço', 'Sell in', 'Cálculo', 'Sell out', 'Trade', 'Custo Real', 'Custo Lançado', 'Novo Preço', 'Quarta da Fralda', 'Fecha mês', 'Margem (%)']
        : exportPrice === 'branch_prices'
          ? ['BARRAS', 'PRODUTO', 'MARCA', ...activeBranches.map((branch) => branch.name)]
        : ['BARRAS', 'PRODUTO', 'MARCA', selectedLabel],
      ...filteredProducts.map((product) => {
        if (exportPrice === 'branch_prices') {
          return [
            product.ean,
            product.description,
            product.brand,
            ...activeBranches.map((branch) => String(product.store_prices?.[branch.code] || product.sale_price || 0).replace('.', ',')),
          ];
        }

        if (exportPrice !== 'full_table') {
          return [product.ean, product.description, product.brand, String(selectedValue(product) || 0).replace('.', ',')];
        }

        const calculated = finalPrice(product);
        return [
          product.ean,
          product.description,
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

  const renderHeader = (label: string, key: string, baseKey = key, align: 'left' | 'right' | 'center' = 'right') => (
    <th className={`px-4 py-4 ${align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'}`}>
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
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-8">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md">
            <SlidersHorizontal size={28} />
          </div>
          <div>
            <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-slate-900">Negociações</h1>
            <p className="text-sm font-bold text-slate-500">Controle de custos, ofertas e preços de fraldas por loja.</p>
          </div>
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
            className="h-11 px-4 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2 disabled:opacity-50"
          >
            <FileSpreadsheet size={16} /> {importing ? 'Importando...' : 'Importar Excel'}
          </button>
          <button onClick={() => setShowExportModal(true)} className="h-11 px-4 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2">
            <Download size={16} /> Exportar Excel
          </button>
          <button onClick={() => setShowBranches((value) => !value)} className="h-11 px-4 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2">
            <Building2 size={16} /> Filiais
          </button>
          <button
            onClick={() => setVisibleColumns((current) => (
              current.includes('competitors')
                ? current.filter((column) => column !== 'competitors')
                : [...current, 'competitors']
            ))}
            className={`h-11 px-4 rounded-2xl border-2 font-black uppercase text-[10px] flex items-center gap-2 ${
              isColumnVisible('competitors') ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-100'
            }`}
          >
            <Eye size={16} /> Concorrentes
          </button>
          <button onClick={() => setEditingProduct({ ...blankProduct })} className="h-11 px-4 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] flex items-center gap-2 shadow-sm">
            <PackagePlus size={16} /> Novo Produto
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Total Produtos</p>
          <p className="text-2xl font-black">{filteredProducts.length}</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Markup Médio</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px_260px] gap-3 mb-5">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="BUSCAR POR EAN OU DESCRIÇÃO..." className="w-full h-12 rounded-2xl bg-white border-2 border-slate-100 pl-12 pr-4 text-sm font-bold outline-none focus:border-blue-600" />
        </div>
        <MultiCheckboxFilter
          label="Marca"
          allLabel="Todas as marcas"
          selectedValues={brandFilters}
          onChange={setBrandFilters}
          options={brands.map((brand) => ({ value: brand, label: brand }))}
        />
        <MultiCheckboxFilter
          label="Colunas"
          allLabel="Todas colunas"
          selectedValues={visibleColumns}
          onChange={(columns) => setVisibleColumns(columns.length ? columns : ['product'])}
          options={COLUMN_OPTIONS}
          emptyMeansAll={false}
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
              <p className="text-xs font-bold text-slate-500">Cadastre as lojas que terão preço próprio por produto.</p>
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
                    <p className="text-[10px] font-black uppercase text-slate-400">{branch.code} {branch.uf ? `• ${branch.uf}` : ''}</p>
                    {branch.cnpj && <p className="text-[10px] font-bold text-slate-400 mt-1">{branch.cnpj}</p>}
                    <p className={`text-[9px] font-black uppercase mt-2 ${branch.is_active ? 'text-green-600' : 'text-red-600'}`}>{branch.is_active ? 'Ativa' : 'Inativa'}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditingBranch(branch)} className="p-2 rounded-xl bg-white text-blue-600"><Save size={15} /></button>
                    <button onClick={() => removeBranch(branch)} className="p-2 rounded-xl bg-white text-red-600"><Trash2 size={15} /></button>
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

      <div className="bg-white border border-slate-300 rounded-md overflow-x-auto overflow-y-hidden shadow-sm">
        <style>{pricingTableCss}</style>
        <table id="pricing-products-table" className="w-full text-sm">
          <colgroup>
            {tableColumns.map((column) => (
              <col key={column.key} style={{ width: `${getColumnWidth(column.key, column.baseKey)}px` }} />
            ))}
          </colgroup>
          <thead className="text-[10px] uppercase text-slate-600">
            <tr>
              {renderHeader('#', 'index', 'index', 'center')}
              {renderHeader('Barras', 'ean', 'ean', 'center')}
              {renderHeader('Produto', 'product', 'product', 'left')}
              {showCompetitors && COMPETITORS.map((competitor) => renderHeader(competitor, `competitor:${competitor}`, 'competitors'))}
              {renderHeader('Preco', 'purchase_price')}
              {renderHeader('Sell-in', 'sell_in')}
              {renderHeader('Calculo', 'calculation')}
              {renderHeader('Sell-out', 'sell_out')}
              {renderHeader('Trade', 'trade')}
              {renderHeader('Custo Real', 'real_cost')}
              {renderHeader('Custo Lancado', 'launched_cost')}
              {renderHeader('Novo Preco', 'sale_price')}
              {renderHeader('Quarta da Fralda', 'baby_wednesday_price')}
              {renderHeader('Fecha mes', 'month_end_price')}
              {showBranchColumns && activeBranches.map((branch) => renderHeader(branch.name, `branch:${branch.code}`, 'branches'))}
              {renderHeader('Markup', 'markup')}
              {renderHeader('Acoes', 'actions')}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredProducts.map((product, index) => {
              const currentMarkup = markup(product);
              return (
                <tr key={product.id} className="hover:bg-blue-50/40">
                  <td className="px-4 py-4 text-slate-400">{index + 1}</td>
                  <td className="px-4 py-4 font-mono">{product.ean}</td>
                  <td className="px-4 py-4 font-black uppercase" title={`${product.description} - ${product.brand}`}>
                    <span className="product-description">{product.description}</span>
                    <span className="product-brand text-[10px] text-slate-400">{product.brand || 'SEM FABRICANTE'}</span>
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
                  <td className="px-4 py-4 text-right excel-sale">{money(product.sale_price)}</td>
                  <td className="px-4 py-4 text-right excel-offer">{money(product.baby_wednesday_price)}</td>
                  <td className="px-4 py-4 text-right excel-offer">{money(product.month_end_price)}</td>
                  {showBranchColumns && activeBranches.map((branch) => (
                    <td key={branch.id} className="px-4 py-4 text-right">{money(product.store_prices?.[branch.code] || product.sale_price || 0)}</td>
                  ))}
                  <td className={`px-4 py-4 text-right ${currentMarkup < 0 ? 'excel-markup-negative' : 'excel-markup-positive'}`}>{currentMarkup.toFixed(2).replace('.', ',')}%</td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingProduct(product)} className="p-2 rounded-xl bg-blue-50 text-blue-600"><Save size={16} /></button>
                      <button onClick={() => removeProduct(product)} className="p-2 rounded-xl bg-red-50 text-red-600"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && filteredProducts.length === 0 && (
              <tr><td colSpan={Math.max(1, visibleTableColumnCount)} className="px-4 py-16 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">Nenhum produto encontrado</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCompetitors && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {COMPETITORS.map((competitor) => (
            <div key={competitor} className="bg-white border-2 border-slate-100 rounded-2xl p-4">
              <p className="text-[10px] font-black uppercase text-slate-400">{competitor}</p>
              <p className="text-sm font-bold text-slate-700 mt-1">{filteredProducts.filter((product) => (product.competitor_prices?.[competitor] || 0) > 0).length} preços cadastrados</p>
            </div>
          ))}
        </div>
      )}

      {editingProduct && (
        <div className="fixed inset-0 z-[80] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-5xl rounded-[28px] max-h-[92vh] overflow-y-auto border-2 border-slate-200 shadow-2xl">
            <div className="p-6 flex items-center justify-between border-b border-slate-100">
              <div>
                <h2 className="text-2xl font-black uppercase">{editingProduct.id ? 'Editar Produto' : 'Cadastrar Produto'}</h2>
                <p className="text-xs font-bold text-slate-500 mt-1">Informe EAN, descricao e fabricante antes de ajustar os custos.</p>
              </div>
              <button onClick={() => setEditingProduct(null)}><X size={24} /></button>
            </div>
            <div className="p-6">
              <div className="rounded-2xl border-2 border-slate-100 bg-slate-50 p-4 mb-5">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4">Dados do produto</h3>
                <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_220px] gap-4">
              <PriceInput label="EAN" value={editingProduct.ean} onChange={(value) => updateEditing('ean', value)} text />
              <PriceInput label="Descricao" value={editingProduct.description} onChange={(value) => updateEditing('description', value)} text />
              <PriceInput label="Fabricante" value={editingProduct.brand} onChange={(value) => updateEditing('brand', value)} text />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <PriceInput label="Preco de compra" value={editingProduct.purchase_price} onChange={(value) => updateEditing('purchase_price', numericValue(value))} />
              <DiscountInput label="Sell-in" value={editingProduct.sell_in_value} mode={editingProduct.sell_in_mode} onValue={(value) => updateEditing('sell_in_value', numericValue(value))} onMode={(mode) => updateEditing('sell_in_mode', mode)} />
              <DiscountInput label="Sell-out" value={editingProduct.sell_out_value} mode={editingProduct.sell_out_mode} onValue={(value) => updateEditing('sell_out_value', numericValue(value))} onMode={(mode) => updateEditing('sell_out_mode', mode)} />
              <DiscountInput label="Trade" value={editingProduct.trade_value} mode={editingProduct.trade_mode} onValue={(value) => updateEditing('trade_value', numericValue(value))} onMode={(mode) => updateEditing('trade_mode', mode)} />
              <PriceInput label="Novo Preco" value={editingProduct.sale_price} onChange={(value) => updateEditing('sale_price', numericValue(value))} />
              <div className="rounded-2xl bg-green-50 border-2 border-green-100 p-4">
                <p className="text-[10px] font-black uppercase text-green-700">Custo Lancado</p>
                <p className="text-2xl font-black text-green-800">{money(finalPrice(editingProduct))}</p>
              </div>
              <PriceInput label="Quarta da Fralda" value={editingProduct.baby_wednesday_price} onChange={(value) => updateEditing('baby_wednesday_price', numericValue(value))} />
              <PriceInput label="Fecha mes" value={editingProduct.month_end_price} onChange={(value) => updateEditing('month_end_price', numericValue(value))} />
            </div>
            </div>
            <div className="px-6 pb-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
              <PriceGroup title="Preços Concorrentes" items={COMPETITORS} values={editingProduct.competitor_prices} onChange={(key, value) => updateNestedPrice('competitor_prices', key, value)} />
              <PriceGroup title="Preços por Filial" items={activeBranches.map((branch) => branch.code)} labels={Object.fromEntries(activeBranches.map((branch) => [branch.code, branch.name]))} values={editingProduct.store_prices} onChange={(key, value) => updateNestedPrice('store_prices', key, value)} />
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setEditingProduct(null)} className="px-5 py-3 rounded-2xl bg-slate-100 font-black uppercase text-xs">Cancelar</button>
              <button onClick={saveProduct} disabled={saving} className="px-6 py-3 rounded-2xl bg-blue-600 text-white font-black uppercase text-xs flex items-center gap-2 disabled:opacity-50">
                <Save size={16} /> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingBranch && (
        <div className="fixed inset-0 z-[85] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[28px] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-2xl font-black uppercase">Filial</h2>
              <button onClick={() => setEditingBranch(null)}><X size={22} /></button>
            </div>
            <div className="space-y-4">
              <PriceInput label="Nome da filial" value={editingBranch.name} onChange={(value) => setEditingBranch((current) => current ? { ...current, name: value } : current)} text />
              <PriceInput label="Código" value={editingBranch.code} onChange={(value) => setEditingBranch((current) => current ? { ...current, code: value } : current)} text />
              <PriceInput label="Cidade" value={editingBranch.city} onChange={(value) => setEditingBranch((current) => current ? { ...current, city: value } : current)} text />
              <PriceInput label="UF" value={editingBranch.uf} onChange={(value) => setEditingBranch((current) => current ? { ...current, uf: value } : current)} text />
              <PriceInput label="CNPJ" value={editingBranch.cnpj} onChange={(value) => setEditingBranch((current) => current ? { ...current, cnpj: value } : current)} text />
              <PriceInput label="Razão Social" value={editingBranch.legal_name} onChange={(value) => setEditingBranch((current) => current ? { ...current, legal_name: value } : current)} text />
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 border-2 border-slate-100 p-4">
                <input
                  type="checkbox"
                  checked={editingBranch.is_active}
                  onChange={(event) => setEditingBranch((current) => current ? { ...current, is_active: event.target.checked } : current)}
                  className="w-5 h-5"
                />
                <span className="text-[10px] font-black uppercase text-slate-500">Filial ativa</span>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setEditingBranch(null)} className="px-5 py-3 rounded-2xl bg-slate-100 font-black uppercase text-xs">Cancelar</button>
              <button onClick={saveBranch} className="px-6 py-3 rounded-2xl bg-blue-600 text-white font-black uppercase text-xs flex items-center gap-2">
                <Save size={16} /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportModal && (
        <div className="fixed inset-0 z-[80] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-xl rounded-[28px] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-2xl font-black uppercase">Exportar para Excel</h2>
              <button onClick={() => setShowExportModal(false)}><X size={22} /></button>
            </div>
            <p className="text-sm font-bold text-slate-500 mb-5">
              A planilha seguirá o modelo escolhido, incluindo preços por filial quando selecionado.
            </p>
            <div className="space-y-3">
              {EXPORT_OPTIONS.map((option) => (
                <button key={option.id} onClick={() => setExportPrice(option.id)} className={`w-full rounded-2xl border-2 p-4 text-left font-black ${exportPrice === option.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-100 text-slate-600'}`}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-between items-center gap-3">
              <p className="text-xs font-bold text-slate-500">{filteredProducts.length} produtos • {activeBranches.length} filiais</p>
              <button onClick={exportCsv} className="px-5 py-3 rounded-2xl bg-green-600 text-white font-black uppercase text-xs flex items-center gap-2">
                <Download size={16} /> Baixar Excel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function PriceInput({ label, value, onChange, text = false, wide = false }: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  text?: boolean;
  wide?: boolean;
}) {
  return (
    <label className={`space-y-1 ${wide ? 'md:col-span-2' : ''}`}>
      <span className="text-[10px] font-black uppercase text-slate-400">{label}</span>
      <input
        value={value}
        type={text ? 'text' : 'number'}
        step="0.01"
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl bg-slate-50 border-2 border-slate-100 p-4 font-bold outline-none focus:border-blue-600"
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
  return (
    <label className="space-y-1">
      <span className="text-[10px] font-black uppercase text-slate-400">{label}</span>
      <div className="flex rounded-2xl bg-slate-50 border-2 border-slate-100 overflow-hidden focus-within:border-blue-600">
        <input value={value} type="number" step="0.01" onChange={(event) => onValue(event.target.value)} className="min-w-0 flex-1 bg-transparent p-4 font-bold outline-none" />
        <button type="button" onClick={() => onMode('percent')} className={`w-11 font-black ${mode === 'percent' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>%</button>
        <button type="button" onClick={() => onMode('currency')} className={`w-11 font-black ${mode === 'currency' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>R$</button>
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
  return (
    <div className="rounded-2xl border-2 border-slate-100 p-4">
      <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => (
          <PriceInput key={item} label={labels?.[item] || item} value={values?.[item] || 0} onChange={(value) => onChange(item, numericValue(value))} />
        ))}
      </div>
    </div>
  );
}
