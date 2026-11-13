// Real WASM and native transport controls. Semantics live exclusively in Rust.
import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { migratedFixtureRequest } from './migration-fixtures.js';
const root = fileURLToPath(new URL('../.runtime/intersect-text/', import.meta.url));
const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
const nativeExecutable = process.env.INTERSECT_TEST_NATIVE_ORACLE || resolve(target, `debug/examples/rcore_behavior_parse${process.platform === 'win32' ? '.exe' : ''}`);
const wasmPath = process.env.INTERSECT_TEST_WASM || resolve(target, 'wasm32-unknown-unknown/debug/intersect_web.wasm');
const builds = [];
if (!process.env.INTERSECT_TEST_NATIVE_ORACLE) builds.push(['build', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked']);
if (!process.env.INTERSECT_TEST_WASM) builds.push(['build', '-p', 'intersect-web', '--lib', '--target', 'wasm32-unknown-unknown', '--locked']);
for (const args of builds) {
  const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit' });
  assert.equal(result.status, 0, result.error?.message);
}
const binary = readFileSync(wasmPath);
const { instance: { exports: wasm } } = await WebAssembly.instantiate(binary, {});
function invoke(request) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const pointer = wasm.input_buffer(bytes.length); assert.ok(pointer);
  new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
  const size = wasm.execute();
  return JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.output_buffer(), size)));
}
function parity(request) {
  const prepared = migratedFixtureRequest(request, parity);
  if (prepared.result) return prepared.result;
  request = prepared.request;
  const result = spawnSync(nativeExecutable, [], { input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 10_000_000 });
  assert.equal(result.status, 0, result.stderr);
  const browser = invoke(request);
  assert.deepEqual(browser, JSON.parse(result.stdout));
  return browser;
}
const fixture = name => readFileSync(resolve(root, 'fixtures/xtext/boolean-keywords', name), 'utf8');
const input = { method:'fixture/compile', xtext_profile:'intersect.xtext.native.v1', ecore: fixture('model.ecore'), xtext: fixture('model.xtext'), rcore_behavior: fixture('model-behavior.rcore') };
test('Boolean keywords preserve defaults, assignment markers and exact source through native/WASM', () => {
  const compiled = parity(input); assert.equal(compiled.ok, true);
  assert.equal(compiled.package.sources.xtext, input.xtext);
  const result = parity({ method: 'evaluate', package: compiled.package, sources: [{ uri: 'example.kerml', text: fixture('example.kerml') }] });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.model.elements.length, 4);
  assert.deepEqual(result.model.elements.slice(1).map(e => e.values.isAbstract), [true, false, false]);
  assert.deepEqual(result.model.elements.slice(1).map(e => e.values.isStandard), [true, true, true]);
  for (const text of ['package P { abstract type ; }', 'package P { type abstract; }']) {
    const rejected = parity({ method: 'evaluate', package: compiled.package, sources: [{ uri: 'bad', text }] });
    assert.ok(rejected.diagnostics.length); assert.deepEqual(rejected.model.elements, []);
  }
});
test('Boolean type, RHS and prediction rejections agree across native/WASM', () => {
  for (const xtext of [input.xtext.replace("?='abstract'", '?=ID'), input.xtext.replace('isAbstract?=', 'name?='), input.xtext.replace('isAbstract?=', 'isAbstract? ='), input.xtext.replace("'type' name", "'abstract' name")]) {
    const result = parity({ ...input, xtext }); assert.equal(result.ok, false); assert.ok(result.diagnostics.length);
  }
});
test('unchanged Library remains executable through the same native/WASM implementation', () => {
  const read = name => readFileSync(resolve(root, 'fixtures/library', name), 'utf8');
  const compiled = parity({ method:'fixture/compile', ecore: read('library.ecore'), xtext: read('library.xtext'), rcore_behavior: read('library-behavior.rcore') });
  assert.equal(compiled.ok, true);
  const result = parity({ method: 'evaluate', package: compiled.package, sources: ['catalog', 'loans'].map(name => ({ uri: `${name}.library`, text: read(`${name}.library`) })) });
  assert.deepEqual(result.diagnostics, []); assert.ok(result.model.elements.length > 4);
});

// The dispatch fixture is independently authored and retains a separate identity.
test('pure parser dispatch returns concrete subtype identities through native/WASM', () => {
  const read = name => readFileSync(resolve(root, 'fixtures/xtext/parser-dispatch', name), 'utf8');
  const request = { method:'fixture/compile', xtext_profile:'intersect.xtext.native.v1', ecore: read('model.ecore'), xtext: read('model.xtext'), rcore_behavior: read('model-behavior.rcore') };
  const compiled = parity(request); assert.equal(compiled.ok, true);
  assert.equal(compiled.package.sources.xtext, request.xtext);
  const text = read('example.kerml');
  const result = parity({ method: 'evaluate', package: compiled.package, sources: [{ uri: 'dispatch.kerml', text }] });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.model.elements.map(e => [e.class, e.id]), [
    ['Model', 'dispatch.kerml#0'], ['Type', 'dispatch.kerml#1'], ['Feature', 'dispatch.kerml#2'],
  ]);
  assert.deepEqual(result.model.elements[0].values.members, ['dispatch.kerml#1', 'dispatch.kerml#2']);
  assert.equal(result.model.elements[1].values.isAbstract, true);
  assert.equal(text.slice(result.model.elements[1].start, result.model.elements[1].end), 'abstract type Vehicle;');
  const rejected = parity({ method: 'evaluate', package: compiled.package, sources: [{ uri: 'bad', text: 'package P { type T; feature ; }' }] });
  assert.ok(rejected.diagnostics.length); assert.deepEqual(rejected.model.elements, []);
  for (const body of ['ID', 'Type?', 'Type | Type', 'Member', "'prefix' Type", 'Model']) {
    const invalid = parity({ ...request, xtext: request.xtext.replace('Type | Feature', body) });
    assert.equal(invalid.ok, false, body); assert.ok(invalid.diagnostics.length, body);
  }
});


test('typed fragments share caller identity and reference ownership through native/WASM', () => {
  const read = name => readFileSync(resolve(root, 'fixtures/xtext/typed-fragments', name), 'utf8');
  const request = { method:'fixture/compile',xtext_profile:'intersect.xtext.native.v1',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore') };
  const compiled = parity(request); assert.equal(compiled.ok, true);
  assert.equal(compiled.package.grammar.entry, 'Model');
  assert.equal(compiled.package.grammar.rules.Identification.fragment, true);
  const result = parity({ method:'evaluate',package:compiled.package,sources:[{uri:'fragments.kerml',text:read('example.kerml')}] });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.model.elements.map(e=>[e.class,e.id]), [
    ['Model','fragments.kerml#0'],['Type','fragments.kerml#1'],['Feature','fragments.kerml#2'],
  ]);
  assert.equal(result.model.elements[2].values.target, 'fragments.kerml#1');
  assert.equal(result.references[0].target, 'fragments.kerml#1');
  const conflict = request.xtext.replace('name=ID;', "'named' name=ID?;").replace("'type' Identification ';'", "'type' Identification name=ID ';'");
  const rejected = parity({...request,xtext:conflict});
  assert.equal(rejected.ok,false);
  assert.ok(rejected.diagnostics.some(d=>d.message.includes('Fragment caller follow conflict')));
  for (const xtext of [request.xtext.replace('name=ID;', 'Identification;'), request.xtext.replace("'type' Identification", "'type' name=Identification")]) {
    const invalid = parity({...request,xtext}); assert.equal(invalid.ok,false);
  }
  const bad = parity({method:'evaluate',package:compiled.package,sources:[{uri:'bad',text:'package P { feature x to ; }'}]});
  assert.ok(bad.diagnostics.length); assert.deepEqual(bad.model.elements,[]);
});

