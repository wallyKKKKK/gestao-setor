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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sidebar-preferences-qa-'));
  const alias = {};
  for (const file of ['app/components/app-sidebar.tsx', 'lib/section-theme.ts']) {
    const output = path.join(directory, path.basename(file).replace(/\.tsx?$/, '.js'));
    fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText);
    alias['@/' + file.replace(/\.tsx?$/, '')] = output;
  }
  fs.writeFileSync(path.join(directory, 'db.js'), `window.preferences={one:['TAREFAS','AUDITORIA']};exports.supabase={from(){let id,payload;const chain={select(){return chain},eq(k,v){id=v;return chain},async maybeSingle(){return {data:window.preferences[id]?{sections:window.preferences[id]}:null,error:null}},upsert(v){payload=v;return chain},async single(){await new Promise(r=>setTimeout(r,100));if(window.failSave)return {error:{message:'offline'}};window.preferences[payload.user_id]=payload.sections;return {data:{sections:payload.sections},error:null}}};return chain}};`);
  alias['@/lib/supabase'] = path.join(directory, 'db.js');
  fs.appendFileSync(path.join(directory, 'db.js'), `const originalFrom=exports.supabase.from;exports.supabase.from=(...args)=>{const chain=originalFrom(...args);const read=chain.maybeSingle;chain.maybeSingle=async()=>{await new Promise(resolve=>setTimeout(resolve,window.loadDelay||0));return read()};return chain};`);
  fs.writeFileSync(path.join(directory, 'entry.js'), `const React=require('react');const {createRoot}=require('react-dom/client');const {AppSidebar}=require('./app-sidebar');const root=createRoot(document.getElementById('root'));window.renderSidebar=(id='one',key='first')=>root.render(React.createElement(AppSidebar,{key,userId:id,userRole:'membro',activeSection:'TAREFAS',availableSections:['TAREFAS','REUNIAO','NOTAS','PRECIFICACAO'],userSector:'Geral',isSupremeAdmin:false,onSectionChange:section=>{window.section=section}}));window.renderSidebar();`);
  await new Promise((resolve, reject) => webpack({ mode: 'development', entry: path.join(directory, 'entry.js'), output: { path: directory, filename: 'bundle.js' }, resolve: { alias, modules: [path.join(root, 'node_modules')] }, devtool: false }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()));
  const cssPath = path.join(root, 'app/globals.css');
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('http://sidebar.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' }));
    await page.goto('http://sidebar.test');
    await page.addStyleTag({ content: css.css }); await page.addScriptTag({ path: path.join(directory, 'bundle.js') });
    const customize = page.getByRole('button', { name: 'Personalizar atalhos' });
    await customize.click();
    await page.getByRole('checkbox', { name: 'Price', exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Auditoria' }).count(), 0);
    await page.getByRole('checkbox', { name: 'Tarefas', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Price', exact: true }).check();
    await page.getByRole('button', { name: 'Salvar atalhos', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: 'Tarefas', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Price', exact: true }).click();
    assert.equal(await page.evaluate(() => window.section), 'PRECIFICACAO');
    await page.evaluate(() => {
      window.loadDelay = 800;
      window.flashes = [];
      window.watcher = new MutationObserver(() => {
        if (document.querySelector('button[aria-label="Tarefas"]')) window.flashes.push('default');
      });
      window.watcher.observe(document.getElementById('root'), { subtree: true, childList: true });
      window.renderSidebar('one', 'reload');
    });
    await page.getByRole('button', { name: 'Price', exact: true }).waitFor();
    await customize.click();
    await page.getByRole('checkbox', { name: 'Notas', exact: true }).check();
    assert.deepEqual(await page.evaluate(() => window.flashes), []);
    await page.evaluate(() => window.watcher.disconnect());
    await page.evaluate(() => { window.failSave = true; });
    await page.getByRole('button', { name: 'Salvar atalhos', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.ok(await page.getByRole('checkbox', { name: 'Notas', exact: true }).isChecked());
    await page.evaluate(() => { window.failSave = false; });
    await page.getByRole('button', { name: 'Salvar atalhos', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 844 });
    await customize.click();
    await page.screenshot({ path: path.join(directory, 'mobile.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.evaluate(() => window.renderSidebar('two', 'different-user'));
    await page.getByRole('button', { name: 'Tarefas', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Price', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, screenshots: directory }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
