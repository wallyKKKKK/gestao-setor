const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const xlsx = require('xlsx');

const imports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/purchase-quotation-import.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: imports, TextDecoder });
const { findQuotationCostLinks, isQuotationTransfer, parseA7Quotation, parseQuotationCostRows, reviewQuotation } = imports;

const bytes = value => new TextEncoder().encode(value).buffer;
const headers = ['Un. Negócio', 'Produto', 'Custo', 'Fornecedor N.F.', 'Data N.F.'];
const row = (overrides = {}) => ({ line: 2, branchCnpj: '00000000000001', ean: '00012345', productCode: '00123', description: 'Sabonete 85 G', manufacturer: 'Fab', quantity: 2, a7Reference: 8.5, ...overrides });
const makeDraft = (rows, costs, overrides = {}) => ({ request: { name: 'cotac.txt', rows }, costs: { name: 'custos.xlsx', ...costs }, links: {}, chosenCosts: {}, ...overrides });

test('A7 parser preserves store, identifiers and reference and validates block counts', () => {
  const item = '2;00012345;2;00123;SABONETE 85 G;FAB;8.50';
  const data = `1;00000000000001;3.0\r\n${item}\r\n9;1\r\n1;00000000000002;3.0\r\n${item}\r\n9;1\r\n`;
  const rows = parseA7Quotation(bytes(data));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ean, '00012345');
  assert.equal(rows[0].productCode, '00123');
  assert.equal(rows[0].a7Reference, 8.5);
  assert.notEqual(rows[0].branchCnpj, rows[1].branchCnpj);
  assert.throws(() => parseA7Quotation(bytes(data.replace('9;1', '9;2'))), /Linha 3/);
  assert.throws(() => parseA7Quotation(bytes(' ')), /vazio/);
  const latin1 = Buffer.from(data.replace('FAB', 'FÁBRICA'), 'latin1');
  assert.equal(parseA7Quotation(latin1)[0].manufacturer, 'FÁBRICA');
});

test('internal transfers are excluded before the newest cost is picked across stores', () => {
  for (const name of ['Celidônio & Olivo Farmácia Ltda.', 'CELIDONIO OLIVO FARMACIA', 'R.O. Martins Pereira & Cia Ltda.', 'RO MARTINS PEREIRA E COMPANHIA LIMITADA']) {
    assert.equal(isQuotationTransfer(name), true);
  }
  assert.equal(isQuotationTransfer('DISTRIBUIDORA CELIDONIO E OLIVO FARMACIA LTDA'), false);
  const costs = parseQuotationCostRows([headers,
    ['01', 'SABONETE 85 G', '5,10', 'FORNECEDOR A', '01/11/2026'],
    ['02', 'SABONETE 85 G', '6.25', 'FORNECEDOR B', '04/11/2026'],
    ['03', 'SABONETE 85 G', '12,00', 'R. O. MARTINS PEREIRA & CIA LTDA', '09/11/2026'],
    ['03', 'SABONETE 85 G', '1,00', 'FORNECEDOR C', '31/11/2026'],
  ]);
  assert.equal(costs.transfers, 1);
  assert.equal(costs.issues.length, 1);
  const review = reviewQuotation(makeDraft([row(), row({ branchCnpj: '00000000000002', line: 5 })], costs));
  assert.equal(review.rows[0].cost.unitCost, 6.25);
  assert.equal(review.rows[1].cost.branchCode, '02');
  assert.equal(review.rows[1].duplicate, false);
});

test('does not guess ambiguous links or divergent costs on the same date', () => {
  const rows = [row(), row({ line: 3, productCode: '00124' }), row({ line: 4 }), row({ line: 5, productCode: '00125', description: 'Sabonete 170 G' })];
  const costs = parseQuotationCostRows([headers,
    ['01', 'SÁBONETE  85 G', 5, 'FORNECEDOR A', '05/11/2026'],
    ['02', 'SABONETE 85 G', 6, 'FORNECEDOR B', '05/11/2026'],
  ]);
  const draft = makeDraft(rows, costs);
  const initial = reviewQuotation(draft);
  assert.equal(initial.links[0].ambiguous, true);
  assert.equal(initial.rows[0].cost, undefined);
  assert.equal(initial.rows[0].duplicate, true);
  const linked = { ...draft, links: { 'SABONETE 85 G': '00123' } };
  assert.equal(reviewQuotation(linked).rows[0].candidates.length, 2);
  assert.equal(reviewQuotation(linked).rows[0].cost, undefined);
  const chosen = reviewQuotation({ ...linked, chosenCosts: { '00123': 3 } });
  assert.equal(chosen.rows[0].cost.unitCost, 6);
  assert.equal(chosen.rows[3].cost, undefined);
});

test('costs outside the quote stay hidden unless searched for manual linking', () => {
  const costs = parseQuotationCostRows([headers,
    ['01', 'SABONETE 85 G', 5, 'FORNECEDOR', '05/11/2026'],
    ['01', 'SHAMPOO 200 ML', 6, 'FORNECEDOR', '05/11/2026'],
  ]);
  const draft = makeDraft([row()], costs);
  const review = reviewQuotation(draft);
  assert.deepEqual(Array.from(findQuotationCostLinks(review.links, ''), link => link.description), ['SABONETE 85 G']);
  assert.deepEqual(Array.from(findQuotationCostLinks(review.links, 'shampôo'), link => link.description), ['SHAMPOO 200 ML']);
  const manual = reviewQuotation({ ...draft, links: { 'SHAMPOO 200 ML': '00123' } });
  assert.equal(findQuotationCostLinks(manual.links, '').length, 2);
});

test('real A7 and cost fixtures, when provided locally', { skip: !process.env.A7_QUOTE_FIXTURE || !process.env.A7_COST_FIXTURE }, () => {
  const request = parseA7Quotation(fs.readFileSync(process.env.A7_QUOTE_FIXTURE));
  assert.equal(request.length, 211);
  assert.equal(new Set(request.map(row => row.branchCnpj)).size, 19);
  assert.equal(new Set(request.map(row => row.productCode)).size, 84);
  const workbook = xlsx.read(fs.readFileSync(process.env.A7_COST_FIXTURE), { type: 'array', dateNF: 'dd/mm/yyyy' });
  const grid = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '', raw: false, dateNF: 'dd/mm/yyyy' });
  const costs = parseQuotationCostRows(grid);
  assert.equal(costs.rows.length, 19);
  const [latest] = [...costs.rows].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  assert.equal(latest.invoiceDate, '2026-11-05');
  assert.equal(latest.unitCost, 12.92);
});
