const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '../lib/reallocation-stock-cleanup.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function load(responses) {
  const calls = [];
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console: { warn() {}, error() {} },
    require: () => ({ getSupabaseAdmin: () => ({ rpc: async (name, args) => {
      calls.push({ name, args });
      return responses.shift() || { data: { deleted_rows: 0, pending: false } };
    } }) }),
  });
  return { cleanup: exports.cleanupRetiredReallocationStock, calls };
}

test('retired inventory is cleaned in bounded sector-specific batches', async () => {
  const { cleanup, calls } = load([{ data: { deleted_rows: 2000, pending: true } }, { data: { deleted_rows: 100, pending: false } }]);
  const result = await cleanup('Geral');
  assert.equal(result.completed, true);
  assert.equal(result.deletedRows, 2100);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'cleanup_reallocation_stock_snapshots');
  assert.equal(calls[0].args.p_sector, 'Geral');
  assert.equal(calls[0].args.p_batch_size, 2000);
});

test('cleanup failure stays pending without rejecting the successful import', async () => {
  const { cleanup, calls } = load([{ error: { code: '57014', message: 'statement timeout' } }]);
  assert.equal((await cleanup('Geral')).completed, false);
  assert.equal(calls.length, 1);
});

test('cleanup respects the background execution budget', async () => {
  const { cleanup, calls } = load([]);
  assert.equal((await cleanup('Geral', 0)).completed, false);
  assert.equal(calls.length, 0);
});
