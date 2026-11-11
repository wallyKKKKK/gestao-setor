const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/reallocation-table-sort.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: api });
const { nextReallocationSort, readReallocationSort, sortReallocationRows } = api;
const signature = rules => Array.from(rules, ({ key, direction }) => `${key}:${direction}`).join(',');

test('double click adds a tie-breaker, toggles in place and replaces only the second priority', () => {
  const first = nextReallocationSort([], 'description');
  const second = nextReallocationSort(first, 'originName');
  assert.equal(signature(second), 'description:asc,originName:asc');
  assert.equal(signature(nextReallocationSort(second, 'originName')), 'description:asc,originName:desc');
  assert.equal(signature(nextReallocationSort(second, 'description')), 'description:desc,originName:asc');
  assert.equal(signature(nextReallocationSort(second, 'destinationName')), 'description:asc,destinationName:asc');
  assert.equal(signature(nextReallocationSort(second, 'description', 'asc')), signature(second));
});

test('the second criterion sorts within the first, retaining source order for complete ties', () => {
  const rows = [
    { id: 1, description: 'Batom', originName: 'Loja 10' },
    { id: 2, description: 'Água', originName: 'Loja 10' },
    { id: 3, description: 'Agua', originName: 'Loja 2' },
    { id: 4, description: 'Batom', originName: 'Loja 2' },
    { id: 5, description: 'Água', originName: 'Loja 2' },
  ];
  const rules = nextReallocationSort(nextReallocationSort([], 'description'), 'originName');
  const ids = sort => Array.from(sortReallocationRows(rows, sort, (row, key) => row[key]), row => row.id).join(',');
  assert.equal(ids(rules), '3,5,2,4,1');
  assert.equal(ids(nextReallocationSort(rules, 'originName')), '2,3,5,1,4');
  assert.equal(ids([]), '1,2,3,4,5');
});

test('stored preferences accept the old single rule and reject invalid and duplicate rules', () => {
  const valid = new Set(['description', 'originName', 'quantity']);
  const first = { key: 'description', direction: 'desc' };
  assert.equal(signature(readReallocationSort(first, valid)), 'description:desc');
  assert.equal(signature(readReallocationSort([null, { key: 'selection', direction: 'asc' }, first,
    { key: 'description', direction: 'asc' }, { key: 'quantity', direction: 'bad' },
    { key: 'originName', direction: 'asc' }, { key: 'quantity', direction: 'asc' }], valid)), 'description:desc,originName:asc');
});
