const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function route(role) {
  let writes = 0;
  const exports = {};
  const js = ts.transpileModule(readFileSync(path.join(__dirname, '../app/api/profiles/route.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(js, { exports, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (data, init) => new Response(JSON.stringify(data), init) } };
    if (name === '@/lib/server-auth') return { requireAuthenticatedProfile: async () => role ? { ok: true, userId: 'actor', profile: { role } } : { ok: false, response: new Response('', { status: 401 }) } };
    if (name === '@/lib/supabase-admin') return { getSupabaseAdmin() { writes++; return { from() { const chain = { update() { return chain; }, eq() { return chain; }, select() { return chain; }, single: async () => ({ data: { id: 'other' }, error: null }) }; return chain; } }; } };
    throw new Error(name);
  } });
  return { call: body => exports.PATCH(new Request('http://test/api/profiles', { method: 'PATCH', body: JSON.stringify({ profileId: 'other', ...body }) })), writes: () => writes };
}
test('members and managers cannot directly change roles, sectors or access status', async () => {
  for (const role of ['membro', 'gerente']) {
    const api = route(role);
    for (const body of [{ role: 'admin' }, { sector: 'Geral' }, { accountStatus: 'approved' }, { isActive: false }]) {
      assert.equal((await api.call(body)).status, 403);
    }
    assert.equal(api.writes(), 0);
  }
});
test('admins can use existing account management actions', async () => {
  const api = route('admin');
  for (const body of [{ role: 'gerente' }, { sector: 'Geral' }, { accountStatus: 'approved' }, { isActive: true }]) assert.equal((await api.call(body)).status, 200);
  assert.equal(api.writes(), 4);
});
test('signed-out requests never reach the database', async () => {
  const api = route(null);
  assert.equal((await api.call({ role: 'admin' })).status, 401);
  assert.equal(api.writes(), 0);
});
