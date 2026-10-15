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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'column-menu-qa-'));
  const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  fs.writeFileSync(path.join(directory, 'component.js'), compile(fs.readFileSync(path.join(root, 'app/components/table-column-menu.tsx'), 'utf8')));
  const manager = ts.createSourceFile('manager.tsx', fs.readFileSync(path.join(root, 'app/components/reallocation-manager.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = manager.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(manager) === 'SUGGESTION_COLUMNS'));
  fs.writeFileSync(path.join(directory, 'columns.js'), compile(declaration.getText(manager) + '\nexports.columns = SUGGESTION_COLUMNS.filter(column => column.key !== "actions");'));
  fs.writeFileSync(path.join(directory, 'entry.js'), `
    const React=require('react'); const {createRoot}=require('react-dom/client'); const {TableColumnMenu}=require('./component'); const {columns}=require('./columns');
    function App(){
      const [hidden,setHidden]=React.useState(()=>JSON.parse(localStorage.getItem('hidden')||'[]'));
      const [open,setOpen]=React.useState(false);
      React.useEffect(()=>localStorage.setItem('hidden',JSON.stringify(hidden)),[hidden]);
      return React.createElement('main',{},React.createElement('button',{onContextMenu:event=>{event.preventDefault();setOpen(true)},onClick:()=>setOpen(true)},'Produto'),
        React.createElement('output',{},hidden.length+' ocultas'),open&&React.createElement(TableColumnMenu,{x:1390,y:850,column:columns[1],columns,hidden,canSort:true,
        onSort:direction=>window.lastSort=direction,onRestoreWidth:()=>window.restoredWidth=true,onRestoreAll:()=>{window.restoredAll=true;setHidden([])},
        onToggle:key=>setHidden(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key]),onShowAll:()=>setHidden([]),onClose:()=>setOpen(false)}));
    } createRoot(document.getElementById('root')).render(React.createElement(App));`);
  await new Promise((resolve,reject)=>webpack({mode:'development',entry:path.join(directory,'entry.js'),output:{path:directory,filename:'bundle.js'},resolve:{modules:[path.join(root,'node_modules')]},devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||new Error(stats.toString())):resolve()));
  const css=await postcss([tailwind({base:root})]).process('@import "tailwindcss";',{from:path.join(root,'app/qa.css')});
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://column-qa.local/**',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
    const load=async()=>{await page.goto('http://column-qa.local/');await page.addStyleTag({content:css.css});await page.addScriptTag({path:path.join(directory,'bundle.js')});};
    const open=()=>page.getByRole('button',{name:'Produto',exact:true}).click({button:'right'});
    await load(); await open();
    await page.getByRole('button',{name:'Ordenar crescente',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.lastSort),'asc');
    await open(); await page.getByRole('button',{name:'Configurar colunas',exact:true}).click();
    assert.equal(await page.getByRole('checkbox').count(),22);
    await page.getByRole('checkbox',{name:'EAN',exact:true}).uncheck();
    assert.match(await page.locator('output').innerText(),/1 ocultas/);
    await page.screenshot({path:path.join(directory,'desktop.png')});
    await page.keyboard.press('Escape'); await load(); await open();
    await page.getByRole('button',{name:'Configurar colunas',exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:'EAN',exact:true}).isChecked(),false);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(directory,'mobile.png')});
    const bounds=await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=390 && bounds.y+bounds.height<=844);
    await page.getByRole('button',{name:'Mostrar todas',exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:'EAN',exact:true}).isChecked(),true);
    await page.getByRole('button',{name:'Voltar',exact:true}).click();
    await page.getByRole('button',{name:'Restaurar todas as colunas',exact:true}).click();
    assert.equal(await page.evaluate(()=>Boolean(window.restoredAll)),false);
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    await page.getByRole('button',{name:'Restaurar todas as colunas',exact:true}).click();
    await page.getByRole('button',{name:'Restaurar',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.restoredAll),true);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,screenshots:directory}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
