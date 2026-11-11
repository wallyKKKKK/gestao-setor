const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

const compiled = ts.transpileModule(fs.readFileSync('lib/purchase-quotation-draft.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function setup() {
  const exports = {};
  const db = new Map();
  let counter = 0;
  const fetch = async (url, { method }) => {
    if (method === 'POST') {
      if (db.size === 5) return Response.json({ error: 'Limite de 5' }, { status: 409 });
      const id = String(++counter);
      db.set(id, { draft: { links: {}, chosenCosts: {} }, draft_version: 0 });
      return Response.json({ id });
    }
    db.delete(new URL(url, 'https://test.local').searchParams.get('id'));
    return Response.json({ ok: true });
  };
  vm.runInNewContext(compiled, { exports, fetch, require: () => ({
    getAuthHeaders: async () => ({}),
    supabase: { rpc(name, { p_id, p_version, p_draft }) {
      const row = db.get(p_id);
      if (name === 'read_purchase_quotation_workspace') return { maybeSingle: async () => ({ data: row ?? null }) };
      assert.equal(name, 'save_purchase_quotation_workspace');
      if (!row || row.draft_version !== p_version) return { data: null };
      db.set(p_id, { draft: structuredClone(p_draft), draft_version: p_version + 1 });
      return { data: p_version + 1 };
    } },
  }) });
  return exports;
}

test('reload restores the saved quote, cost rows and manual decisions', async () => {
  const api = setup();
  const empty = await api.createQuotationWorkspace();
  const other = await api.createQuotationWorkspace();
  assert.equal(empty.revision, 0);
  const draft = {
    request: { name: 'a7.txt', rows: [{ quantity: 5, a7Reference: 8.5, branchCnpj: '00000000000001' }] },
    costs: { name: 'custos.xlsx', rows: [{ line: 7, unitCost: 6.20 }], transfers: 2, issues: [] },
    links: { SABONETE: '00123' },
    chosenCosts: { '00123': 7 },
  };
  assert.equal(await api.saveQuotationDraft({ ...empty, draft, dirty: true }), 1);
  const saved = await api.loadQuotationDraft(empty.id);
  assert.deepEqual(saved.draft, draft);
  assert.equal(saved.dirty, false);
  assert.equal(await api.saveQuotationDraft(saved), 2);
  assert.equal((await api.loadQuotationDraft(other.id)).revision, 0);
});

test('an outdated tab cannot replace a more recent draft', async () => {
  const api = setup();
  const empty = await api.createQuotationWorkspace();
  await api.saveQuotationDraft(empty);
  await assert.rejects(api.saveQuotationDraft(empty), api.QuotationDraftConflict);
  const original = await api.loadQuotationDraft(empty.id);
  await api.saveQuotationDraft(original);
  await assert.rejects(api.saveQuotationDraft(original), api.QuotationDraftConflict);
  assert.equal((await api.loadQuotationDraft(empty.id)).revision, 2);
});

test('deleting one quote frees a slot and keeps other draft IDs available', async () => {
  const api = setup();
  const drafts = await Promise.all(Array.from({ length: 5 }, () => api.createQuotationWorkspace()));
  await assert.rejects(api.createQuotationWorkspace(), /Limite de 5/);
  await api.deleteQuotationWorkspace(drafts[0].id);
  await assert.rejects(api.loadQuotationDraft(drafts[0].id), /não está mais disponível/);
  assert.equal((await api.loadQuotationDraft(drafts[1].id)).id, drafts[1].id);
  assert.ok(!drafts.some(draft => draft.id === '6'));
  assert.equal((await api.createQuotationWorkspace()).id, '6');
});
