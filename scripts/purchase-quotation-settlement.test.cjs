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
const { assessQuotation, emptySettlement, normalizeSettlement } = exportsByFile;

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
