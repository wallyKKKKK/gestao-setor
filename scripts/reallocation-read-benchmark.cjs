const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { isDeepStrictEqual } = require('node:util');

function comparableSuggestions(suggestions) {
  const groups = new Map();
  for (const { id, ...row } of JSON.parse(JSON.stringify(suggestions))) {
    if (!groups.has(row.ean)) groups.set(row.ean, []);
    groups.get(row.ean).push({ ...row, stableId: id.slice(0, id.lastIndexOf(':')) });
  }
  return [...groups.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Load .env.local with node --env-file=.env.local');
  let requests = 0;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init = {}) => {
      if (!['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) throw new Error('Read-only benchmark');
      requests++;
      const timeout = AbortSignal.timeout(30000);
      return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    } },
  });
  const source = readFileSync(path.join(__dirname, '../app/api/reallocation-suggestions/route.ts'), 'utf8');
  const compiled = ts.transpileModule(`${source}\nexports.benchmark = { calculate, fetchSnapshotStockItems, fetchProductEansByAttributes, fetchServerBranchLogistics, mergeProductFilters };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exported = {};
  vm.runInNewContext(compiled, { exports: exported, AbortController, require: (name) => name === '@/lib/supabase-admin' ? { getSupabaseAdmin: () => admin } : {} });
  const api = exported.benchmark;
  const { data, error } = await admin.from('reallocation_stock_snapshots').select('id').order('imported_at', { ascending: false }).limit(1);
  if (error || !data?.[0]) throw new Error(error?.message || 'Missing snapshot');
  const snapshotId = data[0].id;
  const before = requests;
  let started = performance.now();
  const full = await api.fetchSnapshotStockItems(snapshotId);
  const fullReadMs = performance.now() - started;
  const fullRequests = requests - before;
  console.log(`Full optimized read: ${full.length} rows in ${fullReadMs.toFixed(0)} ms (${fullRequests} requests, bounded concurrency)`);
  const { count, error: countError } = await admin.from('reallocation_stock_items').select('id', { count: 'exact', head: true }).eq('snapshot_id', snapshotId);
  if (countError) throw new Error(countError.message);
  assert.equal(full.length, count, 'Complete read must match database count');
  assert.equal(new Set(full.map((row) => row.id)).size, count, 'Duplicate stock IDs');
  const idsDigest = createHash('md5').update(full.map((row) => row.id).join(',')).digest('hex');
  const digestIndex = process.argv.indexOf('--expected-id-digest');
  if (digestIndex >= 0) assert.equal(idsDigest, process.argv[digestIndex + 1], 'Read order/IDs differ from database checksum');
  const branchLogistics = await api.fetchServerBranchLogistics();
  const rules = { originMinimumDays: 20, destinationTargetDays: 30, maxRoutePriority: 3, stockFloor: 5, considerMinimumStock: true };
  const stores = [...new Set(full.map((row) => String(row.store_code).padStart(2, '0')))];
  let products = [...new Set(full.map((row) => row.ean))].slice(0, 100);
  const scenarios = [];
  for (const useProducts of [false, true]) {
    const filters = { origins: stores.slice(0, 1), destinations: stores.slice(1, 2), ...(useProducts ? { products } : {}) };
    started = performance.now();
    const requestStart = requests;
    const subset = await api.fetchSnapshotStockItems(snapshotId, filters);
    const readMs = performance.now() - started;
    const optimized = api.calculate({ stockItems: subset, filters, rules, branchLogistics });
    const reference = api.calculate({ stockItems: full, filters, rules, branchLogistics });
    if (!isDeepStrictEqual(comparableSuggestions(optimized.suggestions), comparableSuggestions(reference.suggestions))) throw new Error('Filtered-store suggestion content differs from the full-read reference');
    const scenario = { name: useProducts ? 'selected_stores_and_100_products' : 'selected_origin_and_destination', readMs, requests: requests - requestStart, loadedRows: subset.length, suggestions: optimized.suggestions.length, sameSuggestions: true };
    scenarios.push(scenario);
    console.log(JSON.stringify(scenario));
    if (!useProducts) products = [...new Set([...reference.suggestions.map((row) => row.ean), ...products])].slice(0, 100);
  }
  const lookup = await admin.from('reallocation_products').select('ean,manufacturer').in('ean', products).limit(1);
  if (lookup.error) throw new Error(lookup.error.message);
  if (lookup.data?.[0]?.manufacturer) {
    const filters = { products, manufacturers: [lookup.data[0].manufacturer] };
    started = performance.now();
    const requestStart = requests;
    const attributeEans = await api.fetchProductEansByAttributes(filters);
    const selected = api.mergeProductFilters(filters, attributeEans);
    const subset = await api.fetchSnapshotStockItems(snapshotId, { products: selected });
    const readMs = performance.now() - started;
    const optimized = api.calculate({ stockItems: subset, filters: { products: selected }, rules, branchLogistics });
    const reference = api.calculate({ stockItems: full, filters: { products: selected }, rules, branchLogistics });
    if (!isDeepStrictEqual(comparableSuggestions(optimized.suggestions), comparableSuggestions(reference.suggestions))) throw new Error('Filtered-product suggestion content differs from the full-read reference');
    scenarios.push({ name: 'attribute_filter_and_explicit_products', readMs, requests: requests - requestStart, loadedRows: subset.length, suggestions: optimized.suggestions.length, sameSuggestions: true });
  }
  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'Read-only latest snapshot; count and unique IDs verified. Optional ordered-ID checksum checked against an independent SQL query. Filtered suggestion fields and within-product order compared against the same engine using the full stock input, with floor and minimum enabled. Cross-product order and the global index suffix of generated suggestion IDs may change after filtering irrelevant stores and are not compared. No imported rows, store names, product codes or credentials persisted. Local single-run timings include network and vary by environment.',
    rows: full.length, fullReadMs, fullRequests, idsDigest, checksumVerified: digestIndex >= 0, scenarios,
  };
  writeFileSync(path.join(__dirname, '../docs/reallocation-read-optimization.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('All real-data read-equivalence checks passed');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
