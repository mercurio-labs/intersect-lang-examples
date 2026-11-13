import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerRhaiEditor } from '../src/rhai-editor.js';

function editor(source, metadata) {
  const caret = source.indexOf('|'); source = source.replace('|', '');
  let completions, hover;
  const monaco = { languages: {
    CompletionItemKind: { Property: 10, Variable: 5 }, CompletionItemTag: { Deprecated: 1 },
    registerCompletionItemProvider(language, provider) { completions = provider; return { dispose() {} }; },
    registerHoverProvider(language, provider) { hover = provider; return { dispose() {} }; },
  } };
  const model = {
    getValue: () => source,
    getOffsetAt: position => position.column - 1,
    getWordUntilPosition(position) {
      const word = source.slice(0, position.column - 1).match(/\w*$/)[0];
      return { word, startColumn: position.column - word.length, endColumn: position.column };
    },
    getWordAtPosition(position) {
      const start = source.slice(0, position.column - 1).match(/\w*$/)[0];
      const end = source.slice(position.column - 1).match(/^\w*/)[0];
      return { word: start + end, startColumn: position.column - start.length, endColumn: position.column + end.length };
    },
  };
  const language = registerRhaiEditor({ monaco, model }); language.update(metadata);
  const position = () => ({ lineNumber: 1, column: caret + 1 });
  return { language, suggest: () => completions.provideCompletionItems(model, position()).suggestions,
    hover: () => hover.provideHover(model, position()) };
}
const contracts = [{descriptor:{external:true,name:'copyLabel',parameters:[0],symbol:{declaration:0}},
  properties:[{parameter:0,class_name:'BookCopy',properties:[
    {name:'name',scalar:'String',optional:false,unsupported:null},
    {name:'edition',scalar:'Int32',optional:true,unsupported:null},
    {name:'library',scalar:null,optional:true,unsupported:'Reference traversal is unsupported'},
  ]}]}];

test('completion and hover follow renamed parameters and optional property metadata', () => {
  const instance = editor('fn copyLabel(renamed) { renamed.ed|ition }', contracts);
  assert.deepEqual(instance.suggest().map(p => p.label), ['name', 'edition', 'library']);
  assert.equal(instance.suggest()[1].detail, 'BookCopy.edition: Int32? (read-only)');
  const hovered = editor('fn copyLabel(renamed) { renamed.|edition }', contracts).hover();
  assert.match(hovered.contents[0].value, /absent value returns/);
  assert.match(instance.suggest()[2].documentation.value, /Reference traversal is unsupported/);
});

test('completion excludes unrelated scopes, comments, strings and shadowed parameters', () => {
  for (const source of [
    'fn helper(copy) { copy.| }',
    'fn copyLabel(copy) { other.| }',
    'fn copyLabel(copy) { "copy.|" }',
    'fn copyLabel(copy) { /* copy.| */ }',
    'fn copyLabel(copy) { /* outer /* inner */ copy.| */ }',
    'fn copyLabel(copy) { // copy.|\n }',
    'fn copyLabel(copy) { let copy = 2; copy.| }',
    'fn copyLabel(copy) { copy = 2; copy.| }',
    'fn copyLabel(copy) { "copy.|',
    'fn copyLabel(copy, extra) { copy.| }',
    'fn copyLabel(copy) { copy.name } fn helper(copy) { copy.| }',
  ]) assert.deepEqual(editor(source, contracts).suggest(), [], source);
});

test('metadata refresh and project clear remove stale properties', () => {
  const instance = editor('fn copyLabel(copy) { copy.| }', contracts);
  assert.equal(instance.suggest().length, 3);
  instance.language.update([{...contracts[0],properties:[{...contracts[0].properties[0],
    properties:[{name:'revision',scalar:'Int64',optional:false,unsupported:null}]}]}]);
  assert.deepEqual(instance.suggest().map(p => p.label), ['revision']);
  instance.language.clear(); assert.deepEqual(instance.suggest(), []);
});
