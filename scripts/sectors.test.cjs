const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
}
const helpers = {};
vm.runInNewContext(transpile('lib/sectors.ts'), { exports: helpers });

test('names normalize spaces, case and Portuguese accents for duplicates', () => {
  assert.equal(helpers.cleanSectorName('  Recursos   Humanos  '), 'Recursos Humanos');
  assert.equal(helpers.sectorNameKey(' LOGÍSTICA '), helpers.sectorNameKey('logistica'));
  assert.equal(helpers.validateSectorName(' '), 'Informe um nome entre 2 e 80 caracteres.');
  assert.ok(helpers.validateSectorName('x'.repeat(81)));
  assert.equal(helpers.validateSectorName('TI'), '');
  assert.deepEqual([...helpers.mergeSectorNames(['Geral', 'Logística'], ['LOGISTICA', 'Recursos Humanos'])], ['Geral', 'Logística', 'Recursos Humanos']);
});

function setup(existing = ['Geral']) {
  let cursor = 0;
  const slots = [];
  const calls = [];
  const created = [];
  let response = { data: { name: 'Recursos Humanos' }, error: null };
  let release;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect() {},
  };
  const supabase = { from(table) {
    assert.equal(table, 'app_sectors');
    const chain = { insert(value) { calls.push(value); return chain; }, select() { return chain; }, single() { return new Promise(resolve => { release = () => resolve(response); }); } };
    return chain;
  } };
  const exports = {};
  const element = (type, props) => ({ type, props });
  vm.runInNewContext(transpile('app/components/sector-create-button.tsx'), {
    exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === '@/lib/supabase') return { supabase };
      if (name === '@/lib/sectors') return helpers;
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return {
    calls, created,
    render() { cursor = 0; return exports.SectorCreateButton({ sectors: existing, onCreated: name => created.push(name) }); },
    respond(next) { if (next) response = next; release(); },
  };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}
function open(app, value) {
  find(app.render(), e => e.type === 'button').props.onClick();
  find(app.render(), e => e.type === 'input').props.onChange({ target: { value } });
  return find(app.render(), e => e.type === 'form').props;
}
const event = { preventDefault() {} };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('creating a sector persists its cleaned name and blocks repeated clicks', async () => {
  const app = setup();
  const form = open(app, '  Recursos   Humanos  ');
  form.onSubmit(event); form.onSubmit(event);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].name, 'Recursos Humanos');
  app.respond(); await flush();
  assert.deepEqual(app.created, ['Recursos Humanos']);
  assert.equal(find(app.render(), e => e.type === 'dialog'), null);
});

test('known duplicates are blocked without a request', () => {
  const app = setup(['Logística']);
  open(app, ' LOGISTICA ').onSubmit(event);
  assert.equal(app.calls.length, 0);
  assert.ok(find(app.render(), e => e.props?.role === 'alert'));
});

test('concurrent duplicates and connection errors preserve the entered name', async () => {
  for (const code of ['23505', 'offline']) {
    const app = setup();
    open(app, 'Recursos Humanos').onSubmit(event);
    app.respond({ data: null, error: { code } }); await flush();
    assert.equal(app.created.length, 0);
    assert.equal(find(app.render(), e => e.type === 'input').props.value, 'Recursos Humanos');
    assert.ok(find(app.render(), e => e.props?.role === 'alert'));
  }
});

test('user management adds new sectors to every user dropdown without changing assignments', () => {
  let cursor = 0;
  const slots = [];
  const exports = {};
  const element = (type, props) => ({ type, props });
  vm.runInNewContext(transpile('app/components/settings-modal.tsx'), {
    exports,
    require(name) {
      if (name === 'react') return {
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useMemo: fn => fn(), useEffect() {},
      };
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === '@/app/constants') return { SECTORS: ['Geral'], USER_ROLES: [] };
      if (name === '@/lib/permissions') return { getAppPermissions: () => ({}) };
      if (name === '@/lib/sectors') return helpers;
      if (name === '@/app/components/sector-create-button') return { SectorCreateButton: 'SectorCreateButton' };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  const profile = { id: 'user', full_name: 'Pessoa', role: 'membro', sector: 'Setor legado' };
  const render = role => { cursor = 0; return exports.SettingsModal({ embedded: true, userRole: role, profiles: [profile] }); };
  let tree = render('admin');
  find(tree, node => node.type === 'SectorCreateButton').props.onCreated('Recursos Humanos');
  tree = render('admin');
  const row = find(tree, node => typeof node.type === 'function' && node.type.name === 'ProfileAdminRow');
  assert.ok(row.props.sectors.includes('Recursos Humanos'));
  assert.ok(row.props.sectors.includes('Setor legado'));
  assert.equal(profile.sector, 'Setor legado');
  assert.equal(render('membro'), null);
});
