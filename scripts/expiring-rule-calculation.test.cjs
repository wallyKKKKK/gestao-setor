const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => dependencies[name] });
  return exports;
}

const a7 = load('lib/expiring-a7-offer.ts');
const { classifyExpiringItem, sortExpiringRules } = load('lib/expiring-rule-calculation.ts', {
  './expiring-rule-targets': load('lib/expiring-rule-targets.ts'),
  './expiring-a7-offer': a7,
});
const item = { ean: '00123', manufacturer: 'Fábrica A', line: 'Perfumaria', department: 'Capilar', category: 'Coloração', classification_path: 'Perfumaria > Capilar > Coloração', days_to_expire: 30, cost_price: 40, sale_price: 60 };
const rule = (overrides = {}) => ({ name: 'Teste', scope_type: 'validity', scope_value: 'VALIDADE', is_active: true, priority: 100, min_days_to_expire: 0, max_days_to_expire: 30, discount_type: 'percent', discount_value: 25, ...overrides });
const calculate = (rules, overrides = {}) => classifyExpiringItem({ ...item, ...overrides }, sortExpiringRules(rules), 60);

test('all target types match the relevant field and respect expiration', () => {
  for (const [scope_type, scope_value] of Object.entries({
    product: '00123', manufacturer: 'FABRICA A', line: 'PERFUMARIA', department: 'CAPILAR', category: 'COLORACAO',
    classification: 'PERFUMARIA>CAPILAR>COLORACAO', validity: 'VALIDADE',
  })) {
    const target = rule({ scope_type, scope_value, scope_values: ['OUTRO', scope_value] });
    assert.equal(calculate([target]).rule, target);
    assert.equal(calculate([target], { days_to_expire: 31 }).rule, null);
    assert.equal(calculate([{ ...target, is_active: false }]).rule, null);
    if (scope_type !== 'validity') assert.equal(calculate([{ ...target, scope_values: ['OUTRO'] }]).rule, null);
  }
});

test('legacy discounts and percentage-based final prices use the intended bases', () => {
  for (const [discount_type, expected] of [['percent', 45], ['fixed_price', 25], ['half_cost_price', 20], ['cost_percent_price', 10], ['sale_percent_price', 15]]) {
    assert.equal(calculate([rule({ discount_type })]).price, expected);
  }
});

test('missing imported prices are reported and can fall back to another matching rule', () => {
  const costRule = rule({ discount_type: 'cost_percent_price', priority: 1 });
  const result = calculate([costRule], { cost_price: 0 });
  assert.equal(result.rule, null);
  assert.equal(result.rejectedRule, costRule);
  assert.match(result.exclusionReason, /Custo/);
  assert.match(calculate([rule({ discount_type: 'sale_percent_price' })], { sale_price: 0 }).exclusionReason, /venda/);
  assert.equal(calculate([rule(), costRule], { cost_price: 0 }).price, 45);
  assert.equal(calculate([rule(), costRule]).price, 10);
  assert.match(calculate([]).exclusionReason, /Nenhuma regra ativa/);
});

test('A7 export matches the supplied A through G layouts', () => {
  const tiers = [5, 6, 7].map((value, index) => ({ quantity: index + 1, value }));
  for (const [discount_type, discount_value, offer_config, expected] of [
    ['fixed_price', 12, null, 'A|00123|||12.0000'],
    ['percent', 10, null, 'B|00123|||10.0000'],
    ['buy_pay', 0, { take: 3, pay: 2 }, 'C|00123|||3|2'],
    ['quantity_discount', 0, { quantityType: 'A', aboveQuantity: 'A', tiers }, 'D|00123|||A|A|1;5.0000|2;6.0000|3;7.0000'],
    ['cost_markup', 20, null, 'E|00123|||20.0000'],
    ['average_cost_markup', 30, null, 'F|00123|||30.0000'],
    ['reference_price_markup', 10, null, 'G|00123|||10.0000'],
  ]) {
    assert.equal(calculate([rule({ discount_type, discount_value, offer_config })], { cost_price: 0, sale_price: 0 }).line, expected);
  }
  for (const quantityType of Object.keys(a7.quantityOfferTypes)) {
    assert.equal(a7.formatA7OfferLine('ET001', 'quantity_discount', 0, { quantityType, aboveQuantity: 'B', tiers }), `D|ET001|||${quantityType}|B|1;5.0000|2;6.0000|3;7.0000`);
  }
  assert.equal(a7.formatA7OfferLine('bad|code', 'fixed_price', 1), null);
});