function rejectedBoundary(request, message) {
  const prepared=migratedFixtureRequest(request,parity);
  assert.equal(prepared.result,undefined); request=prepared.request;
  const native = spawnSync(nativeExecutable, [], { input:JSON.stringify(request),encoding:'utf8' });
  assert.notEqual(native.status,0);
  assert.match(native.stderr,message);
  assert.match(invoke(request).error,message);
}
test('explicit compiler profile survives archives and adapter replay; downgrade and unknown profiles reject', () => {
  const legacy = {...input}; delete legacy.xtext_profile;
  assert.equal(parity(legacy).ok,false);
  for (const xtext_profile of ['unknown',null,42]) rejectedBoundary({...input,xtext_profile},/Invalid Xtext profile/);
  const compiled=parity(input);
  assert.equal(compiled.package.grammar.profile,'intersect.xtext.native.v1');
  const sources=[{uri:'example.kerml',text:fixture('example.kerml')}];
  const downgraded=structuredClone(compiled.package); delete downgraded.grammar.profile;
  rejectedBoundary({method:'evaluate',package:downgraded,sources},/profile/);
  const forged=structuredClone(compiled.package); forged.grammar.entry='forged';
  assert.deepEqual(parity({method:'evaluate',package:forged,sources}),parity({method:'evaluate',package:compiled.package,sources}));
  const exported=parity({...input,method:'fixture/export',metadata:{package_id:'xtext.native',release:'1',display_name:'Native Xtext',description:''}});
  assert.equal(exported.manifest.runtime.profile,'intersect.xtext.native.v1');
  const files={...exported.files,'manifest.json':JSON.stringify(exported.manifest)};
  const imported=parity({method:'package/import',files});
  assert.deepEqual(imported.package,compiled.package);
  assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),parity({method:'evaluate',package:compiled.package,sources}));
  const damaged=structuredClone(exported.manifest);damaged.runtime.profile='intersect.workbench.v1';
  rejectedBoundary({method:'package/import',files:{...files,'manifest.json':JSON.stringify(damaged)}},/native Xtext profile/);
});


test('punctuation keywords preserve maximal tokens, spans and fixed browser budgets across native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/punctuation-keywords',name),'utf8');
  const request={method:'fixture/compile',xtext_profile:'intersect.xtext.native.v1',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore')};
  const compiled=parity(request);assert.equal(compiled.ok,true);
  assert.equal(compiled.package.sources.xtext,request.xtext);
  for(const keyword of ['::','**','*',':>',':>>']) assert.ok(compiled.keywords.includes(keyword));
  const text=read('example.kerml');
  const result=parity({method:'evaluate',package:compiled.package,sources:[{uri:'punctuation.kerml',text}]});
  assert.deepEqual(result.diagnostics,[]);
  assert.deepEqual(result.model.elements.map(e=>[e.class,e.values.name]),[['Model','Demo'],['Import','Parts'],['Import','Units'],['Specialization','Wheel'],['Specialization','front']]);
  assert.equal(result.model.elements[1].values.recursive,true);assert.equal(result.model.elements[2].values.all,true);
  assert.equal(result.model.elements[3].values.targetName,'Parts');assert.equal(result.model.elements[4].values.redefinition,true);
  assert.equal(text.slice(result.model.elements[4].start,result.model.elements[4].end),'redefine front :>> Wheel;');
  for(const body of ['import Parts: :**;','import Parts:/*gap*/:**;','import Parts:: * *;','specialize Wheel :>> Parts;','redefine Wheel :> > Parts;']) {
    const invalid=parity({method:'evaluate',package:compiled.package,sources:[{uri:'bad',text:`package Bad { ${body} }`}]});
    assert.ok(invalid.diagnostics.length,body);assert.deepEqual(invalid.model.elements,[],body);
  }
  for(const count of [50000,50001]) {
    const bounded=parity({method:'evaluate',package:compiled.package,sources:[{uri:'tokens',text:':: '.repeat(count)}]});
    assert.deepEqual(bounded.model.elements,[]);assert.ok(bounded.diagnostics.length);
    assert.equal(bounded.diagnostics.some(d=>d.message.includes('Token budget')),count>50000);
    if(count>50000) assert.equal(bounded.diagnostics[0].start,150000);
  }
});

test('EString datatype rules preserve qualified references, nested raw values and package replay across native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/qualified-names',name),'utf8');
  const request={method:'fixture/compile',xtext_profile:'intersect.xtext.native.v1',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore')};
  const compiled=parity(request);assert.equal(compiled.ok,true);
  const sources=[{uri:'example.kerml',text:read('example.kerml')},{uri:'more.kerml',text:read('more.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,6);
  assert.deepEqual(result.model.elements.map(e=>e.values.name),['Demo','Parts::Wheel','front','distance','Library','Units::Length']);
  assert.equal(result.model.elements[2].values.target,'example.kerml#1');
  assert.equal(result.model.elements[3].values.target,'more.kerml#1');
  assert.deepEqual(result.references.map(r=>sources[0].text.slice(r.start,r.end)),['Parts::Wheel','Units::Length']);
  for(const body of ['type P::;','type P: :A;','type package;']) {
    const rejected=parity({method:'evaluate',package:compiled.package,sources:[{uri:'bad',text:`package Bad { ${body} }`}]});
    assert.ok(rejected.diagnostics.length);assert.deepEqual(rejected.model.elements,[]);
  }
  const nested=parity({...request,xtext:request.xtext.replace("ID ('::' ID)*","Inner '.'")+"\nInner returns ecore::EString: ID ('::' ID)*;"});
  assert.equal(nested.ok,true);
  const nestedResult=parity({method:'evaluate',package:nested.package,sources:[{uri:'nested',text:'package Demo { type A/*gap*/::B.; }'}]});
  assert.deepEqual(nestedResult.diagnostics,[]);assert.equal(nestedResult.model.elements[1].values.name,'A ::B .');
  const unicode=parity({...request,xtext:request.xtext.replace("ID ('::' ID)*","STRING '::' ID")});
  assert.equal(unicode.ok,true);
  const unicodeResult=parity({method:'evaluate',package:unicode.package,sources:[{uri:'unicode',text:'package Demo { type "😀"::A; }'}]});
  assert.deepEqual(unicodeResult.diagnostics,[]);assert.equal(unicodeResult.model.elements[1].values.name,'"😀"::A');
  assert.equal(parity({...request,xtext_profile:'intersect.workbench.v1'}).ok,false);
  for(const body of ['ID?','QualifiedName','ID QualifiedName?','Type','name=ID']) {
    assert.equal(parity({...request,xtext:request.xtext.replace("ID ('::' ID)*",body)}).ok,false);
  }
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.datatypes',release:'1',display_name:'Datatypes',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);
  assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);

});

test('text constructors preserve pending references and strict final rejection across native/WASM', () => {
  const read = name => readFileSync(resolve(root, 'fixtures/xtext/simple-actions', name), 'utf8');
  const xtext = read('model.xtext').replace('{k::Model} ', '')
    .replace('returns k::Element: {k::Type}', 'returns k::Type:')
    .replace('returns k::Element: {k::Feature}', 'returns k::Feature:');
  const request = { method:'fixture/compile', xtext_profile:'intersect.xtext.native.v1', ecore:read('model.ecore'), xtext, rcore_behavior:read('model-behavior.rcore') };
  const compiled = parity(request); assert.equal(compiled.ok, true);
  assert.equal(compiled.package.sources.xtext, xtext);
  const text = 'package Demo { type Wheel origin "authored"; feature wheel : Wheel; type Spare; }';
  const sources = [{uri:'constructors.kerml', text}];
  const result = parity({method:'evaluate', package:compiled.package, sources});
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.model.elements.map(e=>[e.id,e.class]), [
    ['constructors.kerml#0','Model'], ['constructors.kerml#1','Type'],
    ['constructors.kerml#2','Feature'], ['constructors.kerml#3','Type'],
  ]);
  assert.equal(result.model.elements[1].values.origin, 'authored');
  assert.equal(result.model.elements[3].values.origin, 'constructor');
  assert.equal(result.model.elements[2].values.target, 'constructors.kerml#1');
  for (const index of [1,3]) assert.equal(result.model.elements[index].initialization.object,result.model.elements[index].id);
  assert.equal(result.references.length,1);
  assert.equal(text.slice(result.references[0].start,result.references[0].end),'Wheel');
  for (const invalid of ['package Demo { feature wheel : Missing; type Spare; }', 'package Demo { type Wheel; feature wheel : Wheel; type Spare origin ; }']) {
    const rejected = parity({method:'evaluate',package:compiled.package,sources:[{uri:'bad',text:invalid}]});
    assert.ok(rejected.diagnostics.length);
    assert.ok(rejected.diagnostics.every(d=>!d.message.includes('Reference must be an identity')));
    if (invalid.includes('Missing')) assert.ok(rejected.diagnostics.some(d=>d.message.includes('Unresolved')));
    else assert.deepEqual(rejected.model.elements,[]);
  }
  const exported = parity({...request,method:'fixture/export',metadata:{package_id:'xtext.construction',release:'1',display_name:'Construction',description:''}});
  const imported = parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);
  assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});

