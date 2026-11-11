const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');
const xlsx = require('xlsx');

const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/supplier-quotation-price-import.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api, require, TextDecoder });

const items = [{ id: '1', ean: '00012345' }, { id: '2', ean: '7890000000001' }, { id: '3', ean: '99999999' }];
const prices = result => Array.from(result.prices, row => [row.itemId, row.price]);

test('finds EAN and unit price headers and reads Brazilian currency', () => {
  const result = api.matchSupplierPrices([
    ['Tabela do fornecedor'],
    ['Descrição', 'Preço Unitário', 'Código de Barras'],
    ['A', 'R$ 1.234,5678', '00012345'],
    ['B', 2.345, 7890000000001],
    ['C', '0', '99999999'],
    ['D', '1.50', '22222222'],
  ], items);
  assert.deepEqual(prices(result), [['1', 1234.5678], ['2', 2.345]]);
  assert.equal(result.ignored, 2);
  assert.match(result.examples[0], /Linha 5: custo inválido/);
  assert.match(result.examples[1], /Linha 6: .* fora da cotação/);
});

test('conflicting duplicates and ambiguous matches never fill a price', () => {
  const result = api.matchSupplierPrices([
    ['EAN', 'Custo'],
    ['00012345', '2,10'],
    ['00012345', '2.20'],
    ['00012345', '2.10'],
    ['7890000000001', 5],
    ['99999999', '7.00'],
    ['99999999', '7,00'],
  ], [...items, { id: 'other', ean: '7890000000001' }]);
  assert.deepEqual(prices(result), [['3', 7]]);
  assert.equal(result.ignored, 5);
  assert.throws(() => api.matchSupplierPrices([['EAN', 'Custo', 'Preço']], items), /apenas uma/);
});

test('CSV import preserves textual EAN zeros and supports both delimiters', async () => {
  for (const csv of ['\ufeffEAN;Custo\r\n00012345;5,40\r\n', 'EAN,Custo\n00012345,"5,40"\n']) {
    const result = await api.readSupplierPriceFile(new TextEncoder().encode(csv).buffer, 'precos.csv', items);
    assert.deepEqual(prices(result), [['1', 5.4]]);
  }
});

test('XLSX preserves formatted barcode zeros without rounding the raw price', async () => {
  const book = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([[], [null, 'EAN', 'Custo'], [null, 12345, 8.1234], [null, 7890000000001, 9]]);
  sheet.B3.z = '00000000';
  sheet.C3.z = '0.00';
  xlsx.utils.book_append_sheet(book, sheet, 'Precos');
  const file = xlsx.write(book, { type: 'array', bookType: 'xlsx' });
  assert.deepEqual(prices(await api.readSupplierPriceFile(file, 'precos.xlsx', items)), [['1', 8.1234], ['2', 9]]);
});
