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
  return analyze(stockItems, overrides).suggestions;
}

function analyze(stockItems, overrides = {}) {
  return calculate({
    stockItems,
    filters: { origins: ['01'], destinations: ['02', '03'], ...overrides.filters },
    rules: {
      originMinimumDays: 0, destinationTargetDays: 5, maxRoutePriority: 5,
      considerMinimumStock: true, ...overrides.rules,
    },
    branchLogistics: overrides.branchLogistics || {},
  });
}

const origin = (stock = 20, overrides = {}) => item('01', { stock, confirmed_stock: stock, ...overrides });
const destination = (overrides = {}) => item('02', { stock: 7, confirmed_stock: 7, min_stock: 10, ...overrides });

function tiedTransfer(stock, secondStoreOverrides = {}, extraOrigins = []) {
  return analyze([
    origin(stock),
    item('02', { monthly_avg_sales: 30 }),
    item('03', { monthly_avg_sales: 30, ...secondStoreOverrides }),
    ...extraOrigins,
  ], {
    filters: { origins: ['01', ...extraOrigins.map(row => row.store_code)] },
    rules: { destinationTargetDays: 3, considerMinimumStock: false },
    branchLogistics: Object.fromEntries(['01', '02', '03', '04'].map(code => [code, { city: 'Same city' }])),
  });
}

test('an even shortage is split automatically without manual decisions', () => {
  const result = tiedTransfer(4);
  assert.equal(result.suggestions.length, 2);
  for (const row of result.suggestions) {
    assert.equal(row.quantity, 2);
    assert.equal(row.automaticSplitDestinations, 2);
    assert.ok(!row.decisionRequired);
  }
  assert.equal(result.unmetNeeds.total, 2);
  assert.equal(result.unmetNeeds.missingUnits, 2);
  assert.ok(result.unmetNeeds.rows.every(row => row.reason === 'insufficient'));
});

test('extra unit goes to higher daily sales only when the destinations otherwise tie', () => {
  const result = tiedTransfer(5, { monthly_avg_sales: 33 });
  const amounts = Object.fromEntries(result.suggestions.map(row => [row.destinationCode, row.quantity]));
  assert.deepEqual(amounts, { '02': 2, '03': 3 });
  const differentCurve = tiedTransfer(4, { curve: 'B' });
  assert.ok(differentCurve.suggestions.every(row => !row.automaticSplitDestinations));
});

test('equal-giro extra allocation is stable by product and independent of input order', () => {
  const branchLogistics = Object.fromEntries(['01', '02', '03'].map(code => [code, { city: 'Same city' }]));
  const calculateWinner = (ean, reverse) => {
    const stores = reverse ? ['03', '02'] : ['02', '03'];
    const result = analyze([origin(1, { ean }), ...stores.map(code => item(code, { ean, monthly_avg_sales: 30 }))], {
      branchLogistics,
      rules: { destinationTargetDays: 3, considerMinimumStock: false },
    });
    assert.equal(result.suggestions.length, 1);
    assert.equal(result.suggestions[0].quantity, 1);
    assert.equal(result.suggestions[0].automaticSplitDestinations, 2);
    return result.suggestions[0].destinationCode;
  };
  assert.equal(calculateWinner('123', false), calculateWinner('123', true));
  assert.notEqual(calculateWinner('123', false), calculateWinner('124', false));
});

test('a second origin completes both destinations and no rateio is needed with enough stock', () => {
  const result = tiedTransfer(4, {}, [item('04', { stock: 2, confirmed_stock: 2 })]);
  const amounts = {};
  for (const row of result.suggestions) amounts[row.destinationCode] = (amounts[row.destinationCode] || 0) + row.quantity;
  assert.deepEqual(amounts, { '02': 3, '03': 3 });
  assert.equal(result.unmetNeeds.total, 0);
  assert.ok(tiedTransfer(6).suggestions.every(row => row.quantity === 3 && !row.automaticSplitDestinations));
});