test('simple actions construct concrete subtypes and initialize once across native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/simple-actions',name),'utf8');
  const request={method:'fixture/compile',xtext_profile:'intersect.xtext.native.v1',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore')};
  const compiled=parity(request);assert.equal(compiled.ok,true);
  const sources=[{uri:'actions.kerml',text:read('example.kerml')},{uri:'more.kerml',text:read('more.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(result.diagnostics,[]);
  assert.deepEqual(result.model.elements.map(e=>[e.class,e.values.name]),[['Model','Demo'],['Type','Vehicle'],['Type','Wheel'],['Feature','wheel'],['Model','Library'],['Type','Spare']]);
  assert.equal(result.model.elements[1].values.origin,'authored');assert.equal(result.model.elements[2].values.origin,'constructor');
  assert.equal(result.model.elements[3].values.target,'actions.kerml#2');
  for(const index of [1,2,5]) assert.equal(result.model.elements[index].initialization.object,result.model.elements[index].id);
  for(const replacement of ['{k::Element}','({k::Type})?','{k::Type.name=current}','{k::Type} {k::Type}']) {
    assert.equal(parity({...request,xtext:request.xtext.replace('{k::Type}',replacement)}).ok,false);
  }
  assert.equal(parity({...request,xtext_profile:'intersect.workbench.v1'}).ok,false);
  const bad=parity({method:'evaluate',package:compiled.package,sources:[{uri:'bad',text:'package Demo { type Wheel; feature wheel : Wheel; type Spare origin ; }'}]});
  assert.ok(bad.diagnostics.length);assert.deepEqual(bad.model.elements,[]);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.actions',release:'1',display_name:'Actions',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);
  assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});

test('native terminal programs preserve raw spelling, source identity and committed errors across native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/terminal-spellings',name),'utf8');
  const request={method:'fixture/compile',xtext_profile:'intersect.xtext.native.v1',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore')};
  const compiled=parity(request);assert.equal(compiled.ok,true);
  assert.equal(compiled.package.sources.xtext,request.xtext);
  assert.equal(compiled.package.grammar.terminals.TAG.identity,'mini.TerminalSpellings::TAG');
  const sources=[{uri:'terminals.kerml',text:read('example.kerml')},{uri:'more.kerml',text:read('more.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(result.diagnostics,[]);
  assert.deepEqual(result.model.elements.map(e=>[e.class,e.values.name]),[['Model','Demo'],['Type','@Wheel'],['Feature','wheel'],['Model','Library'],['Type','@Spare']]);
  assert.equal(result.model.elements[2].values.target,'terminals.kerml#1');
  assert.equal(sources[0].text.slice(result.references[0].start,result.references[0].end),'@Wheel');
  for(const text of ['package Demo { type @; }','package Demo { type @9; }','package Demo { type @/*gap*/Wheel; }']) {
    const rejected=parity({method:'evaluate',package:compiled.package,sources:[{uri:'bad',text}]});
    assert.deepEqual(rejected.model.elements,[]);assert.ok(rejected.diagnostics.some(d=>d.message.includes('terminal')));
  }
  assert.equal(parity({...request,xtext_profile:'intersect.workbench.v1'}).ok,false);
  assert.equal(parity({...request,xtext:request.xtext+'\nterminal OTHER: "@" "x";'}).ok,false);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.terminals',release:'1',display_name:'Terminals',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});

test('explicit hidden policy executes pinned terminal slices consistently across native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/explicit-lexical',name),'utf8');
  const request={method:'fixture/compile',xtext_profile:'intersect.xtext.native.v1',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore')};
  const compiled=parity(request);assert.equal(compiled.ok,true);
  assert.deepEqual(compiled.package.grammar.hidden,['WS']);
  assert.equal(compiled.package.sources.xtext,request.xtext);
  const sources=[{uri:'lexical.kerml',text:read('example.kerml')},{uri:'more.kerml',text:read('more.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,5);
  assert.equal(result.model.elements[0].values.documentation,'/* significant documentation */');
  assert.equal(result.model.elements[1].values.name,"'Wheel assembly'");
  assert.equal(result.model.elements[2].values.target,'lexical.kerml#1');
  for (const text of ['package\u00a0Demo {}','package Demo { /* significant */ }',"package Demo { type 'open; }",'package Demo // undeclared\n{}']) {
    const rejected=parity({method:'evaluate',package:compiled.package,sources:[{uri:'bad',text}]});
    assert.ok(rejected.diagnostics.length);assert.deepEqual(rejected.model.elements,[]);
  }
  for (const xtext of [request.xtext.replace('hidden(WS)','hidden(MISSING)'),request.xtext+'\nterminal ML_NOTE: "//*" -> "*/";']) {
    assert.equal(parity({...request,xtext}).ok,false);
  }
  assert.equal(parity({...request,xtext_profile:'intersect.workbench.v1'}).ok,false);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.lexical',release:'1',display_name:'Lexical',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);
  assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});

test('generated predictive lexer retains v2 source/profile and committed failures across native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/predictive-lexical',name),'utf8');
  const request={method:'fixture/compile',xtext_profile:'intersect.xtext.native.v2',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore')};
  const compiled=parity(request);assert.equal(compiled.ok,true);
  assert.equal(compiled.package.grammar.profile,request.xtext_profile);
  assert.ok(compiled.package.grammar.lexical_prediction);
  assert.equal(compiled.package.sources.xtext,request.xtext);
  const sources=[{uri:'prediction.kerml',text:read('example.kerml')},{uri:'more.kerml',text:read('more.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,5);
  assert.equal(result.model.elements[1].values.count,12);assert.equal(result.model.elements[1].values.magnitude,'1e3');
  assert.equal(result.model.elements[2].values.target,'prediction.kerml#1');
  for (const text of ['package P { type Wheel count 1e3; }','package P { type Wheel magnitude 1e+; }','package P { //* note */ type Wheel; }','package P { type Wheel count 2147483648; }']) {
    const rejected=parity({method:'evaluate',package:compiled.package,sources:[{uri:'bad',text}]});
    assert.ok(rejected.diagnostics.length);assert.deepEqual(rejected.model.elements,[]);
  }
  for (const [body,accepted] of [["'foo' 'x'",false],["name=TAG 'x'",true]]) {
    const xtext=`grammar example.KeywordIdentity hidden()
import "urn:intersect:xtext:mini-kerml:predictive-lexical:1" as k
Model returns k::Model: ${body};
terminal TAG: 'f' -> 'oo';`;
    const selected=parity({...request,xtext});assert.equal(selected.ok,true);
    const result=parity({method:'evaluate',package:selected.package,sources:[{uri:'identity',text:'foox'}]});
    assert.equal(result.diagnostics.length===0,accepted);
    if(accepted) assert.equal(result.model.elements[0].values.name,'foo');
    else assert.deepEqual(result.model.elements,[]);
  }
  const typedText=`grammar example.DeclaredTypes hidden(WS)
import "urn:intersect:xtext:mini-kerml:predictive-lexical:1" as k
import "http://www.eclipse.org/emf/2002/Ecore" as Ecore
Model returns k::Model: 'package' name=INT '{' members+=Type* '}';
Type returns k::Type: 'type' name=INT 'count' count=STRING ';';
terminal INT: ('a'..'z')+;
terminal STRING returns Ecore::EInt: ('0'..'9')+;
terminal WS: ' '+;`;
  const typed=parity({...request,xtext:typedText});assert.equal(typed.ok,true);
  const typedResult=parity({method:'evaluate',package:typed.package,sources:[{uri:'typed',text:'package p { type wheel count 12; }'}]});
  assert.deepEqual(typedResult.diagnostics,[]);assert.equal(typedResult.model.elements[0].values.name,'p');assert.equal(typedResult.model.elements[1].values.count,12);
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v1'}).ok,false);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.prediction',release:'1',display_name:'Prediction',description:''}});
  assert.equal(exported.manifest.runtime.profile,request.xtext_profile);
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});


test('inherited Xtext bundles execute and replay exact parent sources in native and WASM', () => {
  const read = name => readFileSync(resolve(root, 'fixtures/xtext/inherited-grammar', name), 'utf8');
  const source = (uri, kind) => { const text = read(uri); return {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[]}; };
  const ecore=source('model.ecore','ecore'), base=source('base.xtext','xtext'), child=source('model.xtext','xtext'), rcore_behavior=source('model-behavior.rcore','rcore_behavior');
  base.dependencies=[ecore.id];child.dependencies=[ecore.id,base.id];rcore_behavior.dependencies=[ecore.id];
  const compilation={bundle:{version:1,sources:[ecore,child,rcore_behavior,base],namespaces:[]},ecore:ecore.id,xtext:child.id,rcore_behavior:rcore_behavior.id,namespace:'urn:intersect:xtext:mini-kerml:inherited-grammar:1'};
  const request={method:'fixture/compileBundle',compilation,xtext_profile:'intersect.xtext.native.v2'};
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.package.grammar.declaration_sources.Type.source.uri,'base.xtext');
  assert.equal(compiled.package.grammar.entry,'Model');
  const sources=[{uri:'inherited.kerml',text:read('example.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,2);
  assert.equal(result.model.elements[0].values.name,'p');assert.equal(result.model.elements[1].values.name,'Wheel');
  const reordered=structuredClone(request);reordered.compilation.bundle.sources.reverse();
  const again=parity(reordered);assert.equal(again.ok,true);assert.deepEqual(again.package.grammar,compiled.package.grammar);
  assert.deepEqual(parity({method:'evaluate',package:again.package,sources}),result);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.inherited',release:'1',display_name:'Inherited grammar',description:''}});
  assert.equal(exported.manifest.format_version,2);
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);
  assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
  const inconsistent=structuredClone(exported.files), inconsistentManifest=structuredClone(exported.manifest);
  const selectedPath=inconsistentManifest.definitions.bundle;
  const changedBundle=JSON.parse(inconsistent[selectedPath]);
  changedBundle.bundle.sources.find(s=>s.id.uri===changedBundle.xtext.uri).text+='\n// changed selected source';
  inconsistent[selectedPath]=JSON.stringify(changedBundle);
  inconsistentManifest.files[selectedPath]={bytes:Buffer.byteLength(inconsistent[selectedPath]),sha256:createHash('sha256').update(inconsistent[selectedPath]).digest('hex')};
  rejectedBoundary({method:'package/import',files:{...inconsistent,'manifest.json':JSON.stringify(inconsistentManifest)}},/Source content digest mismatch/);
  const tampered={...request,method:'compile_bundle',compilation:structuredClone(compiled.package.compilation)};tampered.compilation.bundle.sources.find(s=>s.id.uri==='base.xtext').text+='\n// changed';
  rejectedBoundary({method:'ecore/migrateCompilation',compilation:tampered.compilation,targets:[{source:ecore.id,uri:ecore.id.uri+'.rcore'}]},/Source content digest mismatch/);
  const unpinned=structuredClone(request);unpinned.compilation.bundle.sources.find(s=>s.id.uri==='base.xtext').dependencies=[];
  const unpinnedResult=parity(unpinned);assert.equal(unpinnedResult.ok,false);
  assert.ok(unpinnedResult.diagnostics.some(d=>d.source==='base.xtext' && d.message.includes('exact Ecore dependency')));
  const missing=structuredClone(request);missing.compilation.bundle.sources.find(s=>s.id.uri==='model.xtext').dependencies=[ecore.id];
  assert.equal(parity(missing).ok,false);
});

test('contextual parser overrides retain shadowed declarations and selected-context behavior across native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/contextual-overrides',name),'utf8');
  const source=(uri,kind)=>{const text=read(uri);return {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[]};};
  const ecore=source('model.ecore','ecore'),base=source('base.xtext','xtext'),child=source('model.xtext','xtext'),rcore_behavior=source('model-behavior.rcore','rcore_behavior');
  base.dependencies=[ecore.id];child.dependencies=[ecore.id,base.id];rcore_behavior.dependencies=[ecore.id];
  const compilation={bundle:{version:1,sources:[ecore,base,child,rcore_behavior],namespaces:[]},ecore:ecore.id,xtext:child.id,rcore_behavior:rcore_behavior.id,namespace:'urn:intersect:xtext:mini-kerml:contextual-overrides:1'};
  const request={method:'fixture/compileBundle',compilation,xtext_profile:'intersect.xtext.native.v3'};
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.package.grammar.rules.Member.override_declared,true);
  assert.deepEqual(compiled.package.grammar.declaration_sources.Member.source,child.id);
  assert.deepEqual(compiled.package.grammar.shadowed_declarations.Member[0].source,base.id);
  const parent=parity({method:'fixture/compile',xtext_profile:request.xtext_profile,ecore:ecore.text,xtext:base.text,rcore_behavior:rcore_behavior.text});assert.equal(parent.ok,true);
  for(const [selected,positive,negative] of [[compiled,read('example.kerml'),read('base-example.kerml')],[parent,read('base-example.kerml'),read('example.kerml')]]) {
    const result=parity({method:'evaluate',package:selected.package,sources:[{uri:'context.kerml',text:positive}]});
    assert.deepEqual(result.diagnostics,[]);assert.deepEqual(result.model.elements.map(e=>[e.class,e.values.name]),[['Model','p'],['Type','Wheel']]);
    const rejected=parity({method:'evaluate',package:selected.package,sources:[{uri:'context.kerml',text:negative}]});
    assert.ok(rejected.diagnostics.length);assert.deepEqual(rejected.model.elements,[]);
  }
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v2'}).ok,false);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.overrides',release:'1',display_name:'Contextual overrides',description:''}});
  assert.equal(exported.manifest.runtime.profile,request.xtext_profile);
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);
  const forged=structuredClone(exported.files), manifest=structuredClone(exported.manifest);
  const wire=JSON.parse(forged[manifest.compiled_package]);
  wire.grammar.shadowed_declarations.Member[0].source.uri='forged-parent.xtext';
  forged[manifest.compiled_package]=JSON.stringify(wire);
  manifest.files[manifest.compiled_package]={bytes:Buffer.byteLength(forged[manifest.compiled_package]),sha256:createHash('sha256').update(forged[manifest.compiled_package]).digest('hex')};
  rejectedBoundary({method:'package/import',files:{...forged,'manifest.json':JSON.stringify(manifest)}},/differs from freshly compiled/);
  const tampered={...request,method:'compile_bundle',compilation:structuredClone(compiled.package.compilation)};tampered.compilation.bundle.sources.find(s=>s.id.uri==='base.xtext').text+='\n// changed';
  assert.equal(parity(tampered).ok,false);
});

