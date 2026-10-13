const assert = require('node:assert/strict');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const source = readFileSync(path.join(root, 'app/api/reallocation-suggestions/route.ts'), 'utf8');
const exported = {};
const compiled = ts.transpileModule(`${source}\nexports.calculateForDiagnostic = calculate;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(compiled, { exports: exported, require: () => ({}) });
const calculate = exported.calculateForDiagnostic;

function item(store, values = {}) {
  return {
    ean: '123', erp_code: '456', product_description: 'Synthetic product',
    store_code: store, store_name: `Store ${store}`, stock: 0, confirmed_stock: 0,
    monthly_avg_sales: 0, stock_days: 0, curve: 'A', min_stock: 0,
    ...values,
  };
}

function payload(rows, rules = {}, filters = {}, branchLogistics = {}) {
  return {
    stockItems: rows,
    rules: { originMinimumDays: 0, destinationTargetDays: 5, maxRoutePriority: 5, ...rules },
    filters: { origins: ['01'], destinations: ['02', '03'], ...filters },
    branchLogistics,
  };
}

const origin = (values = {}) => item('01', { stock: 20, confirmed_stock: 20, ...values });
const destination = (values = {}) => item('02', { monthly_avg_sales: 30, ...values });
const cases = [
  ['normal_demand', payload([origin(), destination()])],
  ['confirmed_stock_limits_origin', payload([origin({ confirmed_stock: 3 }), destination()])],
  ['missing_confirmed_stock', payload([origin({ confirmed_stock: null }), destination()])],
  ['days_safety', payload([origin({ monthly_avg_sales: 30 }), destination()], { originMinimumDays: 18 })],
  ['global_floor', payload([origin(), destination()], { stockFloor: 18 })],
  ['minimum_without_sales', payload([origin(), destination({ stock: 7, confirmed_stock: 7, min_stock: 10, monthly_avg_sales: 0 })], { considerMinimumStock: true })],
  ['normal_then_minimum', payload([origin({ stock: 6, confirmed_stock: 6 }), destination(), item('03', { min_stock: 10 })], { considerMinimumStock: true })],
  ['minimum_same_route', payload([origin(), destination({ min_stock: 10 })], { considerMinimumStock: true })],
  ['origin_curve_filter', payload([origin({ curve: 'E' }), destination()], { originCurves: ['A'] })],
  ['destination_curve_filter', payload([origin(), destination({ curve: 'E' })], { destinationCurves: ['A'] })],
  ['product_filter', payload([origin(), destination()], {}, { products: ['999'] })],
  ['store_permissions', payload([origin(), destination()], {}, {}, { '01': { sendsStock: false }, '02': { receivesStock: false } })],
  ['different_states', payload([origin(), destination()], {}, {}, { '01': { uf: 'PA' }, '02': { uf: 'CE' } })],
  ['same_city_route', payload([origin(), destination()], { maxRoutePriority: 1 }, {}, { '01': { city: 'Castanhal' }, '02': { city: 'Castanhal' } })],
  ['tie_needs_manual_decision', payload([origin({ stock: 3, confirmed_stock: 3 }), destination(), item('03', { monthly_avg_sales: 30 })])],
  ['minimum_days_without_sale', payload([origin({ last_sale_days: 100 }), destination({ last_sale_days: 2 })], { lastSaleMaxDays: 30 })],
  ['minimum_days_without_purchase', payload([origin({ last_purchase_days: 100 }), destination({ last_purchase_days: 2 })], { lastPurchaseMaxDays: 30 })],
  ['need_type_filter', payload([origin({ need_type: 'NORMAL' }), destination({ need_type: 'OUTRO' })], {}, { needTypes: ['NORMAL'] })],
  ['supplier_filter', payload([origin({ last_purchase_supplier: 'ONE' }), destination({ last_purchase_supplier: 'TWO' })], {}, { lastPurchaseSuppliers: ['ONE'] })],
  ['rounding_half_step', payload([origin(), destination({ monthly_avg_sales: 1.5 })], { destinationTargetDays: 90 })],
];

function workload(rowCount, stockFloor = 0) {
  const rows = [];
  for (let product = 0; product < rowCount / 20; product++) {
    for (let store = 1; store <= 20; store++) {
      const stock = store <= 5 ? 40 + product % 30 : product % 3;
      rows.push(item(String(store).padStart(2, '0'), {
        ean: String(100000 + product), erp_code: String(product + 1),
        stock, confirmed_stock: stock, monthly_avg_sales: 9 + (product % 10) * 3,
        curve: ['A', 'B', 'C', 'D', 'E'][(product + store) % 5],
      }));
    }
  }
  return payload(rows, { originMinimumDays: 20, destinationTargetDays: 30, stockFloor }, {
    origins: ['01', '02', '03', '04', '05'], destinations: ['11', '12', '13', '14'],
  });
}

function summarize(result) {
  return {
    stockRows: result.stockRows,
    productGroups: result.productGroups,
    suggestions: result.suggestions.length,
    units: result.suggestions.reduce((sum, row) => sum + row.quantity, 0),
    allocations: result.suggestions.map((row) => [row.ean, row.originCode, row.destinationCode, row.quantity]),
  };
}

function normalize(value) {
  if (typeof value === 'number') return Math.round(value * 1e8) / 1e8;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).filter((key) => key !== 'engine').sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

function differences(expected, actual, location = '', output = []) {
  if (Object.is(expected, actual)) return output;
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      if (output.length >= 8) break;
      differences(expected[key], actual[key], `${location}.${key}`, output);
    }
  } else {
    output.push({ field: location, typescript: expected ?? null, python: actual ?? null });
  }
  return output;
}

const fixturesOnly = process.argv.includes('--fixtures-only');
const jobs = [
  ...cases.map(([id, input]) => ({ id, payload: input, repetitions: 1 })),
  ...(!fixturesOnly ? [
    ...[5000, 25000, 100000].map((size) => ({ id: `synthetic_${size}`, payload: workload(size), repetitions: 5, summaryOnly: true })),
    { id: 'synthetic_100000_floor', payload: workload(100000, 15), repetitions: 5, summaryOnly: true },
  ] : []),
];

const typescriptResults = jobs.map((job) => {
  calculate(job.payload);
  const samplesMs = [];
  let result;
  for (let repetition = 0; repetition < job.repetitions; repetition++) {
    const started = performance.now();
    result = calculate(job.payload);
    samplesMs.push(performance.now() - started);
  }
  const sorted = [...samplesMs].sort((left, right) => left - right);
  return { id: job.id, medianMs: sorted[Math.floor(sorted.length / 2)], samplesMs, result: job.summaryOnly ? summarize(result) : result };
});

const pythonStarted = performance.now();
const python = spawnSync(process.env.REALLOCATION_PYTHON || 'python', ['-B', path.join(__dirname, 'reallocation-python-diagnostic.py')], {
  input: JSON.stringify({ jobs }), encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120000,
});
if (python.error || python.status !== 0) throw new Error(python.error?.message || python.stderr || 'Python diagnostic failed');
const pythonWallMs = performance.now() - pythonStarted;
const pythonResults = JSON.parse(python.stdout);
const comparisons = {};
const benchmarks = [];
for (const [engine, results] of Object.entries(pythonResults)) {
  comparisons[engine] = [];
  results.forEach((entry, index) => {
    assert.equal(entry.id, typescriptResults[index].id);
    const expected = normalize(typescriptResults[index].result);
    const actual = normalize(entry.result);
    const drift = differences(expected, actual);
    if (jobs[index].summaryOnly) {
      benchmarks.push({
        scenario: entry.id, pythonEngine: engine, rows: jobs[index].payload.stockItems.length,
        typescriptMedianMs: typescriptResults[index].medianMs, pythonMedianMs: entry.medianMs,
        typescriptSamplesMs: typescriptResults[index].samplesMs, pythonSamplesMs: entry.samplesMs,
        sameAllocations: drift.length === 0,
        typescriptSuggestions: expected.suggestions, pythonSuggestions: actual.suggestions,
        typescriptUnits: expected.units, pythonUnits: actual.units,
      });
    } else {
      comparisons[engine].push({ scenario: entry.id, matches: drift.length === 0, differences: drift });
    }
  });
}
const report = {
  generatedAt: new Date().toISOString(), nodeVersion: process.version, pythonProcessWallMs: pythonWallMs,
  method: 'Synthetic offline inputs, one warmup, five timed samples per workload. Python compute excludes process startup, JSON transport and module imports. TypeScript calculator loaded from the production route in a VM. No database, network or browser render time included. Fixture numbers compared to 8 decimal places; tie IDs and text compared exactly. Workload parity covers allocations and totals only.',
  comparisons, benchmarks,
};
const outputPath = path.join(root, 'docs/reallocation-engine-diagnostic.json');
if (process.argv.includes('--fixtures-only') && existsSync(outputPath)) {
  const previousReport = JSON.parse(readFileSync(outputPath, 'utf8'));
  report.benchmarks = previousReport.benchmarks;
  report.benchmarkGeneratedAt = previousReport.benchmarkGeneratedAt || previousReport.generatedAt;
}
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
for (const [engine, entries] of Object.entries(comparisons)) {
  console.log(`${engine}: ${entries.filter((entry) => entry.matches).length}/${entries.length} fixtures match`);
  for (const entry of entries.filter((entry) => !entry.matches)) console.log(`  differs: ${entry.scenario} (${entry.differences.map((diff) => diff.field).join(', ')})`);
}
if (benchmarks.length > 0) console.table(benchmarks.map((entry) => ({ scenario: entry.scenario, engine: entry.pythonEngine, tsMs: entry.typescriptMedianMs.toFixed(2), pythonMs: entry.pythonMedianMs.toFixed(2), sameAllocations: entry.sameAllocations })));
console.log(`Report: ${outputPath}`);
if (process.argv.includes('--require-parity') && Object.values(comparisons).some((entries) => entries.some((entry) => !entry.matches))) process.exitCode = 1;
