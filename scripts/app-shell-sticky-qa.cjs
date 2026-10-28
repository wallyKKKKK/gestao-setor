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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-sticky-qa-'));
  const alias = {};
  for (const file of ['app/components/app-shell-nav.tsx', 'app/components/multi-checkbox-filter.tsx', 'app/components/task-drawer.tsx', 'app/constants.ts', 'lib/margin-flow-task.ts', 'lib/permissions.ts', 'lib/section-theme.ts', 'lib/task-priority.ts', 'lib/task-recurrence.ts']) {
    const output = path.join(directory, path.basename(file).replace(/\.tsx?$/, '.js'));
    fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText);
    alias['@/' + file.replace(/\.tsx?$/, '')] = output;
  }
  fs.writeFileSync(path.join(directory, 'api.js'), 'exports.fetchTradeTaskNotes=async()=>[];');
  alias['@/lib/api'] = path.join(directory, 'api.js');
  fs.writeFileSync(path.join(directory, 'entry.js'), `const React=require('react');const {createRoot}=require('react-dom/client');const {AppShellNav}=require('./app-shell-nav');const noop=()=>{};function App(){const [tools,setTools]=React.useState(true);window.hideTools=()=>setTools(false);return React.createElement('div',{className:'app-responsive-root min-h-screen overflow-x-clip w-full'},React.createElement('div',{className:'md:pl-20'},React.createElement(AppShellNav,{section:'TAREFAS',sectionTitle:'Tarefas',sectionSubtitle:'HOJE',showTaskTools:tools,taskAction:React.createElement('button',{},'Lancar nova tarefa'),userId:'test',userRole:'admin',profiles:[],activeTab:'HOJE',filterUsers:[],userSector:'Geral',searchTerm:'',theme:'light',onActiveTabChange:noop,onFilterUsersChange:noop,onSearchTermChange:noop,onThemeToggle:noop,onOpenGlobalSearch:noop,onOpenProfile:noop,onOpenSettings:noop,onRefresh:noop,isRefreshing:false,notifications:[],unreadNotificationIds:[],browserNotificationPermission:'unsupported',notificationPreferences:{},onNotificationSelect:noop,onMarkAllNotificationsRead:noop,onRequestBrowserNotifications:noop,onNotificationPreferenceChange:noop}),React.createElement('div',{style:{height:3000}},'Conteudo de teste')));}createRoot(document.getElementById('root')).render(React.createElement(App));`);
  // Exercise the real navigation component with controlled tab and search state.
  const entryPath = path.join(directory, 'entry.js');
  const entry = fs.readFileSync(entryPath, 'utf8')
    .replace('window.hideTools=', "const [tab,setTab]=React.useState('HOJE');const [term,setTerm]=React.useState('');window.changeTab=setTab;window.hideTools=")
    .replace("activeTab:'HOJE'", 'activeTab:tab')
    .replace("searchTerm:''", 'searchTerm:term')
    .replace('onActiveTabChange:noop', 'onActiveTabChange:setTab')
    .replace('onSearchTermChange:noop', 'onSearchTermChange:setTerm')
    .replace('const noop=', "const {TaskDrawer}=require('./task-drawer');const noop=")
    .replace('function App(){', "function App(){const [task,setTask]=React.useState(null);window.openTask=()=>setTask({id:'test',title:'Detalhes da tarefa de teste',notes:'',category:'Geral',assigned_to:'test',sector:'Geral',priority:'normal',isDoneToday:false,repeat_days:'qui',repeat_interval:1});")
    .replace("React.createElement('div',{style:{height:3000}},'Conteudo de teste')", "React.createElement('div',{style:{height:3000}},'Conteudo de teste'),React.createElement(TaskDrawer,{task,profiles:[],user:{id:'test'},userRole:'admin',onClose:()=>setTask(null),onEdit:noop,onTradeNotesChanged:noop})");
  fs.writeFileSync(entryPath, entry);
  await new Promise((resolve,reject)=>webpack({mode:'development',entry:path.join(directory,'entry.js'),output:{path:directory,filename:'bundle.js'},resolve:{alias,modules:[path.join(root,'node_modules')]},devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||new Error(stats.toString())):resolve()));
  const css=await postcss([tailwind({base:root})]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')});
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addStyleTag({content:css.css});await page.addScriptTag({path:path.join(directory,'bundle.js')});
    const search=page.getByPlaceholder('DIGITE PARA BUSCAR TAREFAS...');
    await search.waitFor();
    for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
      await page.setViewportSize({width,height});
      await page.waitForTimeout(350);
      await page.evaluate(()=>window.scrollTo(0,0));
      const before=await search.boundingBox();
      await page.evaluate(()=>window.scrollTo(0,800));
      await page.waitForFunction(()=>window.scrollY>=800);
      const after=await search.boundingBox();
      const nav=await page.locator('nav').boundingBox();
      assert.equal(nav.y,0);
      assert.equal(Math.round(after.y),Math.round(before.y));
      assert.ok(after.y+after.height<=height);
      await page.screenshot({path:path.join(directory,name+'.png')});
      await page.getByRole('button', {name:'Todas', exact:true}).click();
      await page.waitForFunction(()=>window.scrollY===0);
      await page.evaluate(()=>window.scrollTo(0,800));
      await page.waitForFunction(()=>window.scrollY>=800);
      await search.fill('teste');
      assert.ok(await page.evaluate(()=>window.scrollY>=800));
      await page.getByRole('button', {name:'Hoje', exact:true}).click();
      await page.waitForFunction(()=>window.scrollY===0);
      assert.equal(await search.inputValue(), 'teste');
      await page.evaluate(()=>window.scrollTo(0,800));
      await page.waitForFunction(()=>window.scrollY>=800);
      await page.evaluate(()=>window.changeTab('SEMANA'));
      await page.waitForFunction(()=>window.scrollY===0);
      await page.evaluate(()=>window.openTask());
      await page.getByRole('dialog', { name:'Detalhes da tarefa de teste' }).waitFor();
      await page.waitForTimeout(550);
      assert.ok(await page.evaluate(()=>[32,110,200].every(y=>document.elementFromPoint(innerWidth-32,y)?.closest('[role="dialog"]'))));
      assert.equal(await page.evaluate(()=>Boolean(document.elementFromPoint(10,32)?.closest('nav'))),false);
      await page.screenshot({path:path.join(directory,name+'-drawer.png')});
      await page.getByRole('button',{name:'Fechar detalhes da tarefa',exact:true}).click();
      await page.getByRole('dialog').waitFor({state:'detached'});
    }
    await page.evaluate(()=>window.hideTools());
    await search.waitFor({state:'detached'});
    assert.equal((await page.locator('nav').boundingBox()).y,0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,screenshots:directory}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
