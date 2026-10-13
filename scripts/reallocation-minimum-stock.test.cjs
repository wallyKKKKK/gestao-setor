const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the production calculator without calling auth or database services.
const source = readFileSync(path.join(__dirname, '../app/api/reallocation-suggestions/route.ts'), 'utf8');
const compiled = ts.transpileModule(`${source}\nexports.calculateForTest = calculate;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports, require: () => ({}) });
const calculate = moduleExports.calculateForTest;

function item(store, overrides = {}) {
  return {
    ean: '123', erp_code: '456', product_description: 'Produto teste',
    store_code: store, store_name: `Loja ${store}`, stock: 0, confirmed_stock: 0,
    monthly_avg_sales: 0, stock_days: 0, curve: 'A', min_stock: 0,
    ...overrides,
  };
}

function run(stockItems, overrides = {}) {
  return calculate({
    stockItems,
    filters: { origins: ['01'], destinations: ['02', '03'], ...overrides.filters },
    rules: {
      originMinimumDays: 0, destinationTargetDays: 5, maxRoutePriority: 5,
      considerMinimumStock: true, ...overrides.rules,
    },
    branchLogistics: overrides.branchLogistics || {},
  }).suggestions;
}

const origin = (stock = 20, overrides = {}) => item('01', { stock, confirmed_stock: stock, ...overrides });
const destination = (overrides = {}) => item('02', { stock: 7, confirmed_stock: 7, min_stock: 10, ...overrides });

test('disabled or absent option preserves the normal calculation', () => {
  const rows = [origin(), destination()];
  assert.equal(run(rows, { rules: { considerMinimumStock: false } }).length, 0);
  assert.equal(run(rows, { rules: { considerMinimumStock: undefined } }).length, 0);
});

test('fills only the deficit, even without sales, using confirmed stock', () => {
  const rows = run([origin(), destination({ stock: 9 })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 3);
  assert.equal(rows[0].minimumStockQuantity, 3);
  assert.equal(rows[0].destinationConfirmedStock, 7);
});

test('missing confirmed stock falls back to physical stock', () => {
  assert.equal(run([origin(), destination({ confirmed_stock: null })])[0].quantity, 3);
  assert.equal(run([origin(), destination({ confirmed_stock: 0 })])[0].quantity, 10);
});

test('normal demand gets surplus before minimum stock demand', () => {
  const rows = run([
    origin(6), destination({ stock: 0, confirmed_stock: 0, min_stock: 10 }),
    item('03', { monthly_avg_sales: 30 }),
  ]);
  assert.equal(rows[0].destinationCode, '03');
  assert.equal(rows[0].quantity, 5);
  assert.equal(rows[0].minimumStockQuantity, 0);
  assert.equal(rows[1].destinationCode, '02');
  assert.equal(rows[1].quantity, 1);
  assert.equal(rows[1].minimumStockQuantity, 1);
});

test('normal allocations count toward minimum and same route is merged', () => {
  const rows = run([origin(), destination({ stock: 2, confirmed_stock: 2, monthly_avg_sales: 30 })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 8);
  assert.equal(rows[0].maxQuantity, 8);
  assert.equal(rows[0].destinationNeed, 8);
  assert.equal(rows[0].minimumStockQuantity, 5);
});

test('does not replenish when already at minimum or normal allocation covers it', () => {
  assert.equal(run([origin(), destination({ confirmed_stock: 10 })]).length, 0);
  const rows = [origin(), destination({ stock: 0, confirmed_stock: 0, min_stock: 2, monthly_avg_sales: 30 })];
  assert.equal(run(rows)[0].quantity, run(rows, { rules: { considerMinimumStock: false } })[0].quantity);
  assert.equal(run(rows)[0].minimumStockQuantity, 0);
});

test('preserves donor minimum and normal safety reserve', () => {
  assert.equal(run([origin(8, { min_stock: 6 }), destination()])[0].quantity, 2);
  assert.equal(run([origin(8, { monthly_avg_sales: 30 }), destination()], { rules: { originMinimumDays: 7 } })[0].quantity, 1);
  assert.equal(run([origin(8, { min_stock: 8 }), destination()]).length, 0);
});

test('respects destination, curve, and product filters', () => {
  const rows = [origin(), destination()];
  assert.equal(run(rows, { filters: { destinations: ['03'] } }).length, 0);
  assert.equal(run(rows, { rules: { destinationCurves: ['B'] } }).length, 0);
  assert.equal(run(rows, { filters: { products: ['999'] } }).length, 0);
});

test('respects routes and stores disabled for sending or receiving', () => {
  const rows = [origin(20, { store_name: 'Santa Isabel' }), destination({ store_name: 'Castanhal' })];
  assert.equal(run(rows, { rules: { maxRoutePriority: 1 } }).length, 0);
  assert.equal(run(rows, { branchLogistics: { '01': { uf: 'PA' }, '02': { uf: 'CE' } } }).length, 0);
  assert.equal(run(rows, { branchLogistics: { '01': { sendsStock: false } } }).length, 0);
  assert.equal(run(rows, { branchLogistics: { '02': { receivesStock: false } } }).length, 0);
});

test('several donors share the remaining deficit without exceeding it', () => {
  const rows = run([origin(2), item('03', { stock: 2, confirmed_stock: 2 }), destination()], {
    filters: { origins: ['01', '03'], destinations: ['02'] },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 3);
});

test('global floor limits normal demand even with no safety days', () => {
  const rows = run([origin(12), destination({ stock: 0, confirmed_stock: 0, monthly_avg_sales: 300 })], {
    rules: { stockFloor: 5, considerMinimumStock: false },
  });
  assert.equal(rows[0].quantity, 7);
  assert.equal(rows[0].originAvailableStock, 7);
});

test('global floor protects items without sales during minimum stock replenishment', () => {
  const rows = run([origin(12), destination({ stock: 0, confirmed_stock: 0 })], { rules: { stockFloor: 5 } });
  assert.equal(rows[0].quantity, 7);
  assert.equal(run([origin(5), destination()], { rules: { stockFloor: 5 } }).length, 0);
  assert.equal(run([origin(3), destination()], { rules: { stockFloor: 5 } }).length, 0);
});

test('floor and day reserve use the larger protection rather than their sum', () => {
  const rows = [origin(12, { monthly_avg_sales: 30 }), destination({ stock: 0, confirmed_stock: 0, monthly_avg_sales: 300 })];
  assert.equal(run(rows, { rules: { stockFloor: 5, originMinimumDays: 8 } })[0].quantity, 4);
  assert.equal(run(rows, { rules: { stockFloor: 8, originMinimumDays: 5 } })[0].quantity, 4);
});

test('floor applies to total transfers across normal and minimum destinations', () => {
  const rows = run([origin(12), item('03', { monthly_avg_sales: 30 }), destination({ stock: 0, confirmed_stock: 0 })], {
    rules: { stockFloor: 5 },
  });
  assert.equal(rows[0].destinationCode, '03');
  assert.equal(rows[0].quantity, 5);
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 7);
});
