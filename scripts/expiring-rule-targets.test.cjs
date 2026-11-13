const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const helpers = {};
vm.runInNewContext(compile('lib/expiring-rule-targets.ts'), { exports: helpers });
const offers = {};
vm.runInNewContext(compile('lib/expiring-a7-offer.ts'), { exports: offers });
const placement = {};
vm.runInNewContext(compile('lib/rule-target-placement.ts'), { exports: placement });

test('popup fits short, mobile and desktop viewports and flips above a low trigger', () => {
  for (const viewport of [{ width: 1200, height: 480 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const y of [20, 240, viewport.height - 70, viewport.height + 50]) {
      const result = placement.ruleTargetPlacement({ top: y, bottom: y + 48, right: viewport.width - 40 }, viewport);
      assert.ok(result.left >= 12);
      assert.ok(result.left + result.width <= viewport.width - 12);
      if (result.top !== undefined) { assert.ok(result.top >= 12); assert.ok(result.top + result.maxHeight <= viewport.height - 12); }
      else { assert.ok(result.bottom >= 12); assert.ok(result.bottom + result.maxHeight <= viewport.height - 12); }
    }
  }
  assert.ok(placement.ruleTargetPlacement({ top: 370, bottom: 418, right: 900 }, { width: 1200, height: 480 }).bottom !== undefined);
});

test('old single-target rules still match; multiple targets use OR, never all items', () => {
  const old = { scope_value: 'Logística', scope_values: [] };
  assert.equal(helpers.matchesExpiringRuleTarget(old, 'LOGISTICA'), true);
  const rule = { scope_value: 'A', scope_values: ['A', 'DOVE'] };
  assert.equal(helpers.matchesExpiringRuleTarget(rule, 'dove'), true);
  assert.equal(helpers.matchesExpiringRuleTarget(rule, 'OUTRO'), false);
  assert.equal(helpers.matchesExpiringRuleTarget({ scope_value: '', scope_values: [] }, 'A'), false);
});

function findAll(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...[tree.props?.children].flat(Infinity).flatMap(child => findAll(child, predicate))];
}
function text(tree) {
  if (typeof tree === 'string') return tree;
  return !tree || typeof tree !== 'object' ? '' : [tree.props?.children].flat(Infinity).map(text).join('');
}
function picker() {
  const slots = []; let index = 0; let selected = ['A']; let changes = 0;
  const exports = {};
  const element = (type, props) => ({ type, props });
  vm.runInNewContext(compile('app/components/rule-target-filter.tsx'), { exports, document: { body: {} }, require(name) {
    if (name === 'react') return {
      useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
      useMemo: fn => fn(), useEffect() {}, useCallback: fn => fn, useRef: value => ({ current: value }),
    };
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
    if (name === 'react-dom') return { createPortal: node => node };
    if (name === '@/lib/rule-target-placement') return placement;
    return new Proxy({}, { get: (_, key) => key });
  } });
  return {
    render() { index = 0; return exports.RuleTargetFilter({ label: 'Fabricante', options: ['A', 'DOVE', 'B'].map(value => ({ value, label: value })), selectedValues: selected, onChange(values) { selected = [...values]; changes++; } }); },
    values: () => selected, changes: () => changes,
  };
}
const button = (tree, name) => findAll(tree, node => node.type === 'button' && text(node).trim() === name)[0];
const open = app => findAll(app.render(), node => node.type === 'button')[0].props.onClick();

test('search, mark filtered and Apply preserve selections outside the search', () => {
  const app = picker(); open(app);
  findAll(app.render(), node => node.type === 'input' && !node.props.type)[0].props.onChange({ target: { value: 'dóve' } });
  const boxes = findAll(app.render(), node => node.type === 'input' && node.props.type === 'checkbox');
  assert.equal(boxes.length, 2);
  boxes[0].props.onChange();
  assert.equal(app.changes(), 0, 'checking items must not commit until Apply');
  button(app.render(), 'Aplicar').props.onClick();
  assert.deepEqual(app.values(), ['A', 'DOVE']);
});

