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
const markers = (...args) => Array.from(exportsForTest.getReallocationRowMarkers(...args));
const row = { quantity: 3, maxQuantity: 3 };

test('plain suggestions have no markers', () => {
  assert.deepEqual(markers(row, 1, 1), []);
});

test('route filters use original allocation counts, including shared routes', () => {
  assert.deepEqual(markers(row, 2, 1), ['multiDestination']);
  assert.deepEqual(markers(row, 1, 2), ['multiOrigin']);
  assert.deepEqual(markers(row, 2, 2), ['shared', 'multiDestination', 'multiOrigin']);
});

test('manual and minimum-stock markers can coexist', () => {
  assert.deepEqual(markers({ ...row, quantity: 2, minimumStockQuantity: 1 }, 1, 1), ['manual', 'minimum']);
  assert.deepEqual(markers({ ...row, minimumStockQuantity: 0 }, 1, 1), []);
});

test('tie filter includes only unresolved decisions', () => {
  assert.deepEqual(markers({ ...row, decisionRequired: true }, 1, 1), ['tie']);
  assert.deepEqual(markers({ ...row, decisionRequired: true, decisionResolved: true }, 1, 1), []);
});
