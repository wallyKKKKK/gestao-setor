'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Download, Plus, Printer, Save, Search, Trash2, X } from 'lucide-react';
import {
  deleteSupplierPaymentTerm,
  fetchSupplierPaymentTerms,
  saveSupplierPaymentTerm,
  type SupplierPaymentTermInput,
} from '@/lib/api';
import { MultiCheckboxFilter } from '@/app/components/multi-checkbox-filter';
import type { SupplierPaymentTerm } from '@/lib/types';

const blankTerm: SupplierPaymentTermInput = {
  supplier_name: '',
  payment_terms: '',
  category: 'Geral',
  region: 'PA',
  min_order_value: 0,
  condition_notes: '',
  contact_name: '',
  phone: '',
  email: '',
  tax_id: '',
  is_active: true,
  sort_order: 0,
};

const COLUMN_OPTIONS = [
  { value: 'supplier_name', label: 'Fornecedor' },
  { value: 'payment_terms', label: 'Prazo boleto' },
  { value: 'category', label: 'Categoria' },
  { value: 'region', label: 'Regiao' },
  { value: 'min_order_value', label: 'Pedido min.' },
  { value: 'condition_notes', label: 'Condições' },
  { value: 'contact_name', label: 'Contato' },
  { value: 'phone', label: 'Telefone' },
  { value: 'email', label: 'Email' },
  { value: 'tax_id', label: 'CNPJ' },
  { value: 'status', label: 'Status' },
  { value: 'actions', label: 'Ações' },
];

