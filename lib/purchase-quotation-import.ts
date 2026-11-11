export type QuotationRequestRow = {
  line: number;
  branchCnpj: string;
  ean: string;
  productCode: string;
  description: string;
  manufacturer: string;
  quantity: number;
  a7Reference: number;
};

export type QuotationCostRow = {
  line: number;
  branchCode: string;
  description: string;
  supplier: string;
  invoiceDate: string;
  unitCost: number;
};

export type QuotationDraft = {
  request?: { name: string; rows: QuotationRequestRow[] };
  costs?: { name: string; rows: QuotationCostRow[]; transfers: number; issues: string[] };
  links: Record<string, string>;
  chosenCosts: Record<string, number>;
};

export function normalizeQuotationDescription(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export function isQuotationTransfer(supplier: string) {
  const compact = normalizeQuotationDescription(supplier).replace(/&/g, 'E').replace(/[^A-Z0-9]/g, '').replace(/(?:LTDA|LIMITADA)(?:ME|EPP)?$/, '');
  return /^(?:CELIDONIOE?OLIVOFARMACIA|ROMARTINSPEREIRAE?(?:CIA|COMPANHIA))$/.test(compact);
}

function decimal(value: unknown) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim().replace(/^R\$\s*/, '');
  if (!/^(?:\d+(?:[.,]\d+)?|\d{1,3}(?:\.\d{3})+,\d+)$/.test(text)) return NaN;
  return Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
}

export function parseA7Quotation(buffer: ArrayBuffer) {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  const rows: QuotationRequestRow[] = [];
  let branch: { cnpj: string; count: number } | null = null;
  const fail = (line: number) => { throw new Error(`Linha ${line}: registro inválido ou fora de ordem no TXT de ida do A7 (layout 3.0).`); };
  for (const [index, raw] of text.split(/\r\n|\n|\r/).entries()) {
    if (!raw.trim()) continue;
    const fields = raw.split(';').map(field => field.trim());
    const [type, first, second] = fields;
    const line = index + 1;
    if (type === '1' && !branch && fields.length === 3 && /^\d{14}$/.test(first) && second === '3.0') {
      branch = { cnpj: first, count: 0 };
    } else if (type === '2' && branch && fields.length === 7) {
      const [, ean, amount, productCode, description, manufacturer, reference] = fields;
      const quantity = decimal(amount);
      const a7Reference = decimal(reference);
      if ((ean && !/^\d+$/.test(ean)) || !productCode || !description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(a7Reference) || a7Reference < 0) fail(line);
      rows.push({ line, branchCnpj: branch.cnpj, ean, productCode, description, manufacturer, quantity, a7Reference });
      branch.count++;
    } else if (type === '9' && branch && fields.length === 2 && /^\d+$/.test(first) && Number(first) === branch.count) {
      branch = null;
    } else {
      fail(line);
    }
  }
  if (branch || !rows.length) throw new Error('O TXT está vazio ou falta o rodapé de uma loja.');
  return rows;
}

