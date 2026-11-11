const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const modules = new Map();
class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : ['2026-10-27T12:00:00-03:00']));
  }
}

function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    Date: FixedDate,
    require(name) {
      if (name === '@/app/constants') return { GLOBAL_MEMBER_TABS: ['HOJE', 'Todas', 'ATRASADOS'] };
      if (name === '@/lib/api') return {};
      if (name.startsWith('@/')) {
        const file = `${name.slice(2)}.ts`;
        return load(existsSync(path.join(__dirname, '..', file)) ? file : `${file}x`);
      }
      return require(name);
    },
  });
  return exports;
}

const { getPreviousIncompleteOccurrence, getLastOccurrence } = load('lib/task-recurrence.ts');
const { weeklyTaskAdvanceBlockedReason, processTasks, filterTasks } = load('lib/task-selectors.ts');
const base = {
  id: 'test', title: 'Conferir estoque', notes: '', assigned_to: 'user', category: 'Geral',
  status: 'pendente', last_done_date: null, repeat_days: 'ter', repeat_interval: 1,
  subtasks: [], due_date: null, is_one_off: false, archived_at: null,
  created_at: '2026-09-01T12:00:00-03:00', sector: 'Geral',
  schedule_override_date: null, schedule_override_type: null, priority: 'normal', workflow_status: 'pendente',
};

test('weekly task identifies previous date, including when nothing was ever completed', () => {
  assert.equal(getLastOccurrence(base), '2026-10-27');
  assert.equal(getPreviousIncompleteOccurrence(base, '2026-10-27'), '2026-10-20');
  assert.equal(getPreviousIncompleteOccurrence({ ...base, last_done_date: '2026-10-13' }, '2026-10-27'), '2026-10-20');
});

test('weekly calendar can bring any pending occurrence into Hoje without duplicating it', () => {
  const today = '2026-10-27';
  const nextDate = '2026-10-30';
  const tasks = [
    { ...base, repeat_days: '', is_one_off: true, due_date: nextDate },
    { ...base, repeat_days: 'sex', last_done_date: '2026-10-23' },
  ];

  for (const source of tasks) {
    const [task] = processTasks([source]);
    assert.equal(weeklyTaskAdvanceBlockedReason(task, nextDate, today), null);
    assert.equal(weeklyTaskAdvanceBlockedReason(task, '2026-11-06', today), null);
    assert.equal(weeklyTaskAdvanceBlockedReason(task, '2026-10-20', today), null);
    assert.ok(weeklyTaskAdvanceBlockedReason(task, today, today));
    assert.ok(weeklyTaskAdvanceBlockedReason({ ...task, last_done_date: today }, nextDate, today));
    assert.ok(weeklyTaskAdvanceBlockedReason({ ...task, lastOcc: today }, nextDate, today));

    const [advanced] = processTasks([{ ...source, schedule_override_date: today, schedule_override_type: 'advanced' }]);
    assert.equal(advanced.lastOcc, today);
    assert.ok(weeklyTaskAdvanceBlockedReason(advanced, nextDate, today));
    assert.equal(filterTasks({ tasks: [advanced], activeTab: 'HOJE', filterUsers: [], userRole: 'admin', userSector: 'Geral', searchTerm: '' })[0]?.id, source.id);
    assert.equal(advanced.repeat_days, source.repeat_days);
    assert.equal(advanced.due_date, source.due_date);
  }
});

test('weekly pending cards show a separate advance button, disabled when already scheduled today', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { WeeklyTaskScheduleView } = load('app/components/weekly-task-schedule-view.tsx');
  const tasks = processTasks([
    { ...base, id: 'future', title: 'Tarefa futura', repeat_days: '', is_one_off: true, due_date: '2026-10-30' },
    { ...base, id: 'today', title: 'Tarefa de hoje' },
    { ...base, id: 'later', title: 'Outra ocorrência', repeat_days: 'qua,sex' },
    { ...base, id: 'done', title: 'Tarefa concluída', repeat_days: '', is_one_off: true, due_date: '2026-10-30', last_done_date: '2026-10-27' },
  ]);
  const html = renderToStaticMarkup(React.createElement(WeeklyTaskScheduleView, { tasks, profiles: [], selectedUserIds: [], onAdvance() {}, onView() {} }));
  assert.match(html, /<\/button><button[^>]+aria-label="Adiantar Tarefa futura para hoje"/);
  assert.equal((html.match(/aria-label="Adiantar Outra ocorrência para hoje"/g) || []).length, 2);
  assert.match(html, /aria-label="Tarefa já agendada para hoje" disabled/);
  assert.doesNotMatch(html, /aria-label="Adiantar Tarefa concluída/);
});

