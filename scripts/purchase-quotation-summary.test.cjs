const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function load(file, mocks = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('exports', 'require', compiled)(exports, name => mocks[name] ?? require(name));
  return exports;
}

const helpers = load('lib/purchase-quotation-summary.ts');

test('the monthly period follows Fortaleza at the year boundary', () => {
  assert.equal(helpers.quotationSummaryMonths(new Date('2027-01-01T02:59:59Z'))[0].start, '2026-12-01T03:00:00.000Z');
  assert.equal(helpers.quotationSummaryMonths(new Date('2027-01-01T03:00:00Z'))[0].start, '2027-01-01T03:00:00.000Z');
});

test('savings use the approved package quantities and only comparable lines', () => {
  const months = helpers.quotationSummaryMonths(new Date('2026-11-10T15:00:00Z'));
  const order = {
    supplierId: 'supplier-1', totalCents: 5700,
    lines: [
      { quantity: 3, referenceUnitCost: 4, unitsPerPackage: 5, totalCents: 4200 },
      { quantity: 1, referenceUnitCost: null, unitsPerPackage: 1, totalCents: 700 },
      { quantity: 1, referenceUnitCost: 3, unitsPerPackage: null, totalCents: 800 },
    ],
  };
  const [current, previous] = helpers.summarizeQuotationMonths(months, [
    { closed_at: '2026-11-01T02:59:59+00:00', orders: [order] },
    { closed_at: '2026-11-01T03:00:00+00:00', orders: [order, order] },
  ]);
  assert.deepEqual(current, {
    start: months[0].start, orders: 2, suppliersWithOrders: 1, orderTotalCents: 11400,
    referenceTotalCents: 12000, comparablePaidCents: 8400, lines: 6, comparableLines: 2,
  });
  assert.equal(previous.orders, 1);
});

test('the endpoint denies unauthorized access and only reads the current owner', async () => {
  const reads = [];
  const server = {
    inviteTable: 'invites', roundTable: 'rounds', supplierTable: 'suppliers',
    quoteError: (error, status) => Response.json({ error }, { status }), quoteJson: Response.json,
    requireQuotationBuyer: async request => request.headers.get('authorization')
      ? { ok: true, userId: 'buyer' } : { ok: false, response: new Response(null, { status: 401 }) },
  };
  const { GET } = load('app/api/purchase-quotation/summary/route.ts', {
    '@/lib/purchase-quotation-server': server,
    '@/lib/purchase-quotation-summary': helpers,
    '@/lib/supabase-admin': { getSupabaseAdmin: () => ({
      from: table => {
        const filters = [];
        reads.push({ table, filters });
        const query = {
          select: (_, options) => { query.head = Boolean(options?.head); return query; },
          then: resolve => resolve(query.head ? { count: table === 'rounds' ? 2 : 1 } : { data: [] }),
        };
        for (const method of ['eq', 'lte', 'gte', 'gt', 'is', 'order', 'limit']) {
          query[method] = (...args) => { filters.push([method, ...args]); return query; };
        }
        return query;
      },
    }) },
  });
  const url = 'http://localhost/api/purchase-quotation/summary';
  assert.equal((await GET(new Request(url))).status, 401);
  assert.equal(reads.length, 0);
  const response = await GET(new Request(url, { headers: { authorization: 'test' } }));
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.equal(summary.ongoing, 1);
  assert.equal(summary.months.length, 3);
  assert.equal(reads.length, 7);
  assert.ok(reads.every(read => read.filters.some(([operator, column, value]) => operator === 'eq' && column === 'user_id' && value === 'buyer')));
});
