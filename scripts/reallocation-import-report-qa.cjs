const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const bundledWebpack = require('next/dist/compiled/webpack/webpack');
const webpack = bundledWebpack.webpack || bundledWebpack.default;
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'import-report-qa-'));
  const source = fs.readFileSync(path.join(root, 'app/components/reallocation-import-report.tsx'), 'utf8');
  fs.writeFileSync(path.join(directory, 'component.js'), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText);
  const unmatchedItems = Array.from({ length: 123 }, (_, index) => ({ line: index + 2, storeCode: '01', storeName: 'Loja teste', ean: `789${index}`, product: `Produto ${index}`, reason: 'EAN sem codigo ERP vinculado na base de produtos' }));
  const report = { sourceFile: 'estoque-teste.csv', sector: 'Geral', imported: 500, replacedRows: 600, matchedProducts: 377, unmatchedProducts: 123, skipped: 1, totalRows: 501, uniqueProducts: 400, stores: [{ code: '01', name: 'Loja teste' }], unmatchedItems, skippedRows: [{ line: 502, storeCode: '02', storeName: '', ean: '789999', product: 'Produto ignorado', reason: 'Campos obrigatorios ausentes: nome da loja' }], movementColumnsAvailable: true, erpInventoryWarning: null };
  fs.writeFileSync(path.join(directory, 'entry.js'), `const React=require('react'); const {createRoot}=require('react-dom/client'); const {ReallocationImportReportDialog}=require('./component'); createRoot(document.getElementById('root')).render(React.createElement(ReallocationImportReportDialog,{report:${JSON.stringify(report)},onClose:()=>document.getElementById('root').remove()}));`);
  await new Promise((resolve, reject) => webpack({ mode: 'development', entry: path.join(directory, 'entry.js'), output: { path: directory, filename: 'bundle.js' }, resolve: { modules: [path.join(root, 'node_modules')] }, devtool: false }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()));
  const css = await postcss([tailwind({ base: root })]).process('@import "tailwindcss";', { from: path.join(root, 'app/qa.css') });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css.css });
    await page.addScriptTag({ path: path.join(directory, 'bundle.js') });
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('tbody tr').count(), 50);
    await page.getByRole('button', { name: 'Proxima pagina', exact: true }).click();
    assert.match(await page.locator('tbody tr').first().innerText(), /Produto 50/);
    await page.getByRole('textbox').fill('Produto 122');
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.getByRole('button', { name: 'Linhas ignoradas (1)', exact: true }).click();
    assert.match(await page.locator('tbody').innerText(), /nome da loja/);
    await page.getByRole('button', { name: 'Itens sem vinculo (123)', exact: true }).click();
    await page.screenshot({ path: path.join(directory, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(directory, 'mobile.png') });
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.width <= 390 && bounds.x >= 0);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar pendencias' }).click();
    assert.equal((await download).suggestedFilename(), 'pendencias-importacao.csv');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, screenshots: directory }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
