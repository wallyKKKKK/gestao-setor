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

function manager({ catalogFailure = false } = {}) {
  let cursor = 0;
  const slots = [], effects = [], listeners = {};
  const inventoryCalls = 0;
  const api = {
    fetchExpiringDiscountRules: async () => ({ rules: [], missingTable: false }),
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
  const element = (type, props) => ({ type, props });
  const XLSX = require('xlsx-js-style');
  let exported;
  vm.runInNewContext(compile('app/components/expiring-products-manager.tsx') + '\nexports.seedCache = value => { expiringManagerCache = value; };', {
    exports,
    alert() {},
    window: { setTimeout(fn) { fn(); return 1; }, clearTimeout() {}, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {} },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === '@/lib/api') return api;
      if (name === '@/lib/expiring-classification') return classification;
      if (name === '@/lib/expiring-rule-calculation') return calculation;
      if (name === '@/lib/expiring-a7-offer') return offers;
      if (name === 'xlsx-js-style') return { ...XLSX, writeFile(workbook, filename) {
        const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        exported = { filename, workbook: XLSX.read(bytes, { type: 'buffer' }) };
      } };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  exports.seedCache({ items: [{ id: 'current-import', ean: '123', description: 'Arquivo atual', branch_code: '01', branch_name: 'Loja', manufacturer: '', line: '', department: '', category: '', classification_path: '', days_to_expire: 60, balance_quantity: 1 }], rules: [], disabledRuleIds: [], branches: [], pricingProducts: [], masterProducts: [], catalogManufacturers: [], catalogClassifications: [], missingTable: false });
  return {
    calls: () => inventoryCalls,
    exported: () => exported,
    render() { cursor = 0; const tree = exports.ExpiringProductsManager(); effects.splice(0).forEach(fn => fn()); return tree; },
  };
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return !tree || typeof tree !== 'object' ? '' : [tree.props?.children].flat(Infinity).map(text).join('');
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
  const selector = find(tree, node => node.type === 'RuleTargetFilter');
  assert.equal(selector.props.options[0].value, 'INFANTIL');
});

test('catalog failures are visible and do not discard the current import', async () => {
  const app = manager({ catalogFailure: true }); app.render(); await flush();
  const tree = app.render();
  assert.match(text(tree), /1 lotes/);
  assert.match(text(find(tree, node => node.props?.role === 'alert')), /fabricantes, categorias e classificações/);
});

test('items with no active rules appear in the exclusions report and export to XLSX', async () => {
  const app = manager(); app.render(); await flush();
  const button = (tree, pattern) => find(tree, node => node.type === 'button' && pattern.test(text(node).trim()));
  button(app.render(), /^03.*Calcular/).props.onClick();
  button(app.render(), /Aplicar regras e gerar relatorio/).props.onClick();
  const report = app.render();
  assert.match(text(report), /Fora das regras \(1\)/);
  assert.match(text(report), /Nenhuma regra ativa para o alvo e o prazo/);
  await button(report, /Exportar XLSX/).props.onClick();
  await flush();
  const { filename, workbook } = app.exported();
  assert.match(filename, /\.xlsx$/);
  const [row] = require('xlsx-js-style').utils.sheet_to_json(workbook.Sheets['Fora das regras']);
  assert.equal(row.EAN, '123');
  assert.match(row.Motivo, /Nenhuma regra ativa/);
});
