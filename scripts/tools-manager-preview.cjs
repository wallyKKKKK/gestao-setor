// Isolated visual QA: no real login, uploads, or database writes.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const webpackModule = require('next/dist/compiled/webpack/webpack');
const webpack = webpackModule.webpack || webpackModule.default;

async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, '.next', 'tools-qa');
  fs.mkdirSync(directory, { recursive: true });
  const alias = {};
  for (const file of ['app/components/tools-manager.tsx', 'lib/tool-downloads.ts']) {
    const target = path.join(directory, path.basename(file).replace(/\.tsx?$/, '.js'));
    fs.writeFileSync(target, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText);
    alias['@/' + file.replace(/\.tsx?$/, '')] = target;
  }
  fs.writeFileSync(path.join(directory, 'mock.js'), `let rows=[{id:'one',name:'Conversor de planilhas',description:'Utilitário para converter arquivos de planilhas.',version:'1.2.0',file_name:'conversor-de-planilhas.zip',file_path:'fake/one.zip',file_size:5242880,is_active:true,updated_at:'2026-10-29T10:00:00Z'},{id:'two',name:'Importador ERP',description:'Preparação de arquivos para importação.',version:'2.0',file_name:'importador.exe',file_path:'fake/two.exe',file_size:12000000,is_active:true,updated_at:'2026-10-29T10:00:00Z'}]; exports.supabase={from(){let op='select',values,filters={};const chain={select(){return chain},order(){return chain},eq(k,v){filters[k]=v;return chain},update(v){op='update';values=v;return chain},insert(v){op='insert';values=v;return chain},single(){return run(true)},maybeSingle(){return run(true)},then(a,b){return run(false).then(a,b)}};async function run(single){let found=rows.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v));if(op==='insert'){found=[{...values,is_active:true}];rows.push(...found)}else if(op==='update')found.forEach(r=>Object.assign(r,values));return {data:single?found[0]:[...found],error:null}}return chain},storage:{from(){return {upload:async()=>({error:null}),remove:async()=>({error:null}),createSignedUrl:async()=>({error:{message:'Preview only'}})}}}};`);
  fs.writeFileSync(path.join(directory, 'entry.js'), `const React=require('react');const {createRoot}=require('react-dom/client');const {ToolsManager}=require('./tools-manager');function Preview(){const [admin,setAdmin]=React.useState(true);return React.createElement(React.Fragment,null,React.createElement('nav',{className:'flex items-center justify-between border-b border-slate-200 bg-white p-3'},React.createElement('strong',null,'Prévia de teste · Ferramentas'),React.createElement('button',{className:'rounded border px-3 py-1',onClick:()=>setAdmin(!admin)},admin?'Visualizar como usuário':'Visualizar como ADMIN')),React.createElement(ToolsManager,{key:String(admin),userId:'preview',canManage:admin}))}createRoot(document.getElementById('root')).render(React.createElement(Preview));`);
  await new Promise((resolve, reject) => webpack({ mode: 'development', entry: path.join(directory, 'entry.js'), output: { path: directory, filename: 'bundle.js' }, resolve: { alias: { ...alias, '@/lib/supabase': path.join(directory, 'mock.js') }, modules: [path.join(root, 'node_modules')] }, devtool: false }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()));
  const cssPath = path.join(root, 'app/globals.css');
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });
  fs.writeFileSync(path.join(directory, 'styles.css'), css.css);
  const html = '<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
  http.createServer((request, response) => {
    const file = request.url === '/bundle.js' ? ['bundle.js', 'text/javascript'] : request.url === '/styles.css' ? ['styles.css', 'text/css'] : null;
    response.setHeader('Content-Type', `${file ? file[1] : 'text/html'}; charset=utf-8`);
    response.end(file ? fs.readFileSync(path.join(directory, file[0])) : html);
  }).listen(3107, '127.0.0.1', () => console.log('Isolated tools preview: http://localhost:3107'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