test('rateio keeps an earlier fully supplied destination and routes that finish a tied destination', () => {
  const result = analyze([
    origin(6),
    item('04', { stock: 1, confirmed_stock: 1 }),
    item('05', { monthly_avg_sales: 20 }),
    item('02', { monthly_avg_sales: 30, curve: 'B' }),
    item('03', { monthly_avg_sales: 30, curve: 'B' }),
  ], {
    filters: { origins: ['01', '04'], destinations: ['02', '03', '05'] },
    rules: { destinationTargetDays: 3, considerMinimumStock: false },
    branchLogistics: Object.fromEntries(['01', '02', '03', '04', '05'].map(code => [code, { city: 'Same city' }])),
  });
  const suppliedEarlier = result.suggestions.find(row => row.destinationCode === '05');
  assert.equal(suppliedEarlier.quantity, suppliedEarlier.destinationNeed);
  assert.equal(suppliedEarlier.automaticSplitDestinations, undefined);
  assert.deepEqual(Array.from(suppliedEarlier.automaticSplitGroups), ['01']);
  const completion = result.suggestions.find(row => row.originCode === '04');
  assert.ok(completion);
  assert.ok(completion.automaticSplitGroups.includes('01'));
  assert.equal(result.unmetNeeds.total, 1);
  assert.equal(result.unmetNeeds.missingUnits, 1);
});

test('the inspection receives last movement days separately for both stores', () => {
  const [row] = run([
    origin(20, { last_sale_days: '15', last_purchase_days: 0 }),
    destination({ stock: 2, confirmed_stock: 2, monthly_avg_sales: 30, last_sale_days: null, last_purchase_days: 31 }),
  ]);
  assert.equal(row.originLastSaleDays, 15);
  assert.equal(row.originLastPurchaseDays, 0);
  assert.equal(row.destinationLastSaleDays, null);
  assert.equal(row.destinationLastPurchaseDays, 31);
});

test('reports a destination even when no route was suggested and distinguishes reserve from a route restriction', () => {
  const rows = [origin(3, { monthly_avg_sales: 30 }), destination({ confirmed_stock: 2, monthly_avg_sales: 30 })];
  const rules = { destinationTargetDays: 10, considerMinimumStock: false };
  const protectedStock = analyze(rows, { rules: { ...rules, originMinimumDays: 3 } });
  assert.equal(protectedStock.suggestions.length, 0);
  assert.equal(protectedStock.unmetNeeds.total, 1);
  assert.equal(protectedStock.unmetNeeds.missingUnits, 8);
  assert.equal(protectedStock.unmetNeeds.rows[0].reason, 'no-surplus');
  const blocked = analyze(rows, { rules, branchLogistics: { '01': { uf: 'PA' }, '02': { uf: 'MA' } } });
  assert.equal(blocked.suggestions.length, 0);
  assert.equal(blocked.unmetNeeds.rows[0].reason, 'route');
});

test('reports one combined shortage for multiple origins and distinguishes reserved from transferable stock', () => {
  const result = analyze([
    origin(5, { monthly_avg_sales: 30 }),
    item('03', { stock: 4, confirmed_stock: 4, monthly_avg_sales: 30 }),
    destination({ stock: 2, confirmed_stock: 2, monthly_avg_sales: 30 }),
  ], {
    filters: { origins: ['01', '03'], destinations: ['02'] },
    rules: { destinationTargetDays: 10, originMinimumDays: 2, considerMinimumStock: false },
  });
  assert.equal(result.suggestions.length, 2);
  assert.equal(result.suggestions[0].originProtectedStock, 2);
  assert.equal(result.suggestions[0].originSurplusBeforeAllocation, 3);
  assert.equal(result.unmetNeeds.total, 1);
  const [need] = result.unmetNeeds.rows;
  assert.equal(need.needed, 8);
  assert.equal(need.suggested, 5);
  assert.equal(need.reason, 'insufficient');
  assert.equal(result.unmetNeeds.missingUnits, 3);
});

test('shortage and inspection use the higher minimum when sales allocations do not reach it', () => {
  const result = analyze([origin(3), destination({ stock: 2, confirmed_stock: 2, monthly_avg_sales: 30 })]);
  assert.equal(result.suggestions[0].quantity, 3);
  assert.equal(result.suggestions[0].destinationNeed, 8);
  assert.equal(result.unmetNeeds.rows[0].needed, 8);
  assert.equal(result.unmetNeeds.missingUnits, 5);
});

