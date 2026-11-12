const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadRoute(failure) {
  const importFilters = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '../lib/reallocation-import-filters.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: importFilters });
  const calls = [];
  const afterTasks = [];
  const db = {
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const query = {
        insert(rows) { call.operation = 'insert'; call.rows = rows; return query; },
        select() { return query; },
        in() { return query; },
        eq(key, value) { call.filters.push([key, value]); return query; },
        delete() { call.operation = 'delete'; return query; },
        update(values) { call.operation = 'retire'; call.rows = values; return query; },
        single() { return Promise.resolve({ data: { id: 'new-snapshot' }, error: null }); },
        then(resolve, reject) {
          let error = null;
          if (table === 'reallocation_stock_items' && call.operation === 'insert') {
            if (failure === 'insert') error = new Error('Insert failed');
            else if (failure === 'insert-timeout' || (failure === 'large-insert-timeout' && call.rows.length > 250)) {
              error = { code: '57014', message: 'canceling statement due to statement timeout' };
            } else if (failure === 'ambiguous-insert-timeout') {
              error = { message: 'request timed out' };
            }
          }
          call.error = error;
          return Promise.resolve({ data: [], error }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ operation: 'publish', name, args });
      return { data: 200, error: failure === 'publish' ? new Error('Publication failed') : failure === 'publish-plain' ? { code: '57014', message: 'canceling statement due to statement timeout' } : null };
    },
  };
  const dependencies = {
    'xlsx': require('xlsx'),
    '@/lib/reallocation-import-filters': importFilters,
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) }, after: (callback) => afterTasks.push(callback) },
    '@/lib/reallocation-stock-cleanup': { cleanupRetiredReallocationStock: async () => ({ completed: true }) },
    '@/lib/supabase-admin': { getSupabaseAdmin: () => db },
    '@/lib/server-auth': { requireAuthenticatedProfile: async () => ({ ok: true, userId: 'user', profile: { sector: 'Geral' } }) },
    '@/lib/rate-limit': { checkRateLimit: () => null },
    '@/lib/reallocation-sector': { normalizeReallocationSector: (sector) => sector },
    '@/lib/erp-inventory': { createErpInventorySnapshot: async () => ({ snapshotId: 'erp', currentUpdated: 1 }), splitErpClassificationPath: () => ({}) },
  };
  const source = readFileSync(path.join(__dirname, '../app/api/reallocation/stock/import/route.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => dependencies[name] || {}, File, console: { error() {}, warn() {} } });
  return { POST: exports.POST, calls, afterTasks };
}

function request(csv = 'Un. Neg.;Apelido Un. Neg.;Cod. de Barras;Produto;Estoque;Media venda mensal\n01;Loja;789123;Produto;5;30') {
  const form = new FormData();
  form.set('file', new File([csv], 'stock.csv', { type: 'text/csv' }));
  return new Request('http://localhost/api/reallocation/stock/import', { method: 'POST', body: form });
}

function bulkStockRequest(size) {
  return request([
    'Un. Neg.;Apelido Un. Neg.;Cod. de Barras;Produto;Estoque;Media venda mensal',
    ...Array.from({ length: size }, (_, index) => `01;Loja;${7890000000000 + index};Produto;5;30`),
  ].join('\n'));
}

test('a canceled stock batch is retried smaller without skipping or duplicating rows', async () => {
  const route = loadRoute('large-insert-timeout');
  const response = await route.POST(bulkStockRequest(1100));
  assert.equal(response.status, 200);
  const writes = route.calls.filter(call => call.table === 'reallocation_stock_items' && call.operation === 'insert');
  assert.deepEqual(writes.map(call => call.rows.length), [1000, 500, 250, 250, 250, 250, 100]);
  const committed = writes.filter(call => !call.error).flatMap(call => Array.from(call.rows, row => row.ean));
  assert.equal(committed.length, 1100);
  assert.equal(new Set(committed).size, 1100);
  assert.equal(route.calls.find(call => call.operation === 'publish').args.p_expected_rows, 1100);
});

test('persistent cancellation stops at the minimum batch and an ambiguous timeout is not retried', async () => {
  for (const [failure, sizes] of [['insert-timeout', [1000, 500, 250, 125]], ['ambiguous-insert-timeout', [1000]]]) {
    const route = loadRoute(failure);
    const response = await route.POST(bulkStockRequest(1100));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /salvar linhas de estoque.*base anterior foi preservada/i);
    const writes = route.calls.filter(call => call.table === 'reallocation_stock_items' && call.operation === 'insert');
    assert.deepEqual(writes.map(call => call.rows.length), sizes);
    assert.equal(route.calls.some(call => call.operation === 'publish'), false);
  }
});

