'use client';

import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { CheckCircle2, ChevronDown, Download, FileSpreadsheet, MoreHorizontal, Pencil, Plus, Search, Trash2, Truck, Upload, XCircle } from 'lucide-react';

type DebtNature = 'divida' | 'credito';
type PaymentStatus = 'aberto' | 'pago';

interface TransportDebtEntry {
  id: string;
  sheet: string;
  debtMonth?: string;
  supplier: string;
  category: string;
  description: string;
  invoice: string;
  value: number;
  fee: number;
  nature: DebtNature;
  status: PaymentStatus;
}

interface ParsedDebtEntry extends Omit<TransportDebtEntry, 'status'> {
  status?: PaymentStatus;
}

interface ManualDebtForm {
  debtMonth: string;
  supplier: string;
  category: string;
  description: string;
  invoice: string;
  value: string;
  fee: string;
  nature: DebtNature;
  status: PaymentStatus;
}

interface BulkEditForm {
  debtMonth: string;
  category: string;
  description: string;
  nature: DebtNature;
  status: PaymentStatus;
  updateMonth: boolean;
  updateCategory: boolean;
  updateDescription: boolean;
  updateNature: boolean;
  updateStatus: boolean;
}

const STORAGE_KEY = 'transport-debt-control-v1';
const MANUAL_SHEET_NAME = 'Lancamentos manuais';
const NO_MONTH_VALUE = '__sem_mes__';
const TRANSPORT_FEE_RATE = 0.035;

const blankManualForm: ManualDebtForm = {
  debtMonth: '',
  supplier: '',
  category: '',
  description: '',
  invoice: '',
  value: '',
  fee: '',
  nature: 'divida',
  status: 'aberto',
};

const blankBulkEditForm: BulkEditForm = {
  debtMonth: '',
  category: '',
  description: '',
  nature: 'divida',
  status: 'aberto',
  updateMonth: false,
  updateCategory: false,
  updateDescription: false,
  updateNature: false,
  updateStatus: false,
};