test('cumulative KerML showcase combines inherited overrides, fragments, actions, lexical rules and cross-resource names', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/kerml-showcase',name),'utf8');
  const source=(uri,kind)=>{const text=read(uri);return {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[]};};
  const ecore=source('model.ecore','ecore'),base=source('base.xtext','xtext'),child=source('model.xtext','xtext'),rcore_behavior=source('model-behavior.rcore','rcore_behavior');
  base.dependencies=[ecore.id];child.dependencies=[ecore.id,base.id];rcore_behavior.dependencies=[ecore.id];
  for(const terminal of JSON.parse(read('provenance.json')).terminal_slices){const text=base.text.match(new RegExp(`terminal ${terminal.name}(?:\\s|:)[\\s\\S]*?;`))?.[0];assert.ok(text);assert.equal(createHash('sha256').update(text).digest('hex'),terminal.sha256);}
  const compilation={bundle:{version:1,sources:[ecore,base,child,rcore_behavior],namespaces:[]},ecore:ecore.id,xtext:child.id,rcore_behavior:rcore_behavior.id,namespace:'urn:intersect:xtext:mini-kerml:showcase:1'};
  const request={method:'fixture/compileBundle',compilation,xtext_profile:'intersect.xtext.native.v3'};
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  const sources=[{uri:'showcase.kerml',text:read('example.kerml')},{uri:'library.kerml',text:read('more.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,6);
  const types=result.model.elements.filter(e=>e.class==='Type');
  assert.deepEqual(types.map(e=>[e.values.name,e.values.isAbstract,e.values.count,e.values.magnitude,e.values.description]),[["Vehicles::'Wheel assembly'",true,12,'1e3','"Reusable wheel"'],['Library::Spare',false,3,'12E-3','"Replacement"']]);
  assert.deepEqual(result.model.elements.filter(e=>e.class==='Feature').map(e=>e.values.target),['showcase.kerml#1','library.kerml#1']);
  assert.equal(result.model.elements[0].values.documentation,'/* significant package documentation */');
  assert.equal(compiled.package.grammar.rules.Identification.fragment,true);
  for(const name of ['Type','Feature'])assert.equal(compiled.package.grammar.shadowed_declarations[name][0].source.uri,'base.xtext');
  for(const text of [sources[0].text.replace('1e3','1e+'),sources[0].text.replaceAll(':>',':'),sources[0].text.replace('Library::Spare','Library::Missing')]) {
    const rejected=parity({method:'evaluate',package:compiled.package,sources:[{...sources[0],text},sources[1]]});assert.ok(rejected.diagnostics.length);
  }
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.kerml.showcase',release:'1',display_name:'KerML syntax showcase',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});


test('inferred KerML datatypes preserve provenance, linked models and archive replay in native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/inferred-datatypes',name),'utf8');
  const source=(uri,kind)=>{const text=read(uri);return {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[]};};
  const ecore=source('model.ecore','ecore'),base=source('base.xtext','xtext'),child=source('model.xtext','xtext'),rcore_behavior=source('model-behavior.rcore','rcore_behavior');
  base.dependencies=[ecore.id];child.dependencies=[ecore.id,base.id];rcore_behavior.dependencies=[ecore.id];
  for(const terminal of JSON.parse(read('provenance.json')).terminal_slices){const text=base.text.match(new RegExp(`terminal ${terminal.name}(?:\\s|:)[\\s\\S]*?;`))?.[0];assert.ok(text);assert.equal(createHash('sha256').update(text).digest('hex'),terminal.sha256);}
  const compilation={bundle:{version:1,sources:[ecore,base,child,rcore_behavior],namespaces:[]},ecore:ecore.id,xtext:child.id,rcore_behavior:rcore_behavior.id,namespace:'urn:intersect:xtext:mini-kerml:inference:1'};
  const request={method:'fixture/compileBundle',compilation,xtext_profile:'intersect.xtext.native.v4'};
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v3'}).ok,false);
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  for(const name of ['QualifiedName','Name','Spelling','Number','ConditionalOperator']){const rule=compiled.package.grammar.rules[name];assert.equal(rule.inferred_return,true);assert.equal(rule.datatype,'EString');assert.equal(compiled.package.grammar.declaration_sources[name].source.uri,'base.xtext');}
  const sources=[{uri:'example.kerml',text:read('example.kerml')},{uri:'library.kerml',text:read('more.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,6);
  const predicted=parity({...request,xtext_profile:'intersect.xtext.native.v6'});assert.equal(predicted.ok,true,JSON.stringify(predicted.diagnostics));
  assert.deepEqual(parity({method:'evaluate',package:predicted.package,sources}),result);
  const types=result.model.elements.filter(e=>e.class==='Type');assert.equal(types[0].values.operator,'if');
  assert.deepEqual(types.map(e=>[e.values.name,e.values.count,e.values.magnitude]),[["Vehicles::'Wheel assembly'",12,'1e3'],['Library::Spare',3,'12E-3']]);
  assert.deepEqual(result.model.elements.filter(e=>e.class==='Feature').map(e=>e.values.target),['example.kerml#1','library.kerml#1']);
  for(const text of [sources[0].text.replace('operator if','operator else'),sources[0].text.replace('1e3','1e+'),sources[0].text.replace('Library::Spare','Library::Missing')])assert.ok(parity({method:'evaluate',package:compiled.package,sources:[{...sources[0],text},sources[1]]}).diagnostics.length);
  const unicodeSources=sources.map(source=>({...source,text:source.text.replaceAll('Wheel assembly','Wheel \u{1f6de} assembly')}));
  const unicode=parity({method:'evaluate',package:compiled.package,sources:unicodeSources});assert.deepEqual(unicode.diagnostics,[]);
  assert.equal(unicode.model.elements.find(e=>e.class==='Type').values.name,"Vehicles::'Wheel \u{1f6de} assembly'");
  assert.deepEqual(unicode.references.map(r=>Buffer.from(unicodeSources[0].text).subarray(r.start,r.end).toString('utf8')),["Vehicles::'Wheel \u{1f6de} assembly'",'Library::Spare']);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.inference',release:'1',display_name:'Inferred datatypes',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
  const forged=structuredClone(exported.files),manifest=structuredClone(exported.manifest),wire=JSON.parse(forged[manifest.compiled_package]);
  wire.grammar.rules.Name.inferred_return=false;forged[manifest.compiled_package]=JSON.stringify(wire);
  manifest.files[manifest.compiled_package]={bytes:Buffer.byteLength(forged[manifest.compiled_package]),sha256:createHash('sha256').update(forged[manifest.compiled_package]).digest('hex')};
  rejectedBoundary({method:'package/import',files:{...forged,'manifest.json':JSON.stringify(manifest)}},/differs from freshly compiled/);
});


test('assigned-current capture constructs left-associated objects with native/WASM archive replay', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/current-actions',name),'utf8');
  const request={method:'fixture/compile',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore'),xtext_profile:'intersect.xtext.native.v5'};
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v4'}).ok,false);
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  const sources=[{uri:'current.kerml',text:'Demo = 1 + 2 - 3;'}];
  const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);
  const elements=result.model.elements;assert.equal(elements.length,6);
  assert.deepEqual(elements.map(e=>[e.class,e.start,e.end]),[['Model',0,17],['Literal',7,8],['OperatorExpression',7,12],['Literal',11,12],['OperatorExpression',7,16],['Literal',15,16]]);
  assert.deepEqual(elements[2].values.operand,['current.kerml#1','current.kerml#3']);
  assert.deepEqual(elements[4].values.operand,['current.kerml#2','current.kerml#5']);
  assert.equal(elements[0].values.value,'current.kerml#4');
  for(const text of ['Demo = 1 +;','Demo = + 1;']) {const failed=parity({method:'evaluate',package:compiled.package,sources:[{uri:'current.kerml',text}]});assert.ok(failed.diagnostics.length);assert.deepEqual(failed.model.elements,[]);}
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.current',release:'1',display_name:'Current actions',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});



test('archive source policy cannot raise native or WASM host admission', () => {
 const read=name=>readFileSync(resolve(root,'fixtures/xtext/inherited-grammar',name),'utf8');
 const source=(uri,kind)=>{const text=read(uri);return {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[]};};
 const ecore=source('model.ecore','ecore'),base=source('base.xtext','xtext'),child=source('model.xtext','xtext'),rcore_behavior=source('model-behavior.rcore','rcore_behavior');
 base.dependencies=[ecore.id];child.dependencies=[ecore.id,base.id];rcore_behavior.dependencies=[ecore.id];
 const compilation={bundle:{version:1,sources:[ecore,base,child,rcore_behavior],namespaces:[]},ecore:ecore.id,xtext:child.id,rcore_behavior:rcore_behavior.id,namespace:'urn:intersect:xtext:mini-kerml:inherited-grammar:1'};
 const request={method:'fixture/compileBundle',compilation,xtext_profile:'intersect.xtext.native.v2'};
 const compiled=parity(request);assert.equal(compiled.ok,true);assert.equal(compiled.package.source_policy,undefined);
 const exported=parity({...request,method:'fixture/export',metadata:{package_id:'source.policy',release:'1',display_name:'Policy',description:''}});
 const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});assert.deepEqual(imported.package,compiled.package);
 const policy={structure_bytes:256000,xtext_bytes:256000,xtext_declarations:128};
 for(const key of Object.keys(policy)) {
   const manifest=structuredClone(exported.manifest);manifest.runtime.source_policy={...policy,[key]:policy[key]+1};
   rejectedBoundary({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(manifest)}},/host admission limits/);
 }
});

test('first-token predicate selection and committed failures share native/WASM execution and archive replay', () => {
  const read = name => readFileSync(resolve(root, 'fixtures/xtext/first-token-predicates', name), 'utf8');
  const request = {method:'fixture/compile', ecore:read('model.ecore'), xtext:read('model.xtext'), rcore_behavior:read('model-behavior.rcore'), xtext_profile:'intersect.xtext.native.v6'};
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v5'}).ok,false);
  const compiled = parity(request); assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.package.sources.xtext,request.xtext);
  const sources = [{uri:'prediction.model',text:'model { a b 12; }'}];
  const result = parity({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(result.diagnostics,[]);
  assert.deepEqual(result.model.elements.map(e=>[e.class,e.id,e.start,e.end]),[['Model','prediction.model#0',0,17],['Left','prediction.model#1',8,15]]);
  assert.equal(result.model.elements[1].values.number,12);
  for (const text of ['model { a b 2147483648; }','model { a b ; }','model { a b 12; a b ; }']) {
    const failed=parity({method:'evaluate',package:compiled.package,sources:[{uri:'prediction.model',text}]});
    assert.ok(failed.diagnostics.length);assert.deepEqual(failed.model.elements,[]);
  }
  const distinct=parity({...request,xtext:request.xtext.replace("'a' 'b' raw", "'a' 'c' raw")});
  assert.equal(distinct.ok,true);
  const fallback=parity({method:'evaluate',package:distinct.package,sources:[{uri:'prediction.model',text:'model { a c 2147483648; a b 12; }'}]});
  assert.deepEqual(fallback.diagnostics,[]);
  assert.deepEqual(fallback.model.elements.map(e=>e.class),['Model','Right','Left']);
  assert.equal(fallback.model.elements[1].values.raw,'2147483648');
  const fragment=parity({...request,xtext:request.xtext.replace("'model' '{' entries+=Entry* '}'", "'model' '{' Parts '}'")
    .replace('Entry returns p::Entry: ->Left | Right;', 'fragment Parts returns p::Model: (-> entries+=Left)+ entries+=Right? entries+=Left*;')
    .replace("'a' 'b' raw", "'multiplicity' raw")});
  assert.equal(fragment.ok,true,JSON.stringify(fragment.diagnostics));
  const parts=parity({method:'evaluate',package:fragment.package,sources:[{uri:'prediction.model',text:'model { a b 12; multiplicity 2; a b 13; }'}]});
  assert.deepEqual(parts.diagnostics,[]);
  assert.deepEqual(parts.model.elements.map(e=>e.class),['Model','Left','Right','Left']);
  for(const text of ['model { }','model { multiplicity 2; }','model { a b 12; multiplicity ; }']) {
    const failed=parity({method:'evaluate',package:fragment.package,sources:[{uri:'prediction.model',text}]});
    assert.ok(failed.diagnostics.length);assert.deepEqual(failed.model.elements,[]);
  }
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.prediction',release:'1',display_name:'First-token predicates',description:''}});
  assert.equal(exported.manifest.runtime.profile,request.xtext_profile);
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);
  assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
  const files=structuredClone(exported.files), manifest=structuredClone(exported.manifest);
  const wire=JSON.parse(files[manifest.compiled_package]);
  wire.grammar.rules.Entry.body.kind.Alternative[0].first_set_predicated=false;
  files[manifest.compiled_package]=JSON.stringify(wire);
  manifest.files[manifest.compiled_package]={bytes:Buffer.byteLength(files[manifest.compiled_package]),sha256:createHash('sha256').update(files[manifest.compiled_package]).digest('hex')};
  rejectedBoundary({method:'package/import',files:{...files,'manifest.json':JSON.stringify(manifest)}},/differs from freshly compiled/);
});

test('NativeV6 retains explicit lexical admission and compatible teaching-model behavior', () => {
  for (const [fixture,profile,extra] of [['boolean-keywords','v1',true],['typed-fragments','v1',true],['simple-actions','v1',true],['predictive-lexical','v2',true],['current-actions','v5',false]]) {
    const read=name=>readFileSync(resolve(root,'fixtures/xtext',fixture,name),'utf8');
    const request={method:'fixture/compile',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore'),xtext_profile:`intersect.xtext.native.${profile}`};
    const baseline=parity(request),candidate=parity({...request,xtext_profile:'intersect.xtext.native.v6'});
    assert.equal(baseline.ok,true,fixture);
    if(profile==='v1') {assert.equal(candidate.ok,false,fixture);assert.match(candidate.diagnostics[0].message,/explicit hidden policy/);continue;}
    assert.equal(candidate.ok,true,`${fixture}: ${JSON.stringify(candidate.diagnostics)}`);
    const sources=[{uri:'example.kerml',text:read('example.kerml')},...(extra?[{uri:'more.kerml',text:read('more.kerml')}]:[])];
    const expected=parity({method:'evaluate',package:baseline.package,sources});
    const actual=parity({method:'evaluate',package:candidate.package,sources});
    assert.deepEqual(expected.diagnostics,[],fixture);
    assert.deepEqual(actual,expected,fixture);
  }
});

test('enum rules preserve exact literal identities, rollback and archive replay in native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/enum-rules',name),'utf8');
  const request={method:'fixture/compile',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore'),xtext_profile:'intersect.xtext.native.v7'};
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v6'}).ok,false);
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  const sources=[{uri:'public.model',text:'visibility public;'},{uri:'private.model',text:'visibility [;'}];
  const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);
  assert.deepEqual(result.model.elements.map(e=>e.values.visibility.literal.path),[[1,2],[1,0]]);
  for(const e of result.model.elements){assert.equal(e.values.visibility.kind,'enum');assert.deepEqual(e.values.visibility.enumeration.path,[1]);assert.equal(e.values.visibility.enumeration.source.sha256,compiled.package.compilation.ecore.sha256);}
  for(const text of ['visibility private;','visibility missing;','visibility public']) {
    const failed=parity({method:'evaluate',package:compiled.package,sources:[sources[0],{uri:'private.model',text}]});
    assert.ok(failed.diagnostics.length);assert.deepEqual(failed.model.elements,[result.model.elements[0]]);
  }
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.enum_rules',release:'1',display_name:'Enum rules',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
  const files=structuredClone(exported.files),manifest=structuredClone(exported.manifest),wire=JSON.parse(files[manifest.compiled_package]);
  wire.grammar.rules.VisibilityIndicator.enum_literals.public.literal.path=[1,0];
  files[manifest.compiled_package]=JSON.stringify(wire);
  manifest.files[manifest.compiled_package]={bytes:Buffer.byteLength(files[manifest.compiled_package]),sha256:createHash('sha256').update(files[manifest.compiled_package]).digest('hex')};
  rejectedBoundary({method:'package/import',files:{...files,'manifest.json':JSON.stringify(manifest)}},/differs from freshly compiled/);
});