test('import creates a separate pending base and publishes only after saving its rows', async () => {
  const route = loadRoute();
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.accumulated, false);
  assert.equal(result.replacedRows, 200);
  assert.equal(result.sourceFile, 'stock.csv');
  assert.equal(result.totalRows, 1);
  assert.equal(result.uniqueProducts, 1);
  assert.equal(result.stores[0].code, '01');
  assert.equal(result.unmatchedItems.length, 1);
  assert.equal(result.unmatchedItems[0].ean, '789123');
  assert.equal(result.unmatchedItems[0].line, 2);
  const snapshot = route.calls.find((call) => call.table === 'reallocation_stock_snapshots');
  assert.equal(snapshot.rows[0].is_ready, false);
  const insertIndex = route.calls.findIndex((call) => call.table === 'reallocation_stock_items');
  const publishIndex = route.calls.findIndex((call) => call.operation === 'publish');
  assert.ok(publishIndex > insertIndex);
  assert.equal(route.calls[publishIndex].args.p_expected_rows, 1);
  assert.equal(route.calls.some((call) => call.operation === 'delete'), false);
  assert.equal(route.afterTasks.length, 1);
});

test('stock import preserves explicit confirmed zero and falls back to physical for missing or invalid balances', async () => {
  const route = loadRoute();
  const response = await route.POST(request([
    'Un. Neg.;Apelido Un. Neg.;Cod. de Barras;Produto;Estoque;Media venda mensal;Estoque Confirmado',
    '01;Loja;789123;Produto;5;30;',
    '02;Loja;789123;Produto;5;30;0',
    '03;Loja;789123;Produto;5;30;invalido',
    '04;Loja;789123;Produto;5;30;2,5',
  ].join('\n')));
  assert.equal(response.status, 200);
  const rows = route.calls.find((call) => call.table === 'reallocation_stock_items').rows;
  assert.equal(Array.from(rows, (row) => row.confirmed_stock).join(','), '5,0,5,2.5');
});

test('A7 movement columns keep zero and blank distinct and do not read dates or supplier names', async () => {
  const route = loadRoute();
  const response = await route.POST(request([
    'Un. Neg.;Apelido Un. Neg.;Cod. de Barras;Produto;Estoque;Media venda mensal;Fornecedor última compra;Data última venda;Últ. Venda (Dias);Últ. Compra (Dias)',
    '01;Loja;789123;Produto;5;30;Fornecedor 195;11/11/2026;7;195',
    '02;Loja;789123;Produto;5;30;Fornecedor 85;11/11/2026;0;85',
    '03;Loja;789123;Produto;5;30;Fornecedor 10;11/11/2026;;',
    '04;Loja;789123;Produto;5;30;Fornecedor 99;11/11/2026;1.095;–',
  ].join('\n')));
  assert.equal(response.status, 200);
  const rows = route.calls.find((call) => call.table === 'reallocation_stock_items').rows;
  assert.deepEqual(Array.from(rows, row => [row.last_sale_days, row.last_purchase_days]), [[7,195],[0,85],[null,null],[1095,null]]);
});