function invoiceDate(value: unknown) {
  const text = String(value ?? '').trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const iso = br ? `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
}

export function parseQuotationCostRows(grid: unknown[][]) {
  const headers = [
    ['UN NEGOCIO', 'UNIDADE DE NEGOCIO', 'UN NEG'],
    ['PRODUTO', 'DESCRICAO DO PRODUTO'],
    ['CUSTO'],
    ['FORNECEDOR NF', 'FORNECEDOR'],
    ['DATA NF', 'DATA NOTA FISCAL'],
  ];
  const normalizeHeader = (value: unknown) => normalizeQuotationDescription(String(value ?? '')).replace(/[^A-Z0-9]/g, '');
  const mapColumns = (cells: unknown[]) => {
    const normalized = cells.map(normalizeHeader);
    return headers.map(aliases => normalized.findIndex(header => aliases.some(alias => normalizeHeader(alias) === header)));
  };
  const headerIndex = grid.findIndex(cells => mapColumns(cells).every(index => index >= 0));
  if (headerIndex < 0) throw new Error('A planilha precisa das colunas Un. Negócio, Produto, Custo, Fornecedor N.F. e Data N.F.');
  const columns = mapColumns(grid[headerIndex]);
  const rows: QuotationCostRow[] = [];
  const issues: string[] = [];
  let transfers = 0;
  for (let index = headerIndex + 1; index < grid.length; index++) {
    const cells = grid[index];
    const [branch, product, cost, vendor, date] = columns.map(column => cells[column]);
    if ([branch, product, cost, vendor, date].every(value => !String(value ?? '').trim())) continue;
    const supplier = String(vendor ?? '').trim();
    if (isQuotationTransfer(supplier)) { transfers++; continue; }
    const branchCode = String(branch ?? '').trim().replace(/^\d$/, digit => `0${digit}`);
    const description = String(product ?? '').trim();
    const unitCost = decimal(cost);
    const dateIso = invoiceDate(date);
    if (!branchCode || !description || !supplier || !dateIso || !Number.isFinite(unitCost) || unitCost <= 0) {
      issues.push(`Linha ${index + 1}: loja, produto, fornecedor, custo ou data da NF inválidos.`);
      continue;
    }
    rows.push({ line: index + 1, branchCode, description, supplier, invoiceDate: dateIso, unitCost });
  }
  return { rows, transfers, issues };
}

export function reviewQuotation(draft: QuotationDraft) {
  const requestRows = draft.request?.rows ?? [];
  const products = new Map<string, string>();
  const codesByDescription = new Map<string, Set<string>>();
  const requestCounts = new Map<string, number>();
  const keyOf = (row: QuotationRequestRow) => JSON.stringify([row.branchCnpj, row.productCode, row.ean]);
  for (const row of requestRows) {
    products.set(row.productCode, row.description);
    const description = normalizeQuotationDescription(row.description);
    const codes = codesByDescription.get(description) ?? new Set<string>();
    codes.add(row.productCode);
    codesByDescription.set(description, codes);
    const key = keyOf(row);
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  }
  const costsByDescription = new Map<string, QuotationCostRow[]>();
  for (const row of draft.costs?.rows ?? []) {
    const description = normalizeQuotationDescription(row.description);
    const rows = costsByDescription.get(description) ?? [];
    rows.push(row);
    costsByDescription.set(description, rows);
  }
  const costsByCode = new Map<string, QuotationCostRow[]>();
  const links = Array.from(costsByDescription, ([key, rows]) => {
    const matches = codesByDescription.get(key);
    const selected = draft.links[key];
    const code = products.has(selected) ? selected : matches?.size === 1 ? Array.from(matches)[0] : '';
    if (code) costsByCode.set(code, (costsByCode.get(code) ?? []).concat(rows));
    return { key, description: rows[0].description, code, ambiguous: (matches?.size ?? 0) > 1 };
  });
  const references = new Map(Array.from(products.keys(), code => {
    const costs = costsByCode.get(code) ?? [];
    const latest = costs.reduce((date, row) => row.invoiceDate > date ? row.invoiceDate : date, '');
    const candidates = costs.filter(row => row.invoiceDate === latest);
    const conflict = new Set(candidates.map(row => row.unitCost)).size > 1;
    const selected = candidates.find(row => row.line === draft.chosenCosts[code]);
    return [code, { candidates, cost: selected ?? (!conflict ? candidates[0] : undefined) }] as const;
  }));
  return {
    products,
    links,
    references,
    rows: requestRows.map(row => ({ ...row, duplicate: (requestCounts.get(keyOf(row)) ?? 0) > 1, ...references.get(row.productCode)! })),
  };
}

export function findQuotationCostLinks(links: ReturnType<typeof reviewQuotation>['links'], query: string) {
  const search = normalizeQuotationDescription(query);
  return links.filter(link => search ? link.key.includes(search) : Boolean(link.code));
}
