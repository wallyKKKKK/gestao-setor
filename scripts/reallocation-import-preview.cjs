// Real import report/preview components with in-memory fixtures; never imports into a database.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const http = require('node:http');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const webpackModule = require('next/dist/compiled/webpack/webpack');
async function main() {
  const root = path.resolve(__dirname, '..'), directory = path.join(root, '.next', 'import-preview-qa');
  fs.mkdirSync(directory, { recursive: true });
  const alias = {};
  for (const file of ['app/components/reallocation-import-report.tsx', 'app/components/reallocation-import-filter-preview.tsx', 'lib/reallocation-import-filters.ts', 'lib/filter-option-sort.ts']) {
    const target = path.join(directory, path.basename(file).replace(/\.tsx?$/, '.js'));
    fs.writeFileSync(target, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText);
    alias['@/' + file.replace(/\.tsx?$/, '')] = target;
  }
  fs.writeFileSync(path.join(directory, 'entry.js'), `const React=require('react');const {createRoot}=require('react-dom/client');const {ReallocationImportReportDialog}=require('./reallocation-import-report');const report={sourceFile:'estoque-exemplo.xml',sector:'Geral',imported:12,replacedRows:5,matchedProducts:11,unmatchedProducts:1,skipped:1,totalRows:13,uniqueProducts:4,stores:[{code:'01',name:'ABAETETUBA 1'},{code:'07',name:'ABAETETUBA 2'},{code:'23',name:'BENEVIDES'}],unmatchedItems:[{line:8,storeCode:'23',storeName:'BENEVIDES',ean:'789999',product:'Produto sem vinculo',reason:'EAN sem codigo ERP'}],skippedRows:[{line:14,storeCode:'99',storeName:'Ignorada',ean:'',product:'Invalido',reason:'EAN ausente'}],movementColumnsAvailable:true,erpInventoryWarning:null,filterPreview:{manufacturers:[{name:'BIC',source:'file',linked:true},{name:'LOLLY',source:'file',linked:true},{name:'FABRICANTE SEM VINCULO',source:'file',linked:false}],missingManufacturerRows:1}};function Preview(){const [open,setOpen]=React.useState(true),[selection,setSelection]=React.useState(null);return React.createElement('main',{className:'p-6'},React.createElement('button',{onClick:()=>setOpen(true)},'Abrir resumo'),React.createElement('pre',{id:'selection-result'},selection?JSON.stringify(selection):'Filtros originais preservados'),open&&React.createElement(ReallocationImportReportDialog,{report,currentFilters:{manufacturers:['ANTIGO'],origins:['99'],destinations:['23','98'],otherCount:2},onClose:()=>setOpen(false),onApplyFilters:value=>{setSelection(value);setOpen(false)}}))}createRoot(document.getElementById('root')).render(React.createElement(Preview));`);
  const webpack = webpackModule.webpack || webpackModule.default;
  await new Promise((resolve, reject) => webpack({ mode: 'development', entry: path.join(directory, 'entry.js'), output: { path: directory, filename: 'bundle.js' }, resolve: { alias, modules: [path.join(root, 'node_modules')] }, devtool: false }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()));
  const cssPath = path.join(root, 'app/globals.css');
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });
  fs.writeFileSync(path.join(directory, 'styles.css'), css.css);
  http.createServer((request, response) => {
    const file = request.url === '/bundle.js' ? ['bundle.js', 'text/javascript'] : request.url === '/styles.css' ? ['styles.css', 'text/css'] : null;
    response.setHeader('Content-Type', (file ? file[1] : 'text/html') + '; charset=utf-8');
    response.end(file ? fs.readFileSync(path.join(directory, file[0])) : '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  }).listen(3111, '127.0.0.1', () => console.log('Import preview: http://localhost:3111'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