test('completion on or after previous occurrence suppresses the warning', () => {
  for (const date of ['2026-10-20', '2026-10-21', '2026-10-27']) {
    assert.equal(getPreviousIncompleteOccurrence({ ...base, last_done_date: date }, '2026-10-27'), null);
  }
});

test('new tasks and one-off tasks never warn about dates before they existed', () => {
  for (const created_at of ['2026-10-21T12:00:00-03:00', '2026-10-27T12:00:00-03:00']) {
    assert.equal(getPreviousIncompleteOccurrence({ ...base, created_at }, '2026-10-27'), null);
  }
  assert.equal(getPreviousIncompleteOccurrence({ ...base, is_one_off: true }, '2026-10-27'), null);
  assert.equal(getPreviousIncompleteOccurrence({ ...base, repeat_days: '' }, '2026-10-27'), null);
});

test('multiple weekdays, multiweek intervals and monthly schedules use their own previous occurrence', () => {
  const cases = [
    [{ repeat_days: 'seg,ter,sex' }, '2026-10-26'],
    [{ repeat_interval: 2 }, '2026-10-13'],
    [{ repeat_days: '27' }, '2026-09-27'],
    [{ repeat_days: 'mw:4:ter' }, '2026-09-22'],
    [{ repeat_days: 'mw:4:ter,mw:1:seg' }, '2026-10-05'],
  ];
  for (const [changes, expected] of cases) {
    assert.equal(getPreviousIncompleteOccurrence({ ...base, ...changes }, '2026-10-27'), expected);
  }
  assert.equal(getPreviousIncompleteOccurrence({ ...base, repeat_days: '1', created_at: '2025-01-01' }, '2026-01-01'), '2025-12-01');
});

test('processing shows warning only for unfinished recurrence today, preserving workflow and filters', () => {
  for (const workflow_status of ['pendente', 'em_andamento', 'bloqueada']) {
    const task = processTasks([{ ...base, workflow_status }])[0];
    assert.equal(task.previousIncompleteOccurrence, '2026-10-20');
    assert.equal(task.workflow_status, workflow_status);
    const filtered = filterTasks({ tasks: [task], activeTab: 'HOJE', filterUsers: [], userRole: 'admin', userSector: 'Geral', searchTerm: '' });
    assert.equal(filtered.length, 1);
  }
  for (const changes of [
    { last_done_date: '2026-10-27' },
    { repeat_days: 'seg' },
    { repeat_days: '', due_date: '2026-10-20', is_one_off: true },
    { schedule_override_date: '2026-10-27', schedule_override_type: 'postponed' },
    { schedule_override_date: '2026-10-28', schedule_override_type: 'advanced' },
  ]) {
    assert.equal(processTasks([{ ...base, ...changes }])[0].previousIncompleteOccurrence, null);
  }
});

test('in-progress tasks lead, followed by previous pending occurrences, without changing saved priorities', () => {
  const tasks = processTasks([
    { ...base, id: 'regular-progress', last_done_date: '2026-10-20', workflow_status: 'em_andamento', priority: 'alta' },
    { ...base, id: 'previous-blocked', workflow_status: 'bloqueada', priority: 'baixa' },
    { ...base, id: 'regular-pending', last_done_date: '2026-10-20' },
    { ...base, id: 'previous-pending' },
    { ...base, id: 'done', last_done_date: '2026-10-27' },
    { ...base, id: 'previous-high', priority: 'alta' },
    { ...base, id: 'previous-progress', workflow_status: 'em_andamento', priority: 'baixa' },
  ]);
  const options = { tasks, filterUsers: [], userRole: 'admin', userSector: 'Geral', searchTerm: '' };
  const ids = (tab) => Array.from(filterTasks({ ...options, activeTab: tab }), task => task.id);
  assert.deepEqual(ids('HOJE'), ['previous-progress', 'regular-progress', 'previous-high', 'previous-pending', 'previous-blocked', 'regular-pending']);
  assert.deepEqual(ids('Todas'), ['previous-progress', 'regular-progress', 'previous-high', 'previous-pending', 'previous-blocked', 'regular-pending', 'done']);
  assert.equal(tasks.find(task => task.id === 'previous-blocked').priority, 'baixa');
  assert.equal(tasks.find(task => task.id === 'previous-blocked').workflow_status, 'bloqueada');
});

