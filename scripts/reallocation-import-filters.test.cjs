const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/reallocation-import-filters.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: api });

test('file manufacturer has priority over the catalog and duplicates are combined', () => {
  const result = api.buildImportFilterPreview([{ ean: 'a' }, { ean: 'a' }, { ean: 'b' }], [{ ean: 'a', manufacturer: 'Arquivo' }], new Map([['a', { manufacturer: 'Antigo' }], ['b', { manufacturer: 'Base' }]]), new Set(['a', 'b']));
  assert.equal(result.manufacturers.map(item => item.name).join(','), 'ARQUIVO,BASE');
  assert.equal(result.manufacturers[0].source, 'file');
  assert.equal(result.manufacturers[1].source, 'catalog');
});
test('unlinked manufacturers are shown but not preselected, and missing metadata is counted', () => {
  const filterPreview = api.buildImportFilterPreview([{ ean: 'a' }, { ean: 'b' }], [{ ean: 'a', manufacturer: 'Sem vínculo' }], new Map(), new Set());
  assert.equal(filterPreview.missingManufacturerRows, 1);
  assert.equal(filterPreview.manufacturers[0].linked, false);
  const selection = api.initialImportFilterSelection({ stores: [{ code: '1' }], filterPreview }, []);
  assert.equal(selection.manufacturers.length, 0);
});
test('all imported stores default to origin; destinations preserve only current stores in this file', () => {
  const selection = api.initialImportFilterSelection({ stores: [{ code: '1' }, { code: '02' }, { code: '001' }], filterPreview: { manufacturers: [{ name: 'BIC', linked: true }] } }, ['2', '99']);
  assert.equal(selection.origins.join(','), '01,02');
  assert.equal(selection.destinations.join(','), '02');
  assert.equal(selection.manufacturers.join(','), 'BIC');
  assert.equal(selection.clearOtherFilters, true);
});

test('applying the real preview handler changes only confirmed filters and never triggers calculation', () => {
  const source = ts.createSourceFile('manager.tsx', fs.readFileSync('app/components/reallocation-manager.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onApplyFilters' && node.initializer && ts.isJsxExpression(node.initializer)) handler = node.initializer.expression;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(handler);
  const compiled = ts.transpileModule(`export const apply = ${ts.createPrinter().printNode(ts.EmitHint.Expression, handler, source)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const clearOtherFilters of [true, false]) {
    const changes = {}, exports = {};
    const sandbox = { exports, normalizeImportStoreCode: api.normalizeImportStoreCode, branchOptions: [], importReport: { stores: [{ code: '1', name: 'Loja 1' }], filterPreview: { manufacturers: [{ name: 'BIC' }] } } };
    for (const name of ['ManufacturerFilters', 'OriginFilters', 'DestinationFilters', 'ProductFilters', 'ClassificationFilters', 'ClassificationLineFilters', 'ClassificationDepartmentFilters', 'ClassificationCategoryFilters', 'NeedTypeFilters', 'LastPurchaseSupplierFilters', 'ImportReport']) sandbox['set' + name] = value => { changes[name] = value; };
    vm.runInNewContext(compiled, sandbox);
    exports.apply({ manufacturers: ['BIC', 'FORA DO ARQUIVO'], origins: ['01'], destinations: [], clearOtherFilters });
    assert.equal(changes.ManufacturerFilters.map(item => item.id).join(','), 'BIC');
    assert.equal(changes.OriginFilters[0].id, '01');
    assert.equal(changes.DestinationFilters.length, 0);
    assert.equal('ProductFilters' in changes, clearOtherFilters);
    assert.equal(changes.ImportReport, null);
  }
});
