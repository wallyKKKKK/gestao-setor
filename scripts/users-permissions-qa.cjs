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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'users-permissions-qa-'));
  const alias = {};
  for (const file of ['app/components/settings-modal.tsx', 'app/constants.ts', 'lib/permissions.ts']) {
    const output = path.join(directory, path.basename(file).replace(/\.tsx?$/, '.js'));
    fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText);
    alias['@/' + file.replace(/\.tsx?$/, '')] = output;
  }
  const profiles = [{ id: '1', full_name: 'Ana Admin', role: 'admin', sector: 'Geral', account_status: 'approved', is_active: true }, { id: '2', full_name: 'Bruno Teste', role: 'membro', sector: 'Geral', account_status: 'pending', is_active: true }];
  fs.writeFileSync(path.join(directory, 'entry.js'), `const React=require('react');const {createRoot}=require('react-dom/client');const {SettingsModal}=require('./settings-modal');const root=createRoot(document.getElementById('root'));const noop=()=>{};window.renderUsers=(role='admin',embedded=true)=>root.render(React.createElement(SettingsModal,{embedded,userRole:role,profiles:${JSON.stringify(profiles)},onClose:noop,onSignOut:noop,onRoleChange:(...args)=>{window.roleChange=args},onSectorChange:noop,onAccountStatusChange:(...args)=>{window.statusChange=args},onActiveChange:noop}));window.renderUsers();`);
  await new Promise((resolve, reject) => webpack({ mode: 'development', entry: path.join(directory, 'entry.js'), output: { path: directory, filename: 'bundle.js' }, resolve: { alias, modules: [path.join(root, 'node_modules')] }, devtool: false }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()));
  const cssPath = path.join(root, 'app/globals.css');
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css.css }); await page.addScriptTag({ path: path.join(directory, 'bundle.js') });
    await page.getByRole('heading', { name: 'Usuários e permissões' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Fechar configuracoes' }).count(), 0);
    await page.getByPlaceholder('Buscar usuario...').fill('Bruno');
    await page.getByRole('button', { name: 'gerente', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.roleChange), ['2', 'gerente']);
    await page.getByTitle('Aprovar usuario', { exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.statusChange), ['2', 'approved']);
    await page.getByPlaceholder('Buscar usuario...').fill('');
    await page.screenshot({ path: path.join(directory, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const role of ['membro', 'gerente']) {
      await page.evaluate(role => window.renderUsers(role), role);
      await page.getByRole('heading', { name: 'Usuários e permissões' }).waitFor({ state: 'detached' });
      assert.equal(await page.getByTitle('Aprovar usuario', { exact: true }).count(), 0);
    }
    await page.evaluate(() => window.renderUsers('admin', false));
    await page.getByRole('heading', { name: 'Configuracoes', exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('Buscar usuario...').count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Permissoes', exact: true }).count(), 0);
    assert.ok(await page.getByRole('button', { name: /Sair do sistema/ }).isVisible());
    await page.screenshot({ path: path.join(directory, 'settings-mobile.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, screenshots: directory }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