test('parent checklist completion replaces stale optimistic edits in the card', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const state = [];
  let cursor = 0;
  const hooks = {
    ...React,
    memo: component => component,
    useRef: value => ({ current: value }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
  };
  const exports = {};
  const source = readFileSync(path.join(__dirname, '../app/components/task-item.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports,
    require(name) {
      if (name === 'react') return hooks;
      if (name === '@/lib/api') return { updateTaskSubtasks: async () => {}, addAuditLog: async () => {} };
      if (name.startsWith('@/')) {
        const file = `${name.slice(2)}.ts`;
        return load(existsSync(path.join(__dirname, '..', file)) ? file : `${file}x`);
      }
      return require(name);
    },
  });
  const initial = processTasks([{ ...base, last_done_date: '2026-10-20', subtasks: ['A', 'B', 'C'].map(title => ({ title, done: false })) }])[0];
  const props = { task: initial, profiles: [], currentUser: { id: 'user' }, userRole: 'admin', onUpdate() {} };
  const render = task => { cursor = 0; return exports.TaskItem({ ...props, task }); };
  function find(node, predicate) {
    if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
    if (!node?.props) return null;
    return predicate(node) ? node : find(node.props.children, predicate);
  }
  let tree = render(initial);
  find(tree, node => node.props['aria-label'] === 'Mostrar subtarefas').props.onClick({ stopPropagation() {} });
  tree = render(initial);
  find(tree, node => node.props.onClick && node.props.className?.includes('gap-3 p-3 rounded-2xl')).props.onClick({ stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(renderToStaticMarkup(render(initial)), /1\/3/);
  const completed = { ...initial, isDoneToday: true, subtasks: initial.subtasks.map(sub => ({ ...sub, done: true })) };
  const completedMarkup = renderToStaticMarkup(render(completed));
  assert.match(completedMarkup, /3\/3/);
  assert.equal((completedMarkup.match(/line-through opacity-50/g) || []).length, 3);
  const reopened = { ...initial, subtasks: initial.subtasks.map(sub => ({ ...sub, done: false })) };
  assert.match(renderToStaticMarkup(render(reopened)), /0\/3/);
});

test('task card renders warning and original workflow together, without affecting normal cards', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TaskItem } = load('app/components/task-item.tsx');
  const render = (task) => renderToStaticMarkup(React.createElement(TaskItem, {
    task, profiles: [], currentUser: { id: 'user' }, userRole: 'admin',
  }));
  const warned = render(processTasks([{ ...base, workflow_status: 'bloqueada' }])[0]);
  assert.match(warned, /Ver pendência da ocorrência anterior/);
  assert.doesNotMatch(warned, /Última ocorrência não concluída/);
  assert.match(warned, /--task-card-edge:var\(--color-amber-400\)/);
  assert.match(warned, /bg-amber-500/);
  assert.match(warned, /Bloqueada/);
  const normal = render(processTasks([{ ...base, last_done_date: '2026-10-20' }])[0]);
  assert.doesNotMatch(normal, /Ver pendência da ocorrência anterior/);
  assert.match(normal, /Pendente/);

  for (const [changes, color] of [
    [{}, 'amber'],
    [{ last_done_date: '2026-10-20', workflow_status: 'em_andamento' }, 'blue'],
    [{ last_done_date: '2026-10-20' }, 'slate'],
    [{ last_done_date: '2026-10-27' }, 'green'],
    [{ repeat_days: '', is_one_off: true, due_date: '2026-10-20' }, 'red'],
  ]) {
    const markup = render(processTasks([{ ...base, ...changes, subtasks: [{ title: 'Etapa', done: false }] }])[0]);
    const button = markup.match(/<button[^>]*aria-label="Mostrar subtarefas"[^>]*>/)?.[0];
    assert.ok(button);
    assert.match(button, new RegExp(`text-${color}-`));
  }

  if (process.env.PLAYWRIGHT_MODULE_PATH) {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
    const postcss = require('postcss');
    const tailwind = require('@tailwindcss/postcss');
    const { mkdtempSync, writeFileSync } = require('node:fs');
    const directory = mkdtempSync(path.join(require('node:os').tmpdir(), 'task-warning-qa-'));
    const root = path.resolve(__dirname, '..');
    const cssPath = path.join(root, 'app/globals.css');
    const css = await postcss([tailwind({ base: root })]).process(readFileSync(cssPath, 'utf8'), { from: cssPath });
    const alias = {};
    for (const file of ['app/components/task-occurrence-notice.tsx', 'lib/task-recurrence.ts']) {
      const output = path.join(directory, path.basename(file).replace(/\.tsx?$/, '.js'));
      writeFileSync(output, ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
      }).outputText);
      alias['@/' + file.replace(/\.tsx?$/, '')] = output;
    }
    writeFileSync(path.join(directory, 'entry.js'), `const React=require('react');const {createRoot}=require('react-dom/client');const {TaskOccurrenceNotice}=require('./task-occurrence-notice');createRoot(document.getElementById('notice')).render(React.createElement(TaskOccurrenceNotice,{date:'2026-10-20'}));`);
    const webpackModule = require('next/dist/compiled/webpack/webpack');
    const webpack = webpackModule.webpack || webpackModule.default;
    await new Promise((resolve, reject) => webpack({ mode: 'development', entry: path.join(directory, 'entry.js'), output: { path: directory, filename: 'bundle.js' }, resolve: { alias, modules: [path.join(root, 'node_modules')] }, devtool: false }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()));
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
      const page = await browser.newPage();
      for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
        await page.setViewportSize({ width, height });
        const card = warned.replace(/<button[^>]*aria-label="Ver pendência da ocorrência anterior"[\s\S]*?<\/button>/, '<div id="notice"></div>');
        await page.setContent(`<html><body><main style="padding:16px">${card}<div style="height:16px"></div>${normal}</main></body></html>`);
        await page.addStyleTag({ content: css.css });
        await page.addScriptTag({ path: path.join(directory, 'bundle.js') });
        const dot = page.getByRole('button', { name: 'Ver pendência da ocorrência anterior' });
        const tooltip = page.getByRole('tooltip');
        await dot.waitFor();
        assert.equal(await tooltip.count(), 0);
        await dot.hover();
        await tooltip.waitFor();
        assert.match(await tooltip.innerText(), /20\/10\/2026/);
        const cardBounds = await page.locator('[data-task-card]').first().boundingBox();
        const noticeBounds = await tooltip.boundingBox();
        assert.ok(noticeBounds.y >= cardBounds.y + cardBounds.height || noticeBounds.y + noticeBounds.height <= cardBounds.y);
        await page.mouse.move(width - 1, height - 1);
        await tooltip.waitFor({ state: 'detached' });
        await dot.click();
        await tooltip.waitFor();
        await page.keyboard.press('Escape');
        await tooltip.waitFor({ state: 'detached' });
        await page.locator('main').evaluate(element => { element.style.paddingTop = '160px'; });
        await dot.hover();
        await tooltip.waitFor();
        const lowerCardBounds = await page.locator('[data-task-card]').first().boundingBox();
        const upperNoticeBounds = await tooltip.boundingBox();
        assert.ok(upperNoticeBounds.y + upperNoticeBounds.height <= lowerCardBounds.y);
        await page.mouse.move(width - 1, height - 1);
        await dot.blur();
        await tooltip.waitFor({ state: 'detached' });
        await dot.blur();
        await dot.focus();
        await tooltip.waitFor();
        await page.keyboard.press('Escape');
        await tooltip.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
        if (name === 'desktop') {
          await page.locator('main').evaluate(element => { element.style.maxWidth = '1000px'; });
          await dot.blur();
          await page.mouse.move(width - 1, height - 1);
          await dot.hover();
          await tooltip.waitFor();
          const rightCard = await page.locator('[data-task-card]').first().boundingBox();
          const rightNotice = await tooltip.boundingBox();
          assert.ok(rightNotice.x >= rightCard.x + rightCard.width + 8);
          assert.ok(rightNotice.x + rightNotice.width <= width - 12);
          assert.ok(rightNotice.y < rightCard.y + rightCard.height);
          await page.screenshot({ path: path.join(directory, 'desktop-right-notice.png'), fullPage: true });
        }
      }
      console.log(`Card screenshots: ${directory}`);
    } finally {
      await browser.close();
    }
  }
});