test('cumulative KerML enum showcase preserves inherited syntax and exact enum identities', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/enum-showcase',name),'utf8');
  const source=(uri,kind)=>{const text=read(uri);return {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[]};};
  const ecore=source('model.ecore','ecore'),base=source('base.xtext','xtext'),child=source('model.xtext','xtext'),rcore_behavior=source('model-behavior.rcore','rcore_behavior');
  base.dependencies=[ecore.id];child.dependencies=[ecore.id,base.id];rcore_behavior.dependencies=[ecore.id];
  for(const row of JSON.parse(read('provenance.json')).terminal_slices){const text=base.text.match(new RegExp(`terminal ${row.name}(?:\\s|:)[\\s\\S]*?;`))?.[0];assert.ok(text);assert.equal(createHash('sha256').update(text).digest('hex'),row.sha256);}
  const compilation={bundle:{version:1,sources:[ecore,base,child,rcore_behavior],namespaces:[]},ecore:ecore.id,xtext:child.id,rcore_behavior:rcore_behavior.id,namespace:'urn:intersect:xtext:mini-kerml:enums:1'};
  const request={method:'fixture/compileBundle',compilation,xtext_profile:'intersect.xtext.native.v7'};
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v6'}).ok,false);
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  const sources=[{uri:'example.kerml',text:read('example.kerml')},{uri:'library.kerml',text:read('more.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,6);
  const types=result.model.elements.filter(e=>e.class==='Type'),features=result.model.elements.filter(e=>e.class==='Feature');
  assert.deepEqual(types.map(e=>[e.values.name,e.values.count,e.values.magnitude]),[["Vehicles::'Wheel assembly'",12,'1e3'],['Library::Spare',3,'12E-3']]);
  assert.deepEqual(types.map(e=>e.values.visibility.literal.path),[[4,2],[4,0]]);
  assert.deepEqual(features.map(e=>e.values.direction.literal.path),[[5,2],[5,1]]);
  assert.deepEqual(features.map(e=>e.values.target),['example.kerml#1','library.kerml#1']);
  for(const text of [sources[0].text.replace('visibility public','visibility internal'),sources[0].text.replace('direction out','direction sideways')]) {
    const failed=parity({method:'evaluate',package:compiled.package,sources:[{...sources[0],text},sources[1]]});assert.ok(failed.diagnostics.length);assert.equal(failed.model.elements.length,2);assert.ok(failed.model.elements.every(e=>e.resource==='library.kerml'));
  }
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.enum_showcase',release:'1',display_name:'KerML enum rules',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});


test('pinned Nonunique rejection differs from Boolean keyword assignment through native/WASM', () => {
  const file=name=>readFileSync(resolve(root,'fixtures/xtext/rule-converters',name),'utf8');
  const evidence=JSON.parse(file('provenance.json')),baseline=JSON.parse(file('baseline.json'));
  const request={method:'fixture/compile',xtext_profile:baseline.profile,ecore:file('model.ecore'),xtext:file('model.xtext'),rcore_behavior:file('model-behavior.rcore')};
  const rejected=parity(request);assert.equal(rejected.ok,false);assert.deepEqual(rejected.diagnostics,baseline.rejection.map(d=>({...d,source:'memory:language.xtext'})));
  const fragment=evidence.rules.find(r=>r.name==='Nonunique').text;assert.ok(request.xtext.includes(fragment));
  const without=request.xtext.replace(fragment,'').replace('(isUnique=Nonunique)?','');
  for(const [grammar,text] of [[without,'feature F;'],[without.replace("name=ID  ';'","name=ID (isUnique?='nonunique')? ';'"),'feature F nonunique;']]) {
    const compiled=parity({...request,xtext:grammar});assert.equal(compiled.ok,true,JSON.stringify(compiled));
    const result=parity({method:'evaluate',package:compiled.package,sources:[{uri:'nonunique.model',text}]});
    assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,1);
    assert.equal(result.model.elements[0].values.isUnique,true);
  }
});


test('source-identified Boolean rule conversions survive native/WASM and exact archive replay', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/rule-converters',name),'utf8');
  const request={method:'fixture/compile',xtext_profile:'intersect.xtext.native.v8',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('native-v8-behavior.rcore').replace('from "xtext"', 'from "memory:language.xtext"')};
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  const sources=[{uri:'default.kerml',text:'feature F;'},{uri:'nonunique.kerml',text:read('example.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);assert.deepEqual(result.model.elements.map(e=>e.values.isUnique),[true,false]);
  for(const token of ['evidence.RuleConverters','http://www.eclipse.org/emf/2002/Ecore#//EBoolean']) { const bad=request.rcore_behavior.replace(token,'foreign'); assert.equal(parity({...request,rcore_behavior:bad}).ok,false); }
  const plain=parity({...request,rcore_behavior:read('model-behavior.rcore')});assert.equal(plain.ok,true);
  const failed=parity({method:'evaluate',package:plain.package,sources});assert.ok(failed.diagnostics.length);assert.deepEqual(failed.model.elements,[result.model.elements[0]]);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.rule_converters',release:'1',display_name:'Rule converters',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
  const files=structuredClone(exported.files),manifest=structuredClone(exported.manifest),wire=JSON.parse(files[manifest.compiled_package]);
  wire.semantics.rule_conversions[0].keywords.nonunique=true;files[manifest.compiled_package]=JSON.stringify(wire);
  manifest.files[manifest.compiled_package]={bytes:Buffer.byteLength(files[manifest.compiled_package]),sha256:createHash('sha256').update(files[manifest.compiled_package]).digest('hex')};
  rejectedBoundary({method:'package/import',files:{...files,'manifest.json':JSON.stringify(manifest)}},/differs from freshly compiled/);
});

test('inherited Boolean converter retains parent declaration and child context in native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/rule-converters',name),'utf8');
  const source=(uri,kind,text,dependencies=[])=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies});
  const ecore=source('model.ecore','ecore',read('model.ecore'));
  const base=source('base.xtext','xtext',read('model.xtext'),[ecore.id]);
  const child=source('child.xtext','xtext','grammar evidence.Child with evidence.RuleConverters hidden(WS)\nimport "urn:intersect:xtext:rule-converters:1" as p\nChild returns p::Model: Model;',[ecore.id,base.id]);
  const policy=read('native-v8-behavior.rcore').replace('evidence.RuleConverters','evidence.Child').replace('from "xtext"', 'from "base.xtext"');
  const rcore_behavior=source('behavior-behavior.rcore','rcore_behavior',policy,[ecore.id]);
  const compilation={bundle:{version:1,sources:[ecore,base,child,rcore_behavior],namespaces:[]},ecore:ecore.id,namespace:'urn:intersect:xtext:rule-converters:1',xtext:child.id,rcore_behavior:rcore_behavior.id};
  const request={method:'fixture/compileBundle',xtext_profile:'intersect.xtext.native.v8',compilation};
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled));assert.deepEqual(compiled.package.grammar.declaration_sources.Nonunique.source,base.id);
  const sources=[{uri:'model.kerml',text:'feature F nonunique;'}];const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements[0].values.isUnique,false);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.inherited_converter',release:'1',display_name:'Inherited converter',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});assert.deepEqual(imported.package,compiled.package);
});


