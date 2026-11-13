const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const webpackModule = require('next/dist/compiled/webpack/webpack');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'supplier-quotation-grid-'));
  const alias = {};
  for (const source of ['app/components/supplier-quotation-portal.tsx', 'app/components/table-sort.tsx', 'lib/reallocation-table-sort.ts', 'lib/supplier-quotation-price-import.ts']) {
    const output = path.join(temp, `${path.parse(source).name}.js`);
    alias[`@/${source.replace(/\.tsx?$/, '')}`] = output;
    fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(path.join(root, source), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText);
  }
  const entry = path.join(temp, 'entry.js');
  fs.writeFileSync(entry, "const {createElement}=require('react'); const {createRoot}=require('react-dom/client'); const {SupplierQuotationPortal}=require('./supplier-quotation-portal'); createRoot(document.getElementById('root')).render(createElement(SupplierQuotationPortal));");
  await new Promise((resolve, reject) => (webpackModule.webpack || webpackModule.default)({
    mode: 'development', entry, output: { path: temp, filename: 'bundle.js' }, devtool: false,
    resolve: { alias, modules: [path.join(root, 'node_modules')] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()));
  const cssFile = path.join(root, 'app/globals.css');
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(cssFile, 'utf8'), { from: cssFile });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const items = Array.from({ length: 52 }, (_, i) => ({ id: `${i}`, description: `Produto ${i + 1}`, quantity: 12 }));
    let saved;
    await page.route('http://supplier-qa.local/**', route => {
      if (route.request().method() === 'POST') {
        saved = route.request().postDataJSON();
        return route.fulfill({ json: { revision: 1, submittedAt: null } });
      }
      if (route.request().url().endsWith('/respond')) return route.fulfill({ json: {
        supplier: 'Fornecedor', expiresAt: '2027-01-01T00:00:00Z', defaultPaymentDays: 30,
        revision: 0, items, proposal: { offers: [], unavailableItemIds: ['1', '50'] },
      } });
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' });
    });
    await page.goto(`http://supplier-qa.local/#${'a'.repeat(43)}`);
    await page.addStyleTag({ content: css.css });
    await page.addScriptTag({ path: path.join(temp, 'bundle.js') });
    const price = n => page.getByRole('textbox', { name: `Preço: Produto ${n}`, exact: true });
    const active = async locator => assert.equal(await locator.evaluate(el => document.activeElement === el), true);
    await price(1).fill('12,99');
    await price(1).press('ArrowDown');
    await active(price(3));
    await price(3).fill('14,50');
    await price(3).press('End');
    await price(3).press('ArrowRight');
    const available = page.getByRole('textbox', { name: 'Quantidade disponível: Produto 3', exact: true });
    await active(available);
    await available.fill('100');
    await available.press('ArrowLeft');
    assert.equal(await available.evaluate(el => el.selectionStart), 2);
    await available.press('Home');
    await available.press('ArrowLeft');
    await active(price(3));
    await price(3).press('Shift+Enter');
    await active(price(1));
    await price(50).press('Enter');
    await active(price(52));
    await price(52).press('ArrowUp');
    await active(price(50));
    const header = page.getByRole('columnheader', { name: 'Preço unitário (R$)', exact: true });
    await header.dblclick();
    const firstRow = await price(3).evaluate(el => el.closest('tr').dataset.offerIndex);
    await price(3).fill('1,00');
    assert.equal(await price(3).evaluate(el => el.closest('tr').dataset.offerIndex), firstRow);
    await page.locator('th[aria-sort]').press('Escape');
    await page.getByRole('textbox', { name: 'Buscar item', exact: true }).fill('Produto 3');
    await price(3).press('ArrowDown');
    await active(price(30));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('table').evaluate(el => el.parentElement.scrollWidth > el.parentElement.clientWidth));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await page.getByText('Rascunho salvo.').waitFor();
    assert.deepEqual(saved.proposal.offers.map(row => [row.itemId, row.unitPrice, row.available]), [['0', 12.99, null], ['2', 1, 100]]);
    await page.screenshot({ path: path.join(temp, 'mobile.png') });
    console.log(`Supplier grid verified. Screenshots: ${temp}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
