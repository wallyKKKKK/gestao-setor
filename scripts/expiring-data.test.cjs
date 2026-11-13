const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const classification = {};
vm.runInNewContext(compile('lib/expiring-classification.ts'), { exports: classification });
const targets = {};
vm.runInNewContext(compile('lib/expiring-rule-targets.ts'), { exports: targets });
const calculation = {};
const offers = {};
vm.runInNewContext(compile('lib/expiring-a7-offer.ts'), { exports: offers });
vm.runInNewContext(compile('lib/expiring-rule-calculation.ts'), { exports: calculation, require: name => name === './expiring-a7-offer' ? offers : targets });

test('rule targets use the same classification hierarchy as imports', () => {
  for (const [path, expected] of [
    ['PRINCIPAL > PERFUMARIA > INFANTIL', ['PERFUMARIA', 'INFANTIL', 'INFANTIL']],
    ['PRINCIPAL > PERFUMARIA > CAPILAR > COLORAÇÃO', ['PERFUMARIA', 'CAPILAR', 'COLORAÇÃO']],
    ['PERFUMARIA > CAPILAR > COLORAÇÃO', ['PERFUMARIA', 'CAPILAR', 'COLORAÇÃO']],
    ['', ['', '', '']],
  ]) {
    const result = classification.expiringClassificationParts(path);
    assert.deepEqual([result.line, result.department, result.category], expected);
  }
});

test('import reads monthly sales for the row and does not confuse missing demand with zero or a purchase demand', async () => {
  const XLSX = require('xlsx');
  const exports = {};
  vm.runInNewContext(compile('app/api/expiring-products/import/route.ts'), { exports, File, Buffer, console, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (data, init) => new Response(JSON.stringify(data), init) } };
    if (name === 'xlsx') return XLSX;
    if (name === '@/lib/server-auth') return { requireAuthenticatedProfile: async () => ({ ok: true, userId: 'user', profile: { role: 'admin' } }) };
    if (name === '@/lib/permissions') return {};
    if (name === '@/lib/expiring-classification') return classification;
    if (name === '@/lib/supabase-admin') return { getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) }) };
    throw new Error(name);
  } });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Loja', 'EAN', 'Lote', 'Saldo', 'Dias', 'Média de Venda Mensal', 'Demanda de Compra (Ult. 30 Dias)'],
    ['01', '123', 'A', 15, 50, '60,5', 99],
    ['02', '123', 'A', 15, 50, 0, 99],
    ['03', '123', 'A', 15, 50, '', 99],
  ]), 'Lotes');
  const form = new FormData();
  form.set('file', new File([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })], 'lotes.xlsx'));
  const response = await exports.POST({ formData: async () => form });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items.map(item => item.monthly_average), [60.5, 0, null]);
});

function attributesRoute({ authenticated = true, fail = false } = {}) {
  const exports = {};
  let calls = 0;
  const options = Array.from({ length: 1202 }, (_, i) => ({ value: `FAB ${i}`, count: i + 1 }));
  vm.runInNewContext(compile('app/api/reallocation/products/attributes/route.ts'), {
    exports, URL,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (data, init) => new Response(JSON.stringify(data), init) } };
      if (name === '@/lib/server-auth') return { requireAuthenticatedProfile: async () => authenticated ? { ok: true, profile: { role: 'admin' } } : { ok: false, response: new Response('', { status: 401 }) } };
      if (name === '@/lib/supabase-admin') return { getSupabaseAdmin: () => ({ rpc: async (fn, args) => {
        calls++; assert.equal(fn, 'reallocation_product_attribute_summary'); assert.equal(args.attribute_field, 'manufacturer');
        return fail ? { error: new Error('query failed') } : { data: options, error: null };
      }, from() { throw new Error('Row-by-row catalog scan must not be used'); } }) };
      return {};
    },
  });
  return { get: field => exports.GET(new Request(`http://test/api/attributes?field=${field}`)), calls: () => calls };
}

test('catalog summary returns over 1000 distinct options with one database call', async () => {
  const route = attributesRoute();
  const result = await (await route.get('manufacturer')).json();
  assert.equal(result.options.length, 1202);
  assert.equal(result.options[0].count, 1202);
  assert.equal(route.calls(), 1);
  await route.get('manufacturer');
  assert.equal(route.calls(), 1, 'successful summaries remain cached');
});