test('cumulative converter showcase preserves Boolean policies alongside enum and linking behavior', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/converter-showcase',name),'utf8');
  const source=(uri,kind)=>{const text=read(uri);return {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[]};};
  const ecore=source('model.ecore','ecore'),base=source('base.xtext','xtext'),child=source('model.xtext','xtext'),rcore_behavior=source('model-behavior.rcore','rcore_behavior');
  base.dependencies=[ecore.id];child.dependencies=[ecore.id,base.id];rcore_behavior.dependencies=[ecore.id];
  const request={method:'fixture/compileBundle',xtext_profile:'intersect.xtext.native.v8',compilation:{bundle:{version:1,sources:[ecore,base,child,rcore_behavior],namespaces:[]},ecore:ecore.id,xtext:child.id,rcore_behavior:rcore_behavior.id,namespace:'urn:intersect:xtext:mini-kerml:converters:1'}};
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v7'}).ok,false);
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled));
  const sources=[{uri:'example.kerml',text:read('example.kerml')},{uri:'more.kerml',text:read('more.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,7);
  const features=result.model.elements.filter(e=>e.class==='Feature'),types=result.model.elements.filter(e=>e.class==='Type');
  assert.deepEqual(features.map(e=>[e.values.name,e.values.isUnique,e.values.isOrdered,e.values.isEnabled]),[['front',false,true,true],['spare',false,true,false],['standard',true,false,false]]);
  assert.deepEqual(features.map(e=>e.values.direction.literal.path),[[5,2],[5,1],[5,0]]);
  assert.deepEqual(features.map(e=>e.values.target),[types[0].id,types[1].id,types[1].id]);
  assert.deepEqual(types.map(e=>[e.values.visibility.literal.path,e.values.count,e.values.magnitude]),[[[4,2],12,'1e3'],[[4,0],3,'12E-3']]);
  for(const text of [sources[0].text.replace('enabled true','enabled maybe'),sources[0].text.replace('nonunique','nonunique nonunique')]) {
    const failed=parity({method:'evaluate',package:compiled.package,sources:[{...sources[0],text},sources[1]]});assert.ok(failed.diagnostics.length);assert.deepEqual(failed.model.elements,result.model.elements.filter(e=>e.resource==='more.kerml'));
  }
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.converter_showcase',release:'1',display_name:'KerML rule converters',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});


test('recursive first-token commitment matches oracle acceptance and archive replay in native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/recursive-predicates',name),'utf8');
  const request={method:'fixture/compile',xtext_profile:'intersect.xtext.native.v9',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore')};
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v8'}).ok,false);
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled));
  assert.equal(compiled.package.sources.xtext,request.xtext);
  const observations=JSON.parse(read('observations.json')).filter(row=>row.parser==='RecursiveEntryFirst');assert.equal(observations.length,11);
  for(const row of observations){
    const result=parity({method:'evaluate',package:compiled.package,sources:[{uri:'oracle.model',text:row.text}]});
    assert.equal(result.diagnostics.length===0,row.accepted,JSON.stringify(row));
    if(row.accepted)assert.equal(result.model.elements[0].class,'Left');else assert.deepEqual(result.model.elements,[]);
  }
  const sources=[{uri:'example.model',text:read('example.model')},{uri:'bad.model',text:'a a b c'}];
  const expected=parity({method:'evaluate',package:compiled.package,sources});assert.ok(expected.diagnostics.length);assert.equal(expected.model.elements.length,3);
  assert.equal(expected.model.elements[0].values.number,12);assert.equal(expected.model.elements[0].values.child,expected.model.elements[1].id);assert.equal(expected.model.elements[1].values.child,expected.model.elements[2].id);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.recursive',release:'1',display_name:'Recursive predicates',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),expected);
  const files=structuredClone(exported.files),manifest=structuredClone(exported.manifest),wire=JSON.parse(files[manifest.compiled_package]);
  wire.grammar.parser_prediction.recursive_decisions=[];files[manifest.compiled_package]=JSON.stringify(wire);
  manifest.files[manifest.compiled_package]={bytes:Buffer.byteLength(files[manifest.compiled_package]),sha256:createHash('sha256').update(files[manifest.compiled_package]).digest('hex')};
  rejectedBoundary({method:'package/import',files:{...files,'manifest.json':JSON.stringify(manifest)}},/differs from freshly compiled/);
});


