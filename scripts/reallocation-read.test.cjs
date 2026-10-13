const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '../app/api/reallocation-suggestions/route.ts'), 'utf8');
const compiled = ts.transpileModule(`${source}\nexports.readTest = { calculate, fetchOrderedRows, fetchSnapshotStockItems, fetchProductEansByAttributes, mergeProductFilters };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const plain = (value) => JSON.parse(JSON.stringify(value));
const code = (value) => String(value || '').padStart(2, '0');

function comparableSuggestions(suggestions) {
  const groups = new Map();
  for (const { id, ...row } of plain(suggestions)) {
    if (!groups.has(row.ean)) groups.set(row.ean, []);
    groups.get(row.ean).push({ ...row, stableId: id.slice(0, id.lastIndexOf(':')) });
  }
  return [...groups.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function rows() {
  return Array.from({ length: 4 }, (_, partition) => Array.from({ length: 1300 }, (_, index) => ({
    id: `${(partition * 0x40000000 + index).toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`,
    snapshot_id: 'snapshot', store_code: ['01', '1', '02', '03', '04'][(index + partition) % 5],
    store_name: 'Synthetic store', ean: String(100000 + index % 450), erp_code: String(index % 450),
    product_description: 'Synthetic item', stock: (index + partition) % 5 < 2 ? 30 : 0,
    confirmed_stock: (index + partition) % 5 < 2 ? 30 : 0, monthly_avg_sales: 3,
    curve: 'A', min_stock: 5,
  }))).flat();
}

function load(stockRows = rows(), productRows = [], fail = false) {
  const stats = { active: 0, maximum: 0, calls: 0 };
  const tables = { reallocation_stock_items: stockRows, reallocation_products: productRows };
  class Query {
    constructor(table) { this.table = table; this.predicates = []; this.columns = '*'; }
    select(columns) { this.columns = columns; return this; }
    eq(column, value) { this.predicates.push((row) => row[column] === value); return this; }
    in(column, values) { this.predicates.push((row) => values.includes(row[column])); return this; }
    not(column, operator, value) { assert.equal(operator, 'is'); this.predicates.push((row) => row[column] !== value); return this; }
    gte(column, value) { this.lower = value; this.predicates.push((row) => row[column] >= value); return this; }
    lt(column, value) { this.predicates.push((row) => row[column] < value); return this; }
    gt(column, value) { this.predicates.push((row) => row[column] > value); return this; }
    order(column, options) { assert.equal(column, 'id'); assert.equal(options.ascending, true); return this; }
    limit(count) { this.count = count; return this; }
    abortSignal(signal) { this.signal = signal; return this; }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
    async execute() {
      stats.calls++;
      stats.active++;
      stats.maximum = Math.max(stats.maximum, stats.active);
      try {
        await new Promise((done) => setTimeout(done, this.lower?.startsWith('0') ? 3 : 1));
        this.signal.throwIfAborted();
        if (fail && this.lower?.startsWith('4')) return { data: null, error: new Error('Simulated read failure') };
        const result = tables[this.table].filter((row) => this.predicates.every((predicate) => predicate(row)))
          .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0).slice(0, this.count);
        return { data: result.map((row) => this.columns === '*' ? row : Object.fromEntries(this.columns.split(',').map((column) => [column, row[column] ?? null]))), error: null };
      } finally { stats.active--; }
    }
  }
  const exported = {};
  vm.runInNewContext(compiled, {
    exports: exported, AbortController,
    require: (name) => name === '@/lib/supabase-admin' ? { getSupabaseAdmin: () => ({ from: (table) => new Query(table) }) } : {},
  });
  return { ...exported.readTest, stats };
}

test('parallel cursor pages include every UUID boundary once and restore ID order', async () => {
  const input = rows();
  const api = load(input);
  const result = await api.fetchSnapshotStockItems('snapshot');
  assert.deepEqual(plain(result.map((row) => row.id)), input.map((row) => row.id));
  assert.equal(new Set(result.map((row) => row.id)).size, input.length);
  assert.equal(api.stats.maximum, 4);
  assert.equal(api.stats.calls, 8);
});

test('store pushdown includes origins, destinations, and unpadded legacy store codes', async () => {
  const input = rows();
  const api = load(input);
  const result = await api.fetchSnapshotStockItems('snapshot', { origins: ['1'], destinations: ['03'] });
  assert.deepEqual(plain(result.map((row) => row.id)), input.filter((row) => ['01', '03'].includes(code(row.store_code))).map((row) => row.id));
  assert.ok(result.some((row) => row.stock === 0));
});

test('one unrestricted store side must keep all stores eligible', async () => {
  for (const filters of [{ origins: ['01'], destinations: [] }, { origins: [], destinations: ['02'] }]) {
    const input = rows();
    const result = await load(input).fetchSnapshotStockItems('snapshot', filters);
    assert.equal(result.length, input.length);
  }
});

test('EAN batches are bounded, deduplicated, globally sorted, and complete', async () => {
  const input = rows();
  const products = Array.from({ length: 450 }, (_, index) => String(100000 + index));
  const api = load(input);
  const result = await api.fetchSnapshotStockItems('snapshot', { products: [...products, ...products] });
  assert.deepEqual(plain(result.map((row) => row.id)), input.map((row) => row.id));
  assert.ok(api.stats.maximum <= 4);
});

test('no matching product skips stock queries and an unknown snapshot stays empty', async () => {
  const api = load();
  assert.equal((await api.fetchSnapshotStockItems('snapshot', { products: ['__NO_PRODUCT_MATCH__'] })).length, 0);
  assert.equal(api.stats.calls, 0);
  assert.equal((await api.fetchSnapshotStockItems('unknown')).length, 0);
});

test('attribute filtering preserves normalization and limits explicit EANs first', async () => {
  const catalog = [
    { id: '00000000-0000-0000-0000-000000000001', ean: '1', manufacturer: 'Hipop\u00f3', classification: 'PRINCIPAL > Infantil > Higiene > Sabonetes' },
    { id: '80000000-0000-0000-0000-000000000001', ean: '2', manufacturer: 'HIPOP\u00d3', classification: 'Infantil > Higiene > Sabonetes' },
    { id: 'c0000000-0000-0000-0000-000000000001', ean: '3', manufacturer: 'Other', classification: 'Infantil > Higiene > Sabonetes' },
  ];
  const api = load([], catalog);
  assert.deepEqual(plain(await api.fetchProductEansByAttributes({ manufacturers: ['hipopo'], classificationLines: ['infantil'], classificationCategories: ['sabonete'] })), ['1', '2']);
  assert.deepEqual(plain(await api.fetchProductEansByAttributes({ products: ['2'], manufacturers: ['hipopo'] })), ['2']);
  assert.deepEqual(plain(api.mergeProductFilters({ products: ['3'], manufacturers: ['hipopo'] }, [])), ['__NO_PRODUCT_MATCH__']);
});

test('a failed partition rejects the complete read and waits for cancellation', async () => {
  const api = load(rows(), [], true);
  await assert.rejects(api.fetchSnapshotStockItems('snapshot'), /Simulated read failure/);
  assert.equal(api.stats.active, 0);
  assert.ok(api.stats.calls <= 4);
});

test('a malformed cursor fails visibly instead of silently truncating data', async () => {
  const api = load();
  await assert.rejects(api.fetchOrderedRows(async () => ({ data: [{ id: null }], error: null })), /cursor valido/);
});

test('filtered reads produce the same suggestions with ties, floor, and minimum stock', async () => {
  const input = rows();
  const api = load(input);
  for (const filters of [
    { origins: ['01'], destinations: ['02', '03'] },
    { origins: ['01'], destinations: ['02'], products: ['100001', '100002', '100003'] },
    { origins: ['01'], destinations: [] },
  ]) {
    const rules = { stockFloor: 5, considerMinimumStock: true, originMinimumDays: 20, destinationTargetDays: 30, maxRoutePriority: 5 };
    const subset = await api.fetchSnapshotStockItems('snapshot', filters);
    const expected = api.calculate({ stockItems: input, filters, rules });
    const actual = api.calculate({ stockItems: subset, filters, rules });
    assert.ok(expected.suggestions.length > 0);
    assert.deepEqual(comparableSuggestions(actual.suggestions), comparableSuggestions(expected.suggestions));
  }
});
