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

const workflow = load('lib/purchase-quotation-workflow.ts');

test('revoked invitations are excluded and expired invitations do not block apuration', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const invite = (expires_at, submitted_at = null, revoked_at = null) => ({ expires_at, submitted_at, revoked_at });
  const progress = workflow.quotationInviteProgress([
    invite('2026-11-10T11:00:00Z', '2026-11-10T10:00:00Z'),
    invite('2026-11-10T12:00:00Z'),
    invite('2026-11-11T12:00:00Z', null, '2026-11-10T10:00:00Z'),
  ], now);
  assert.deepEqual(progress, { deadline: '2026-11-10T12:00:00Z', participants: 2, responses: 1, pending: 0 });
  assert.equal(workflow.quotationNextStage({ ...progress, closedAt: null }), 'settlement');
  assert.equal(workflow.quotationNextStage({ ...progress, pending: 1, closedAt: null }), 'tracking');
  assert.equal(workflow.quotationNextStage({ ...progress, responses: 0, closedAt: null }), 'tracking');
  assert.equal(workflow.quotationNextStage({ ...progress, closedAt: '2026-11-10T12:30:00Z' }), 'orders');
  assert.equal(workflow.quotationNextStage({ ...progress, closedAt: null, published_at: null }), 'products');
});

test('the list paginates owner-scoped rounds and reads status only for the listed round IDs', async () => {
  const roundId = '31a1b8bf-e410-4d93-8b44-53f823ca97d4';
  const reads = [];
  const payload = {
    rounds: { count: 41, data: [{ id: roundId, title: 'Pedido A7', draft_revision: 21, created_at: '2026-11-10T10:00:00Z' }] },
    invites: { data: [{ round_id: roundId, expires_at: '2026-11-11T10:00:00Z', revoked_at: null, submitted_at: '2026-11-10T11:00:00Z' }] },
    purchase_quotation_settlements: { data: [{ round_id: roundId, closed_at: '2026-11-10T12:00:00Z' }] },
  };
  const { GET } = load('app/api/purchase-quotation/settlement/route.ts', {
    '@/lib/purchase-quotation-workflow': workflow,
    '@/lib/purchase-quotation-supplier': {},
    '@/lib/purchase-quotation-settlement': {},
    '@/lib/purchase-quotation-server': {
      inviteTable: 'invites', roundTable: 'rounds', quoteJson: Response.json,
      quoteError: (error, status) => Response.json({ error }, { status }),
      requireQuotationBuyer: async request => request.headers.get('authorization')
        ? { ok: true, userId: 'buyer' } : { ok: false, response: new Response(null, { status: 401 }) },
    },
    '@/lib/supabase-admin': { getSupabaseAdmin: () => ({
      from: table => {
        const filters = [];
        reads.push({ table, filters });
        const query = { then: resolve => resolve(payload[table]) };
        for (const method of ['select', 'eq', 'is', 'order', 'range', 'in']) {
          query[method] = (...args) => { filters.push([method, ...args]); return query; };
        }
        return query;
      },
    }) },
  });
  const url = 'http://localhost/api/purchase-quotation/settlement?page=1';
  assert.equal((await GET(new Request(url))).status, 401);
  assert.equal(reads.length, 0);
  const response = await GET(new Request(url, { headers: { authorization: 'test' } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.total, 41);
  assert.equal(result.rounds[0].responses, 1);
  assert.equal(workflow.quotationNextStage(result.rounds[0]), 'orders');
  assert.ok(reads.every(read => read.filters.some(([op, column, value]) => op === 'eq' && column === 'user_id' && value === 'buyer')));
  assert.deepEqual(reads[0].filters.find(([op]) => op === 'range'), ['range', 20, 39]);
  assert.deepEqual(reads[0].filters.find(([op]) => op === 'is'), ['is', 'deleted_at', null]);
  for (const read of reads.slice(1)) assert.deepEqual(read.filters.find(([op]) => op === 'in'), ['in', 'round_id', [roundId]]);
});

test('an existing quotation can accept an invite without reopening its original draft', async () => {
  const round = { id: '31a1b8bf-e410-4d93-8b44-53f823ca97d4', title: 'Cotação anterior', draft_revision: 3 };
  const supplierId = '9128d114-cbb2-4016-82f0-70de974d81e3';
  const reads = [];
  let inserted;
  const { POST } = load('app/api/purchase-quotation/route.ts', {
    '@/lib/purchase-quotation-supplier': { quotationObject: input => input },
    '@/lib/purchase-quotation-server': {
      inviteTable: 'invites', roundTable: 'rounds', supplierTable: 'suppliers',
      isQuotationUuid: id => id === round.id || id === supplierId,
      requireQuotationBuyer: async () => ({ ok: true, userId: 'buyer' }), readQuotationJson: request => request.json(),
      quoteJson: Response.json, quoteError: (error, status) => Response.json({ error }, { status }),
      newQuotationToken: () => 'secret', hashQuotationToken: () => 'hash',
    },
    '@/lib/supabase-admin': { getSupabaseAdmin: () => ({
      from: table => {
        reads.push(table);
        const filters = [];
        const query = {
          select: () => query, eq: (...filter) => { filters.push(filter); return query; }, is: () => query,
          maybeSingle: async () => {
            assert.ok(filters.some(([key, value]) => key === 'user_id' && value === 'buyer'));
            return { data: table === 'rounds' ? { ...round, published_at: new Date().toISOString(), draft_version: 0 } : { id: supplierId, name: 'Fornecedor', minimum_order: 10, payment_days: 30 } };
          },
          insert: data => { inserted = data; return query; },
          single: async () => ({ data: { id: 'invite' } }),
        };
        return query;
      },
    }) },
  });
  const response = await POST(new Request('http://localhost/api/purchase-quotation', {
    method: 'POST',
    body: JSON.stringify({ action: 'invite', supplierId, roundId: round.id, expiresAt: new Date(Date.now() + 3600000).toISOString() }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).round, round);
  assert.deepEqual(reads, ['suppliers', 'rounds', 'invites']);
  assert.equal(inserted.round_id, round.id);
  assert.equal(inserted.user_id, 'buyer');
});