test('inherited recursive predicates preserve parent declaration identity and source replay', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/recursive-predicates',name),'utf8');
  const source=(uri,kind,text,dependencies=[])=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies});
  const ecore=source('model.ecore','ecore',read('model.ecore'));
  const base=source('base.xtext','xtext',read('model.xtext'),[ecore.id]);
  const child=source('child.xtext','xtext','grammar example.RecursiveChild with example.RecursivePrediction hidden(WS)\nimport "urn:intersect:xtext:recursive:1" as r\nChild returns r::Entry: Entry;',[ecore.id,base.id]);
  const rcore_behavior=source('behavior-behavior.rcore','rcore_behavior',read('model-behavior.rcore'),[ecore.id]);
  const compilation={bundle:{version:1,sources:[ecore,base,child,rcore_behavior],namespaces:[]},ecore:ecore.id,namespace:'urn:intersect:xtext:recursive:1',xtext:child.id,rcore_behavior:rcore_behavior.id};
  const request={method:'fixture/compileBundle',xtext_profile:'intersect.xtext.native.v9',compilation};
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled));
  for(const name of ['Entry','Left','Right','Inner'])assert.deepEqual(compiled.package.grammar.declaration_sources[name].source,base.id);
  assert.deepEqual(compiled.package.grammar.declaration_sources.Child.source,child.id);
  const sources=[{uri:'nested.model',text:read('example.model')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,3);
  const rejected=parity({method:'evaluate',package:compiled.package,sources:[{uri:'nested.model',text:'a a b c'}]});assert.ok(rejected.diagnostics.length);assert.deepEqual(rejected.model.elements,[]);
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.inherited_recursive',release:'1',display_name:'Inherited recursion',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});

test('annotation metadata retains exact source and archive identity without executing bodies', () => {
  const annotation='<eAnnotations source="urn:unimplemented:derivation" references="#//Type/name"><details key="body" value="café 😀 deliberately not executable"/></eAnnotations>';
  const ecore=input.ecore.replace('  <eClassifiers', `  ${annotation}\n  <eClassifiers`);
  const request={...input,ecore};
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled));
  const migration=parity({method:'ecore/migrate',uri:'memory:ecore',text:ecore,target_uri:'memory:model.rcore'});
  assert.equal(migration.report.original.text,ecore);
  const canonical=migration.report.converted.text;
  assert.equal(compiled.package.sources.ecore,canonical);
  const spans=compiled.package.schema.generic_signatures.retained_payloads;
  assert.equal(spans.length,1);
  assert.equal(spans[0].source.sha256,createHash('sha256').update(canonical).digest('hex'));
  assert.match(Buffer.from(canonical).subarray(spans[0].start,spans[0].end).toString('utf8'),/café 😀 deliberately not executable/);
  const sources=[{uri:'annotated.kerml',text:fixture('example.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,4);
  const baseline=parity({method:'evaluate',package:parity(input).package,sources});
  assert.deepEqual(result.model.elements.map(e=>[e.id,e.class,e.values]),baseline.model.elements.map(e=>[e.id,e.class,e.values]));
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.annotations',release:'1',display_name:'Retained annotations',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);
  assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
  for(const changed of [ecore.replace('#//Type/name','#//Type/missing'),ecore.replace('<details key="body" value="café 😀 deliberately not executable"/>','<vendor:payload xmlns:vendor="urn:vendor"/>')]) {
    const rejected=parity({...request,ecore:changed});assert.equal(rejected.ok,false);assert.ok(rejected.report.issues.some(issue=>issue.blocks_conversion));
  }
});

test('EDouble RealValue uses independent IEEE results and exact source replay in native/WASM', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/double-datatypes',name),'utf8');
  const request={method:'fixture/compile',xtext_profile:'intersect.xtext.native.v10',ecore:read('model.ecore'),xtext:read('model.xtext'),rcore_behavior:read('model-behavior.rcore')};
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v9'}).ok,false);
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled));
  assert.equal(compiled.package.sources.xtext,request.xtext);
  const rows=JSON.parse(read('observations.json'));
  for(const row of rows.slice(0,14)) {
    const result=parity({method:'evaluate',package:compiled.package,sources:[{uri:'numbers.kerml',text:'values '+row.text}]});
    assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,2);
    assert.deepEqual(result.model.elements[1].values.value,{kind:'float64',bits:row.bits});
  }
  const sources=[{uri:'numbers.kerml',text:read('example.kerml')}];
  const expected=parity({method:'evaluate',package:compiled.package,sources});assert.equal(expected.model.elements.length,5);
  for(const text of ['12','NaN','Infinity','-0.0','. 5','1e+','1.0e 3']) {
    const result=parity({method:'evaluate',package:compiled.package,sources:[...sources,{uri:'bad.kerml',text:'values '+text}]});
    assert.ok(result.diagnostics.length);
    assert.ok(result.diagnostics.every(d=>d.source==='bad.kerml'));
    // Failed resources retain their diagnostics and empty roots. The admitted
    // model elements, schema and successful resource record remain unchanged.
    assert.deepEqual(result.model,{
      ...expected.model,
      resources:{...expected.model.resources,'bad.kerml':{
        content_revision:'0',diagnostics:result.diagnostics.map(d=>`${d.start}..${d.end}: ${d.message}`),
        load_state:'Loaded',roots:[],source:null,uri:'bad.kerml',
      }},
    });
  }
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.double',release:'1',display_name:'Real values',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),expected);
  const files=structuredClone(exported.files),manifest=structuredClone(exported.manifest),wire=JSON.parse(files[manifest.compiled_package]);
  wire.grammar.rules.RealValue.datatype='EString';files[manifest.compiled_package]=JSON.stringify(wire);
  manifest.files[manifest.compiled_package]={bytes:Buffer.byteLength(files[manifest.compiled_package]),sha256:createHash('sha256').update(files[manifest.compiled_package]).digest('hex')};
  rejectedBoundary({method:'package/import',files:{...files,'manifest.json':JSON.stringify(manifest)}},/differs from freshly compiled/);
});

