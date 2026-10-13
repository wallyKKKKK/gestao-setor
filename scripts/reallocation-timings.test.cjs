const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function loadRoute(authorized) {
  const exported = {};
  let queries = 0;
  const dependencies = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/server-auth': {
      requireAuthenticatedProfile: async () => authorized
        ? { ok: true, profile: { sector: 'Geral' } }
        : { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) },
    },
    '@/lib/reallocation-sector': { normalizeReallocationSector: (value) => value || 'Geral' },
    '@/lib/supabase-admin': {
      getSupabaseAdmin: () => ({
        from: () => {
          queries++;
          return { select: async () => ({ data: [], error: null }) };
        },
      }),
    },
  };
  const source = readFileSync(path.join(__dirname, '../app/api/reallocation-suggestions/route.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(compiled, { exports: exported, require: (name) => dependencies[name], Headers, performance });
  return { POST: exported.POST, queries: () => queries };
}

test('timing diagnostics preserve successful calculation and no-store response', async () => {
  const route = loadRoute(true);
  const request = new Request('http://localhost/api/reallocation-suggestions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stockItems: [
        { ean: '123', store_code: '01', stock: 12, confirmed_stock: 12 },
        { ean: '123', store_code: '02', stock: 0, confirmed_stock: 0, monthly_avg_sales: 30 },
      ],
      filters: { origins: ['01'], destinations: ['02'] },
      rules: { stockFloor: 10, destinationTargetDays: 5, maxRoutePriority: 5 },
    }),
  });
  const response = await route.POST(request);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.engine, 'typescript');
  assert.equal(result.suggestions[0].quantity, 2);
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
  for (const key of ['authMs', 'requestReadMs', 'snapshotValidationMs', 'stockReadMs', 'attributeReadMs', 'logisticsReadMs', 'calculationMs', 'preResponseMs']) {
    assert.ok(Number.isFinite(result.timings[key]) && result.timings[key] >= 0, key);
  }
  assert.match(response.headers.get('Server-Timing'), /calculationMs;dur=/);
  assert.match(response.headers.get('Server-Timing'), /serializationMs;dur=/);
  assert.match(response.headers.get('Server-Timing'), /totalMs;dur=/);
});

test('timing diagnostics do not bypass authentication or expose data', async () => {
  const route = loadRoute(false);
  const response = await route.POST(new Request('http://localhost/api/reallocation-suggestions', { method: 'POST' }));
  assert.equal(response.status, 401);
  assert.equal(route.queries(), 0);
  assert.equal(response.headers.get('Server-Timing'), null);
  assert.deepEqual(await response.json(), { error: 'Unauthorized' });
});
