'use client';

import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileSpreadsheet, MoreHorizontal, Pencil, Plus, Search, Trash2, Upload, XCircle } from 'lucide-react';
import { getPermissionDeniedMessage } from '@/lib/permissions';

type DebtNature = 'divida' | 'credito';
type PaymentStatus = 'aberto' | 'pago';
type ChargeMode = 'auto_fee' | 'fixed_value' | 'previous_balance';

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
  paidAt?: string;
}

interface ParsedDebtEntry extends Omit<TransportDebtEntry, 'status'> {
  status?: PaymentStatus;
}

interface ManualDebtForm {
  debtMonth: string;
  chargeMode: ChargeMode;
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

type BulkDebtDraft = Omit<TransportDebtEntry, 'id'>;

interface BulkParseIssue {
  line: number;
  message: string;
  raw: string;
}

interface PendingTransportImport {
  fileName: string;
  entries: TransportDebtEntry[];
}

interface UndoSnapshot {
  label: string;
  entries: TransportDebtEntry[];
}

interface TransportDebtAlert {
  id: string;
  entryIds: string[];
  title: string;
  detail: string;
  severity: 'warning' | 'danger';
}

interface TransportAuditLog {
  id: string;
  at: string;
  action: string;
  detail: string;
  count?: number;
  amount?: number;
}

interface TransportDebtPreferences {
  searchTerm: string;
  sheetFilters: string[];
  supplierFilters: string[];
  monthFilters: string[];
  natureFilters: string[];
  statusFilters: string[];
  typeFilters: string[];
  showOnlyAlerts: boolean;
}

const STORAGE_KEY = 'transport-debt-control-v1';
const AUDIT_STORAGE_KEY = 'transport-debt-audit-v1';
const PREFERENCES_STORAGE_KEY = 'transport-debt-preferences-v1';
const MANUAL_SHEET_NAME = 'Lançamentos manuais';
const NO_MONTH_VALUE = '__sem_mes__';
const TRANSPORT_FEE_RATE = 0.035;

const blankManualForm: ManualDebtForm = {
  debtMonth: '',
  chargeMode: 'auto_fee',
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

function loadAuditLog() {
  if (typeof window === 'undefined') return [];

  const stored = window.localStorage.getItem(AUDIT_STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as TransportAuditLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    window.localStorage.removeItem(AUDIT_STORAGE_KEY);
    return [];
  }
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function emptyTransportPreferences(): TransportDebtPreferences {
  return {
    searchTerm: '',
    sheetFilters: [],
    supplierFilters: [],
    monthFilters: [],
    natureFilters: [],
    statusFilters: [],
    typeFilters: [],
    showOnlyAlerts: false,
  };
}

function loadTransportPreferences() {
  if (typeof window === 'undefined') return emptyTransportPreferences();

  try {
    const stored = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!stored) return emptyTransportPreferences();
    const parsed = JSON.parse(stored) as Partial<TransportDebtPreferences>;

    return {
      searchTerm: typeof parsed.searchTerm === 'string' ? parsed.searchTerm : '',
      sheetFilters: readStringArray(parsed.sheetFilters),
      supplierFilters: readStringArray(parsed.supplierFilters),
      monthFilters: readStringArray(parsed.monthFilters),
      natureFilters: readStringArray(parsed.natureFilters),
      statusFilters: readStringArray(parsed.statusFilters),
      typeFilters: readStringArray(parsed.typeFilters),
      showOnlyAlerts: Boolean(parsed.showOnlyAlerts),
    };
  } catch {
    window.localStorage.removeItem(PREFERENCES_STORAGE_KEY);
    return emptyTransportPreferences();
  }
}

function isTransportDebtEntry(value: unknown): value is TransportDebtEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<TransportDebtEntry>;
  return typeof entry.id === 'string'
    && typeof entry.sheet === 'string'
    && typeof entry.supplier === 'string'
    && typeof entry.category === 'string'
    && typeof entry.description === 'string'
    && typeof entry.invoice === 'string'
    && typeof entry.value === 'number'
    && typeof entry.fee === 'number'
    && (entry.nature === 'divida' || entry.nature === 'credito')
    && (entry.status === 'aberto' || entry.status === 'pago')
    && (entry.paidAt === undefined || typeof entry.paidAt === 'string');
}

function parseBackupEntries(text: string) {
  const parsed = JSON.parse(text) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : [];

  return entries.filter(isTransportDebtEntry);
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

function categoryUsesValueAsCharge(category: string) {
  const normalized = normalizeSearch(category);
  return normalized.includes('saldo')
    || normalized.includes('restante')
    || normalized.includes('valor manual')
    || normalized.includes('valor informado');
}

function parseBulkDebtEntries(text: string, debtMonth: string): { entries: BulkDebtDraft[]; issues: BulkParseIssue[] } {
  const entries: BulkDebtDraft[] = [];
  const issues: BulkParseIssue[] = [];

  text.split(/\r?\n/).forEach((rawLine, rawIndex) => {
    const line = rawLine.trim();
    const lineNumber = rawIndex + 1;
    if (!line) return;

    const cells = splitBulkPasteLine(line);
    if (cells.length < 4) {
      issues.push({ line: lineNumber, message: 'Linha precisa ter fornecedor, tipo, nota e valor NF.', raw: line });
      return;
    }

    const [supplier, category, invoice, rawValue, rawFee] = cells;
    const value = parseMoney(rawValue);
    const fee = rawFee ? parseMoney(rawFee) : null;
    const normalizedCategory = normalizeSearch(category);
    const nature: DebtNature = normalizedCategory === 'credito' ? 'credito' : 'divida';

    if (!supplier) {
      issues.push({ line: lineNumber, message: 'Fornecedor vazio.', raw: line });
      return;
    }

    if (!category) {
      issues.push({ line: lineNumber, message: 'Tipo/categoria vazio.', raw: line });
      return;
    }

    if (!/\d/.test(invoice)) {
      issues.push({ line: lineNumber, message: 'Nota invalida.', raw: line });
      return;
    }

    if (value === null || value <= 0) {
      issues.push({ line: lineNumber, message: 'Valor NF invalido.', raw: line });
      return;
    }

    if (rawFee && fee === null) {
      issues.push({ line: lineNumber, message: 'Valor de cobrança inválido.', raw: line });
      return;
    }

    const chargeValue = fee ?? (categoryUsesValueAsCharge(category) ? value : calculateTransportFee(value));

    entries.push({
      sheet: MANUAL_SHEET_NAME,
      debtMonth: debtMonth || undefined,
      supplier,
      category,
      description: '',
      invoice,
      value,
      fee: chargeValue,
      nature,
      status: 'aberto',
    });
  });

  return { entries, issues };
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
  if (!value) return 'Sem mês';
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function shortMonthLabel(value: string | undefined) {
  if (!value) return 'Sem mês';
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  const date = new Date(Number(year), Number(month) - 1, 1);
  const label = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${label}/${year.slice(-2)}`;
}

function shortDateTimeLabel(value: string | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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

function getTransportDebtAlerts(items: TransportDebtEntry[]) {
  const alerts: TransportDebtAlert[] = [];
  const duplicateMap = new Map<string, TransportDebtEntry[]>();

  items.forEach((entry) => {
    const duplicateKey = [
      normalizeSearch(entry.supplier),
      normalizeSearch(entry.invoice),
      entry.debtMonth || NO_MONTH_VALUE,
      entry.nature,
    ].join('|');

    if (entry.invoice && !['SALDO ANTERIOR', 'VALOR MANUAL'].includes(entry.invoice.toUpperCase())) {
      duplicateMap.set(duplicateKey, [...(duplicateMap.get(duplicateKey) || []), entry]);
    }

    if (!entry.debtMonth) {
      alerts.push({
        id: `missing-month|${entry.id}`,
        entryIds: [entry.id],
        title: 'Lançamento sem mês',
        detail: `${entry.supplier} - ${entry.invoice}`,
        severity: 'warning',
      });
    }

    if (entry.value > 0 && entry.fee > entry.value) {
      alerts.push({
        id: `charge-over-value|${entry.id}`,
        entryIds: [entry.id],
        title: 'Cobrança maior que NF',
        detail: `${entry.supplier}: ${money(entry.fee)} sobre ${money(entry.value)}`,
        severity: 'danger',
      });
    }

    if (categoryUsesValueAsCharge(entry.category) && !entry.description.trim()) {
      alerts.push({
        id: `balance-without-description|${entry.id}`,
        entryIds: [entry.id],
        title: 'Saldo/restante sem descricao',
        detail: `${entry.supplier} - ${money(entry.fee)}`,
        severity: 'warning',
      });
    }

    if (entry.status === 'pago' && entry.nature === 'divida' && entry.fee <= 0) {
      alerts.push({
        id: `paid-without-charge|${entry.id}`,
        entryIds: [entry.id],
        title: 'Pago sem valor de cobrança',
        detail: `${entry.supplier} - ${entry.invoice}`,
        severity: 'warning',
      });
    }

    if (entry.status === 'pago' && !entry.paidAt) {
      alerts.push({
        id: `paid-without-date|${entry.id}`,
        entryIds: [entry.id],
        title: 'Pago sem data de baixa',
        detail: `${entry.supplier} - ${entry.invoice}`,
        severity: 'warning',
      });
    }
  });

  duplicateMap.forEach((duplicates) => {
    if (duplicates.length < 2) return;

    alerts.push({
      id: `duplicate|${duplicates.map((entry) => entry.id).join('|')}`,
      entryIds: duplicates.map((entry) => entry.id),
      title: 'Possivel nota duplicada',
      detail: `${duplicates[0].supplier} - ${duplicates[0].invoice} (${duplicates.length} vezes)`,
      severity: 'danger',
    });
  });

  return alerts;
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

interface TransportDebtManagerProps {
  canImport?: boolean;
  canExport?: boolean;
  canBulkEdit?: boolean;
  canDeleteEntries?: boolean;
  onPermissionBlocked?: (action: string, details: string) => void;
}

export function TransportDebtManager({
  canImport = true,
  canExport = true,
  canBulkEdit = true,
  canDeleteEntries = true,
  onPermissionBlocked,
}: TransportDebtManagerProps) {
  const initialPreferences = useMemo(() => loadTransportPreferences(), []);
  const [entries, setEntries] = useState<TransportDebtEntry[]>(loadStoredEntries);
  const [searchTerm, setSearchTerm] = useState(initialPreferences.searchTerm);
  const [sheetFilters, setSheetFilters] = useState<string[]>(initialPreferences.sheetFilters);
  const [supplierFilters, setSupplierFilters] = useState<string[]>(initialPreferences.supplierFilters);
  const [monthFilters, setMonthFilters] = useState<string[]>(initialPreferences.monthFilters);
  const [natureFilters, setNatureFilters] = useState<string[]>(initialPreferences.natureFilters);
  const [statusFilters, setStatusFilters] = useState<string[]>(initialPreferences.statusFilters);
  const [typeFilters, setTypeFilters] = useState<string[]>(initialPreferences.typeFilters);
  const [showManualForm, setShowManualForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [showBulkEditForm, setShowBulkEditForm] = useState(false);
  const [manualForm, setManualForm] = useState<ManualDebtForm>(blankManualForm);
  const [bulkEditForm, setBulkEditForm] = useState<BulkEditForm>(blankBulkEditForm);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [manualError, setManualError] = useState('');
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingTransportImport | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [auditLog, setAuditLog] = useState<TransportAuditLog[]>(loadAuditLog);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showOnlyAlerts, setShowOnlyAlerts] = useState(initialPreferences.showOnlyAlerts);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [openToolbarMenu, setOpenToolbarMenu] = useState<null | 'create' | 'import' | 'export' | 'more'>(null);
  const [importMessage, setImportMessage] = useState(() => {
    const storedCount = loadStoredEntries().length;
    return storedCount
      ? `${storedCount} lançamentos carregados do último controle salvo.`
      : 'Importe a planilha de dívidas de transporte para carregar os lançamentos.';
  });
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    window.localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(auditLog));
  }, [auditLog]);

  useEffect(() => {
    const preferences: TransportDebtPreferences = {
      searchTerm,
      sheetFilters,
      supplierFilters,
      monthFilters,
      natureFilters,
      statusFilters,
      typeFilters,
      showOnlyAlerts,
    };

    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  }, [monthFilters, natureFilters, searchTerm, sheetFilters, showOnlyAlerts, statusFilters, supplierFilters, typeFilters]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openActionMenuId) {
        setOpenActionMenuId(null);
        return;
      }
      if (openToolbarMenu) {
        setOpenToolbarMenu(null);
        return;
      }
      if (pendingDeleteIds.length) {
        setPendingDeleteIds([]);
        return;
      }
      if (pendingImport) {
        setPendingImport(null);
        return;
      }
      if (showAuditLog) {
        setShowAuditLog(false);
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
  }, [openActionMenuId, openToolbarMenu, pendingDeleteIds.length, pendingImport, searchTerm, showAuditLog, showBulkEditForm, showBulkForm, showManualForm]);

  useEffect(() => {
    if (!openActionMenuId && !openToolbarMenu) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-transport-action-menu="true"]')) return;
      if (target instanceof Element && target.closest('[data-transport-toolbar-menu="true"]')) return;
      setOpenActionMenuId(null);
      setOpenToolbarMenu(null);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [openActionMenuId, openToolbarMenu]);

  const sheets = useMemo(() => Array.from(new Set(entries.map((entry) => entry.sheet))).sort(), [entries]);
  const monthOptions = useMemo(() => Array.from(new Set(entries.map((entry) => entry.debtMonth || NO_MONTH_VALUE))).sort((left, right) => (
    left === NO_MONTH_VALUE ? 1 : right === NO_MONTH_VALUE ? -1 : right.localeCompare(left)
  )), [entries]);
  const supplierOptions = useMemo(() => Array.from(new Set(entries.map((entry) => entry.supplier))).sort((left, right) => (
    left.localeCompare(right, 'pt-BR', { sensitivity: 'base' })
  )), [entries]);
  const typeOptions = useMemo(() => Array.from(new Set(entries.map((entry) => entry.category || 'Sem tipo'))).sort((left, right) => (
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
      if (typeFilters.length > 0 && !typeFilters.includes(entry.category || 'Sem tipo')) return false;

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
  }, [monthFilters, natureFilters, searchTerm, sheetFilters, statusFilters, supplierFilters, typeFilters]);
  const baseFilteredEntries = useMemo(() => filterEntries(entries), [entries, filterEntries]);
  const debtAlerts = useMemo(() => getTransportDebtAlerts(baseFilteredEntries), [baseFilteredEntries]);
  const alertEntryIds = useMemo(() => new Set(debtAlerts.flatMap((alert) => alert.entryIds)), [debtAlerts]);
  const dangerAlerts = useMemo(() => debtAlerts.filter((alert) => alert.severity === 'danger'), [debtAlerts]);
  const effectiveShowOnlyAlerts = showOnlyAlerts && debtAlerts.length > 0;
  const filteredEntries = useMemo(() => (
    effectiveShowOnlyAlerts ? baseFilteredEntries.filter((entry) => alertEntryIds.has(entry.id)) : baseFilteredEntries
  ), [alertEntryIds, baseFilteredEntries, effectiveShowOnlyAlerts]);
  const filteredEntryIds = useMemo(() => filteredEntries.map((entry) => entry.id), [filteredEntries]);
  const selectedVisibleCount = useMemo(() => filteredEntryIds.filter((id) => selectedEntryIds.includes(id)).length, [filteredEntryIds, selectedEntryIds]);
  const allVisibleSelected = filteredEntryIds.length > 0 && selectedVisibleCount === filteredEntryIds.length;

  const bulkPreview = useMemo(() => parseBulkDebtEntries(bulkPasteText, manualForm.debtMonth), [bulkPasteText, manualForm.debtMonth]);
  const bulkPreviewTotals = useMemo(() => {
    const base = summarizeDebts(bulkPreview.entries.map((entry, index) => ({ ...entry, id: `preview|${index}` })));

    return {
      ...base,
      net: base.debt - base.credit,
    };
  }, [bulkPreview.entries]);
  const pendingDeleteEntries = useMemo(() => entries.filter((entry) => pendingDeleteIds.includes(entry.id)), [entries, pendingDeleteIds]);
  const pendingDeleteTotals = useMemo(() => summarizeDebts(pendingDeleteEntries), [pendingDeleteEntries]);
  const pendingImportTotals = useMemo(() => summarizeDebts(pendingImport?.entries || []), [pendingImport]);

  const addAuditLog = useCallback((event: Omit<TransportAuditLog, 'id' | 'at'>) => {
    setAuditLog((current) => [{
      id: `audit|${Date.now()}|${Math.random().toString(36).slice(2)}`,
      at: new Date().toISOString(),
      ...event,
    }, ...current].slice(0, 80));
  }, []);

  const getBlockedMessage = useCallback((action: string, requirement: Parameters<typeof getPermissionDeniedMessage>[1]) => {
    const message = getPermissionDeniedMessage(action, requirement);
    onPermissionBlocked?.(action, message);
    addAuditLog({
      action: 'Acao bloqueada',
      detail: message,
      count: 1,
    });
    return message;
  }, [addAuditLog, onPermissionBlocked]);

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
    const query = normalizeSearch(searchTerm);
    const map = new Map<string, { supplier: string; rows: number; debt: number; credit: number; openDebt: number; openCredit: number }>();
    entries.forEach((entry) => {
      if (sheetFilters.length > 0 && !sheetFilters.includes(entry.sheet)) return;
      if (monthFilters.length > 0 && !monthFilters.includes(entry.debtMonth || NO_MONTH_VALUE)) return;
      if (natureFilters.length > 0 && !natureFilters.includes(entry.nature)) return;
      if (statusFilters.length > 0 && !statusFilters.includes(entry.status)) return;
      if (typeFilters.length > 0 && !typeFilters.includes(entry.category || 'Sem tipo')) return;
      if (query && !normalizeSearch([
        entry.supplier,
        entry.category,
        entry.description,
        entry.invoice,
        entry.sheet,
        monthLabel(entry.debtMonth),
      ].join(' ')).includes(query)) return;

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
  }, [entries, monthFilters, natureFilters, searchTerm, sheetFilters, statusFilters, typeFilters]);

  const importFile = useCallback(async (file: File) => {
    if (!canImport) {
      setImportMessage(getBlockedMessage('importar planilhas de transporte', 'perfumePurchasingOrSupreme'));
      return;
    }
    setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { cellDates: true, raw: false });
      const parsed = parseWorkbookRows(workbook, XLSX.utils.sheet_to_json as SheetToJson);

      setPendingImport({ fileName: file.name, entries: parsed });
      setImportMessage(`${parsed.length} lançamentos lidos de ${file.name}. Confira antes de substituir o controle atual.`);
    } catch (error) {
      console.error(error);
      setImportMessage('Não consegui ler essa planilha. Confirme se ela está no formato XLSX do controle de transporte.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [canImport, getBlockedMessage]);

  const confirmImport = useCallback(() => {
    if (!pendingImport) return;
    if (!canImport) {
      setImportMessage(getBlockedMessage('confirmar importacoes de transporte', 'perfumePurchasingOrSupreme'));
      return;
    }

    setUndoSnapshot({
      label: `Importação de ${pendingImport.fileName}`,
      entries,
    });
    setEntries(pendingImport.entries);
    setSheetFilters([]);
    setSupplierFilters([]);
    setMonthFilters([]);
    setNatureFilters([]);
    setStatusFilters([]);
    setTypeFilters([]);
    setSearchTerm('');
    setSelectedEntryIds([]);
    setPendingImport(null);
    setImportMessage(`${pendingImport.entries.length} lançamentos importados de ${pendingImport.fileName}.`);
    addAuditLog({
      action: 'Controle substituído',
      detail: pendingImport.fileName,
      count: pendingImport.entries.length,
      amount: summarizeDebts(pendingImport.entries).fee,
    });
  }, [addAuditLog, canImport, entries, getBlockedMessage, pendingImport]);

  const setEntryStatus = useCallback((id: string, status: PaymentStatus) => {
    if (!canBulkEdit) {
      setImportMessage(getBlockedMessage('alterar status de lancamento de transporte', 'transportBulk'));
      return;
    }
    const target = entries.find((entry) => entry.id === id);
    const paidAt = status === 'pago' ? new Date().toISOString() : undefined;
    setEntries((current) => current.map((entry) => (
      entry.id === id ? { ...entry, status, paidAt } : entry
    )));
    if (target) {
      addAuditLog({
        action: status === 'pago' ? 'Lançamento baixado' : 'Lançamento reaberto',
        detail: `${target.supplier} - ${target.invoice}`,
        count: 1,
        amount: target.fee,
      });
    }
  }, [addAuditLog, canBulkEdit, entries, getBlockedMessage]);

  const setSelectedEntriesStatus = useCallback((status: PaymentStatus) => {
    if (!selectedEntryIds.length) return;
    if (!canBulkEdit) {
      setImportMessage(getBlockedMessage('alterar lancamentos de transporte em massa', 'transportBulk'));
      return;
    }

    const targets = entries.filter((entry) => selectedEntryIds.includes(entry.id) && entry.status !== status);
    if (!targets.length) {
      setImportMessage(status === 'pago' ? 'Os lançamentos selecionados já estão pagos.' : 'Os lançamentos selecionados já estão em aberto.');
      setSelectedEntryIds([]);
      return;
    }

    setUndoSnapshot({
      label: status === 'pago' ? `Baixa de ${targets.length} lançamentos` : `Reabertura de ${targets.length} lançamentos`,
      entries,
    });
    const paidAt = status === 'pago' ? new Date().toISOString() : undefined;
    setEntries((current) => current.map((entry) => (
      selectedEntryIds.includes(entry.id) ? { ...entry, status, paidAt } : entry
    )));
    setSelectedEntryIds([]);
    setImportMessage(status === 'pago'
      ? `${targets.length} lançamento${targets.length === 1 ? '' : 's'} marcado${targets.length === 1 ? '' : 's'} como pago.`
      : `${targets.length} lançamento${targets.length === 1 ? '' : 's'} reaberto${targets.length === 1 ? '' : 's'}.`);
    addAuditLog({
      action: status === 'pago' ? 'Baixa em massa' : 'Reabertura em massa',
      detail: `${targets.length} lançamento${targets.length === 1 ? '' : 's'}`,
      count: targets.length,
      amount: summarizeDebts(targets).fee,
    });
  }, [addAuditLog, canBulkEdit, entries, getBlockedMessage, selectedEntryIds]);

  const undoLastChange = useCallback(() => {
    if (!undoSnapshot) return;

    setEntries(undoSnapshot.entries);
    setSelectedEntryIds([]);
    setPendingDeleteIds([]);
    setPendingImport(null);
    setUndoSnapshot(null);
    setImportMessage(`Alteração desfeita: ${undoSnapshot.label}.`);
    addAuditLog({
      action: 'Alteração desfeita',
      detail: undoSnapshot.label,
      count: undoSnapshot.entries.length,
    });
  }, [addAuditLog, undoSnapshot]);

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
    if (!canBulkEdit) {
      setImportMessage(getBlockedMessage('editar lancamento de transporte', 'transportBulk'));
      return;
    }
    setManualForm({
      debtMonth: entry.debtMonth || '',
      chargeMode: Math.abs(entry.fee - calculateTransportFee(entry.value)) <= 0.01 ? 'auto_fee' : 'fixed_value',
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
  }, [canBulkEdit, getBlockedMessage]);

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

  const requestDeleteEntries = useCallback((ids: string[]) => {
    if (!ids.length) return;
    if (!canDeleteEntries) {
      setImportMessage(getBlockedMessage('excluir lancamentos de transporte', 'managerOrSupreme'));
      return;
    }
    setPendingDeleteIds(ids);
    setOpenActionMenuId(null);
    setShowManualForm(false);
    setShowBulkForm(false);
    setShowBulkEditForm(false);
  }, [canDeleteEntries, getBlockedMessage]);

  const confirmDeleteEntries = useCallback(() => {
    if (!pendingDeleteIds.length) return;
    if (!canDeleteEntries) {
      setImportMessage(getBlockedMessage('confirmar exclusoes de transporte', 'managerOrSupreme'));
      setPendingDeleteIds([]);
      return;
    }

    setUndoSnapshot({
      label: pendingDeleteIds.length === 1 ? 'Exclusão de lançamento' : `Exclusão de ${pendingDeleteIds.length} lançamentos`,
      entries,
    });
    setEntries((current) => current.filter((entry) => !pendingDeleteIds.includes(entry.id)));
    setSelectedEntryIds((current) => current.filter((id) => !pendingDeleteIds.includes(id)));
    setImportMessage(pendingDeleteIds.length === 1 ? 'Lançamento excluído.' : `${pendingDeleteIds.length} lançamentos excluídos.`);
    setPendingDeleteIds([]);
    addAuditLog({
      action: pendingDeleteIds.length === 1 ? 'Lançamento excluído' : 'Lançamentos excluídos',
      detail: `${pendingDeleteIds.length} registro${pendingDeleteIds.length === 1 ? '' : 's'}`,
      count: pendingDeleteIds.length,
      amount: summarizeDebts(pendingDeleteEntries).fee,
    });
  }, [addAuditLog, canDeleteEntries, entries, getBlockedMessage, pendingDeleteEntries, pendingDeleteIds]);

  const updateManualForm = useCallback((field: keyof ManualDebtForm, value: string) => {
    setManualForm((current) => {
      const next = { ...current, [field]: value };

      if (field === 'value' && current.chargeMode === 'auto_fee') {
        const parsedValue = parseMoney(value);
        if (parsedValue !== null) {
          next.fee = calculateTransportFee(parsedValue).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        }
      }

      if (field === 'chargeMode' && value === 'auto_fee' && current.value) {
        const parsedValue = parseMoney(current.value);
        if (parsedValue !== null) {
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
    if (!canBulkEdit) {
      setManualError(getBlockedMessage('editar lancamentos de transporte em massa', 'transportBulk'));
      return;
    }

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

    setUndoSnapshot({
      label: `Edição em massa de ${selectedEntryIds.length} lançamento${selectedEntryIds.length === 1 ? '' : 's'}`,
      entries,
    });
    setEntries((current) => current.map((entry) => {
      if (!selectedEntryIds.includes(entry.id)) return entry;
      const nextStatus = bulkEditForm.updateStatus ? bulkEditForm.status : entry.status;

      return {
        ...entry,
        ...(bulkEditForm.updateMonth ? { debtMonth: bulkEditForm.debtMonth || undefined } : {}),
        ...(bulkEditForm.updateCategory ? { category } : {}),
        ...(bulkEditForm.updateDescription ? { description } : {}),
        ...(bulkEditForm.updateNature ? { nature: bulkEditForm.nature } : {}),
        ...(bulkEditForm.updateStatus ? { status: nextStatus, paidAt: nextStatus === 'pago' ? entry.paidAt || new Date().toISOString() : undefined } : {}),
      };
    }));

    setImportMessage(`${selectedEntryIds.length} lançamento${selectedEntryIds.length === 1 ? '' : 's'} atualizado${selectedEntryIds.length === 1 ? '' : 's'} em massa.`);
    setSelectedEntryIds([]);
    closeBulkEditForm();
    addAuditLog({
      action: 'Edição em massa',
      detail: `${selectedEntryIds.length} lançamento${selectedEntryIds.length === 1 ? '' : 's'} atualizado${selectedEntryIds.length === 1 ? '' : 's'}`,
      count: selectedEntryIds.length,
    });
  }, [addAuditLog, bulkEditForm, canBulkEdit, closeBulkEditForm, entries, getBlockedMessage, selectedEntryIds]);

  const addManualEntry = useCallback(() => {
    const supplier = manualForm.supplier.trim();
    const chargeMode = manualForm.chargeMode;
    const invoice = manualForm.invoice.trim();
    const value = parseMoney(manualForm.value);
    const fee = parseMoney(manualForm.fee);
    const isAutoFee = chargeMode === 'auto_fee';
    const isPreviousBalance = chargeMode === 'previous_balance';

    if (!supplier) {
      setManualError('Informe o fornecedor.');
      return;
    }

    if (isAutoFee && !invoice) {
      setManualError('Informe o numero da nota.');
      return;
    }

    if (isAutoFee && (value === null || value <= 0)) {
      setManualError('Informe um valor de NF valido.');
      return;
    }

    if (!isAutoFee && (fee === null || fee <= 0)) {
      setManualError('Informe o valor da cobrança.');
      return;
    }

    const chargeValue = isAutoFee ? fee ?? calculateTransportFee(value || 0) : fee || 0;
    const baseValue = value !== null && value > 0 ? value : chargeValue;
    const reference = invoice || (isPreviousBalance ? 'SALDO ANTERIOR' : 'VALOR MANUAL');

    const entryData: Omit<TransportDebtEntry, 'id' | 'sheet'> = {
      debtMonth: manualForm.debtMonth || undefined,
      supplier,
      category: manualForm.category.trim() || (isPreviousBalance ? 'SALDO ANTERIOR' : manualForm.nature === 'credito' ? 'CREDITO' : 'DIVIDA'),
      description: manualForm.description.trim(),
      invoice: reference,
      value: baseValue,
      fee: chargeValue,
      nature: manualForm.nature,
      status: manualForm.status,
      paidAt: manualForm.status === 'pago' ? new Date().toISOString() : undefined,
    };

    if (editingEntryId) {
      setEntries((current) => current.map((entry) => entry.id === editingEntryId ? { ...entry, ...entryData } : entry));
      setImportMessage(`Lançamento da referência ${reference} atualizado.`);
      addAuditLog({
        action: 'Lançamento editado',
        detail: `${supplier} - ${reference}`,
        count: 1,
        amount: chargeValue,
      });
    } else {
      setEntries((current) => [{
        id: `manual|${Date.now()}|${Math.random().toString(36).slice(2)}`,
        sheet: MANUAL_SHEET_NAME,
        ...entryData,
      }, ...current]);
      setImportMessage(`Lançamento manual da referencia ${reference} adicionado.`);
      addAuditLog({
        action: 'Lançamento manual',
        detail: `${supplier} - ${reference}`,
        count: 1,
        amount: chargeValue,
      });
    }

    setManualForm(blankManualForm);
    setEditingEntryId(null);
    setManualError('');
    setShowManualForm(false);
    setSheetFilters([]);
  }, [addAuditLog, editingEntryId, manualForm]);

  const addBulkEntries = useCallback(() => {
    if (bulkPreview.issues.length) {
      setManualError('Corrija as linhas marcadas antes de adicionar.');
      return;
    }

    const parsedEntries = bulkPreview.entries.map((entry, index) => ({
        id: `bulk|${Date.now()}|${index}|${Math.random().toString(36).slice(2)}`,
        ...entry,
      }));

    if (!parsedEntries.length) {
      setManualError('Cole linhas com fornecedor, tipo, nota e valor NF. A coluna valor cobrança é opcional.');
      return;
    }

    setEntries((current) => [...parsedEntries, ...current]);
    setBulkPasteText('');
    setManualForm(blankManualForm);
    setManualError('');
    setShowBulkForm(false);
    setSheetFilters([]);
    setImportMessage(`${parsedEntries.length} lançamentos adicionados por colagem.`);
    addAuditLog({
      action: 'Lançamento em massa',
      detail: 'Colagem manual',
      count: parsedEntries.length,
      amount: summarizeDebts(parsedEntries).fee,
    });
  }, [addAuditLog, bulkPreview]);

  const exportCsv = useCallback(() => {
    if (!canExport) {
      setImportMessage(getBlockedMessage('exportar CSV de transporte', 'perfumePurchasingOrSupreme'));
      return;
    }
    const rows = [
      ['mes', 'aba', 'fornecedor', 'categoria', 'descricao', 'nota', 'valor_nf', 'valor_cobranca', 'natureza', 'status', 'baixa'],
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
        entry.paidAt || '',
      ]),
    ];
    const csv = rows.map((row) => row.map(csvValue).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dívidas-transporte.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [canExport, filteredEntries, getBlockedMessage]);

  const exportBackup = useCallback(() => {
    if (!canExport) {
      setImportMessage(getBlockedMessage('exportar backup de transporte', 'perfumePurchasingOrSupreme'));
      return;
    }
    const payload = {
      app: 'gestao-tarefas',
      module: 'transport-debts',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-transporte-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setImportMessage(`${entries.length} lançamentos exportados no backup.`);
    addAuditLog({
      action: 'Backup exportado',
      detail: 'Arquivo JSON restauravel',
      count: entries.length,
      amount: summarizeDebts(entries).fee,
    });
  }, [addAuditLog, canExport, entries, getBlockedMessage]);

  const restoreBackup = useCallback(async (file: File) => {
    if (!canImport) {
      setImportMessage(getBlockedMessage('restaurar backup de transporte', 'perfumePurchasingOrSupreme'));
      return;
    }
    try {
      const text = await file.text();
      const restoredEntries = parseBackupEntries(text);

      if (!restoredEntries.length) {
        setImportMessage('Backup sem lançamentos válidos. Confira se o arquivo JSON é do controle de transporte.');
        return;
      }

      setPendingImport({ fileName: file.name, entries: restoredEntries });
      setImportMessage(`${restoredEntries.length} lançamentos lidos do backup ${file.name}. Confira antes de restaurar.`);
    } catch (error) {
      console.error(error);
      setImportMessage('Não consegui ler esse backup. Use um arquivo JSON exportado pelo controle de transporte.');
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  }, [canImport, getBlockedMessage]);

  const exportPdf = useCallback(async () => {
    if (!canExport) {
      setImportMessage(getBlockedMessage('exportar PDF de cobranca de transporte', 'perfumePurchasingOrSupreme'));
      return;
    }
    const exportEntries = filterEntries(entries);
    if (!exportEntries.length) return;

    const exportTotals = summarizeDebts(exportEntries);
    const exportOpen = Math.max(0, exportTotals.openDebt - exportTotals.openCredit);
    const exportedSuppliers = Array.from(new Set(exportEntries.map((entry) => entry.supplier)));
    const activeFilters = [
      supplierFilters.length ? `Fornecedor: ${supplierFilters.join(', ')}` : '',
      monthFilters.length ? `Mês: ${monthFilters.map((month) => month === NO_MONTH_VALUE ? 'Sem mês' : monthLabel(month)).join(', ')}` : '',
      sheetFilters.length ? `Aba: ${sheetFilters.join(', ')}` : '',
      natureFilters.length ? `Natureza: ${natureFilters.join(', ')}` : '',
      statusFilters.length ? `Status: ${statusFilters.join(', ')}` : '',
      typeFilters.length ? `Tipo: ${typeFilters.join(', ')}` : '',
      searchTerm.trim() ? `Busca: ${searchTerm.trim()}` : '',
    ].filter(Boolean);
    const filterSummary = activeFilters.length ? activeFilters.join(' | ') : 'Filtros: todos os lançamentos';

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
      ['Lançamentos', exportEntries.length.toLocaleString('pt-BR')],
      ['Valor NF', money(exportTotals.value)],
      ['Crédito', money(exportTotals.credit)],
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
      head: [['Mês', 'Fornecedor', 'Tipo', 'Nota', 'Valor NF', 'Valor cobrança', 'Natureza', 'Status', 'Baixa']],
      body: exportEntries.map((entry) => [
        monthLabel(entry.debtMonth),
        entry.supplier,
        entry.category || '-',
        entry.invoice,
        money(entry.value),
        money(entry.fee),
        entry.nature,
        entry.status,
        shortDateTimeLabel(entry.paidAt),
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
  }, [canExport, entries, filterEntries, getBlockedMessage, monthFilters, natureFilters, searchTerm, sheetFilters, statusFilters, supplierFilters, typeFilters]);

  const importPermissionTitle = canImport ? undefined : getPermissionDeniedMessage('importar planilhas de transporte', 'perfumePurchasingOrSupreme');
  const exportPermissionTitle = canExport ? undefined : getPermissionDeniedMessage('exportar dados de transporte', 'perfumePurchasingOrSupreme');
  const bulkEditPermissionTitle = canBulkEdit ? undefined : getPermissionDeniedMessage('alterar lancamentos de transporte', 'transportBulk');
  const deletePermissionTitle = canDeleteEntries ? undefined : getPermissionDeniedMessage('excluir lancamentos de transporte', 'managerOrSupreme');

  return (
    <main className="transport-debt-workbench h-[calc(100dvh-4rem)] max-w-full overflow-hidden bg-[#E8EEF7] p-2 md:h-[calc(100dvh-4rem)] md:p-4">
      <section className="flex h-full max-w-full flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
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
        <input
          ref={backupInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void restoreBackup(file);
          }}
        />
        <div className="flex shrink-0 justify-end xl:hidden">
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div className="relative" data-transport-toolbar-menu="true">
              <button
                type="button"
                onClick={() => setOpenToolbarMenu((current) => current === 'create' ? null : 'create')}
                className="inline-flex h-11 items-center gap-2 rounded-2xl bg-blue-600 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700"
                aria-expanded={openToolbarMenu === 'create'}
              >
                <Plus size={16} />
                Lançamento
                <ChevronDown size={14} className={`transition-transform ${openToolbarMenu === 'create' ? 'rotate-180' : ''}`} />
              </button>

              {openToolbarMenu === 'create' && (
                <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_42px_rgba(15,23,42,0.18)]">
                  <button
                    type="button"
                    onClick={() => {
                      openNewManualForm();
                      setOpenToolbarMenu(null);
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                  >
                    <Plus size={15} />
                    Único
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBulkForm((current) => !current);
                      setShowManualForm(false);
                      setShowBulkEditForm(false);
                      setManualError('');
                      setOpenToolbarMenu(null);
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                  >
                    <FileSpreadsheet size={15} />
                    Em massa
                  </button>
                </div>
              )}
            </div>

            <div className="relative" data-transport-toolbar-menu="true">
              <button
                type="button"
                onClick={() => setOpenToolbarMenu((current) => current === 'import' ? null : 'import')}
                disabled={importing || !canImport}
                title={importPermissionTitle}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
                aria-expanded={openToolbarMenu === 'import'}
              >
                <Upload size={16} />
                {importing ? 'Importando' : 'Importar'}
                <ChevronDown size={14} className={`transition-transform ${openToolbarMenu === 'import' ? 'rotate-180' : ''}`} />
              </button>

              {openToolbarMenu === 'import' && (
                <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_42px_rgba(15,23,42,0.18)]">
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setOpenToolbarMenu(null);
                    }}
                    disabled={!canImport}
                    title={importPermissionTitle}
                    className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                  >
                    <Upload size={15} />
                    XLSX
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      backupInputRef.current?.click();
                      setOpenToolbarMenu(null);
                    }}
                    disabled={!canImport}
                    title={importPermissionTitle}
                    className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                  >
                    <Upload size={15} />
                    Restaurar backup
                  </button>
                </div>
              )}
            </div>

            <div className="relative" data-transport-toolbar-menu="true">
              <button
                type="button"
                onClick={() => setOpenToolbarMenu((current) => current === 'export' ? null : 'export')}
                disabled={!filteredEntries.length || !canExport}
                title={exportPermissionTitle}
                className="inline-flex h-11 items-center gap-2 rounded-2xl bg-slate-950 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:opacity-40"
                aria-expanded={openToolbarMenu === 'export'}
              >
                <Download size={16} />
                Exportar
                <ChevronDown size={14} className={`transition-transform ${openToolbarMenu === 'export' ? 'rotate-180' : ''}`} />
              </button>

              {openToolbarMenu === 'export' && (
                <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_42px_rgba(15,23,42,0.18)]">
                  <button
                    type="button"
                    onClick={() => {
                      exportCsv();
                      setOpenToolbarMenu(null);
                    }}
                    disabled={!filteredEntries.length || !canExport}
                    title={exportPermissionTitle}
                    className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                  >
                    <Download size={15} />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      exportPdf();
                      setOpenToolbarMenu(null);
                    }}
                    disabled={!filteredEntries.length || !canExport}
                    title={exportPermissionTitle}
                    className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                  >
                    <FileSpreadsheet size={15} />
                    PDF
                  </button>
                </div>
              )}
            </div>

            <div className="relative" data-transport-toolbar-menu="true">
              <button
                type="button"
                onClick={() => setOpenToolbarMenu((current) => current === 'more' ? null : 'more')}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-blue-300 hover:text-blue-600"
                aria-expanded={openToolbarMenu === 'more'}
              >
                <MoreHorizontal size={17} />
                Mais
                <ChevronDown size={14} className={`transition-transform ${openToolbarMenu === 'more' ? 'rotate-180' : ''}`} />
              </button>

              {openToolbarMenu === 'more' && (
                <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_42px_rgba(15,23,42,0.18)]">
                  <button
                    type="button"
                    onClick={() => {
                      exportBackup();
                      setOpenToolbarMenu(null);
                    }}
                    disabled={!entries.length || !canExport}
                    title={exportPermissionTitle}
                    className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                  >
                    <Download size={15} />
                    Backup
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAuditLog(true);
                      setOpenToolbarMenu(null);
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                  >
                    <FileSpreadsheet size={15} />
                    Histórico
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 xl:hidden">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="truncate text-[10px] font-black uppercase tracking-widest text-blue-600">{importMessage}</p>
                {undoSnapshot && (
                  <button
                    type="button"
                    onClick={undoLastChange}
                    className="h-6 shrink-0 rounded-full border border-blue-200 bg-white px-3 text-[9px] font-black uppercase tracking-widest text-blue-700 transition hover:border-blue-400 hover:bg-blue-50"
                  >
                    Desfazer
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="text-xl font-black uppercase tracking-tight text-slate-950">{money(supplierPanel.open)}</p>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">saldo em aberto</span>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <CompactMetric label="Lanc." value={filteredEntries.length.toLocaleString('pt-BR')} />
              <CompactMetric label="Forn." value={suppliers.toLocaleString('pt-BR')} />
              <CompactMetric label="Valor NF" value={money(totals.value)} />
              <CompactMetric label="Dívida" value={money(supplierPanel.debt)} />
              <CompactMetric label="Crédito" value={money(supplierPanel.credit)} tone="emerald" />
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

        {debtAlerts.length > 0 && (
          <div className={`mt-2 shrink-0 rounded-2xl border px-4 py-2 ${
            dangerAlerts.length > 0 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
          }`}>
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                  dangerAlerts.length > 0 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
                }`}>
                  <AlertTriangle size={17} />
                </span>
                <div className="min-w-0">
                  <p className={`text-[10px] font-black uppercase tracking-widest ${
                    dangerAlerts.length > 0 ? 'text-red-700' : 'text-amber-700'
                  }`}>
                    {debtAlerts.length} alerta{debtAlerts.length === 1 ? '' : 's'} no painel filtrado
                  </p>
                  <p className="truncate text-[11px] font-bold text-slate-600">
                    {effectiveShowOnlyAlerts ? 'Tabela exibindo somente lançamentos com alerta.' : 'Revise antes de exportar cobrança ou dar baixa em lote.'}
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowOnlyAlerts((current) => !current);
                    setSelectedEntryIds([]);
                  }}
                  className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                    effectiveShowOnlyAlerts
                      ? 'bg-slate-950 text-white hover:bg-slate-800'
                      : 'border border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700'
                  }`}
                >
                  {effectiveShowOnlyAlerts ? 'Mostrar todos' : 'Ver alertas'}
                </button>
                {debtAlerts.slice(0, 3).map((alert) => (
                  <div
                    key={alert.id}
                    className={`min-w-0 max-w-[280px] rounded-xl border bg-white px-3 py-2 ${
                      alert.severity === 'danger' ? 'border-red-200' : 'border-amber-200'
                    }`}
                  >
                    <p className={`truncate text-[9px] font-black uppercase tracking-widest ${
                      alert.severity === 'danger' ? 'text-red-600' : 'text-amber-600'
                    }`}>
                      {alert.title}
                    </p>
                    <p className="truncate text-[10px] font-bold text-slate-500">{alert.detail}</p>
                  </div>
                ))}
                {debtAlerts.length > 3 && (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    + {debtAlerts.length - 3}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-2 flex shrink-0 flex-wrap gap-2 xl:hidden">
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
            label="Mês"
            allLabel="Todos meses"
            selectedValues={monthFilters}
            onChange={setMonthFilters}
            options={monthOptions.map((month) => ({ value: month, label: month === NO_MONTH_VALUE ? 'Sem mês' : monthLabel(month) }))}
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
            allLabel="Dívida + crédito"
            selectedValues={natureFilters}
            onChange={setNatureFilters}
            options={[
              { value: 'divida', label: 'Dívida' },
              { value: 'credito', label: 'Crédito' },
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

          <MultiDropdownFilter
            label="Tipo"
            allLabel="Todos tipos"
            selectedValues={typeFilters}
            onChange={setTypeFilters}
            options={typeOptions.map((type) => ({ value: type, label: type }))}
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
              setTypeFilters([]);
              setShowOnlyAlerts(false);
            }}
            disabled={!searchTerm && supplierFilters.length === 0 && monthFilters.length === 0 && sheetFilters.length === 0 && natureFilters.length === 0 && statusFilters.length === 0 && typeFilters.length === 0 && !showOnlyAlerts}
            className="h-12 rounded-2xl border border-slate-200 px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:border-red-200 hover:text-red-500 disabled:opacity-40"
          >
            Limpar filtros
          </button>
        </div>

        {selectedEntryIds.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-700">
              {selectedEntryIds.length} lançamento{selectedEntryIds.length === 1 ? '' : 's'} selecionado{selectedEntryIds.length === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedEntryIds([])}
                className="h-9 rounded-xl border border-red-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-red-500 transition hover:border-red-300"
              >
                Cancelar seleção
              </button>
              <button
                type="button"
                onClick={() => setSelectedEntriesStatus('pago')}
                disabled={!canBulkEdit}
                title={bulkEditPermissionTitle}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-emerald-700 disabled:opacity-40"
              >
                <CheckCircle2 size={15} />
                Marcar pago
              </button>
              <button
                type="button"
                onClick={() => setSelectedEntriesStatus('aberto')}
                disabled={!canBulkEdit}
                title={bulkEditPermissionTitle}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-40"
              >
                <XCircle size={15} />
                Reabrir
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
                disabled={!canBulkEdit}
                title={bulkEditPermissionTitle}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:opacity-40"
              >
                <Pencil size={15} />
                Editar em massa
              </button>
              <button
                type="button"
                onClick={() => requestDeleteEntries(selectedEntryIds)}
                disabled={!canDeleteEntries}
                title={deletePermissionTitle}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-red-700 disabled:opacity-40"
              >
                <Trash2 size={15} />
                Excluir selecionados
              </button>
            </div>
          </div>
        )}

        <div className="mt-2 grid min-h-0 flex-1 gap-3 xl:grid-cols-[156px_minmax(0,1fr)_178px]">
          <aside className="hidden min-h-0 overflow-visible rounded-2xl border border-slate-200 bg-slate-50 p-2 xl:block">
            <div className="space-y-2">
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

              <MultiDropdownFilter
                label="Natureza"
                allLabel="Dívida + crédito"
                selectedValues={natureFilters}
                onChange={setNatureFilters}
                options={[
                  { value: 'divida', label: 'Dívida' },
                  { value: 'credito', label: 'Crédito' },
                ]}
              />

              <MultiDropdownFilter
                label="Tipo"
                allLabel="Todos tipos"
                selectedValues={typeFilters}
                onChange={setTypeFilters}
                options={typeOptions.map((type) => ({ value: type, label: type }))}
              />

              <MultiDropdownFilter
                label="Aba"
                allLabel="Todas as abas"
                selectedValues={sheetFilters}
                onChange={setSheetFilters}
                options={sheets.map((sheet) => ({ value: sheet, label: sheet }))}
              />

              <MultiDropdownFilter
                label="Mês"
                allLabel="Todos meses"
                selectedValues={monthFilters}
                onChange={setMonthFilters}
                options={monthOptions.map((month) => ({ value: month, label: month === NO_MONTH_VALUE ? 'Sem mês' : monthLabel(month) }))}
              />

              <MultiDropdownFilter
                label="Fornecedor"
                allLabel="Todos fornecedores"
                selectedValues={supplierFilters}
                onChange={setSupplierFilters}
                options={supplierOptions.map((supplier) => ({ value: supplier, label: supplier }))}
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
                  setTypeFilters([]);
                  setShowOnlyAlerts(false);
                }}
                disabled={!searchTerm && supplierFilters.length === 0 && monthFilters.length === 0 && sheetFilters.length === 0 && natureFilters.length === 0 && statusFilters.length === 0 && typeFilters.length === 0 && !showOnlyAlerts}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-black uppercase tracking-widest text-slate-500 transition hover:border-red-200 hover:text-red-500 disabled:opacity-40"
              >
                Limpar filtros
              </button>
            </div>

            <div className="mt-2 grid gap-2">
              <SideMetric label="Saldo" value={money(supplierPanel.open)} tone="amber" />
              <SideMetric label="Crédito" value={money(supplierPanel.credit)} tone="emerald" />
              <SideMetric label="Dívida" value={money(supplierPanel.debt)} />
              <SideMetric label="Valor NF" value={money(totals.value)} />
              <SideMetric label="Lanc." value={filteredEntries.length.toLocaleString('pt-BR')} />
              <SideMetric label="Forn." value={suppliers.toLocaleString('pt-BR')} />
            </div>
          </aside>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="hidden border-b border-slate-200 bg-white p-2 xl:block">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-black uppercase tracking-widest text-blue-600">{importMessage}</p>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <p className="text-xl font-black uppercase tracking-tight text-slate-950">{money(supplierPanel.open)}</p>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">saldo em aberto</span>
                  </div>
                </div>
                {undoSnapshot && (
                  <button
                    type="button"
                    onClick={undoLastChange}
                    className="h-8 shrink-0 rounded-xl border border-blue-200 bg-white px-3 text-[9px] font-black uppercase tracking-widest text-blue-700 transition hover:border-blue-400 hover:bg-blue-50"
                  >
                    Desfazer
                  </button>
                )}
                <label className="flex h-11 w-[360px] max-w-[40%] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4">
                  <Search size={17} className="text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Buscar fornecedor, nota, tipo ou aba..."
                    className="h-full min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-800 outline-none placeholder:text-slate-400"
                  />
                </label>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
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
                        aria-label="Selecionar lançamentos visíveis"
                      />
                    </th>
                    <th className="w-20 border-b border-slate-200 px-2 py-3 text-center">Mês</th>
                    <th className="border-b border-slate-200 px-2 py-3">Fornecedor</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3">Tipo</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3">Nota</th>
                    <th className="w-28 border-b border-slate-200 px-2 py-3 text-right">Valor NF</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3 text-right">Cobrança</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3">Natureza</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-3">Status</th>
                    <th className="w-16 border-b border-slate-200 px-2 py-3 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr
                      key={entry.id}
                      className={selectedEntryIds.includes(entry.id)
                        ? 'bg-blue-50'
                        : alertEntryIds.has(entry.id) ? 'bg-amber-50/70'
                          : entry.status === 'pago' ? 'bg-emerald-50/60' : 'bg-white'}
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
                      <td className="border-b border-slate-100 px-2 py-3 text-xs font-black uppercase text-slate-900" title={entry.supplier}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          {alertEntryIds.has(entry.id) && <AlertTriangle size={13} className="shrink-0 text-amber-500" />}
                          <span className="truncate">{entry.supplier}</span>
                        </div>
                      </td>
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
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${entry.status === 'pago' ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-700'}`}
                            title={entry.status === 'pago' ? `Baixado em ${shortDateTimeLabel(entry.paidAt)}` : 'Em aberto'}
                          >
                            {entry.status}
                          </span>
                          {entry.status === 'pago' && entry.paidAt && (
                            <span className="text-[9px] font-black uppercase tracking-wide text-emerald-700">
                              {shortDateTimeLabel(entry.paidAt)}
                            </span>
                          )}
                        </div>
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
                              disabled={!canBulkEdit}
                              title={bulkEditPermissionTitle}
                              onClick={() => {
                                setOpenActionMenuId(null);
                                openEditEntry(entry);
                              }}
                            />
                            <ActionMenuButton
                              icon={entry.status === 'pago' ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
                              label={entry.status === 'pago' ? 'Reabrir' : 'Marcar pago'}
                              disabled={!canBulkEdit}
                              title={bulkEditPermissionTitle}
                              onClick={() => {
                                setOpenActionMenuId(null);
                                setEntryStatus(entry.id, entry.status === 'pago' ? 'aberto' : 'pago');
                              }}
                            />
                            <ActionMenuButton
                              danger
                              icon={<Trash2 size={15} />}
                              label="Excluir"
                              disabled={!canDeleteEntries}
                              title={deletePermissionTitle}
                              onClick={() => {
                                setOpenActionMenuId(null);
                                requestDeleteEntries([entry.id]);
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
                        Nenhum lançamento encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <div className="hidden space-y-2 xl:block">
              <div className="relative" data-transport-toolbar-menu="true">
                <button
                  type="button"
                  onClick={() => setOpenToolbarMenu((current) => current === 'create' ? null : 'create')}
                  className="inline-flex h-11 w-full items-center justify-between gap-2 rounded-2xl bg-blue-600 px-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700"
                  aria-expanded={openToolbarMenu === 'create'}
                >
                  <span className="inline-flex items-center gap-2"><Plus size={16} />Lançamento</span>
                  <ChevronDown size={14} className={`transition-transform ${openToolbarMenu === 'create' ? 'rotate-180' : ''}`} />
                </button>

                {openToolbarMenu === 'create' && (
                  <div className="mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
                    <button
                      type="button"
                      onClick={() => {
                        openNewManualForm();
                        setOpenToolbarMenu(null);
                      }}
                      className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      <Plus size={15} />
                      Unico
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowBulkForm((current) => !current);
                        setShowManualForm(false);
                        setShowBulkEditForm(false);
                        setManualError('');
                        setOpenToolbarMenu(null);
                      }}
                      className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      <FileSpreadsheet size={15} />
                      Em massa
                    </button>
                  </div>
                )}
              </div>

              <div className="relative" data-transport-toolbar-menu="true">
                <button
                type="button"
                onClick={() => setOpenToolbarMenu((current) => current === 'export' ? null : 'export')}
                  disabled={!filteredEntries.length || !canExport}
                  title={exportPermissionTitle}
                  className="inline-flex h-11 w-full items-center justify-between gap-2 rounded-2xl bg-slate-950 px-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:opacity-40"
                  aria-expanded={openToolbarMenu === 'export'}
                >
                  <span className="inline-flex items-center gap-2"><Download size={16} />Exportar</span>
                  <ChevronDown size={14} className={`transition-transform ${openToolbarMenu === 'export' ? 'rotate-180' : ''}`} />
                </button>

                {openToolbarMenu === 'export' && (
                  <div className="mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
                    <button
                      type="button"
                      onClick={() => {
                        exportCsv();
                        setOpenToolbarMenu(null);
                      }}
                      disabled={!filteredEntries.length || !canExport}
                      title={exportPermissionTitle}
                      className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                    >
                      <Download size={15} />
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        exportPdf();
                        setOpenToolbarMenu(null);
                      }}
                      disabled={!filteredEntries.length || !canExport}
                      title={exportPermissionTitle}
                      className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                    >
                      <FileSpreadsheet size={15} />
                      PDF
                    </button>
                  </div>
                )}
              </div>

              <div className="relative" data-transport-toolbar-menu="true">
                <button
                type="button"
                onClick={() => setOpenToolbarMenu((current) => current === 'import' ? null : 'import')}
                  disabled={importing || !canImport}
                  title={importPermissionTitle}
                  className="inline-flex h-11 w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
                  aria-expanded={openToolbarMenu === 'import'}
                >
                  <span className="inline-flex items-center gap-2"><Upload size={16} />{importing ? 'Importando' : 'Importar'}</span>
                  <ChevronDown size={14} className={`transition-transform ${openToolbarMenu === 'import' ? 'rotate-180' : ''}`} />
                </button>

                {openToolbarMenu === 'import' && (
                  <div className="mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
                    <button
                      type="button"
                      onClick={() => {
                        fileInputRef.current?.click();
                        setOpenToolbarMenu(null);
                      }}
                      disabled={!canImport}
                      title={importPermissionTitle}
                      className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                    >
                      <Upload size={15} />
                      XLSX
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        backupInputRef.current?.click();
                        setOpenToolbarMenu(null);
                      }}
                      disabled={!canImport}
                      title={importPermissionTitle}
                      className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                    >
                      <Upload size={15} />
                      Restaurar backup
                    </button>
                  </div>
                )}
              </div>

              <div className="relative" data-transport-toolbar-menu="true">
                <button
                  type="button"
                  onClick={() => setOpenToolbarMenu((current) => current === 'more' ? null : 'more')}
                  className="inline-flex h-11 w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-blue-300 hover:text-blue-600"
                  aria-expanded={openToolbarMenu === 'more'}
                >
                  <span className="inline-flex items-center gap-2"><MoreHorizontal size={17} />Mais</span>
                  <ChevronDown size={14} className={`transition-transform ${openToolbarMenu === 'more' ? 'rotate-180' : ''}`} />
                </button>

                {openToolbarMenu === 'more' && (
                  <div className="mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
                    <button
                      type="button"
                      onClick={() => {
                        exportBackup();
                        setOpenToolbarMenu(null);
                      }}
                      disabled={!entries.length || !canExport}
                      title={exportPermissionTitle}
                      className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                    >
                      <Download size={15} />
                      Backup
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAuditLog(true);
                        setOpenToolbarMenu(null);
                      }}
                      className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      <FileSpreadsheet size={15} />
                      Histórico
                    </button>
                  </div>
                )}
              </div>
            </div>

            <p className="mt-3 shrink-0 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 xl:mt-4">Maiores saldos</p>
            <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
              {topSuppliers.map((supplier, index) => (
                <button
                  key={supplier.supplier}
                  type="button"
                  onClick={() => {
                    setSupplierFilters((current) => current.includes(supplier.supplier) ? [] : [supplier.supplier]);
                    setSelectedEntryIds([]);
                    setShowOnlyAlerts(false);
                  }}
                  className={`w-full rounded-xl border p-2.5 text-left transition hover:border-blue-300 hover:bg-blue-50 ${
                    supplierFilters.includes(supplier.supplier) ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white'
                  }`}
                  title={`Filtrar ${supplier.supplier}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-black text-slate-400">#{index + 1}</span>
                    <span className="text-xs font-black text-blue-700">{money(supplier.fee)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs font-black uppercase text-slate-900">{supplier.supplier}</p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {supplier.rows} notas - clicar para filtrar
                  </p>
                </button>
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

      {showAuditLog && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={() => setShowAuditLog(false)}
        >
          <div
            className="w-full max-w-[620px] overflow-hidden rounded-[8px] border border-slate-300 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.24)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-10 items-center justify-between border-b border-slate-300 bg-slate-100 px-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-900">Histórico do transporte</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{auditLog.length} eventos recentes</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAuditLog(false)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
                aria-label="Fechar historico"
              >
                <XCircle size={15} />
              </button>
            </div>

            <div className="max-h-[460px] overflow-auto p-3">
              {auditLog.map((event) => (
                <div key={event.id} className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-3 last:mb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black uppercase text-slate-950">{event.action}</p>
                      <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">{event.detail}</p>
                    </div>
                    <p className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {new Date(event.at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {typeof event.count === 'number' && <CompactMetric label="Lanc." value={event.count.toLocaleString('pt-BR')} />}
                    {typeof event.amount === 'number' && <CompactMetric label="Cobrança" value={money(event.amount)} tone="blue" />}
                  </div>
                </div>
              ))}
              {!auditLog.length && (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">Nenhum evento registrado ainda.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingImport && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={() => setPendingImport(null)}
        >
          <div
            className="w-full max-w-[560px] overflow-hidden rounded-[8px] border border-blue-200 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.24)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-10 items-center justify-between border-b border-blue-100 bg-blue-50 px-3">
              <p className="text-xs font-black uppercase tracking-widest text-blue-700">Conferir importação</p>
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-blue-100 bg-white text-blue-400 transition hover:border-blue-200 hover:text-blue-600"
                aria-label="Cancelar importação"
              >
                <XCircle size={15} />
              </button>
            </div>

            <div className="p-3">
              <p className="truncate text-sm font-black text-slate-950">{pendingImport.fileName}</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">
                Confirmar vai substituir os {entries.length.toLocaleString('pt-BR')} lançamentos atuais por este arquivo.
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <CompactMetric label="Novos" value={pendingImport.entries.length.toLocaleString('pt-BR')} />
                <CompactMetric label="Atual" value={entries.length.toLocaleString('pt-BR')} />
                <CompactMetric label="Valor NF" value={money(pendingImportTotals.value)} />
                <CompactMetric label="Cobrança" value={money(pendingImportTotals.fee)} tone="blue" />
              </div>

              <div className="mt-3 max-h-40 overflow-auto rounded-md border border-slate-200 bg-slate-50">
                {pendingImport.entries.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-200 px-3 py-2 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black uppercase text-slate-900">{entry.supplier}</p>
                      <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {entry.sheet} - {entry.invoice} - {entry.category || 'Sem tipo'}
                      </p>
                    </div>
                    <p className="text-right text-[11px] font-black text-blue-700">{money(entry.fee)}</p>
                  </div>
                ))}
                {pendingImport.entries.length > 6 && (
                  <p className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    + {pendingImport.entries.length - 6} lançamentos ocultos
                  </p>
                )}
                {!pendingImport.entries.length && (
                  <p className="px-3 py-8 text-center text-[10px] font-black uppercase tracking-widest text-red-500">
                    Nenhum lançamento encontrado nessa planilha.
                  </p>
                )}
              </div>

              <div className="mt-3 flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setPendingImport(null)}
                  className="h-9 rounded-md border border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={!pendingImport.entries.length || !canImport}
                  title={importPermissionTitle}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:opacity-40"
                >
                  <Upload size={15} />
                  Substituir controle
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteIds.length > 0 && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={() => setPendingDeleteIds([])}
        >
          <div
            className="w-full max-w-[520px] overflow-hidden rounded-[8px] border border-red-200 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.24)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-10 items-center justify-between border-b border-red-100 bg-red-50 px-3">
              <p className="text-xs font-black uppercase tracking-widest text-red-700">Confirmar exclusao</p>
              <button
                type="button"
                onClick={() => setPendingDeleteIds([])}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-red-100 bg-white text-red-400 transition hover:border-red-200 hover:text-red-600"
                aria-label="Cancelar exclusao"
              >
                <XCircle size={15} />
              </button>
            </div>

            <div className="p-3">
              <p className="text-sm font-black text-slate-950">
                Excluir {pendingDeleteIds.length} lançamento{pendingDeleteIds.length === 1 ? '' : 's'}?
              </p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">
                Essa acao remove os registros do controle salvo neste navegador. Confira o resumo antes de confirmar.
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <CompactMetric label="Lanc." value={pendingDeleteIds.length.toLocaleString('pt-BR')} />
                <CompactMetric label="Valor NF" value={money(pendingDeleteTotals.value)} />
                <CompactMetric label="Cobrança" value={money(pendingDeleteTotals.fee)} tone="amber" />
              </div>

              <div className="mt-3 max-h-36 overflow-auto rounded-md border border-slate-200 bg-slate-50">
                {pendingDeleteEntries.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-200 px-3 py-2 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black uppercase text-slate-900">{entry.supplier}</p>
                      <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {shortMonthLabel(entry.debtMonth)} - {entry.invoice} - {entry.category || 'Sem tipo'}
                      </p>
                    </div>
                    <p className="text-right text-[11px] font-black text-red-600">{money(entry.fee)}</p>
                  </div>
                ))}
                {pendingDeleteEntries.length > 6 && (
                  <p className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    + {pendingDeleteEntries.length - 6} lançamentos ocultos
                  </p>
                )}
              </div>

              <div className="mt-3 flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setPendingDeleteIds([])}
                  className="h-9 rounded-md border border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteEntries}
                  disabled={!canDeleteEntries}
                  title={deletePermissionTitle}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-red-600 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-red-700 disabled:opacity-40"
                >
                  <Trash2 size={15} />
                  Excluir definitivamente
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBulkEditForm && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={closeBulkEditForm}
        >
          <form
            className="w-full max-w-4xl overflow-visible rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              applyBulkEdit();
            }}
          >
            <div className="flex items-center justify-between border-b-2 border-slate-100 px-5 py-4">
              <div>
                <p className="text-xl font-black uppercase italic tracking-tighter text-slate-900">Editar em massa</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Alteracoes em lote</p>
              </div>
              <button
                type="button"
                onClick={closeBulkEditForm}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                aria-label="Fechar edição em massa"
              >
                <XCircle size={15} />
              </button>
            </div>

            <div className="px-5 py-4">
              <p className="mb-3 text-[11px] font-bold text-slate-500">
                Marque somente os campos que deseja aplicar em {selectedEntryIds.length} lançamento{selectedEntryIds.length === 1 ? '' : 's'}.
              </p>

              {manualError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                  {manualError}
                </div>
              )}

              <div className="space-y-2">
                <BulkEditRow
                  checked={bulkEditForm.updateMonth}
                  label="Mês"
                  onCheckedChange={(checked) => updateBulkEditForm('updateMonth', checked)}
                >
                  <MonthInput
                    label="Mês"
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
                    <option value="divida">Dívida</option>
                    <option value="credito">Crédito</option>
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

              <div className="mt-4 flex justify-end gap-3 border-t-2 border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={closeBulkEditForm}
                  className="h-12 min-w-[160px] rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canBulkEdit}
                  title={bulkEditPermissionTitle}
                  className="h-12 min-w-[220px] rounded-2xl bg-blue-600 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:opacity-40"
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
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={() => {
            closeManualForm();
          }}
        >
          <form
            className="w-full max-w-4xl overflow-visible rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              addManualEntry();
            }}
          >
            <div className="flex items-center justify-between border-b-2 border-slate-100 px-5 py-4">
              <div>
                <p className="text-xl font-black uppercase italic tracking-tighter text-slate-900">{editingEntryId ? 'Editar lançamento' : 'Lançamento manual'}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Controle financeiro de transporte</p>
              </div>
              <button
                type="button"
                onClick={closeManualForm}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                aria-label="Fechar lançamento manual"
              >
                <XCircle size={15} />
              </button>
            </div>

            <div className="px-5 py-4">
              <p className="mb-3 text-[11px] font-bold text-slate-500">
                {editingEntryId ? 'Ajuste os dados do lançamento selecionado.' : 'Cadastre uma dívida ou crédito sem depender da importação da planilha.'}
              </p>

              {manualError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                  {manualError}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MonthInput
                  label="Mês"
                  value={manualForm.debtMonth}
                  onChange={(value) => updateManualForm('debtMonth', value)}
                />
                <SelectFilter value={manualForm.chargeMode} compact onChange={(value) => updateManualForm('chargeMode', value as ChargeMode)}>
                  <option value="auto_fee">3,5% da NF</option>
                  <option value="fixed_value">Valor informado</option>
                  <option value="previous_balance">Saldo anterior</option>
                </SelectFilter>
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
                  label={manualForm.chargeMode === 'auto_fee' ? 'Nota' : 'Referência'}
                  value={manualForm.invoice}
                  onChange={(value) => updateManualForm('invoice', value)}
                  placeholder={manualForm.chargeMode === 'previous_balance' ? 'Saldo anterior' : 'Número'}
                />
                <ManualInput
                  label={manualForm.chargeMode === 'auto_fee' ? 'Valor NF' : 'Valor base'}
                  value={manualForm.value}
                  onChange={(value) => updateManualForm('value', value)}
                  placeholder={manualForm.chargeMode === 'auto_fee' ? '0,00' : 'Opcional'}
                />
                <ManualInput
                  label="Cobrança"
                  value={manualForm.fee}
                  onChange={(value) => updateManualForm('fee', value)}
                  placeholder={manualForm.chargeMode === 'auto_fee' ? 'Auto' : 'Valor'}
                />
                <SelectFilter value={manualForm.nature} compact onChange={(value) => updateManualForm('nature', value as DebtNature)}>
                  <option value="divida">Dívida</option>
                  <option value="credito">Crédito</option>
                </SelectFilter>
                <div className="sm:col-span-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] font-bold text-blue-700">
                  {manualForm.chargeMode === 'auto_fee'
                    ? 'Deixe cobrança vazia para calcular 3,5% automaticamente.'
                    : 'Use cobrança para informar um valor fixo ou o saldo restante de outro mês.'}
                </div>
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

              <div className="mt-4 flex justify-end gap-3 border-t-2 border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={closeManualForm}
                  className="h-12 min-w-[160px] rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="h-12 min-w-[220px] rounded-2xl bg-blue-600 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-700"
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
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm"
          onMouseDown={() => {
            setShowBulkForm(false);
            setManualError('');
            setBulkPasteText('');
          }}
        >
          <form
            className="w-full max-w-4xl overflow-visible rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              addBulkEntries();
            }}
          >
            <div className="flex items-center justify-between border-b-2 border-slate-100 px-5 py-4">
              <div>
                <p className="text-xl font-black uppercase italic tracking-tighter text-slate-900">Lançamento em massa</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Colagem de planilha</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowBulkForm(false);
                  setManualError('');
                  setBulkPasteText('');
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                aria-label="Fechar lançamento em massa"
              >
                <XCircle size={15} />
              </button>
            </div>

            <div className="px-5 py-4">
              <p className="text-[11px] font-bold text-slate-500">
                Cole linhas do Excel com fornecedor, tipo, nota e valor NF. A quinta coluna pode ser um valor de cobrança; se não vier, o sistema calcula 3,5%.
              </p>

              <div className="mt-3 max-w-[240px]">
                <MonthInput
                  label="Mês"
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
                onChange={(event) => {
                  setBulkPasteText(event.target.value);
                  setManualError('');
                }}
                placeholder={`ARMAZEM MATEUS S A - CD SANTA ISABEL\tSOFYTS\t5.238.196\tR$ 1.683,61`}
                className="mt-3 h-44 w-full resize-none rounded-2xl border-2 border-slate-100 bg-slate-50 p-3 font-mono text-[11px] font-bold text-slate-700 outline-none placeholder:text-slate-300 focus:border-blue-600"
              />

              {bulkPasteText.trim() ? (
                <div className={`mt-3 rounded-md border px-3 py-2 ${bulkPreview.issues.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Validas</p>
                      <p className="text-sm font-black text-slate-950">{bulkPreview.entries.length}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Erros</p>
                      <p className={`text-sm font-black ${bulkPreview.issues.length ? 'text-amber-700' : 'text-emerald-700'}`}>{bulkPreview.issues.length}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Valor NF</p>
                      <p className="text-sm font-black text-slate-950">{money(bulkPreviewTotals.value)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cobrança</p>
                      <p className="text-sm font-black text-blue-700">{money(bulkPreviewTotals.fee)}</p>
                    </div>
                  </div>

                  {bulkPreview.issues.length > 0 ? (
                    <div className="mt-2 max-h-24 overflow-auto rounded-md border border-amber-200 bg-white/70">
                      {bulkPreview.issues.slice(0, 6).map((issue) => (
                        <div key={`${issue.line}-${issue.message}`} className="border-b border-amber-100 px-2 py-1 last:border-b-0">
                          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Linha {issue.line}: {issue.message}</p>
                          <p className="truncate text-[10px] font-bold text-slate-500">{issue.raw}</p>
                        </div>
                      ))}
                      {bulkPreview.issues.length > 6 && (
                        <p className="px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                          + {bulkPreview.issues.length - 6} erros ocultos
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                      Conferência pronta. Sem quinta coluna, a cobrança será calculada em 3,5% do valor NF.
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  A quinta coluna pode ser um valor de cobrança fixo, mas não é obrigatória.
                </div>
              )}

              <div className="mt-4 flex justify-end gap-3 border-t-2 border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowBulkForm(false);
                    setManualError('');
                    setBulkPasteText('');
                  }}
                  className="h-12 min-w-[160px] rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!bulkPasteText.trim() || !bulkPreview.entries.length || bulkPreview.issues.length > 0}
                  className="h-12 min-w-[220px] rounded-2xl bg-blue-600 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:opacity-40"
                >
                  {bulkPreview.entries.length && !bulkPreview.issues.length ? 'Confirmar importação' : 'Adicionar em massa'}
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

function SideMetric({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'amber' | 'emerald' }) {
  const toneClass = {
    slate: 'text-slate-950',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 truncate text-sm font-black ${toneClass}`}>{value}</p>
    </div>
  );
}

function ActionMenuButton({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  title,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-9 w-full items-center gap-2 px-3 text-[11px] font-black uppercase tracking-widest transition ${
        danger
          ? 'text-red-500 hover:bg-red-50'
          : 'text-slate-600 hover:bg-slate-100 hover:text-blue-600'
      } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
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
            : 'border-slate-100 text-slate-700 shadow-sm hover:border-blue-200'
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
          <div className="absolute left-0 top-full z-[90] mt-2 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
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
        className={`${compact ? 'h-9 rounded-md border-slate-300 bg-white px-2' : 'h-12 rounded-2xl border-2 border-slate-100 bg-white px-4 shadow-sm'} flex w-full items-center justify-between gap-3 border text-left text-[10px] font-black uppercase tracking-wide text-slate-700 transition-all hover:border-blue-300 ${open ? 'border-blue-500 text-blue-700 ring-2 ring-blue-100' : ''}`}
      >
        <span className="truncate">{selected?.label || 'Selecionar'}</span>
        <ChevronDown size={15} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
          <div className={`${compact ? 'rounded-md border-slate-300' : 'rounded-2xl border-slate-200 shadow-2xl'} absolute left-0 right-0 top-full z-[90] mt-2 max-h-72 overflow-y-auto border bg-white p-2`}>
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
