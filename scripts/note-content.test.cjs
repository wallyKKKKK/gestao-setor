const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '../lib/note-content.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });
const { decodeNote, encodeNote, notePlainText, noteTaskContent } = exportsObject;

test('old plain text stays literal, including line breaks and HTML-like text', () => {
  const original = 'Primeira linha\n<script>alert(1)</script>\n';
  const doc = decodeNote(original);
  assert.equal(doc.content.length, 3);
  assert.equal(doc.content[1].content[0].text, '<script>alert(1)</script>');
  assert.equal(notePlainText(original), original);
});
test('formatted documents survive serialization and search only sees readable text', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Comprar amanhã', marks: [{ type: 'bold' }] }] }] };
  const saved = encodeNote(doc);
  assert.equal(JSON.stringify(decodeNote(saved)), JSON.stringify(doc));
  assert.equal(notePlainText(saved), 'Comprar amanhã');
  assert.equal(notePlainText(saved).includes('marks'), false);
});
test('malformed serialized notes are not silently erased', () => {
  const original = 'wally-rich-note:v1\n{broken';
  assert.equal(decodeNote(original).content[0].content[0].text, 'wally-rich-note:v1');
  assert.equal(notePlainText(original), original);
});

test('typed lists become pending subtasks while prose stays in the description', () => {
  const result = noteTaskContent('Preparar reunião:\n- Conferir preços\n2. Ligar ao fornecedor\n3 - Revisar pedido\n• Enviar resumo\n- [x] Validar prazo\n[ ] Marcar retorno\nPrazo: sexta-feira');
  assert.equal(result.description, 'Preparar reunião:\nPrazo: sexta-feira');
  assert.deepEqual(Array.from(result.subtasks, sub => sub.title), ['Conferir preços', 'Ligar ao fornecedor', 'Revisar pedido', 'Enviar resumo', 'Validar prazo', 'Marcar retorno']);
  assert.ok(result.subtasks.every(sub => sub.done === false));
});

test('rich lists, nested items and checkboxes do not duplicate parent text', () => {
  const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const doc = { type: 'doc', content: [paragraph('Planejamento'), {
    type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Preparar pedido'), { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph('Conferir quantidades')] }] }] }],
  }, { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('Enviar ao fornecedor')] }] }, paragraph('Observações gerais')] };
  const result = noteTaskContent(encodeNote(doc));
  assert.equal(result.description, 'Planejamento\nObservações gerais');
  assert.deepEqual(Array.from(result.subtasks, sub => sub.title), ['Preparar pedido', 'Conferir quantidades', 'Enviar ao fornecedor']);
  assert.ok(result.subtasks.every(sub => !sub.done));
});

test('ordinary text, dates and decimals are not mistaken for lists', () => {
  const content = 'Preço: 12.50\n28/10/2026\n2026-10-28\n-12 unidades\nConferir estoque\nEnviar pedido';
  const result = noteTaskContent(content);
  assert.equal(result.description, content);
  assert.equal(result.subtasks.length, 0);
  assert.equal(noteTaskContent('').subtasks.length, 0);
});

test('quoted or code list-like content is kept as description', () => {
  const result = noteTaskContent(encodeNote({ type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: '- exemplo de código' }] }] }));
  assert.equal(result.description, '- exemplo de código');
  assert.equal(result.subtasks.length, 0);
});

test('bare sequential numbers with blank paragraphs match the user example', () => {
  const content = 'testando as coisas\n\n1 teste 1\n\n2 teste 2';
  for (const value of [content, encodeNote(decodeNote(content))]) {
    const result = noteTaskContent(value);
    assert.equal(result.description, 'testando as coisas');
    assert.deepEqual(Array.from(result.subtasks, sub => sub.title), ['teste 1', 'teste 2']);
  }
});

test('standalone numbers remain prose and mixed lists keep their original order', () => {
  assert.equal(noteTaskContent('Comprar\n2 caixas de papel').subtasks.length, 0);
  assert.equal(noteTaskContent('1 observação\nTexto intermediário\n2 outra observação').subtasks.length, 0);
  const result = noteTaskContent('- Primeiro\n1 Segundo\n2 Terceiro\n- Quarto');
  assert.deepEqual(Array.from(result.subtasks, sub => sub.title), ['Primeiro', 'Segundo', 'Terceiro', 'Quarto']);
});
