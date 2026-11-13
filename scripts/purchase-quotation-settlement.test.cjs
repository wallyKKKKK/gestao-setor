const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

const compiled = ts.transpileModule(fs.readFileSync('lib/purchase-quotation-settlement.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exportsByFile = {};
vm.runInNewContext(compiled, { exports: exportsByFile });
const { assessQuotation, emptySettlement, groupQuotationOrderByBranch, normalizeSettlement } = exportsByFile;

const item = { id: '1', code: '123', ean: '0000123', description: 'Produto', quantity: 5 };
const branch = { itemId: '1', branchCnpj: '0001', quantity: 2, a7Reference: 1234, cost: { unitCost: 4 } };
const round = { supplier_items: [item], buyer_items: [branch, { ...branch, branchCnpj: '0002', quantity: 3 }] };
function invite(id, price, options = {}) {
  const { available = 9, multiple = 1, minimum = 0, paymentDays = 30, deliveryDays = 4 } = options;
  return {
    supplier_id: id, supplier_name: id, minimum_order: minimum, submitted_at: '2026-11-10', revoked_at: null,
    proposal: { paymentDays, deliveryDays, offers: [{ itemId: '1', unitPrice: price, available, multiple }] },
  };
}
const decision = (value, minimumApprovals = {}) => ({ items: { '1': value }, minimumApprovals });
const clone = value => JSON.parse(JSON.stringify(value));

test('closed orders group stores by CNPJ without changing original lines or totals', () => {
  const order = { lines: [
    { itemId: 'first', branchCnpj: '01.234.567/0001-89', totalCents: 199 },
    { itemId: 'second', branchCnpj: '01234567000189', totalCents: 302 },
    { itemId: 'third', branchCnpj: '01234567000260', totalCents: 410 },
  ] };
  const original = clone(order);
  const groups = clone(groupQuotationOrderByBranch(order, new Map([['01234567000189', 'Castanhal II']])));
  assert.deepEqual(groups.map(({ name, totalCents, lines }) => [name, totalCents, lines.length]), [
    ['01234567000260', 410, 1], ['Castanhal II', 501, 2],
  ]);
  assert.deepEqual(order, original);
});

test('orders show supplier, representative, store subtotal and only approved lines', () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/components/purchase-quotation-settlement.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('exports', 'require', source)(exports, name => {
    if (name === '@/lib/purchase-quotation-settlement') return exportsByFile;
    if (name === '@/lib/auth-headers') return {};
    if (name === '@/app/components/table-sort') return { useColumnSort: () => ({ sortRows: rows => rows }), SortableTableHeader: ({ children }) => createElement('th', null, children) };
    return require(name);
  });
  const order = { supplierId: 's1', supplierName: 'Fornecedor A', totalCents: 3250, paymentDays: 30, deliveryDays: 5, lines: [
    { itemId: 'one', description: 'Item aprovado', branchCnpj: '01234567000189', originalQuantity: 2, quantity: 2, unitPrice: 10, totalCents: 2000 },
    { itemId: 'two', description: 'Outro item', branchCnpj: '01234567000260', originalQuantity: 1, quantity: 1, unitPrice: 12.5, totalCents: 1250 },
  ] };
  const html = renderToStaticMarkup(createElement(exports.QuotationOrdersList, { orders: [order], labels: {
    contacts: [{ id: 's1', contact: 'Maria' }], branches: [{ cnpj: '01.234.567/0001-89', name: 'Castanhal II' }],
  }, onDownload() {} }));
  assert.match(html, /Fornecedor A.*Total do pedido: R\$\s*32,50.*Representante: Maria/);
  assert.match(html, /Castanhal II.*Sem retorno de faturamento.*R\$\s*20,00.*Item aprovado/);
  assert.match(html, /Loja 01234567000260.*R\$\s*12,50.*Outro item/);
  assert.equal((html.match(/Baixar pedido da loja/g) || []).length, 2);
});

test('ignores unavailable quantities and multiples and breaks ties by payment, then delivery', () => {
  const suppliers = [invite('low-stock', 1, { available: 4 }), invite('pack', 2, { multiple: 2 }),
    invite('short-payment', 5), invite('slow', 5, { paymentDays: 45 }), invite('fast', 5, { paymentDays: 45, deliveryDays: 2 })];
  const result = assessQuotation(round, suppliers, emptySettlement);
  assert.equal(result.rows[0].winner.supplier.supplier_id, 'fast');
  assert.equal(result.rows[0].tag, 'Confirmar embalagem');
});

test('uses cost per package and binds authorization to the proposal being approved', () => {
  const suppliers = [invite('winner', 9)];
  const result = assessQuotation(round, suppliers, decision({ unitsPerPackage: 2 }));
  assert.equal(result.rows[0].tag, 'Não comprar');
  assert.equal(result.rows[0].difference, 1);
  assert.equal(result.blockers.length, 1);
  const approved = decision({ unitsPerPackage: 2, approval: 'Risco de ruptura', approvalBasis: result.rows[0].approvalBasis });
  assert.equal(assessQuotation(round, suppliers, approved).blockers.length, 0);
  assert.equal(assessQuotation(round, [invite('new', 8.5)], approved).blockers.length, 1);
  assert.equal(assessQuotation(round, [invite('winner', 8)], decision({ unitsPerPackage: 2 })).rows[0].tag, 'Comprar');
});

test('preserves original quantities and invalidates minimum approval when the total changes', () => {
  const suppliers = [invite('winner', 2.005, { minimum: 20 }), invite('other', 2.5)];
  const adjust = { unitsPerPackage: 1, quantities: { '0002': 4 }, reason: 'Completar o pedido' };
  const result = assessQuotation(round, suppliers, decision(adjust));
  assert.equal(result.orders[0].totalCents, 1203);
  assert.equal(result.minimums[0].shortfallCents, 797);
  assert.equal(result.minimums[0].alternatives[0].deltaCents, 297);
  assert.deepEqual(clone(result.orders[0].lines.map(line => [line.originalQuantity, line.quantity])), [[2, 2], [3, 4]]);
  const approved = { winner: { reason: 'Fornecedor liberou', totalCents: 1203 } };
  assert.equal(assessQuotation(round, suppliers, decision(adjust, approved)).blockers.length, 0);
  assert.equal(assessQuotation(round, suppliers, decision({ ...adjust, quantities: { '0002': 5 } }, approved)).blockers.length, 1);
});

test('rejects foreign IDs and validates ownership of adjusted quantities', () => {
  const suppliers = [invite('winner', 2)];
  assert.throws(() => normalizeSettlement(decision({ supplierId: 'other' }), round, suppliers), /Fornecedor/);
  assert.throws(() => normalizeSettlement(decision({ quantities: { 'other-store': 3 } }), round, suppliers), /lojas/);
  assert.throws(() => normalizeSettlement(decision({ quantities: { '0001': 1.5 } }), round, suppliers), /inteiras/);
  assert.throws(() => normalizeSettlement(decision({ unitsPerPackage: 0 }), round, suppliers), /embalagem/);
});