test('inspection sums edited routes but does not double count shared demand or unrelated destinations', () => {
  const helpers = {};
  const source = readFileSync(path.join(__dirname, '../lib/reallocation-needs.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: helpers });
  const first = { ean: '123', originCode: '01', destinationCode: '02', quantity: 3, destinationNeed: 8 };
  const coverage = helpers.getReallocationDestinationCoverage(first, [
    first, { ...first, originCode: '03', quantity: 2 },
    { ...first, originCode: '04', quantity: 0 },
    { ...first, destinationCode: '05', quantity: 50 },
  ]);
  assert.deepEqual({ ...coverage }, { needed: 8, suggested: 5, missing: 3, originCount: 2 });
});

test('sales demand uses the confirmed destination balance without replacing the displayed physical balance', () => {
  const rules = { destinationTargetDays: 10, considerMinimumStock: false };
  const receive = (confirmed_stock) => run([
    origin(), destination({ stock: 10, confirmed_stock, monthly_avg_sales: 30 }),
  ], { rules });
  const [row] = receive(4);
  assert.equal(row.quantity, 6);
  assert.equal(row.destinationStock, 10);
  assert.equal(row.destinationConfirmedStock, 4);
  assert.equal(row.destinationStockDays, 4);
  assert.equal(receive(0)[0].quantity, 10);
  assert.equal(receive(-3)[0].quantity, 10);
  assert.equal(receive(null).length, 0);
  assert.equal(receive('invalido').length, 0);
  assert.equal(run([origin(), destination({ stock: 4, confirmed_stock: 10, monthly_avg_sales: 30 })], { rules }).length, 0);
});

test('sales replenishment starts strictly below the trigger but fills toward the target', () => {
  const receive = (confirmed_stock, destinationTriggerDays) => run([
    origin(40), destination({ confirmed_stock, monthly_avg_sales: 30 }),
  ], { rules: { destinationTargetDays: 30, destinationTriggerDays, considerMinimumStock: false } });
  assert.equal(receive(16, 15).length, 0);
  assert.equal(receive(15, 15).length, 0);
  assert.equal(receive(14, 15)[0].quantity, 16);
  assert.equal(receive(16, 0)[0].quantity, 14);
  assert.equal(receive(30, 45).length, 0);
});

test('destination minimum can still use leftovers when the sales trigger has not fired', () => {
  const [row] = run([
    origin(), destination({ stock: 12, confirmed_stock: 6, monthly_avg_sales: 30 }),
  ], { rules: { destinationTargetDays: 15, destinationTriggerDays: 5 } });
  assert.equal(row.quantity, 4);
  assert.equal(row.minimumStockQuantity, 4);
  assert.equal(row.destinationStockDays, 6);
});

test('the origin reserve is strict even when the displayed days would round up to the profile', () => {
  const row = run([
    origin(4, { monthly_avg_sales: 0.67 }),
    destination({ stock: 0, confirmed_stock: 0, monthly_avg_sales: 2.33 }),
  ], { rules: { originMinimumDays: 90, destinationTargetDays: 90, considerMinimumStock: false } })[0];
  assert.equal(row.quantity, 1);
  const coverageWithTwo = 2 / row.originDailySales;
  assert.ok(coverageWithTwo < 90);
  assert.equal(Math.round(coverageWithTwo), 90);
});

test('destination gets a unit when going over the target is closer than staying below it', () => {
  const rows = run([
    origin(20), destination({ stock: 1, confirmed_stock: 1, monthly_avg_sales: 0.60 }),
  ], { rules: { originMinimumDays: 90, destinationTargetDays: 90, considerMinimumStock: false } });
  assert.equal(1 / (0.60 / 30), 50);
  assert.equal(2 / (0.60 / 30), 100);
  assert.equal(rows[0].quantity, 1);
  assert.equal(rows[0].destinationStockDays + rows[0].quantity / rows[0].destinationDailySales, 100);
});

test('an exactly available unit is not lost to floating-point noise in the origin reserve', () => {
  const rows = run([
    origin(95, { monthly_avg_sales: 31 }),
    destination({ stock: 0, confirmed_stock: 0, monthly_avg_sales: 2.33 }),
  ], { rules: { originMinimumDays: 90, destinationTargetDays: 90, considerMinimumStock: false } });
  assert.equal(rows[0].quantity, 2);
});

test('destination ties favor fewer units, and being already closer below does not create a transfer', () => {
  const rows = [origin(20), destination({ stock: 1, confirmed_stock: 1, monthly_avg_sales: 0.60 })];
  for (const target of [70, 75]) {
    assert.equal(run(rows, { rules: { destinationTargetDays: target, considerMinimumStock: false } }).length, 0);
  }
  assert.equal(run(rows, { rules: { destinationTargetDays: 125, considerMinimumStock: false } })[0].quantity, 1);
});

test('nearest destination coverage never overrides the origin reserve or the stock floor', () => {
  const rows = run([
    origin(4, { monthly_avg_sales: 0.67 }),
    destination({ stock: 1, confirmed_stock: 1, monthly_avg_sales: 0.60 }),
  ], { rules: { originMinimumDays: 90, destinationTargetDays: 90, stockFloor: 4, considerMinimumStock: false } });
  assert.equal(rows.length, 0);
});

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
  assert.equal(rows[0].originMinimumStock, 0);
  assert.equal(rows[0].destinationMinimumStock, 10);
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

test('origin minimum protects normal demand and the manual allocation limit', () => {
  const rows = [origin(12, { min_stock: 8 }), destination({ stock: 0, confirmed_stock: 0, monthly_avg_sales: 300 })];
  const rules = { considerOriginMinimumStock: true, considerDestinationMinimumStock: false };
  const result = run(rows, { rules });
  assert.equal(result[0].quantity, 4);
  assert.equal(result[0].originAvailableStock, 4);
  assert.equal(result[0].minimumStockQuantity, 0);
  assert.equal(run(rows, { rules: { ...rules, considerOriginMinimumStock: false } })[0].quantity, 12);
});

test('destination switch works independently of origin protection', () => {
  const rows = [origin(8, { min_stock: 7 }), destination({ stock: 0, confirmed_stock: 0 })];
  assert.equal(run(rows, { rules: { considerOriginMinimumStock: false, considerDestinationMinimumStock: true } })[0].quantity, 8);
  assert.equal(run(rows, { rules: { considerOriginMinimumStock: true, considerDestinationMinimumStock: true } })[0].quantity, 1);
  assert.equal(run(rows, { rules: { considerOriginMinimumStock: true, considerDestinationMinimumStock: false } }).length, 0);
  assert.equal(run(rows, { rules: { considerOriginMinimumStock: false, considerDestinationMinimumStock: false } }).length, 0);
});

test('origin minimum, global floor and day reserve use their maximum', () => {
  const rows = [origin(20, { min_stock: 8, monthly_avg_sales: 30 }), destination({ stock: 0, confirmed_stock: 0, monthly_avg_sales: 300 })];
  const rules = { considerOriginMinimumStock: true, considerDestinationMinimumStock: false, stockFloor: 5, originMinimumDays: 10 };
  assert.equal(run(rows, { rules })[0].quantity, 10);
  assert.equal(run(rows, { rules: { ...rules, stockFloor: 12 } })[0].quantity, 8);
  assert.equal(run(rows, { rules: { ...rules, originMinimumDays: 0 } })[0].quantity, 12);
});

test('origin protection covers total normal and minimum allocations', () => {
  const result = run([origin(12, { min_stock: 6 }), item('03', { monthly_avg_sales: 30 }), destination({ stock: 0, confirmed_stock: 0 })], {
    rules: { considerOriginMinimumStock: true, considerDestinationMinimumStock: true },
  });
  assert.equal(result[0].quantity, 5);
  assert.equal(result[1].quantity, 1);
  assert.equal(result.reduce((sum, row) => sum + row.quantity, 0), 6);
});

test('origin at or below minimum cannot donate, including items without sales', () => {
  for (const stock of [3, 5]) {
    assert.equal(run([origin(stock, { min_stock: 5 }), destination()], {
      rules: { considerOriginMinimumStock: true, considerDestinationMinimumStock: true },
    }).length, 0);
  }
  const result = run([origin(12, { min_stock: 5.2 }), destination({ stock: 0, confirmed_stock: 0 })], {
    rules: { considerOriginMinimumStock: true, considerDestinationMinimumStock: true },
  });
  assert.equal(result[0].quantity, 6);
});
