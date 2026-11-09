const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const exportsCache = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/calendar-month-cache.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: exportsCache });
const { CalendarMonthCache, calendarMonth } = exportsCache;

test('returning to an already loaded month renders its cached events without another request', async () => {
  const cache = new CalendarMonthCache(); let requests = 0;
  const read = month => cache.load(month, async () => { requests++; return [{ month }]; });
  await read('2026-11'); await read('2026-12');
  assert.equal(cache.peek('2026-11')[0].month, '2026-11');
  await read('2026-11');
  assert.equal(requests, 2);
});

test('empty months are cached and different calendars never share events', async () => {
  const cache = new CalendarMonthCache(); let requests = 0;
  await cache.load('user:one:2026-11', async () => []);
  await cache.load('user:one:2026-11', async () => { requests++; return ['wrong']; });
  await cache.load('user:two:2026-11', async () => ['two']);
  assert.equal(cache.peek('user:one:2026-11').length, 0);
  assert.equal(cache.peek('user:two:2026-11')[0], 'two');
  assert.equal(requests, 0);
});

test('prefetch and foreground requests for the same month share one pending request', async () => {
  const cache = new CalendarMonthCache(); let requests = 0, resolve;
  const loader = () => { requests++; return new Promise(done => { resolve = done; }); };
  const prefetch = cache.load('next', loader), foreground = cache.load('next', loader);
  await Promise.resolve(); resolve(['next']);
  await Promise.all([prefetch, foreground]);
  assert.equal(requests, 1);
});

test('refresh keeps events visible and a failed refresh never erases cached data', async () => {
  const cache = new CalendarMonthCache();
  await cache.load('month', async () => ['existing']);
  cache.invalidate();
  assert.equal(cache.peek('month')[0], 'existing');
  await assert.rejects(cache.load('month', async () => { throw new Error('network'); }));
  assert.equal(cache.peek('month')[0], 'existing');
  await cache.load('month', async () => ['updated']);
  assert.equal(cache.peek('month')[0], 'updated');
});

test('late responses cannot restore a deleted event or a cleared account cache', async () => {
  const cache = new CalendarMonthCache(); let resolve;
  await cache.load('month', async () => ['delete-me', 'keep']);
  cache.invalidate();
  const old = cache.load('month', () => new Promise(done => { resolve = done; }));
  await Promise.resolve();
  cache.update(rows => rows.filter(row => row !== 'delete-me'));
  resolve(['delete-me', 'keep']); await old;
  assert.equal(cache.peek('month').join(','), 'keep');
  cache.clear();
  assert.equal(cache.peek('month'), undefined);
});

test('cache size is bounded and month boundaries handle year transitions', async () => {
  const cache = new CalendarMonthCache(2);
  await cache.load('one', async () => ['one']);
  await cache.load('two', async () => ['two']);
  await cache.load('three', async () => ['three']);
  assert.equal(cache.peek('one'), undefined);
  assert.equal(calendarMonth(new Date(2026, 11, 1), 1).key, '2027-01');
  assert.equal(calendarMonth(new Date(2026, 0, 1), -1).key, '2025-12');
});