test('summary errors are reported, never cached as an empty success; auth remains required', async () => {
  const failed = attributesRoute({ fail: true });
  assert.equal((await failed.get('manufacturer')).status, 400);
  assert.equal((await failed.get('manufacturer')).status, 400);
  assert.equal(failed.calls(), 2);
  const anonymous = attributesRoute({ authenticated: false });
  assert.equal((await anonymous.get('manufacturer')).status, 401);
  assert.equal(anonymous.calls(), 0);
  const invalid = attributesRoute();
  assert.equal((await invalid.get('unknown')).status, 400);
  assert.equal(invalid.calls(), 0);
});

function manager({ catalogFailure = false, rules = [], prices = {}, extraItems = [] } = {}) {
  let cursor = 0;
  const slots = [], effects = [], listeners = {};
  const inventoryCalls = 0;
  const savedRules = [];
  const api = {
    fetchExpiringDiscountRules: async () => ({ rules, missingTable: false }),
    saveExpiringDiscountRule: async rule => { savedRules.push(rule); return { ...rule, id: 'saved-rule' }; },
    fetchExpiringInventoryItems: async () => { throw new Error('Do not reload legacy imports into the current process'); },
    fetchPricingBranches: async () => [], fetchPricingProducts: async () => [], fetchReallocationProducts: async () => [],
    fetchReallocationAttributeSummary: async field => {
      if (catalogFailure) throw new Error('offline');
      return [{ value: field === 'manufacturer' ? 'FABRICANTE' : 'PRINCIPAL > PERFUMARIA > INFANTIL', count: 1 }];
    },
  };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo: fn => fn(),
    useCallback(fn) { const i = cursor++; return slots[i] ||= fn; },
    useEffect(fn) { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(fn); } },
  };
  const exports = {};
  const element = (type, props) => type?.name === 'ImportedPriceCell' ? type(props) : ({ type, props });
  const XLSX = require('xlsx-js-style');
  let exported;
  const downloads = [];
  let downloadBlob;
  vm.runInNewContext(compile('app/components/expiring-products-manager.tsx') + '\nexports.seedCache = value => { expiringManagerCache = value; };', {
    exports,
    alert() {},
    Blob,
    URL: { createObjectURL(blob) { downloadBlob = blob; return 'blob:test'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() { downloads.push({ filename: this.download, blob: downloadBlob }); } }) },
    window: { setTimeout(fn) { fn(); return 1; }, clearTimeout() {}, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {} },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === '@/lib/api') return api;
      if (name === '@/lib/expiring-classification') return classification;
      if (name === '@/lib/expiring-rule-calculation') return calculation;
      if (name === '@/lib/expiring-a7-offer') return offers;
      if (name === 'fflate') return require('fflate');
      if (name === '@/app/components/table-sort') return { useColumnSort: () => ({ sortRowsBy: rows => rows }), SortableTableHeader: 'th' };
      if (name === 'xlsx-js-style') return { ...XLSX, writeFile(workbook, filename) {
        const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        exported = { filename, workbook: XLSX.read(bytes, { type: 'buffer' }) };
      } };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  const item = { id: 'current-import', ean: '123', description: 'Arquivo atual', branch_code: '01', branch_name: 'Loja', manufacturer: '', line: '', department: '', category: '', classification_path: '', days_to_expire: 60, balance_quantity: 1, ...prices };
  exports.seedCache({ items: [item, ...extraItems.map(row => ({ ...item, ...row }))], rules: [], disabledRuleIds: [], branches: [], pricingProducts: [], masterProducts: [], catalogManufacturers: [], catalogClassifications: [], missingTable: false });
  return {
    savedRules,
    calls: () => inventoryCalls,
    exported: () => exported,
    downloads,
    render() { cursor = 0; const tree = exports.ExpiringProductsManager(); effects.splice(0).forEach(fn => fn()); return tree; },
  };
}

