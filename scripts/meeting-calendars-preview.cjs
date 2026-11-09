// Isolated visual QA. All calendar data and Google responses are local fixtures.
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
  const directory = path.join(root, '.next', 'meeting-calendars-qa');
  fs.mkdirSync(directory, { recursive: true });
  const alias = {};
  for (const file of ['app/components/meeting-calendar-view.tsx', 'app/components/meeting-calendar-sidebar.tsx', 'lib/meeting-calendars.ts', 'lib/google-calendar-client.ts', 'lib/calendar-month-cache.ts', 'lib/use-google-calendar-events.ts', 'lib/use-meeting-calendars.ts', 'lib/permissions.ts']) {
    const target = path.join(directory, path.basename(file).replace(/\.tsx?$/, '.js'));
    fs.writeFileSync(target, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText);
    alias['@/' + file.replace(/\.tsx?$/, '')] = target;
  }
  fs.writeFileSync(path.join(directory, 'mock.js'), `
    const month=new Date().toISOString().slice(0,7); const day=month+'-04';
    const calendars=[{id:'personal',name:'Pessoal',color:'#7c3aed',visibility:'personal',sector:'Geral',owner_id:'actor'},{id:'commercial',name:'Comercial',color:'#059669',visibility:'sector',sector:'Geral',owner_id:'colleague'}];
    const events=[{id:'vacation',calendar_id:'personal',title:'Férias',start_date:day,end_date:month+'-15',time:'09:00',location:'',notes:'Evento pessoal de teste',assigned_to:'actor',created_by:'actor',completed:false,created_at:day+'T00:00:00Z'},{id:'work',calendar_id:'commercial',title:'Reunião comercial',start_date:month+'-10',end_date:month+'-10',time:'14:00',location:'Sala 1',notes:'Pauta de teste',assigned_to:'actor',created_by:'actor',completed:false,created_at:day+'T00:00:00Z'}];
    exports.getAuthHeaders=async()=>({});
    window.fetch=async input=>{const url=new URL(String(input),location.origin);if(url.pathname.endsWith('/status'))return Response.json({configured:true,connected:true,calendarsAuthorized:true});if(url.pathname.endsWith('/calendars'))return Response.json({calendars:[{id:'primary',summary:'Minha conta Google',primary:true,accessRole:'owner',backgroundColor:'#0284c7'},{id:'holidays',summary:'Feriados no Brasil',accessRole:'reader',backgroundColor:'#ea580c'}]});if(url.pathname.endsWith('/events')){const requestedMonth=url.searchParams.get('timeMin').slice(0,7);return Response.json({events:[{id:requestedMonth+'-same-id',calendarId:url.searchParams.get('calendarId'),summary:url.searchParams.get('calendarId')==='holidays'?'Feriado de teste':'Compromisso Google',start:{date:requestedMonth+'-12'},end:{date:requestedMonth+'-13'},htmlLink:'https://calendar.google.com/'}]})}throw Error('Unexpected preview request')};
    const fixtureFetch=window.fetch; let failures=0;
    window.fetch=async input=>{
      const url=new URL(String(input),location.origin), scenario=new URL(location.href).searchParams.get('scenario');
      if(url.pathname.endsWith('/calendars') && scenario==='scope')return Response.json({error:'Autorize novamente para listar as agendas.',permissionRequired:true,reconnectRequired:true},{status:409});
      if(url.pathname.endsWith('/events')){
        console.info('QA Google read',url.searchParams.get('calendarId'),url.searchParams.get('timeMin'));
        if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,450));
        if(scenario==='expired')return Response.json({error:'Conexão expirada.',reconnectRequired:true},{status:409});
        if(scenario==='network' || (scenario==='recover' && failures++<2))return Response.json({error:'Falha temporária.'},{status:503});
      }
      return fixtureFetch(input);
    };
    exports.supabase={from(table){let op='select',values,filters={},start=0,end=999;const chain={select(){return chain},order(){return chain},lte(){return chain},gte(){return chain},range(a,b){start=a;end=b;return chain},eq(k,v){filters[k]=v;return chain},insert(v){op='insert';values=v;return chain},update(v){op='update';values=v;return chain},delete(){op='delete';return chain},single(){return run(true)},then(a,b){return run(false).then(a,b)}};async function run(single){const rows=table==='meeting_calendars'?calendars:events;let found=rows.filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v));if(op==='insert'){found=[{...values,id:crypto.randomUUID(),created_at:new Date().toISOString(),completed:false}];rows.push(...found)}else if(op==='update')found.forEach(row=>Object.assign(row,values));else if(op==='delete'){for(const row of found)rows.splice(rows.indexOf(row),1)}return {data:single?found[0]:found.slice(start,end+1).map(row=>({...row})),error:null}}return chain}};
  `);
  fs.writeFileSync(path.join(directory, 'entry.js'), `const React=require('react');const {createRoot}=require('react-dom/client');const {MeetingCalendarView}=require('./meeting-calendar-view');require('./mock');function Preview(){const [dark,setDark]=React.useState(false);return React.createElement(React.Fragment,null,React.createElement('header',{className:'flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4'},React.createElement('strong',null,'Agenda · prévia de teste'),React.createElement('button',{onClick:()=>{const next=!dark;setDark(next);document.documentElement.dataset.theme=next?'dark':'light'}},dark?'Modo claro':'Modo escuro')),React.createElement(MeetingCalendarView,{tasks:[],profiles:[{id:'actor',full_name:'Usuário de teste',sector:'Geral',role:'membro'},{id:'colleague',full_name:'Colega de teste',sector:'Geral',role:'membro'}],userSector:'Geral',defaultAssignedTo:'actor',canDeleteMeetings:false,onDeleteTask(){},onToggleMeeting(){},onCreateMeeting:async()=>{},onUpdateMeeting:async()=>{}}))}createRoot(document.getElementById('root')).render(React.createElement(Preview));`);
  await new Promise((resolve, reject) => webpack({ mode: 'development', entry: path.join(directory, 'entry.js'), output: { path: directory, filename: 'bundle.js' }, resolve: { alias: { ...alias, '@/lib/supabase': path.join(directory, 'mock.js'), '@/lib/auth-headers': path.join(directory, 'mock.js') }, modules: [path.join(root, 'node_modules')] }, devtool: false }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()));
  const cssPath = path.join(root, 'app/globals.css');
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });
  fs.writeFileSync(path.join(directory, 'styles.css'), css.css);
  const html = '<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
  http.createServer((request, response) => {
    const file = request.url === '/bundle.js' ? ['bundle.js', 'text/javascript'] : request.url === '/styles.css' ? ['styles.css', 'text/css'] : null;
    response.setHeader('Content-Type', (file ? file[1] : 'text/html') + '; charset=utf-8');
    response.end(file ? fs.readFileSync(path.join(directory, file[0])) : html);
  }).listen(3109, '127.0.0.1', () => console.log('Meeting calendars preview: http://localhost:3109'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