test('A7 short movement headers are accepted, but a supplier column alone never becomes a purchase age', async () => {
  const header = 'Un. Neg.;Apelido Un. Neg.;Cod. de Barras;Produto;Estoque;Media venda mensal;Fornecedor última compra;Últ. V.';
  for (const includePurchase of [true, false]) {
    const route = loadRoute();
    const response = await route.POST(request(`${header}${includePurchase ? ';Últ. C.' : ''}\n01;Loja;789123;Produto;5;30;Fornecedor 55;14${includePurchase ? ';26' : ''}`));
    assert.equal(response.status, 200);
    const [row] = route.calls.find((call) => call.table === 'reallocation_stock_items').rows;
    assert.equal(row.last_sale_days, 14);
    assert.equal(row.last_purchase_days, includePurchase ? 26 : null);
  }
});

test('SpreadsheetML XML import exposes only valid file manufacturers and stores in the preview', async () => {
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Un. Neg.', 'Apelido Un. Neg.', 'Cod. de Barras', 'Produto', 'Estoque', 'Media venda mensal', 'Fabricante'],
    ['01', 'Loja 1', '789123', 'Produto', '5', '30', 'FABRICANTE XML'],
    ['02', 'Loja 2', '789123', 'Produto', '3', '0', 'FABRICANTE XML'],
    ['99', 'Ignorada', '', 'Invalido', '3', '0', 'NAO SUGERIR'],
  ]), 'Estoque');
  const xml = XLSX.write(workbook, { bookType: 'xml', type: 'array' });
  const form = new FormData();
  form.set('file', new File([xml], 'estoque.xml', { type: 'application/xml' }));
  const route = loadRoute();
  const response = await route.POST(new Request('http://localhost/api/reallocation/stock/import', { method: 'POST', body: form }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.imported, 2);
  assert.equal(data.stores.map(store => store.code).join(','), '01,02');
  assert.equal(data.filterPreview.manufacturers.length, 1);
  assert.equal(data.filterPreview.manufacturers[0].name, 'FABRICANTE XML');
  assert.equal(data.filterPreview.manufacturers[0].source, 'file');
  assert.equal(data.filterPreview.manufacturers[0].linked, false);
});

test('report includes ignored row reasons and original row numbers across blank rows', async () => {
  const route = loadRoute();
  const response = await route.POST(request('Un. Neg.;Apelido Un. Neg.;Cod. de Barras;Produto;Estoque;Media venda mensal\n\n01;Loja;789123;Produto;5;30\n\n01;Loja;;Invalido;5;30'));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.totalRows, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.skippedRows[0].line, 5);
  assert.match(result.skippedRows[0].reason, /EAN/);
  assert.equal(result.unmatchedItems[0].line, 3);
});

test('entirely invalid file returns details without changing the active base', async () => {
  const route = loadRoute();
  const response = await route.POST(request('Un. Neg.;Apelido Un. Neg.;Cod. de Barras;Produto;Estoque;Media venda mensal\n01;Loja;;Invalido;5;30'));
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.equal(result.imported, 0);
  assert.equal(result.skippedRows[0].line, 2);
  assert.equal(route.calls.length, 0);
});

for (const failure of ['insert', 'publish']) {
  test(`${failure} failure only cleans the pending new snapshot`, async () => {
    const route = loadRoute(failure);
    const response = await route.POST(request());
    assert.equal(response.status, 400);
    const cleanup = route.calls.find((call) => call.operation === 'retire');
    assert.equal(cleanup.table, 'reallocation_stock_snapshots');
    assert.equal(JSON.stringify(cleanup.filters), JSON.stringify([['id', 'new-snapshot'], ['is_ready', false]]));
    assert.equal(route.afterTasks.length, 1);
    if (failure === 'insert') assert.equal(route.calls.some((call) => call.operation === 'publish'), false);
  });
}

test('plain database errors preserve the real message and error code', async () => {
  const route = loadRoute('publish-plain');
  const response = await route.POST(request());
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.equal(result.code, '57014');
  assert.match(result.error, /demorou/);
  assert.doesNotMatch(result.error, /Erro ao importar estoque\./);
});