test('price at cost is selectable and saves 100 percent without a manual field', async () => {
  const app = manager(); app.render(); await flush();
  const button = label => find(app.render(), node => node.type === 'button' && text(node).trim() === label);
  button('Nova regra').props.onClick();
  const offer = () => find(app.render(), node => node.type?.name === 'RuleSearchableSelect' && node.props.placeholder === 'Tipo de oferta');
  const atCost = offer().props.options.find(option => option.label === 'A - Preço de custo');
  assert.ok(atCost);
  offer().props.onChange(atCost.value);
  assert.equal(offer().props.value, atCost.value);
  assert.doesNotMatch(text(app.render()), /Percentual \(%\)/);
  button('Salvar regra').props.onClick();
  await flush();
  assert.equal(app.savedRules[0].discount_type, 'cost_percent_price');
  assert.equal(app.savedRules[0].discount_value, 100);
});
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return !tree || typeof tree !== 'object' ? '' : [tree.props?.children ?? (tree.type === 'th' ? tree.props?.column : '')].flat(Infinity).map(text).join('');
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
  return null;
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('current import is preserved and short classifications populate category targets', async () => {
  const app = manager(); app.render(); await flush();
  let tree = app.render();
  assert.equal(app.calls(), 0);
  assert.match(text(tree), /1 lotes/);
  find(tree, node => node.type === 'button' && text(node).trim() === 'Nova regra').props.onClick();
  tree = app.render();
  const kind = find(tree, node => node.type === 'select' && text(node) === 'GeralEspecífica');
  assert.equal(kind.props.value, 'general');
  const scope = find(tree, node => node.type?.name === 'RuleSearchableSelect' && node.props.value === 'validity');
  assert.ok(scope.props.options.some(option => option.value === 'manufacturer'));
  scope.props.onChange('category');
  tree = app.render();
  const generalFilter = find(tree, node => node.type === 'RuleTargetFilter');
  generalFilter.props.onChange(['INFANTIL']);
  assert.match(text(tree), /Mínimo \(dias\).*Máximo \(dias\)/);
  assert.match(text(tree), /demanda mensal da loja/);
  kind.props.onChange({ target: { value: 'specific' } });
  tree = app.render();
  const selector = find(tree, node => node.type === 'RuleTargetFilter');
  assert.equal(selector.props.options[0].value, 'INFANTIL');
  assert.equal(selector.props.selectedValues[0], 'INFANTIL');
});

test('catalog failures are visible and do not discard the current import', async () => {
  const app = manager({ catalogFailure: true }); app.render(); await flush();
  const tree = app.render();
  assert.match(text(tree), /1 lotes/);
  assert.match(text(find(tree, node => node.props?.role === 'alert')), /fabricantes, categorias e classificações/);
});

test('items with no active rules appear in the exclusions report and export to XLSX', async () => {
  const app = manager({ prices: { cost_price: 7.23, sale_price: 13.42 } }); app.render(); await flush();
  const button = (tree, pattern) => find(tree, node => node.type === 'button' && pattern.test(text(node).trim()));
  button(app.render(), /^03.*Calcular/).props.onClick();
  button(app.render(), /Aplicar regras e gerar relatorio/).props.onClick();
  const report = app.render();
  assert.match(text(report), /Fora das regras \(1\)/);
  assert.match(text(report), /Nenhuma regra ativa para o alvo e o prazo/);
  assert.match(text(report), /Custo importadoVenda importada/);
  assert.match(text(report), /R\$\s*7,23R\$\s*13,42/);
  await button(report, /Exportar XLSX/).props.onClick();
  await flush();
  const { filename, workbook } = app.exported();
  assert.match(filename, /\.xlsx$/);
  const [row] = require('xlsx-js-style').utils.sheet_to_json(workbook.Sheets['Fora das regras']);
  assert.equal(row.EAN, '123');
  assert.equal(row.Custo, 7.23);
  assert.equal(row.Venda, 13.42);
  assert.match(row.Motivo, /Nenhuma regra ativa/);
});

test('offers show imported cost separately from calculated price and leave missing sales blank', async () => {
  const app = manager({ prices: { cost_price: 7.23, sale_price: 0 }, rules: [{ id: 'fixed', name: 'FIXO', scope_type: 'validity', min_days_to_expire: 0, max_days_to_expire: 90, is_active: true, discount_type: 'fixed_price', discount_value: 8.75 }] });
  app.render(); await flush();
  find(app.render(), node => node.type === 'button' && /^03.*Calcular/.test(text(node).trim())).props.onClick();
  find(app.render(), node => node.type === 'button' && /Aplicar regras e gerar relatorio/.test(text(node))).props.onClick();
  const report = text(app.render());
  assert.match(report, /Custo importadoVenda importadaPreco baseOferta/);
  assert.match(report, /R\$\s*7,23-R\$\s*8,75/);
  assert.doesNotMatch(report, /R\$\s*0,00/);
});