const DEFAULT_VISIBLE_COLUMNS = [
  'supplier_name',
  'payment_terms',
  'category',
  'region',
  'min_order_value',
  'condition_notes',
  'actions',
];

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  supplier_name: 230,
  payment_terms: 150,
  category: 130,
  region: 90,
  min_order_value: 120,
  condition_notes: 320,
  contact_name: 160,
  phone: 130,
  email: 220,
  tax_id: 150,
  status: 95,
  actions: 92,
};

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function csvValue(value: string | number | boolean) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function PaymentTermsManager() {
  const [terms, setTerms] = useState<SupplierPaymentTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [editingTerm, setEditingTerm] = useState<SupplierPaymentTermInput | null>(null);
  const [saving, setSaving] = useState(false);
  const resizingColumnRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const loadTerms = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSupplierPaymentTerms();
      setTerms(data);
      setErrorMessage('');
    } catch {
      setTerms([]);
      setErrorMessage('Tabela de prazos não encontrada. Rode o SQL de prazos no Supabase para ativar esta área.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadTerms();
    });
  }, [loadTerms]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (editingTerm) {
        setEditingTerm(null);
        return;
      }
      if (searchTerm) {
        setSearchTerm('');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editingTerm, searchTerm]);

  const categories = useMemo(() => Array.from(new Set(terms.map((item) => item.category).filter(Boolean))).sort(), [terms]);
  const visibleTableColumns = useMemo(() => {
    const visible = COLUMN_OPTIONS.filter((column) => visibleColumns.includes(column.value));
    return visible.length ? visible : COLUMN_OPTIONS.filter((column) => column.value === 'supplier_name');
  }, [visibleColumns]);
  const visibleTableColumnCount = visibleTableColumns.length;
  const exportableTableColumns = useMemo(() => {
    const columns = visibleTableColumns.filter((column) => column.value !== 'actions');
    return columns.length ? columns : COLUMN_OPTIONS.filter((column) => column.value === 'supplier_name');
  }, [visibleTableColumns]);
  const getColumnWidth = useCallback((key: string) => {
    return columnWidths[key] || DEFAULT_COLUMN_WIDTHS[key] || 130;
  }, [columnWidths]);
  const tableWidth = useMemo(() => {
    return visibleTableColumns.reduce((total, column) => total + getColumnWidth(column.value), 0);
  }, [getColumnWidth, visibleTableColumns]);
  const startColumnResize = useCallback((event: ReactMouseEvent, key: string) => {
    event.preventDefault();
    event.stopPropagation();

    resizingColumnRef.current = {
      key,
      startX: event.clientX,
      startWidth: getColumnWidth(key),
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      const current = resizingColumnRef.current;
      if (!current) return;

      const nextWidth = Math.max(70, Math.min(520, current.startWidth + moveEvent.clientX - current.startX));
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
  const paymentTableCss = useMemo(() => `
    #payment-terms-table {
      table-layout: fixed;
      width: ${tableWidth}px;
      min-width: ${tableWidth}px;
      border-collapse: collapse;
      border-spacing: 0;
      background: var(--app-surface);
    }
    #payment-terms-table th,
    #payment-terms-table td {
      border: 1px solid var(--app-border);
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: middle;
    }
    #payment-terms-table th {
      position: relative;
      background: #ecfdf5;
      color: #334155;
      font-weight: 900;
      white-space: normal;
      letter-spacing: 0;
    }
    #payment-terms-table td {
      white-space: nowrap;
      color: #0f172a;
      background: #ffffff;
    }
    #payment-terms-table tbody tr:nth-child(even) td {
      background: #f8fafc;
    }
    #payment-terms-table tbody tr:hover td {
      background: #d1fae5;
    }
    #payment-terms-table .condition-cell {
      white-space: normal;
      line-height: 1.25;
    }
    #payment-terms-table .column-resizer {
      position: absolute;
      top: 0;
      right: -3px;
      width: 7px;
      height: 100%;
      cursor: col-resize;
      z-index: 2;
    }
    #payment-terms-table .column-resizer:hover,
    #payment-terms-table .column-resizer:active {
      background: #059669;
    }
    html[data-theme="dark"] #payment-terms-table {
      background: #1d1d1d;
    }
    html[data-theme="dark"] #payment-terms-table th {
      background: #2b2b2b;
      color: #f2f2f2;
      border-color: #4a4a4a;
      box-shadow: inset 0 -1px 0 #525252;
    }
    html[data-theme="dark"] #payment-terms-table td {
      background: #202020;
      color: #e7e7e7;
      border-color: #464646;
    }
    html[data-theme="dark"] #payment-terms-table tbody tr:nth-child(even) td {
      background: #262626;
    }
    html[data-theme="dark"] #payment-terms-table tbody tr:hover td {
      background: #333333;
    }
    html[data-theme="dark"] #payment-terms-table .condition-cell {
      color: #cfcfcf;
    }
    html[data-theme="dark"] #payment-terms-table .column-resizer:hover,
    html[data-theme="dark"] #payment-terms-table .column-resizer:active {
      background: #10b981;
    }
  `, [tableWidth]);
  const filteredTerms = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase();

    return terms.filter((term) => {
      if (categoryFilters.length > 0 && !categoryFilters.includes(term.category)) return false;
      if (!normalizedSearch) return true;

      return [
        term.supplier_name,
        term.payment_terms,
        term.category,
        term.region,
        term.condition_notes,
        term.contact_name,
        term.phone,
        term.email,
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [categoryFilters, searchTerm, terms]);

  const summary = useMemo(() => ({
    total: filteredTerms.length,
    active: filteredTerms.filter((term) => term.is_active).length,
    withRules: filteredTerms.filter((term) => term.condition_notes || term.min_order_value > 0).length,
  }), [filteredTerms]);

  const saveTerm = async () => {
    if (!editingTerm?.supplier_name || !editingTerm.payment_terms) {
      alert('Preencha fornecedor e prazo.');
      return;
    }

    setSaving(true);
    try {
      await saveSupplierPaymentTerm(editingTerm);
      await loadTerms();
      setEditingTerm(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao salvar prazo: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const removeTerm = async (term: SupplierPaymentTerm) => {
    if (!confirm(`Excluir prazo de ${term.supplier_name}?`)) return;
    await deleteSupplierPaymentTerm(term.id);
    await loadTerms();
  };

  const exportCsv = () => {
    const getExportValue = (term: SupplierPaymentTerm, column: string) => {
      if (column === 'supplier_name') return term.supplier_name;
      if (column === 'payment_terms') return term.payment_terms;
      if (column === 'category') return term.category;
      if (column === 'region') return term.region;
      if (column === 'min_order_value') return term.min_order_value ? money(term.min_order_value) : '';
      if (column === 'condition_notes') return term.condition_notes;
      if (column === 'contact_name') return term.contact_name;
      if (column === 'phone') return term.phone;
      if (column === 'email') return term.email;
      if (column === 'tax_id') return term.tax_id;
      if (column === 'status') return term.is_active ? 'Ativo' : 'Inativo';
      return '';
    };

    const rows = [
      exportableTableColumns.map((column) => column.label),
      ...filteredTerms.map((term) => exportableTableColumns.map((column) => getExportValue(term, column.value))),
    ];
    const csv = rows.map((row) => row.map(csvValue).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'prazos-fornecedores.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const printTable = () => {
    window.print();
  };

  const renderHeader = (label: string, key: string, align: 'left' | 'right' | 'center' = 'left') => (
    <th key={key} className={`${key === 'actions' ? 'payment-print-hidden' : ''} px-3 py-3 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}>
      <span className="block truncate pr-1">{label}</span>
      <span
        className="column-resizer payment-print-hidden"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Ajustar largura da coluna ${label}`}
        onMouseDown={(event) => startColumnResize(event, key)}
        onDoubleClick={() => resetColumnWidth(key)}
      />
    </th>
  );

  const renderCell = (term: SupplierPaymentTerm, column: string) => {
    if (column === 'supplier_name') {
      return <td className="px-3 py-3 font-black uppercase text-slate-900" title={term.supplier_name}>{term.supplier_name}</td>;
    }
    if (column === 'payment_terms') {
      return <td className="px-3 py-3 font-black text-emerald-700" title={term.payment_terms}>{term.payment_terms}</td>;
    }
    if (column === 'category') {
      return <td className="px-3 py-3 text-slate-700" title={term.category}>{term.category || '-'}</td>;
    }
    if (column === 'region') {
      return <td className="px-3 py-3 text-slate-700" title={term.region}>{term.region || '-'}</td>;
    }
    if (column === 'min_order_value') {
      return <td className="px-3 py-3 text-right font-bold">{term.min_order_value ? money(term.min_order_value) : '-'}</td>;
    }
    if (column === 'condition_notes') {
      return <td className="condition-cell px-3 py-3 text-slate-600" title={term.condition_notes}>{term.condition_notes || '-'}</td>;
    }
    if (column === 'contact_name') {
      return <td className="px-3 py-3 text-slate-700" title={term.contact_name}>{term.contact_name || '-'}</td>;
    }
    if (column === 'phone') {
      return <td className="px-3 py-3 text-slate-700" title={term.phone}>{term.phone || '-'}</td>;
    }
    if (column === 'email') {
      return <td className="px-3 py-3 text-slate-700" title={term.email}>{term.email || '-'}</td>;
    }
    if (column === 'tax_id') {
      return <td className="px-3 py-3 text-slate-700" title={term.tax_id}>{term.tax_id || '-'}</td>;
    }
    if (column === 'status') {
      return (
        <td className="px-3 py-3">
          <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${term.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            {term.is_active ? 'Ativo' : 'Inativo'}
          </span>
        </td>
      );
    }
    return (
      <td className="payment-print-hidden px-3 py-3">
        <div className="flex justify-end gap-2">
          <button onClick={() => setEditingTerm(term)} className="p-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100"><Save size={16} /></button>
          <button onClick={() => removeTerm(term)} className="p-2 rounded-xl bg-red-50 text-red-600 border border-red-100"><Trash2 size={16} /></button>
        </div>
      </td>
    );
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-8">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #payment-terms-print, #payment-terms-print * { visibility: visible; }
          #payment-terms-print { position: absolute; inset: 0; width: 100%; padding: 0; }
          .payment-print-hidden { display: none !important; }
          #payment-terms-table { font-size: 10px; }
        }
      `}</style>

      <div className="payment-print-hidden mb-4 flex flex-wrap justify-end gap-2">
          <button onClick={printTable} className="h-11 px-4 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2">
            <Printer size={16} /> Imprimir PDF
          </button>
          <button onClick={exportCsv} className="h-11 px-4 rounded-2xl bg-white border-2 border-slate-100 font-black uppercase text-[10px] flex items-center gap-2">
            <Download size={16} /> Exportar CSV
          </button>
          <button onClick={() => setEditingTerm({ ...blankTerm, sort_order: terms.length + 1 })} className="h-11 px-4 rounded-2xl bg-emerald-600 text-white font-black uppercase text-[10px] flex items-center gap-2">
            <Plus size={16} /> Novo Fornecedor
          </button>
      </div>

      <div className="payment-print-hidden grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Fornecedores</p>
          <p className="text-2xl font-black">{summary.total}</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Ativos</p>
          <p className="text-2xl font-black text-emerald-700">{summary.active}</p>
        </div>
        <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-slate-400">Com Regras</p>
          <p className="text-2xl font-black text-amber-700">{summary.withRules}</p>
        </div>
      </div>

      <div className="payment-print-hidden grid grid-cols-1 lg:grid-cols-[1fr_240px_260px] gap-3 mb-5">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="BUSCAR FORNECEDOR, PRAZO OU CONDICAO..."
            className="w-full h-12 rounded-2xl bg-white border-2 border-slate-100 pl-12 pr-4 text-sm font-bold outline-none focus:border-emerald-600"
          />
        </div>
        <MultiCheckboxFilter
          label="Categoria"
          allLabel="Todas categorias"
          selectedValues={categoryFilters}
          onChange={setCategoryFilters}
          options={categories.map((category) => ({ value: category, label: category }))}
        />
        <MultiCheckboxFilter
          label="Colunas"
          allLabel="Todas colunas"
          selectedValues={visibleColumns}
          onChange={(columns) => setVisibleColumns(columns.length ? columns : ['supplier_name'])}
          options={COLUMN_OPTIONS}
          emptyMeansAll={false}
        />
      </div>

      {errorMessage && (
        <div className="payment-print-hidden mb-5 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          {errorMessage}
        </div>
      )}

      <section id="payment-terms-print" className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-md max-h-[calc(100vh-220px)] overflow-auto shadow-sm print:max-h-none print:overflow-visible">
        <style>{paymentTableCss}</style>
        <div className="hidden print:block p-4">
          <h2 className="text-xl font-black uppercase">Setor de Compras - Tabela de Prazos</h2>
        </div>
        <table id="payment-terms-table" className="text-sm">
          <colgroup>
            {visibleTableColumns.map((column) => (
              <col key={column.value} className={column.value === 'actions' ? 'payment-print-hidden' : ''} style={{ width: `${getColumnWidth(column.value)}px` }} />
            ))}
          </colgroup>
          <thead className="bg-emerald-50 text-[10px] uppercase text-slate-600">
            <tr>
              {visibleTableColumns.map((column) => (
                renderHeader(
                  column.label,
                  column.value,
                  column.value === 'min_order_value' || column.value === 'actions' ? 'right' : 'left',
                )
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredTerms.map((term) => (
              <tr key={term.id} className="even:bg-slate-50 hover:bg-emerald-50/70">
                {visibleTableColumns.map((column) => (
                  <Fragment key={column.value}>
                    {renderCell(term, column.value)}
                  </Fragment>
                ))}
              </tr>
            ))}
            {!loading && filteredTerms.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, visibleTableColumnCount)} className="border border-slate-200 px-3 py-12 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                  Nenhum prazo encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {editingTerm && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-visible rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between border-b-2 border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-xl font-black uppercase italic tracking-tighter">Fornecedor</h2>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Prazos, regras, contatos e dados fiscais</p>
              </div>
              <button onClick={() => setEditingTerm(null)} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"><X size={21} /></button>
            </div>

            <div className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-2 lg:grid-cols-4">
              <TermInput label="Fornecedor" value={editingTerm.supplier_name} onChange={(value) => setEditingTerm((current) => current ? { ...current, supplier_name: value } : current)} />
              <TermInput label="Prazos do boleto" value={editingTerm.payment_terms} onChange={(value) => setEditingTerm((current) => current ? { ...current, payment_terms: value } : current)} />
              <TermInput label="Categoria" value={editingTerm.category} onChange={(value) => setEditingTerm((current) => current ? { ...current, category: value } : current)} />
              <TermInput label="Regiao" value={editingTerm.region} onChange={(value) => setEditingTerm((current) => current ? { ...current, region: value } : current)} />
              <TermInput label="Pedido minimo" value={editingTerm.min_order_value} numeric onChange={(value) => setEditingTerm((current) => current ? { ...current, min_order_value: Number(value.replace(',', '.')) || 0 } : current)} />
              <TermInput label="CNPJ" value={editingTerm.tax_id} onChange={(value) => setEditingTerm((current) => current ? { ...current, tax_id: value } : current)} />
              <TermInput label="Contato" value={editingTerm.contact_name} onChange={(value) => setEditingTerm((current) => current ? { ...current, contact_name: value } : current)} />
              <TermInput label="Telefone" value={editingTerm.phone} onChange={(value) => setEditingTerm((current) => current ? { ...current, phone: value } : current)} />
              <TermInput label="Email" value={editingTerm.email} onChange={(value) => setEditingTerm((current) => current ? { ...current, email: value } : current)} />
              <TermInput label="Ordem" value={editingTerm.sort_order} numeric onChange={(value) => setEditingTerm((current) => current ? { ...current, sort_order: Number(value) || 0 } : current)} />
              <label className="space-y-1 md:col-span-2 lg:col-span-4">
                <span className="text-[10px] font-black uppercase text-slate-400">Condições e observações</span>
                <textarea
                  value={editingTerm.condition_notes}
                  onChange={(event) => setEditingTerm((current) => current ? { ...current, condition_notes: event.target.value } : current)}
                  className="h-20 w-full resize-none rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-blue-600"
                />
              </label>
              <label className="flex h-11 items-center gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 md:col-span-2 lg:col-span-4">
                <input
                  type="checkbox"
                  checked={editingTerm.is_active}
                  onChange={(event) => setEditingTerm((current) => current ? { ...current, is_active: event.target.checked } : current)}
                  className="w-5 h-5"
                />
                <span className="text-[10px] font-black uppercase text-slate-500">Fornecedor ativo</span>
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t-2 border-slate-100 px-5 py-4">
              <button onClick={() => setEditingTerm(null)} className="h-12 min-w-[160px] rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200">Cancelar</button>
              <button onClick={saveTerm} disabled={saving} className="flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-2xl bg-blue-600 text-xs font-black uppercase text-white transition hover:bg-blue-700 disabled:opacity-50">
                <Save size={16} /> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function TermInput({ label, value, onChange, numeric = false }: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] font-black uppercase text-slate-400">{label}</span>
      <input
        value={value}
        type={numeric ? 'number' : 'text'}
        step="0.01"
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-bold outline-none transition focus:border-blue-600"
      />
    </label>
  );
}