test('mark all, clear and Cancel do not interpret an empty selection as all targets', () => {
  const app = picker(); open(app);
  findAll(app.render(), node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange();
  button(app.render(), 'Cancelar').props.onClick();
  assert.deepEqual(app.values(), ['A']);
  open(app);
  button(app.render(), 'Limpar').props.onClick();
  button(app.render(), 'Aplicar').props.onClick();
  assert.deepEqual(app.values(), []);
});

function route(role = 'admin') {
  const exports = {}; const writes = [];
  vm.runInNewContext(compile('app/api/expiring-products/rules/route.ts'), { exports, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (data, init) => new Response(JSON.stringify(data), init) } };
    if (name === '@/lib/server-auth') return { requireAuthenticatedProfile: async () => ({ ok: true, userId: 'actor', profile: { role, sector: 'Geral' } }) };
    if (name === '@/lib/permissions') return { isPricingSector: () => false };
    if (name === '@/lib/expiring-a7-offer') return offers;
    if (name === '@/lib/supabase-admin') return { getSupabaseAdmin: () => ({ from() { const chain = { insert(payload) { writes.push(payload[0]); return chain; }, select() { return chain; }, single: async () => ({ data: writes.at(-1), error: null }) }; return chain; } }) };
    throw new Error(name);
  } });
  return { writes, post: body => exports.POST(new Request('http://test/api/rules', { method: 'POST', body: JSON.stringify({ name: 'TESTE', scope_type: 'manufacturer', ...body }) })) };
}
test('API stores multiple targets in one rule, supports legacy clients and rejects empty selections', async () => {
  const api = route();
  assert.equal((await api.post({ scope_values: [' dove ', 'A', 'DOVE'] })).status, 200);
  assert.equal(api.writes.length, 1);
  assert.deepEqual([...api.writes[0].scope_values], ['DOVE', 'A']);
  assert.equal((await api.post({ scope_value: 'LEGADO' })).status, 200);
  assert.equal((await api.post({ scope_value: 'OLD', scope_values: [] })).status, 400);
  assert.equal((await api.post({ scope_values: [123] })).status, 400);
  const denied = route('membro');
  assert.equal((await denied.post({ scope_values: ['A'] })).status, 403);
  assert.equal(denied.writes.length, 0);
});

test('API persists both new price types and rejects invalid percentages', async () => {
  const api = route();
  for (const discount_type of ['cost_percent_price', 'sale_percent_price']) {
    assert.equal((await api.post({ scope_value: 'A', discount_type, discount_value: 42.5 })).status, 200);
    assert.equal(api.writes.at(-1).discount_type, discount_type);
    assert.equal(api.writes.at(-1).discount_value, 42.5);
    for (const discount_value of [undefined, 0, -1, 101]) {
      assert.equal((await api.post({ scope_value: 'A', discount_type, discount_value })).status, 400);
    }
  }
});

test('API persists inclusive day ranges and the optional monthly demand condition', async () => {
  const api = route();
  assert.equal((await api.post({ scope_type: 'validity', min_days_to_expire: 31, max_days_to_expire: 89, skip_if_demand_covers_balance: true })).status, 200);
  assert.equal(api.writes[0].skip_if_demand_covers_balance, true);
  assert.equal(api.writes[0].min_days_to_expire, 31);
  assert.equal(api.writes[0].max_days_to_expire, 89);
  for (const [min_days_to_expire, max_days_to_expire] of [[-1, 30], [31, 30], [0, 31.5], [null, 30], [0, '']]) {
    assert.equal((await api.post({ scope_type: 'validity', min_days_to_expire, max_days_to_expire })).status, 400);
  }
});

test('API saves structured offers and rejects impossible or unordered quantities', async () => {
  const api = route();
  const buyPay = offer_config => api.post({ scope_value: 'A', discount_type: 'buy_pay', offer_config });
  assert.equal((await buyPay({ take: 3, pay: 2 })).status, 200);
  assert.equal(api.writes.at(-1).offer_config.pay, 2);
  assert.equal((await buyPay({ take: 2, pay: 3 })).status, 400);
  const quantity = tiers => api.post({ scope_value: 'A', discount_type: 'quantity_discount', offer_config: { quantityType: 'A', aboveQuantity: 'B', tiers } });
  assert.equal((await quantity([{ quantity: 1, value: 5.1234 }, { quantity: 2, value: 10 }])).status, 200);
  assert.equal(api.writes.at(-1).offer_config.tiers[0].value, 5.1234);
  assert.equal((await quantity([{ quantity: 2, value: 5 }, { quantity: 1, value: 10 }])).status, 400);
  assert.equal((await quantity([{ quantity: 1, value: 101 }])).status, 400);
});

test('API stores rule type separately from the selected filter', async () => {
  const api = route();
  assert.equal((await api.post({ rule_type: 'general', scope_values: ['DOVE'] })).status, 200);
  assert.equal(api.writes[0].rule_type, 'general');
  assert.equal(api.writes[0].scope_type, 'manufacturer');
  assert.equal((await api.post({ rule_type: 'specific', scope_type: 'validity' })).status, 400);
  assert.equal((await api.post({ rule_type: 'unknown', scope_value: 'A' })).status, 400);
});
