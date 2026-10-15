const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const source = readFileSync(path.join(__dirname, '../lib/table-column-visibility.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports });
const columns = [{ key: 'selection' }, { key: 'description' }, { key: 'quantity' }];
const read = (value) => Array.from(moduleExports.readHiddenTableColumns(value, columns));

test('legacy preferences keep every column visible', () => {
  assert.deepEqual(read(undefined), []);
  assert.deepEqual(read('description'), []);
});

test('hidden preferences reject unknown, removed, and duplicate columns', () => {
  assert.deepEqual(read(['quantity', 'actions', 'unknown', 'quantity', 1]), ['quantity']);
});

test('at least one column remains visible even with malformed saved preferences', () => {
  assert.equal(read(['selection', 'description', 'quantity']).length, 2);
});
