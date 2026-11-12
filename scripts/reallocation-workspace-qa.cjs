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
  for (const name of ['reallocation-manager', 'reallocation-workspace-tabs', 'reallocation-import-report', 'reallocation-import-filter-preview', 'reallocation-analysis', 'app-loading-overlay', 'table-sort', 'table-column-menu', 'table-focus-controller']) {
    const output = path.join(directory, `${name}.js`);
    fs.writeFileSync(output, compile(fs.readFileSync(path.join(root, `app/components/${name}.tsx`), 'utf8')));
    alias[`@/app/components/${name}`] = output;
  }
  for (const name of ['reallocation-sector', 'reallocation-row-markers', 'table-column-visibility', 'reallocation-table-sort', 'reallocation-import-filters', 'reallocation-needs']) {
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
  fs.writeFileSync(path.join(directory, 'entry.js'), "const React=require('react');const {createRoot}=require('react-dom/client');const {ReallocationManager}=require('./reallocation-manager');const {TableFocusController}=require('./table-focus-controller');createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(TableFocusController),React.createElement(ReallocationManager)));");
  await new Promise((resolve,reject)=>webpack({mode:'development',entry:path.join(directory,'entry.js'),output:{path:directory,filename:'bundle.js'},resolve:{alias,modules:[path.join(root,'node_modules')]},devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||new Error(stats.toString())):resolve()));
  const globals=fs.readFileSync(path.join(root,'app/globals.css'),'utf8');
  const css=await postcss([tailwind({base:root})]).process(globals,{from:path.join(root,'app/globals.css')});
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1792,height:1000}});
    const errors=[]; page.on('pageerror',error=>{errors.push(error.message); console.error(error.message);});
    const stamp=new Date().toISOString();
    const item=(id,description)=>({id,description,ean:id,erpCode:'123',originCode:'01',originName:'Origem',destinationCode:'02',destinationName:'Destino',quantity:3,maxQuantity:3,originStock:20,originAvailableStock:20,originConfirmedStock:20,originMonthlyAvgSales:30,originCurve:'A',originConfirmedPurchase:0,originConfirmedTransfer:0,destinationStock:0,destinationConfirmedStock:0,destinationMonthlyAvgSales:30,destinationCurve:'A',destinationConfirmedPurchase:0,destinationConfirmedTransfer:0,originDailySales:1,destinationDailySales:1,originStockDays:20,destinationStockDays:0,destinationNeed:3,routePriority:1});
    const suggested={...item('111','Produto sugerido'),destinationNeed:8,originProtectedStock:6,originSurplusBeforeAllocation:14,automaticSplitDestinations:2,originLastSaleDays:15,originLastPurchaseDays:0,destinationLastSaleDays:1,destinationLastPurchaseDays:null};
    const supplied={...item('222','Produto confirmado'),ean:'111',destinationCode:'03',destinationName:'Destino suprido'};
    const unmetNeeds={total:1,missingUnits:7,rows:[{ean:'333',product:'Produto sem rota',destinationCode:'02',destinationName:'Destino',needed:7,suggested:0,reason:'route'}]};
    const draft={version:1,sector:'Geral',snapshotId:'qa',snapshotImportedAt:stamp,savedAt:stamp,transferSuggestions:[suggested],confirmedSuggestions:[supplied],suggestionView:'draft',appliedSuggestionSignature:'',suggestionGenerationContext:{snapshotId:'qa',snapshotImportedAt:stamp,generatedAt:stamp},unmetNeeds};
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
    assert.equal(await page.getByRole('tab').count(),4);
    const restoredNotice=page.getByRole('button',{name:'Rascunho restaurado',exact:true});
    const notice=page.getByRole('tooltip');
    await restoredNotice.hover();
    assert.match(await notice.innerText(),/Seus ajustes manuais foram mantidos/);
    await page.keyboard.press('Escape');
    await notice.waitFor({state:'hidden'});
    const actions=page.getByRole('group',{name:'Ações de sugestões'});
    assert.deepEqual((await actions.getByRole('button').allTextContents()).map(text=>text.trim()),['Opções','Perfil','Atualizar']);
    const tabsBounds=await page.getByRole('tablist').boundingBox();
    const actionsBounds=await actions.boundingBox();
    assert.ok(tabsBounds.x+tabsBounds.width<actionsBounds.x);
    assert.ok(Math.abs(tabsBounds.y+tabsBounds.height/2-actionsBounds.y-actionsBounds.height/2)<2);
    const options=actions.getByRole('button',{name:'Opções'});
    await options.click();
    await actions.getByRole('button',{name:'Ocultar filtros',exact:true}).click();
    assert.ok(await actions.getByRole('button',{name:'Atualizar',exact:true}).isVisible());
    await options.click();
    await actions.getByRole('button',{name:'Mostrar filtros',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    const mobileActionsBounds=await actions.boundingBox();
    assert.ok(mobileActionsBounds.x>=0 && mobileActionsBounds.x+mobileActionsBounds.width<=390);
    await options.click();
    await actions.getByRole('button',{name:'Resumo',exact:true}).click();
    const summaryBounds=await actions.getByRole('region',{name:'Resumo do remanejamento'}).boundingBox();
    assert.ok(summaryBounds.x>=0 && summaryBounds.x+summaryBounds.width<=390);
    await actions.getByRole('button',{name:'Fechar resumo',exact:true}).click();
    await page.setViewportSize({width:1792,height:1000});
    assert.equal(await page.getByRole('button',{name:'Raio-X',exact:true}).getAttribute('aria-pressed'),'true');
    const quantity=page.locator('tbody input[data-transfer-index]');
    assert.ok(await quantity.evaluate(el=>el.closest('td').classList.contains('bg-orange-200')));
    const quantityStyle=await quantity.evaluate(el=>{
      const style=getComputedStyle(el);
      return {border:style.borderTopWidth,radius:style.borderRadius,align:style.textAlign};
    });
    assert.deepEqual(quantityStyle,{border:'1px',radius:'0px',align:'center'});
    const fillsQuantityCell=()=>quantity.evaluate(el=>{
      const field=el.getBoundingClientRect();
      const cell=el.closest('td');
      return Math.abs(field.height-cell.clientHeight)<=1 && Math.abs(field.top-cell.getBoundingClientRect().top)<=1;
    });
    assert.ok(await fillsQuantityCell());
    await page.evaluate(()=>{
      window.addEventListener('wally-table-row-focus-change',event=>{
        document.body.dataset.qaDroppedRowFocus='true';
        event.stopImmediatePropagation();
      },{capture:true,once:true});
    });
    await quantity.focus();
    assert.equal(await page.locator('body').getAttribute('data-qa-dropped-row-focus'),'true');
    assert.equal(await quantity.evaluate(el=>getComputedStyle(el.closest('td')).outlineStyle),'none');
    const inspection=page.getByRole('complementary',{name:'Raio-X da sugestão'});
    assert.equal(await quantity.evaluate(el=>el.closest('tr').classList.contains('wally-table-focused-row')),true);
    assert.equal(await quantity.evaluate(el=>{
      const style=getComputedStyle(el.closest('td'),'::after');
      return style.borderTopWidth==='1px' && style.pointerEvents==='none'
        && style.getPropertyValue('--table-focus-color').trim()===style.getPropertyValue('--color-violet-600').trim();
    }),true);
    assert.match(await inspection.innerText(),/Última venda: Há 15 dias · Última compra: 0 dias/);
    assert.match(await inspection.innerText(),/Última venda: Há 1 dia · Última compra: Sem dado/);
    assert.match(await inspection.innerText(),/Rateio automático · 2 destinos empatados/);
    const split=inspection.getByRole('region',{name:'Destinos do rateio'});
    assert.match(await split.innerText(),/03 Destino suprido\s+3 de 3 un\. · Suprido/);
    const inspectionBlocks=()=>inspection.locator(':scope > header, :scope > section').evaluateAll(blocks=>blocks.map(block=>{
      const {left,right,top,bottom}=block.getBoundingClientRect();
      return {left,right,top,bottom};
    }));
    const desktopBlocks=await inspectionBlocks();
    assert.equal(desktopBlocks.length,4);
    assert.ok(desktopBlocks.slice(1).every((block,index)=>block.top===desktopBlocks[0].top && block.left>=desktopBlocks[index].right));
    await page.setViewportSize({width:390,height:844});
    const mobileBlocks=await inspectionBlocks();
    assert.ok(mobileBlocks.slice(1).every((block,index)=>block.left===mobileBlocks[0].left && block.top>=mobileBlocks[index].bottom));
    await page.setViewportSize({width:1792,height:1000});
    assert.match(await inspection.innerText(),/Faltam: 5 un\./);
    await quantity.fill('8');
    assert.match(await inspection.innerText(),/\(100%\) · Faltam: 0 un\./);
    await quantity.fill('10');
    assert.match(await inspection.innerText(),/\(125%\) · Excede: 2 un\./);
    await page.locator('tbody input[data-transfer-index]').fill('4');
    assert.equal(await quantity.evaluate(el=>el.closest('tr').classList.contains('wally-table-focused-row')),true);
    assert.ok(await quantity.evaluate(el=>el.closest('td').classList.contains('bg-[#ddd6fe]')));
    assert.ok(await fillsQuantityCell());
    assert.equal(await quantity.locator('..').getByText('Sugestão 3',{exact:true}).isVisible(),true);
    assert.match(await inspection.innerText(),/Faltam: 4 un\./);
    await page.screenshot({path:path.join(directory,'inspection.png')});
    assert.equal(await inspection.getByRole('button',{name:'Fechar raio-X',exact:true}).count(),0);
    await page.getByRole('button',{name:'Raio-X',exact:true}).click();
    await page.getByRole('tab',{name:/Necessidades/}).click();
    assert.match(await page.locator('tbody').innerText(),/Produto sem rota/);
    assert.match(await page.locator('tbody').innerText(),/Sem rota permitida/);
    await page.getByRole('searchbox',{name:'Pesquisar necessidades'}).fill('inexistente');
    await page.getByText('Nenhuma necessidade encontrada na pesquisa.').waitFor();
    await page.getByRole('searchbox',{name:'Pesquisar necessidades'}).clear();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(directory,'unmet-mobile.png')});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const reasonBounds=await page.getByText('Sem rota permitida para a sobra disponível').boundingBox();
    assert.ok(reasonBounds.x+reasonBounds.width<=390);
    await page.setViewportSize({width:1792,height:1000});
    await page.getByRole('tab',{name:/Sugestões/}).click();
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
    assert.equal(await page.getByRole('button',{name:'Raio-X',exact:true}).getAttribute('aria-pressed'),'true');
    const rows=page.locator('tbody tr[data-reallocation-suggestion-id]');
    const assertContinuousOutline=async (cell,label)=>{
      await cell.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'center'}));
      const [cellBounds,rowBounds]=await Promise.all([cell.boundingBox(),rows.first().boundingBox()]);
      const visibleGrid=await cell.evaluate(el=>{
        const grid=el.closest('table').parentElement;
        const left=grid.getBoundingClientRect().left+grid.clientLeft;
        return {left,right:left+grid.clientWidth};
      });
      const rowScreenshot=await page.screenshot({path:path.join(directory,`row-focus-${label}.png`)});
      const firstGap=await page.evaluate(async ({png,cellBounds,rowBounds,visibleGrid})=>{
        const img=new Image();
        img.src='data:image/png;base64,'+png;
        await img.decode();
        const canvas=document.createElement('canvas');
        canvas.width=img.width;
        canvas.height=img.height;
        const ctx=canvas.getContext('2d');
        ctx.drawImage(img,0,0);
        const violet=(x,y)=> {
          const [r,g,b]=ctx.getImageData(x,y,1,1).data;
          return b-r>35 && r-g>20 && b-g>90;
        };
        const left=Math.max(0,Math.ceil(visibleGrid.left),Math.floor(rowBounds.x),Math.floor(cellBounds.x)-1);
        const right=Math.min(img.width,Math.floor(visibleGrid.right),Math.floor(rowBounds.x+rowBounds.width),Math.ceil(cellBounds.x+cellBounds.width)+2)-1;
        if (right<left) return 'not visible';
        return Array.from({length:right-left+1},(_,index)=>left+index).find(x=>
          ![0,1].some(offset=>violet(x,Math.floor(rowBounds.y)+offset))
          || ![1,2].some(offset=>violet(x,Math.ceil(rowBounds.y+rowBounds.height)-offset)));
      },{png:rowScreenshot.toString('base64'),cellBounds,rowBounds,visibleGrid});
      assert.equal(firstGap,undefined,`Gap at x=${firstGap} around ${label} (${JSON.stringify(cellBounds)}). Screenshot: ${directory}`);
    };
    for (const [label,header] of [['origin-days',/^Dias Orig\.$/i],['destination-stock',/^Estoque Conf\. Dest\.$/i],['ean',/^EAN$/i]]) {
      const index=await page.getByRole('columnheader',{name:header}).evaluate(el=>el.cellIndex);
      const cell=rows.first().locator('td').nth(index);
      await cell.click();
      await assertContinuousOutline(cell,label);
    }
    await quantity.first().click();
    await assertContinuousOutline(quantity.first().locator('..'),'quantity');
    await rows.first().locator('td').nth(2).click();
    const firstProduct=await inspection.getByRole('heading',{level:2}).innerText();
    const inspectionHeights=()=>inspection.evaluate(panel=>({
      panel:panel.getBoundingClientRect().height,
      cards:[...panel.querySelectorAll(':scope > section')].map(card=>card.getBoundingClientRect().height),
    }));
    const firstHeights=await inspectionHeights();
    await page.keyboard.press('ArrowDown');
    assert.equal(await rows.nth(1).getAttribute('aria-selected'),'true');
    assert.notEqual(await inspection.getByRole('heading',{level:2}).innerText(),firstProduct);
    const secondHeights=await inspectionHeights();
    assert.deepEqual([firstHeights.cards.length,secondHeights.cards.length].sort(),[2,3]);
    assert.equal(firstHeights.panel,secondHeights.panel);
    assert.ok([...firstHeights.cards,...secondHeights.cards].every(height=>height===firstHeights.cards[0]));
    await page.keyboard.press('Escape');
    await inspection.getByText('Selecione uma linha da tabela.').waitFor();
    assert.equal((await inspectionHeights()).panel,firstHeights.panel);
    assert.equal(await rows.nth(1).getAttribute('aria-selected'),null);
    await quantity.first().focus();
    await quantity.first().press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('data-transfer-index')==='1');
    assert.notEqual(await inspection.getByRole('heading',{level:2}).innerText(),firstProduct);
    await quantity.nth(1).press('ArrowUp');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('data-transfer-index')==='0');
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
    const oldStamp=new Date(Date.now()-40*60_000).toISOString();
    await page.evaluate(({oldStamp,draft})=>{
      localStorage.setItem('qa-snapshot',JSON.stringify({id:'qa',sector:'Geral',imported_at:oldStamp,source_file:'teste.csv'}));
      localStorage.setItem('reallocation-suggestion-draft-v1:Geral:qa',JSON.stringify({...draft,snapshotImportedAt:oldStamp}));
    },{oldStamp,draft});
    await page.reload();
    await page.addStyleTag({content:css.css});
    await page.addScriptTag({path:path.join(directory,'bundle.js')});
    const stockNotice=page.getByRole('button',{name:'Estoque antigo',exact:true});
    await stockNotice.click();
    assert.match(await notice.innerText(),/Importe um novo estoque/);
    const noticeBounds=await notice.boundingBox();
    assert.ok(noticeBounds.x>=0 && noticeBounds.x+noticeBounds.width<=390);
    await stockNotice.click();
    await notice.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,screenshots:directory}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
