const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const source = readFileSync(path.join(__dirname, '../lib/reallocation-row-markers.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsForTest = {};
vm.runInNewContext(compiled, { exports: exportsForTest });
const markers = (row) => Array.from(exportsForTest.getReallocationRowMarkers(row));
const row = { quantity: 3, maxQuantity: 3 };

test('plain suggestions have no markers', () => {
  assert.deepEqual(markers(row), []);
});

test('manual and minimum-stock markers can coexist', () => {
  assert.deepEqual(markers({ ...row, quantity: 2, minimumStockQuantity: 1 }), ['manual', 'minimum']);
  assert.deepEqual(markers({ ...row, minimumStockQuantity: 0 }), []);
});

test('rateio filter shows automatic splits without treating them as manual decisions', () => {
  assert.deepEqual(markers({ ...row, automaticSplitDestinations: 2 }), ['split']);
  assert.deepEqual(markers({ ...row, automaticSplitGroups: ['01'] }), ['split']);
  assert.deepEqual(markers({ ...row, automaticSplitDestinations: 1 }), []);
  assert.deepEqual(markers({ ...row, decisionRequired: true }), []);
});
