const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

function load(file, mocks = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, Request, Response, TextDecoder, require: name => mocks[name] ?? require(name) });
  return exports;
}

const imports = load('lib/purchase-quotation-import.ts');
const helpers = load('lib/purchase-quotation-supplier.ts', { '@/lib/purchase-quotation-import': imports });
const server = load('lib/purchase-quotation-server.ts', {
  '@/lib/permissions': { normalizePermissionSector: value => value.toLowerCase() },
  '@/lib/server-auth': { requireAuthenticatedProfile: async req => ({ ok: true, userId: 'owner', profile: {
    is_active: true, account_status: 'approved', role: 'membro', sector: req.headers.get('x-test-sector') ?? 'Compras',
  } }) },
});
const item = { id: '1', code: '0123', ean: '00001234', description: 'Produto', quantity: 5 };
const proposal = { paymentDays: 30, deliveryDays: 2, note: '', offers: [{ itemId: '1', unitPrice: 5.9, available: 6, multiple: 2, note: '' }] };
const clone = value => JSON.parse(JSON.stringify(value));

test('round combines quantities by packaging without publishing buyer prices or stores', () => {
  const row = { productCode: '0123', ean: '00001234', description: 'Produto', quantity: 2, a7Reference: 10, branchCnpj: '1' };
  const draft = { links: {}, chosenCosts: {}, request: { rows: [row, { ...row, branchCnpj: '2', quantity: 3 }] } };
  const round = helpers.buildQuotationRound(draft);
  assert.deepEqual(clone(round.supplierItems), [item]);
  assert.equal(round.buyerItems[0].a7Reference, 10);
  assert.equal(round.buyerItems[1].branchCnpj, '2');
  assert.throws(() => helpers.buildQuotationRound({ ...draft, request: { rows: [row, row] } }), /duplicados/);
});

test('supplier data is normalized and draft responses can be incomplete, unlike submitted offers', () => {
  const supplier = { name: ' Empresa ', cnpj: '12.345.678/0001-90', contact: '', email: 'compras@example.test', whatsapp: '', coverage: '', minimum_order: 150.25, payment_days: 28 };
  assert.equal(helpers.normalizeQuotationSupplier(supplier).cnpj, '12345678000190');
  assert.throws(() => helpers.normalizeQuotationSupplier({ ...supplier, minimum_order: -1 }), /mínimo/);
  const draft = { ...proposal, deliveryDays: null, offers: [{ ...proposal.offers[0], available: null }] };
  assert.equal(helpers.normalizeSupplierProposal(draft, [item], true).deliveryDays, null);
  assert.throws(() => helpers.normalizeSupplierProposal(draft, [item]), /inteiros/);
  assert.throws(() => helpers.normalizeSupplierProposal({ ...proposal, offers: [{ ...proposal.offers[0], itemId: '2' }] }, [item]), /inválidos/);
});

function mockPortal() {
  const token = server.newQuotationToken();
  const invite = {
    id: 'invite', supplier_name: 'Empresa', token_hash: server.hashQuotationToken(token), default_payment_days: 28,
    expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null, submitted_at: null,
    revision: 0, proposal: null, round: { deleted_at: null, title: 'interno', buyer_items: [{ cost: 8 }], supplier_items: [{ ...item, a7Reference: 10 }] },
  };
  const db = { from() {
    const filters = [];
    let update;
    const chain = {
      select() { return chain; },
      eq(field, value) { filters.push(() => invite[field] === value); return chain; },
      is(field, value) {
        if (field === 'round.deleted_at') { filters.push(() => invite.round.deleted_at === value); return chain; }
        return chain.eq(field, value);
      },
      gt(field, value) { filters.push(() => invite[field] > value); return chain; },
      update(value) { update = value; return chain; },
      async maybeSingle() {
        if (!filters.every(matches => matches())) return { data: null, error: null };
        if (update) Object.assign(invite, update);
        return { data: clone(invite), error: null };
      },
    };
    return chain;
  } };
  const route = load('app/api/purchase-quotation/respond/route.ts', {
    '@/lib/supabase-admin': { getSupabaseAdmin: () => db },
    '@/lib/purchase-quotation-supplier': helpers, '@/lib/purchase-quotation-server': server,
  });
  const req = (body, key = token) => new Request('https://test.local/api', {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body && { method: 'POST', body: JSON.stringify(body) }),
  });
  return { invite, route, req, token };
}

test('portal serves only allowed fields and rejects invalid, expired and revoked links', async () => {
  const { invite, route, req, token } = mockPortal();
  assert.equal((await route.GET(req(null, server.newQuotationToken()))).status, 404);
  assert.equal(token.length, 43);
  assert.notEqual(invite.token_hash, token);
  const response = await route.GET(req());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.deepEqual(result.items, [item]);
  assert.ok(!('title' in result) && !('round' in result) && !('token_hash' in result));
  invite.round.deleted_at = new Date().toISOString();
  assert.equal((await route.GET(req())).status, 404);
  assert.equal((await route.POST(req({ action: 'save', revision: 0, proposal }))).status, 404);
  invite.round.deleted_at = null;
  invite.revoked_at = new Date().toISOString();
  assert.equal((await route.GET(req())).status, 404);
  invite.revoked_at = null;
  invite.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await route.GET(req())).status, 404);
});

test('supplier can save and resume, stale edits fail and final submission locks', async () => {
  const { route, req } = mockPortal();
  assert.equal((await route.POST(req({ action: 'save', revision: 0, proposal: { ...proposal, deliveryDays: null } }))).status, 200);
  const saved = await (await route.GET(req())).json();
  assert.equal(saved.proposal.deliveryDays, null);
  assert.equal(saved.revision, 1);
  assert.equal((await route.POST(req({ action: 'submit', revision: 0, proposal }))).status, 409);
  const submitted = await (await route.POST(req({ action: 'submit', revision: 1, proposal }))).json();
  assert.ok(submitted.submittedAt);
  assert.equal((await route.POST(req({ action: 'save', revision: 2, proposal }))).status, 409);
});

test('supplier can mark an item unavailable without submitting a price or delivery terms', async () => {
  const { route, req } = mockPortal();
  const unavailable = { note: '', paymentDays: null, deliveryDays: null, offers: [], unavailableItemIds: ['1'] };
  assert.equal((await route.POST(req({ action: 'save', revision: 0, proposal: unavailable }))).status, 200);
  assert.deepEqual((await (await route.GET(req())).json()).proposal.unavailableItemIds, ['1']);
  assert.equal((await route.POST(req({ action: 'submit', revision: 1, proposal: { ...proposal, unavailableItemIds: ['1'] } }))).status, 400);
  assert.equal((await route.POST(req({ action: 'submit', revision: 1, proposal: { ...unavailable, unavailableItemIds: ['unknown'] } }))).status, 400);
  assert.equal((await route.POST(req({ action: 'submit', revision: 1, proposal: unavailable }))).status, 200);
});
