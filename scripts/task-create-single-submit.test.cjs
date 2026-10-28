const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '../app/page.tsx'), 'utf8');
const parsed = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'addTask') handler = node.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(handler);

function fixture(createTask, overrides = {}) {
  const saving = [];
  const alerts = [];
  const context = {
    notes: '', category: 'Geral', MARGIN_FLOW_CATEGORY: 'Margens', taskTitle: 'Teste',
    tempSubtasks: [], assignedTo: 'user', canUseMarginFlow: false,
    taskScheduleMode: 'semanal', selectedDays: ['ter'], profiles: [], userSector: 'Geral',
    repeatInterval: 1, oneOffDate: '2026-10-27', taskPriority: 'normal',
    DEFAULT_TASK_CATEGORY: 'Geral', DEFAULT_TASK_PRIORITY: 'normal',
    creatingTaskRef: { current: false }, createTask, addAudit: async () => {},
    sourceNoteId: null,
    alert: message => alerts.push(message),
    setIsCreatingTask: value => saving.push(value), getTodayStr: () => '2026-10-27', formatToBR: value => value.split('-').reverse().join('/'),
    ...overrides,
  };
  for (const name of ['setTaskTitle', 'setDisplayDate', 'setNotes', 'setCategory', 'setSelectedDays', 'setTaskPriority', 'setTaskScheduleMode', 'setOneOffDate', 'setTempSubtasks', 'setShowAssignMenu', 'setShowCategoryMenu', 'setShowCreateBox', 'fetchTasks']) context[name] = () => {};
  const script = ts.transpileModule(handler + '\nexports.addTask = addTask;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(script, { ...context, exports });
  return { submit: exports.addTask, saving, alerts, lock: context.creatingTaskRef };
}

test('rapid repeated clicks create only one task, including while audit finishes', async () => {
  let finishCreate, finishAudit;
  let calls = 0;
  const f = fixture(() => { calls++; return new Promise(resolve => { finishCreate = resolve; }); }, {
    addAudit: () => new Promise(resolve => { finishAudit = resolve; }),
  });
  const first = f.submit();
  await Promise.all(Array.from({ length: 30 }, () => f.submit()));
  assert.equal(calls, 1);
  assert.deepEqual(f.saving, [true]);
  finishCreate();
  await new Promise(resolve => setImmediate(resolve));
  await f.submit();
  assert.equal(calls, 1);
  finishAudit();
  await first;
  assert.equal(f.lock.current, false);
  assert.deepEqual(f.saving, [true, false]);
});

test('failure releases the lock so the same draft can be retried', async () => {
  let calls = 0;
  const f = fixture(async () => { if (++calls === 1) throw new Error('Falha de teste'); });
  await f.submit();
  assert.equal(f.alerts.length, 1);
  assert.equal(f.lock.current, false);
  await f.submit();
  assert.equal(calls, 2);
  assert.deepEqual(f.saving, [true, false, true, false]);
});

test('invalid input does not acquire a save lock or send a request', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; }, { taskTitle: '' });
  await f.submit();
  assert.equal(calls, 0);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.lock.current, false);
  assert.deepEqual(f.saving, []);
});

test('no selected recurrence creates a one-off task with its chosen date', async () => {
  for (const taskScheduleMode of ['pontual', 'semanal', 'mensal']) {
    let payload;
    const f = fixture(async value => { payload = value; }, { taskScheduleMode, selectedDays: [], repeatInterval: 3 });
    await f.submit();
    assert.equal(f.alerts.length, 0);
    assert.equal(payload.isOneOff, true);
    assert.equal(payload.repeatDays, '');
    assert.equal(payload.repeatInterval, 1);
    assert.equal(payload.dueDate, '2026-10-27');
  }
});

test('explicit weekly and monthly selections retain recurrence', async () => {
  for (const [taskScheduleMode, selectedDays] of [['semanal', ['ter']], ['mensal', ['15']]]) {
    let payload;
    const f = fixture(async value => { payload = value; }, { taskScheduleMode, selectedDays, repeatInterval: 2 });
    await f.submit();
    assert.equal(payload.isOneOff, false);
    assert.equal(payload.repeatDays, selectedDays.join(','));
    assert.equal(payload.repeatInterval, 2);
    assert.equal(payload.dueDate, null);
  }
});

test('notes use the linked creation endpoint instead of ordinary insertion', async () => {
  let ordinary = 0;
  const calls = [];
  let refreshes = 0;
  const f = fixture(async () => { ordinary++; }, {
    sourceNoteId: 'note-1',
    notes: 'Texto da anotação',
    createTaskFromNote: async (id, payload) => { calls.push({ id, payload }); return '42'; },
    setNotesVersion: () => { refreshes++; },
  });
  await f.submit();
  assert.equal(ordinary, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'note-1');
  assert.equal(calls[0].payload.notes, 'Texto da anotação');
  assert.equal(refreshes, 1);
});