function loadStoredEntries() {
  if (typeof window === 'undefined') return [];

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as TransportDebtEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseMoney(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let text = String(value).replace(/R\$|\s/g, '');
  if (!text) return null;

  const negative = text.includes('-');
  text = text.replace(/-/g, '');

  if (text.includes('.') && text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if ((text.match(/\./g) || []).length > 1) {
    text = text.replace(/\./g, '');
  }

  const parsed = Number(text.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function calculateTransportFee(value: number) {
  return Number((value * TRANSPORT_FEE_RATE).toFixed(2));
}

function splitBulkPasteLine(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine) return [];

  const separator = trimmedLine.includes('\t') ? /\t/ : /;/;
  return trimmedLine
    .split(separator)
    .map((cell) => cell.trim())
    .filter((cell, cellIndex, allCells) => cell || cellIndex < allCells.length - 1);
}

function csvValue(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function fileNameSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '');
}

function makeEntryId(entry: Omit<ParsedDebtEntry, 'id'>, index: number) {
  return [
    entry.sheet,
    entry.supplier,
    entry.category,
    entry.invoice,
    entry.value.toFixed(2),
    index,
  ].join('|');
}

function monthLabel(value: string | undefined) {
  if (!value) return 'Sem mes';
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function shortMonthLabel(value: string | undefined) {
  if (!value) return 'Sem mes';
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  const date = new Date(Number(year), Number(month) - 1, 1);
  const label = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${label}/${year.slice(-2)}`;
}

type SheetToJson = (sheet: unknown, options: Record<string, unknown>) => unknown[][];

function summarizeDebts(items: TransportDebtEntry[]) {
  return items.reduce((acc, entry) => {
    acc.value += entry.value;
    acc.fee += entry.fee;

    if (entry.nature === 'credito') {
      acc.credit += entry.fee;
      if (entry.status === 'aberto') acc.openCredit += entry.fee;
      if (entry.status === 'pago') acc.paidCredit += entry.fee;
    }

    if (entry.nature === 'divida') {
      acc.debt += entry.fee;
      if (entry.status === 'aberto') acc.openDebt += entry.fee;
      if (entry.status === 'pago') acc.paidDebt += entry.fee;
    }

    return acc;
  }, {
    value: 0,
    fee: 0,
    debt: 0,
    credit: 0,
    openDebt: 0,
    openCredit: 0,
    paidDebt: 0,
    paidCredit: 0,
  });
}

function parseWorkbookRows(workbook: { SheetNames: string[]; Sheets: Record<string, unknown> }, sheetToJson: SheetToJson) {
  const entries: TransportDebtEntry[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const rows = sheetToJson(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: false,
      blankrows: false,
    });

    const headers: Array<{ rowIndex: number; colIndex: number }> = [];
    rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (normalizeText(cell).toLowerCase() === 'fornecedor') {
          headers.push({ rowIndex, colIndex });
        }
      });
    });

    headers.forEach((header) => {
      const headerRow = rows[header.rowIndex] || [];
      const columns = headerRow
        .slice(header.colIndex, header.colIndex + 6)
        .map((cell) => normalizeSearch(normalizeText(cell)));
      const hasDescription = columns.includes('descricao');
      let lastSupplier = '';

      for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || [];
        if (normalizeText(row[header.colIndex]).toLowerCase() === 'fornecedor') break;

        const explicitSupplier = normalizeText(row[header.colIndex]);
        if (explicitSupplier) lastSupplier = explicitSupplier;

        const supplier = explicitSupplier || lastSupplier;
        const category = normalizeText(row[header.colIndex + 1]);
        const description = hasDescription ? normalizeText(row[header.colIndex + 2]) : '';
        const invoice = normalizeText(row[header.colIndex + (hasDescription ? 3 : 2)]);
        const value = parseMoney(row[header.colIndex + (hasDescription ? 4 : 3)]);
        const feeCell = parseMoney(row[header.colIndex + (hasDescription ? 5 : 4)]);
        const nature = normalizeSearch(category) === 'credito' ? 'credito' : 'divida';

        if (!supplier || !/\d/.test(invoice) || value === null) continue;

        const parsed: Omit<ParsedDebtEntry, 'id'> = {
          sheet: sheetName,
          supplier,
          category,
          description,
          invoice,
          value,
          fee: feeCell ?? calculateTransportFee(value),
          nature,
          status: 'aberto',
        };

        entries.push({
          ...parsed,
          id: makeEntryId(parsed, entries.length),
          status: parsed.status || 'aberto',
        });
      }
    });
  });

  return entries;
}

export function TransportDebtManager() {
  const [entries, setEntries] = useState<TransportDebtEntry[]>(loadStoredEntries);
  const [searchTerm, setSearchTerm] = useState('');
  const [sheetFilters, setSheetFilters] = useState<string[]>([]);
  const [supplierFilters, setSupplierFilters] = useState<string[]>([]);
  const [monthFilters, setMonthFilters] = useState<string[]>([]);
  const [natureFilters, setNatureFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [showManualForm, setShowManualForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [showBulkEditForm, setShowBulkEditForm] = useState(false);
  const [manualForm, setManualForm] = useState<ManualDebtForm>(blankManualForm);
  const [bulkEditForm, setBulkEditForm] = useState<BulkEditForm>(blankBulkEditForm);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [manualError, setManualError] = useState('');
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState(() => {
    const storedCount = loadStoredEntries().length;
    return storedCount
      ? `${storedCount} lancamentos carregados do ultimo controle salvo.`
      : 'Importe a planilha de dividas de transporte para carregar os lancamentos.';
  });
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openActionMenuId) {
        setOpenActionMenuId(null);
        return;
      }
      if (showManualForm) {
        setShowManualForm(false);
        setManualForm(blankManualForm);
        setEditingEntryId(null);
        setManualError('');
        return;
      }
      if (showBulkForm) {
        setShowBulkForm(false);
        setManualError('');
        setBulkPasteText('');
        return;
      }
      if (showBulkEditForm) {
        setShowBulkEditForm(false);
        setBulkEditForm(blankBulkEditForm);
        setManualError('');
        return;
      }
      if (searchTerm) setSearchTerm('');
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [openActionMenuId, searchTerm, showBulkEditForm, showBulkForm, showManualForm]);

  useEffect(() => {
    if (!openActionMenuId) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-transport-action-menu="true"]')) return;
      setOpenActionMenuId(null);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [openActionMenuId]);

  const sheets = useMemo(() => Array.from(new Set(entries.map((entry) => entry.sheet))).sort(), [entries]);
  const monthOptions = useMemo(() => Array.from(new Set(entries.map((entry) => entry.debtMonth || NO_MONTH_VALUE))).sort((left, right) => (
    left === NO_MONTH_VALUE ? 1 : right === NO_MONTH_VALUE ? -1 : right.localeCompare(left)
  )), [entries]);
  const supplierOptions = useMemo(() => Array.from(new Set(entries.map((entry) => entry.supplier))).sort((left, right) => (
    left.localeCompare(right, 'pt-BR', { sensitivity: 'base' })
  )), [entries]);
  const suppliers = supplierOptions.length;

  const filterEntries = useCallback((source: TransportDebtEntry[]) => {
    const query = normalizeSearch(searchTerm);
    return source.filter((entry) => {
      if (sheetFilters.length > 0 && !sheetFilters.includes(entry.sheet)) return false;
      if (supplierFilters.length > 0 && !supplierFilters.includes(entry.supplier)) return false;
      if (monthFilters.length > 0 && !monthFilters.includes(entry.debtMonth || NO_MONTH_VALUE)) return false;
      if (natureFilters.length > 0 && !natureFilters.includes(entry.nature)) return false;
      if (statusFilters.length > 0 && !statusFilters.includes(entry.status)) return false;

      if (!query) return true;
      return normalizeSearch([
        entry.supplier,
        entry.category,
        entry.description,
        entry.invoice,
        entry.sheet,
        monthLabel(entry.debtMonth),
      ].join(' ')).includes(query);
    });
  }, [monthFilters, natureFilters, searchTerm, sheetFilters, statusFilters, supplierFilters]);
  const filteredEntries = useMemo(() => filterEntries(entries), [entries, filterEntries]);
  const filteredEntryIds = useMemo(() => filteredEntries.map((entry) => entry.id), [filteredEntries]);
  const selectedVisibleCount = useMemo(() => filteredEntryIds.filter((id) => selectedEntryIds.includes(id)).length, [filteredEntryIds, selectedEntryIds]);
  const allVisibleSelected = filteredEntryIds.length > 0 && selectedVisibleCount === filteredEntryIds.length;

  const totals = useMemo(() => {
    const base = summarizeDebts(filteredEntries);

    return {
      ...base,
      net: base.debt - base.credit,
      open: Math.max(0, base.openDebt - base.openCredit),
      paid: Math.max(0, base.paidDebt - base.paidCredit),
    };
  }, [filteredEntries]);

  const supplierPanel = useMemo(() => {
    const base = summarizeDebts(filteredEntries);
    const open = Math.max(0, base.openDebt - base.openCredit);
    const paid = Math.max(0, base.paidDebt - base.paidCredit);
    const total = Math.max(0, base.debt - base.credit);
    const paidPercent = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

    return {
      ...base,
      open,
      paid,
      total,
      paidPercent,
    };
  }, [filteredEntries]);

  const topSuppliers = useMemo(() => {
    const map = new Map<string, { supplier: string; rows: number; debt: number; credit: number; openDebt: number; openCredit: number }>();
    filteredEntries.forEach((entry) => {
      const current = map.get(entry.supplier) || { supplier: entry.supplier, rows: 0, debt: 0, credit: 0, openDebt: 0, openCredit: 0 };
      current.rows += 1;
      if (entry.nature === 'divida') {
        current.debt += entry.fee;
        if (entry.status === 'aberto') current.openDebt += entry.fee;
      }
      if (entry.nature === 'credito') {
        current.credit += entry.fee;
        if (entry.status === 'aberto') current.openCredit += entry.fee;
      }
      map.set(entry.supplier, current);
    });

    return Array.from(map.values())
      .map((supplier) => ({
        ...supplier,
        fee: Math.max(0, supplier.openDebt - supplier.openCredit),
      }))
      .sort((left, right) => right.fee - left.fee)
      .slice(0, 5);
  }, [filteredEntries]);

  const importFile = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { cellDates: true, raw: false });
      const parsed = parseWorkbookRows(workbook, XLSX.utils.sheet_to_json as SheetToJson);

      setEntries(parsed);
      setSheetFilters([]);
      setSupplierFilters([]);
      setMonthFilters([]);
      setNatureFilters([]);
      setStatusFilters([]);
      setSearchTerm('');
      setImportMessage(`${parsed.length} lancamentos importados de ${file.name}.`);
    } catch (error) {
      console.error(error);
      setImportMessage('Nao consegui ler essa planilha. Confirme se ela esta no formato XLSX do controle de transporte.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const setEntryStatus = useCallback((id: string, status: PaymentStatus) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, status } : entry));
  }, []);

  const closeManualForm = useCallback(() => {
    setShowManualForm(false);
    setManualForm(blankManualForm);
    setEditingEntryId(null);
    setManualError('');
  }, []);

  const openNewManualForm = useCallback(() => {
    setManualForm(blankManualForm);
    setEditingEntryId(null);
    setShowBulkForm(false);
    setShowBulkEditForm(false);
    setManualError('');
    setShowManualForm(true);
  }, []);

  const openEditEntry = useCallback((entry: TransportDebtEntry) => {
    setManualForm({
      debtMonth: entry.debtMonth || '',
      supplier: entry.supplier,
      category: entry.category,
      description: entry.description,
      invoice: entry.invoice,
      value: entry.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      fee: entry.fee.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      nature: entry.nature,
      status: entry.status,
    });
    setEditingEntryId(entry.id);
    setManualError('');
    setShowBulkForm(false);
    setShowBulkEditForm(false);
    setShowManualForm(true);
  }, []);

  const toggleEntrySelection = useCallback((id: string) => {
    setSelectedEntryIds((current) => (
      current.includes(id) ? current.filter((entryId) => entryId !== id) : [...current, id]
    ));
  }, []);

  const toggleVisibleSelection = useCallback(() => {
    setSelectedEntryIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !filteredEntryIds.includes(id));
      }

      return Array.from(new Set([...current, ...filteredEntryIds]));
    });
  }, [allVisibleSelected, filteredEntryIds]);

  const deleteEntries = useCallback((ids: string[]) => {
    if (!ids.length) return;

    const confirmed = window.confirm(ids.length === 1
      ? 'Excluir este lancamento?'
      : `Excluir ${ids.length} lancamentos selecionados?`);
    if (!confirmed) return;

    setEntries((current) => current.filter((entry) => !ids.includes(entry.id)));
    setSelectedEntryIds((current) => current.filter((id) => !ids.includes(id)));
    setImportMessage(ids.length === 1 ? 'Lancamento excluido.' : `${ids.length} lancamentos excluidos.`);
  }, []);

  const updateManualForm = useCallback((field: keyof ManualDebtForm, value: string) => {
    setManualForm((current) => {
      const next = { ...current, [field]: value };

      if (field === 'value') {
        const parsedValue = parseMoney(value);
        if (parsedValue !== null && !current.fee) {
          next.fee = calculateTransportFee(parsedValue).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        }
      }

      return next;
    });
  }, []);

  const updateBulkEditForm = useCallback((field: keyof BulkEditForm, value: string | boolean) => {
    setBulkEditForm((current) => ({ ...current, [field]: value }));
  }, []);

  const closeBulkEditForm = useCallback(() => {
    setShowBulkEditForm(false);
    setBulkEditForm(blankBulkEditForm);
    setManualError('');
  }, []);

  const applyBulkEdit = useCallback(() => {
    if (!selectedEntryIds.length) return;

    const hasChanges = bulkEditForm.updateMonth
      || bulkEditForm.updateCategory
      || bulkEditForm.updateDescription
      || bulkEditForm.updateNature
      || bulkEditForm.updateStatus;

    if (!hasChanges) {
      setManualError('Marque pelo menos um campo para alterar.');
      return;
    }

    const category = bulkEditForm.category.trim();
    const description = bulkEditForm.description.trim();

    setEntries((current) => current.map((entry) => {
      if (!selectedEntryIds.includes(entry.id)) return entry;

      return {
        ...entry,
        ...(bulkEditForm.updateMonth ? { debtMonth: bulkEditForm.debtMonth || undefined } : {}),
        ...(bulkEditForm.updateCategory ? { category } : {}),
        ...(bulkEditForm.updateDescription ? { description } : {}),
        ...(bulkEditForm.updateNature ? { nature: bulkEditForm.nature } : {}),
        ...(bulkEditForm.updateStatus ? { status: bulkEditForm.status } : {}),
      };
    }));

    setImportMessage(`${selectedEntryIds.length} lancamento${selectedEntryIds.length === 1 ? '' : 's'} atualizado${selectedEntryIds.length === 1 ? '' : 's'} em massa.`);
    setSelectedEntryIds([]);
    closeBulkEditForm();
  }, [bulkEditForm, closeBulkEditForm, selectedEntryIds]);

  const addManualEntry = useCallback(() => {
    const supplier = manualForm.supplier.trim();
    const invoice = manualForm.invoice.trim();
    const value = parseMoney(manualForm.value);
    const fee = parseMoney(manualForm.fee);

    if (!supplier) {
      setManualError('Informe o fornecedor.');
      return;
    }

    if (!invoice) {
      setManualError('Informe o numero da nota.');
      return;
    }

    if (value === null || value <= 0) {
      setManualError('Informe um valor de NF valido.');
      return;
    }

    const entryData: Omit<TransportDebtEntry, 'id' | 'sheet'> = {
      debtMonth: manualForm.debtMonth || undefined,
      supplier,
      category: manualForm.category.trim() || (manualForm.nature === 'credito' ? 'CREDITO' : 'DIVIDA'),
      description: manualForm.description.trim(),
      invoice,
      value,
      fee: fee ?? calculateTransportFee(value),
      nature: manualForm.nature,
      status: manualForm.status,
    };

    if (editingEntryId) {
      setEntries((current) => current.map((entry) => entry.id === editingEntryId ? { ...entry, ...entryData } : entry));
      setImportMessage(`Lancamento da nota ${invoice} atualizado.`);
    } else {
      setEntries((current) => [{
        id: `manual|${Date.now()}|${Math.random().toString(36).slice(2)}`,
        sheet: MANUAL_SHEET_NAME,
        ...entryData,
      }, ...current]);
      setImportMessage(`Lancamento manual da nota ${invoice} adicionado.`);
    }

    setManualForm(blankManualForm);
    setEditingEntryId(null);
    setManualError('');
    setShowManualForm(false);
    setSheetFilters([]);
  }, [editingEntryId, manualForm]);

  const addBulkEntries = useCallback(() => {
    const rows = bulkPasteText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const parsedEntries = rows.flatMap((line, index) => {
      const cells = splitBulkPasteLine(line);

      if (cells.length < 4) return [];

      const [supplier, category, invoice, rawValue, rawFee] = cells;
      const value = parseMoney(rawValue);
      const fee = parseMoney(rawFee);
      const normalizedCategory = normalizeSearch(category);
      const nature: DebtNature = normalizedCategory === 'credito' ? 'credito' : 'divida';

      if (!supplier || !/\d/.test(invoice) || value === null) return [];
      if (normalizedCategory === 'divida' && !/\d/.test(invoice)) return [];

      return [{
        id: `bulk|${Date.now()}|${index}|${Math.random().toString(36).slice(2)}`,
        sheet: MANUAL_SHEET_NAME,
        debtMonth: manualForm.debtMonth || undefined,
        supplier,
        category,
        description: '',
        invoice,
        value,
        fee: fee ?? calculateTransportFee(value),
        nature,
        status: 'aberto' as PaymentStatus,
      }];
    });

    if (!parsedEntries.length) {
      setManualError('Cole linhas com fornecedor, tipo, nota e valor NF. A coluna 3,5% e opcional.');
      return;
    }

    setEntries((current) => [...parsedEntries, ...current]);
    setBulkPasteText('');
    setManualForm(blankManualForm);
    setManualError('');
    setShowBulkForm(false);
    setSheetFilters([]);
    setImportMessage(`${parsedEntries.length} lancamentos adicionados por colagem.`);
  }, [bulkPasteText, manualForm.debtMonth]);

  const exportCsv = useCallback(() => {
    const rows = [
      ['mes', 'aba', 'fornecedor', 'categoria', 'descricao', 'nota', 'valor_nf', 'despesa_3_5', 'natureza', 'status'],
      ...filteredEntries.map((entry) => [
        monthLabel(entry.debtMonth),
        entry.sheet,
        entry.supplier,
        entry.category,
        entry.description,
        entry.invoice,
        entry.value.toFixed(2),
        entry.fee.toFixed(2),
        entry.nature,
        entry.status,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvValue).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dividas-transporte.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredEntries]);

  const exportPdf = useCallback(async () => {
    const exportEntries = filterEntries(entries);
    if (!exportEntries.length) return;

    const exportTotals = summarizeDebts(exportEntries);
    const exportOpen = Math.max(0, exportTotals.openDebt - exportTotals.openCredit);
    const exportedSuppliers = Array.from(new Set(exportEntries.map((entry) => entry.supplier)));
    const activeFilters = [
      supplierFilters.length ? `Fornecedor: ${supplierFilters.join(', ')}` : '',
      monthFilters.length ? `Mes: ${monthFilters.map((month) => month === NO_MONTH_VALUE ? 'Sem mes' : monthLabel(month)).join(', ')}` : '',
      sheetFilters.length ? `Aba: ${sheetFilters.join(', ')}` : '',
      natureFilters.length ? `Natureza: ${natureFilters.join(', ')}` : '',
      statusFilters.length ? `Status: ${statusFilters.join(', ')}` : '',
      searchTerm.trim() ? `Busca: ${searchTerm.trim()}` : '',
    ].filter(Boolean);
    const filterSummary = activeFilters.length ? activeFilters.join(' | ') : 'Filtros: todos os lancamentos';

    const [{ jsPDF }, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const autoTable = autoTableModule.default;
    const generatedAt = new Date().toLocaleDateString('pt-BR');

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setTextColor(37, 99, 235);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('CONTROLE FINANCEIRO', 40, 38);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(22);
    doc.text('COBRAN\u00C7A DE TRANSPORTE', 40, 64);

    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Gerado em ${generatedAt}`, pageWidth - 40, 40, { align: 'right' });

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(1.4);
    doc.line(40, 82, pageWidth - 40, 82);
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(filterSummary, 40, 96, { maxWidth: pageWidth - 80 });

    const summary = [
      ['Lancamentos', exportEntries.length.toLocaleString('pt-BR')],
      ['Valor NF', money(exportTotals.value)],
      ['Credito', money(exportTotals.credit)],
      ['Total a pagar', money(exportOpen)],
    ];

    summary.forEach(([label, value], index) => {
      const x = 40 + index * 190;
      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(index === 3 ? 239 : 248, index === 3 ? 246 : 250, index === 3 ? 255 : 252);
      doc.roundedRect(x, 112, 170, 44, 8, 8, 'FD');
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(7);
      doc.text(label.toUpperCase(), x + 10, 128);
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(12);
      doc.text(value, x + 10, 146);
    });

    autoTable(doc, {
      startY: 174,
      head: [['Mes', 'Fornecedor', 'Tipo', 'Nota', 'Valor NF', '3,5%', 'Natureza', 'Status']],
      body: exportEntries.map((entry) => [
        monthLabel(entry.debtMonth),
        entry.supplier,
        entry.category || '-',
        entry.invoice,
        money(entry.value),
        money(entry.fee),
        entry.nature,
        entry.status,
      ]),
      margin: { left: 40, right: 40 },
      styles: {
        font: 'helvetica',
        fontSize: 7,
        cellPadding: 5,
        lineColor: [203, 213, 225],
        lineWidth: 0.4,
        textColor: [15, 23, 42],
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [51, 65, 85],
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
    });

    const supplierName = supplierFilters.length === 1
      ? fileNameSegment(supplierFilters[0])
      : exportedSuppliers.length === 1 ? fileNameSegment(exportedSuppliers[0]) : '';
    const fileName = supplierName
      ? `cobran\u00E7a-transporte-${supplierName}.pdf`
      : `cobran\u00E7a-transporte-${new Date().toISOString().slice(0, 10)}.pdf`;

    doc.save(fileName);
  }, [entries, filterEntries, monthFilters, natureFilters, searchTerm, sheetFilters, statusFilters, supplierFilters]);

  return (
    <main className="transport-debt-workbench h-[calc(100vh-6rem)] max-w-full overflow-hidden bg-[#E8EEF7] p-2 md:h-screen md:p-4">
      <section className="flex h-full max-w-full flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
        <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg">
              <Truck size={28} strokeWidth={2.6} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-600">Controle financeiro</p>
              <h1 className="text-3xl font-black uppercase tracking-tight text-slate-950">Dividas de transporte</h1>
              <p className="text-sm font-bold text-slate-500">Leitura em blocos da planilha, calculo de 3,5%, baixas e exportacao.</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
              }}
            />
            <button
              type="button"
              onClick={openNewManualForm}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-blue-600 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700"
            >
              <Plus size={16} />
              Novo lancamento
            </button>
            <button
              type="button"
              onClick={() => {
                setShowBulkForm((current) => !current);
                setShowManualForm(false);
                setShowBulkEditForm(false);
                setManualError('');
              }}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 text-[10px] font-black uppercase tracking-widest text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
            >
              <FileSpreadsheet size={16} />
              Lancamento em massa
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
            >
              <Upload size={16} />
              {importing ? 'Importando' : 'Importar XLSX'}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!filteredEntries.length}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-slate-950 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              <Download size={16} />
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={!filteredEntries.length}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-40"
            >
              <FileSpreadsheet size={16} />
              Exportar PDF
            </button>
          </div>
        </div>

        <div className="mt-2 shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-black uppercase tracking-widest text-blue-600">{importMessage}</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="text-xl font-black uppercase tracking-tight text-slate-950">{money(supplierPanel.open)}</p>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">saldo em aberto</span>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <CompactMetric label="Lanc." value={filteredEntries.length.toLocaleString('pt-BR')} />
              <CompactMetric label="Forn." value={suppliers.toLocaleString('pt-BR')} />
              <CompactMetric label="Valor NF" value={money(totals.value)} />
              <CompactMetric label="Divida" value={money(supplierPanel.debt)} />
              <CompactMetric label="Credito" value={money(supplierPanel.credit)} tone="emerald" />
              <CompactMetric label="Saldo" value={money(supplierPanel.open)} tone="amber" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${supplierPanel.paidPercent}%` }} />
            </div>
            <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400">
              {supplierPanel.paidPercent}% pago
            </span>
          </div>
        </div>

        <div className="mt-2 flex shrink-0 flex-wrap gap-2">
          <label className="flex h-12 min-w-[240px] flex-[1_1_280px] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4">
            <Search size={18} className="text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar fornecedor, nota, categoria ou aba..."
              className="h-full flex-1 bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:text-slate-400"
            />
          </label>

          <MultiDropdownFilter
            label="Fornecedor"
            allLabel="Todos fornecedores"
            selectedValues={supplierFilters}
            onChange={setSupplierFilters}
            options={supplierOptions.map((supplier) => ({ value: supplier, label: supplier }))}
          />

          <MultiDropdownFilter
            label="Mes"
            allLabel="Todos meses"
            selectedValues={monthFilters}
            onChange={setMonthFilters}
            options={monthOptions.map((month) => ({ value: month, label: month === NO_MONTH_VALUE ? 'Sem mes' : monthLabel(month) }))}
          />

          <MultiDropdownFilter
            label="Aba"
            allLabel="Todas as abas"
            selectedValues={sheetFilters}
            onChange={setSheetFilters}
            options={sheets.map((sheet) => ({ value: sheet, label: sheet }))}
          />

          <MultiDropdownFilter
            label="Natureza"
            allLabel="Divida + credito"
            selectedValues={natureFilters}
            onChange={setNatureFilters}
            options={[
              { value: 'divida', label: 'Divida' },
              { value: 'credito', label: 'Credito' },
            ]}
          />

          <MultiDropdownFilter
            label="Status"
            allLabel="Todos status"
            selectedValues={statusFilters}
            onChange={setStatusFilters}
            options={[
              { value: 'aberto', label: 'Em aberto' },
              { value: 'pago', label: 'Pago' },
            ]}
          />

          <button
            type="button"
            onClick={() => {
      setSearchTerm('');
              setSupplierFilters([]);
              setMonthFilters([]);
              setSheetFilters([]);
              setNatureFilters([]);
              setStatusFilters([]);
            }}
            disabled={!searchTerm && supplierFilters.length === 0 && monthFilters.length === 0 && sheetFilters.length === 0 && natureFilters.length === 0 && statusFilters.length === 0}
            className="h-12 rounded-2xl border border-slate-200 px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:border-red-200 hover:text-red-500 disabled:opacity-40"
          >
            Limpar filtros
          </button>
        </div>

        {selectedEntryIds.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-700">
              {selectedEntryIds.length} lancamento{selectedEntryIds.length === 1 ? '' : 's'} selecionado{selectedEntryIds.length === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedEntryIds([])}
                className="h-9 rounded-xl border border-red-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-red-500 transition hover:border-red-300"
              >
                Cancelar selecao
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkEditForm(blankBulkEditForm);
                  setManualError('');
                  setShowManualForm(false);
                  setShowBulkForm(false);
                  setShowBulkEditForm(true);
                }}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700"
              >
                <Pencil size={15} />
                Editar em massa
              </button>
              <button
                type="button"
                onClick={() => deleteEntries(selectedEntryIds)}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-red-700"
              >
                <Trash2 size={15} />
                Excluir selecionados
              </button>
            </div>
          </div>
        )}

        <div className="mt-2 grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="h-full overflow-auto">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <th className="w-10 border-b border-slate-200 px-2 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        disabled={!filteredEntries.length}
                        onChange={toggleVisibleSelection}
                        className="h-4 w-4 accent-blue-600"
                        aria-label="Selecionar lancamentos visiveis"
                      />
                    </th>
                    <th className="w-20 border-b border-slate-200 px-2 py-3 text-center">Mes</th>
                    <th className="border-b border-slate-200 px-2 py-3">Fornecedor</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3">Tipo</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3">Nota</th>
                    <th className="w-28 border-b border-slate-200 px-2 py-3 text-right">Valor NF</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3 text-right">3,5%</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3">Natureza</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3">Status</th>
                    <th className="w-16 border-b border-slate-200 px-2 py-3 text-center">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr
                      key={entry.id}
                      className={selectedEntryIds.includes(entry.id) ? 'bg-blue-50' : entry.status === 'pago' ? 'bg-emerald-50/60' : 'bg-white'}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setOpenActionMenuId((current) => current === entry.id ? null : entry.id);
                      }}
                    >
                      <td className="border-b border-slate-100 px-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedEntryIds.includes(entry.id)}
                          onChange={() => toggleEntrySelection(entry.id)}
                          className="h-4 w-4 accent-blue-600"
                          aria-label={`Selecionar nota ${entry.invoice}`}
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-3 text-center">
                        <span
                          className="inline-flex h-7 min-w-[58px] items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2 text-[10px] font-black uppercase tracking-wide text-slate-600"
                          title={monthLabel(entry.debtMonth)}
                        >
                          {shortMonthLabel(entry.debtMonth)}
                        </span>
                      </td>
                      <td className="truncate border-b border-slate-100 px-2 py-3 text-xs font-black uppercase text-slate-900" title={entry.supplier}>{entry.supplier}</td>
                      <td className="truncate border-b border-slate-100 px-2 py-3 text-xs font-bold text-slate-500" title={entry.category || entry.description || '-'}>{entry.category || entry.description || '-'}</td>
                      <td className="truncate border-b border-slate-100 px-2 py-3 text-xs font-black text-blue-700">{entry.invoice}</td>
                      <td className="truncate border-b border-slate-100 px-2 py-3 text-right text-xs font-black text-slate-900">{money(entry.value)}</td>
                      <td className="truncate border-b border-slate-100 px-2 py-3 text-right text-xs font-black text-slate-900">{money(entry.fee)}</td>
                      <td className="border-b border-slate-100 px-2 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${entry.nature === 'credito' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                          {entry.nature}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-2 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${entry.status === 'pago' ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-700'}`}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="relative border-b border-slate-100 px-2 py-3 text-center" data-transport-action-menu="true">
                        <button
                          type="button"
                          onClick={() => setOpenActionMenuId((current) => current === entry.id ? null : entry.id)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-blue-600 hover:text-white"
                          title="Abrir acoes"
                        >
                          <MoreHorizontal size={18} />
                        </button>
                        {openActionMenuId === entry.id && (
                          <div className="absolute right-3 top-[calc(100%-2px)] z-[70] w-44 overflow-hidden rounded-md border border-slate-300 bg-white text-left shadow-[0_14px_28px_rgba(15,23,42,0.18)]">
                            <ActionMenuButton
                              icon={<Pencil size={15} />}
                              label="Editar"
                              onClick={() => {
                                setOpenActionMenuId(null);
                                openEditEntry(entry);
                              }}
                            />
                            <ActionMenuButton
                              icon={entry.status === 'pago' ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
                              label={entry.status === 'pago' ? 'Reabrir' : 'Marcar pago'}
                              onClick={() => {
                                setOpenActionMenuId(null);
                                setEntryStatus(entry.id, entry.status === 'pago' ? 'aberto' : 'pago');
                              }}
                            />
                            <ActionMenuButton
                              danger
                              icon={<Trash2 size={15} />}
                              label="Excluir"
                              onClick={() => {
                                setOpenActionMenuId(null);
                                deleteEntries([entry.id]);
                              }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filteredEntries.length && (
                    <tr>
                      <td colSpan={10} className="h-64 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                        <FileSpreadsheet className="mx-auto mb-3 text-slate-300" size={32} />
                        Nenhum lancamento encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Maiores saldos</p>
            <div className="mt-2 space-y-2">
              {topSuppliers.map((supplier, index) => (
                <div key={supplier.supplier} className="rounded-xl border border-slate-200 bg-white p-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-black text-slate-400">#{index + 1}</span>
                    <span className="text-xs font-black text-blue-700">{money(supplier.fee)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs font-black uppercase text-slate-900">{supplier.supplier}</p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{supplier.rows} notas</p>
                </div>
              ))}
              {!topSuppliers.length && (
                <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Importe uma planilha para ver o ranking.
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      {showBulkEditForm && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/20 p-3"
          onMouseDown={closeBulkEditForm}
        >
          <form
            className="w-full max-w-[620px] overflow-hidden rounded-[8px] border border-slate-300 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              applyBulkEdit();
            }}
          >
            <div className="flex h-9 items-center justify-between border-b border-slate-300 bg-slate-100 px-3">
              <p className="text-xs font-black text-slate-900">Editar em massa</p>
              <button
                type="button"
                onClick={closeBulkEditForm}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
                aria-label="Fechar edicao em massa"
              >
                <XCircle size={15} />
              </button>
            </div>

            <div className="p-3">
              <p className="mb-3 text-[11px] font-bold text-slate-500">
                Marque somente os campos que deseja aplicar em {selectedEntryIds.length} lancamento{selectedEntryIds.length === 1 ? '' : 's'}.
              </p>

              {manualError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                  {manualError}
                </div>
              )}

              <div className="space-y-2">
                <BulkEditRow
                  checked={bulkEditForm.updateMonth}
                  label="Mes"
                  onCheckedChange={(checked) => updateBulkEditForm('updateMonth', checked)}
                >
                  <MonthInput
                    label="Mes"
                    value={bulkEditForm.debtMonth}
                    onChange={(value) => updateBulkEditForm('debtMonth', value)}
                  />
                </BulkEditRow>

                <BulkEditRow
                  checked={bulkEditForm.updateCategory}
                  label="Tipo"
                  onCheckedChange={(checked) => updateBulkEditForm('updateCategory', checked)}
                >
                  <input
                    value={bulkEditForm.category}
                    onChange={(event) => updateBulkEditForm('category', event.target.value)}
                    placeholder="Ex.: SOFYTS"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-900 outline-none placeholder:text-slate-300 focus:border-blue-400"
                  />
                </BulkEditRow>

                <BulkEditRow
                  checked={bulkEditForm.updateDescription}
                  label="Descricao"
                  onCheckedChange={(checked) => updateBulkEditForm('updateDescription', checked)}
                >
                  <input
                    value={bulkEditForm.description}
                    onChange={(event) => updateBulkEditForm('description', event.target.value)}
                    placeholder="Opcional"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-900 outline-none placeholder:text-slate-300 focus:border-blue-400"
                  />
                </BulkEditRow>

                <BulkEditRow
                  checked={bulkEditForm.updateNature}
                  label="Natureza"
                  onCheckedChange={(checked) => updateBulkEditForm('updateNature', checked)}
                >
                  <SelectFilter value={bulkEditForm.nature} compact onChange={(value) => updateBulkEditForm('nature', value as DebtNature)}>
                    <option value="divida">Divida</option>
                    <option value="credito">Credito</option>
                  </SelectFilter>
                </BulkEditRow>

                <BulkEditRow
                  checked={bulkEditForm.updateStatus}
                  label="Status"
                  onCheckedChange={(checked) => updateBulkEditForm('updateStatus', checked)}
                >
                  <SelectFilter value={bulkEditForm.status} compact onChange={(value) => updateBulkEditForm('status', value as PaymentStatus)}>
                    <option value="aberto">Em aberto</option>
                    <option value="pago">Pago</option>
                  </SelectFilter>
                </BulkEditRow>
              </div>

              <div className="mt-3 flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={closeBulkEditForm}
                  className="h-9 rounded-md border border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="h-9 rounded-md bg-blue-600 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700"
                >
                  Aplicar alteracoes
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {showManualForm && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/20 p-3"
          onMouseDown={() => {
            closeManualForm();
          }}
        >
          <form
            className="w-full max-w-[640px] overflow-hidden rounded-[8px] border border-slate-300 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              addManualEntry();
            }}
          >
            <div className="flex h-9 items-center justify-between border-b border-slate-300 bg-slate-100 px-3">
              <div>
                <p className="text-xs font-black text-slate-900">{editingEntryId ? 'Editar lancamento' : 'Lancamento manual'}</p>
              </div>
              <button
                type="button"
                onClick={closeManualForm}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
                aria-label="Fechar lancamento manual"
              >
                <XCircle size={15} />
              </button>
            </div>

            <div className="p-3">
              <p className="mb-3 text-[11px] font-bold text-slate-500">
                {editingEntryId ? 'Ajuste os dados do lancamento selecionado.' : 'Cadastre uma divida ou credito sem depender da importacao da planilha.'}
              </p>

              {manualError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                  {manualError}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <MonthInput
                  label="Mes"
                  value={manualForm.debtMonth}
                  onChange={(value) => updateManualForm('debtMonth', value)}
                />
                <ManualInput
                  label="Fornecedor"
                  value={manualForm.supplier}
                  onChange={(value) => updateManualForm('supplier', value)}
                  placeholder="Ex.: ARMAZEM MATEUS"
                />
                <ManualInput
                  label="Tipo"
                  value={manualForm.category}
                  onChange={(value) => updateManualForm('category', value)}
                  placeholder="Ex.: SOFYTS"
                />
                <ManualInput
                  label="Nota"
                  value={manualForm.invoice}
                  onChange={(value) => updateManualForm('invoice', value)}
                  placeholder="Numero"
                />
                <ManualInput
                  label="Valor NF"
                  value={manualForm.value}
                  onChange={(value) => updateManualForm('value', value)}
                  placeholder="0,00"
                />
                <ManualInput
                  label="3,5%"
                  value={manualForm.fee}
                  onChange={(value) => updateManualForm('fee', value)}
                  placeholder="Auto"
                />
                <SelectFilter value={manualForm.nature} compact onChange={(value) => updateManualForm('nature', value as DebtNature)}>
                  <option value="divida">Divida</option>
                  <option value="credito">Credito</option>
                </SelectFilter>
                <div className="sm:col-span-2">
                  <ManualInput
                    label="Descricao"
                    value={manualForm.description}
                    onChange={(value) => updateManualForm('description', value)}
                    placeholder="Opcional"
                  />
                </div>
                <SelectFilter value={manualForm.status} compact onChange={(value) => updateManualForm('status', value as PaymentStatus)}>
                  <option value="aberto">Em aberto</option>
                  <option value="pago">Pago</option>
                </SelectFilter>
              </div>

              <div className="mt-3 flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={closeManualForm}
                  className="h-9 rounded-md border border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="h-9 rounded-md bg-slate-950 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700"
                >
                  {editingEntryId ? 'Salvar' : 'Adicionar'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {showBulkForm && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/20 p-3"
          onMouseDown={() => {
            setShowBulkForm(false);
            setManualError('');
            setBulkPasteText('');
          }}
        >
          <form
            className="w-full max-w-[620px] overflow-hidden rounded-[8px] border border-slate-300 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              addBulkEntries();
            }}
          >
            <div className="flex h-9 items-center justify-between border-b border-slate-300 bg-slate-100 px-3">
              <p className="text-xs font-black text-slate-900">Lancamento em massa</p>
              <button
                type="button"
                onClick={() => {
                  setShowBulkForm(false);
                  setManualError('');
                  setBulkPasteText('');
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
                aria-label="Fechar lancamento em massa"
              >
                <XCircle size={15} />
              </button>
            </div>

            <div className="p-3">
              <p className="text-[11px] font-bold text-slate-500">
                Cole linhas do Excel com fornecedor, tipo, nota e valor NF. Se a coluna 3,5% nao vier, o sistema calcula.
              </p>

              <div className="mt-3 max-w-[240px]">
                <MonthInput
                  label="Mes"
                  value={manualForm.debtMonth}
                  onChange={(value) => updateManualForm('debtMonth', value)}
                />
              </div>

              {manualError && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                  {manualError}
                </div>
              )}

              <textarea
                value={bulkPasteText}
                onChange={(event) => setBulkPasteText(event.target.value)}
                placeholder={`ARMAZEM MATEUS S A - CD SANTA ISABEL\tSOFYTS\t5.238.196\tR$ 1.683,61`}
                className="mt-3 h-48 w-full resize-none rounded-md border border-slate-300 bg-white p-2 font-mono text-[11px] font-bold text-slate-700 outline-none placeholder:text-slate-300 focus:border-blue-400"
              />

              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                A quinta coluna de 3,5% pode ser colada, mas nao e obrigatoria.
              </div>

              <div className="mt-3 flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowBulkForm(false);
                    setManualError('');
                    setBulkPasteText('');
                  }}
                  className="h-9 rounded-md border border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!bulkPasteText.trim()}
                  className="h-9 rounded-md bg-blue-600 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:opacity-40"
                >
                  Adicionar em massa
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function CompactMetric({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'blue' | 'amber' | 'emerald' }) {
  const toneClass = {
    slate: 'text-slate-950',
    blue: 'text-blue-700',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
  }[tone];

  return (
    <div className="min-w-[112px] rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-black ${toneClass}`}>{value}</p>
    </div>
  );
}

function ActionMenuButton({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-2 px-3 text-[11px] font-black uppercase tracking-widest transition ${
        danger
          ? 'text-red-500 hover:bg-red-50'
          : 'text-slate-600 hover:bg-slate-100 hover:text-blue-600'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function BulkEditRow({
  checked,
  label,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className={`grid gap-2 rounded-xl border p-2 transition sm:grid-cols-[150px_minmax(0,1fr)] ${checked ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
      <label className="flex cursor-pointer items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="h-4 w-4 accent-blue-600"
        />
        {label}
      </label>
      <div className={checked ? 'opacity-100' : 'pointer-events-none opacity-40'}>
        {children}
      </div>
    </div>
  );
}

function ManualInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-2">
      <span className="shrink-0 text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-800 outline-none placeholder:text-slate-300"
      />
    </label>
  );
}

function MonthInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-2">
      <span className="shrink-0 text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</span>
      <input
        type="month"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-800 outline-none"
      />
    </label>
  );
}

function MultiDropdownFilter({
  label,
  allLabel,
  options,
  selectedValues,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  selectedValues: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const filteredOptions = useMemo(() => {
    const query = normalizeSearch(searchValue);
    if (!query) return options;
    return options.filter((option) => normalizeSearch(`${option.label} ${option.value}`).includes(query));
  }, [options, searchValue]);
  const selectedLabels = options.filter((option) => selectedSet.has(option.value)).map((option) => option.label);
  const summary = selectedValues.length === 0
    ? allLabel
    : selectedLabels.length === 1
      ? selectedLabels[0]
      : `${selectedLabels.length} selecionados`;

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((item) => item !== value));
      return;
    }
    onChange([...selectedValues, value]);
  };

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open]);

  return (
    <div className="relative min-w-[135px] flex-[1_1_145px]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-12 w-full items-center justify-between gap-3 rounded-2xl border-2 bg-white px-4 text-left text-[10px] font-black uppercase tracking-wide transition-all ${
          selectedValues.length > 0
            ? 'border-blue-600 bg-blue-50 text-blue-700'
            : 'border-slate-100 text-slate-700 shadow-[4px_4px_0px_0px_rgba(15,23,42,0.08)]'
        }`}
      >
        <span className="min-w-0">
          <span className="block text-[8px] text-slate-400">{label}</span>
          <span className="block truncate">{summary}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-[90] mt-2 overflow-hidden rounded-[24px] border-2 border-slate-900 bg-white p-3 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)]">
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange([])}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left text-[9px] font-black uppercase ${
                  selectedValues.length === 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
                  selectedValues.length === 0 ? 'border-white bg-white' : 'border-slate-300 bg-white'
                }`} />
                <span className="truncate">{allLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-[9px] font-black uppercase text-white"
              >
                Tudo
              </button>
            </div>

            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder={`Buscar ${label.toLowerCase()}...`}
                className="h-10 w-full rounded-xl border-2 border-slate-100 bg-slate-50 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-300"
              />
            </div>

            <div className="max-h-64 overflow-y-auto pr-1">
              {filteredOptions.map((option) => {
                const checked = selectedSet.has(option.value);

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleValue(option.value)}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all ${
                      checked ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-blue-50'
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                      checked ? 'border-white bg-white text-blue-600' : 'border-slate-200 bg-white text-transparent'
                    }`}>
                      <CheckCircle2 size={13} strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase">{option.label}</span>
                  </button>
                );
              })}
              {filteredOptions.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-slate-100 px-3 py-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                  Nenhum item encontrado
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SelectFilter({
  value,
  onChange,
  children,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      const option = child as ReactElement<{ value?: string; children?: ReactNode }>;
      return {
        value: String(option.props.value ?? ''),
        label: String(option.props.children ?? option.props.value ?? ''),
      };
    });
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open]);

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`${compact ? 'h-9 rounded-md border-slate-300 bg-white px-2' : 'h-12 rounded-2xl border-2 border-slate-100 bg-white px-4 shadow-[4px_4px_0px_0px_rgba(15,23,42,0.08)]'} flex w-full items-center justify-between gap-3 border text-left text-[10px] font-black uppercase tracking-wide text-slate-700 transition-all hover:border-blue-300 ${open ? 'border-blue-500 text-blue-700 ring-2 ring-blue-100' : ''}`}
      >
        <span className="truncate">{selected?.label || 'Selecionar'}</span>
        <ChevronDown size={15} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
          <div className={`${compact ? 'rounded-md border-slate-300' : 'rounded-2xl border-slate-900 shadow-[6px_6px_0px_0px_rgba(15,23,42,1)]'} absolute left-0 right-0 top-full z-[90] mt-2 max-h-72 overflow-y-auto border-2 bg-white p-2`}>
            {options.map((option) => {
              const active = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`mb-1 flex min-h-9 w-full items-center rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-wide transition ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
