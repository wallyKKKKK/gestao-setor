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
const { classifyExpiringItem, expiringBalancesByDeadline, expiringDateReview, expiringPriceWarnings, groupExpiringOffers, sortExpiringRules } = load('lib/expiring-rule-calculation.ts', {
  './expiring-rule-targets': load('lib/expiring-rule-targets.ts'),
  './expiring-a7-offer': a7,
});
const item = { ean: '00123', manufacturer: 'Fábrica A', line: 'Perfumaria', department: 'Capilar', category: 'Coloração', classification_path: 'Perfumaria > Capilar > Coloração', days_to_expire: 30, cost_price: 40, sale_price: 60 };
const rule = (overrides = {}) => ({ name: 'Teste', scope_type: 'validity', scope_value: 'VALIDADE', is_active: true, priority: 100, min_days_to_expire: 0, max_days_to_expire: 30, discount_type: 'percent', discount_value: 25, ...overrides });
const calculate = (rules, overrides = {}) => classifyExpiringItem({ ...item, ...overrides }, sortExpiringRules(rules), 60);

test('selling at imported cost exports an A7 fixed price without rounding away cost precision', () => {
  const atCost = rule({ discount_type: 'cost_percent_price', discount_value: 100 });
  const result = calculate([atCost], { cost_price: 12.3456, sale_price: 20 });
  assert.equal(result.price, 12.3456);
  assert.equal(result.line, 'A|00123|||12.3456');
  assert.deepEqual([...expiringPriceWarnings(result)], []);
  const missing = calculate([atCost], { cost_price: 0 });
  assert.equal(missing.line, null);
  assert.match(missing.exclusionReason, /Custo ausente/);
});

test('TXT review separates stores for ZIP and merges identical lines without losing warnings', () => {
  const discount = rule();
  const other = rule({ discount_value: 10 });
  const a = calculate([discount], { branch_code: '01' });
  const b = calculate([discount], { branch_code: '01', cost_price: 50 });
  const c = calculate([other], { branch_code: '02' });
  const groups = groupExpiringOffers([a, b, c], () => '');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].offers.length, 2);
  assert.ok(groups[0].offers[0].warnings.includes('Abaixo do custo importado'));
  assert.equal(groupExpiringOffers([a, b, c], row => row.item.branch_code).length, 2);
  assert.ok(expiringPriceWarnings(calculate([rule({ discount_type: 'fixed_price', discount_value: 60 })])).includes('Não reduz o preço de venda'));
  assert.ok(expiringPriceWarnings(calculate([rule({ discount_type: 'cost_markup' })])).includes('Preço final a conferir no ERP'));
});

test('Raio-X explains priority, exclusive targets and demand veto', () => {
  const trace = [];
  const general = rule({ id: 'general' });
  const specific = rule({ id: 'specific', scope_type: 'manufacturer', scope_value: 'FABRICA A', skip_if_demand_covers_balance: true });
  const later = { ...specific, id: 'later', max_days_to_expire: 20 };
  const result = classifyExpiringItem({ ...item, monthly_average: 60 }, sortExpiringRules([general, specific, later]), 60, 15, trace);
  assert.equal(result.line, null);
  assert.match(trace.find(entry => entry.rule === specific).reason, /60 un. para 15 un./);
  assert.match(trace.find(entry => entry.rule === general).reason, /Bloqueada/);
  assert.match(trace.find(entry => entry.rule === later).reason, /Fora da faixa/);
  const chosen = [];
  classifyExpiringItem(item, [general, rule({ id: 'second' })], 60, 15, chosen);
  assert.equal(chosen[0].reason, 'Regra aplicada');
  assert.match(chosen[1].reason, /regra anterior/);
});

test('validity review uses Fortaleza and does not turn invalid dates into deadlines', () => {
  const now = new Date('2026-11-14T01:00:00Z');
  const review = expiringDateReview({ expiration_date: '2026-12-29', days_to_expire: 60, imported_at: '2026-11-12T18:00:00Z' }, now);
  assert.equal(review.actualDays, 46);
  assert.equal(review.mismatch, true);
  assert.equal(review.stale, true);
  assert.equal(expiringDateReview({ expiration_date: '2026-02-30' }, now).actualDays, null);
});

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

test('active specific targets reserve their group even outside their day range', () => {
  const general = rule({ min_days_to_expire: 31, max_days_to_expire: 89, priority: 1 });
  const specific = rule({ scope_type: 'manufacturer', scope_value: 'FABRICA A', min_days_to_expire: 31, max_days_to_expire: 50 });
  assert.equal(calculate([general, specific], { days_to_expire: 31 }).rule, specific);
  assert.equal(calculate([general, specific], { days_to_expire: 50 }).rule, specific);
  assert.match(calculate([general, specific], { days_to_expire: 51 }).exclusionReason, /fora da faixa específica/);
  assert.equal(calculate([general, { ...specific, is_active: false }], { days_to_expire: 51 }).rule, general);
  assert.equal(calculate([general, specific], { days_to_expire: 51, manufacturer: 'Outra' }).rule, general);
});

test('the demand condition vetoes offers and distinguishes missing sales from zero', () => {
  const guarded = rule({ max_days_to_expire: 60, skip_if_demand_covers_balance: true });
  const fallback = rule({ max_days_to_expire: 60, priority: 200 });
  const example = { balance_quantity: 15, days_to_expire: 50 };
  assert.match(calculate([guarded, fallback], { ...example, monthly_average: 60 }).exclusionReason, /100 un. para 15 un./);
  assert.equal(calculate([guarded], { ...example, monthly_average: 9 }).line, null);
  assert.equal(calculate([guarded], { ...example, monthly_average: 8 }).rule, guarded);
  assert.equal(calculate([guarded], { ...example, monthly_average: 0 }).demandNote, null);
  const missing = calculate([guarded], { ...example, monthly_average: null });
  assert.equal(missing.rule, guarded);
  assert.match(missing.demandNote, /não informada/);
});

test('filtered general rules match their group without reserving it', () => {
  const general = rule({ min_days_to_expire: 0, max_days_to_expire: 90, priority: 200 });
  const filtered = rule({ rule_type: 'general', scope_type: 'manufacturer', scope_value: 'FABRICA A' });
  assert.equal(calculate([general, filtered]).rule, filtered);
  assert.equal(calculate([general, filtered], { days_to_expire: 31 }).rule, general);
  assert.equal(calculate([general, filtered], { manufacturer: 'OUTRA' }).rule, general);
  const exclusive = rule({ rule_type: 'specific', scope_type: 'category', scope_value: 'COLORACAO', max_days_to_expire: 20 });
  assert.equal(calculate([general, filtered, exclusive]).rule, null);
  assert.equal(calculate([general, filtered, exclusive], { days_to_expire: 20 }).rule, exclusive);
});

test('lots compete for demand only with the same item and store through their deadline', () => {
  const first = { ...item, branch_code: '01', days_to_expire: 10, balance_quantity: 6 };
  const second = { ...first, days_to_expire: 20, balance_quantity: 10, monthly_average: 30 };
  const third = { ...second, balance_quantity: 7 };
  const otherStore = { ...first, branch_code: '02', balance_quantity: 80 };
  const balances = expiringBalancesByDeadline([third, otherStore, second, first]);
  assert.deepEqual([first, second, third, otherStore].map(lot => balances.get(lot)), [6, 23, 23, 80]);
  assert.ok(classifyExpiringItem(second, [rule({ skip_if_demand_covers_balance: true })], 60, balances.get(second)).line);
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
