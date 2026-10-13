const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Load the local environment with node --env-file=.env.local');
  let requestCount = 0;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init = {}) => {
        if (!['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) throw new Error('This diagnostic only permits read requests');
        requestCount += 1;
        const timeout = AbortSignal.timeout(20000);
        return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
      },
    },
  });
  const source = readFileSync(path.join(__dirname, '../app/api/reallocation-suggestions/route.ts'), 'utf8');
  const exported = {};
  const compiled = ts.transpileModule(`${source}\nexports.diagnostic = { calculate, fetchSnapshotStockItems, fetchServerBranchLogistics };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: exported,
    AbortController,
    require: (name) => name === '@/lib/supabase-admin' ? { getSupabaseAdmin: () => admin } : {},
  });
  const engine = exported.diagnostic;
  const startedAt = performance.now();
  const { data, error } = await admin.from('reallocation_stock_snapshots').select('id,imported_at').order('imported_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const snapshot = data?.[0];
  if (!snapshot) throw new Error('No imported stock snapshot is available');
  const snapshotLookupMs = performance.now() - startedAt;
  const { count, error: countError } = await admin.from('reallocation_stock_items').select('id', { count: 'exact', head: true }).eq('snapshot_id', snapshot.id);
  if (countError) throw new Error(countError.message);
  console.log(`Snapshot size: ${count} rows`);
  let phaseStartedAt = performance.now();
  const beforeStockRequests = requestCount;
  const sampleOnly = count > 100000 && !process.argv.includes('--full-stock');
  let stockItems;
  if (sampleOnly) {
    stockItems = [];
    let lastId = '';
    for (let page = 0; page < 10; page++) {
      let query = admin.from('reallocation_stock_items').select('*').eq('snapshot_id', snapshot.id).order('id', { ascending: true }).limit(1000);
      if (lastId) query = query.gt('id', lastId);
      const { data: chunk, error: pageError } = await query;
      if (pageError) throw new Error(pageError.message);
      stockItems.push(...chunk);
      if (chunk.length < 1000) break;
      lastId = chunk[chunk.length - 1].id;
      console.log(`Read-only sample page ${page + 1}/10`);
    }
  } else {
    stockItems = await engine.fetchSnapshotStockItems(snapshot.id);
  }
  const stockReadMs = performance.now() - phaseStartedAt;
  const stockReadRequests = requestCount - beforeStockRequests;
  console.log(`Stock read: ${stockItems.length} rows, ${stockReadRequests} requests, ${stockReadMs.toFixed(0)} ms`);
  phaseStartedAt = performance.now();
  const branchLogistics = await engine.fetchServerBranchLogistics();
  const logisticsReadMs = performance.now() - phaseStartedAt;
  const rules = { originMinimumDays: 20, destinationTargetDays: 30, maxRoutePriority: 3, stockFloor: 0, considerMinimumStock: false };
  const payload = { stockItems, branchLogistics, filters: {}, rules };
  const calculationSamplesMs = [];
  let result;
  for (let index = 0; index < 3; index++) {
    phaseStartedAt = performance.now();
    result = engine.calculate(payload);
    calculationSamplesMs.push(performance.now() - phaseStartedAt);
  }
  phaseStartedAt = performance.now();
  const serialized = JSON.stringify(result);
  const serializationMs = performance.now() - phaseStartedAt;
  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'Read-only latest snapshot, production stock-pagination and logistics helpers. For snapshots above 100000 rows, only the first 10 pages are sampled using the same pagination query. Historical snapshot accepted for timing only. Unfiltered representative rules, not the browser current selection. Excludes user authentication, attribute filtering, browser transfer and rendering. No products or credentials stored.',
    fullSnapshotRows: count, sampleOnly, stockRows: stockItems.length, stockReadRequests, requestCount,
    snapshotLookupMs, stockReadMs, logisticsReadMs, calculationSamplesMs,
    calculationMedianMs: [...calculationSamplesMs].sort((left, right) => left - right)[1],
    serializationMs, responseBytes: Buffer.byteLength(serialized),
    suggestions: result.suggestions.length, rules,
  };
  const outputPath = path.join(__dirname, sampleOnly ? '../docs/reallocation-live-sample-diagnostic.json' : '../docs/reallocation-live-diagnostic.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
