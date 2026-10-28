const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const webpackModule = require('next/dist/compiled/webpack/webpack');
const webpack = webpackModule.webpack || webpackModule.default;
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-calendar-qa-'));
  const alias = {};
  for (const file of ['app/components/meeting-calendar-view.tsx', 'lib/permissions.ts']) {
    const output = path.join(directory, path.basename(file).replace(/\.tsx?$/, '.js'));
    fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText);
    alias['@/' + file.replace(/\.tsx?$/, '')] = output;
  }
  fs.writeFileSync(path.join(directory, 'auth.js'), 'exports.getAuthHeaders=async()=>({});');
  alias['@/lib/auth-headers'] = path.join(directory, 'auth.js');
  const task = (id, title, date, notes = '', end = date) => ({ id, title, due_date: date, lastOcc: date, nextOcc: date, category: 'Reunião', assigned_to: 'test', sector: 'Geral', isDoneToday: false, notes: `Horário: 09:00\nMotivo: Planejamento\nData final: ${end}\n${notes}` });
  const tasks = [task('1', 'Alinhamento comercial', '2026-10-08'), task('2', 'Revisão de resultados', '2026-10-08'), task('3', 'Yzael de férias', '2026-10-12', '', '2026-10-23'), task('4', 'Reunião de equipe', '2026-10-27')];
  fs.writeFileSync(path.join(directory, 'entry.js'), `const React=require('react');const {createRoot}=require('react-dom/client');const {MeetingCalendarView}=require('./meeting-calendar-view');const noop=()=>{};window.fetch=async()=>({ok:true,json:async()=>({configured:false,connected:false})});createRoot(document.getElementById('root')).render(React.createElement(MeetingCalendarView,{tasks:${JSON.stringify(tasks)},profiles:[{id:'test',full_name:'Wally',sector:'Geral'}],userSector:'Geral',defaultAssignedTo:'test',canDeleteMeetings:true,onDeleteTask:noop,onToggleMeeting:noop,onCreateMeeting:async()=>{},onUpdateMeeting:async()=>{}}));`);
  await new Promise((resolve, reject) => webpack({ mode: 'development', entry: path.join(directory, 'entry.js'), output: { path: directory, filename: 'bundle.js' }, resolve: { alias, modules: [path.join(root, 'node_modules')] }, devtool: false }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()));
  const cssPath = path.join(root, 'app/globals.css');
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-27T12:00:00-03:00') });
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css.css });
    await page.addScriptTag({ path: path.join(directory, 'bundle.js') });
    await page.getByRole('heading', { name: 'outubro de 2026' }).waitFor();
    assert.ok(await page.getByTitle('09:00 Yzael de férias', { exact: true }).count() >= 10);
    await page.screenshot({ path: path.join(directory, 'desktop.png') });
    await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
    await page.getByRole('heading', { name: 'novembro de 2026' }).waitFor();
    await page.getByRole('button', { name: 'Hoje', exact: true }).click();
    await page.getByRole('heading', { name: 'outubro de 2026' }).waitFor();
    await page.getByRole('button', { name: '09:00 Alinhamento comercial', exact: true }).click();
    await page.getByRole('heading', { name: 'Alinhamento comercial', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Fechar detalhes', exact: false }).click();
    await page.getByRole('button', { name: 'Nova reunião', exact: true }).click();
    await page.getByRole('heading', { name: 'Agendar reunião' }).waitFor();
    assert.equal(await page.getByPlaceholder('Ex: Definir prioridades da semana').count(), 0);
    const startDate = page.getByLabel('Data inicial', { exact: true });
    const endDate = page.getByLabel('Data final', { exact: true });
    await startDate.fill('2026-10-27');
    await endDate.fill('2026-11-07');
    assert.match(await startDate.locator('..').innerText(), /27\/10\/2026/);
    assert.match(await endDate.locator('..').innerText(), /07\/11\/2026/);
    assert.equal(await endDate.getAttribute('min'), '2026-10-27');
    assert.equal(await endDate.inputValue(), '2026-11-07');
    await page.screenshot({ path: path.join(directory, 'dates-br.png') });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, screenshots: directory }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
