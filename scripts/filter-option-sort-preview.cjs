// Exercise the real filter component with disposable fixtures, without database calls.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const webpackModule = require('next/dist/compiled/webpack/webpack');
async function main() {
  const root = path.resolve(__dirname, '..'), directory = path.join(root, '.next', 'filter-sort-qa');
  fs.mkdirSync(directory, { recursive: true });
  const source = ts.createSourceFile('component.tsx', fs.readFileSync('app/components/reallocation-manager.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['QuickFilterBox', 'normalizeAutocompleteText', 'autocompleteTokens', 'autocompleteScore', 'rankAutocompleteOptions']);
  const printer = ts.createPrinter();
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join('\n');
  const input = `import {useState,useEffect,useMemo,useRef} from 'react';import {ArrowDown,ArrowUp,Check,Filter,Plus,Search,X} from 'lucide-react';import {nextFilterOptionSort,sortFilterOptions} from './sort';${functions};export {QuickFilterBox};`;
  const compile = input => ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(directory, 'filter.js'), compile(input));
  fs.writeFileSync(path.join(directory, 'sort.js'), compile(fs.readFileSync('lib/filter-option-sort.ts', 'utf8')));
  fs.writeFileSync(path.join(directory, 'entry.js'), `const React=require('react');const {createRoot}=require('react-dom/client');const {QuickFilterBox}=require('./filter');const items=[['10','ZETA','CAMETÁ'],['02','ÁGUA','ABAETETUBA'],['01','BARCARENA','ABAETETUBA']].map(columns=>({id:columns[0],columns,searchText:columns.join(' ')}));function Preview(){const [selected,onChange]=React.useState(items.slice(0,2));return React.createElement('main',{className:'p-6 max-w-3xl'},React.createElement('div',{className:'w-44'},React.createElement(QuickFilterBox,{title:'Un. Negocio Destino',columns:['Código','Apelido','Cidade'],placeholder:'Buscar lojas',options:items,selected,onChange,quickAddBehavior:'optionsPicker'})),React.createElement('p',{className:'mt-4 text-xs'},'Selecionadas: '+selected.map(x=>x.id).join(', ')))}createRoot(document.getElementById('root')).render(React.createElement(Preview));`);
  const webpack = webpackModule.webpack || webpackModule.default;
  await new Promise((resolve,reject)=>webpack({mode:'development',entry:path.join(directory,'entry.js'),output:{path:directory,filename:'bundle.js'},resolve:{modules:[path.join(root,'node_modules')]},devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||new Error(stats.toString())):resolve()));
  const cssPath=path.join(root,'app/globals.css');
  const css=await postcss([tailwind({base:root})]).process(fs.readFileSync(cssPath,'utf8'),{from:cssPath});
  fs.writeFileSync(path.join(directory,'styles.css'),css.css);
  http.createServer((request,response)=>{
    const file=request.url==='/bundle.js'?['bundle.js','text/javascript']:request.url==='/styles.css'?['styles.css','text/css']:null;
    response.setHeader('Content-Type',(file?file[1]:'text/html')+'; charset=utf-8');
    response.end(file?fs.readFileSync(path.join(directory,file[0])):'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  }).listen(3110,'127.0.0.1',()=>console.log('Filter sort preview: http://localhost:3110'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
