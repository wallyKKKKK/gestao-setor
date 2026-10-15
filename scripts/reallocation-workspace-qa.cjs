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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reallocation-workspace-qa-'));
  const alias = {};
  const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const name of ['reallocation-manager', 'reallocation-workspace-tabs', 'reallocation-import-report', 'table-column-menu']) {
    fs.writeFileSync(path.join(directory, `${name}.js`), compile(fs.readFileSync(path.join(root, `app/components/${name}.tsx`), 'utf8')));
  }
  for (const name of ['reallocation-sector', 'reallocation-row-markers', 'table-column-visibility']) {
    const output = path.join(directory, `${name}.js`);
    fs.writeFileSync(output, compile(fs.readFileSync(path.join(root, `lib/${name}.ts`), 'utf8')));
    alias[`@/lib/${name}`] = output;
  }
  const mocks = {
    api: `exports.fetchLatestReallocationStockSnapshot=async()=>JSON.parse(localStorage.getItem('qa-snapshot')); exports.countReallocationProducts=async()=>3; for(const name of ['fetchPricingBranches','fetchReallocationAttributeOptions','fetchReallocationAttributeSummary','fetchReallocationProducts','fetchReallocationStockItems'])exports[name]=async()=>[];`,
    'auth-headers': 'exports.getAuthHeaders=async()=>({});',
    permissions: "exports.getPermissionDeniedMessage=()=> 'Sem permissao';",
  };
  for (const [name, source] of Object.entries(mocks)) {
    const output = path.join(directory, `${name}.js`);
    fs.writeFileSync(output, source);
    alias[`@/lib/${name}`] = output;
  }
  fs.writeFileSync(path.join(directory, 'entry.js'), "const React=require('react');const {createRoot}=require('react-dom/client');const {ReallocationManager}=require('./reallocation-manager');createRoot(document.getElementById('root')).render(React.createElement(ReallocationManager));");
  await new Promise((resolve,reject)=>webpack({mode:'development',entry:path.join(directory,'entry.js'),output:{path:directory,filename:'bundle.js'},resolve:{alias,modules:[path.join(root,'node_modules')]},devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||new Error(stats.toString())):resolve()));
  const css=await postcss([tailwind({base:root})]).process('@import "tailwindcss";',{from:path.join(root,'app/qa.css')});
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1792,height:1000}});
    const errors=[]; page.on('pageerror',error=>{errors.push(error.message); console.error(error.message);});
    const stamp=new Date().toISOString();
    const item=(id,description)=>({id,description,ean:id,erpCode:'123',originCode:'01',originName:'Origem',destinationCode:'02',destinationName:'Destino',quantity:3,maxQuantity:3,originStock:20,originAvailableStock:20,originConfirmedStock:20,originMonthlyAvgSales:30,originCurve:'A',originConfirmedPurchase:0,originConfirmedTransfer:0,destinationStock:0,destinationConfirmedStock:0,destinationMonthlyAvgSales:30,destinationCurve:'A',destinationConfirmedPurchase:0,destinationConfirmedTransfer:0,originDailySales:1,destinationDailySales:1,originStockDays:20,destinationStockDays:0,destinationNeed:3,routePriority:1});
    const draft={version:1,sector:'Geral',snapshotId:'qa',snapshotImportedAt:stamp,savedAt:stamp,transferSuggestions:[item('111','Produto sugerido')],confirmedSuggestions:[item('222','Produto confirmado')],suggestionView:'draft',appliedSuggestionSignature:'',suggestionGenerationContext:{snapshotId:'qa',snapshotImportedAt:stamp,generatedAt:stamp}};
    await page.route('http://workspace-qa.local/**',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
    await page.goto('http://workspace-qa.local/');
    await page.evaluate(({stamp,draft})=>{
      localStorage.setItem('qa-snapshot',JSON.stringify({id:'qa',sector:'Geral',imported_at:stamp,source_file:'teste.csv'}));
      localStorage.setItem('reallocation-suggestion-draft-v1:Geral:qa',JSON.stringify(draft));
    },{stamp,draft});
    await page.addStyleTag({content:css.css});
    await page.addScriptTag({path:path.join(directory,'bundle.js')});
    try { await page.locator('tbody input[data-transfer-index]').waitFor({timeout:10000}); }
    catch(error) { await page.screenshot({path:path.join(directory,'failure.png')}); console.error(await page.locator('body').innerText()); console.error('Screenshots: '+directory); throw error; }
    assert.equal(await page.getByRole('tab').count(),3);
    await page.locator('tbody input[data-transfer-index]').fill('4');
    const search=()=>page.getByPlaceholder('Pesquisar na tabela...');
    await search().fill('sugerido');
    await page.screenshot({path:path.join(directory,'suggestions.png')});
    await page.getByRole('tab',{name:/Confirmadas/}).click();
    assert.equal(await page.getByRole('button',{name:'Perfil',exact:true}).count(),0);
    assert.equal(await search().inputValue(),'');
    assert.match(await page.locator('tbody').innerText(),/PRODUTO CONFIRMADO/);
    await search().fill('confirmado');
    await page.screenshot({path:path.join(directory,'confirmed.png')});
    await page.getByRole('tab',{name:/Sugestões/}).click();
    assert.equal(await search().inputValue(),'sugerido');
    assert.equal(await page.locator('tbody input[data-transfer-index]').inputValue(),'4');
    await page.getByRole('tab',{name:/Confirmadas/}).click();
    assert.equal(await search().inputValue(),'confirmado');
    await page.getByRole('tab',{name:/Sugestões/}).click();
    await page.reload();
    await page.addStyleTag({content:css.css});
    await page.addScriptTag({path:path.join(directory,'bundle.js')});
    await page.locator('tbody input[data-transfer-index]').waitFor();
    assert.equal(await page.locator('tbody input[data-transfer-index]').inputValue(),'4');
    await page.getByRole('checkbox',{name:'Selecionar Produto sugerido',exact:true}).check();
    await page.getByRole('button',{name:'Confirmar sugestão',exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:/Confirmadas/}).getAttribute('aria-selected'),'true');
    assert.equal(await search().inputValue(),'');
    await search().fill('');
    assert.equal(await page.locator('tbody tr').count(),2);
    await page.getByRole('button',{name:'Gerar pedido TXT',exact:true}).click();
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'Baixar TXT',exact:true}).click();
    assert.match((await download).suggestedFilename(),/pedido-transferencia/);
    assert.equal(await page.getByRole('tab',{name:/Pedidos/}).getAttribute('aria-selected'),'true');
    assert.equal(await page.getByRole('button',{name:'Reexportar TXT',exact:true}).count(),1);
    assert.equal(await page.getByRole('group',{name:'Filtrar por tipo de linha'}).count(),0);
    await page.screenshot({path:path.join(directory,'orders.png')});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(directory,'orders-mobile.png')});
    const bounds=await page.getByRole('tablist').boundingBox();
    assert.ok(bounds.width<=390);
    await page.getByRole('tab',{name:/Pedidos/}).press('ArrowLeft');
    assert.equal(await page.getByRole('tab',{name:/Confirmadas/}).getAttribute('aria-selected'),'true');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,screenshots:directory}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
