const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, names) {
  const source = readFileSync(path.join(__dirname, '..', file), 'utf8');
  const compiled = ts.transpileModule(source + names.map((name) => `\nexports.${name} = ${name};`).join(''), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => ({}) });
  return exports;
}

const { parseStockRows } = load('app/api/reallocation/stock/import/route.ts', ['parseStockRows']);
const { ownDailySales } = load('app/api/reallocation-suggestions/route.ts', ['ownDailySales']);
const headers = ['Un. Neg.', 'Apelido Un. Neg.', 'Cod. de Barras', 'Produto', 'Estoque', 'Media venda mensal', 'Media venda diaria'];
const row = ['01', 'Loja teste', '7891234567890', 'Produto teste', '30', '60', '99'];

test('import ignores daily sales and derives daily average from monthly sales', () => {
  const imported = parseStockRows([headers, row]).rows[0];
  assert.equal(imported.monthly_avg_sales, 60);
  assert.equal(ownDailySales(imported), 2);
  assert.equal(imported.stock_days, 15);
});

test('zero or blank monthly sales never falls back to daily sales or coverage', () => {
  for (const monthly of ['0', '']) {
    const cells = [...row];
    cells[5] = monthly;
    const imported = parseStockRows([headers, cells]).rows[0];
    assert.equal(imported.monthly_avg_sales, 0);
    assert.equal(ownDailySales({ ...imported, stock_days: 5 }), 0);
  }
});

test('monthly column is mandatory, even when daily column exists', () => {
  assert.throws(() => parseStockRows([headers.filter((_, i) => i !== 5), row.filter((_, i) => i !== 5)]), /mensal/i);
});

test('decimal monthly values retain their precision during calculation', () => {
  const cells = [...row];
  cells[5] = '1,67';
  const imported = parseStockRows([headers, cells]).rows[0];
  assert.equal(imported.monthly_avg_sales, 1.67);
  assert.equal(ownDailySales(imported), 1.67 / 30);
});
