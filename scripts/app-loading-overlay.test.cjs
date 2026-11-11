const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

test('the shared overlay opens a modal, rejects cancellation and releases it on cleanup', () => {
  let active = false;
  let cleanup;
  let selector;
  let nextId = 0;
  const dialog = {
    showModal: () => { active = true; },
    close: () => { active = false; },
  };
  const document = {
    querySelector: query => {
      selector = query;
      return active ? dialog : null;
    },
  };
  const react = {
    useLayoutEffect: effect => { cleanup = effect(); },
    useRef: () => ({ current: dialog }),
    useId: () => `id-${++nextId}`,
  };
  const code = ts.transpileModule(fs.readFileSync('app/components/app-loading-overlay.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, document, require: name => name === 'react' ? react : require(name) });
  assert.equal(exports.isAppLoadingOverlayOpen(), false);

  const view = exports.AppLoadingOverlay({ title: 'Importando estoque', description: 'Lendo arquivo' });
  assert.equal(view.type, 'dialog');
  assert.equal(exports.isAppLoadingOverlayOpen(), true);
  assert.equal(selector, '[data-app-loading-overlay]:modal');
  let prevented = false;
  view.props.onCancel({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(exports.isAppLoadingOverlayOpen(), true);

  cleanup();
  assert.equal(exports.isAppLoadingOverlayOpen(), false);
});
