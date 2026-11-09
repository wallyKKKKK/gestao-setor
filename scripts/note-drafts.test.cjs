const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('app/components/personal-notes.tsx', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const disk = new Map();
let failWrites = false;
const localStorage = {
  getItem: key => disk.get(key) ?? null,
  setItem: (key, value) => {
    if (failWrites) throw new Error('Quota exceeded');
    disk.set(key, value);
  },
};
const note = { id: 'note-1', user_id: 'alice', title: 'Original', content: 'Texto', updated_at: '2026-10-29', task_id: null };
disk.set('wally-note-cache:alice', JSON.stringify([note]));
disk.set('wally-note-selected:alice', note.id);

function mount(userId = 'alice') {
  let index = 0;
  const slots = [];
  const react = {
    useState: initial => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }];
    },
    useRef: initial => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useCallback: callback => callback,
    useEffect: () => {},
  };
  const element = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, localStorage, console,
    require: name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === '@/lib/note-content') return { notePlainText: text => text };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return () => {
    index = 0;
    return exports.PersonalNotes({ userId, onCreateTask() {}, onViewTask() {} });
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}
const titleInput = tree => find(tree, node => node.props?.['aria-label'] === 'Título da nota');
const editor = tree => find(tree, node => typeof node.props?.onSave === 'function');

let render = mount();
let tree = render();
assert.equal(titleInput(tree).props.value, 'Original', 'restores cached note and last selection before network');
titleInput(tree).props.onChange({ target: { value: 'Meu rascunho' } });
assert.equal(JSON.parse(disk.get('wally-note-drafts:alice'))['note-1'].title, 'Meu rascunho', 'persists before render/effect');
editor(tree).props.onChange('Conteúdo ainda não sincronizado');
assert.equal(JSON.parse(disk.get('wally-note-drafts:alice'))['note-1'].title, 'Meu rascunho', 'rapid edits preserve the latest other field');

render = mount();
tree = render();
assert.equal(titleInput(tree).props.value, 'Meu rascunho', 'restores unsaved title after reopening');
assert.equal(editor(tree).props.value, 'Conteúdo ainda não sincronizado', 'restores unsaved content after reopening');
assert.equal(titleInput(mount('bob')()), null, 'does not expose another user notes');

failWrites = true;
titleInput(tree).props.onChange({ target: { value: 'Em memória' } });
tree = render();
assert.equal(titleInput(tree).props.value, 'Em memória', 'quota error preserves the current text');
assert.ok(find(tree, node => node.props?.role === 'alert'), 'reports failed local persistence');
failWrites = false;
titleInput(tree).props.onChange({ target: { value: 'Recuperado' } });
assert.equal(JSON.parse(disk.get('wally-note-drafts:alice'))['note-1'].title, 'Recuperado');
console.log('Note drafts: restore, immediate persistence, rapid edits, isolation and quota handling passed.');