test('TXT and ZIP downloads preserve the calculated report for review and repeated export', async () => {
  const app = manager({ rules: [{ id: 'percent', name: 'DESCONTO', scope_type: 'validity', min_days_to_expire: 0, max_days_to_expire: 90, is_active: true, discount_type: 'percent', discount_value: 20 }] });
  app.render(); await flush();
  const click = pattern => find(app.render(), node => node.type === 'button' && pattern.test(text(node).trim())).props.onClick();
  click(/^03.*Calcular/);
  click(/Aplicar regras e gerar relatorio/);
  click(/^05.*Exportar/);
  click(/^Exportar Arquivo$/);
  assert.match(app.downloads[0].filename, /\.txt$/);
  assert.equal(await app.downloads[0].blob.text(), 'B|123|||20.0000');
  assert.match(text(app.render()), /1 linhas prontas/);
  click(/^Separado por loja$/);
  click(/^Exportar Arquivo$/);
  assert.match(app.downloads[1].filename, /\.zip$/);
  const { unzipSync, strFromU8 } = require('fflate');
  const files = unzipSync(new Uint8Array(await app.downloads[1].blob.arrayBuffer()));
  assert.deepEqual(Object.values(files).map(bytes => strFromU8(bytes)), ['B|123|||20.0000']);
  click(/^04.*Relatorio/);
  assert.match(text(app.render()), /Em oferta \(1\).*Arquivo atual/);
});

test('conflicting lots require an explicit choice and the report opens rule details', async () => {
  const rule = { id: 'first', name: 'PRIMEIRA', scope_type: 'validity', min_days_to_expire: 0, max_days_to_expire: 60, is_active: true, discount_type: 'percent', discount_value: 20 };
  const app = manager({ rules: [rule, { ...rule, id: 'second', name: 'SEGUNDA', min_days_to_expire: 61, max_days_to_expire: 90, discount_value: 10 }], extraItems: [{ id: 'another', lot: 'B', days_to_expire: 80 }] });
  app.render(); await flush();
  const button = pattern => find(app.render(), node => node.type === 'button' && pattern.test(text(node).trim()));
  button(/^03.*Calcular/).props.onClick();
  button(/Aplicar regras e gerar relatorio/).props.onClick();
  button(/^Arquivo atual$/).props.onClick();
  assert.match(text(app.render()), /Regra aplicada: PRIMEIRA.*Fora da faixa de dias/);
  button(/^05.*Exportar/).props.onClick();
  assert.equal(button(/^Exportar Arquivo$/).props.disabled, true);
  button(/^Exportar Arquivo$/).props.onClick();
  assert.equal(app.downloads.length, 0);
  const choices = find(app.render(), node => node.type === 'select' && /Escolha a oferta/.test(text(node)));
  choices.props.onChange({ target: { value: 'B|123|||10.0000' } });
  assert.equal(button(/^Exportar Arquivo$/).props.disabled, false);
  button(/^Exportar Arquivo$/).props.onClick();
  assert.equal(await app.downloads[0].blob.text(), 'B|123|||10.0000');
});

test('offer column filters control the report and TXT, while hiding columns does not change results', async () => {
  const rule = { id: 'discount', name: 'DESCONTO', scope_type: 'validity', min_days_to_expire: 0, max_days_to_expire: 90, is_active: true, discount_type: 'percent', discount_value: 20 };
  const app = manager({ rules: [rule], extraItems: [{ id: 'second', ean: '456', description: 'Outro produto', branch_code: '02' }] });
  app.render(); await flush();
  const button = pattern => find(app.render(), node => node.type === 'button' && pattern.test(text(node).trim()));
  button(/^03.*Calcular/).props.onClick();
  button(/Aplicar regras e gerar relatorio/).props.onClick();
  const store = find(app.render(), node => node.type === 'RuleTargetFilter' && node.props.compact && node.props.label === 'Loja');
  assert.equal(store.props.options.length, 2);
  const header = column => find(app.render(), node => node.type === 'th' && node.props.column === column);
  header('branch').props.onDragStart({ dataTransfer: { setData() {} } });
  header('description').props.onDrop({ preventDefault() {} });
  assert.match(text(app.render()), /LojaProduto \/ loteSaldo/);
  store.props.onChange(['02']);
  assert.doesNotMatch(text(app.render()), /Arquivo atual/);
  button(/^Configurar colunas/).props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) } });
  const menu = find(app.render(), node => node.type === 'TableColumnMenu');
  menu.props.onToggle('branch');
  assert.match(text(app.render()), /1 ocultas/);
  assert.match(text(app.render()), /Outro produto/);
  menu.props.onClose();
  button(/^05.*Exportar/).props.onClick();
  button(/^Exportar Arquivo$/).props.onClick();
  assert.equal(await app.downloads[0].blob.text(), 'B|456|||20.0000');
  button(/^04.*Relatorio/).props.onClick();
  button(/^Limpar filtros das colunas/).props.onClick();
  assert.match(text(app.render()), /Arquivo atual/);
});