test('inherited EDouble rule retains parent source identity and exact value transport', () => {
  const read=name=>readFileSync(resolve(root,'fixtures/xtext/double-datatypes',name),'utf8');
  const source=(uri,kind,text,dependencies=[])=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies});
  const ecore=source('model.ecore','ecore',read('model.ecore'));
  const base=source('base.xtext','xtext',read('model.xtext'),[ecore.id]);
  const child=source('child.xtext','xtext','grammar example.ChildDoubles with example.DoubleValues hidden(WS)\nimport "urn:intersect:xtext:double:1" as d\nChild returns d::Model: Model;',[ecore.id,base.id]);
  const rcore_behavior=source('behavior-behavior.rcore','rcore_behavior',read('model-behavior.rcore'),[ecore.id]);
  const compilation={bundle:{version:1,sources:[ecore,base,child,rcore_behavior],namespaces:[]},ecore:ecore.id,namespace:'urn:intersect:xtext:double:1',xtext:child.id,rcore_behavior:rcore_behavior.id};
  const request={method:'fixture/compileBundle',xtext_profile:'intersect.xtext.native.v10',compilation};
  const compiled=parity(request);assert.equal(compiled.ok,true,JSON.stringify(compiled));
  assert.deepEqual(compiled.package.grammar.declaration_sources.RealValue.source,base.id);
  assert.deepEqual(compiled.package.grammar.declaration_sources.Child.source,child.id);
  const sources=[{uri:'values.kerml',text:read('example.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});assert.deepEqual(result.diagnostics,[]);
  assert.equal(result.model.elements[4].values.value.bits,'7ff0000000000000');
  const exported=parity({...request,method:'fixture/export',metadata:{package_id:'xtext.inherited_double',release:'1',display_name:'Inherited real values',description:''}});
  const imported=parity({method:'package/import',files:{...exported.files,'manifest.json':JSON.stringify(exported.manifest)}});
  assert.deepEqual(imported.package,compiled.package);assert.deepEqual(parity({method:'evaluate',package:imported.package,sources}),result);
});


test('pinned recursive argument fragments retain ownership and named references in native/WASM', () => {
  const read = name => readFileSync(resolve(root, 'fixtures/xtext/recursive-fragments', name), 'utf8');
  const request = { method:'fixture/compile', xtext_profile:'intersect.xtext.native.v11', ecore:read('model.ecore'), xtext:read('model.xtext'), rcore_behavior:read('model-behavior.rcore') };
  const compiled = parity(request); assert.equal(compiled.ok, true, JSON.stringify(compiled));
  const sources=[{uri:'arguments',text:read('example.kerml')}];
  const result=parity({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(result.diagnostics,[]); assert.equal(result.model.elements.length,14);
  assert.deepEqual(result.model.elements[1].values.ownedRelationship,['arguments#2','arguments#6']);
  assert.deepEqual(result.model.elements[9].values.ownedRelationship,['arguments#10']);
  const named=parity({method:'evaluate',package:compiled.package,sources:[{uri:'named',text:'model atom target call n(target=atom v)'}]});
  assert.deepEqual(named.diagnostics,[]);
  assert.equal(named.model.elements.find(e=>e.class==='Redefinition').values.redefinedFeature,'named#1');
  for(const text of ['model call f(atom a,)', 'model call f(missing=atom a)', 'model call f(atom a, target=atom b)', 'model call f(atom a']) {
    const rejected=parity({method:'evaluate',package:compiled.package,sources:[{uri:'bad',text}]});
    assert.ok(rejected.diagnostics.length,text);
  }
  assert.deepEqual(parity({method:'evaluate',package:compiled.package,sources}).model,result.model);
  assert.equal(parity({...request,xtext_profile:'intersect.xtext.native.v10'}).ok,false);
});
