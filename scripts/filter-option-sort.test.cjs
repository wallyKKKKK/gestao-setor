const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/filter-option-sort.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });
const { nextFilterOptionSort, sortFilterOptions } = api;
const rows = [
  { id: 'ten', columns: ['10', 'ZETA', 'CAMETÁ'] },
  { id: 'two', columns: ['02', 'ÁGUA', 'ABAETETUBA'] },
  { id: 'one', columns: ['01', 'BARCARENA', 'ABAETETUBA'] },
];
const ids = items => Array.from(items, item => item.id).join(',');

test('double click alternates directions and changing columns starts ascending', () => {
  let sort = nextFilterOptionSort(null, 0);
  assert.equal(sort.direction, 'asc');
  sort = nextFilterOptionSort(sort, 0);
  assert.equal(sort.direction, 'desc');
  sort = nextFilterOptionSort(sort, 1);
  assert.equal(sort.index, 1);
  assert.equal(sort.direction, 'asc');
});
test('codes sort numerically rather than lexicographically', () => {
  assert.equal(ids(sortFilterOptions(rows, { index: 0, direction: 'asc' })), 'one,two,ten');
  assert.equal(ids(sortFilterOptions(rows, { index: 0, direction: 'desc' })), 'ten,two,one');
});
test('names respect Portuguese accents and equal cities retain their relative order', () => {
  assert.equal(ids(sortFilterOptions(rows, { index: 1, direction: 'asc' })), 'two,one,ten');
  assert.equal(ids(sortFilterOptions(rows, { index: 2, direction: 'asc' })), 'two,one,ten');
});
test('sorting never changes source options, item identities or selections', () => {
  const selected = new Set(['two']);
  const sorted = sortFilterOptions(rows, { index: 0, direction: 'asc' });
  assert.equal(ids(rows), 'ten,two,one');
  assert.equal(sorted[1], rows[1]);
  assert.equal(selected.has(sorted[1].id), true);
  assert.equal(sortFilterOptions(rows, null), rows);
});
test('empty lists and missing column values are supported', () => {
  assert.equal(sortFilterOptions([], { index: 0, direction: 'asc' }).length, 0);
  const items = [{ id: 'empty', columns: [] }, ...rows];
  assert.equal(sortFilterOptions(items, { index: 1, direction: 'asc' })[0].id, 'empty');
});

test('the real table header renders the same arrows and active color as filter headers', () => {
  const source = ts.createSourceFile('manager.tsx', fs.readFileSync('app/components/reallocation-manager.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let renderer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'renderSuggestionHeader') renderer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(renderer);
  const expression = ts.createPrinter().printNode(ts.EmitHint.Expression, renderer, source);
  const compiled = ts.transpileModule(`export const renderHeader = ${expression};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const direction of ['asc', 'desc']) {
    const exports = {};
    vm.runInNewContext(compiled, { exports, require, ...require('lucide-react'), suggestionSort: [
      { key: 'description', direction }, { key: 'originName', direction: 'desc' },
    ], suggestionColumnWidths: {} });
    const React = require('react');
    const html = require('react-dom/server').renderToStaticMarkup(React.createElement('table', null, React.createElement('thead', null, React.createElement('tr', null,
      exports.renderHeader({ key: 'description', label: 'Produto', width: 120 }),
      exports.renderHeader({ key: 'originName', label: 'Apelido', width: 120 }),
    ))));
    assert.match(html, new RegExp(`aria-sort="${direction === 'asc' ? 'ascending' : 'descending'}"`));
    assert.equal((html.match(/aria-sort=/g) || []).length, 1);
    assert.match(html, /<span>1<\/span>/);
    assert.match(html, /<span>2<\/span>/);
    assert.match(html, /Prioridade 2: ordem decrescente/);
    assert.match(html, /bg-violet-50 text-violet-700/);
    assert.match(html, new RegExp(direction === 'asc' ? 'lucide-arrow-up' : 'lucide-arrow-down'));
    assert.doesNotMatch(html, /A-Z|Z-A/);
  }
});
