const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const test = require('node:test');

function compile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const helpers = {};
vm.runInNewContext(compile('lib/tool-downloads.ts'), { exports: helpers });
const component = compile('app/components/tools-manager.tsx');
const fixture = { id: 'existing', name: 'Conversor', description: 'Converte arquivos', version: '1.0', file_name: 'conversor.exe', file_path: 'admin/old/conversor.exe', file_size: 1024, is_active: true, updated_at: '2026-10-29T10:00:00Z' };

function setup(canManage = true, initial = []) {
  let slots = [], cursor = 0, effects = [];
  const db = { rows: structuredClone(initial), uploads: [], removes: [], writes: 0, downloads: [], clicks: 0, failSave: false, failLookup: false, delayUpload: null };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: value };
      return slots[i];
    },
    useCallback(fn) { const i = cursor++; return slots[i] ||= fn; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((dep, j) => dep !== slots[i][j])) effects.push(fn);
      slots[i] = deps;
    },
  };
  const supabase = {
    from() {
      let operation = 'select', values, filters = {};
      const chain = {
        select() { return chain; }, order() { return chain; },
        eq(key, value) { filters[key] = value; return chain; },
        insert(payload) { operation = 'insert'; values = payload; return chain; },
        update(payload) { operation = 'update'; values = payload; return chain; },
        single() { return run(true); }, maybeSingle() { return run(true); },
        then(a, b) { return run(false).then(a, b); },
      };
      async function run(single) {
        const matches = db.rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
        if (operation !== 'select') {
          db.writes++;
          if (db.failSave) return { data: null, error: new Error('offline') };
          if (operation === 'insert') {
            if (db.rows.some(row => row.id === values.id)) return { data: null, error: new Error('duplicate') };
            const row = { ...values, is_active: true };
            db.rows.push(row);
            return { data: { ...row }, error: null };
          }
          matches.forEach(row => Object.assign(row, values));
        } else if (db.failLookup && filters.file_path) return { data: null, error: new Error('offline') };
        return { data: single ? matches[0] ? { ...matches[0] } : null : structuredClone(matches), error: null };
      }
      return chain;
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'app-tools');
      return {
        async upload(path, file, options) { db.uploads.push({ path, file, options }); if (db.delayUpload) await db.delayUpload; return { error: null }; },
        async remove(paths) { db.removes.push(...paths); return { error: null }; },
        async createSignedUrl(path, expiry, options) { db.downloads.push({ path, expiry, options }); return { data: { signedUrl: 'https://example.test/download' }, error: null }; },
      };
    } },
  };
  const exports = {};
  const element = (type, props) => ({ type, props });
  vm.runInNewContext(component, {
    exports, crypto: { randomUUID }, console, queueMicrotask,
    window: { addEventListener() {}, removeEventListener() {} },
    document: { createElement() { return { click() { db.clicks++; }, remove() {} }; }, body: { appendChild() {} } },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === '@/lib/supabase') return { supabase };
      if (name === '@/lib/tool-downloads') return helpers;
      return new Proxy({}, { get: (_, name) => name });
    },
  });
  function render() {
    cursor = 0; effects = [];
    const tree = exports.ToolsManager({ userId: 'admin', canManage });
    effects.forEach(effect => effect());
    return tree;
  }
  return { render, db };
}
function findAll(tree, match) {
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.props?.children;
  return [ ...(match(tree) ? [tree] : []), ...(Array.isArray(children) ? children.flat(Infinity) : [children]).flatMap(child => findAll(child, match)) ];
}
function text(tree) {
  if (typeof tree === 'string') return tree;
  if (!tree || typeof tree !== 'object') return '';
  return [tree.props?.children].flat(Infinity).map(text).join('');
}
const button = (tree, name) => findAll(tree, node => node.type === 'button' && (node.props['aria-label'] === name || text(node).trim() === name))[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
function fillForm(app, name = 'Meu programa', file = new File([Buffer.alloc(2048)], 'setup.exe', { type: 'application/x-msdownload' })) {
  button(app.render(), 'Adicionar ferramenta').props.onClick();
  let tree = app.render();
  findAll(tree, node => node.type === 'input' && node.props.maxLength === 120)[0].props.onChange({ target: { value: name } });
  tree = app.render();
  findAll(tree, node => node.type === 'input' && node.props.type === 'file')[0].props.onChange({ target: { files: [file] } });
  return () => findAll(app.render(), node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
}

test('file validation and storage names', () => {
  for (const name of ['a.exe', 'a.MSI', 'a.zip']) assert.equal(helpers.validateToolFile({ name, size: 20 }), '');
  for (const file of [{ name: 'a.js', size: 1 }, { name: 'a.exe', size: 0 }, { name: 'a.zip', size: 52428801 }]) assert.ok(helpers.validateToolFile(file));
  assert.match(helpers.toolStorageName('../Aplicação nova.exe'), /^[a-zA-Z0-9._-]+$/);
});

test('non-admin UI exposes download but no management controls', async () => {
  const app = setup(false, [fixture]); app.render(); await flush();
  const tree = app.render();
  assert.equal(button(tree, 'Adicionar ferramenta'), undefined);
  assert.equal(button(tree, 'Editar Conversor'), undefined);
  await button(tree, 'Baixar').props.onClick(); await flush();
  assert.equal(app.db.clicks, 1);
  assert.equal(app.db.downloads[0].expiry, 60);
  assert.equal(app.db.downloads[0].options.download, 'conversor.exe');
});

test('security notice is shown to admins and members without claiming alerts can be ignored', () => {
  for (const canManage of [true, false]) {
    const app = setup(canManage);
    const notice = findAll(app.render(), node => node.props?.role === 'note')[0];
    assert.ok(notice);
    assert.match(text(notice), /Conforme informado pela administração/);
    assert.match(text(notice), /testados previamente/);
    assert.match(text(notice), /confirme o arquivo e a versão/);
    assert.match(text(notice), /não desative as proteções/);
  }
});

test('publish rejects invalid files and prevents duplicate submits', async () => {
  const app = setup(); app.render(); await flush();
  const invalid = fillForm(app, 'Programa', { name: 'payload.html', size: 50 });
  await invalid(); await flush();
  assert.equal(app.db.uploads.length, 0);
  let release;
  app.db.delayUpload = new Promise(resolve => { release = resolve; });
  const submit = fillForm(app);
  const pending = submit(); submit();
  assert.equal(app.db.uploads.length, 1);
  release(); await pending; await flush();
  assert.equal(app.db.writes, 1);
  assert.equal(app.db.rows.length, 1);
  assert.equal(app.db.uploads[0].options.upsert, false);
  assert.equal(app.db.uploads[0].file.type, 'application/octet-stream', 'multipart body must use the bucket MIME type');
  assert.equal(app.db.uploads[0].file.size, 2048);
  assert.ok(button(app.render(), 'Baixar'));
});

test('publication errors identify MIME, permissions, file limits and database failures', () => {
  assert.match(helpers.toolPublishError({ message: 'mime type application/zip is not supported', statusCode: '415' }, 'upload'), /tipo do arquivo/);
  assert.match(helpers.toolPublishError({ message: 'new row violates row-level security policy' }, 'upload'), /ADMIN/);
  assert.match(helpers.toolPublishError({ status: 413 }, 'upload'), /50 MB/);
  assert.match(helpers.toolPublishError({ code: '23514' }, 'database'), /validação do banco/);
  assert.match(helpers.toolPublishError(new Error('offline'), 'database'), /salvar os dados.*offline/);
});

test('failed publishing keeps form and cleans only confirmed orphan files', async () => {
  const app = setup(); app.render(); await flush(); app.db.failSave = true;
  await fillForm(app)(); await flush();
  assert.equal(app.db.removes.length, 1);
  assert.ok(findAll(app.render(), node => node.type === 'form').length);
  app.db.failLookup = true;
  const submit = findAll(app.render(), node => node.type === 'form')[0];
  await submit.props.onSubmit({ preventDefault() {} }); await flush();
  assert.equal(app.db.removes.length, 1, 'uncertain publication must never remove a possibly linked file');
});

test('archiving is reversible and search filters results', async () => {
  const app = setup(true, [fixture]); app.render(); await flush();
  await button(app.render(), 'Arquivar Conversor').props.onClick(); await flush();
  assert.equal(app.db.rows[0].is_active, false);
  assert.equal(button(app.render(), 'Baixar'), undefined);
  findAll(app.render(), node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
  await button(app.render(), 'Restaurar Conversor').props.onClick(); await flush();
  assert.equal(app.db.rows[0].is_active, true);
  findAll(app.render(), node => node.props?.['aria-label'] === 'Buscar ferramentas')[0].props.onChange({ target: { value: 'ausente' } });
  assert.equal(button(app.render(), 'Baixar'), undefined);
});
