import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {migrateDefinitionFixture, fixtureDeclaration} from './migration-fixtures.js';
const cwd = new URL('../.runtime/intersect-text/', import.meta.url);
const collectionRoundtripSource = 'fn collectionRoundtrip<T>(value:T)->T={let xs=map([value,value],|x:T|x);let kept=filter(xs,|x:T|contains([value],x));let groups=groupBy(kept,|x:T|x);let flat=flatten(map(groups,|g:(T,Sequence<T>)|g[1]));let checked:Int8=if size(groups)==1 && count(flat,value)==2 && size(distinct(flat))==1 && size(intersection(flat,[value]))==1 && size(union(flat,[value]))==3 && contains(difference(flat,[value]),value) {0} else {1/0};fold(Sequence(distinct(flat)),value,|a:T,b:T|b)};';
const input = body => {
  const text = `rcore 1; package functions version "1"; ${body}`;
  const id = { uri: 'memory:functions-behavior.rcore', sha256: createHash('sha256').update(text).digest('hex') };
  return { bundle: { version: 1, sources: [{ id, kind: 'rcore_behavior', text, dependencies: [] }], namespaces: [] }, entry: id, selection: { symbol: { source: id, declaration: 0 }, types: [], arguments: [] }, arguments: [] };
};
// An explicitly supplied oracle must be prebuilt from the current Rust sources.
// The default Cargo path retains automatic freshness for ordinary harness runs.
const native = request => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], { cwd, input: JSON.stringify(request), encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 }));
const nativeJobs = requests => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_JOB_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_JOB_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'function_job_transcript', '--locked'], { cwd, input: JSON.stringify(requests), encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 }));
function sourceFixture(uri, kind, text, dependencies = []) {
  const original = {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies};
  return kind === 'ecore' ? migrateDefinitionFixture(original, native) : original;
}
async function parity(page, params, compile = false) {
  const worker = compile ? 'intersect/compileFunctionRcore' : 'intersect/evaluateFunctionRcore';
  const method = compile ? 'rcore_behavior/compileFunction' : 'rcore_behavior/evaluateFunction';
  const result = await page.evaluate(({ worker, params }) => window.workbench.request(worker, params), { worker, params });
  expect(result).toEqual(native({ ...params, method }));
  return result;
}
function lateContextBundle(params) {
  for (let n = 0; n < 12; n++) {
    const text = 'rcore 1; package p'+n+' version "1"; metamodel "urn:p'+n+'" prefix p'+n+' {}';
    const id = { uri: 'memory:context-'+n+'.rcore', sha256: createHash('sha256').update(text).digest('hex') };
    params.bundle.sources.push(sourceFixture(id.uri, text.startsWith('rcore ') ? 'rcore' : 'ecore', text));
    params.bundle.namespaces.push({ namespace: 'urn:p'+n, source: id });
  }
  return { version: 1, sources: [params.bundle.sources.at(-1)], namespaces: [params.bundle.namespaces.at(-1)] };
}

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 }); });

test('all navigation instruction families require exact saved source replay before admission', async ({ page }) => {
  test.setTimeout(180000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const source = sourceFixture;
  const model = source('memory:replay-navigation.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/projection.ecore', import.meta.url), 'utf8'));
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const namespace = 'urn:intersect:navigation';
  const types = [0, 3, 4].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const selected = { bundle, entry: model.id, namespace, types, instances: [{ id: 'd', type: types[1] }, { id: 'other', type: types[2] }] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
  const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: types, model: modeled.model };
  const before = structuredClone(reference);
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  const body = 'fn run(x:m.Base,y:m.Other)->Sequence<m.Base> ={let label=x.label;let backs=incoming::<m.Base>(x,"children");let parent=container::<m.Base>(x);let direct=contents::<m.Base>(x);let chain=ancestors::<m.Base>(x);Sequence(closure([x],|n:m.Base|n.children))};';
  const entry = source('memory:replay-navigation-behavior.rcore', 'rcore_behavior', `rcore 1;package replay_navigation version "1";import model "${namespace}" as m;${body}`, [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
  const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
  const parameters = compiled.program.functions[compiled.program.entry].parameters;
  const request = { ...params, expected_program: compiled.program, arguments: parameters.map((ty, n) => ({ ty, data: { Model: { kind: 'model_reference', context: digest, element: n === 0 ? 'd' : 'other' } } })), reference_contexts: [reference] };
  const baseline = await parity(page, request); expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
  expect(baseline.evaluation.value.data.Collection.map(value => value.data.Model.element)).toEqual(['d']);
  expect(compiled.effects[compiled.program.entry]).toBe('query');
  const instructions = program => program.functions.flatMap(fn => fn.blocks.flatMap(block => block.instructions));
  const stored = program => instructions(program).find(i => i.kind.StoredFeature?.field === 'label');
  const incoming = program => instructions(program).find(i => i.kind.Incoming);
  const ownership = (program, operation) => instructions(program).find(i => i.kind.Ownership?.operation === operation);
  const closure = program => instructions(program).find(i => i.kind.CollectionCall?.operation === 'Closure');
  expect(instructions(compiled.program).filter(i => i.kind.StoredFeature)).toHaveLength(2);
  expect(instructions(compiled.program).filter(i => i.kind.Incoming)).toHaveLength(1);
  expect(instructions(compiled.program).filter(i => i.kind.Ownership).map(i => i.kind.Ownership.operation)).toEqual(['Container', 'Contents', 'Ancestors']);
  expect(closure(compiled.program)).toBeDefined();
  const labelStart = entry.text.indexOf('x.label');
  // Stored-read instructions retain the selector token's authored span.
  expect(stored(compiled.program).span).toEqual({ source: entry.id, start: labelStart + 2, end: labelStart + 7 });
  const mutations = [
    ['stored selector', program => { stored(program).kind.StoredFeature.field = 'children'; }],
    ['stored declaration', program => { stored(program).kind.StoredFeature.declaration.path = [4, 0]; }],
    ['stored receiver', program => { stored(program).kind.StoredFeature.value = { Parameter: 1 }; }],
    ['stored result', program => { stored(program).ty = parameters[1]; }],
    ['stored span', program => { stored(program).span.start++; }],
    ['stored source', program => { stored(program).kind.StoredFeature.declaration.source.uri = 'memory:foreign.ecore'; }],
    ['incoming source type', program => { incoming(program).kind.Incoming.source = parameters[1]; }],
    ['incoming selector', program => { incoming(program).kind.Incoming.field = 'label'; }],
    ['incoming declaration', program => { incoming(program).kind.Incoming.declaration.path = [0, 0]; }],
    ['incoming receiver', program => { incoming(program).kind.Incoming.value = { Parameter: 1 }; }],
    ['incoming result', program => { incoming(program).ty = parameters[1]; }],
    ['incoming span', program => { incoming(program).span.start++; }],
    ['closure opcode', program => { closure(program).kind.CollectionCall.operation = 'Fold'; }],
    ['closure receiver', program => { closure(program).kind.CollectionCall.value = { Parameter: 1 }; }],
    ['closure callable', program => { closure(program).kind.CollectionCall.callback = { Parameter: 1 }; }],
    ['closure seed', program => { closure(program).kind.CollectionCall.seed = { Parameter: 0 }; }],
    ['closure result', program => { closure(program).ty = parameters[1]; }],
    ['closure span', program => { closure(program).span.start++; }],
    ['model source', program => { program.types[parameters[0]].Model.declaration.source.uri = 'memory:foreign.ecore'; }],
  ];
  for (const operation of ['Container', 'Contents', 'Ancestors']) {
    mutations.push(
      [`${operation} opcode`, program => { ownership(program, operation).kind.Ownership.operation = operation === 'Container' ? 'Contents' : 'Container'; }],
      [`${operation} selected type`, program => { ownership(program, operation).kind.Ownership.selected = parameters[1]; }],
      [`${operation} receiver`, program => { ownership(program, operation).kind.Ownership.value = { Parameter: 1 }; }],
      [`${operation} result`, program => { ownership(program, operation).ty = parameters[1]; }],
      [`${operation} span`, program => { ownership(program, operation).span.start++; }],
    );
  }
  for (const [name, mutate] of mutations) {
    const forged = structuredClone(compiled.program); mutate(forged);
    // Empty contexts make admission impossible. Exact replay must reject first.
    const rejected = await parity(page, { ...request, expected_program: forged, reference_contexts: [] });
    expect(rejected, name).toEqual({ stage: 'function_replay', ok: false, source_backed: true, diagnostics: [{ message: 'Saved function IR differs from freshly compiled source' }] });
  }
  const changed = source(entry.id.uri, entry.kind, entry.text.replace('closure([x],', 'closure([x,x],'), [model.id]);
  const stale = await parity(page, { ...request, bundle: { version: 1, sources: [model, changed], namespaces: [] }, entry: changed.id, selection: { ...params.selection, symbol: { source: changed.id, declaration: 1 } }, reference_contexts: [] });
  expect(stale.stage).toBe('function_replay'); expect(stale.ok).toBe(false);
  for (const [name, mutate] of [
    ['UnsupportedNavigation', program => { stored(program).kind = { UnsupportedNavigation: {} }; }],
    ['UnsupportedOwnership', program => { ownership(program, 'Container').kind.Ownership.operation = 'UnsupportedOwnership'; }],
    ['UnsupportedClosure', program => { closure(program).kind.CollectionCall.operation = 'UnsupportedClosure'; }],
    ...['StoredFeature', 'Incoming', 'Ownership', 'CollectionCall'].map(kind => ['unknown field `extra`', program => { instructions(program).find(i => i.kind[kind]).kind[kind].extra = true; }]),
  ]) {
    const forged = structuredClone(compiled.program); mutate(forged);
    const malformed = { ...request, expected_program: forged, reference_contexts: [] };
    const browserFailure = await page.evaluate(async params => {
      try { return await window.workbench.request('intersect/evaluateFunctionRcore', params); }
      catch (error) { return { message: error.message }; }
    }, malformed);
    expect(browserFailure.message).toContain(name);
    let nativeFailure;
    try { native({ ...malformed, method: 'rcore_behavior/evaluateFunction' }); }
    catch (error) { nativeFailure = String(error.stderr).trim(); }
    // The Rust CLI's ASCII diagnostic is a quoted Debug string; remove only
    // this host wrapper, then compare the complete shared diagnostic message.
    expect(nativeFailure).toMatch(/^Error: "/);
    expect(JSON.parse(nativeFailure.slice('Error: '.length))).toBe(browserFailure.message);
  }
  expect((await parity(page, request)).evaluation).toEqual(baseline.evaluation);
  expect(reference).toEqual(before);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('navigation aliases preserve exact diamond and unrelated feature declarations across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const source = sourceFixture;
  const model = source('memory:alias-diamond.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/projection.ecore', import.meta.url), 'utf8'));
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const namespace = 'urn:intersect:navigation';
  const types = [0, 1, 2, 3, 4].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const selected = { bundle, entry: model.id, namespace, types, instances: [{ id: 'd', type: types[3] }, { id: 'other', type: types[4] }], edits: [['other', 'label', 'other label']] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
  const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  const declarations = [];
  for (const [alias, className, classPath, object, expected, featurePath] of [
    ['left', 'Diamond', 3, 'd', 'seed', [0, 0]],
    ['right', 'Diamond', 3, 'd', 'seed', [0, 0]],
    ['left', 'Other', 4, 'other', 'other label', [4, 0]],
    ['right', 'Other', 4, 'other', 'other label', [4, 0]],
  ]) {
    const entry = source('memory:alias-diamond-behavior.rcore', 'rcore_behavior', `rcore 1;package aliases version "1";import model "${namespace}" as left;import model "${namespace}" as right;fn run(x:${alias}.${className})->Option<String> =x.label;`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 2 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    const parameter = compiled.program.functions[compiled.program.entry].parameters[0];
    expect(compiled.program.types[parameter].Model.declaration).toEqual(fixtureDeclaration(model, [classPath]));
    const reads = compiled.program.functions.flatMap(f => f.blocks.flatMap(b => b.instructions)).filter(i => i.kind.StoredFeature);
    expect(reads).toHaveLength(1);
    expect(reads[0].kind.StoredFeature.field).toBe('label');
    expect(reads[0].kind.StoredFeature.declaration).toEqual(fixtureDeclaration(model, featurePath));
    declarations.push(reads[0].kind.StoredFeature.declaration);
    expect(compiled.effects[compiled.program.entry]).toBe('query');
    const request = { ...params, expected_program: compiled.program, arguments: [{ ty: parameter, data: { Model: { kind: 'model_reference', context: digest, element: object } } }], reference_contexts: [reference] };
    const result = await parity(page, request); expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.evaluation.value.data.Some.data.Scalar.payload).toBe(expected);
    const forged = structuredClone(compiled.program);
    const read = forged.functions.flatMap(f => f.blocks.flatMap(b => b.instructions)).find(i => i.kind.StoredFeature);
    read.kind.StoredFeature.declaration.path = className === 'Diamond' ? [4, 0] : [0, 0];
    const rejected = await parity(page, { ...request, expected_program: forged });
    expect(rejected.ok).toBe(false); expect(rejected.stage).toBe('function_replay');
    if (alias === 'left' && className === 'Diamond') {
      const unchanged = structuredClone(reference);
      const wrongReceiver = await parity(page, { ...request, arguments: [{ ty: parameter, data: { Model: { kind: 'model_reference', context: digest, element: 'other' } } }] });
      expect(wrongReceiver.ok).toBe(false); expect(wrongReceiver.failure.kind).toBe('Nominal');
      expect(wrongReceiver.failure.message).toBe('Reference object is absent or does not conform to the selected EClass');
      for (const [mutation, message] of [
        ['schema', 'Model belongs to a different schema revision'],
        ['source', 'Reference context contains foreign source/dependency identity'],
      ]) {
        const bad = structuredClone(reference);
        if (mutation === 'schema') bad.model.schema_revision = 'stale';
        else bad.bundle.sources[0].id.uri = 'memory:foreign-alias-diamond.ecore';
        const badDigest = createHash('sha256').update(JSON.stringify(bad)).digest('hex');
        const invalid = await parity(page, { ...request, reference_contexts: [bad], arguments: [{ ty: parameter, data: { Model: { kind: 'model_reference', context: badDigest, element: object } } }] });
        expect(invalid.ok).toBe(false); expect(invalid.failure.kind).toBe('Nominal');
        expect(invalid.failure.message).toBe(message); expect(invalid.evaluation).toBeUndefined();
      }
      expect(reference).toEqual(unchanged);
    }
    expect((await parity(page, request)).evaluation).toEqual(result.evaluation);
  }
  expect(declarations[0]).toEqual(declarations[1]); expect(declarations[2]).toEqual(declarations[3]);
  expect(declarations[0]).not.toEqual(declarations[2]);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('inverse navigation distinguishes zero one and multiple typed sources across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const original = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/projection.ecore', import.meta.url), 'utf8');
  const text = original.replace('name="Other">', 'name="Other"><eStructuralFeatures xsi:type="ecore:EReference" name="children" upperBound="-1" unique="false" eType="#//Base"/>');
  const model = source('memory:inverse-cardinality.ecore', 'ecore', text);
  const namespace = 'urn:intersect:navigation';
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const types = [0, 1, 2, 3, 4].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const entry = source('memory:inverse-cardinality-behavior.rcore', 'rcore_behavior', `rcore 1;package cardinality version "1";import model "${namespace}" as left;import model "${namespace}" as right;fn run(x:left.Diamond)->OrderedSet<right.Other> =incoming::<right.Other>(x,"children");`, [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 2 }, types: [], arguments: [] } };
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
  const incoming = compiled.program.functions.flatMap(f => f.blocks.flatMap(b => b.instructions)).find(i => i.kind.Incoming);
  // The added children declaration precedes Other.label in this fixture.
  expect(incoming.kind.Incoming.declaration).toEqual(fixtureDeclaration(model, [4, 0]));
  const parameter = compiled.program.functions[compiled.program.entry].parameters[0];
  for (const expected of [[], ['z'], ['z', 'a']]) {
    const selected = { bundle, entry: model.id, namespace, types, instances: [{ id: 'd', type: types[3] }, { id: 'z', type: types[4] }, { id: 'base', type: types[0] }, { id: 'a', type: types[4] }, { id: 'empty', type: types[4] }], edits: [['base', 'children', ['d']], ...expected.map(id => [id, 'children', ['d', 'd']])] };
    const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
    expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
    const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: types, model: modeled.model };
    const before = structuredClone(reference);
    const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
    const request = { ...params, expected_program: compiled.program, arguments: [{ ty: parameter, data: { Model: { kind: 'model_reference', context: digest, element: 'd' } } }], reference_contexts: [reference] };
    const result = await parity(page, request); expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.evaluation.value.data.Collection.map(v => v.data.Model)).toEqual(expected.map(element => ({ kind: 'model_reference', context: digest, element })));
    expect(result.evaluation.consumed.model_contexts).toBe(1);
    expect(result.evaluation.consumed.reference_domains).toBe(2);
    expect(reference).toEqual(before);
  }
});

test('invalid navigation preserves exact authored diagnostic spans across hosts', async ({ page }) => {
  const source = sourceFixture;
  const model = source('memory:diagnostic-navigation.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/projection.ecore', import.meta.url), 'utf8'));
  for (const [body, fragment] of [
    ['fn run(x:m.Diamond)->Option<String> =x.absent;', 'x.absent'],
    ['fn run(x:m.Diamond)->Option<String> =x.computed;', 'x.computed'],
    ['fn run(x:m.Diamond)->OrderedSet<m.Base> =incoming::<m.Base>(x,"label");', 'incoming::<m.Base>(x,"label")'],
    ['fn run(x:m.Diamond)->OrderedSet<m.Base> =incoming::<m.Base>(x,"computed");', 'incoming::<m.Base>(x,"computed")'],
  ]) {
    const entry = source('memory:diagnostic-navigation-behavior.rcore', 'rcore_behavior', `rcore 1;package diagnostics version "1";import model "urn:intersect:navigation" as m;${body}`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const rejected = await parity(page, params, true);
    expect(rejected.ok).toBe(false); expect(rejected.stage).toBe('function_compile');
    expect(rejected.diagnostics).toHaveLength(1);
    expect(rejected.diagnostics[0].span).toEqual({ source: entry.id, start: entry.text.indexOf(fragment), end: entry.text.indexOf(fragment) + fragment.length });
  }
});

test('source closures, generics and structural calls share native WASM results', async ({ page }) => {
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const body of [
    'fn run()->Int8={let f=make(40);f(2)};fn make(x:Int8)->(Int8)->Int8=|y:Int8|x+y;',
    'fn run()->Int8=keep::<Int8,Bool>(42);fn keep<T,U>(x:T)->T=x;',
    'fn run()->Int8={let value:Int8?=Some(42);match id(value) {Some(x)=>x,None=>0}};fn id<T>(x:T)->T=x;',
    'fn run()->Sequence<Int8> =id([1,2,3]);fn id<T>(x:T)->T=x;',
  ]) {
    const params = input(body); const first = await parity(page, params);
    expect(first.ok).toBe(true);
    expect(await parity(page, { ...params, expected_program: first.program })).toEqual(first);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});
test('compiled type inspection supplies exact generic entry arguments', async ({ page }) => {
  const params = input('fn id<T>(x:T)->T=x;'); delete params.arguments;
  params.selection.types = [{ Scalar: 'Int8' }]; params.selection.arguments = [0];
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  params.arguments = [{ ty, data: { Scalar: { ty: { Scalar: 'Int8' }, payload: 42 } } }];
  params.expected_program = compiled.program;
  const result = await parity(page, params); expect(result.ok).toBe(true);
  expect(result.evaluation.value.data.Scalar.payload).toBe(42);
  params.expected_program = structuredClone(compiled.program); params.expected_program.entry = 999;
  expect((await parity(page, params)).stage).toBe('function_replay');
});
test('call traces, recursive exhaustion and closure transport failures agree', async ({ page }) => {
  const failed = await parity(page, input('fn run()->Int8=fail(0);fn fail(x:Int8)->Int8=1/x;'));
  expect(failed.ok).toBe(false); expect(failed.failure.kind).toBe('Arithmetic');
  expect(failed.failure.trace).toHaveLength(2);
  for (const body of ['fn run()->Int8=run();', 'fn run()->(Int8)->Int8=|x:Int8|x;']) {
    const rejected = await parity(page, input(body)); expect(rejected.ok).toBe(false);
    expect(rejected.failure.kind).toBe(body.includes('|x:Int8|') ? 'Unsupported' : 'ResourceExhausted');
  }
  expect((await parity(page, input('fn run()->Int8=42;'))).ok).toBe(true);
});

test('imported calls preserve module revisions in native WASM failure traces', async ({ page }) => {
  const source = (uri, text, dependencies = []) => ({ id: { uri, sha256: createHash('sha256').update(text).digest('hex') }, text, kind: 'rcore_behavior', dependencies });
  const helper = source('memory:helper-behavior.rcore', 'rcore 1; package helper version "1"; pub fn fail(x:Int8)->Int8=1/x;');
  const entry = source('memory:caller-behavior.rcore', 'rcore 1; package caller version "1"; import package helper version "1" as h; fn run()->Int8=h.fail(0);', [helper.id]);
  const params = { bundle: { version: 1, sources: [entry, helper], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, arguments: [] };
  const result = await parity(page, params); expect(result.failure.kind).toBe('Arithmetic');
  expect(result.failure.trace[0].definition.source).toEqual(helper.id);
  expect(result.failure.trace[0].call_site.source).toEqual(entry.id);
  params.bundle.sources.reverse(); params.expected_program = result.program;
  expect(await parity(page, params)).toEqual(result);
});

test('all scalar payloads survive recursive closure capture and return on native and WASM', async ({ page }) => {
  test.setTimeout(180000);
  const cases = [
    ['Bool', true], ['String', 'e\u0301ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¹Ã…â€œÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬'], ['Bytes', { kind: 'bytes', hex: '00ABFF' }],
    ['Char16', { kind: 'char16', unit: 55296 }], ['DateInstant', { kind: 'date', milliseconds: '-9223372036854775808' }], ['Unit', { kind: 'unit' }],
    ['Int8', -128], ['Int16', -32768], ['Int32', -2147483648], ['Int64', { kind: 'int64', value: '-9223372036854775808' }],
    ['UInt8', 255], ['UInt16', 65535], ['UInt32', 4294967295], ['UInt64', { kind: 'uint64', value: '18446744073709551615' }],
    ['BigInt', { kind: 'bigint', value: '123456789012345678901234567890' }], ['Decimal', { kind: 'decimal', coefficient: '1234567890123456789012300', scale: 4 }],
    ['Float32', { kind: 'float32', bits: '7fc01234' }], ['Float64', { kind: 'float64', bits: '8000000000000000' }],
  ];
  for (const [name, payload] of cases) {
    const params = input(`fn run(x:${name})->${name}={let f=|dummy:Int8|bounce(4,x);f(0)};fn bounce<T>(n:Int8,x:T)->T=if n==0 {x} else {bounce::<T>(n-1,x)};`);
    delete params.arguments;
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const value = { ty, data: { Scalar: { ty: { Scalar: name }, payload } } };
    params.arguments = [value]; params.expected_program = compiled.program;
    const result = await parity(page, params); expect(result.ok).toBe(true);
    expect(result.evaluation.value).toEqual(value);
  }
});

test('all Many multiplicity and uniqueness kinds preserve captured values', async ({ page }) => {
  test.setTimeout(180000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const ordered of [false, true]) for (const unique of [false, true]) for (const [lower, upper] of [[1, 2], [0, -1]]) {
    const params = input('fn identity<T>(x:T)->T={let f=|dummy:Int8|x;f(0)};');
    delete params.arguments;
    params.selection.types = [{ Scalar: 'Int8' }, { Many: { element: 0, lower, upper, ordered, unique } }];
    params.selection.arguments = [1];
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const element = compiled.program.types[ty].Many.element;
    params.expected_program = compiled.program;
    for (const items of [[1], [1, 2], [], [1, 2, 3], [1, 1]]) {
      const value = { ty, data: { Collection: items.map(payload => ({ ty: element, data: { Scalar: { ty: { Scalar: 'Int8' }, payload } } })) } };
      params.arguments = [value];
      const result = await parity(page, params);
      const valid = items.length >= lower && (upper < 0 || items.length <= upper) && (!unique || new Set(items).size === items.length);
      expect(result.ok).toBe(valid);
      if (valid) expect(result.evaluation.value).toEqual(value);
      else expect(result.failure.kind).toBe('Arguments');
    }
    params.arguments = [{ ty, data: { Collection: [{ ty: element, data: { Scalar: { ty: { Scalar: 'Int8' }, payload: 42 } } }] } }];
    expect((await parity(page, params)).ok).toBe(true);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('recursive enum captures retain literal aliases and reject foreign identities', async ({ page }) => {
  const source = sourceFixture;
  const model = source('memory:function-enums.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:function-enums"><eClassifiers x:type="e:EEnum" name="Mode"><eLiterals name="First" value="7" literal="first"/><eLiterals name="Alias" value="7" literal="alias"/></eClassifiers><eClassifiers x:type="e:EEnum" name="Other"><eLiterals name="First" value="7" literal="first"/></eClassifiers></e:EPackage>');
  const entry = source('memory:function-enums-behavior.rcore', 'rcore_behavior', 'rcore 1; package enums version "1"; import model "urn:function-enums" as m; fn run(x:m.Mode)->m.Mode={let f=|dummy:Int8|keep(x);f(0)}; fn keep(x:m.Mode)->m.Mode=bounce(4,x);fn bounce<T>(n:Int8,x:T)->T=if n==0 {x} else {bounce::<T>(n-1,x)};', [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  const id = path => fixtureDeclaration(model,path);
  const value = literal => ({ ty, data: { Enum: { kind: 'enum', enumeration: id([0]), literal } } });
  params.expected_program = compiled.program;
  for (const literal of [id([0, 0]), id([0, 1])]) {
    params.arguments = [value(literal)];
    const result = await parity(page, params); expect(result.ok).toBe(true);
    expect(result.evaluation.value).toEqual(params.arguments[0]);
  }
  for (const literal of [id([1, 0]), id([0, 99]), { source: { ...model.id, sha256: '0'.repeat(64) }, path: [0, 0] }]) {
    params.arguments = [value(literal)];
    const result = await parity(page, params); expect(result.ok).toBe(false); expect(result.failure.kind).toBe('Arguments');
  }
  params.arguments = [value(id([0, 1]))];
  expect((await parity(page, params)).ok).toBe(true);
});

test('source navigation preserves deleted recreated and pinned snapshot identities across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const model = source('memory:lifecycle.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/projection.ecore', import.meta.url), 'utf8'));
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const namespace = 'urn:intersect:navigation';
  const types = [0, 3].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const entry = source('memory:lifecycle-behavior.rcore', 'rcore_behavior', `rcore 1;package lifecycle version "1";import model "${namespace}" as m;fn run(x:m.Base)->Option<String> =x.label;`, [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  const contexts = [];
  for (const [present, label] of [[true, null], [false, null], [true, 'replacement']]) {
    const selected = { bundle, entry: model.id, namespace, types, instances: present ? [{ id: 'd', type: types[1] }] : [], edits: label ? [['d', 'label', label]] : [] };
    const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
    expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok, JSON.stringify(modeled)).toBe(true);
    contexts.push({ bundle, entry: model.id, namespace, conversions: [], materialized_types: types, model: modeled.model });
  }
  // These are snapshot admission/replay controls. The native companion uses
  // checked ModelEdit deletion and recreation to produce its snapshots.
  const digest = reference => createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  expect(new Set(contexts.map(digest)).size).toBe(3);
  const argument = reference => ({ ty, data: { Model: { kind: 'model_reference', context: digest(reference), element: 'd' } } });
  const saved = JSON.stringify(compiled.program);
  const run = (reference, value = argument(reference)) => parity(page, { ...params, expected_program: JSON.parse(saved), arguments: [value], reference_contexts: [reference] });
  for (const reference of contexts.slice(1)) {
    const result = await run(reference, argument(contexts[0]));
    expect(result.ok).toBe(false); expect(result.failure.kind).toBe('MissingDependency'); expect(result.failure.dependency).toBe('ModelContextRevision');
  }
  const missing = await run(contexts[1]);
  expect(missing.ok).toBe(false); expect(missing.failure.kind).toBe('Nominal'); expect(missing.failure.message).toContain('d');
  for (const [reference, label] of [[contexts[0], 'seed'], [contexts[2], 'replacement'], [contexts[0], 'seed']]) {
    const before = JSON.stringify(reference); const result = await run(reference);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.evaluation.value.data.Some.data.Scalar.payload).toBe(label);
    expect(JSON.stringify(reference)).toBe(before);
  }
  const changed = source(entry.id.uri, entry.kind, entry.text.replace('=x.label', '=Some("changed program")'), entry.dependencies);
  const stale = await parity(page, { ...params, bundle: { version: 1, sources: [model, changed], namespaces: [] }, entry: changed.id,
    selection: { ...params.selection, symbol: { source: changed.id, declaration: 1 } }, expected_program: JSON.parse(saved), arguments: [argument(contexts[0])], reference_contexts: [contexts[0]] });
  expect(stale.ok).toBe(false); expect(stale.stage).toBe('function_replay');
  expect((await run(contexts[0])).ok).toBe(true);
});

test('recursive ordinary raw and applied model captures retain validated snapshot identity', async ({ page }) => {
  test.setTimeout(180000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const source = sourceFixture;
  const model = source('memory:callable-models.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:callable-models"><eClassifiers x:type="e:EClass" name="Base"/><eClassifiers x:type="e:EClass" name="Child" eSuperTypes="#//Base"/><eClassifiers x:type="e:EClass" name="Box"><eTypeParameters name="T"/></eClassifiers><eClassifiers x:type="e:EDataType" name="Label" instanceClassName="java.lang.String"/></e:EPackage>');
  const modelBundle = { version: 1, sources: [model], namespaces: [] };
  const id = n => (fixtureDeclaration(model, [n]));
  const type = (n, args = [], raw = false) => ({ kind: 'classifier', declaration: id(n), arguments: args, raw });
  const types = [type(0), type(1), type(2, [type(1)]), type(2, [], true)];
  const selection = { bundle: modelBundle, entry: model.id, namespace: 'urn:callable-models', types, instances: [{ id: 'child', type: types[1] }, { id: 'box', type: types[2] }, { id: 'raw', type: types[3] }] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selection);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selection })); expect(modeled.ok).toBe(true);
  // Field order follows the published ReferenceContext serialization; the model
  // is the exact canonical snapshot emitted by the shared materializer.
  const context = { bundle: modelBundle, entry: model.id, namespace: 'urn:callable-models', conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(context)).digest('hex');
  for (const [annotation, element] of [['m.Base', 'child'], ['m.Box<m.Child>', 'box'], ['m.Box', 'raw']]) {
    const entry = source('memory:callable-models.rcore_behavior', 'rcore_behavior', `rcore 1;package nominal version "1";import model "urn:callable-models" as m;fn run(value:${annotation})->${annotation} ={let f=|dummy:Int8|bounce(4,collectionRoundtrip(value));f(0)};fn bounce<T>(n:Int8,x:T)->T=if n==0 {x} else {bounce::<T>(n-1,x)};${collectionRoundtripSource}`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const value = { ty, data: { Model: { kind: 'model_reference', context: digest, element } } };
    params.arguments = [value]; params.reference_contexts = [context]; params.expected_program = compiled.program;
    const result = await parity(page, params); expect(result.ok).toBe(true); expect(result.evaluation.value).toEqual(value);
    const needed = result.evaluation.consumed.provider_work;
    expect(needed).toBeGreaterThan(0);
    expect(result.evaluation.consumed.provider_invocations).toBe(0);
    const limits = {
      scalar: { max_steps: 100000, max_value_bytes: 4194304, values: { max_value_bytes: 262144, max_digits: 4096 }, numeric: { max_digits: 4096, max_intermediate_digits: 8192, max_scale_alignment: 4096, max_value_bytes: 262144, max_total_value_bytes: 1048576, max_work: 16777216 } },
      max_frames: 256, max_closures: 65536, max_captures: 65536, max_value_nodes: 65536,
      max_value_depth: 64, max_collection_comparisons: 1048576, max_trace_frames: 256,
      max_trace_bytes: 65536, max_model_contexts: 8, max_reference_domains: 128,
      max_context_bytes: 16777216, max_model_elements: 100000, max_membership_checks: 1048576,
      max_provider_evidence_bytes: 65536, max_provider_invocations: 1048576,
      max_provider_work: needed,
    };
    expect((await parity(page, { ...params, execution_limits: limits })).evaluation).toEqual(result.evaluation);
    for (const ceiling of [0, needed - 1]) {
      const rejected = await parity(page, { ...params, execution_limits: { ...limits, max_provider_work: ceiling } });
      expect(rejected.ok).toBe(false); expect(rejected.failure.kind).toBe('ResourceExhausted');
      expect(rejected.failure.consumed.provider_work).toBe(ceiling);
      expect(rejected.failure.consumed.reference_domains).toBe(0);
      expect(rejected.failure.consumed_providers).toEqual([]);
    }
    for (const bad of [{ ...value.data.Model, context: 'stale' }, { ...value.data.Model, element: 'missing' }, { ...value.data.Model, element: element === 'child' ? 'box' : 'child' }]) {
      const rejected = await parity(page, { ...params, arguments: [{ ty, data: { Model: bad } }] });
      expect(rejected.ok).toBe(false);
      expect(rejected.failure.kind).toBe(bad.context === digest ? 'Nominal' : 'MissingDependency');
      if (bad.context !== digest) expect(rejected.failure.dependency).toBe('ModelContextRevision');
    }
    expect((await parity(page, params)).evaluation.value).toEqual(value);
  }
  const entry = source('memory:callable-label-behavior.rcore', 'rcore_behavior', 'rcore 1;package label version "1";import model "urn:callable-models" as m;fn run(value:m.Label)->m.Label={let f=|dummy:Int8|bounce(4,collectionRoundtrip(value));f(0)};fn bounce<T>(n:Int8,x:T)->T=if n==0 {x} else {bounce::<T>(n-1,x)};' + collectionRoundtripSource, [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  const value = { ty, data: { Datatype: { kind: 'datatype', datatype: id(3), value: 'retained' } } };
  params.arguments = [value]; params.expected_program = compiled.program;
  expect((await parity(page, params)).evaluation.value).toEqual(value);
  const forged = structuredClone(value); forged.data.Datatype.datatype.source.sha256 = '0'.repeat(64);
  const rejected = await parity(page, { ...params, arguments: [forged] }); expect(rejected.ok).toBe(false); expect(rejected.failure.kind).toBe('Nominal');
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('recursive applied datatype captures use the exact installed codec and reject forged tags', async ({ page }) => {
  const source = sourceFixture;
  const model = source('memory:applied-values.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="values" nsURI="urn:applied-values"><eClassifiers x:type="e:EDataType" name="Text" instanceClassName="java.lang.String"/><eClassifiers x:type="e:EDataType" name="Sequence" instanceClassName="intersect.Sequence"><eTypeParameters name="T"/></eClassifiers></e:EPackage>');
  const id = n => (fixtureDeclaration(model, [n]));
  const application = { kind: 'classifier', declaration: id(1), arguments: [{ kind: 'classifier', declaration: id(0), arguments: [], raw: false }], raw: false };
  const contract = { application, conversion: { datatype: id(1), provider: { name: 'intersect.sequence', version: '1' }, serializable: true, declarations: [], members: [{ nullable: false, value: { kind: 'datatype', declaration: id(0) } }] } };
  const entry = source('memory:applied-values-behavior.rcore', 'rcore_behavior', 'rcore 1;package applied_values version "1";import model "urn:applied-values" as m;fn run(value:m.Sequence<m.Text>)->m.Sequence<m.Text> ={let f=|unused:Int8|bounce(4,collectionRoundtrip(value));f(0)};fn bounce<T>(n:Int8,x:T)->T=if n==0 {x} else {bounce::<T>(n-1,x)};' + collectionRoundtripSource, [model.id]);
  const bundle = { version: 1, sources: [model, entry], namespaces: [] };
  const binding = { bundle, conversions: [contract], operation: { kind: 'bind', application, payload: ['one', 'two'].map(value => ({ kind: 'datatype', datatype: id(0), value })) } };
  const bound = await page.evaluate(params => window.workbench.request('intersect/appliedConversion', params), binding);
  expect(bound).toEqual(native({ method: 'conversion/applied', ...binding })); expect(bound.ok).toBe(true);
  const params = { bundle, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, applied_conversions: [contract] };
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  const value = { ty, data: { Datatype: bound.value } };
  params.arguments = [value]; params.expected_program = compiled.program;
  const accepted = await parity(page, params); expect(accepted.ok).toBe(true); expect(accepted.evaluation.value).toEqual(value);
  const missing = await parity(page, { ...params, applied_conversions: [] }); expect(missing.ok).toBe(false); expect(missing.stage).toBe('function_compile');
  const forged = structuredClone(value); forged.data.Datatype.converted.provider.version = 'stale';
  const wrongProvider = await parity(page, { ...params, arguments: [forged] }); expect(wrongProvider.ok).toBe(false); expect(wrongProvider.failure.kind).toBe('Nominal');
  const stale = structuredClone(value); stale.data.Datatype.application.arguments[0].declaration.source.sha256 = '0'.repeat(64);
  const rejected = await parity(page, { ...params, arguments: [stale] }); expect(rejected.ok).toBe(false); expect(rejected.failure.kind).toBe('Nominal');
  expect((await parity(page, params)).evaluation.value).toEqual(value);
});

test('overload calls and contextual captures retain exact source selections', async ({ page }) => {
  const initial = await page.evaluate(() => window.workbench.inspect());
  const cases = [
    ['fn run()->Int8=pick(true);fn pick(x:Int8)->Int8=x;fn pick(x:Bool)->Int8=42;', 2],
    ['fn run()->Int8=pick(true);fn pick(x:{budget:Int8})->Int8=1;fn pick(x:Bool)->Int8=42;', 2],
    ['fn run()->Int8={let f:(Int8)->Int8=(pick);let closure=|x:Int8|f(x);closure(42)};fn pick(x:Int8)->Int8=x;fn pick(x:Bool)->Bool=x;', 1],
    ['fn run()->Int8=pick::<Int8>(42);fn pick<T>(x:T)->T=x;fn pick(x:Bool)->Bool=x;', 1],
    ['fn run()->Int8=pick();fn pick()->Int8=42;fn pick()->Bool=true;', 1],
  ];
  for (const [body, declaration] of cases) {
    const params = input(body);
    const result = await parity(page, params); expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toBe(42);
    expect(result.program.functions.some(f => f.identity.Named?.symbol.declaration === declaration)).toBe(true);
    const again = await parity(page, { ...params, expected_program: result.program }); expect(again).toEqual(result);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('overload ambiguity and invalid unused bodies reject before execution', async ({ page }) => {
  for (const body of [
    'fn run()->Int8=pick(1);fn pick(x:Int8)->Int8=1;fn pick(x:Int16)->Int8=2;',
    'fn run()->Int8=pick(1);fn pick<T>(x:T)->T=x;fn pick(x:Int8)->Int8=x;',
    'fn run()->Int8={let f=pick;f(42)};fn pick(x:Int8)->Int8=x;fn pick(x:Bool)->Bool=x;',
    'fn run()->Int8=pick(42);fn pick(x:Int8)->Int8=x;fn pick(x:Bool)->Int8=true;',
  ]) {
    const result = await parity(page, input(body)); expect(result.ok).toBe(false);
    expect(result.stage).toBe('function_compile'); expect(result.diagnostics.length).toBeGreaterThan(0);
  }
  expect((await parity(page, input('fn run()->Int8=42;'))).ok).toBe(true);
});

test('imported overload selection preserves privacy and selected failure provenance', async ({ page }) => {
  const source = (uri, text, dependencies = []) => ({ id: { uri, sha256: createHash('sha256').update(text).digest('hex') }, kind: 'rcore_behavior', text, dependencies });
  const helper = source('memory:overloaded-helper-behavior.rcore', 'rcore 1;package helper version "1";pub fn pick(x:Int8)->Int8=1/x;pub fn pick(x:Bool)->Bool=x;fn pick(x:Int16)->Int8=2;');
  const entry = source('memory:overloaded-caller-behavior.rcore', 'rcore 1;package caller version "1";import package helper version "1" as h;fn run()->Int8={let f:(Int8)->Int8=(h.pick);f(0)};', [helper.id]);
  const params = { bundle: { version: 1, sources: [entry, helper], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, arguments: [] };
  const result = await parity(page, params); expect(result.stage).toBe('function_execution'); expect(result.failure.kind).toBe('Arithmetic');
  expect(result.failure.trace[0].function.Named.symbol).toEqual({ source: helper.id, declaration: 0 });
  expect(result.failure.trace[0].call_site.source).toEqual(entry.id);
  params.bundle.sources.reverse(); params.expected_program = result.program;
  expect(await parity(page, params)).toEqual(result);
});


test('provider backed stored navigation preserves payloads flags and failure recovery across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const fixture = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/provider-stored.ecore', import.meta.url), 'utf8');
  const limits = {
    scalar: { max_steps: 100000, max_value_bytes: 4194304, values: { max_value_bytes: 262144, max_digits: 4096 }, numeric: { max_digits: 4096, max_intermediate_digits: 8192, max_scale_alignment: 4096, max_value_bytes: 262144, max_total_value_bytes: 1048576, max_work: 16777216 } },
    max_frames: 256, max_closures: 65536, max_captures: 65536, max_value_nodes: 65536,
    max_value_depth: 64, max_collection_comparisons: 1048576, max_trace_frames: 256,
    max_trace_bytes: 65536, max_model_contexts: 8, max_reference_domains: 128,
    max_context_bytes: 16777216, max_model_elements: 100000, max_membership_checks: 1048576,
    max_provider_evidence_bytes: 65536, max_provider_invocations: 0, max_provider_work: 1048576,
  };
  for (const ordered of [false, true]) for (const unique of [false, true]) {
    const model = source('memory:provider-stored.ecore', 'ecore', fixture.replace('ordered="true" unique="true"', `ordered="${ordered}" unique="${unique}"`));
    // Empty optional policy inventories are omitted by ConversionContract's
    // wire serializer and therefore must also be omitted from the digest input.
    const contract = { datatype: fixtureDeclaration(model, [0]), provider: { name: 'example.rgb', version: '1' }, serializable: true };
    const type = { kind: 'classifier', declaration: fixtureDeclaration(model, [1]), arguments: [], raw: false };
    const payload = { kind: 'converted', datatype: contract.datatype, provider: contract.provider, value: { red: 18, green: 58, blue: 188 } };
    const other = { ...payload, value: { red: 0, green: 255, blue: 1 } };
    const colors = unique ? [payload, other] : [payload, other, payload];
    const bundle = { version: 1, sources: [model], namespaces: [] }; const namespace = 'urn:intersect:provider-navigation';
    const selected = { bundle, entry: model.id, namespace, conversions: [contract], types: [type], instances: [{ id: 'd', type }], edits: [['d', 'color', payload], ['d', 'colors', colors]] };
    const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
    expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok, JSON.stringify(modeled)).toBe(true);
    const reference = { bundle, entry: model.id, namespace, conversions: [contract], materialized_types: [type], model: modeled.model };
    for (const many of [false, true]) {
      const kind = ordered ? 'Sequence' : 'Bag';
      const body = many ? `fn run(x:m.Node)->${kind}<m.RGB> =${kind}(x.colors);` : 'fn run(x:m.Node)->m.RGB ={let read=|unused:Int8|x.color;read(0)};';
      const entry = source('memory:provider-stored-behavior.rcore', 'rcore_behavior', `rcore 1;package provider_navigation version "1";import model "${namespace}" as m;${body}`, [model.id]);
      const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, conversions: [contract] };
      const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      if (many) expect(compiled.program.types.some(t => t.Many && t.Many.ordered === ordered && t.Many.unique === unique)).toBe(true);
      const ty = compiled.program.functions[compiled.program.entry].parameters[0];
      const run = (snapshot, limits) => parity(page, { ...params, expected_program: compiled.program, ...(limits ? { execution_limits: limits } : {}),
        arguments: [{ ty, data: { Model: { kind: 'model_reference', context: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), element: 'd' } } }], reference_contexts: [snapshot] });
      const before = JSON.stringify(reference); const result = await run(reference);
      expect(result.ok, JSON.stringify(result)).toBe(true); expect(result.evaluation.consumed_providers).toEqual([contract.provider]);
      if (many) expect(result.evaluation.value.data.Collection.map(item => item.data.Datatype)).toEqual(colors);
      else expect(result.evaluation.value.data.Datatype).toEqual(payload);
      if (many) {
        const empty = structuredClone(reference); empty.model.elements[0].values.colors = [];
        const before = JSON.stringify(empty); const result = await run(empty);
        expect(result.ok, JSON.stringify(result)).toBe(true); expect(result.evaluation.value.data.Collection).toEqual([]);
        expect(JSON.stringify(empty)).toBe(before);
      }
      const exhausted = await run(reference, limits);
      expect(exhausted.ok).toBe(false); expect(exhausted.failure.kind).toBe('ResourceExhausted');
      const unmeasured = await run(reference, { ...limits, max_provider_invocations: 1048576, max_provider_work: 0 });
      expect(unmeasured.ok).toBe(false); expect(unmeasured.failure.kind).toBe('ResourceExhausted');
      expect(unmeasured.failure.consumed.provider_invocations).toBe(0); expect(unmeasured.failure.consumed_providers).toEqual([]);
      for (const stale of [false, true]) {
        const invalid = structuredClone(reference);
        if (stale) invalid.model.elements[0].values.color.provider.version = 'stale';
        else invalid.model.elements[0].values.color.value.red = 256;
        const before = JSON.stringify(invalid); const rejected = await run(invalid);
        expect(rejected.ok).toBe(false); expect(rejected.failure.kind).toBe('Nominal'); expect(JSON.stringify(invalid)).toBe(before);
      }
      expect(JSON.stringify(reference)).toBe(before); expect((await run(reference)).ok).toBe(true);
    }
  }
});

test('generic provider bound navigation preserves alias identity across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const model = source('memory:provider-handoff', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/rcore-behavior-provider-handoff.ecore', import.meta.url), 'utf8'));
  const id = n => (fixtureDeclaration(model, [n]));
  const type = (n, arguments_ = []) => ({ kind: 'classifier', declaration: id(n), arguments: arguments_, raw: false });
  const target = type(2, [type(1)]);
  const contracts = [0, 1].map(n => ({ datatype: id(n), provider: { name: 'example.rgb', version: '1' }, serializable: true }));
  const payload = { kind: 'converted', datatype: id(1), provider: contracts[1].provider, value: { red: 18, green: 58, blue: 188 } };
  const namespace = 'urn:rcore-behavior-provider-handoff'; const bundle = { version: 1, sources: [model], namespaces: [] };
  const selected = { bundle, entry: model.id, namespace, conversions: contracts, types: [target], instances: [{ id: 'box', type: target }], edits: [['box', 'value', payload]] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok, JSON.stringify(modeled)).toBe(true);
  const entry = source('memory:provider-navigation', 'rcore_behavior', `rcore 1;package handoff version "1";import model "${namespace}" as m;fn read(x:m.Box<m.Alias>)->m.Alias ={let read=|unused:Int8|x.value;keep(read(0))};fn keep<T>(x:T)->T=x;`, [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, conversions: contracts };
  const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  const reference = { bundle, entry: model.id, namespace, conversions: contracts, materialized_types: [target], model: modeled.model };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const run = snapshot => {
    const wire = { ...snapshot, model: canonical(snapshot.model) };
    return parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: { kind: 'model_reference', context: createHash('sha256').update(JSON.stringify(wire)).digest('hex'), element: 'box' } } }], reference_contexts: [wire] });
  };
  const before = JSON.stringify(reference); const result = await run(reference);
  expect(result.ok, JSON.stringify(result)).toBe(true); expect(result.evaluation.value.data.Datatype).toEqual(payload);
  expect(result.evaluation.consumed_providers).toEqual([contracts[1].provider]); expect(JSON.stringify(reference)).toBe(before);
  for (const stale of [false, true]) {
    const invalid = structuredClone(reference);
    if (stale) invalid.model.elements[0].values.value.provider.version = 'stale';
    else invalid.model.elements[0].values.value.datatype = id(0);
    const before = JSON.stringify(invalid); const error = await run(invalid);
    expect(error.ok).toBe(false); expect(error.failure.kind).toBe('Nominal'); expect(JSON.stringify(invalid)).toBe(before);
  }
  const reversed = structuredClone(reference); reversed.conversions.reverse();
  expect((await run(reversed)).evaluation.value.data.Datatype).toEqual(payload);
  expect((await run(reference)).ok).toBe(true);
});

test('stored nested applied datatype navigation preserves payloads and rejects inner failures across hosts', async ({ page }) => {
  test.setTimeout(300000);
  const source = sourceFixture;
  const model = source('memory:constructor-handoff', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/rcore-behavior-constructor-handoff.ecore', import.meta.url), 'utf8'));
  const id = n => (fixtureDeclaration(model, [n]));
  const type = (n, arguments_ = []) => ({ kind: 'classifier', declaration: id(n), arguments: arguments_, raw: false });
  const provider = name => ({ name, version: '1' });
  // Match the typed ReferenceContext serializer's field order for digest input.
  const codec = (n, members) => ({ members, datatype: id(n), provider: provider('ecore.list'), serializable: false });
  const alias = { application: type(2, [type(0)]), conversion: codec(2, [{ nullable: false, value: { kind: 'datatype', declaration: id(0) } }]) };
  const bounded = { application: type(3, [alias.application]), conversion: codec(3, [{ nullable: false, value: { kind: 'applied', contract: alias } }]) };
  const bundle = { version: 1, sources: [model], namespaces: [] }; const constructors = [];
  for (const n of [1, 2]) {
    const params = { bundle, datatype: id(n), provider: provider('ecore.list.constructor') };
    const result = await page.evaluate(params => window.workbench.request('intersect/constructorContract', params), params);
    expect(result).toEqual(native({ method: 'conversion/constructor', ...params })); expect(result.ok).toBe(true);
    const d = result.contract.datatype;
    const declaration = value => ({ source: { uri: value.source.uri, sha256: value.source.sha256 }, path: value.path });
    const span = value => ({ source: { uri: value.source.uri, sha256: value.source.sha256 }, start: value.start, end: value.end });
    expect(d.parameters.every(parameter => parameter.bounds.length === 0)).toBe(true);
    constructors.push({ datatype: {
      declaration: declaration(d.declaration), name: d.name, serializable: d.serializable,
      instance_class_name: d.instance_class_name, instance_type_name: d.instance_type_name,
      binding: { kind: d.binding.kind, reason: d.binding.reason }, source_payload: d.source_payload,
      parameters: d.parameters.map(parameter => ({ declaration: declaration(parameter.declaration), span: span(parameter.span), source_payload: parameter.source_payload, name: parameter.name, bounds: [] })),
    }, provider: provider('ecore.list.constructor') });
  }
  const tag = (contract, items) => ({ kind: 'converted_application_v1', application: contract.application, converted: { kind: 'converted', datatype: contract.conversion.datatype, provider: contract.conversion.provider, value: { items } } });
  const payload = tag(bounded, [tag(alias, [{ kind: 'datatype', datatype: id(0), value: 'retained' }])]);
  const namespace = 'urn:constructors'; const target = type(5);
  const selected = { bundle, entry: model.id, namespace, applied_conversions: [bounded], constructors, types: [target], instances: [{ id: 'holder', type: target }], edits: [['holder', 'values', payload], ['holder', 'many', [payload, payload]]] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok, JSON.stringify(modeled)).toBe(true);
  expect(modeled.schema.applied_conversion_contracts).toEqual([bounded]);
  expect(modeled.schema.constructor_contracts).toEqual(expect.arrayContaining(constructors));
  const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: [target], applied_conversions: [bounded], constructors, model: modeled.model };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  for (const many of [false, true]) {
    const body = many ? 'fn read(x:m.Holder)->Bag<m.Bounded<m.Alias<m.Text>>> =Bag(x.many);' : 'fn read(x:m.Holder)->Option<m.Bounded<m.Alias<m.Text>>> =x.values;';
    const entry = source('memory:constructor-handoff-rcore_behavior', 'rcore_behavior', `rcore 1;package handoff version "1";import model "${namespace}" as m;${body}`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, applied_conversions: [alias, bounded], constructors };
    const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const request = snapshot => {
      const wire = { ...snapshot, model: canonical(snapshot.model) };
      return { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: { kind: 'model_reference', context: createHash('sha256').update(JSON.stringify(wire)).digest('hex'), element: 'holder' } } }], reference_contexts: [wire] };
    };
    const run = snapshot => parity(page, request(snapshot));
    const before = JSON.stringify(reference); const result = await run(reference);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (many) expect(result.evaluation.value.data.Collection.map(item => item.data.Datatype)).toEqual([payload, payload]);
    else expect(result.evaluation.value.data.Some.data.Datatype).toEqual(payload);
    expect(result.evaluation.consumed_providers).toContainEqual(provider('ecore.list')); expect(JSON.stringify(reference)).toBe(before);
    const transcript = await page.evaluate(async params => {
      const { loadRuntime } = await import('/src/runtime.js'); const invoke = await loadRuntime();
      const requests = [], responses = [];
      const send = request => { requests.push(request); const response = invoke(request); responses.push(response); return response; };
      const start = () => send({ ...params, method: 'rcore_behavior/startFunction' });
      const first = start(); const namespace = first.job.slice(0, first.job.lastIndexOf(':'));
      const resume = (job, quantum) => send({ method: 'rcore_behavior/resumeFunction', job, quantum });
      let baseline = first, units = 0;
      while (baseline.pending) { baseline = resume(first.job, 1); if (++units > 10000) throw new Error('Applied navigation did not terminate'); }
      const cancellations = [];
      // Representative shared-host boundaries; the native control separately
      // visits every pending boundary for both stored feature shapes.
      for (const stop of [...new Set([0, 1, Math.floor(units / 2), units - 2, units - 1])]) {
        const outcomes = [];
        for (const quantum of [1, 3, 4096]) {
          const job = start(); let advanced = 0;
          while (advanced < stop) { const slice = Math.min(quantum, stop - advanced); if (!resume(job.job, slice).pending) throw new Error('Completed before applied cancellation'); advanced += slice; }
          outcomes.push(send({ method: 'rcore_behavior/cancelFunction', job: job.job }));
        }
        cancellations.push(outcomes);
      }
      const recoveries = [];
      for (const quantum of [1, 3, 4096]) {
        let response = start(); const job = response.job; let slices = 0;
        while (response.pending) { response = resume(job, quantum); if (++slices > 10000) throw new Error('Applied recovery did not terminate'); }
        recoveries.push(response);
      }
      return { requests: [{ method: 'rcore_behavior/jobHost', namespace }, ...requests], responses, baseline, units, cancellations, recoveries };
    }, request(reference));
    const nativeResponses = nativeJobs(transcript.requests);
    expect(nativeResponses.slice(1)).toEqual(transcript.responses); expect(transcript.baseline.result).toEqual(result);
    for (const outcomes of transcript.cancellations) {
      expect(outcomes[0].result.failure.kind).toBe('Cancelled'); expect(outcomes[1]).toEqual(outcomes[0]); expect(outcomes[2]).toEqual(outcomes[0]);
    }
    expect(transcript.cancellations.some(outcomes => outcomes[0].result.failure.consumed.provider_invocations > 0)).toBe(true);
    for (const recovered of transcript.recoveries) expect(recovered).toEqual(transcript.baseline);
    expect(JSON.stringify(reference)).toBe(before);
    const field = many ? 'many' : 'values'; const empty = structuredClone(reference);
    if (many) empty.model.elements[0].values[field] = []; else delete empty.model.elements[0].values[field];
    const absent = await run(empty); expect(absent.ok, JSON.stringify(absent)).toBe(true);
    if (many) expect(absent.evaluation.value.data.Collection).toEqual([]); else expect(absent.evaluation.value.data).toEqual('None');
    for (const mutation of [0, 1, 2]) {
      const invalid = structuredClone(reference); const value = many ? invalid.model.elements[0].values[field][0] : invalid.model.elements[0].values[field];
      const nested = value.converted.value.items[0];
      if (mutation === 0) nested.converted.value.items[0].value = 7;
      else if (mutation === 1) nested.converted.provider.version = 'stale';
      else nested.application.arguments[0].declaration.path = [7];
      const before = JSON.stringify(invalid); const result = await run(invalid);
      expect(result.ok).toBe(false); expect(result.failure.kind).toBe('Nominal'); expect(JSON.stringify(invalid)).toBe(before);
    }
    expect((await run(reference)).ok).toBe(true);
  }
});

test('provider provenance distinguishes selected codecs from actual nested validation', async ({ page }) => {
  const initial = await page.evaluate(() => window.workbench.inspect());
  const source = sourceFixture;
  const model = source('memory:provider-receipts.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="receipts" nsURI="urn:provider-receipts"><eClassifiers x:type="e:EDataType" name="RGB" instanceClassName="example.RGB"/><eClassifiers x:type="e:EDataType" name="Sequence" instanceClassName="intersect.Sequence"><eTypeParameters name="T"/></eClassifiers></e:EPackage>');
  const id = n => (fixtureDeclaration(model, [n]));
  const application = { kind: 'classifier', declaration: id(1), arguments: [{ kind: 'classifier', declaration: id(0), arguments: [], raw: false }], raw: false };
  const rgb = { datatype: id(0), provider: { name: 'example.rgb', version: '1' }, serializable: true, declarations: [], members: [] };
  const sequence = { application, conversion: { datatype: id(1), provider: { name: 'intersect.sequence', version: '1' }, serializable: true, declarations: [], members: [{ nullable: false, value: { kind: 'converted', contract: rgb } }] } };
  const entry = source('memory:provider-receipts-behavior.rcore', 'rcore_behavior', 'rcore 1;package receipts version "1";import model "urn:provider-receipts" as m;fn run(value:m.Sequence<m.RGB>)->m.Sequence<m.RGB> ={let f=|unused:Int8|value;f(0)};', [model.id]);
  const bundle = { version: 1, sources: [model, entry], namespaces: [] };
  const params = { bundle, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, conversions: [rgb], applied_conversions: [sequence] };
  const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
  params.expected_program = compiled.program;
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  const color = { kind: 'converted', datatype: id(0), provider: rgb.provider, value: { red: 18, green: 58, blue: 188 } };
  const wrap = items => ({ ty, data: { Datatype: { kind: 'converted_application_v1', application, converted: { kind: 'converted', datatype: id(1), provider: sequence.conversion.provider, value: items } } } });
  const expected = [rgb.provider, sequence.conversion.provider];
  const empty = await parity(page, { ...params, arguments: [wrap([])] });
  expect(empty.ok, JSON.stringify(empty)).toBe(true);
  expect(empty.evaluation.selected_providers).toEqual(expected);
  expect(empty.evaluation.consumed_providers).toEqual([sequence.conversion.provider]);
  const value = wrap([color, color]);
  const full = await parity(page, { ...params, arguments: [value] });
  expect(full.ok, JSON.stringify(full)).toBe(true); expect(full.evaluation.value).toEqual(value);
  expect(full.evaluation.selected_providers).toEqual(expected);
  expect(full.evaluation.consumed_providers).toEqual(expected);
  const invalid = structuredClone(value); invalid.data.Datatype.converted.value[0].value.red = 256;
  const rejected = await parity(page, { ...params, arguments: [invalid] });
  expect(rejected.ok).toBe(false); expect(rejected.failure.kind).toBe('Nominal');
  expect(rejected.failure.consumed_providers).toEqual(expected);
  const outer = structuredClone(value); outer.data.Datatype.converted.provider.version = 'stale';
  const beforeDispatch = await parity(page, { ...params, arguments: [outer] });
  expect(beforeDispatch.ok).toBe(false); expect(beforeDispatch.failure.consumed_providers).toEqual([]);
  const inner = structuredClone(value); inner.data.Datatype.converted.value[0].provider.version = 'stale';
  const nestedDispatch = await parity(page, { ...params, arguments: [inner] });
  expect(nestedDispatch.ok).toBe(false); expect(nestedDispatch.failure.consumed_providers).toEqual([sequence.conversion.provider]);
  const limits = {
    scalar: { max_steps: 100000, max_value_bytes: 4194304, values: { max_value_bytes: 262144, max_digits: 4096 }, numeric: { max_digits: 4096, max_intermediate_digits: 8192, max_scale_alignment: 4096, max_value_bytes: 262144, max_total_value_bytes: 1048576, max_work: 16777216 } },
    max_frames: 256, max_closures: 65536, max_captures: 65536, max_value_nodes: 65536,
    max_value_depth: 64, max_collection_comparisons: 1048576, max_trace_frames: 256,
    max_trace_bytes: 65536, max_model_contexts: 8, max_reference_domains: 128,
    max_context_bytes: 16777216, max_model_elements: 100000, max_membership_checks: 1048576,
    max_provider_evidence_bytes: full.evaluation.consumed.provider_evidence_bytes,
    max_provider_invocations: full.evaluation.consumed.provider_invocations,
    max_provider_work: full.evaluation.consumed.provider_work,
  };
  expect((await parity(page, { ...params, arguments: [value], execution_limits: limits })).evaluation).toEqual(full.evaluation);
  for (const field of ['max_provider_evidence_bytes', 'max_provider_invocations', 'max_provider_work']) {
    for (const ceiling of [0, limits[field] - 1]) {
      const bounded = await parity(page, { ...params, arguments: [value], execution_limits: { ...limits, [field]: ceiling } });
      expect(bounded.ok).toBe(false); expect(bounded.failure.kind).toBe('ResourceExhausted');
      expect(bounded.failure.message).toBe({
        max_provider_evidence_bytes: 'Provider evidence byte limit exceeded',
        max_provider_invocations: 'Provider invocation limit exceeded',
        max_provider_work: 'Provider work limit exceeded',
      }[field]);
    }
  }
  const oldLimits = { ...limits }; delete oldLimits.max_provider_work;
  expect((await parity(page, { ...params, arguments: [value], execution_limits: oldLimits })).evaluation).toEqual(full.evaluation);
  const raisedWork = { ...params, arguments: [value], execution_limits: { ...limits, max_provider_work: 1048577 } };
  await expect(page.evaluate(params => window.workbench.request('intersect/evaluateFunctionRcore', params), raisedWork)).rejects.toThrow('host safety ceiling');
  expect(() => native({ ...raisedWork, method: 'rcore_behavior/evaluateFunction' })).toThrow('host safety ceiling');
  const truncated = await parity(page, { ...params, arguments: [invalid], execution_limits: { ...limits, max_trace_bytes: 0 } });
  expect(truncated.failure.provider_evidence_truncated).toBe(true);
  expect(truncated.failure.consumed_providers).toEqual([]);
  expect(await parity(page, { ...params, bundle: { ...bundle, sources: [...bundle.sources].reverse() }, arguments: [value] })).toEqual(full);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('structural runtime arguments reject malformed shapes and recover through captures', async ({ page }) => {
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const annotation of ['{a:Int8,b:Bool}', '(Int8,Bool)', 'Option<Int8>', 'Result<Int8,Bool>']) {
    const params = input(`fn run(x:${annotation})->${annotation} ={let captured=|n:Int8|x;captured(0)};`);
    delete params.arguments;
    const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    const types = compiled.program.types;
    const root = compiled.program.functions[compiled.program.entry].parameters[0];
    const value = ty => {
      const type = types[ty];
      if (type.Scalar) return { ty, data: { Scalar: { ty: { Scalar: type.Scalar }, payload: type.Scalar === 'Bool' ? true : 42 } } };
      if (type.Record) return { ty, data: { Record: Object.fromEntries(Object.entries(type.Record).map(([key, child]) => [key, value(child)])) } };
      if (type.Tuple) return { ty, data: { Tuple: type.Tuple.map(value) } };
      if (type.Option !== undefined) return { ty, data: { Some: value(type.Option) } };
      if (type.Result) return { ty, data: { Ok: value(type.Result.ok) } };
      throw new Error(`Unexpected fixture type ${JSON.stringify(type)}`);
    };
    const argument = value(root);
    params.expected_program = compiled.program;
    const accepted = await parity(page, { ...params, arguments: [argument] });
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true); expect(accepted.evaluation.value).toEqual(argument);
    const malformed = [];
    if (types[root].Record) {
      const missing = structuredClone(argument); delete missing.data.Record.a; malformed.push(missing);
      const extra = structuredClone(argument); extra.data.Record.extra = extra.data.Record.a; malformed.push(extra);
    } else if (types[root].Tuple) {
      const short = structuredClone(argument); short.data.Tuple.pop(); malformed.push(short);
      const long = structuredClone(argument); long.data.Tuple.push(long.data.Tuple[0]); malformed.push(long);
    } else if (types[root].Option !== undefined) {
      const wrong = structuredClone(argument); wrong.data.Some.data.Scalar.ty = { Scalar: 'Bool' }; wrong.data.Some.data.Scalar.payload = true; malformed.push(wrong);
    } else {
      const wrong = structuredClone(argument); wrong.data.Ok.data.Scalar.ty = { Scalar: 'Bool' }; wrong.data.Ok.data.Scalar.payload = true; malformed.push(wrong);
      malformed.push({ ty: root, data: { Err: argument.data.Ok } });
    }
    for (const bad of malformed) {
      const rejected = await parity(page, { ...params, arguments: [bad] });
      expect(rejected.ok).toBe(false); expect(rejected.stage).toBe('function_execution');
      expect(rejected.failure.kind).toBe('Arguments');
    }
    expect((await parity(page, { ...params, arguments: [argument] })).evaluation).toEqual(accepted.evaluation);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('retained WASM jobs isolate instances and deliver exact terminal outcomes', async ({ page }) => {
  const params = input('fn run()->Int8={let f=make(40);f(2)};fn make(x:Int8)->(Int8)->Int8=|y:Int8|x+y;');
  const observed = await page.evaluate(async params => {
    const { loadRuntime } = await import('/src/runtime.js');
    const first = await loadRuntime();
    const second = await loadRuntime();
    const a = first({ ...params, method: 'rcore_behavior/startFunction' });
    const b = first({ ...params, method: 'rcore_behavior/startFunction' });
    const foreign = second({ ...params, method: 'rcore_behavior/startFunction' });
    let foreignRejected = false;
    try { first({ method: 'rcore_behavior/cancelFunction', job: foreign.job }); }
    catch { foreignRejected = true; }
    const step = first({ method: 'rcore_behavior/resumeFunction', job: a.job, quantum: 1 });
    const cancelled = first({ method: 'rcore_behavior/cancelFunction', job: a.job });
    let staleRejected = false;
    try { first({ method: 'rcore_behavior/resumeFunction', job: a.job }); }
    catch { staleRejected = true; }
    let result;
    let slices = 0;
    do {
      result = first({ method: 'rcore_behavior/resumeFunction', job: b.job, quantum: 1 });
      if (++slices > 1000) throw new Error('fixture failed to terminate');
    } while (result.pending);
    const dropped = second({ method: 'rcore_behavior/dropFunction', job: foreign.job });
    return { step, cancelled, staleRejected, foreignRejected, result, slices, dropped };
  }, params);
  expect(observed.step.pending).toBe(true);
  expect(observed.cancelled.result.failure.kind).toBe('Cancelled');
  expect(observed.cancelled.pending).toBe(false);
  expect(observed.staleRejected).toBe(true);
  expect(observed.foreignRejected).toBe(true);
  expect(observed.dropped.dropped).toBe(true);
  expect(observed.slices).toBeGreaterThan(1);
  expect(observed.result.result).toEqual(native({ ...params, method: 'rcore_behavior/evaluateFunction' }));
});


test('worker yields callable execution for cancellation and independent requests', async ({ page }) => {
  const long = input('fn run()->Int8=f12();fn f0()->Int8=1;' + Array.from({ length: 12 }, (_, n) => `fn f${n + 1}()->Int8={let ignored=f${n}();f${n}()};`).join(''));
  const small = input('fn run()->Int8=42;');
  const observed = await page.evaluate(async ({ long, small }) => {
    const worker = new Worker('/src/language.worker.js', { type: 'module' });
    const pending = new Map();
    const counts = {};
    worker.onmessage = ({ data }) => {
      if (data.id === undefined) return;
      counts[String(data.id)] = (counts[String(data.id)] || 0) + 1;
      const handler = pending.get(data.id);
      if (handler) { pending.delete(data.id); handler(data); }
    };
    const request = (id, method, params = {}) => new Promise(resolve => {
      pending.set(id, resolve);
      worker.postMessage({ jsonrpc: '2.0', id, method, params });
    });
    try {
      await request('initialize', 'initialize');
      const running = request(10, 'intersect/evaluateFunctionRcore', long);
      const independent = request(11, 'intersect/evaluateFunctionRcore', small);
      // A different request must finish while the large evaluation remains active.
      const probe = await request('probe', 'intersect/parseRcore', { uri: 'memory:probe-behavior.rcore', text: 'rcore 1; package probe version "1";' });
      const activeAtProbe = pending.has(10);
      worker.postMessage({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: '10' } });
      await request('identity-probe', 'intersect/parseRcore', { uri: 'memory:probe-behavior.rcore', text: 'rcore 1; package probe version "1";' });
      const activeAfterForeignCancel = pending.has(10);
      worker.postMessage({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 10 } });
      const cancelled = await running;
      const completed = await independent;
      worker.postMessage({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 10 } });
      const recovered = await request(12, 'intersect/evaluateFunctionRcore', small);
      const shutdownJob = request(13, 'intersect/evaluateFunctionRcore', long);
      const shutdown = await request('shutdown', 'shutdown');
      const shutdownResult = await shutdownJob;
      return { activeAtProbe, activeAfterForeignCancel, probe, cancelled, completed, recovered, shutdown, shutdownResult, counts };
    } finally { worker.terminate(); }
  }, { long, small });
  expect(observed.activeAtProbe).toBe(true);
  expect(observed.activeAfterForeignCancel).toBe(true);
  expect(observed.probe.result.ok).toBe(true);
  expect(observed.cancelled.result.failure.kind).toBe('Cancelled');
  expect(observed.shutdownResult.result.failure.kind).toBe('Cancelled');
  const expected = native({ ...small, method: 'rcore_behavior/evaluateFunction' });
  expect(observed.completed.result).toEqual(expected);
  expect(observed.recovered.result).toEqual(expected);
  expect(observed.counts['10']).toBe(1);
  expect(observed.counts['13']).toBe(1);
});


test('client AbortSignal preserves structured cancellation and independent recovery', async ({ page }) => {
  const long = input('fn run()->Int8=f12();fn f0()->Int8=1;' + Array.from({ length: 12 }, (_, n) => `fn f${n + 1}()->Int8={let ignored=f${n}();f${n}()};`).join(''));
  const small = input('fn run()->Int8=42;');
  const observed = await page.evaluate(async ({ long, small }) => {
    const { LanguageClient } = await import('/src/client.js');
    const client = new LanguageClient(() => {}, () => {});
    try {
      await client.request('initialize');
      const controller = new AbortController();
      const running = client.request('intersect/evaluateFunctionRcore', long, { signal: controller.signal });
      const independent = client.request('intersect/evaluateFunctionRcore', small);
      await client.request('intersect/parseRcore', { uri: 'memory:probe-behavior.rcore', text: 'rcore 1; package probe version "1";' });
      controller.abort();
      const cancelled = await running;
      const completed = await independent;
      const preaborted = new AbortController(); preaborted.abort();
      const cancelledAtEntry = await client.request('intersect/evaluateFunctionRcore', long, { signal: preaborted.signal });
      const late = new AbortController();
      const recovered = await client.request('intersect/evaluateFunctionRcore', small, { signal: late.signal });
      late.abort();
      return { cancelled, completed, cancelledAtEntry, recovered, pending: client.pending.size, disposed: client.disposed };
    } finally { client.dispose(); }
  }, { long, small });
  expect(observed.cancelled.failure.kind).toBe('Cancelled');
  expect(observed.cancelledAtEntry.failure.kind).toBe('Cancelled');
  const expected = native({ ...small, method: 'rcore_behavior/evaluateFunction' });
  expect(observed.completed).toEqual(expected);
  expect(observed.recovered).toEqual(expected);
  expect(observed.pending).toBe(0);
  expect(observed.disposed).toBe(false);
});


test('client watchdog requests cancellation before terminating an unresponsive transport', async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-08T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-08T12:00:01Z"));
  await page.evaluate(async () => {
    const { LanguageClient } = await import('/src/client.js');
    const RealWorker = window.Worker;
    class SilentWorker {
      messages = []; terminated = false;
      postMessage(message) { this.messages.push(message); }
      terminate() { this.terminated = true; }
    }
    window.Worker = SilentWorker;
    try {
      const client = new LanguageClient(() => {}, () => {});
      const outcome = client.request('intersect/evaluateFunctionRcore', {}).then(result => ({ result }), error => ({ error: error.message }));
      window.watchdogCase = { client, outcome };
    } finally { window.Worker = RealWorker; }
  });
  await page.clock.runFor(14999);
  expect(await page.evaluate(() => window.watchdogCase.client.worker.messages.length)).toBe(1);
  await page.clock.runFor(1);
  expect(await page.evaluate(() => ({ messages: window.watchdogCase.client.worker.messages, disposed: window.watchdogCase.client.disposed }))).toEqual({
    messages: [{ jsonrpc: '2.0', id: 1, method: 'intersect/evaluateFunctionRcore', params: {} }, { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } }], disposed: false,
  });
  await page.clock.runFor(4999);
  expect(await page.evaluate(() => window.watchdogCase.client.disposed)).toBe(false);
  await page.clock.runFor(1);
  expect(await page.evaluate(() => window.watchdogCase.outcome)).toEqual({ error: 'Worker did not respond to cancellation. Restart the runtime.' });
  expect(await page.evaluate(() => ({ terminated: window.watchdogCase.client.worker.terminated, pending: window.watchdogCase.client.pending.size }))).toEqual({ terminated: true, pending: 0 });
});


test('bounded direct mutual generic and captured recursion agree across hosts', async ({ page }) => {
  for (const [body, expected] of [
    ['fn run()->Int8=sum(5);fn sum(n:Int8)->Int8=if n==0 {0} else {n+sum(n-1)};',15],
    ['fn run()->Int8=even(6);fn even(n:Int8)->Int8=if n==0 {42} else {odd(n-1)};fn odd(n:Int8)->Int8=if n==0 {0} else {even(n-1)};',42],
    ['fn run()->Int8=keep::<Int8>(5,42);fn keep<T>(n:Int8,x:T)->T=if n==0 {x} else {keep::<T>(n-1,x)};',42],
    ['fn run()->Int8=make(5)(0);fn make(n:Int8)->(Int8)->Int8=|x:Int8|if n==0 {x} else {make(n-1)(x)+n};',15],
  ]) {
    const result = await parity(page,input(body));
    expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toBe(expected);
  }
  const failed = await parity(page,input('fn run()->Int8=fail(3);fn fail(n:Int8)->Int8=if n==0 {1/0} else {fail(n-1)};'));
  expect(failed.failure.kind).toBe('Arithmetic');
  expect(failed.failure.trace).toHaveLength(5);
});


test('recursive structural values retain exact wires and typed errors', async ({ page }) => {
  test.setTimeout(180000);
  for (const [annotation, expression] of [
    ['Int8?', 'Some::<Int8>(42)'], ['Int8?', 'None::<Int8>()'],
    ['Result<Int8,String>', 'Ok(42)'], ['Result<Int8,String>', 'Err("kept")'],
    ['(Int8,String)', '(42,"kept")'], ['{left:Int8,right:Sequence<Int8>}', '{left:40,right:[2,2]}'],
    ['Sequence<Int8>', '[1,1,2]'], ['Bag<Int8>', 'Bag::<Int8>([1,1,2])'],
    ['Set<Int8>', 'Set::<Int8>([1,1,2])'], ['OrderedSet<Decimal>', 'OrderedSet::<Decimal>([1.0,1.00,2.0])'],
  ]) {
    const params = input(`fn run(n:Int8)->${annotation} ={let value:${annotation} =${expression};bounce(n,value)};fn bounce<T>(n:Int8,x:T)->T=if n==0 {x} else {bounce::<T>(n-1,x)};`);
    delete params.arguments;
    const compiled = await parity(page,params,true); expect(compiled.ok).toBe(true);
    params.expected_program = compiled.program;
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const outcomes = [];
    for (const n of [0,4]) {
      params.arguments = [{ ty, data: { Scalar: { ty: { Scalar: 'Int8' }, payload: n } } }];
      const result = await parity(page,params); expect(result.ok).toBe(true);
      outcomes.push(result);
    }
    expect(outcomes[1].evaluation.value).toEqual(outcomes[0].evaluation.value);
    expect(outcomes[1].evaluation.consumed.steps).toBeGreaterThan(outcomes[0].evaluation.consumed.steps);
  }
  for (const body of [
    'fn run()->Result<Int8,String> =fail(4);fn fail(n:Int8)->Result<Int8,String> =if n==0 {Err("kept")} else {match fail(n-1){Ok(x)=>Ok(x),Err(e)=>Err(e)}};',
    'fn run()->Result<Int8,String> =a(4);fn a(n:Int8)->Result<Int8,String> =if n==0 {Err("kept")} else {b(n-1)};fn b(n:Int8)->Result<Int8,String> =a(n);',
    'fn run()->Result<Int8,String> =carry(4,Err::<Int8,String>("kept"));fn carry<T>(n:Int8,x:T)->T=if n==0 {x} else {carry::<T>(n-1,x)};',
    'fn run()->Result<Int8,String> =make(4)();fn make(n:Int8)->()->Result<Int8,String> =||if n==0 {Err("kept")} else {make(n-1)()};',
  ]) {
    const result = await parity(page,input(body));
    expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Err.data.Scalar.payload).toBe('kept');
  }
});

test('recursive Many values preserve all ordering and uniqueness contracts', async ({ page }) => {
  for (const ordered of [false,true]) for (const unique of [false,true]) for (const [lower,upper] of [[1,2],[0,-1]]) {
    const params = input('fn identity<T>(x:T)->T=bounce(3,x);fn bounce<T>(n:Int8,x:T)->T=if n==0 {x} else {bounce::<T>(n-1,x)};');
    delete params.arguments;
    params.selection.types = [{ Scalar: 'Int8' }, { Many: { element: 0, lower, upper, ordered, unique } }];
    params.selection.arguments = [1];
    const compiled = await parity(page,params,true); expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const element = compiled.program.types[ty].Many.element;
    const items = unique ? [2,1] : [2,2];
    const value = { ty, data: { Collection: items.map(payload => ({ ty: element, data: { Scalar: { ty: { Scalar: 'Int8' }, payload } } })) } };
    params.arguments = [value]; params.expected_program = compiled.program;
    const result = await parity(page,params); expect(result.ok).toBe(true);
    expect(result.evaluation.value).toEqual(value);
    const forged = structuredClone(value); forged.data.Collection[0].data.Scalar.payload = 128;
    const rejected = await parity(page,{ ...params,arguments:[forged] });
    expect(rejected.ok).toBe(false); expect(rejected.failure.kind).toBe('Arguments');
  }
});


test('mutual recursion across imported modules preserves source identities', async ({ page }) => {
  const source = (uri,text) => ({ id: { uri,sha256:createHash('sha256').update(text).digest('hex') },kind:'rcore_behavior',text,dependencies:[] });
  const a = source('memory:a-behavior.rcore','rcore 1;package a version "1";import package b version "1" as b;pub fn even(n:Int8)->Int8=if n==0 {42} else {b.odd(n-1)};');
  const b = source('memory:b-behavior.rcore','rcore 1;package b version "1";import package a version "1" as a;pub fn odd(n:Int8)->Int8=if n==0 {0} else {a.even(n-1)};');
  a.dependencies.push(b.id); b.dependencies.push(a.id);
  const params = { bundle:{version:1,sources:[a,b],namespaces:[]},entry:a.id,selection:{symbol:{source:a.id,declaration:1},types:[],arguments:[]} };
  const compiled = await parity(page,params,true); expect(compiled.ok).toBe(true);
  params.expected_program = compiled.program;
  const identities = compiled.program.functions.map(f => f.identity.Named?.symbol.source);
  expect(identities).toContainEqual(a.id); expect(identities).toContainEqual(b.id);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  for (const [n,expected] of [[6,42],[5,0]]) {
    params.arguments = [{ty,data:{Scalar:{ty:{Scalar:'Int8'},payload:n}}}];
    const result = await parity(page,params); expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toBe(expected);
    params.bundle.sources.reverse();
  }
});


test('imported generic recursion retains distinct phantom instances', async ({ page }) => {
  const source = (uri,text) => ({ id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind:'rcore_behavior',text,dependencies:[] });
  const a=source('memory:generic-a-behavior.rcore','rcore 1;package a version "1";import package b version "1" as b;pub fn bounce<T,U>(n:Int8,x:T)->T=if n==0 {x} else {b.back::<T,U>(n-1,x)};');
  const b=source('memory:generic-b-behavior.rcore','rcore 1;package b version "1";import package a version "1" as a;pub fn back<T,U>(n:Int8,x:T)->T=a.bounce::<T,U>(n,x);');
  const entry=source('memory:generic-entry-behavior.rcore','rcore 1;package entry version "1";import package a version "1" as a;fn run()->Int8=a.bounce::<Int8,Bool>(4,20)+a.bounce::<Int8,String>(4,22);');
  a.dependencies.push(b.id); b.dependencies.push(a.id); entry.dependencies.push(a.id);
  const params={bundle:{version:1,sources:[entry,a,b],namespaces:[]},entry:entry.id,selection:{symbol:{source:entry.id,declaration:1},types:[],arguments:[]},arguments:[]};
  const result=await parity(page,params); expect(result.ok).toBe(true);
  expect(result.evaluation.value.data.Scalar.payload).toBe(42);
  for (const source of [a,b]) {
    const instances=result.program.functions.filter(f=>f.identity.Named?.symbol.source.sha256===source.id.sha256).map(f=>f.identity.Named.type_arguments);
    expect(instances).toHaveLength(2);
    expect(instances[0][0]).toEqual(instances[1][0]);
    expect(instances[0][1]).not.toEqual(instances[1][1]);
  }
  params.bundle.sources.reverse(); params.expected_program=result.program;
  expect(await parity(page,params)).toEqual(result);
});


test('WASM retained byte admission is exact and recovers after cancellation', async ({ page }) => {
  const params=input('fn run()->String="é😀";');
  const expected=native({ ...params,method:'rcore_behavior/evaluateFunction' });
  expect(expected.ok).toBe(true);
  const observed=await page.evaluate(async ({params,program})=>{
    const { loadRuntime }=await import('/src/runtime.js');
    const encoder=new TextEncoder();
    const request={ ...params,method:'rcore_behavior/startFunction' };
    const size=value=>encoder.encode(JSON.stringify(value)).length;
    const bytes=size(request)+2*size(program)+size(program.policies);
    const below=await loadRuntime({retainedEncodedLimit:bytes-1});
    let belowRejected=false;
    try { below(request); } catch(error) { belowRejected=error.message.includes('Retained job byte budget'); }
    const exact=await loadRuntime({retainedEncodedLimit:bytes});
    const first=exact(request);
    let fullRejected=false;
    try { exact(request); } catch(error) { fullRejected=error.message.includes('Retained job byte budget'); }
    const cancelled=exact({method:'rcore_behavior/cancelFunction',job:first.job});
    const second=exact(request);
    const completed=exact({method:'rcore_behavior/resumeFunction',job:second.job,quantum:4096});
    const third=exact(request);
    const dropped=exact({method:'rcore_behavior/dropFunction',job:third.job});
    let ceilingRejected=false;
    try { await loadRuntime({retainedEncodedLimit:64*1024*1024+1}); } catch(error) { ceilingRejected=error.message.includes('host safety ceiling'); }
    return {belowRejected,fullRejected,cancelled,completed,dropped,ceilingRejected};
  },{params,program:expected.program});
  expect(observed.belowRejected).toBe(true);
  expect(observed.fullRejected).toBe(true);
  expect(observed.cancelled.result.failure.kind).toBe('Cancelled');
  expect(observed.completed.result).toEqual(expected);
  expect(observed.dropped.dropped).toBe(true);
  expect(observed.ceilingRejected).toBe(true);
});


test('diagnostic tree and resource traversal providers preserve native WASM values and failures', async ({ page }) => {
  const initial = await page.evaluate(() => window.workbench.inspect());
  const source = sourceFixture;
  for (const [kind, className, providerName] of [
    ['diagnostic', 'org.eclipse.emf.common.util.DiagnosticChain', 'ecore.diagnostic-chain'],
    ['tree', 'org.eclipse.emf.common.util.TreeIterator', 'ecore.definition-tree-iterator'],
    ['resources', 'org.eclipse.emf.ecore.resource.ResourceSet', 'ecore.definition-resource-set'],
  ]) {
    const children = Array.from({ length: 8 }, (_, i) => `<eClassifiers x:type="e:EClass" name="C${i}"/>`).join('');
    const model = source('memory:traversal.ecore', 'ecore', `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:traversal"><eClassifiers x:type="e:EDataType" name="Value" serializable="false" instanceClassName="${className}"/>${children}</e:EPackage>`);
    const members = Array.from({ length: 7 }, (_, i) => source(`memory:member${i}.ecore`, 'ecore', `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" name="m${i}" nsURI="urn:member${i}"/>`));
    const roots = [...members, model].map(s => ({ source: s.id, path: [] }));
    const entry = source('memory:traversal-behavior.rcore', 'rcore_behavior', 'rcore 1;package traversal version "1";import model "urn:traversal" as m;fn run(x:m.Value)->m.Value={let keep=|n:Int8|x;keep(0)};', [model, ...members].map(s => s.id));
    const contract = { datatype: fixtureDeclaration(model, [0]), provider: { name: providerName, version: '1' }, serializable: false, members: [], declarations: kind === 'tree' ? [fixtureDeclaration(model, [])] : kind === 'resources' ? roots : [] };
    const leaf = { severity: 'info', source: null, code: 1, message: null, data: [{ kind: 'scalar', datatype: 'EInt', value: 7 }], children: [] };
    const payload = kind === 'diagnostic' ? { diagnostics: Array.from({ length: 4 }, () => ({ ...leaf, children: Array.from({ length: 3 }, () => structuredClone(leaf)) })) } : kind === 'tree' ? { roots: contract.declarations, position: 6, pruned: [2, 3, 4] } : { resources: roots.map(r => r.source) };
    const params = { bundle: { version: 1, sources: [model, ...members, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, conversions: [contract] };
    const compiled = await parity(page, params, true);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    params.expected_program = compiled.program;
    const argument = { ty: compiled.program.functions[compiled.program.entry].parameters[0], data: { Datatype: { kind: 'converted', datatype: contract.datatype, provider: contract.provider, value: payload } } };
    const good = await parity(page, { ...params, arguments: [argument] });
    expect(good.ok, JSON.stringify(good)).toBe(true);
    expect(good.evaluation.value).toEqual(argument);
    expect(good.evaluation.consumed_providers).toEqual([contract.provider]);
    const bad = structuredClone(argument);
    if (kind === 'diagnostic') bad.data.Datatype.value.diagnostics[0].data[0].value = 'wrong';
    else if (kind === 'tree') bad.data.Datatype.value.position = 9999;
    else bad.data.Datatype.value.resources.push(structuredClone(bad.data.Datatype.value.resources[0]));
    const failed = await parity(page, { ...params, arguments: [bad] });
    expect(failed.ok).toBe(false);
    expect(failed.failure.kind).toBe('Nominal');
    expect(await parity(page, { ...params, arguments: [argument] })).toEqual(good);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

// Host clocks are measurement only; they never enter semantic policy or results.
test('preparation call-graph measurements retain cancellable authoritative jobs', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const measurements = [];
  for (const count of [32, 128, 512, 1024, 1025]) {
    const body = Array.from({ length: count }, (_, i) =>
      `fn f${i}()->Int8=${i + 1 === count ? '42' : `f${i + 1}()`};`).join('');
    const params = input(body);
    const measured = await page.evaluate(async params => {
      const { loadRuntime } = await import('/src/runtime.js');
      const invoke = await loadRuntime();
      const request = { ...params, method: 'rcore_behavior/startFunction' };
      const bytes = new TextEncoder().encode(JSON.stringify(request)).length;
      const started = performance.now();
      const prepared = invoke(request);
      const preparationMs = performance.now() - started;
      if (!prepared.pending) return { bytes, preparationMs, prepared };
      const cancelled = invoke({ method: 'rcore_behavior/cancelFunction', job: prepared.job });
      let staleRejected = false;
      try { invoke({ method: 'rcore_behavior/resumeFunction', job: prepared.job }); }
      catch { staleRejected = true; }
      return { bytes, preparationMs, pending: prepared.pending, cancelled, staleRejected };
    }, params);
    measurements.push({ functions: count, ...measured });
    // Persist partial evidence even if a larger case rejects or times out later.
    await testInfo.attach(`preparation-${count}`, {
      body: JSON.stringify(measurements.at(-1), null, 2), contentType: 'application/json',
    });
    if (count === 1025) {
      expect(measured.prepared.pending).toBe(false);
      expect(measured.prepared.result.stage).toBe('function_compile');
      expect(measured.prepared.result.ok).toBe(false);
      expect(JSON.stringify(measured.prepared.result.diagnostics)).toContain('Function instance limit exceeded');
      continue;
    }
    expect(measured.pending).toBe(true);
    expect(measured.cancelled.pending).toBe(false);
    expect(measured.cancelled.result.failure.kind).toBe('Cancelled');
    expect(measured.staleRejected).toBe(true);
  }
});

// Unreachable declarations still enter parsing/binding/type checking before IR admission.
test('preparation source-size measurements cover unreachable declarations and exact admission', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  for (const sourceBytes of [64000, 256000, 256001]) {
    let body = 'fn run()->Int8=42;';
    let declarations = 1;
    const prefix = 'rcore 1; package functions version "1"; ';
    while (true) {
      const next = `fn unused${declarations}()->Int8=42;`;
      if (prefix.length + body.length + next.length > sourceBytes) break;
      body += next;
      declarations += 1;
    }
    body += ' '.repeat(sourceBytes - prefix.length - body.length);
    const params = input(body);
    expect(Buffer.byteLength(params.bundle.sources[0].text)).toBe(sourceBytes);
    const measured = await page.evaluate(async params => {
      const { loadRuntime } = await import('/src/runtime.js');
      const invoke = await loadRuntime();
      const started = performance.now();
      const prepared = invoke({ ...params, method: 'rcore_behavior/startFunction' });
      const preparationMs = performance.now() - started;
      if (!prepared.pending) return { preparationMs, prepared };
      const cancelled = invoke({ method: 'rcore_behavior/cancelFunction', job: prepared.job });
      return { preparationMs, pending: true, cancelled };
    }, params);
    await testInfo.attach(`source-preparation-${sourceBytes}`, {
      body: JSON.stringify({ sourceBytes, declarations, ...measured }, null, 2),
      contentType: 'application/json',
    });
    if (sourceBytes > 256000) {
      expect(measured.prepared).toEqual({ pending: false, result: {
        stage: 'function_compile', ok: false, source_backed: true,
        diagnostics: [{ message: 'Definition size budget exceeded' }],
      } });
    } else {
      expect(measured.pending).toBe(true);
      expect(measured.cancelled.result.failure.kind).toBe('Cancelled');
    }
  }
});

test('preparation generic-instance measurements preserve phantom specialization limits', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const types = ['Bool', 'String', 'Bytes', 'Char16', 'Int8', 'Int16', 'Int32', 'Int64',
    'UInt8', 'UInt16', 'UInt32', 'UInt64', 'BigInt', 'Decimal', 'Float32', 'Float64'];
  for (const instances of [32, 256, 1023, 1024]) {
    const calls = Array.from({ length: instances }, (_, i) =>
      `let v${i}=keep::<${types[i % 16]},${types[Math.floor(i / 16) % 16]},${types[Math.floor(i / 256)]}>(42);`).join('');
    const params = input(`fn run()->Int8={${calls}42};fn keep<T,U,V>(x:Int8)->Int8=x;`);
    const measured = await page.evaluate(async params => {
      const { loadRuntime } = await import('/src/runtime.js');
      const invoke = await loadRuntime();
      const started = performance.now();
      const prepared = invoke({ ...params, method: 'rcore_behavior/startFunction' });
      const preparationMs = performance.now() - started;
      if (!prepared.pending) return { preparationMs, prepared };
      const cancelled = invoke({ method: 'rcore_behavior/cancelFunction', job: prepared.job });
      return { preparationMs, pending: true, cancelled };
    }, params);
    await testInfo.attach(`generic-preparation-${instances}`, {
      body: JSON.stringify({ instances, sourceBytes: Buffer.byteLength(params.bundle.sources[0].text), ...measured }, null, 2),
      contentType: 'application/json',
    });
    if (instances === 1024) {
      expect(measured.prepared.pending).toBe(false);
      expect(measured.prepared.result.stage).toBe('function_compile');
      expect(JSON.stringify(measured.prepared.result.diagnostics)).toContain('Function instance limit exceeded');
    } else {
      expect(measured.pending).toBe(true);
      expect(measured.cancelled.result.failure.kind).toBe('Cancelled');
      // Phantom type arguments remain distinct, plus the entry function.
      expect(measured.cancelled.result.program.functions).toHaveLength(instances + 1);
    }
  }
});

test('preparation catalog measurements cover the provider selection ceiling', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const datatypes = Array.from({ length: 129 }, (_, i) =>
    `<eClassifiers x:type="e:EDataType" name="Resource${i}" serializable="false" instanceClassName="org.eclipse.emf.ecore.resource.Resource"/>`).join('');
  const classes = Array.from({ length: 1000 }, (_, i) => `<eClassifiers x:type="e:EClass" name="C${i}"/>`).join('');
  const text = `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:catalog">${datatypes}${classes}</e:EPackage>`;
  const catalog = sourceFixture('memory:catalog.ecore','ecore',text);
  const id = catalog.id;
  for (const providers of [1, 32, 128, 129]) {
    const params = input('fn run()->Int8=42;');
    params.bundle.sources.push(catalog);
    params.bundle.sources[0].dependencies.push(id);
    params.conversions = Array.from({ length: providers }, (_, i) => ({
      datatype: fixtureDeclaration(catalog, [i]), provider: { name: 'ecore.definition-resource', version: '1' },
      serializable: false, members: [], declarations: [fixtureDeclaration(catalog, [])],
    }));
    const measured = await page.evaluate(async params => {
      const { loadRuntime } = await import('/src/runtime.js');
      const invoke = await loadRuntime();
      const started = performance.now();
      let prepared;
      try { prepared = invoke({ ...params, method: 'rcore_behavior/startFunction' }); }
      catch (error) { return { preparationMs: performance.now() - started, hostError: error.message }; }
      const preparationMs = performance.now() - started;
      if (!prepared.pending) return { preparationMs, prepared };
      const cancelled = invoke({ method: 'rcore_behavior/cancelFunction', job: prepared.job });
      return { preparationMs, pending: true, cancelled };
    }, params);
    await testInfo.attach(`catalog-preparation-${providers}`, {
      body: JSON.stringify({ providers, modelBytes: Buffer.byteLength(text), ...measured }, null, 2),
      contentType: 'application/json',
    });
    if (providers === 129) {
      expect(measured.hostError).toBe('Conversion provider selection budget exceeded');
    } else {
      expect(measured.pending, JSON.stringify(measured)).toBe(true);
      expect(measured.cancelled.result.failure.kind).toBe('Cancelled');
    }
  }
});

test('coordinator accepts cancellation and authoring before execution worker preparation', async ({ page, context }) => {
  // Gate only outbound start messages in the test transport. The actual nested
  // worker, WASM compiler, job store and cancellation implementation still run.
  await context.route('**/src/language.worker.js', async route => {
    const response = await route.fetch();
    const harness = `
      const OriginalWorker = Worker;
      const heldStarts = [];
      let released = false;
      self.Worker = class extends OriginalWorker {
        postMessage(data) {
          if (!released && data.request?.method === 'rcore_behavior/startFunction') {
            heldStarts.push(() => super.postMessage(data));
            self.postMessage({ id: 'test-gate', result: true });
          } else super.postMessage(data);
        }
      };
      self.addEventListener('message', ({data}) => {
        if (data.method === '__testReleasePreparation') {
          released = true;
          for (const send of heldStarts.splice(0)) send();
        }
      });
    `;
    await route.fulfill({ response, body: harness + await response.text() });
  });
  const small = input('fn run()->Int8=42;');
  const invalid = input('fn run()->Int8=missing();');
  try {
    await page.evaluate(async ({ small, invalid }) => {
      const worker = new Worker('/src/language.worker.js', { type: 'module' });
      const pending = new Map();
      const counts = {};
      worker.onmessage = ({ data }) => {
        if (data.id === undefined) return;
        counts[data.id] = (counts[data.id] || 0) + 1;
        const resolve = pending.get(data.id);
        if (resolve) { pending.delete(data.id); resolve(data); }
      };
      const request = (id, method, params = {}) => new Promise(resolve => {
        pending.set(id, resolve);
        worker.postMessage({ jsonrpc: '2.0', id, method, params });
      });
      await request('init', 'initialize');
      const gated = new Promise(resolve => pending.set('test-gate', resolve));
      const jobs = [small, invalid, small, small].map((params, i) => request(i + 1, 'intersect/evaluateFunctionRcore', params));
      window.preparationControl = { worker, request, jobs, counts, pending, gated };
    }, { small, invalid });
    await page.evaluate(() => window.preparationControl.gated);
    const during = await page.evaluate(async small => {
      const { request, pending } = window.preparationControl;
      const probe = await request('probe', 'intersect/parseRcore', { uri: 'memory:probe-behavior.rcore', text: 'rcore 1;package probe version "1";' });
      await request('cancel-one', '$/cancelRequest', { id: 1 });
      await request('cancel-invalid', '$/cancelRequest', { id: 2 });
      const fifth = await request(5, 'intersect/evaluateFunctionRcore', small);
      return { probe, fifth, retained: [1, 2, 3, 4].every(id => pending.has(id)) };
    }, small);
    expect(during.probe.result.ok).toBe(true);
    expect(during.retained).toBe(true);
    expect(during.fifth.error.message).toBe('Active function job budget exceeded (4)');
    await page.evaluate(() => window.preparationControl.worker.postMessage({ method: '__testReleasePreparation' }));
    const after = await page.evaluate(async small => {
      const state = window.preparationControl;
      const results = await Promise.all(state.jobs);
      const recovery = await state.request(6, 'intersect/evaluateFunctionRcore', small);
      return { results, recovery, counts: state.counts, pending: state.pending.size };
    }, small);
    expect(after.results[0].result.failure.kind).toBe('Cancelled');
    expect(after.results[0].result.failure.consumed.steps).toBe(0);
    expect(after.results[1].result.stage).toBe('function_compile');
    expect(after.results[1].result.ok).toBe(false);
    for (const result of [...after.results.slice(2), after.recovery]) {
      expect(result.result.evaluation.value.data.Scalar.payload).toBe(42);
    }
    for (const id of [1, 2, 3, 4, 5, 6]) expect(after.counts[id]).toBe(1);
    expect(after.pending).toBe(0);
  } finally {
    await page.evaluate(() => window.preparationControl?.worker.terminate());
  }
});

for (const failureMode of ['error', 'messageerror', 'initialization']) test(`execution worker transport failure ${failureMode} releases all jobs and ignores stale generation events`, async ({ page, context }) => {
  await context.route('**/src/language.worker.js', async route => {
    const response = await route.fetch();
    const harness = `
      const OriginalWorker = Worker;
      const executionWorkers = [];
      const tokens = [];
      let oldMessage, oldError;
      self.Worker = class extends OriginalWorker {
        constructor(...args) { super(...args); executionWorkers.push(this); }
        postMessage(data) {
          if (this === executionWorkers[0]) { tokens.push(data.token); return; }
          // Replay an old generation's callbacks while the replacement is active.
          oldMessage?.({data: {token: data.token, response: {pending: false, result: {poison: true}}}});
          oldError?.(new ErrorEvent('error', {message: 'stale failure', cancelable: true}));
          super.postMessage(data);
        }
      };
      self.addEventListener('message', ({data}) => {
        if (data.method === '__testCrashExecution') {
          const failed = executionWorkers[0];
          oldMessage = failed.onmessage;
          oldError = failed.onerror;
          if ('${failureMode}' === 'error') failed.dispatchEvent(new ErrorEvent('error', {message: 'injected transport crash', cancelable: true}));
          else if ('${failureMode}' === 'messageerror') failed.dispatchEvent(new MessageEvent('messageerror'));
          else failed.onmessage({data: {token: tokens[0], error: 'injected initialization failure', fatal: true}});
          self.postMessage({id: 'crash-receipt', result: {held: tokens.length}});
        }
      });
    `;
    await route.fulfill({ response, body: harness + await response.text() });
  });
  const params = input('fn run()->Int8=42;');
  const observed = await page.evaluate(async params => {
    const worker = new Worker('/src/language.worker.js', { type: 'module' });
    const pending = new Map();
    const counts = {};
    worker.onmessage = ({ data }) => {
      if (data.id === undefined) return;
      counts[data.id] = (counts[data.id] || 0) + 1;
      const resolve = pending.get(data.id);
      if (resolve) { pending.delete(data.id); resolve(data); }
    };
    const request = (id, method, params = {}) => new Promise(resolve => {
      pending.set(id, resolve);
      worker.postMessage({ id, method, params });
    });
    try {
      await request('init', 'initialize');
      const before = await request('before', 'intersect/inspect');
      const jobs = [1, 2, 3, 4].map(id => request(id, 'intersect/evaluateFunctionRcore', params));
      // Queue barrier proves all four starts were admitted before failure delivery.
      await request('cancel', '$/cancelRequest', { id: 1 });
      const receipt = new Promise(resolve => pending.set('crash-receipt', resolve));
      worker.postMessage({ method: '__testCrashExecution' });
      const crash = await receipt;
      const failed = await Promise.all(jobs);
      const parser = await request('parse', 'intersect/parseRcore', { uri: 'memory:p-behavior.rcore', text: 'rcore 1;package p version "1";' });
      const recovered = await request(5, 'intersect/evaluateFunctionRcore', params);
      const after = await request('after', 'intersect/inspect');
      return { crash, failed, parser, recovered, before, after, counts, pending: pending.size };
    } finally { worker.terminate(); }
  }, params);
  expect(observed.crash.result.held).toBe(4);
  for (const failed of observed.failed) {
    expect(failed.result).toBeUndefined();
    const cause = failureMode === 'error' ? 'injected transport crash' : failureMode === 'messageerror' ? 'Unable to deserialize execution worker response' : 'injected initialization failure';
    expect(failed.error.message).toBe(`Function execution transport failed: ${cause}`);
  }
  expect(observed.parser.result.ok).toBe(true);
  expect(observed.recovered.result).toEqual(native({ ...params, method: 'rcore_behavior/evaluateFunction' }));
  expect(observed.after.result).toEqual(observed.before.result);
  for (const id of [1, 2, 3, 4, 5]) expect(observed.counts[id]).toBe(1);
  expect(observed.pending).toBe(0);
});

test('execution worker reports runtime initialization rejection as a fatal transport response', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('../src/function.worker.js', import.meta.url), 'utf8');
  // Exercise the actual worker queue with only its runtime dependency replaced.
  const body = source.replace("import { loadRuntime } from './runtime.js';", '');
  expect(body).not.toBe(source);
  let reply;
  const response = new Promise(resolve => { reply = resolve; });
  const self = { postMessage: reply };
  runInNewContext(body, { self, loadRuntime: async () => { throw new Error('WASM initialization rejected'); } });
  self.onmessage({ data: { token: 17, request: { method: 'rcore_behavior/startFunction' } } });
  expect(await response).toEqual({ token: 17, error: 'WASM initialization rejected', fatal: true });
});

test('uncalled provider signatures stay required while arithmetic branches remain lazy', async ({ page }) => {
  const source = sourceFixture;
  const model = source('memory:lazy-policy.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:lazy-policy"><eClassifiers x:type="e:EDataType" name="RGB" instanceClassName="example.RGB"/></e:EPackage>');
  const entry = source('memory:lazy-policy-behavior.rcore', 'rcore_behavior', 'rcore 1;package lazy_policy version "1";import model "urn:lazy-policy" as m;fn run()->Int8={let unused=helper;if false {fail()} else {42}};fn helper(x:m.RGB)->m.RGB=x;fn fail()->Int8=1/0;', [model.id]);
  const rgb = { datatype: fixtureDeclaration(model, [0]), provider: { name: 'example.rgb', version: '1' }, serializable: true, declarations: [], members: [] };
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, arguments: [] };
  const before = await page.evaluate(() => window.workbench.inspect());
  const missing = await parity(page, params);
  expect(missing.ok).toBe(false);
  expect(missing.stage).toBe('function_compile');
  expect(missing.diagnostics.some(d => /conversion|provider/i.test(d.message))).toBe(true);
  const complete = await parity(page, { ...params, conversions: [rgb] });
  expect(complete.ok, JSON.stringify(complete)).toBe(true);
  expect(complete.evaluation.value.data.Scalar.payload).toBe(42);
  expect(complete.evaluation.selected_providers).toEqual([rgb.provider]);
  expect(complete.evaluation.consumed_providers).toEqual([]);
  expect(complete.evaluation.consumed.provider_invocations).toBe(0);
  expect(complete.program.functions).toHaveLength(3);
  expect(await parity(page, { ...params, conversions: [rgb], expected_program: complete.program })).toEqual(complete);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(before);
});

test('saved images cannot import cancellation or effect authority through native or WASM hosts', async ({ page }) => {
  const params = input('fn run()->Int8=42;');
  const accepted = await parity(page, params);
  const before = await page.evaluate(() => window.workbench.inspect());
  for (const level of ['program', 'function', 'instruction']) {
    const expected_program = structuredClone(accepted.program);
    if (level === 'program') expected_program.cancelled = false;
    else if (level === 'function') expected_program.functions[0].effects = ['HostIo'];
    else expected_program.functions[0].blocks[0].instructions[0].cancellation_token = 'forged';
    const forged = { ...params, expected_program };
    await expect(page.evaluate(params => window.workbench.request('intersect/evaluateFunctionRcore', params), forged)).rejects.toThrow('Invalid expected_program');
    expect(() => native({ ...forged, method: 'rcore_behavior/evaluateFunction' })).toThrow('Invalid expected_program');
  }
  expect(await parity(page, { ...params, expected_program: accepted.program })).toEqual(accepted);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(before);
});

test('decimal numeric bounds inside calls agree at zero under exact and over limits', async ({ page }) => {
  const params = input('fn run()->Decimal=add(1.0,0.001);fn add(a:Decimal,b:Decimal)->Decimal=a+b;');
  const baseline = await parity(page, params);
  expect(baseline.evaluation.value.data.Scalar.payload).toEqual({ kind: 'decimal', coefficient: '1001', scale: 3 });
  const defaults = {
      scalar: { max_steps: 100000, max_value_bytes: 4194304, values: { max_value_bytes: 262144, max_digits: 4096 }, numeric: { max_digits: 4096, max_intermediate_digits: 8192, max_scale_alignment: 4096, max_value_bytes: 262144, max_total_value_bytes: 1048576, max_work: 16777216 } },
      max_frames: 256, max_closures: 65536, max_captures: 65536, max_value_nodes: 65536,
      max_value_depth: 64, max_collection_comparisons: 1048576, max_trace_frames: 256,
      max_trace_bytes: 65536, max_model_contexts: 8, max_reference_domains: 128,
      max_context_bytes: 16777216, max_model_elements: 100000, max_membership_checks: 1048576,
      max_provider_evidence_bytes: 65536, max_provider_invocations: 1048576,
      max_provider_work: 1048576,
    };
  const bytes = Buffer.byteLength(JSON.stringify(baseline.evaluation.value.data.Scalar));
  for (const [field, needed] of [
    ['max_scale_alignment', 2], ['max_intermediate_digits', 5], ['max_digits', 4],
    ['max_value_bytes', bytes], ['max_total_value_bytes', bytes],
    ['max_work', baseline.evaluation.consumed.numeric_work],
  ]) {
    for (const ceiling of [0, needed - 1, needed, needed + 1]) {
      const execution_limits = structuredClone(defaults);
      execution_limits.scalar.numeric[field] = ceiling;
      const result = await parity(page, { ...params, execution_limits });
      if (ceiling >= needed) expect(result).toEqual(baseline);
      else {
        expect(result.failure.kind, `${field}=${ceiling}`).toBe('ResourceExhausted');
        expect(result.failure.consumed.steps).toBeGreaterThan(0);
        expect(result.failure.trace).toHaveLength(2);
      }
    }
    expect(await parity(page, params)).toEqual(baseline);
  }
});

test('bounded bigint backend work has measured single-unit host slices and exact results', async ({ page }, testInfo) => {
  const params = input('fn run(a:BigInt,b:BigInt)->BigInt=multiply(a,b);fn multiply(a:BigInt,b:BigInt)->BigInt=a*b;');
  delete params.arguments;
  const compiled = await parity(page, params, true);
  expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  for (const digits of [512, 2048, 2049]) {
    const value = '9'.repeat(digits);
    const argument = { ty, data: { Scalar: { ty: { Scalar: 'BigInt' }, payload: { kind: 'bigint', value } } } };
    const request = { ...params, expected_program: compiled.program, arguments: [argument, argument] };
    const measured = await page.evaluate(async request => {
      const { loadRuntime } = await import('/src/runtime.js');
      const invoke = await loadRuntime();
      const prepared = invoke({ ...request, method: 'rcore_behavior/startFunction' });
      if (!prepared.pending) throw new Error(JSON.stringify(prepared));
      const slices = [];
      let response;
      do {
        const started = performance.now();
        response = invoke({ method: 'rcore_behavior/resumeFunction', job: prepared.job, quantum: 1 });
        slices.push(performance.now() - started);
      } while (response.pending);
      return { result: response.result, slices };
    }, request);
    expect(measured.result).toEqual(native({ ...request, method: 'rcore_behavior/evaluateFunction' }));
    if (digits <= 2048) {
      expect(measured.result.ok).toBe(true);
      expect(measured.result.evaluation.value.data.Scalar.payload.value).toBe((BigInt(value) * BigInt(value)).toString());
    } else {
      expect(measured.result.failure.kind).toBe('ResourceExhausted');
      expect(measured.result.failure.message).toContain('digit limit');
    }
    await testInfo.attach(`bigint-slices-${digits}`, {
      body: JSON.stringify({ digits, ok: measured.result.ok, slices: measured.slices, maxSliceMs: Math.max(...measured.slices) }, null, 2),
      contentType: 'application/json',
    });
  }
  expect((await parity(page, input('fn run()->Int8=42;'))).evaluation.value.data.Scalar.payload).toBe(42);
});


for (const [fixture, body] of [
  ['closures', 'fn run()->Int8=make(3)();fn make(n:Int8)->()->Int8=||if n==0 {42} else {make(n-1)()};'],
  ['typed-error', 'fn run()->Result<Int8,String> =carry(3,Err::<Int8,String>("kept"));fn carry<T>(n:Int8,x:T)->T=if n==0 {x} else {carry::<T>(n-1,x)};'],
  ['arithmetic', 'fn run()->Int8=fail(3);fn fail(n:Int8)->Int8=if n==0 {1/0} else {fail(n-1)};'],
  ['reference-context', 'fn run()->Int8=42;'],
  ['callback-captures', 'fn run()->Int8={let a:Int8=1;let b:Int8=2;fold([1,2],0,|acc:Int8,x:Int8|acc+x+a+b)};'],
  ['entry-parameters', 'fn run(a:Int8,b:Int8,c:Int8)->Int8=a+b+c;'],
]) test('every resumable cancellation boundary has identical native WASM transcripts: '+fixture, async ({ page }, testInfo) => {
  test.setTimeout(300000);
  const params = input(body);
  if (fixture === 'entry-parameters') {
    const request = {...params}; delete request.arguments;
    const compiled = await parity(page, request, true);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    params.arguments = compiled.program.functions[compiled.program.entry].parameters.map(
      (ty,n) => ({ty,data:{Scalar:{ty:{Scalar:'Int8'},payload:n+13}}}));
  }
  if (fixture === 'reference-context') {
    const bundle = lateContextBundle(params);
    params.reference_contexts = [{
      bundle, entry: bundle.sources[0].id, namespace: 'urn:p11',
      conversions: [], materialized_types: [], applied_conversions: [], constructors: [],
      model: { rows: Array.from({ length: 4 }, (_, n) => ({ n, text: 'kept' })), empty: [] },
    }];
  }
  const transcript = await page.evaluate(async params => {
    const { loadRuntime } = await import('/src/runtime.js');
    const invoke = await loadRuntime();
    const requests = [], responses = [];
    const send = request => {
      requests.push(request);
      const response = invoke(request);
      responses.push(response);
      return response;
    };
    const start = () => send({ ...params, method: 'rcore_behavior/startFunction' });
    const first = start();
    const namespace = first.job.slice(0, first.job.lastIndexOf(':'));
    const resume = (job, quantum) => send({ method: 'rcore_behavior/resumeFunction', job, quantum });
    let baseline = first, units = 0;
    while (baseline.pending) {
      baseline = resume(first.job, 1);
      if (++units > 600) throw new Error('Fixture exceeded boundary inventory');
    }
    const cancellations = [];
    for (let stop = 0; stop < units; stop++) {
      const outcomes = [];
      for (const quantum of [1, 3, 4096]) {
        const job = start();
        let advanced = 0;
        while (advanced < stop) {
          const slice = Math.min(quantum, stop - advanced);
          if (!resume(job.job, slice).pending) throw new Error('Completed before measured boundary');
          advanced += slice;
        }
        outcomes.push(send({ method: 'rcore_behavior/cancelFunction', job: job.job }));
      }
      cancellations.push(outcomes);
    }
    const recoveries = [];
    for (const quantum of [1, 3, 4096]) {
      let result = start();
      const job = result.job;
      let slices = 0;
      while (result.pending) {
        result = resume(job, quantum);
        if (++slices > 600) throw new Error('Recovery did not terminate');
      }
      recoveries.push(result);
    }
    // Replay host commands in an independent native host with this test's
    // namespace. No serialized execution state is imported by either host.
    return { requests: [{ method: 'rcore_behavior/jobHost', namespace }, ...requests], responses,
      baseline, units, cancellations, recoveries };
  }, params);
  const nativeResponses = nativeJobs(transcript.requests);
  expect(nativeResponses.slice(1)).toEqual(transcript.responses);
  expect(transcript.units).toBeGreaterThan(10);
  for (const outcomes of transcript.cancellations) {
    expect(outcomes[0].pending).toBe(false);
    expect(outcomes[0].result.failure.kind).toBe('Cancelled');
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
  }
  for (const recovered of transcript.recoveries) expect(recovered).toEqual(transcript.baseline);
  expect(transcript.baseline.result).toEqual(native({ ...params, method: 'rcore_behavior/evaluateFunction' }));
  const failures = transcript.cancellations.map(outcomes => outcomes[0].result.failure);
  expect(failures.some(failure => failure.consumed.steps === 0)).toBe(true);
  expect(failures.some(failure => failure.consumed.steps > 0)).toBe(true);
  if (body.includes('1/0')) expect(transcript.baseline.result.failure.kind).toBe('Arithmetic');
  else {
    expect(transcript.baseline.result.ok).toBe(true);
    const value = transcript.baseline.result.evaluation.value.data;
    if (body.includes('Result<')) expect(value.Err.data.Scalar.payload).toBe('kept');
    else expect(value.Scalar.payload).toBe(body.includes('fold(') ? 9 : 42);
    expect(failures.some(failure => failure.consumed.steps === transcript.baseline.result.evaluation.consumed.steps)).toBe(true);
  }
  await testInfo.attach(`boundaries-${body.includes('1/0') ? 'arithmetic' : body.includes('Result<') ? 'typed-error' : params.reference_contexts ? 'reference-context' : body.includes('fold(') ? 'callback-captures' : 'closures'}`, {
    body: JSON.stringify({ units: transcript.units, cancellationRuns: transcript.cancellations.length * 3, requests: transcript.requests.length }),
    contentType: 'application/json',
  });
});


test('large reference-domain construction keeps authoring and cancellation responsive', async ({ page, context }) => {
  test.setTimeout(180000);
  const source = sourceFixture;
  const features = Array.from({ length: 4 }, (_, i) => `<eStructuralFeatures x:type="e:EReference" name="r${i}"><eGenericType eTypeParameter="#//Root/T"/></eStructuralFeatures>`).join('');
  // Keep the canonical snapshot below the portable storage ceiling while
  // retaining enough domain construction work to observe a busy first slice.
  const children = Array.from({ length: 63 }, (_, i) => `<eClassifiers x:type="e:EClass" name="C${i}" eSuperTypes="#//Root"/>`).join('');
  const model = source('memory:job-expansion.ecore', 'ecore', `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:job-expansion"><eClassifiers x:type="e:EClass" name="Root"><eTypeParameters name="T"><eBounds eClassifier="#//Root"/></eTypeParameters>${features}</eClassifiers>${children}</e:EPackage>`);
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const types = Array.from({ length: 64 }, (_, i) => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [i]), arguments: [], raw: i === 0 }));
  const modeled = await page.evaluate(async request => {
    const { loadRuntime } = await import('/src/runtime.js');
    return (await loadRuntime())(request);
  }, { method: 'ecore/materialize', bundle, entry: model.id, namespace: 'urn:job-expansion', types, instances: [{ id: 'child', type: types[1] }] });
  expect(modeled.ok).toBe(true);
  const reference = { bundle, entry: model.id, namespace: 'urn:job-expansion', conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  const entry = source('memory:job-expansion-behavior.rcore', 'rcore_behavior', 'rcore 1;package expansion version "1";import model "urn:job-expansion" as m;fn run(value:m.C0)->m.C0=if spin(12)>0 {value} else {value};fn spin(n:Int8)->Int32=if n==0 {1} else {spin(n-1)+spin(n-1)};', [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
  const compiled = await parity(page, params, true);
  expect(compiled.ok).toBe(true);
  params.arguments = [{ ty: compiled.program.functions[compiled.program.entry].parameters[0], data: { Model: { kind: 'model_reference', context: digest, element: 'child' } } }];
  params.reference_contexts = [reference];
  await context.route('**/src/language.worker.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `
      const OriginalWorker = Worker;
      self.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({data}) => {
            if (data.token === this.firstResume) self.postMessage({id:'slice-returned',result:true});
          });
        }
        postMessage(data) {
          super.postMessage(data);
          if (data.request?.method === 'rcore_behavior/resumeFunction' && this.firstResume === undefined) {
            this.firstResume = data.token;
            self.postMessage({id:'slice-dispatched',result:true});
          }
        }
      };
    ` + await response.text() });
  });
  try {
    const observed = await page.evaluate(async ({ params, small }) => {
      const worker = new Worker('/src/language.worker.js', { type: 'module' });
      const pending = new Map(), counts = {};
      let returned = false;
      worker.onmessage = ({data}) => {
        if (data.id === 'slice-returned') returned = true;
        counts[data.id] = (counts[data.id] || 0) + 1;
        const resolve = pending.get(data.id);
        if (resolve) { pending.delete(data.id); resolve(data); }
      };
      const request = (id, method, params = {}) => new Promise(resolve => {
        pending.set(id, resolve);
        worker.postMessage({jsonrpc:'2.0',id,method,params});
      });
      try {
        await request('init','initialize');
        const dispatched = new Promise(resolve => pending.set('slice-dispatched',resolve));
        const job = request('large','intersect/evaluateFunctionRcore',params);
        await dispatched;
        const probe = await request('probe','intersect/parseRcore',{uri:'memory:probe-behavior.rcore',text:'rcore 1;package probe version "1";'});
        const busyAtProbe = !returned;
        await request('cancel','$/cancelRequest',{id:'large'});
        const cancelled = await job;
        const recovery = await request('recovery','intersect/evaluateFunctionRcore', small);
        return { probe, busyAtProbe, cancelled, recovery, count: counts.large };
      } finally { worker.terminate(); }
    }, { params, small: input('fn run()->Int8=42;') });
    expect(observed.probe.result.ok).toBe(true);
    expect(observed.busyAtProbe).toBe(true);
    expect(observed.cancelled.result.failure.kind, JSON.stringify(observed.cancelled.result.failure)).toBe('Cancelled');
    // The first q256 slice yields before a reference domain is published.
    // Keep this original responsive cancellation boundary and qualify installed
    // domain cancellation separately in reference-domain-pending.spec.js.
    const prefixPlan = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/rcore-reference-domain-pending/worker-plan.json', import.meta.url), 'utf8'));
    expect(params).toEqual(prefixPlan.requests.params);
    expect(observed.cancelled.result).toEqual(prefixPlan.points[0].cancel_result);
    expect(observed.cancelled.result.failure.consumed.reference_domains).toBe(0);
    expect(observed.cancelled.result.failure.consumed.model_elements).toBe(1);
    expect(observed.count).toBe(1);
    expect(observed.recovery.result.ok).toBe(true);
    expect(observed.recovery.result.evaluation.value.data.Scalar.payload).toBe(42);
  } finally { await context.unroute('**/src/language.worker.js'); }
});


test('nonterminating lambda reentry exhausts shared frames and recovers', async ({ page }) => {
  const params = input('fn run()->Int8=make()();fn make()->()->Int8=||make()();');
  params.execution_limits = {
    scalar: { max_steps: 100000, max_value_bytes: 4194304, values: { max_value_bytes: 262144, max_digits: 4096 }, numeric: { max_digits: 4096, max_intermediate_digits: 8192, max_scale_alignment: 4096, max_value_bytes: 262144, max_total_value_bytes: 1048576, max_work: 16777216 } },
    max_frames: 12, max_closures: 65536, max_captures: 65536, max_value_nodes: 65536,
    max_value_depth: 64, max_collection_comparisons: 1048576, max_trace_frames: 256,
    max_trace_bytes: 65536, max_model_contexts: 8, max_reference_domains: 128,
    max_context_bytes: 16777216, max_model_elements: 100000, max_membership_checks: 1048576,
    max_provider_evidence_bytes: 65536, max_provider_invocations: 1048576, max_provider_work: 1048576,
  };
  const failure = await parity(page, params);
  expect(failure.ok).toBe(false);
  expect(failure.failure.kind).toBe('ResourceExhausted');
  expect(failure.failure.message).toBe('Function frame depth limit exceeded');
  expect(failure.failure.trace).toHaveLength(12);
  expect(failure.failure.trace.some(frame => frame.function.Lambda !== undefined)).toBe(true);
  expect(failure.failure.consumed.steps).toBeGreaterThan(0);
  expect(failure.failure.consumed.closures).toBeGreaterThan(1);
  const recovered = await parity(page, input('fn run()->Int8=42;'));
  expect(recovered.ok).toBe(true);
  expect(recovered.evaluation.value.data.Scalar.payload).toBe(42);
});


test('collection measures preserve occurrence counts empty identities and captures across hosts', async ({ page }) => {
  test.setTimeout(180000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [kind, count] of [['Sequence', '3'], ['Bag', '3'], ['Set', '2'], ['OrderedSet', '2']]) {
    const params = input(`fn run()->Int={let xs=${kind}([1,1,2]);let f=|unused:Bool|size(xs);f(isEmpty(${kind}::<Int>([])))};`);
    const result = await parity(page, params);
    expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toEqual({ kind: 'int64', value: count });
    expect(await parity(page, { ...params, expected_program: result.program })).toEqual(result);
    const empty = await parity(page, input(`fn run()->Bool=isEmpty(${kind}::<Int>([]));`));
    expect(empty.evaluation.value.data.Scalar.payload).toBe(true);
  }
  for (const body of ['fn run()->Int=size(true);', 'fn run()->Int8=size([1]);', 'fn run()->Int=size::<Int>([1]);']) {
    expect((await parity(page, input(body))).ok).toBe(false);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('collection measures retain generic Many bounds and reject malformed arguments across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const [ordered, unique, kind] of [[false, false, 'Bag'], [false, true, 'Set'], [true, false, 'Sequence'], [true, true, 'OrderedSet']]) {
    const params = input(`fn run<T:${kind}<Int>>(xs:T)->Int=size(xs);`);
    delete params.arguments;
    params.selection.types = [{ Scalar: 'Int64' }, { Many: { element: 0, lower: 1, upper: 2, ordered, unique } }];
    params.selection.arguments = [1];
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const element = compiled.program.types[ty].Many.element;
    const value = n => ({ ty: element, data: { Scalar: { ty: { Scalar: 'Int64' }, payload: { kind: 'int64', value: String(n) } } } });
    params.arguments = [{ ty, data: { Collection: [value(1), value(2)] } }];
    const result = await parity(page, params); expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toEqual({ kind: 'int64', value: '2' });
    params.arguments[0].data.Collection = [];
    expect((await parity(page, params)).ok).toBe(false);
    params.arguments[0].data.Collection = [value(1), value(1)];
    expect((await parity(page, params)).ok).toBe(!unique);
  }
});


test('collection callbacks preserve types values receipts and replay across hosts', async ({ page }) => {
  test.setTimeout(180000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const body of [
    'fn run()->Sequence<Int> =flatMap([1,2],|x:Int|map([10,20],|y:Int|x+y));',
    'fn run()->Bag<Int> =map(Set([1,2]),|x:Int|0);',
    'fn run()->OrderedSet<Int> =filter(OrderedSet([1,2,1,3]),|x:Int|x!=2);',
    'fn run()->Sequence<Int> =map([3,4],fact);fn fact(x:Int)->Int=if x==0 {1} else {x*fact(x-1)};',
    'fn run()->Sequence<Int> =map([1,2],keep);fn keep<T>(x:T)->T=x;',
    'fn run()->Int=fold([1,2,3],0,|a:Int,x:Int|a*10+x);',
    'fn run()->Bool=exists([1,0],|x:Int|10/x==10);',
    'fn run()->Bool=forAll([2,0],|x:Int|10/x==10);',
    'fn run()->Bool=one([1,1,0],|x:Int|10/x==10);',
    'fn run()->Option<Int> =find([2,1,0],|x:Int|10/x==10);',
  ]) {
    const params = input(body);
    const result = await parity(page, params);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await parity(page, { ...params, expected_program: result.program })).toEqual(result);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('collection callbacks reject bad signatures and retain callback failure provenance across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const body of [
    'fn run()->Sequence<Int> =map([1],|x:Bool|1);',
    'fn run()->Sequence<Int> =filter([1],|x:Int|1);',
    'fn run()->Sequence<Int> =flatMap([1],|x:Int|1);',
    'fn run()->Option<Int> =find(Set([1]),|x:Int|true);',
  ]) expect((await parity(page, input(body))).ok).toBe(false);
  const result = await parity(page, input('fn run()->Sequence<Int> =map([1,0],|x:Int|10/x);'));
  expect(result.ok).toBe(false);
  expect(result.failure.kind).toBe('Arithmetic');
  expect(result.failure.trace.length).toBeGreaterThanOrEqual(2);
  const recovered = await parity(page, input('fn run()->Int=fold([1,2],0,|a:Int,x:Int|a+x);'));
  expect(recovered.ok).toBe(true);
  expect(recovered.evaluation.value.data.Scalar.payload).toEqual({kind:'int64',value:'3'});
});


test('collection callback contexts type empty inputs without confusing transformed element types', async ({ page }) => {
  test.setTimeout(180000);
  for (const body of [
    'fn run()->Sequence<Bool> =map([],|x:Int|true);',
    'fn run()->Bag<Bool> =map(Set([]),|x:Int|true);',
    'fn run()->Sequence<Int8> =map([],keep);fn keep<T>(x:T)->T=x;',
    'fn run()->Sequence<Bool> =map([None],|x:Option<Int>|x==None::<Int>());',
    'fn run()->Int=fold([],7,|a:Int,x:Bool|a);',
  ]) {
    const params = input(body); const result = await parity(page, params);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await parity(page, {...params, expected_program: result.program})).toEqual(result);
  }
  for (const body of [
    'fn run()->Sequence<Int> =map([],|x:Int|true);',
    'fn run()->Bool=isEmpty(map([],keep));fn keep<T>(x:T)->T=x;',
    'fn run()->Sequence<Int8> =map([300],|x:Int8|x);',
    'fn run()->Sequence<Bool> =map([],keep);fn keep<T:Int>(x:T)->T=x;',
  ]) expect((await parity(page, input(body))).ok).toBe(false);
});


test('collection callback Many transformations shed bounds and retain input validation across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const [ordered, unique, kind] of [[false,false,'Bag'],[false,true,'Set'],[true,false,'Sequence'],[true,true,'OrderedSet']]) {
    const mapped = ordered ? 'Sequence' : 'Bag';
    for (const [resultKind, operation, count] of [[mapped,'map(xs,|x:Int|0)',2],[kind,'filter(xs,|x:Int|false)',0],[mapped,'flatMap(xs,|x:Int|[x,x])',4]]) {
      const params = input(`fn run<T:${kind}<Int>>(xs:T)->${resultKind}<Int> =${operation};`); delete params.arguments;
      params.selection.types = [{Scalar:'Int64'},{Many:{element:0,lower:1,upper:2,ordered,unique}}]; params.selection.arguments = [1];
      const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
      const ty = compiled.program.functions[compiled.program.entry].parameters[0]; const element = compiled.program.types[ty].Many.element;
      const value = n => ({ty:element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}});
      params.arguments = [{ty,data:{Collection:[value(1),value(2)]}}];
      const result = await parity(page, params); expect(result.ok).toBe(true);
      expect(result.evaluation.value.data.Collection).toHaveLength(count);
      expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe(resultKind);
      params.arguments[0].data.Collection = []; expect((await parity(page, params)).ok).toBe(false);
      params.arguments[0].data.Collection = [value(1),value(1)]; expect((await parity(page, params)).ok).toBe(!unique);
    }
  }
});

test('collection callback imports retain generic instantiation and exact failure source identity', async ({ page }) => {
  test.setTimeout(180000);
  const source = (uri, text, dependencies = []) => ({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},text,kind:'rcore_behavior',dependencies});
  for (const fail of [false,true]) {
    const helper = source('memory:callback-helper-behavior.rcore', `rcore 1;package helper version "1";pub fn convertValue${fail ? '(x:Int)->Int=10/x;' : '<T>(x:T)->T=x;'}`);
    const entry = source('memory:callback-entry-behavior.rcore','rcore 1;package caller version "1";import package helper version "1" as h;fn run()->Sequence<Int> =map([1,0],h.convertValue);',[helper.id]);
    const params = {bundle:{version:1,sources:[entry,helper],namespaces:[]},entry:entry.id,selection:{symbol:{source:entry.id,declaration:1},types:[],arguments:[]},arguments:[]};
    const result = await parity(page, params); expect(result.ok).toBe(!fail);
    if (fail) {
      expect(result.failure.kind).toBe('Arithmetic');
      expect(result.failure.trace[0].definition.source).toEqual(helper.id);
      expect(result.failure.trace[0].call_site.source).toEqual(entry.id);
    }
    params.bundle.sources.reverse(); params.expected_program = result.program;
    expect(await parity(page, params)).toEqual(result);
  }
});


test('collection flatten and selection preserve kind contracts order and optional values across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const outer of ['Sequence','OrderedSet','Set','Bag']) {
    for (const inner of ['Sequence','OrderedSet','Set','Bag']) {
      const kind = ['Sequence','OrderedSet'].includes(outer) && ['Sequence','OrderedSet'].includes(inner) ? 'Sequence' : 'Bag';
      const params = input(`fn run()->${kind}<Int> =flatten(${outer}([${inner}([1,2]),${inner}([2,3])]));`);
      const result = await parity(page, params); expect(result.ok).toBe(true);
      expect(result.evaluation.value.data.Collection.map(v => v.data.Scalar.payload.value)).toEqual(['1','2','2','3']);
      expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe(kind);
    }
  }
  for (const body of [
    'fn run()->Option<Int> =first([3,2,1]);',
    'fn run()->Option<Int> =last(Sequence::<Int>([]));',
    'fn run()->Option<Int> =at([3,2,1],-1);',
    'fn run()->Option<Int> =at([3,2,1],1);',
    'fn run()->Option<Int> =at([3,2,1],if true {1} else {0});',
    'fn run()->Option<Int> =at([3,2,1],9223372036854775807);',
    'fn run()->Option<Option<Int>> ={let xs:Sequence<Option<Int>> =[None,Some(2)];first(xs)};',
    'fn run()->Int=match last(flatten([[|x:Int|x+1],[|x:Int|x+2]])) {Some(f)=>f(3),None=>0};',
  ]) {
    const params = input(body); const result = await parity(page, params); expect(result.ok).toBe(true);
    expect(await parity(page, {...params,expected_program:result.program})).toEqual(result);
  }
  for (const body of [
    'fn run()->Sequence<Int> =flatten([1]);',
    'fn run()->Sequence<Int> =flatten([Set([1])]);',
    'fn run()->Option<Int> =first(Set([1]));',
    'fn run()->Option<Int> =last(Bag([1]));',
    'fn run()->Option<Int> =at([1],true);',
    'fn run()->Option<Int> =first::<Int>([1]);',
  ]) expect((await parity(page,input(body))).ok).toBe(false);
});

test('collection flatten validates nested Many inputs and sheds bounds across hosts', async ({ page }) => {
  test.setTimeout(180000);
  const kinds = [[false,false,'Bag'],[false,true,'Set'],[true,false,'Sequence'],[true,true,'OrderedSet']];
  for (const [outerOrdered,outerUnique,outer] of kinds) for (const [innerOrdered,innerUnique,inner] of kinds) {
    const kind = outerOrdered && innerOrdered ? 'Sequence' : 'Bag';
    const params = input(`fn run<T:${outer}<${inner}<Int>>>(xs:T)->${kind}<Int> =flatten(xs);`); delete params.arguments;
    params.selection.types = [{Scalar:'Int64'},{Many:{element:0,lower:1,upper:2,ordered:innerOrdered,unique:innerUnique}},{Many:{element:1,lower:1,upper:2,ordered:outerOrdered,unique:outerUnique}}];params.selection.arguments=[2];
    const compiled = await parity(page,params,true); expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const innerTy = compiled.program.types[ty].Many.element; const element = compiled.program.types[innerTy].Many.element;
    const innerValue = ns => ({ty:innerTy,data:{Collection:ns.map(n=>({ty:element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}}))}});
    params.arguments = [{ty,data:{Collection:[innerValue([1,2]),innerValue([2,3])]}}];
    const result = await parity(page,params);expect(result.ok).toBe(true);expect(result.evaluation.value.data.Collection).toHaveLength(4);
    expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe(kind);
    params.arguments[0].data.Collection = [innerValue([])];expect((await parity(page,params)).ok).toBe(false);
  }
});


test('collection membership preserves occurrence semantics nested equivalence and replay across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const [kind,count] of [['Sequence',2],['Bag',2],['Set',1],['OrderedSet',1]]) {
    for (const expression of [`count(xs,1)==${count}`,'contains(xs,1)','excludes(xs,3)','includesAll(xs,Bag([1,1,1,2]))','includesAny(xs,Set([3,2]))','includesAll(xs,[])','!includesAny(xs,[])']) {
      const result = await parity(page,input(`fn run()->Bool={let xs=${kind}([1,1,2]);${expression}};`));
      expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);
    }
  }
  for (const body of [
    'fn run()->Bool=contains([Bag([1,2,1])],Bag([2,1,1]));',
    'fn run()->Bool=excludes([Bag([1,1,2])],Bag([1,2,2]));',
    'fn run()->Bool=contains([Some((1,true)),None::<(Int,Bool)>()],None);',
    'fn run()->Bool={let f=|x:Int|x;contains([f],f)};',
    'fn run()->Bool=contains([1,2],if true {2} else {3});',
  ]) {
    const params = input(body);const result = await parity(page,params);expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
  for (const body of ['fn run()->Bool=contains([1],true);','fn run()->Bool=includesAll([1],2);','fn run()->Bool=contains::<Int>([1],1);','fn run()->Int8=count([1],1);']) expect((await parity(page,input(body))).ok).toBe(false);
});

test('collection membership retains Many validation and IEEE total equivalence across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const [ordered,unique,kind] of [[false,false,'Bag'],[false,true,'Set'],[true,false,'Sequence'],[true,true,'OrderedSet']]) {
    const params = input(`fn run<T:${kind}<Int>>(xs:T)->Int=count(xs,1);`);delete params.arguments;
    params.selection.types=[{Scalar:'Int64'},{Many:{element:0,lower:1,upper:2,ordered,unique}}];params.selection.arguments=[1];
    const compiled = await parity(page,params,true);expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];const element = compiled.program.types[ty].Many.element;
    const value = n=>({ty:element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}});
    params.arguments=[{ty,data:{Collection:[value(1),value(2)]}}];
    const result = await parity(page,params);expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload.value).toBe('1');
    params.arguments[0].data.Collection=[];expect((await parity(page,params)).ok).toBe(false);
    params.arguments[0].data.Collection=[value(1),value(1)];expect((await parity(page,params)).ok).toBe(!unique);
  }
  const params = input('fn run(a:Float64,b:Float64)->Bool=contains([a],b);');delete params.arguments;
  const compiled = await parity(page,params,true);expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  for (const [a,b,expected] of [['7ff8000000000001','7ff8000000000002',true],['0000000000000000','8000000000000000',true],['7ff8000000000001','0000000000000000',false]]) {
    params.arguments=[a,b].map(bits=>({ty,data:{Scalar:{ty:{Scalar:'Float64'},payload:{kind:'float64',bits}}}}));
    const result = await parity(page,params);expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(expected);
  }
});

test('collection membership keeps same-number enum aliases distinct across hosts', async ({ page }) => {
  test.setTimeout(180000);
  const source = (uri,text,kind,dependencies=[])=>sourceFixture(uri,kind,text,dependencies);
  const model = source('memory:membership.ecore',`<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="enums" nsURI="urn:membership-enum"><eClassifiers x:type="e:EEnum" name="Mode"><eLiterals name="First" value="7"/><eLiterals name="Alias" value="7"/></eClassifiers></e:EPackage>`,'ecore');
  for (const expression of ['contains([m.Mode.First],m.Mode.First)','excludes([m.Mode.First],m.Mode.Alias)','count([m.Mode.First,m.Mode.Alias,m.Mode.First],m.Mode.First)==2']) {
    const entry = source('memory:membership-behavior.rcore',`rcore 1;package membership version "1";import model "urn:membership-enum" as m;fn run()->Bool=${expression};`,'rcore_behavior',[model.id]);
    const params={bundle:{version:1,sources:[model,entry],namespaces:[]},entry:entry.id,selection:{symbol:{source:entry.id,declaration:1},types:[],arguments:[]},arguments:[]};
    const result = await parity(page,params);expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);
  }
});


test('collection algebra preserves occurrence arithmetic stable order and concrete kinds across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const kind of ['Sequence','Bag','Set','OrderedSet']) {
    const unique=['Set','OrderedSet'].includes(kind);
    for (const [operation,expected] of [['union',unique?[3,1,2,4]:[3,1,1,2,1,1,4]],['intersection',unique?[1]:[1,1]],['difference',[3,2]]]) {
      const params=input(`fn run()->${kind}<Int> =${operation}(${kind}([3,1,1,2]),${kind}([1,1,4]));`);
      const result=await parity(page,params);expect(result.ok).toBe(true);
      expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual(expected.map(String));
      expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
    }
    const resultKind=['Sequence','OrderedSet'].includes(kind)?'OrderedSet':'Set';
    const result=await parity(page,input(`fn run()->${resultKind}<Int> =distinct(${kind}([3,1,1,2]));`));
    expect(result.ok).toBe(true);expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual(['3','1','2']);
    expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe(resultKind);
  }
  for (const left of ['Sequence','OrderedSet']) for (const right of ['Sequence','OrderedSet']) {
    const result=await parity(page,input(`fn run()->Sequence<Int> =concat(${left}([1,2]),${right}([2,3]));`));
    expect(result.ok).toBe(true);expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual(['1','2','2','3']);
  }
  for (const body of ['fn run()->Sequence<Int> =union([1],Set([2]));','fn run()->Sequence<Int> =concat(Bag([1]),[2]);','fn run()->OrderedSet<Int> =distinct(Bag([1]));','fn run()->Sequence<Int> =difference([1],[true]);']) expect((await parity(page,input(body))).ok).toBe(false);
});

test('collection algebra retains earliest Decimal representatives and structural values across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const [operation,scales] of [['difference',[1]],['intersection',[1,2]]]) {
    const result=await parity(page,input(`fn run()->Sequence<Decimal> =${operation}([1.0,1.00,1.000],[1.0000,1.00000]);`));
    expect(result.ok).toBe(true);expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.scale)).toEqual(scales);
  }
  for (const body of [
    'fn run()->Bool=size(distinct([Bag([1,2]),Bag([2,1])]))==1;',
    'fn run()->Bool=first(intersection([None::<Int>(),Some(1)],[Some(1)]))==Some(Some(1));',
    'fn run()->Bool={let f=|x:Int|x;size(distinct([f,f]))==1};',
    'fn run()->Bool=size(union([1],if true {[2]} else {[3]}))==2;',
    'fn run()->Bool=isEmpty(difference([1,1],[1,1]));',
  ]) {const result=await parity(page,input(body));expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);}
});

test('collection algebra keeps Many input validation and sheds output bounds across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const [ordered,unique,kind] of [[false,false,'Bag'],[false,true,'Set'],[true,false,'Sequence'],[true,true,'OrderedSet']]) {
    for (const [operation,resultKind,count] of [[`union(xs,${kind}([1]))`,kind,unique?2:3],[`intersection(xs,${kind}([1]))`,kind,1],[`difference(xs,${kind}([1]))`,kind,1],['distinct(xs)',ordered?'OrderedSet':'Set',2]]) {
      const params=input(`fn run<T:${kind}<Int>>(xs:T)->${resultKind}<Int> =${operation};`);delete params.arguments;
      params.selection.types=[{Scalar:'Int64'},{Many:{element:0,lower:1,upper:2,ordered,unique}}];params.selection.arguments=[1];
      const compiled=await parity(page,params,true);expect(compiled.ok).toBe(true);
      const ty=compiled.program.functions[compiled.program.entry].parameters[0];const element=compiled.program.types[ty].Many.element;
      const value=n=>({ty:element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}});
      params.arguments=[{ty,data:{Collection:[value(1),value(2)]}}];const result=await parity(page,params);expect(result.ok).toBe(true);
      expect(result.evaluation.value.data.Collection).toHaveLength(count);expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe(resultKind);
      params.arguments[0].data.Collection=[];expect((await parity(page,params)).ok).toBe(false);
      params.arguments[0].data.Collection=[value(1),value(1)];expect((await parity(page,params)).ok).toBe(!unique);
    }
  }
});


test('collection algebra joins independently typed model operands across hosts', async ({ page }) => {
  test.setTimeout(180000);
  const source=(uri,text,kind,dependencies=[])=>sourceFixture(uri,kind,text,dependencies);
  const model=source('memory:algebra-model.ecore',`<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="objects" nsURI="urn:algebra-model"><eClassifiers x:type="e:EClass" name="Base"/><eClassifiers x:type="e:EClass" name="Child" eSuperTypes="#//Base"/></e:EPackage>`,'ecore');
  for (const body of [
    'fn run(xs:Sequence<m.Child>)->Sequence<m.Base> =union(xs,Sequence::<m.Base>([]));',
    'fn run(xs:Sequence<m.Child>,base:m.Base)->Sequence<m.Base> =union(xs,[base]);',
    'fn run(xs:Sequence<m.Child>,base:m.Base)->Sequence<m.Base> =union(xs,Sequence([base]));',
  ]) {
    const entry=source('memory:algebra-model-behavior.rcore',`rcore 1;package algebra_model version "1";import model "urn:algebra-model" as m;${body}`,'rcore_behavior',[model.id]);
    const params={bundle:{version:1,sources:[model,entry],namespaces:[]},entry:entry.id,selection:{symbol:{source:entry.id,declaration:1},types:[],arguments:[]}};
    const compiled=await parity(page,params,true);expect(compiled.ok,JSON.stringify(compiled)).toBe(true);
    const parameters=compiled.program.functions[compiled.program.entry].parameters;
    if (parameters.length===1) {
      params.arguments=[{ty:parameters[0],data:{Collection:[]}}];
      const result=await parity(page,params);expect(result.ok).toBe(true);expect(result.evaluation.value.data.Collection).toEqual([]);
    }
  }
});


test('collection grouping preserves key representatives and member kinds across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const kind of ['Sequence','Bag','Set','OrderedSet']) {
    const ordered=['Sequence','OrderedSet'].includes(kind);
    const unique=['Set','OrderedSet'].includes(kind);
    const outer=ordered?'Sequence':'Bag';
    const params=input(`fn run()->${outer}<(Int,${kind}<Int>)> =groupBy(${kind}([3,1,2,3,4]),|x:Int|x%2);`);
    const result=await parity(page,params);expect(result.ok,JSON.stringify(result)).toBe(true);
    expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe(outer);
    const groups=result.evaluation.value.data.Collection;
    expect(groups.map(g=>g.data.Tuple[0].data.Scalar.payload.value)).toEqual(['1','0']);
    expect(groups.map(g=>g.data.Tuple[1].data.Collection.map(v=>v.data.Scalar.payload.value))).toEqual([unique?['3','1']:['3','1','3'],['2','4']]);
    for (const group of groups) expect(result.program.types[group.data.Tuple[1].ty].Collection.kind).toBe(kind);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
    const empty=await parity(page,input(`fn run()->${outer}<(Int,${kind}<Int>)> =groupBy(${kind}::<Int>([]),|x:Int|1/0);`));
    expect(empty.ok).toBe(true);expect(empty.evaluation.value.data.Collection).toEqual([]);
  }
  for (const body of [
    'fn run()->Bool=size(groupBy([1,2],|x:Int|if x==1 {Bag([1,2])} else {Bag([2,1])}))==1;',
    'fn run()->Bool={let f=|x:Int|x;size(groupBy([1,2],|x:Int|f))==1};',
    'fn run()->Bool=size(groupBy([1,2],|x:Int|(|y:Int|x+y)))==2;',
  ]) { const result=await parity(page,input(body));expect(result.ok,JSON.stringify(result)).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true); }
  for (const body of [
    'fn run()->Sequence<(Int,Sequence<Int>)> =groupBy([1],|x:Bool|1);',
    'fn run()->Sequence<(Int,Set<Int>)> =groupBy([1],|x:Int|x);',
    'fn run()->Sequence<(Int,Sequence<Int>)> =groupBy([1,0],|x:Int|10/x);',
  ]) expect((await parity(page,input(body))).ok).toBe(false);
});


test('collection grouping sheds Many bounds and retains IEEE first keys across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const [ordered,unique,kind] of [[false,false,'Bag'],[false,true,'Set'],[true,false,'Sequence'],[true,true,'OrderedSet']]) {
    const outer=ordered?'Sequence':'Bag';
    const params=input(`fn run<T:${kind}<Int>>(xs:T)->${outer}<(Int,${kind}<Int>)> =groupBy(xs,|x:Int|x);`);delete params.arguments;
    params.selection.types=[{Scalar:'Int64'},{Many:{element:0,lower:2,upper:3,ordered,unique}}];params.selection.arguments=[1];
    const compiled=await parity(page,params,true);expect(compiled.ok).toBe(true);
    const ty=compiled.program.functions[compiled.program.entry].parameters[0];const element=compiled.program.types[ty].Many.element;
    const value=n=>({ty:element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}});
    params.arguments=[{ty,data:{Collection:[value(1),value(2)]}}];
    const result=await parity(page,params);expect(result.ok).toBe(true);
    const groups=result.evaluation.value.data.Collection;expect(groups).toHaveLength(2);
    for (const group of groups) { const members=group.data.Tuple[1];expect(members.data.Collection).toHaveLength(1);expect(result.program.types[members.ty].Collection.kind).toBe(kind); }
    for (const numbers of [[],[1],[1,2,3,4]]) {params.arguments[0].data.Collection=numbers.map(value);expect((await parity(page,params)).ok).toBe(false);}
    params.arguments[0].data.Collection=[value(1),value(1)];expect((await parity(page,params)).ok).toBe(!unique);
  }
  const params=input('fn run(xs:Sequence<Float64>)->Sequence<(Float64,Sequence<Float64>)> =groupBy(xs,|x:Float64|x);');delete params.arguments;
  const compiled=await parity(page,params,true);expect(compiled.ok).toBe(true);
  const ty=compiled.program.functions[compiled.program.entry].parameters[0];const element=compiled.program.types[ty].Collection.element;
  const bits=['7ff8000000000001','7ff8000000000002','8000000000000000','0000000000000000'];
  params.arguments=[{ty,data:{Collection:bits.map(bits=>({ty:element,data:{Scalar:{ty:{Scalar:'Float64'},payload:{kind:'float64',bits}}}}))}}];
  const result=await parity(page,params);expect(result.ok).toBe(true);
  const groups=result.evaluation.value.data.Collection;
  expect(groups.map(g=>g.data.Tuple[0].data.Scalar.payload.bits)).toEqual([bits[0],bits[2]]);
  expect(groups.map(g=>g.data.Tuple[1].data.Collection.map(v=>v.data.Scalar.payload.bits))).toEqual([bits.slice(0,2),bits.slice(2)]);
});


test('collection comparator sorting preserves stable values and shared callbacks across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const kind of ['Sequence','Bag','Set','OrderedSet']) {
    const params=input(`fn run()->Sequence<Int> =sortedWith(${kind}([3,1,2,1]),|a:Int,b:Int|a-b);`);
    const result=await parity(page,params);expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual(['Set','OrderedSet'].includes(kind)?['1','2','3']:['1','1','2','3']);
    expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe('Sequence');
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
  const stable=await parity(page,input('fn run()->Sequence<(Int,Int)> =sortedWith([(2,10),(1,20),(2,30),(1,40)],|a:(Int,Int),b:(Int,Int)|a[0]-b[0]);'));
  expect(stable.ok).toBe(true);expect(stable.evaluation.value.data.Collection.map(v=>v.data.Tuple[1].data.Scalar.payload.value)).toEqual(['20','40','10','30']);
  for (const body of [
    'fn run()->Bool=isEmpty(sortedWith([],|a:Int,b:Int|1/0));',
    'fn run()->Bool=first(sortedWith([7],|a:Int,b:Int|1/0))==Some(7);',
    'fn run()->Bool=size(sortedWith([4,3,2,1],|a:Int,b:Int|1))==4;',
    'fn run()->Bool={let direction= -1;first(sortedWith([1,3,2],|a:Int,b:Int|direction*(a-b)))==Some(3)};',
    'fn run()->Bool=first(sortedWith([3,1,2],|a:Int,b:Int|size(sortedWith([a,b],|x:Int,y:Int|x-y))*(a-b)))==Some(1);',
  ]) {const result=await parity(page,input(body));expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);}
  for (const body of [
    'fn run()->Sequence<Int> =sortedWith([1,2],|a:Int,b:Int|true);',
    'fn run()->Set<Int> =sortedWith([1,2],|a:Int,b:Int|a-b);',
    'fn run()->Sequence<Int> =sortedWith([1,2],|a:Int,b:Int|1/0);',
  ]) expect((await parity(page,input(body))).ok).toBe(false);
});


test('collection comparator sorting validates Many inputs and returns concrete sequences', async ({ page }) => {
  test.setTimeout(180000);
  for (const [ordered,unique,kind] of [[false,false,'Bag'],[false,true,'Set'],[true,false,'Sequence'],[true,true,'OrderedSet']]) {
    const params=input(`fn run<T:${kind}<Int>>(xs:T)->Sequence<Int> =sortedWith(xs,|a:Int,b:Int|a-b);`);delete params.arguments;
    params.selection.types=[{Scalar:'Int64'},{Many:{element:0,lower:2,upper:3,ordered,unique}}];params.selection.arguments=[1];
    const compiled=await parity(page,params,true);expect(compiled.ok).toBe(true);
    const ty=compiled.program.functions[compiled.program.entry].parameters[0];const element=compiled.program.types[ty].Many.element;
    const value=n=>({ty:element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}});
    params.arguments=[{ty,data:{Collection:[value(2),value(1)]}}];
    const result=await parity(page,params);expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual(['1','2']);
    expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe('Sequence');
    for (const numbers of [[],[1],[1,2,3,4]]) {params.arguments[0].data.Collection=numbers.map(value);expect((await parity(page,params)).ok).toBe(false);}
    params.arguments[0].data.Collection=[value(1),value(1)];expect((await parity(page,params)).ok).toBe(!unique);
  }
});

test('collection key sorting validates Many inputs and returns concrete sequences', async ({ page }) => {
  test.setTimeout(180000);
  for (const [ordered,unique,kind] of [[false,false,'Bag'],[false,true,'Set'],[true,false,'Sequence'],[true,true,'OrderedSet']]) {
    const params=input(`fn run<T:${kind}<Int>>(xs:T)->Sequence<Int> =sortedBy(xs,|x:Int|x);`);delete params.arguments;
    params.selection.types=[{Scalar:'Int64'},{Many:{element:0,lower:2,upper:3,ordered,unique}}];params.selection.arguments=[1];
    const compiled=await parity(page,params,true);expect(compiled.ok).toBe(true);
    const ty=compiled.program.functions[compiled.program.entry].parameters[0];const element=compiled.program.types[ty].Many.element;
    const value=n=>({ty:element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}});
    params.arguments=[{ty,data:{Collection:[value(2),value(1)]}}];
    const result=await parity(page,params);expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual(['1','2']);
    expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe('Sequence');
    for (const numbers of [[],[1],[1,2,3,4]]) {params.arguments[0].data.Collection=numbers.map(value);expect((await parity(page,params)).ok).toBe(false);}
    params.arguments[0].data.Collection=[value(1),value(1)];expect((await parity(page,params)).ok).toBe(!unique);
  }
});


test('collection key sorting preserves scalar orders and callback behavior across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const kind of ['Sequence','Bag','Set','OrderedSet']) {
    const result=await parity(page,input(`fn run()->Sequence<Int> =sortedBy(${kind}([3,1,2,1]),|x:Int|x);`));expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual(['Set','OrderedSet'].includes(kind)?['1','2','3']:['1','1','2','3']);
  }
  for (const body of [
    'fn run()->Bool=isEmpty(sortedBy([],|x:Int|1/0));',
    'fn run()->Bool=first(sortedBy([3,1,2],key))==Some(1);fn key<T:Int>(x:T)->T=x;',
    'fn run()->Bool={let n= -1;first(sortedBy([1,3,2],|x:Int|n*x))==Some(3)};',
  ]) {const result=await parity(page,input(body));expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);}
  const cases=[
    ['Bool',[true,false,true],[1,0,2]],
    ['String',['z','','é','a','aa'],[1,3,4,0,2]],
    ['Bytes',[{kind:'bytes',hex:'FF'},{kind:'bytes',hex:'00FF'},{kind:'bytes',hex:'00'}],[2,1,0]],
    ['Char16',[{kind:'char16',unit:65535},{kind:'char16',unit:0},{kind:'char16',unit:55296}],[1,2,0]],
    ['DateInstant',['9223372036854775807','-9223372036854775808','0'].map(milliseconds=>({kind:'date',milliseconds})),[1,2,0]],
    ['Unit',[{kind:'unit'},{kind:'unit'}],[0,1]],
    ['Int64',['9223372036854775807','-9223372036854775808'].map(value=>({kind:'int64',value})),[1,0]],
    ['UInt64',['18446744073709551615','0'].map(value=>({kind:'uint64',value})),[1,0]],
    ['BigInt',['123456789012345678901234567890','-123456789012345678901234567890'].map(value=>({kind:'bigint',value})),[1,0]],
    ['Decimal',[{kind:'decimal',coefficient:'10',scale:1},{kind:'decimal',coefficient:'-1',scale:-2147483648},{kind:'decimal',coefficient:'100',scale:2}],[1,0,2]],
  ];
  for (const scalar of ['Int8','Int16','Int32']) cases.push([scalar,[3,-2,0],[1,2,0]]);
  for (const scalar of ['UInt8','UInt16','UInt32']) cases.push([scalar,[3,2,0],[2,1,0]]);
  for (const [scalar,kind,bits] of [
    ['Float32','float32',['7fc00001','00000000','80000000','7f800000','ff800000','7fc00002']],
    ['Float64','float64',['7ff8000000000001','0000000000000000','8000000000000000','7ff0000000000000','fff0000000000000','7ff8000000000002']],
  ]) cases.push([scalar,bits.map(bits=>({kind,bits})),[4,1,2,3,0,5]]);
  for (const [scalar,payloads,order] of cases) {
    const params=input(`fn run(xs:Sequence<${scalar}>)->Sequence<${scalar}> =sortedBy(xs,|x:${scalar}|x);`);delete params.arguments;
    const compiled=await parity(page,params,true);expect(compiled.ok).toBe(true);
    const ty=compiled.program.functions[compiled.program.entry].parameters[0];const element=compiled.program.types[ty].Collection.element;
    const values=payloads.map(payload=>({ty:element,data:{Scalar:{ty:{Scalar:scalar},payload}}}));
    params.arguments=[{ty,data:{Collection:values}}];
    const result=await parity(page,params);expect(result.ok,JSON.stringify(result)).toBe(true);
    expect(result.evaluation.value.data.Collection).toEqual(order.map(i=>values[i]));
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
  for (const body of ['fn run()->Sequence<Int> =sortedBy([1],|x:Int|Some(x));','fn run()->Sequence<Int> =sortedBy([1],|x:Int|1/0);']) expect((await parity(page,input(body))).ok).toBe(false);
});


test('collection comprehensions preserve dependent lexical scope and every kind pair across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const outer of ['Sequence','Bag','Set','OrderedSet']) for (const inner of ['Sequence','Bag','Set','OrderedSet']) {
    const ordered=['Sequence','OrderedSet'].includes(outer)&&['Sequence','OrderedSet'].includes(inner);
    const kind=ordered?'Sequence':'Bag';
    const params=input(`fn run()->${kind}<Int> =[for x in ${outer}([1,2]), y in ${inner}([3,4]) where x+y>0 yield x+y];`);
    const result=await parity(page,params);expect(result.ok,JSON.stringify(result)).toBe(true);
    expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe(kind);
    expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual(['4','5','5','6']);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
  for (const body of [
    'fn run()->Bool={let x=[1,2];first([for x in x yield x+1])==Some(2)};',
    'fn run()->Bool=first([for x in [1], x in [x+1] yield x])==Some(2);',
    'fn run()->Bool=first([for x in map([1],|a|a+1) yield x])==Some(2);',
    'fn run()->Bool=isEmpty([for x in Sequence::<Int>([]), y in [1/0] where 1/0==0 yield x+y]);',
    'fn run()->Bool=isEmpty([for x in [1] where false yield 1/0]);',
    'fn run()->Bool=first([for x in [1] yield x])==Some(1);fn map(x:Int)->Int=0;fn flatMap(x:Int)->Int=0;',
    'fn run()->Bool={let n=3;(first([for x in [1] yield (|y:Int|x+y+n)])??(|y:Int|0))(2)==6};',
  ]) {const result=await parity(page,input(body));expect(result.ok,JSON.stringify(result)).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);}
});

test('collection comprehensions and inferred lambdas retain static and runtime failures across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const body of [
    'fn run()->Bool={let f:(Int)->Int=|x|x+1;f(1)==2};',
    'fn run()->Bool=apply(|x|x+1,3)==4;fn apply<T:Int>(f:(T)->T,x:T)->T=f(x);',
    'fn run()->Bool={let make:(Int)->(Int)->Int=|x|(|y|x+y);make(2)(3)==5};',
  ]) {const result=await parity(page,input(body));expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);}
  for (const body of [
    'fn run()->Sequence<Int> =[for x [1] yield x];',
    'fn run()->Sequence<Int> =[for x in [1] where 1 yield x];',
    'fn run()->Sequence<Int> =[for x in [y], y in [1] yield x];',
    'fn run()->Int={let f=|x|x;f(1)};',
    'fn run()->Sequence<Int> =[for x in [1], y in [10/(x-1)] yield y];',
    'fn run()->Sequence<Int> =[for x in [1] where 10/(x-1)>0 yield x];',
    'fn run()->Sequence<Int> =[for x in [1] yield 10/(x-1)];',
  ]) expect((await parity(page,input(body))).ok).toBe(false);
});


test('collection comprehensions validate Many inputs before yielding concrete collections', async ({ page }) => {
  test.setTimeout(180000);
  for (const [ordered,unique,kind] of [[false,false,'Bag'],[false,true,'Set'],[true,false,'Sequence'],[true,true,'OrderedSet']]) {
    const resultKind=ordered?'Sequence':'Bag';
    const params=input(`fn run<T:${kind}<Int>>(xs:T)->${resultKind}<Int> =[for x in xs where x>1 yield x+1];`);delete params.arguments;
    params.selection.types=[{Scalar:'Int64'},{Many:{element:0,lower:2,upper:3,ordered,unique}}];params.selection.arguments=[1];
    const compiled=await parity(page,params,true);expect(compiled.ok).toBe(true);
    const ty=compiled.program.functions[compiled.program.entry].parameters[0];const element=compiled.program.types[ty].Many.element;
    const value=n=>({ty:element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}});
    params.arguments=[{ty,data:{Collection:[value(2),value(1)]}}];
    const result=await parity(page,params);expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual(['3']);
    expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe(resultKind);
    for (const numbers of [[],[1],[1,2,3,4]]) {params.arguments[0].data.Collection=numbers.map(value);expect((await parity(page,params)).ok).toBe(false);}
    params.arguments[0].data.Collection=[value(1),value(1)];expect((await parity(page,params)).ok).toBe(!unique);
  }
});


test('contextual comprehension yields preserve nested ordering and overload isolation across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const body of [
    'fn run()->Bool=check([for x in [1], y in [2] where true yield None],3);fn check<T>(xs:Sequence<Option<T>>,value:T)->Bool=size(xs)==1;',
    'fn run()->Bool=check(3,[for x in [1], y in [2] yield None]);fn check<T>(value:T,xs:Sequence<Option<T>>)->Bool=size(xs)==1;',
    'fn run()->Bool=check([for x in [1] where true yield x]);fn check<T>(xs:Sequence<T>)->Bool=size(xs)==1;',
  ]) {const result=await parity(page,input(body));expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);}

  for (const outer of ['Sequence','Bag','Set','OrderedSet']) for (const inner of ['Sequence','Bag','Set','OrderedSet']) {
    const kind=['Sequence','OrderedSet'].includes(outer)&&['Sequence','OrderedSet'].includes(inner)?'Sequence':'Bag';
    for (const [element,yielded] of [['Option<Int>','None'],['Sequence<Int>','[]'],['Result<Int,String>','Err("no")']]) {
      const params=input(`fn run()->${kind}<${element}> =[for x in ${outer}([1]), y in ${inner}([2]) where x+y>0 yield ${yielded}];`);
      const result=await parity(page,params);expect(result.ok,JSON.stringify(result)).toBe(true);
      expect(result.program.types[result.evaluation.value.ty].Collection.kind).toBe(kind);
      const values=result.evaluation.value.data.Collection;expect(values).toHaveLength(1);
      if (element==='Option<Int>') expect(values[0].data).toBe('None');
      else if (element==='Sequence<Int>') expect(values[0].data.Collection).toEqual([]);
      else expect(values[0].data.Err.data.Scalar.payload).toBe('no');
    }
  }
  const body='fn run()->Bool=choose([for x in [1], y in [2] where true yield if x>0 {None} else {Some(x+y)}]);fn choose(xs:Sequence<Option<Bool>>)->Bool=false;fn choose(xs:Sequence<Option<Int>>)->Bool=true;';
  const result=await parity(page,input(body));expect(result.ok).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);
  for (const body of [
    'fn run()->Bool=choose([for x in [1], y in [2] where true yield None]);fn choose(xs:Sequence<Option<Bool>>)->Bool=false;fn choose(xs:Sequence<Option<Int>>)->Bool=true;',
    'fn run()->Sequence<Option<Int>> =[for x in Bag([1]), y in [2] yield None];',
    'fn run()->Sequence<Option<Int>> =[for x in [1], y in [2] where false yield Some(true)];',
  ]) expect((await parity(page,input(body))).ok).toBe(false);
});


test('stepped nested equivalence preserves structural algebra and source equality across hosts', async ({ page }) => {
  test.setTimeout(180000);
  const numbers=Array.from({length:24},(_,i)=>i);
  const forward=numbers.join(',');const reverse=[...numbers].reverse().join(',');
  const bodies=[
    `fn run()->Bool={let a=Bag([${forward}]);let b=Bag([${reverse}]);contains([a],b) && size(intersection([a,a],[b]))==1 && size(difference([a,a],[b]))==1 && size(groupBy([a,b],|x|x))==1 && size(distinct([a,b]))==1 && size(Set([a,b]))==1 && size(OrderedSet([a,b]))==1 && size(Sequence([a,b]))==2};`,
    `fn run()->Bool={let a={${numbers.map(i=>`f${i}:${i}`).join(',')}};let b={${numbers.map(i=>`f${i}:${i}`).join(',')}};Some(a)==Some(b)};`,
    `fn run()->Bool={let a={${numbers.map(i=>`f${i}:${i}`).join(',')}};let b={${numbers.map(i=>`f${i}:${i===23?99:i}`).join(',')}};Some(a)!=Some(b)};`,
    `fn run()->Bool=!contains([Bag([1,1,2])],Bag([1,2,2]));`,
    `fn run()->Bool={let a=Bag([${forward}]);let xs=[${numbers.map(()=>'a').join(',')}];let tuple=(${numbers.map(()=>'a').join(',')});size(xs)==24 && size(tuple[23])==24};`,
  ];
  for (const body of bodies) {
    const params=input(body);const result=await parity(page,params);expect(result.ok,JSON.stringify(result)).toBe(true);expect(result.evaluation.value.data.Scalar.payload).toBe(true);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
});


test('stepped result encoding preserves nested transport values and receipts across hosts', async ({ page }) => {
  const params=input('fn run()->Sequence<{a:(Option<Int>,Result<Int,String>),b:Bag<Int>}> =[for x in [0,1,2,3] yield {a:(Some(x),if x>0 {Ok(x)} else {Err("zero")}),b:Bag([x,x])}];');
  const result=await parity(page,params);expect(result.ok,JSON.stringify(result)).toBe(true);
  const values=result.evaluation.value.data.Collection;expect(values).toHaveLength(4);
  for (let i=0;i<4;i++) {
    const record=values[i].data.Record;
    expect(record.a.data.Tuple[0].data.Some.data.Scalar.payload.value).toBe(String(i));
    if(i===0) expect(record.a.data.Tuple[1].data.Err.data.Scalar.payload).toBe('zero');
    else expect(record.a.data.Tuple[1].data.Ok.data.Scalar.payload.value).toBe(String(i));
    expect(record.b.data.Collection.map(v=>v.data.Scalar.payload.value)).toEqual([String(i),String(i)]);
  }
  expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
});


test('stepped shape admission rejects late malformed arguments before decoding across hosts', async ({ page }) => {
  const params=input('fn run(x:Sequence<Int32>)->Sequence<Int32> =x;');delete params.arguments;
  const compiled=await parity(page,params,true);expect(compiled.ok).toBe(true);
  const ty=compiled.program.functions[compiled.program.entry].parameters[0];const element=compiled.program.types[ty].Collection.element;
  const value=n=>({ty:element,data:{Scalar:{ty:{Scalar:'Int32'},payload:n}}});
  params.arguments=[{ty,data:{Collection:Array.from({length:100},(_,n)=>value(n))}}];
  const result=await parity(page,params);expect(result.ok,JSON.stringify(result)).toBe(true);expect(result.evaluation.value).toEqual(params.arguments[0]);
  expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  params.arguments[0].data.Collection[99].data='None';
  const failure=await parity(page,params);expect(failure.ok).toBe(false);expect(failure.failure.kind).toBe('Arguments');expect(failure.failure.consumed.value_nodes).toBe(0);
});


test('stepped native decoding keeps nested Many uniqueness and multiplicity across hosts', async ({ page }) => {
  test.setTimeout(180000);
  for (const [kind,ordered,unique] of [['Sequence',true,false],['Bag',false,false],['Set',false,true],['OrderedSet',true,true]]) {
    const params=input(`fn run<T:${kind}<Bag<Int>>>(xs:T)->Int=size(xs);`);delete params.arguments;
    params.selection.types=[{Scalar:'Int64'},{Collection:{kind:'Bag',element:0}},{Many:{element:1,lower:2,upper:2,ordered,unique}}];params.selection.arguments=[2];
    const compiled=await parity(page,params,true);expect(compiled.ok,JSON.stringify(compiled)).toBe(true);
    const ty=compiled.program.functions[compiled.program.entry].parameters[0];const bag=compiled.program.types[ty].Many.element;const element=compiled.program.types[bag].Collection.element;
    const value=n=>({ty:element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}});
    const collection=numbers=>({ty:bag,data:{Collection:numbers.map(value)}});
    for (const different of [false,true]) {
      params.arguments=[{ty,data:{Collection:[collection([0,1,2,3]),collection(different?[4,3,2,1]:[3,2,1,0])]}}];
      const result=await parity(page,params);expect(result.ok,JSON.stringify(result)).toBe(!unique||different);
      if(result.ok) {expect(result.evaluation.value.data.Scalar.payload.value).toBe('2');expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);}
      else {expect(result.failure.kind).toBe('Arguments');expect(result.failure.message).toContain('Duplicate');}
    }
    params.arguments[0].data.Collection.pop();const failure=await parity(page,params);expect(failure.ok).toBe(false);expect(failure.failure.consumed.value_nodes).toBe(0);
  }
});


test('shared aggregate type views retain original child wires across native and WASM', async ({ page }) => {
  test.setTimeout(180000);
  for (const [parameter,resultType] of [['T','Sequence<Int>'],['(T,T)','(Sequence<Int>,Sequence<Int>)'],['{a:T,b:T}','{a:Sequence<Int>,b:Sequence<Int>}'],['Option<T>','Option<Sequence<Int>>'],['Result<T,String>','Result<Sequence<Int>,String>']]) {
    const params=input(`fn run<T:Sequence<Int>>(xs:${parameter})->${resultType} =xs;`);delete params.arguments;
    params.selection.types=[{Scalar:'Int64'},{Many:{element:0,lower:2,upper:128,ordered:true,unique:false}}];params.selection.arguments=[1];
    const compiled=await parity(page,params,true);expect(compiled.ok,JSON.stringify(compiled)).toBe(true);
    const entry=compiled.program.functions[compiled.program.entry];
    const value=ty=>{
      const node=compiled.program.types[ty];let data;
      if(node.Many) data={Collection:Array.from({length:32},(_,n)=>({ty:node.Many.element,data:{Scalar:{ty:{Scalar:'Int64'},payload:{kind:'int64',value:String(n)}}}}))};
      else if(node.Tuple) data={Tuple:node.Tuple.map(value)};
      else if(node.Record) data={Record:Object.fromEntries(Object.entries(node.Record).map(([key,ty])=>[key,value(ty)]))};
      else if(node.Option!==undefined) data={Some:value(node.Option)};
      else if(node.Result) data={Ok:value(node.Result.ok)};
      else throw new Error(`Unexpected fixture type ${JSON.stringify(node)}`);
      return {ty,data};
    };
    params.arguments=[value(entry.parameters[0])];
    const result=await parity(page,params);expect(result.ok,JSON.stringify(result)).toBe(true);
    const expected=structuredClone(params.arguments[0]);expected.ty=entry.result;expect(result.evaluation.value).toEqual(expected);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
});

test('stepped reference context admission preserves identities and recovers across hosts', async ({ page }) => {
  const params = input('fn run()->Int8=42;');
  const bundle = lateContextBundle(params);
  const reference = {
    bundle, entry: bundle.sources[0].id, namespace: 'urn:p11',
    conversions: [], materialized_types: [], applied_conversions: [], constructors: [],
    model: { rows: Array.from({ length: 64 }, (_, n) => ({ n, text: 'é', values: [null, true, n] })), empty: {} },
  };
  params.reference_contexts = [reference];
  const result = await parity(page, params);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.evaluation.value.data.Scalar.payload).toBe(42);
  expect(await parity(page, { ...params, expected_program: result.program })).toEqual(result);
  params.reference_contexts = [reference, structuredClone(reference)];
  const duplicate = await parity(page, params);
  expect(duplicate.failure.kind).toBe('Nominal');
  expect(duplicate.failure.message).toContain('Duplicate reference context');
  expect(duplicate.failure.consumed.steps).toBe(0);
  params.reference_contexts = [structuredClone(reference)];
  params.reference_contexts[0].bundle.sources[0].text += ' ';
  const foreign = await parity(page, params);
  expect(foreign.failure.kind).toBe('Nominal');
  expect(foreign.failure.message).toContain('foreign source');
  expect(foreign.failure.consumed.steps).toBe(0);
  params.reference_contexts = [structuredClone(reference)];
  params.reference_contexts[0].bundle.namespaces[0].namespace = 'urn:foreign';
  const namespace = await parity(page, params);
  expect(namespace.failure.kind).toBe('Nominal');
  expect(namespace.failure.message).toContain('namespace differs');
  expect(namespace.failure.consumed.steps).toBe(0);
  params.reference_contexts = [reference];
  expect(await parity(page, params)).toEqual(result);
});

test('stepped invocation transfers wide captures and checks parameters across hosts', async ({ page }) => {
  const locals = Array.from({length:32},(_,n)=>'let c'+n+':Int32='+n+';').join('');
  const captures = Array.from({length:32},(_,n)=>'c'+n).join('+');
  const parameters = Array.from({length:32},(_,n)=>'p'+n+':Int32').join(',');
  const argumentsText = Array.from({length:32},(_,n)=>String(n)).join(',');
  const sum = Array.from({length:32},(_,n)=>'p'+n).join('+');
  const bodies = [
    ['fn run()->Int32={'+locals+'let f=|'+parameters+'|'+sum+'+'+captures+';f('+argumentsText+')};',992],
    ['fn run()->Int32={'+locals+'fold([1,2],0,|acc:Int32,x:Int32|acc+x+'+captures+')};',995],
  ];
  for (const [body,value] of bodies) {
    const params = input(body);
    const result = await parity(page,params);
    expect(result.ok,JSON.stringify(result)).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toBe(value);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
    const scheduled = await page.evaluate(async params => {
      const {loadRuntime}=await import('/src/runtime.js');
      const invoke=await loadRuntime();
      return [1,7,4096].map(quantum=>{
        const job=invoke({...params,method:'rcore_behavior/startFunction'});
        let current=job, units=0;
        while(current.pending) {
          current=invoke({method:'rcore_behavior/resumeFunction',job:job.job,quantum});
          if(++units>3000) throw new Error('Invocation fixture did not complete');
        }
        return current.result;
      });
    },params);
    for(const actual of scheduled) expect(actual).toEqual(result);
  }
});

test('stepped operand preparation preserves wide closures and all edge payloads across hosts', async ({ page }) => {
  const locals=Array.from({length:16},(_,n)=>'let c'+n+':Int32='+n+';').join('');
  const captures=Array.from({length:16},(_,n)=>'c'+n).join('+');
  const parameters=Array.from({length:16},(_,n)=>'p'+n+':Int32').join(',');
  const argumentsText=Array.from({length:16},(_,n)=>String(n)).join(',');
  const sum=Array.from({length:16},(_,n)=>'p'+n).join('+');
  for(const flag of [true,false]) {
    const body='fn run()->Int32={'+locals+'let flag:Bool='+flag+';let f=|'+parameters+'|'+sum+'+'+captures+';let maybe:Option<Int32> =if flag {Some(f('+argumentsText+'))} else {None};let result:Result<Int32,Int32> =if flag {Ok::<Int32,Int32>(42)} else {Err::<Int32,Int32>(1)};let x:Int32=match maybe {Some(n)=>n,None=>0};let y:Int32=match result {Ok(n)=>n,Err(e)=>e};x+y+'+captures+'};';
    const params=input(body);
    const result=await parity(page,params);
    expect(result.ok,JSON.stringify(result)).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toBe(flag?402:121);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
});

test('stepped entry admission preserves wide signatures and preparation receipts across hosts', async ({ page }) => {
  const parameters=Array.from({length:32},(_,n)=>'p'+n+':Int32').join(',');
  const sum=Array.from({length:32},(_,n)=>'p'+n).join('+');
  const params=input('fn run('+parameters+')->Int32=if true {'+sum+'} else {'+sum+'};');
  delete params.arguments;
  const compiled=await parity(page,params,true);
  expect(compiled.ok,JSON.stringify(compiled)).toBe(true);
  params.arguments=compiled.program.functions[compiled.program.entry].parameters.map(
    (ty,n)=>({ty,data:{Scalar:{ty:{Scalar:'Int32'},payload:n}}}));
  const result=await parity(page,params);
  expect(result.ok,JSON.stringify(result)).toBe(true);
  expect(result.evaluation.value.data.Scalar.payload).toBe(496);
  expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  const schedules=await page.evaluate(async params=>{
    const {loadRuntime}=await import('/src/runtime.js');
    const invoke=await loadRuntime();
    return [1,7,4096].map(quantum=>{
      const job=invoke({...params,method:'rcore_behavior/startFunction'});
      let current=job,units=0;
      while(current.pending) {
        current=invoke({method:'rcore_behavior/resumeFunction',job:job.job,quantum});
        if(++units>3000) throw new Error('Entry fixture did not complete');
      }
      return current.result;
    });
  },params);
  for(const actual of schedules) expect(actual).toEqual(result);
});

test('callback overload trials use enclosing collection and generic call context', async ({ page }) => {
  test.setTimeout(180000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const declarations of [
    'fn pick(x:Bool)->Bool=x;fn pick(x:Int)->Int=x+1;',
    'fn pick(x:Int)->Int=x+1;fn pick(x:Bool)->Bool=x;',
    'fn pick(x:Bool)->Bool=x;fn pick<T>(x:T)->T=x;',
  ]) for (const expression of ['map([],((pick)))', 'apply([],pick)', 'applyReverse(pick,[])']) {
    const params = input('fn run()->Int8={let xs:Sequence<Int> =' + expression + ';if isEmpty(xs) {42} else {0}};' + declarations +
      'fn apply<T,U>(xs:Sequence<T>,f:(T)->U)->Sequence<U> =map(xs,f);' +
      'fn applyReverse<T,U>(f:(T)->U,xs:Sequence<T>)->Sequence<U> =map(xs,f);');
    const first = await parity(page, params);
    expect(first.ok).toBe(true);
    expect(first.evaluation.value.data.Scalar.payload).toBe(42);
    expect(await parity(page, { ...params, expected_program: first.program })).toEqual(first);
  }
  for (const body of [
    'fn run()->Sequence<Int> =map([],pick);fn pick(x:Int)->Int=x;fn pick(x:Bool)->Int=0;',
    'fn run()->Sequence<String> =map([],pick);fn pick(x:Int)->Int=x;fn pick(x:Bool)->Bool=x;',
    'fn run()->Sequence<Int> =if true {[1]} else {map([],pick)};fn pick(x:Int)->Int=x;fn pick(x:Bool)->Int=0;',
  ]) {
    const result = await parity(page, input(body));
    expect(result.ok).toBe(false);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('imported callback overload trials preserve source identities and replay', async ({ page }) => {
  const source = (uri, text, dependencies = []) => ({ id: { uri, sha256: createHash('sha256').update(text).digest('hex') }, text, kind: 'rcore_behavior', dependencies });
  const helper = source('memory:callback-helper-behavior.rcore', 'rcore 1; package helper version "1"; pub fn pick(x:Bool)->Bool=x;pub fn pick(x:Int)->Int=x+1;');
  const entry = source('memory:callback-caller-behavior.rcore', 'rcore 1; package caller version "1"; import package helper version "1" as h; fn run()->Int8={let xs:Sequence<Int> =map([],((h.pick)));if isEmpty(xs) {42} else {0}};', [helper.id]);
  const params = { bundle: { version: 1, sources: [entry, helper], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, arguments: [] };
  const first = await parity(page, params);
  expect(first.ok).toBe(true);
  expect(first.evaluation.value.data.Scalar.payload).toBe(42);
  params.bundle.sources.reverse();
  expect(await parity(page, { ...params, expected_program: first.program })).toEqual(first);
});


test('partial generic callback contexts propagate known components without default types', async ({ page }) => {
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const body of [
    'fn run()->Int8={let xs:Sequence<Int> =invoke([],keep);if isEmpty(xs) {42} else {0}};fn keep<T>(x:T)->T=x;fn invoke<T,U>(xs:Sequence<T>,f:(Sequence<T>)->U)->U=f(xs);',
    'fn run()->Int8={let xs:Sequence<Int> =project([],pair);if isEmpty(xs) {42} else {0}};fn pair<T>(x:T)->(Option<T>,Bool)=(Some(x),true);fn project<T,U,V>(xs:Sequence<T>,f:(T)->(Option<U>,V))->Sequence<U> =[];',
  ]) {
    const params = input(body);
    const result = await parity(page, params);
    expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toBe(42);
    expect(await parity(page, { ...params, expected_program: result.program })).toEqual(result);
  }
  for (const body of [
    'fn run()->Sequence<Int> =apply([],keep);fn keep<T:Bool>(x:T)->T=x;fn apply<T,U>(xs:Sequence<T>,f:(T)->U)->Sequence<U> =map(xs,f);',
    'fn run()->Int8={let xs=apply([],keep);42};fn keep<T>(x:T)->T=x;fn apply<T,U>(xs:Sequence<T>,f:(T)->U)->Sequence<U> =map(xs,f);',
    'fn run()->Sequence<Int> =apply([],keep);fn keep<T,V>(x:T)->T=x;fn apply<T,U>(xs:Sequence<T>,f:(T)->U)->Sequence<U> =map(xs,f);',
    'fn run()->Sequence<Int> =apply([true],keep);fn keep<T>(x:T)->T=x;fn apply<T,U>(xs:Sequence<T>,f:(T)->U)->Sequence<U> =map(xs,f);',
  ]) expect((await parity(page, input(body))).ok).toBe(false);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('collection IR replay rejects type-compatible operations and forged source spans', async ({ page }) => {
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [body, operationKind, replacement] of [
    ['fn run()->Bool=exists([1,2],|x:Int|x==1);', 'CollectionCall', 'ForAll'],
    ['fn run()->Sequence<Int> =map([3,1,2],|x:Int|0-x);', 'CollectionCall', 'SortedBy'],
    ['fn run()->Sequence<Int> =union([1,2],[2,3]);', 'CollectionAlgebra', 'Difference'],
    ['fn run()->Bool=contains([1,2],1);', 'CollectionMembership', 'Excludes'],
  ]) {
    const params = input(body);
    const baseline = await parity(page, params);
    expect(baseline.ok).toBe(true);
    for (const mutation of ['operation', 'span', 'operand']) {
      const altered = structuredClone(baseline.program);
      const call = altered.functions.flatMap(f => f.blocks).flatMap(b => b.instructions).find(i => i.kind[operationKind]);
      expect(call).toBeTruthy();
      if (mutation === 'operation') call.kind[operationKind].operation = replacement;
      if (mutation === 'span') call.span.source.uri = 'memory:forged-behavior.rcore';
      if (mutation === 'operand') call.kind[operationKind].value = { Parameter: 999 };
      const rejected = await parity(page, { ...params, expected_program: altered });
      expect(rejected.ok).toBe(false);
      expect(rejected.stage).toBe('function_replay');
      expect(await parity(page, { ...params, expected_program: baseline.program })).toEqual(baseline);
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('every scalar wire survives collection grouping algebra callbacks and replay', async ({ page }) => {
  test.setTimeout(180000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const cases = [
    ['Bool', true], ['String', 'e\u0301ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¹Ã…â€œÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬'], ['Bytes', { kind: 'bytes', hex: '00ABFF' }],
    ['Char16', { kind: 'char16', unit: 55296 }], ['DateInstant', { kind: 'date', milliseconds: '-9223372036854775808' }], ['Unit', { kind: 'unit' }],
    ['Int8', -128], ['Int16', -32768], ['Int32', -2147483648], ['Int64', { kind: 'int64', value: '-9223372036854775808' }],
    ['UInt8', 255], ['UInt16', 65535], ['UInt32', 4294967295], ['UInt64', { kind: 'uint64', value: '18446744073709551615' }],
    ['BigInt', { kind: 'bigint', value: '123456789012345678901234567890' }], ['Decimal', { kind: 'decimal', coefficient: '1234567890123456789012300', scale: 4 }],
    ['Float32', { kind: 'float32', bits: '7fc01234' }], ['Float64', { kind: 'float64', bits: '8000000000000000' }],
  ];
  for (const [name, payload] of cases) {
    const params = input(`fn run(x:${name})->${name}={let xs=map([x,x],|y:${name}|y);let kept=filter(xs,|y:${name}|contains([x],y));let groups=groupBy(kept,|y:${name}|y);let unique=distinct(flatten(map(groups,|g:(${name},Sequence<${name}>)|g[1])));let check:Int8=if size(groups)==1 && count(kept,x)==2 && size(difference(kept,[x]))==1 && size(intersection(kept,[x]))==1 && size(union(kept,[x]))==3 {0} else {1/0};fold(Sequence(unique),x,|a:${name},b:${name}|b)};`);
    delete params.arguments;
    const compiled = await parity(page, params, true);
    expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const value = { ty, data: { Scalar: { ty: { Scalar: name }, payload } } };
    params.arguments = [value];
    params.expected_program = compiled.program;
    const result = await parity(page, params);
    expect(result.ok).toBe(true);
    expect(result.evaluation.value).toEqual(value);
    expect(result.evaluation.consumed.collection_comparisons).toBeGreaterThan(0);
    expect(await parity(page, params)).toEqual(result);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('long lazy Boolean chains preserve short circuit behavior and fail within declared limits', async ({ page }) => {
  for (const [operator, first, rest, expected] of [
    ['&&','false','true',false],['||','true','false',true],
  ]) {
    const expression = [first,'fail()',...Array(30).fill(rest)].join(operator);
    const params = input('fn run()->Bool='+expression+';fn fail()->Bool={let x:Int8=1/0;true};');
    const result = await parity(page,params);
    expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toBe(expected);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
  for (const [operator,value] of [['&&','true'],['||','false']]) {
    const expression = [...Array(31).fill(value),'fail()'].join(operator);
    const failure = await parity(page,input('fn run()->Bool='+expression+';fn fail()->Bool={let x:Int8=1/0;true};'));
    expect(failure.ok).toBe(false);
    expect(failure.failure.kind).toBe('Arithmetic');
    const wide = input('fn run()->Bool='+Array(64).fill(value).join(operator)+';');
    delete wide.arguments;
    const rejected = await parity(page,wide,true);
    expect(rejected.ok).toBe(false);
  }
});


test('deep expression lowering keeps lexical scope and declared bounds', async ({ page }) => {
  test.setTimeout(180000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const expression of [
    '('.repeat(60)+'true'+')'.repeat(60),
    '!'.repeat(60)+'true',
    'keep('.repeat(60)+'true'+')'.repeat(60),
    '{let x=true;'.repeat(60)+'true'+'}'.repeat(60),
    'if true {'.repeat(32)+'true'+'} else {false}'.repeat(32),
  ]) {
    const params = input('fn run()->Bool='+expression+';fn keep(x:Bool)->Bool=x;');
    const result = await parity(page,params);
    expect(result.ok).toBe(true);
    expect(result.evaluation.value.data.Scalar.payload).toBe(true);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
  for (const [ty,expression] of [
    ['Option<'.repeat(60)+'Bool'+'>'.repeat(60),'Some('.repeat(60)+'true'+')'.repeat(60)],
    ['Bool','if true {let x=true;'.repeat(60)+'true'+'} else {false}'.repeat(60)],
    ['Bool','match true {true => '.repeat(60)+'true'+',false => false}'.repeat(60)],
    ['Bool','('.repeat(64)+'true'+')'.repeat(64)],
  ]) {
    const params = input('fn run()->'+ty+' ='+expression+';');
    delete params.arguments;
    const result = await parity(page,params,true);
    expect(result.ok).toBe(ty.startsWith('Option'));
  }
  let expression = 'x';
  for (let i=0;i<12;i++) expression='keep(if true {let x:Int8=42;('+expression+')} else {fail()})';
  const params = input('fn run()->Int8={let x:Int8=7;let y:Int8='+expression+';y+x};fn keep(x:Int8)->Int8=x;fn fail()->Int8=1/0;');
  const result = await parity(page,params);
  expect(result.ok).toBe(true);
  expect(result.evaluation.value.data.Scalar.payload).toBe(49);
  expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('structural collection pipeline preserves exact returned wires and callable identity', async ({ page }) => {
  test.setTimeout(180000);
  for (const [ty,literal] of [
    ['Option<Int8>','None'],['Option<Int8>','Some(42)'],
    ['Result<Int8,String>','Ok(42)'],['Result<Int8,String>','Err("failure")'],
    ['(Int8,Option<Bool>)','(42,Some(true))'],
    ['{a:Int8,b:Result<Bool,String>}','{a:42,b:Err("failure")}'],
    ['Sequence<Option<Int8>>','[None,Some(42),None]'],
    ['Set<Option<Int8>>','Set([Some(42),None,Some(42)])'],
    ['OrderedSet<Option<Int8>>','OrderedSet([Some(42),None,Some(42)])'],
    ['Bag<Option<Int8>>','Bag([Some(42),None,Some(42)])'],
    ['Sequence<Bag<Int8>>','[Bag([2,1,2]),Bag([])]'],
    ['Option<Result<({value:Int8},Sequence<Bool>),String>>','Some(Ok(({value:42},[true,false])))'],
  ]) {
    const params=input('fn run()->('+ty+','+ty+')={let x:'+ty+' ='+literal+';(x,collectionRoundtrip(x))};'+collectionRoundtripSource);
    const result=await parity(page,params);
    expect(result.ok).toBe(true);
    const pair=result.evaluation.value.data.Tuple;
    expect(pair).toHaveLength(2);
    expect(pair[0]).toEqual(pair[1]);
    expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  }
  const params=input('fn run()->Int8={let captured:Int8=40;let f=|x:Int8|captured+x;let g=collectionRoundtrip(f);g(2)};'+collectionRoundtripSource);
  const result=await parity(page,params);
  expect(result.ok).toBe(true);
  expect(result.evaluation.value.data.Scalar.payload).toBe(42);
  expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
  const rejected=await parity(page,input('fn run()->(Int8)->Int8=collectionRoundtrip(|x:Int8|x);'+collectionRoundtripSource));
  expect(rejected.ok).toBe(false);
  expect(rejected.failure.kind).toBe('Unsupported');
  expect(rejected.failure.message).toContain('closure transport');
});

test('Many values keep exact bounds through nested collection pipeline and recovery', async ({ page }) => {
  for (const ordered of [false,true]) for (const unique of [false,true]) {
    const params=input('fn run<T>(x:T)->T=collectionRoundtrip(x);'+collectionRoundtripSource);
    params.selection.types=[{Scalar:'Int8'},{Many:{element:0,lower:2,upper:3,ordered,unique}}];
    params.selection.arguments=[1];
    delete params.arguments;
    const compiled=await parity(page,params,true);
    expect(compiled.ok).toBe(true);
    const ty=compiled.program.functions[compiled.program.entry].parameters[0];
    const element=compiled.program.types[ty].Many.element;
    const argument={ty,data:{Collection:[2,1].map(payload=>({ty:element,data:{Scalar:{ty:{Scalar:'Int8'},payload}}}))}};
    params.arguments=[argument];
    params.expected_program=compiled.program;
    const result=await parity(page,params);
    expect(result.ok).toBe(true);
    expect(result.evaluation.value).toEqual(argument);
    const invalid=structuredClone(argument);
    invalid.data.Collection.pop();
    const rejected=await parity(page,{...params,arguments:[invalid]});
    expect(rejected.ok).toBe(false);
    expect(rejected.failure.kind).toBe('Arguments');
    expect(await parity(page,params)).toEqual(result);
  }
});

test('enum alias identity survives the complete collection pipeline', async ({ page }) => {
  const text="<e:EPackage xmlns:e='http://www.eclipse.org/emf/2002/Ecore' xmlns:x='http://www.w3.org/2001/XMLSchema-instance' name='m' nsURI='urn:values'><eClassifiers x:type='e:EEnum' name='Mode'><eLiterals name='First' value='7'/><eLiterals name='Alias' value='7'/></eClassifiers></e:EPackage>";
  const model=sourceFixture('memory:values.ecore','ecore',text);
  const params=input('import model "urn:values" as m;fn run()->(m.Mode,m.Mode)={let a=collectionRoundtrip(m.Mode.First);let b=collectionRoundtrip(m.Mode.Alias);let check:Int8=if size(distinct([a,b]))==2 {0} else {1/0};(a,b)};'+collectionRoundtripSource);
  params.selection.symbol.declaration=1;
  params.bundle.sources[0].dependencies=[model.id];
  params.bundle.sources.push(model);
  const result=await parity(page,params);
  expect(result.ok).toBe(true);
  const pair=result.evaluation.value.data.Tuple;
  expect(pair[0]).not.toEqual(pair[1]);
  expect(await parity(page,{...params,expected_program:result.program})).toEqual(result);
});


test('comprehension replay rejects type-correct predicate and in-bounds provenance changes', async ({ page }) => {
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const params=input('fn run()->Sequence<Int> =[for x in [1,2] where true yield x];');
  const baseline=await parity(page,params);
  expect(baseline.ok).toBe(true);
  for (const change of ['predicate','span']) {
    const altered=structuredClone(baseline.program);
    const constant=altered.functions.flatMap(f=>f.blocks).flatMap(b=>b.instructions).find(i=>i.kind.Constant?.data?.Scalar?.payload===true);
    expect(constant).toBeTruthy();
    if (change==='predicate') constant.kind.Constant.data.Scalar.payload=false;
    else {constant.span.start=0;constant.span.end=0;}
    const rejected=await parity(page,{...params,expected_program:altered});
    expect(rejected.ok).toBe(false);
    expect(rejected.stage).toBe('function_replay');
    expect(await parity(page,{...params,expected_program:baseline.program})).toEqual(baseline);
  }
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
});


test('collection names retain ordinary binding and invalid unused bodies reject', async ({ page }) => {
  test.setTimeout(180000);
  const initial=await page.evaluate(()=>window.workbench.inspect());
  for (const name of ['groupBy','sortedWith','sortedBy','map','filter','flatMap','fold','exists','forAll','one','find','union','intersection','difference','concat','distinct','contains','excludes','count','includesAll','includesAny','flatten','first','last','at','size','isEmpty','Sequence','Set','OrderedSet','Bag']) {
    for (const local of [false,true]) {
      const body=local ? 'fn run()->Int8={let '+name+'=|x:Int8|x;'+name+'(42)};' : 'fn run()->Int8='+name+'(42);fn '+name+'(x:Int8)->Int8=x;';
      const result=await parity(page,input(body));
      expect(result.ok).toBe(true);
      expect(result.evaluation.value.data.Scalar.payload).toBe(42);
    }
  }
  for (const body of [
    'fn run()->Int8=42;fn unused()->Sequence<Int> =map([],|x:Int|true);',
    'fn run()->Int8=42;fn unused<T>(xs:Sequence<T>)->Sequence<Int> =map(xs,|x:T|x);',
    'fn run()->Int8=42;fn unused()->Sequence<Int> =[for x in [] where false yield x];',
    'fn run()->Int8=42;fn unused<T:Bool>(xs:Sequence<T>)->Sequence<Int> =map(xs,keep);fn keep<U:Int>(x:U)->U=x;',
    'fn run()->Int8=42;fn unused()->Int=if true {0} else {size(filter([],|x:Int|1))};',
    'fn run()->Int8=42;fn unused()->Sequence<Option<Int>> =[for x in [1] where false yield Some(true)];',
  ]) {
    const params=input(body);
    const result=await parity(page,params);
    expect(result.ok).toBe(false);
    for (const diagnostic of result.diagnostics) expect(diagnostic.span.source).toEqual(params.entry);
  }
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
});


test('reference policy preparation yields per entry and retains zero invocation receipts', async ({ page }) => {
  const params=input('fn run()->Int8=42;');
  const text='<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:policy"><eClassifiers x:type="e:EDataType" name="RGB" instanceClassName="example.RGB"/><eClassifiers x:type="e:EDataType" name="Alias" instanceClassName="example.RGB"/></e:EPackage>';
  const policies=sourceFixture('memory:policies.ecore','ecore',text);
  const id=policies.id;
  params.bundle.sources.push(policies);
  params.conversions=[0,1].map(n=>({datatype:{source:id,path:[n]},provider:{name:'example.rgb',version:'1'},serializable:true}));
  params.reference_contexts=[{bundle:params.bundle,entry:params.entry,namespace:'unused',conversions:Array.from({length:24},(_,n)=>structuredClone(params.conversions[n%2])),materialized_types:[],applied_conversions:[],constructors:[],model:{}}];
  const baseline=await parity(page,params);
  expect(baseline.ok).toBe(true);
  expect(baseline.evaluation.consumed.provider_invocations).toBe(0);
  expect(baseline.evaluation.consumed_providers).toEqual([]);
  const observed=await page.evaluate(async params=>{
    const {loadRuntime}=await import('/src/runtime.js');
    const invoke=await loadRuntime();
    const run=params=>{
      const started=invoke({...params,method:'rcore_behavior/startFunction'});
      let ticks=0,result;
      do {result=invoke({method:'rcore_behavior/resumeFunction',job:started.job,quantum:1});if(++ticks>1000) throw new Error('fixture did not finish');} while(result.pending);
      return {ticks,result:result.result};
    };
    const empty=structuredClone(params);empty.reference_contexts[0].conversions=[];
    const without=run(empty),withPolicies=run(params);
    for(let boundary=0;boundary<withPolicies.ticks-1;boundary++) {
      const started=invoke({...params,method:'rcore_behavior/startFunction'});
      for(let step=0;step<boundary;step++) invoke({method:'rcore_behavior/resumeFunction',job:started.job,quantum:1});
      const cancelled=invoke({method:'rcore_behavior/cancelFunction',job:started.job});
      if(cancelled.result.failure.kind!=='Cancelled') throw new Error('non-cancelled result');
    }
    return {without,withPolicies,recovery:run(params)};
  },params);
  expect(observed.withPolicies.ticks-observed.without.ticks).toBe(24);
  expect(observed.withPolicies.result).toEqual(baseline);
  expect(observed.recovery.result).toEqual(baseline);
  const altered=structuredClone(params);
  altered.reference_contexts[0].conversions[23].provider.version='foreign';
  const rejected=await parity(page,altered);
  expect(rejected.ok).toBe(false);
  expect(rejected.failure.kind).toBe('Nominal');
  expect(await parity(page,params)).toEqual(baseline);
  const combined=structuredClone(params);
  combined.reference_contexts=[0,1].map(n=>{
    const value=structuredClone(params.reference_contexts[0]);
    value.namespace='snapshot-'+n;
    value.model={padding:'x'.repeat(2048)};
    delete value.materialized_types;delete value.applied_conversions;delete value.constructors;
    return value;
  });
  const referenceBytes=combined.reference_contexts.reduce((n,value)=>n+new TextEncoder().encode(JSON.stringify(value)).length,0);
  const exact=baseline.evaluation.consumed.context_bytes+referenceBytes;
  const budgetLimits = {
    scalar: { max_steps: 100000, max_value_bytes: 4194304, values: { max_value_bytes: 262144, max_digits: 4096 }, numeric: { max_digits: 4096, max_intermediate_digits: 8192, max_scale_alignment: 4096, max_value_bytes: 262144, max_total_value_bytes: 1048576, max_work: 16777216 } },
    max_frames: 256, max_closures: 65536, max_captures: 65536, max_value_nodes: 65536,
    max_value_depth: 64, max_collection_comparisons: 1048576, max_trace_frames: 256,
    max_trace_bytes: 65536, max_model_contexts: 8, max_reference_domains: 128,
    max_context_bytes: 16777216, max_model_elements: 100000, max_membership_checks: 1048576,
    max_provider_evidence_bytes: 65536, max_provider_invocations: 1048576, max_provider_work: 1048576,
  };
  for(const limit of [exact,exact+1]) {
    const accepted=await parity(page,{...combined,execution_limits:{...budgetLimits,max_context_bytes:limit}});
    expect(accepted.ok).toBe(true);
    expect(accepted.evaluation.value).toEqual(baseline.evaluation.value);
  }
  const exhausted=await parity(page,{...combined,execution_limits:{...budgetLimits,max_context_bytes:exact-1}});
  expect(exhausted.ok).toBe(false);
  expect(exhausted.failure.kind).toBe('ResourceExhausted');
  expect(exhausted.failure.message).toContain('Reference input byte limit');
  expect(exhausted.failure.consumed.steps).toBe(0);
  expect((await parity(page,combined)).ok).toBe(true);

});


test('atomic context admission bounds wide and deep inputs with observable slices', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const rows=[];
  const nested=depth=>{let value=true;for(let n=0;n<depth;n++) value={x:value};return value;};
  for(const [name,model,accepted] of [
    ['wide-30000',Object.fromEntries(Array.from({length:30000},(_,n)=>['k'+String(n).padStart(5,'0'),true])),true],
    ['string-512KiB',{text:'x'.repeat(524288)},true],
    ['string-1MiB-hash-budget',{text:'x'.repeat(1048576)},false],
    ['depth-60',nested(60),true],['wide-33000',Object.fromEntries(Array.from({length:33000},(_,n)=>['k'+String(n).padStart(5,'0'),true])),false],
    ['depth-64',nested(64),false],['depth-96',nested(96),false],
  ]) {
    const params=input('fn run()->Int8=42;');
    params.reference_contexts=[{bundle:params.bundle,entry:params.entry,namespace:'unused',conversions:[],model}];
    // Preserve deep fixtures through Playwright's argument transport as JSON text.
    // The page still sends the complete object through the production workers.
    const expected=await page.evaluate(encoded=>window.workbench.request('intersect/evaluateFunctionRcore',JSON.parse(encoded)),JSON.stringify(params));
    expect(expected).toEqual(native({...params,method:'rcore_behavior/evaluateFunction'}));
    expect(expected.ok).toBe(accepted);
    if(!accepted) {
      expect(expected.failure.kind).toBe('ResourceExhausted');
      expect(expected.failure.consumed.steps).toBe(0);
      if(name==='string-1MiB-hash-budget') {
        expect(expected.failure.message).toBe('Provider work limit exceeded');
        expect(expected.failure.consumed.provider_invocations).toBe(0);
      } else {
        expect(expected.failure.message).toContain('metadata');
      }
    }
    const measured=await page.evaluate(async encoded=>{
      const params=JSON.parse(encoded);
      const {loadRuntime}=await import('/src/runtime.js');
      const invoke=await loadRuntime();
      const start=performance.now();
      const job=invoke({...params,method:'rcore_behavior/startFunction'});
      const startMs=performance.now()-start;
      const durations=[];let response;
      do {
        const before=performance.now();
        response=invoke({method:'rcore_behavior/resumeFunction',job:job.job,quantum:1});
        durations.push(performance.now()-before);
        if(durations.length>200000) throw new Error('fixture did not terminate');
      } while(response.pending);
      durations.sort((a,b)=>a-b);
      return {result:response.result,ticks:durations.length,startMs,maxMs:durations.at(-1),p99Ms:durations[Math.floor(durations.length*0.99)]};
    },JSON.stringify(params));
    expect(measured.result).toEqual(expected);
    const {result,...metrics}=measured;rows.push({name,...metrics});
  }
  await testInfo.attach('atomic-context-slice-observations',{body:Buffer.from(JSON.stringify(rows,null,2)),contentType:'application/json'});
  const recovered=await parity(page,input('fn run()->Int8=42;'));
  expect(recovered.ok).toBe(true);
});


test('stored scalar navigation shares exact member reads and lazy safe access across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const source = sourceFixture;
  const model = source('memory:stored-navigation.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:stored-navigation"><eClassifiers x:type="e:EClass" name="Base"><eStructuralFeatures x:type="e:EAttribute" name="label" lowerBound="1" defaultValueLiteral="seed" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/></eClassifiers><eClassifiers x:type="e:EClass" name="Child" eSuperTypes="#//Base"/></e:EPackage>');
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const types = [0, 1].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const selected = { bundle, entry: model.id, namespace: 'urn:stored-navigation', types, instances: [{ id: 'child', type: types[1] }] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected }));
  expect(modeled.ok).toBe(true);
  const reference = { bundle, entry: model.id, namespace: 'urn:stored-navigation', conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  for (const safe of [false, true]) {
    const body = safe ? 'fn run(x:Option<m.Base>)->Option<String> =x?.label;' : 'fn run(x:m.Base)->String={let f=|n:Int|x.label;f(0)};';
    const entry = source('memory:stored-navigation-behavior.rcore', 'rcore_behavior', `rcore 1;package navigation version "1";import model "urn:stored-navigation" as m;${body}`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    expect(compiled.effects[compiled.program.entry]).toBe('query');
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    if (safe) {
      const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: 'None' }] });
      expect(result.ok).toBe(true); expect(result.evaluation.value.data).toBe('None');
    } else {
      const args = [{ ty, data: { Model: { kind: 'model_reference', context: digest, element: 'child' } } }];
      const result = await parity(page, { ...params, expected_program: compiled.program, arguments: args, reference_contexts: [reference] });
      expect(result.ok).toBe(true); expect(result.evaluation.value.data.Scalar.payload).toBe('seed');
      const missing = await parity(page, { ...params, arguments: args }); expect(missing.ok).toBe(false);
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('absent stored scalar navigation uses inherited defaults or nullable absence across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const original = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/projection.ecore', import.meta.url), 'utf8');
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  for (const withDefault of [true, false]) {
    const model = source('memory:absent-scalar.ecore', 'ecore', withDefault ? original : original.replace(' defaultValueLiteral="seed"', ''));
    const bundle = { version: 1, sources: [model], namespaces: [] };
    const types = [0, 3].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
    const namespace = 'urn:intersect:navigation';
    const selected = { bundle, entry: model.id, namespace, types, instances: [{ id: 'diamond', type: types[1] }] };
    const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
    expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
    delete modeled.model.elements[0].values.label;
    const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: types, model: canonical(modeled.model) };
    const entry = source('memory:absent-scalar-behavior.rcore', 'rcore_behavior', `rcore 1;package navigation version "1";import model "${namespace}" as m;fn read(x:m.Base)->Option<String> =x.label;`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const before = JSON.stringify(reference);
    const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: { kind: 'model_reference', context: createHash('sha256').update(before).digest('hex'), element: 'diamond' } } }], reference_contexts: [reference] });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (withDefault) expect(result.evaluation.value.data.Some.data.Scalar.payload).toBe('seed');
    else expect(result.evaluation.value.data).toBe('None');
    expect(JSON.stringify(reference)).toBe(before);
  }
});

test('stored navigation preserves pinned unsettable assignment values and identities across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const oracle = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-feature-flags/emf-dynamic-observations.json', import.meta.url), 'utf8'));
  let checked = 0;
  for (const fixture of oracle.cases.filter(value => value.changeable && value.unsettable && !value.derived && !value.volatile && !value.transient)) {
    const many = fixture.many;
    const model = source('memory:assignment.ecore', 'ecore', `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="assignment" nsURI="urn:assignment"><eClassifiers x:type="e:EClass" name="Base"><eStructuralFeatures x:type="e:EAttribute" name="value" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString" unsettable="true" upperBound="${many ? -1 : 1}" ${many ? '' : 'defaultValueLiteral="seed"'}/></eClassifiers><eClassifiers x:type="e:EClass" name="Item" eSuperTypes="#//Base"/></e:EPackage>`);
    const bundle = { version: 1, sources: [model], namespaces: [] }; const namespace = 'urn:assignment';
    const types = [0, 1].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
    const selected = { bundle, entry: model.id, namespace, types, instances: [{ id: 'object', type: types[1] }] };
    const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
    expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
    const entry = source('memory:assignment-behavior.rcore', 'rcore_behavior', `rcore 1;package assignment version "1";import model "${namespace}" as m;fn read(x:m.Base)->${many ? 'Sequence<String>' : 'Option<String>'} ={let read=|unused:Int8|${many ? 'Sequence(x.value)' : 'x.value'};read(0)};`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0]; let freshDigest;
    // These are independently authored admitted snapshots of pinned observations.
    // The native companion performs the actual checked edits and unsets.
    for (const step of fixture.steps) {
      expect(step.accepted).toBe(true); const snapshot = structuredClone(modeled.model);
      snapshot.elements[0].values.value = step.value;
      snapshot.elements[0].assignment_state = { version: 1, set_features: step.is_set ? ['value'] : [] };
      const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: types, model: canonical(snapshot) };
      const before = JSON.stringify(reference); const digest = createHash('sha256').update(before).digest('hex');
      if (step.operation === 'fresh') freshDigest = digest;
      if (step.operation === 'explicit-default') expect(digest).not.toBe(freshDigest);
      if (step.operation === 'unset-default') expect(digest).toBe(freshDigest);
      const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: { kind: 'model_reference', context: digest, element: 'object' } } }], reference_contexts: [reference] });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const data = result.evaluation.value.data;
      const observed = many ? data.Collection.map(value => value.data.Scalar.payload) : data === 'None' ? null : data.Some.data.Scalar.payload;
      expect(observed).toEqual(step.value); expect(JSON.stringify(reference)).toBe(before); checked++;
    }
  }
  expect(checked).toBe(16);
});

test('provider default and unset state navigation preserves exact RGB values across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const model = source('memory:paint.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/provider.ecore', import.meta.url), 'utf8'));
  const contract = { datatype: fixtureDeclaration(model, [0]), provider: { name: 'example.rgb', version: '1' }, serializable: true };
  const color = (red, green, blue) => ({ kind: 'converted', datatype: contract.datatype, provider: contract.provider, value: { red, green, blue } });
  const defaultValue = color(18, 58, 188), changed = color(1, 2, 3);
  const bundle = { version: 1, sources: [model], namespaces: [] }; const namespace = 'urn:paint';
  const target = { kind: 'classifier', declaration: fixtureDeclaration(model, [1]), arguments: [], raw: false };
  const selected = { bundle, entry: model.id, namespace, conversions: [contract], types: [target], instances: [{ id: 'paint', type: target }] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
  for (const field of ['color', 'optional', 'colors']) {
    const many = field === 'colors'; const initial = field === 'color' ? defaultValue : many ? [] : null;
    const entry = source('memory:paint-behavior.rcore', 'rcore_behavior', `rcore 1;package paint version "1";import model "${namespace}" as m;fn read(x:m.Paint)->${many ? 'Sequence<m.RGB>' : 'Option<m.RGB>'} ={let f=|unused:Int8|${many ? 'Sequence(x.colors)' : 'x.' + field};f(0)};`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] }, conversions: [contract] };
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true); const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    for (const [expected, isSet] of [[initial, false], [initial, true], [many ? [changed] : changed, true], [initial, false], [initial, false]]) {
      const snapshot = structuredClone(modeled.model); snapshot.elements[0].values[field] = expected;
      snapshot.elements[0].assignment_state = { version: 1, set_features: isSet ? [field] : [] };
      const reference = { bundle, entry: model.id, namespace, conversions: [contract], materialized_types: [target], model: canonical(snapshot) };
      const before = JSON.stringify(reference);
      const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: { kind: 'model_reference', context: createHash('sha256').update(before).digest('hex'), element: 'paint' } } }], reference_contexts: [reference] });
      expect(result.ok, JSON.stringify(result)).toBe(true); const data = result.evaluation.value.data;
      const observed = many ? data.Collection.map(value => value.data.Datatype) : data === 'None' ? null : data.Some.data.Datatype;
      expect(observed).toEqual(expected); expect(result.evaluation.consumed_providers).toContainEqual(contract.provider); expect(JSON.stringify(reference)).toBe(before);
    }
  }
});

test('nested safe navigation skips absent receivers and flattens optional values across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/projection.ecore', import.meta.url), 'utf8').replace('name="children" upperBound="-1"', 'name="next"');
  const model = source('memory:safe-navigation.ecore', 'ecore', text);
  const bundle = { version: 1, sources: [model], namespaces: [] }; const namespace = 'urn:intersect:navigation';
  const entry = source('memory:safe-navigation-behavior.rcore', 'rcore_behavior', `rcore 1;package navigation version "1";import model "${namespace}" as m;fn read(x:Option<m.Base>)->Option<String> =x?.next?.label;`, [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0]; const inner = compiled.program.types[ty].Option;
  const absent = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: 'None' }] });
  expect(absent.ok, JSON.stringify(absent)).toBe(true); expect(absent.evaluation.value.data).toBe('None'); expect(absent.evaluation.consumed.model_contexts).toBe(0);
  const types = [0, 3].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  for (const present of [false, true]) {
    const selected = { bundle, entry: model.id, namespace, types, instances: [{ id: 'object', type: types[1] }], edits: present ? [['object', 'next', 'object']] : [] };
    const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
    expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
    const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: types, model: canonical(modeled.model) };
    const before = JSON.stringify(reference);
    const argument = { ty, data: { Some: { ty: inner, data: { Model: { kind: 'model_reference', context: createHash('sha256').update(before).digest('hex'), element: 'object' } } } } };
    const missing = await parity(page, { ...params, expected_program: compiled.program, arguments: [argument] }); expect(missing.failure.kind).toBe('MissingDependency');
    const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [argument], reference_contexts: [reference] });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (present) expect(result.evaluation.value.data.Some.data.Scalar.payload).toBe('seed');
    else expect(result.evaluation.value.data).toBe('None');
    expect(JSON.stringify(reference)).toBe(before);
  }
});

test('wide scalar stored qualification shares native and WASM results and work', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const fields = Array.from({ length: 64 }, (_, n) => `<eStructuralFeatures x:type="e:EAttribute" name="f${String(n).padStart(2, '0')}" defaultValueLiteral="last" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/>`).join('');
  const model = source('memory:wide-scalar.ecore', 'ecore', `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:wide-scalar"><eClassifiers x:type="e:EClass" name="Wide">${fields}</eClassifiers></e:EPackage>`);
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const type = { kind: 'classifier', declaration: fixtureDeclaration(model, [0]), arguments: [], raw: false };
  const selected = { bundle, entry: model.id, namespace: 'urn:wide-scalar', types: [type], instances: [{ id: 'wide', type }] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected }));
  expect(modeled.ok).toBe(true);
  const reference = { bundle, entry: model.id, namespace: 'urn:wide-scalar', conversions: [], materialized_types: [type], model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  const steps = [];
  for (const [resultType, body] of [['Option<String>', 'x.f63'], ['Int', '0']]) {
    const entry = source('memory:wide-scalar-behavior.rcore', 'rcore_behavior', `rcore 1;package wide version "1";import model "urn:wide-scalar" as m;fn run(x:m.Wide)->${resultType} =${body};`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true);
    expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: { kind: 'model_reference', context: digest, element: 'wide' } } }], reference_contexts: [reference] });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    steps.push(result.evaluation.consumed.steps);
    if (body !== '0') expect(result.evaluation.value.data.Some.data.Scalar.payload).toBe('last');
  }
  expect(steps[0] - steps[1]).toBeGreaterThanOrEqual(64 * 8);
});

test('wide inverse qualification shares native and WASM values and work', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const fields = Array.from({ length: 63 }, (_, n) => `<eStructuralFeatures x:type="e:EAttribute" name="f${String(n).padStart(2, '0')}" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/>`).join('') + '<eStructuralFeatures x:type="e:EReference" name="links" upperBound="-1" unique="false" eType="#//Wide"/>';
  const model = source('memory:wide-inverse.ecore', 'ecore', `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:wide-inverse"><eClassifiers x:type="e:EClass" name="Wide">${fields}</eClassifiers></e:EPackage>`);
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const type = { kind: 'classifier', declaration: fixtureDeclaration(model, [0]), arguments: [], raw: false };
  const selected = { bundle, entry: model.id, namespace: 'urn:wide-inverse', types: [type], instances: [{ id: 'target', type }, { id: 'source', type }] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
  modeled.model.elements.find(e => e.id === 'source').values.links = ['target', 'target'];
  const reference = { bundle, entry: model.id, namespace: 'urn:wide-inverse', conversions: [], materialized_types: [type], model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  const steps = [];
  for (const [resultType, body] of [['OrderedSet<m.Wide>', 'incoming::<m.Wide>(x,"links")'], ['Int', '0']]) {
    const entry = source('memory:wide-inverse-behavior.rcore', 'rcore_behavior', `rcore 1;package wide version "1";import model "urn:wide-inverse" as m;fn run(x:m.Wide)->${resultType} =${body};`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: { kind: 'model_reference', context: digest, element: 'target' } } }], reference_contexts: [reference] });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    steps.push(result.evaluation.consumed.steps);
    if (body !== '0') expect(result.evaluation.value.data.Collection.map(v => v.data.Model.element)).toEqual(['source']);
  }
  expect(steps[0] - steps[1]).toBeGreaterThanOrEqual(64 * 16);
});

test('stored nominal navigation preserves enum datatype and reference identities across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const model = source('memory:nominal-navigation.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:nominal-navigation"><eClassifiers x:type="e:EEnum" name="Choice"><eLiterals name="First" literal="first"/></eClassifiers><eClassifiers x:type="e:EDataType" name="Text" instanceClassName="java.lang.String"/><eClassifiers x:type="e:EClass" name="Base"><eStructuralFeatures x:type="e:EAttribute" name="choice" eType="#//Choice" defaultValueLiteral="first"/><eStructuralFeatures x:type="e:EAttribute" name="text" eType="#//Text" defaultValueLiteral="seed"/><eStructuralFeatures x:type="e:EReference" name="next" eType="#//Base"/></eClassifiers><eClassifiers x:type="e:EClass" name="Child" eSuperTypes="#//Base"/></e:EPackage>');
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const types = [2, 3].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const selected = { bundle, entry: model.id, namespace: 'urn:nominal-navigation', types, instances: [{ id: 'child', type: types[1] }] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected }));
  expect(modeled.ok).toBe(true);
  modeled.model.elements[0].values.next = 'child';
  const reference = { bundle, entry: model.id, namespace: 'urn:nominal-navigation', conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  const bound = { kind: 'model_reference', context: digest, element: 'child' };
  for (const [field, type, wire] of [['choice', 'Choice', 'Enum'], ['text', 'Text', 'Datatype'], ['next', 'Base', 'Model']]) {
    const entry = source('memory:nominal-navigation-behavior.rcore', 'rcore_behavior', `rcore 1;package navigation version "1";import model "urn:nominal-navigation" as m;fn run(x:m.Child)->Option<m.${type}> =x.${field};`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    expect(compiled.effects[compiled.program.entry]).toBe('query');
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: bound } }], reference_contexts: [reference] });
    expect(result.ok).toBe(true);
    expect(result.evaluation.consumed.model_contexts).toBe(1);
    expect(result.evaluation.consumed.model_elements).toBe(1);
    expect(result.evaluation.consumed.reference_domains).toBe(wire === 'Model' ? 2 : 1);
    expect(result.evaluation.consumed.context_bytes).toBe(Buffer.byteLength(JSON.stringify(reference)));
    expect(result.evaluation.value.data.Some.data[wire]).toEqual(wire === 'Model' ? bound : modeled.model.elements[0].values[field]);
  }
});

test('stored Many navigation preserves duplicates and nominal identities across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const model = source('memory:many-navigation.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:many-navigation"><eClassifiers x:type="e:EEnum" name="Choice"><eLiterals name="First" literal="first"/></eClassifiers><eClassifiers x:type="e:EDataType" name="Text" instanceClassName="java.lang.String"/><eClassifiers x:type="e:EClass" name="Base"><eStructuralFeatures x:type="e:EAttribute" name="choice" upperBound="-1" unique="false" eType="#//Choice"/><eStructuralFeatures x:type="e:EAttribute" name="text" upperBound="-1" unique="false" eType="#//Text"/><eStructuralFeatures x:type="e:EReference" name="next" upperBound="-1" unique="false" eType="#//Base"/></eClassifiers><eClassifiers x:type="e:EClass" name="Child" eSuperTypes="#//Base"/></e:EPackage>');
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const types = [2, 3].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const selected = { bundle, entry: model.id, namespace: 'urn:many-navigation', types, instances: [{ id: 'child', type: types[1] }] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected }));
  expect(modeled.ok, JSON.stringify(modeled)).toBe(true);
  modeled.model.elements[0].values.next = ['child', 'child'];
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const choice = canonical({ kind: 'enum', enumeration: fixtureDeclaration(model, [0]), literal: fixtureDeclaration(model, [0, 0]) });
  const text = canonical({ kind: 'datatype', datatype: fixtureDeclaration(model, [1]), value: 'seed' });
  modeled.model.elements[0].values.choice = [choice, choice];
  modeled.model.elements[0].values.text = [text, text];
  const reference = { bundle, entry: model.id, namespace: 'urn:many-navigation', conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  const bound = { kind: 'model_reference', context: digest, element: 'child' };
  for (const [field, type, wire] of [['choice', 'Choice', 'Enum'], ['text', 'Text', 'Datatype'], ['next', 'Base', 'Model']]) {
    const entry = source('memory:many-navigation-behavior.rcore', 'rcore_behavior', `rcore 1;package navigation version "1";import model "urn:many-navigation" as m;fn run(x:m.Base)->Sequence<m.${type}> =flatMap([x,x],|v:m.Base|v.${field});`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    expect(compiled.effects[compiled.program.entry]).toBe('query');
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: bound } }], reference_contexts: [reference] });
    expect(result.ok).toBe(true);
    const expected = wire === 'Model' ? [bound, bound] : modeled.model.elements[0].values[field];
    expect(result.evaluation.value.data.Collection.map(v => v.data[wire])).toEqual([...expected, ...expected]);
  }
});


test('verified query effects distinguish pure factories and propagate indirect callbacks', async ({ page }) => {
  const source = sourceFixture;
  const model = source('memory:effects.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:effects"><eClassifiers x:type="e:EClass" name="Base"><eStructuralFeatures x:type="e:EAttribute" name="label" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/></eClassifiers></e:EPackage>');
  for (const [body, effect] of [
    ['fn run(x:m.Base)->Option<String> =None;', 'pure'],
    ['fn run(x:m.Base)->Option<String> =x.label;', 'query'],
    ['fn run(x:m.Base)->Option<String> ={let f=make();f(x)};fn make()->(m.Base)->Option<String> =|v:m.Base|v.label;', 'query'],
    ['fn run(x:m.Base)->Sequence<Option<String>> =map([x],|v:m.Base|v.label);', 'query'],
  ]) {
    const entry = source('memory:effects-behavior.rcore', 'rcore_behavior', `rcore 1;package effects version "1";import model "urn:effects" as m;${body}`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true);
    expect(compiled.ok).toBe(true);
    expect(compiled.effects.length).toBe(compiled.program.functions.length);
    expect(compiled.effects[compiled.program.entry]).toBe(effect);
    if (body.includes('fn make')) {
      const factory = compiled.program.functions.findIndex(f => f.identity.Named?.symbol.declaration === 2);
      expect(factory).toBeGreaterThanOrEqual(0);
      expect(compiled.effects[factory]).toBe('pure');
    }
    const forged = structuredClone(compiled.program); forged.effects = ['pure'];
    const rejected = { ...params, expected_program: forged };
    await expect(page.evaluate(params => window.workbench.request('intersect/compileFunctionRcore', params), rejected)).rejects.toThrow('Invalid expected_program');
    expect(() => native({ ...rejected, method: 'rcore_behavior/compileFunction' })).toThrow('Invalid expected_program');
  }
});


test('typed incoming queries preserve source identity order and context across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const model = source('memory:incoming.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:incoming"><eClassifiers x:type="e:EClass" name="Target"/><eClassifiers x:type="e:EClass" name="Source"><eStructuralFeatures x:type="e:EReference" name="links" upperBound="-1" unique="false" eType="#//Target"/></eClassifiers><eClassifiers x:type="e:EClass" name="Child" eSuperTypes="#//Source"/><eClassifiers x:type="e:EClass" name="Other"><eStructuralFeatures x:type="e:EReference" name="links" upperBound="-1" unique="false" eType="#//Target"/></eClassifiers></e:EPackage>');
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const types = [0, 1, 2, 3].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const selected = { bundle, entry: model.id, namespace: 'urn:incoming', types, instances: [{ id: 'target', type: types[0] }, { id: 'z', type: types[2] }, { id: 'foreign', type: types[3] }, { id: 'a', type: types[1] }, { id: 'empty', type: types[1] }] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected }));
  expect(modeled.ok, JSON.stringify(modeled)).toBe(true);
  for (const e of modeled.model.elements) if (['z', 'foreign', 'a'].includes(e.id)) e.values.links = ['target', 'target'];
  const reference = { bundle, entry: model.id, namespace: 'urn:incoming', conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  for (const [body, ids] of [
    ['fn run(x:m.Target)->OrderedSet<m.Source> =walk::<m.Source,m.Target>(x);fn walk<S:m.Source,T:m.Target>(x:T)->OrderedSet<S> =incoming::<S>(x,"links");', ['z', 'a']],
    ['fn run(x:m.Target)->OrderedSet<m.Child> =walk::<m.Child,m.Target>(x);fn walk<S:m.Source,T:m.Target>(x:T)->OrderedSet<S> ={let query=|n:T|incoming::<S>(n,"links");query(x)};', ['z']],
    ['fn run(x:m.Target)->OrderedSet<m.Source> =incoming::<m.Source>(x,"links");', ['z', 'a']], ['fn run(x:m.Target)->Sequence<m.Source> =flatMap([x],|n:m.Target|incoming::<m.Source>(n,"links"));', ['z', 'a']], ['fn run(x:m.Target)->OrderedSet<m.Source> =incoming::<m.Child>(x,"links");', ['z']]]) {
    const entry = source('memory:incoming-behavior.rcore', 'rcore_behavior', `rcore 1;package navigation version "1";import model "urn:incoming" as m;${body}`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    expect(compiled.effects[compiled.program.entry]).toBe('query');
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const arguments_ = [{ ty, data: { Model: { kind: 'model_reference', context: digest, element: 'target' } } }];
    const result = await parity(page, { ...params, expected_program: compiled.program, arguments: arguments_, reference_contexts: [reference] });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.evaluation.value.data.Collection.map(v => v.data.Model)).toEqual(ids.map(element => ({ kind: 'model_reference', context: digest, element })));
    expect(result.evaluation.consumed.model_contexts).toBe(1);
    expect(result.evaluation.consumed.reference_domains).toBe(2);
    expect((await parity(page, { ...params, arguments: arguments_ })).ok).toBe(false);
  }
  for (const body of ['fn run(x:m.Target)->OrderedSet<m.Source> ={let f="links";incoming::<m.Source>(x,f)};', 'fn run(x:m.Target)->Int=if false {size(incoming::<m.Source>(x,"absent"))} else {0};']) {
    const entry = source('memory:incoming-behavior.rcore', 'rcore_behavior', `rcore 1;package navigation version "1";import model "urn:incoming" as m;${body}`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    expect((await parity(page, params, true)).ok).toBe(false);
  }
});


test('ownership navigation filters after validation and preserves feature order across hosts', async ({ page }) => {
  test.setTimeout(120000);
  let recoveryRequest;
  let recoveryResponse;
  const storageLimits = {
    scalar: { max_steps: 100000, max_value_bytes: 4194304, values: { max_value_bytes: 262144, max_digits: 4096 }, numeric: { max_digits: 4096, max_intermediate_digits: 8192, max_scale_alignment: 4096, max_value_bytes: 262144, max_total_value_bytes: 1048576, max_work: 16777216 } },
    max_frames: 256, max_closures: 65536, max_captures: 65536, max_value_nodes: 65536, max_value_depth: 64,
    max_collection_comparisons: 1048576, max_trace_frames: 256, max_trace_bytes: 65536, max_model_contexts: 8,
    max_reference_domains: 128, max_context_bytes: 16777216, max_model_elements: 100000, max_membership_checks: 1048576,
    max_provider_evidence_bytes: 65536, max_provider_invocations: 1048576, max_provider_work: 1048576,
    max_model_storage_bytes: 16777216,
  };
  const source = sourceFixture;
  for (const generic of [false, true]) {
  for (const derived of [false, true]) {
  let ecoreText = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/ownership.ecore', import.meta.url), 'utf8');
  if (derived) ecoreText = ecoreText.replace('name="Root" eSuperTypes="#//Diamond">', 'name="Root" eSuperTypes="#//Diamond"><eStructuralFeatures xsi:type="ecore:EReference" name="derivedChildren" derived="true" containment="true" upperBound="-1" eType="#//Base"/>');
  const model = source('memory:ownership.ecore', 'ecore', ecoreText);
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const types = [0, 1, 2, 3].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const selected = { bundle, entry: model.id, namespace: 'urn:intersect:ownership', types, instances: [['d', 1], ['root', 3], ['bridge', 2], ['sibling', 0], ['tail', 0], ['local', 0], ['leaf', 0]].map(([id, n]) => ({ id, type: types[n] })) };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
  const object = id => modeled.model.elements.find(e => e.id === id);
  object('root').values.zChildren = ['bridge', 'sibling']; object('root').values.aChild = 'tail'; object('root').values.local = ['local'];
  object('bridge').values.zChildren = ['d']; object('d').values.zChildren = ['leaf'];
  // This fixture wires containment directly, so finalize its explicit resource roots.
  modeled.model.resources[object('root').resource].roots = ['root'];
  const reference = { bundle, entry: model.id, namespace: 'urn:intersect:ownership', conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  const ids = value => value.data === 'None' ? [] : value.data.Some ? ids(value.data.Some) : value.data.Collection ? value.data.Collection.flatMap(ids) : [value.data.Model.element];
  for (const [operation, type, objectId, expected] of [
    ['container', 'Base', 'd', ['bridge']], ['container', 'Diamond', 'd', []], ['container', 'Base', 'root', []],
    ['contents', 'Base', 'root', ['bridge', 'sibling', 'tail', 'local']], ['contents', 'Diamond', 'root', []], ['contents', 'Base', 'leaf', []],
    ['ancestors', 'Base', 'd', ['bridge', 'root']], ['ancestors', 'Diamond', 'd', ['root']], ['ancestors', 'Base', 'root', []],
  ]) {
    if (derived && !(type === 'Diamond' && ['d', 'root'].includes(objectId))) continue;
    const resultType = operation === 'container' ? 'Option' : 'OrderedSet';
    const body = generic
      ? `fn run(x:m.Base)->${resultType}<m.${type}> =walk::<m.${type},m.Base>(x);fn walk<S:m.Base,T:m.Base>(x:T)->${resultType}<S> =${operation}::<S>(x);`
      : `fn run(x:m.Base)->${resultType}<m.${type}> =${operation}::<m.${type}>(x);`;
    const entry = source('memory:ownership-behavior.rcore', 'rcore_behavior', `rcore 1;package ownership version "1";import model "urn:intersect:ownership" as m;${body}`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true); expect(compiled.effects[compiled.program.entry]).toBe('query');
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const argument = context => [{ ty, data: { Model: { kind: 'model_reference', context, element: objectId } } }];
    const beforeNavigation = structuredClone(reference);
    const request = { ...params, expected_program: compiled.program, arguments: argument(digest), reference_contexts: [reference] };
    const evaluated = await parity(page, request);
    expect(reference).toEqual(beforeNavigation);
    if (operation === 'container' && objectId === 'd' && type === (derived ? 'Diamond' : 'Base')) {
      const needed = (evaluated.ok ? evaluated.evaluation : evaluated.failure).consumed.model_storage_bytes;
      expect(needed).toBeGreaterThan(derived ? 924 : 856); // Literal index policy totals, in addition to copies/rows.
      const unchanged = structuredClone(reference);
      for (const allowance of [0, needed - 1, needed, needed + 1]) {
        const bounded = await parity(page, { ...params, expected_program: compiled.program, arguments: argument(digest), reference_contexts: [reference], execution_limits: { ...storageLimits, max_model_storage_bytes: allowance } });
        if (allowance >= needed) expect(bounded).toEqual(evaluated);
        else {
          expect(bounded.ok).toBe(false); expect(bounded.failure.kind).toBe('ResourceExhausted');
          expect(bounded.failure.message).toBe('Retained model storage limit exceeded');
          expect(bounded.failure.consumed.model_storage_bytes).toBeLessThanOrEqual(allowance);
          // Derived containment retargets after the initial Base admission. A
          // late quota failure preserves that completed domain's receipt;
          // zero allowance and ordinary admission fail before publication.
          expect(bounded.failure.consumed.reference_domains).toBe(derived && allowance !== 0 ? 1 : 0);
          expect(bounded.failure.consumed.provider_invocations).toBe(0);
        }
      }
      expect((await parity(page, { ...params, expected_program: compiled.program, arguments: argument(digest), reference_contexts: [reference] }))).toEqual(evaluated);
      expect(reference).toEqual(unchanged);
    }
    if (derived) {
      expect(evaluated.ok).toBe(false);
      expect(evaluated.failure.kind).toBe('InvalidProgram');
      expect(evaluated.failure.message).toBe('Derived containment navigation requires an executable provider');
      const call = `${operation}::<${generic ? 'S' : `m.${type}`}>(x)`;
      const start = entry.text.indexOf(call);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(evaluated.failure.span).toEqual({ source: entry.id, start, end: start + call.length });
      expect(evaluated.failure.consumed.provider_invocations).toBe(0);
      expect(evaluated.failure.consumed_providers).toEqual([]);
      expect(await parity(page, { ...params, expected_program: compiled.program, arguments: argument(digest), reference_contexts: [reference] })).toEqual(evaluated);
      expect(reference).toEqual(beforeNavigation);
      continue;
    }
    expect(evaluated.ok, JSON.stringify(evaluated)).toBe(true); expect(ids(evaluated.evaluation.value)).toEqual(expected);
    recoveryRequest = request;
    recoveryResponse = evaluated;
    if (operation === 'container' && type === 'Diamond') {
      for (const [field, value, message] of [
        ['aChild', 'd', 'Multiple containment owners'],
        ['zChildren', ['root'], 'Containment cycle'],
        ['zChildren', ['missing'], 'Missing reference target missing'],
      ]) {
        const invalid = structuredClone(reference); invalid.model.elements.find(e => e.id === 'd').values[field] = value;
        const unchanged = structuredClone(invalid);
        const changedDigest = createHash('sha256').update(JSON.stringify(invalid)).digest('hex');
        const failedRequest = { ...params, arguments: argument(changedDigest), reference_contexts: [invalid] };
        const failure = await parity(page, failedRequest);
        expect(failure.ok).toBe(false);
        expect(failure.failure.kind).toBe('Nominal');
        expect(failure.failure.message).toBe(message);
        expect(failure.failure.span).toBeNull();
        expect(failure.failure.consumed.provider_invocations).toBe(0);
        expect(failure.failure.consumed_providers).toEqual([]);
        expect(await parity(page, failedRequest)).toEqual(failure);
        expect(invalid).toEqual(unchanged);
        expect(await parity(page, request)).toEqual(evaluated);
        expect(reference).toEqual(beforeNavigation);
      }
    }
  }
  }
  }
  expect(await parity(page, recoveryRequest)).toEqual(recoveryResponse);
});


test('graph closure shares breadth first identity and callback semantics across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/projection.ecore', import.meta.url), 'utf8').replace('name="children" upperBound="-1"', 'name="children" upperBound="-1" unique="false"');
  const model = source('memory:closure.ecore', 'ecore', text);
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const types = [0, 1, 2, 3, 4].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const selected = { bundle, entry: model.id, namespace: 'urn:intersect:navigation', types, instances: [['d', 3], ['b', 0], ['c', 3], ['e', 0], ['q', 0]].map(([id, n]) => ({ id, type: types[n] })) };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
  for (const [id, children] of [['d', ['b', 'c', 'b']], ['b', ['e']], ['c', ['e', 'd', 'c']], ['e', ['b']]]) modeled.model.elements.find(e => e.id === id).values.children = children;
  const reference = { bundle, entry: model.id, namespace: 'urn:intersect:navigation', conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  const makeParams = body => {
    const entry = source('memory:closure-behavior.rcore', 'rcore_behavior', `rcore 1;package closure_test version "1";import model "urn:intersect:navigation" as m;${body}`, [model.id]);
    return { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
  };
  for (const [body, expected] of [
    ['fn run(x:m.Base)->OrderedSet<m.Base> =closure([x,x],|n|n.children);', ['d', 'b', 'c', 'e']],
    ['fn run(x:m.Base)->OrderedSet<m.Base> =closure(x.children,|n|n.children);', ['b', 'c', 'e', 'd']],
    ['fn run(x:m.Base)->OrderedSet<m.Base> =closure([x],|n|[]);', ['d']],
    ['fn run(x:m.Base)->Sequence<m.Base> =map(closure([x],|n|n.children),|n|n);', ['d', 'b', 'c', 'e']],
    ['fn run(x:m.Base)->OrderedSet<m.Base> =filter(closure([x],|n|n.children),|n|n!=x);', ['b', 'c', 'e']],
    ['fn run(x:m.Base)->Sequence<m.Base> =flatMap(closure([x],|n|n.children),|n|n.children);', ['b', 'c', 'b', 'e', 'e', 'd', 'c', 'b']],
    ['fn run(x:m.Base)->Sequence<m.Base> =fold(closure([x],|n|n.children),Sequence::<m.Base>([]),|a,n|union(a,[n]));', ['d', 'b', 'c', 'e']],
    ['fn run(x:m.Base)->Sequence<m.Base> =[for n in closure([x],|n|n.children), child in n.children where child!=x yield child];', ['b', 'c', 'b', 'e', 'e', 'c', 'b']],
    ['fn run(x:m.Base)->OrderedSet<m.Base> =closure([x],|n|closure(n.children,|child|child.children));', ['d', 'b', 'c', 'e']],
    ['fn run(x:m.Base)->OrderedSet<m.Base> =walk([x],|n:m.Base|Sequence(n.children));fn walk<T:m.Base>(xs:Sequence<T>,f:(T)->Sequence<T>)->OrderedSet<T> =closure(xs,f);', ['d', 'b', 'c', 'e']],
    ['fn run()->OrderedSet<m.Base> =closure([],|n:m.Base|n.children);', []],
  ]) {
    const params = makeParams(body); const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    expect(compiled.effects[compiled.program.entry]).toBe('query');
    const parameters = compiled.program.functions[compiled.program.entry].parameters;
    const arguments_ = parameters.map(ty => ({ ty, data: { Model: { kind: 'model_reference', context: digest, element: 'd' } } }));
    const result = await parity(page, { ...params, expected_program: compiled.program, arguments: arguments_, reference_contexts: parameters.length ? [reference] : [] });
    expect(result.ok, JSON.stringify(result)).toBe(true); expect(result.evaluation.value.data.Collection.map(v => v.data.Model.element)).toEqual(expected);
  }
  for (const expression of [
    'map(closure($seeds,|n:m.Base|n.children),|n|{let fail:Int8=1/0;n})',
    'Sequence(filter(closure($seeds,|n:m.Base|n.children),|n|{let fail:Int8=1/0;true}))',
    'flatMap(closure($seeds,|n:m.Base|n.children),|n|{let fail:Int8=1/0;n.children})',
    'fold(closure($seeds,|n:m.Base|n.children),Sequence::<m.Base>([]),|a,n|{let fail:Int8=1/0;union(a,[n])})',
    '[for n in closure($seeds,|n:m.Base|n.children) yield {let fail:Int8=1/0;n}]',
    'Sequence(closure($seeds,|n:m.Base|closure([n],|child|{let fail:Int8=1/0;child.children})))',
  ]) {
    for (const empty of [false, true]) {
      const params = makeParams(`fn run(x:m.Base)->Sequence<m.Base> =${expression.replace('$seeds', empty ? '[]' : '[x]')};`);
      const compiled = await parity(page, params, true); expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      const ty = compiled.program.functions[compiled.program.entry].parameters[0];
      const before = JSON.stringify(reference);
      const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: { kind: 'model_reference', context: digest, element: 'd' } } }], reference_contexts: [reference] });
      if (empty) {
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.evaluation.value.data.Collection).toEqual([]);
      } else {
        expect(result.ok).toBe(false); expect(result.failure.kind).toBe('Arithmetic');
        const text = params.bundle.sources[1].text;
        expect(result.failure.span).toEqual({ source: params.entry, start: text.indexOf('1/0') + 1, end: text.indexOf('1/0') + 2 });
      }
      expect(JSON.stringify(reference)).toBe(before);
    }
  }
  const params = makeParams('fn run(xs:Sequence<m.Base>)->OrderedSet<m.Base> =closure(xs,|n|n.children);');
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0]; const element = compiled.program.types[ty].Collection.element;
  const other = structuredClone(reference); other.model.elements[0].values.label = 'alternate'; const otherDigest = createHash('sha256').update(JSON.stringify(other)).digest('hex');
  const args = [{ ty, data: { Collection: [[digest, 'd'], [otherDigest, 'd'], [digest, 'q']].map(([context, id]) => ({ ty: element, data: { Model: { kind: 'model_reference', context, element: id } } })) } }];
  const result = await parity(page, { ...params, arguments: args, reference_contexts: [reference, other] }); expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.evaluation.value.data.Collection.map(v => [v.data.Model.context, v.data.Model.element])).toEqual([[digest, 'd'], [otherDigest, 'd'], [digest, 'q'], [digest, 'b'], [digest, 'c'], [otherDigest, 'b'], [otherDigest, 'c'], [digest, 'e'], [otherDigest, 'e']]);
  for (const body of ['fn run()->OrderedSet<Int> =closure([1],|n:Int|[n]);', 'fn run(x:m.Base)->OrderedSet<m.Base> =closure([x],|n:m.Base|["bad"]);']) expect((await parity(page, makeParams(body), true)).ok).toBe(false);
});


test('graph composition cancellation and exact resource boundaries agree across hosts', async ({ page }) => {
  test.setTimeout(240000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const source = sourceFixture;
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/projection.ecore', import.meta.url), 'utf8').replace('name="children" upperBound="-1"', 'name="children" upperBound="-1" unique="false"');
  const model = source('memory:composition-control.ecore', 'ecore', text);
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const namespace = 'urn:intersect:navigation';
  const types = [0, 3].map(n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false }));
  const selected = { bundle, entry: model.id, namespace, types, instances: [{ id: 'd', type: types[1] }, { id: 'b', type: types[0] }], edits: [['d', 'children', ['b', 'b']], ['b', 'children', ['d']]] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
  const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: types, model: modeled.model };
  const before = structuredClone(reference);
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  // Literal fixture totals, derived from its exact wire fields and published
  // metadata charges: 2215 encoded bytes, 2286 typed metadata bytes (including the
  // model's 851 metadata bytes, with bare migrated Rcore names, and its explicit resource record). The record adds
  // 145 JSON-model metadata bytes: resources key 11, map/key 23, record 2,
  // record keys 63, URI 21, roots 8, revision 3, Loaded string 8,
  // diagnostics 2, null source 4.
  // No second accounting traversal runs in this test.
  expect(Buffer.byteLength(JSON.stringify(reference))).toBe(2215);
  const referenceMetadataBytes = 2286;
  const defaults = {
    scalar: { max_steps: 100000, max_value_bytes: 4194304, values: { max_value_bytes: 262144, max_digits: 4096 }, numeric: { max_digits: 4096, max_intermediate_digits: 8192, max_scale_alignment: 4096, max_value_bytes: 262144, max_total_value_bytes: 1048576, max_work: 16777216 } },
    max_frames: 256, max_closures: 65536, max_captures: 65536, max_value_nodes: 65536, max_value_depth: 64,
    max_collection_comparisons: 1048576, max_trace_frames: 256, max_trace_bytes: 65536, max_model_contexts: 8,
    max_reference_domains: 128, max_context_bytes: 16777216, max_model_elements: 100000, max_membership_checks: 1048576,
    max_provider_evidence_bytes: 65536, max_provider_invocations: 1048576, max_provider_work: 1048576,
  };
  for (const [expression, expected] of [
    ['map(closure([x],|n:m.Base|n.children),|n|n)', ['d', 'b']],
    ['Sequence(filter(closure([x],|n:m.Base|n.children),|n|n!=x))', ['b']],
    ['flatMap(closure([x],|n:m.Base|n.children),|n|n.children)', ['b', 'b', 'd']],
    ['fold(closure([x],|n:m.Base|n.children),Sequence::<m.Base>([]),|a,n|union(a,[n]))', ['d', 'b']],
    ['[for n in closure([x],|n:m.Base|n.children), child in n.children where child!=x yield child]', ['b', 'b']],
    ['Sequence(closure([x],|n:m.Base|closure(n.children,|child|child.children)))', ['d', 'b']],
  ]) {
    const entry = source('memory:composition-control-behavior.rcore', 'rcore_behavior', `rcore 1;package composition_control version "1";import model "${namespace}" as m;fn run(x:m.Base)->Sequence<m.Base> =${expression};`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
    const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
    const parameter = compiled.program.functions[compiled.program.entry].parameters[0];
    const request = { ...params, expected_program: compiled.program, arguments: [{ ty: parameter, data: { Model: { kind: 'model_reference', context: digest, element: 'd' } } }], reference_contexts: [reference] };
    const baseline = await parity(page, request); expect(baseline.ok).toBe(true);
    expect(baseline.evaluation.value.data.Collection.map(v => v.data.Model.element)).toEqual(expected);
    const transcript = await page.evaluate(async params => {
      const { loadRuntime } = await import('/src/runtime.js'); const invoke = await loadRuntime();
      const requests = [], responses = [];
      const send = request => {
        requests.push(request); let response;
        try { response = invoke(request); } catch (error) { response = { error: error.message }; }
        responses.push(response); return response;
      };
      const start = () => send({ ...params, method: 'rcore_behavior/startFunction' });
      const first = start(); const namespace = first.job.slice(0, first.job.lastIndexOf(':'));
      const resume = (job, quantum) => send({ method: 'rcore_behavior/resumeFunction', job, quantum });
      let complete = first, units = 0;
      while (complete.pending) { complete = resume(first.job, 1); if (++units > 10000) throw new Error('Composition did not terminate'); }
      const cancellations = [];
      // Five representative boundaries per operator, reached with three quanta.
      // This is not enumeration of every possible pending browser boundary.
      for (const stop of [...new Set([0, 1, Math.floor(units / 2), units - 2, units - 1])]) {
        const outcomes = [], terminal = [];
        for (const quantum of [1, 3, 4096]) {
          const job = start(); let advanced = 0;
          while (advanced < stop) { const slice = Math.min(quantum, stop - advanced); if (!resume(job.job, slice).pending) throw new Error('Completed before composition cancellation'); advanced += slice; }
          outcomes.push(send({ method: 'rcore_behavior/cancelFunction', job: job.job }));
          terminal.push(resume(job.job, 1));
        }
        cancellations.push({ outcomes, terminal });
      }
      const recovered = [];
      for (const quantum of [1, 3, 4096]) {
        let response = start(); const job = response.job; let slices = 0;
        while (response.pending) { response = resume(job, quantum); if (++slices > 10000) throw new Error('Composition recovery did not terminate'); }
        recovered.push(response);
      }
      return { requests: [{ method: 'rcore_behavior/jobHost', namespace }, ...requests], responses, complete, cancellations, recovered };
    }, request);
    const nativeTranscript = nativeJobs(transcript.requests);
    expect(nativeTranscript.slice(1)).toEqual(transcript.responses);
    expect(transcript.complete.result).toEqual(baseline);
    for (const { outcomes, terminal } of transcript.cancellations) {
      expect(outcomes[0].result.failure.kind).toBe('Cancelled');
      expect(outcomes[1]).toEqual(outcomes[0]); expect(outcomes[2]).toEqual(outcomes[0]);
      for (const response of terminal) expect(response).toEqual({ error: 'Unknown, stale or foreign function job' });
    }
    expect(transcript.cancellations.some(({ outcomes }) => outcomes[0].result.failure.consumed.collection_comparisons > 0)).toBe(true);
    for (const recovered of transcript.recovered) expect(recovered).toEqual(transcript.complete);
    for (const [path, amount] of [
      [['scalar', 'max_steps'], baseline.evaluation.consumed.steps],
      [['scalar', 'max_value_bytes'], baseline.evaluation.consumed.value_bytes],
      [['max_collection_comparisons'], baseline.evaluation.consumed.collection_comparisons],
      [['max_provider_work'], baseline.evaluation.consumed.provider_work],
      [['max_model_storage_bytes'], baseline.evaluation.consumed.model_storage_bytes],
      [['max_context_bytes'], referenceMetadataBytes],
      [['max_model_elements'], baseline.evaluation.consumed.model_elements],
      [['max_membership_checks'], baseline.evaluation.consumed.membership_checks],
      [['max_reference_domains'], baseline.evaluation.consumed.reference_domains],
      [['max_model_contexts'], baseline.evaluation.consumed.model_contexts],
    ]) {
      expect(amount).toBeGreaterThan(0);
      for (const allowance of [...new Set([0, amount - 1, amount, amount + 1])]) {
        const limits = structuredClone(defaults); let owner = limits;
        for (const segment of path.slice(0, -1)) owner = owner[segment];
        owner[path.at(-1)] = allowance;
        const result = await parity(page, { ...request, execution_limits: limits });
        expect(result.ok, `${expression} ${path.join('.')}=${allowance}: ${JSON.stringify(result)}`).toBe(allowance >= amount);
        if (result.ok) expect(result.evaluation).toEqual(baseline.evaluation);
        else {
          expect(result.failure.kind).toBe('ResourceExhausted'); expect(result.evaluation).toBeUndefined();
          if (path[0] === 'max_model_storage_bytes') {
            expect(result.failure.message).toBe('Retained model storage limit exceeded');
            expect(result.failure.consumed.model_storage_bytes).toBeLessThanOrEqual(allowance);
            if (allowance === 0) expect(result.failure.consumed.model_storage_bytes).toBe(0);
          }
        }
      }
    }
    expect((await parity(page, request)).evaluation).toEqual(baseline.evaluation);
    if (expression === 'map(closure([x],|n:m.Base|n.children),|n|n)') {
      const raised = { ...request, execution_limits: { ...defaults, max_model_storage_bytes: 16777217 } };
      await expect(page.evaluate(params => window.workbench.request('intersect/evaluateFunctionRcore', params), raised)).rejects.toThrow('host safety ceiling');
      expect(() => native({ ...raised, method: 'rcore_behavior/evaluateFunction' })).toThrow('host safety ceiling');
    }
    expect(reference).toEqual(before);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('graph closure matches the pinned Mercurio membership projection across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const fixture = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/mercurio-closure.json', import.meta.url), 'utf8'));
  const excerpt = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/mercurio-closure-source.rs.txt', import.meta.url));
  expect(createHash('sha256').update(excerpt).digest('hex')).toBe(fixture.provenance.excerpt_sha256);
  const source = sourceFixture;
  const model = source('memory:mercurio-closure.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/mercurio-closure.ecore', import.meta.url), 'utf8'));
  const bundle = { version: 1, sources: [model], namespaces: [] }; const namespace = 'urn:intersect:mercurio-redefinition-projection';
  const type = { kind: 'classifier', declaration: fixtureDeclaration(model, [0]), arguments: [], raw: false };
  const entry = source('memory:mercurio-closure-behavior.rcore', 'rcore_behavior', `rcore 1;package redefinition_projection version "1";import model "${namespace}" as m;fn run(x:m.Feature)->OrderedSet<m.Feature> =closure([x],|f|f.redefined);`, [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true); const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  for (const testCase of fixture.cases) {
    const selected = { bundle, entry: model.id, namespace, types: [type], instances: testCase.features.map(f => ({ id: f.id, type })) };
    const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
    expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
    for (const f of testCase.features) modeled.model.elements.find(e => e.id === f.id).values.redefined = f.redefined;
    const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: [type], model: modeled.model };
    const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
    const result = await parity(page, { ...params, expected_program: compiled.program, arguments: [{ ty, data: { Model: { kind: 'model_reference', context: digest, element: testCase.seed } } }], reference_contexts: [reference] });
    expect(result.ok, JSON.stringify(result)).toBe(true); expect(result.evaluation.value.data.Collection.map(v => v.data.Model.element).sort()).toEqual(testCase.expected_membership);
  }
});

test('graph closure propagates pinned Mercurio required endpoint failures and repairs across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const fixture = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/mercurio-prerequisite.json', import.meta.url), 'utf8'));
  const parent = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/mercurio-closure.json', import.meta.url), 'utf8'));
  const excerpt = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/mercurio-closure-source.rs.txt', import.meta.url));
  expect(createHash('sha256').update(excerpt).digest('hex')).toBe(fixture.provenance.excerpt_sha256);
  expect(fixture.provenance.revision).toBe(parent.provenance.revision);
  expect(fixture.relationship).not.toHaveProperty(fixture.missing_endpoint);
  const source = sourceFixture;
  const model = source('memory:mercurio-prerequisite.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/mercurio-prerequisite.ecore', import.meta.url), 'utf8'));
  const entry = source('memory:mercurio-prerequisite-behavior.rcore', 'rcore_behavior', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/mercurio-prerequisite-behavior.rcore', import.meta.url), 'utf8'), [model.id]);
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const namespace = 'urn:intersect:mercurio-prerequisite-projection';
  const type = n => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: [], raw: false });
  const types = [type(0), type(1)];
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, selection: { symbol: { source: entry.id, declaration: 1 }, types: [], arguments: [] } };
  const compiled = await parity(page, params, true); expect(compiled.ok).toBe(true);
  const ty = compiled.program.functions[compiled.program.entry].parameters[0];
  const selected = { bundle, entry: model.id, namespace, types,
    instances: [...fixture.features.map(f => ({ id: f.id, type: types[0] })), { id: fixture.relationship.id, type: types[1] }],
    edits: [...fixture.features.map(f => [f.id, 'owned_relationship', f.owned_relationship]),
      [fixture.relationship.id, 'redefining_feature', fixture.relationship.redefining_feature],
      [fixture.relationship.id, 'redefined_feature', fixture.repairs[0].redefined_feature]] };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok, JSON.stringify(modeled)).toBe(true);
  const invalid = structuredClone(modeled.model);
  const relation = invalid.elements.find(e => e.id === fixture.relationship.id);
  delete relation.values[fixture.missing_endpoint];
  const before = JSON.stringify(invalid);
  // ReferenceContext.model is serde_json::Value: object keys serialize in sorted
  // order, including a required endpoint reinserted after the invalid snapshot.
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const run = async snapshot => {
    const reference = { bundle, entry: model.id, namespace, conversions: [], materialized_types: types, model: canonical(snapshot) };
    const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
    return parity(page, { ...params, expected_program: compiled.program,
      arguments: [{ ty, data: { Model: { kind: 'model_reference', context: digest, element: fixture.seed } } }], reference_contexts: [reference] });
  };
  for (let n = 0; n < fixture.rejected_attempts; n++) {
    const result = await run(invalid);
    expect(result.ok).toBe(false);
    expect(result.failure.kind).toBe('Nominal');
    expect(result.failure.message).toBe(`Multiplicity violation: ${relation.class}.${fixture.missing_endpoint}`);
    expect(result.failure.consumed_providers).toEqual([]);
    expect(JSON.stringify(invalid)).toBe(before);
  }
  for (const repair of fixture.repairs) {
    let repaired = structuredClone(invalid);
    repaired.elements.find(e => e.id === fixture.relationship.id).values[fixture.missing_endpoint] = repair.redefined_feature;
    for (const reload of [false, true]) {
      if (reload) { repaired = JSON.parse(JSON.stringify(repaired)); repaired.elements.reverse(); }
      const result = await run(repaired);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.evaluation.value.data.Collection.map(v => v.data.Model.element).sort()).toEqual(repair.expected_membership);
    }
  }
});

test('symbolic inverse queries specialize invariant domains across hosts', async ({ page }) => {
  test.setTimeout(120000);
  const source = sourceFixture;
  const model = source('memory:generic-navigation.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-navigation/generic.ecore', import.meta.url), 'utf8'));
  const bundle = { version: 1, sources: [model], namespaces: [] };
  const type = (n, args = []) => ({ kind: 'classifier', declaration: fixtureDeclaration(model, [n]), arguments: args, raw: false });
  const types = [type(0), type(1), type(2,[type(1)]), type(3,[type(1)]), type(2,[type(0)]), {...type(2), raw:true}];
  const selected = { bundle, entry: model.id, namespace: 'urn:generic-navigation', types, instances: [['leaf',1],['child',3],['box',2],['foreign',4],['empty',2],['raw',5]].map(([id,n]) => ({ id, type: types[n] })) };
  const modeled = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), selected);
  expect(modeled).toEqual(native({ method: 'ecore/materialize', ...selected })); expect(modeled.ok).toBe(true);
  for (const e of modeled.model.elements) if (['child','box','foreign','raw'].includes(e.id)) { e.values.value = 'leaf'; e.values.items = ['leaf','leaf']; }
  const reference = { bundle, entry: model.id, namespace: 'urn:generic-navigation', conversions: [], materialized_types: types, model: modeled.model };
  const digest = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
  for (const [selectedType, ids] of [['Box',['child','box']],['Child',['child']]]) for (const field of ['value','items']) {
    const body = `fn run(x:m.Leaf)->OrderedSet<m.${selectedType}<m.Leaf>> =walk(x);fn walk<T:m.Base>(x:T)->OrderedSet<m.${selectedType}<T>> =incoming::<m.${selectedType}<T>>(x,"${field}");`;
    const entry = source('memory:generic-navigation-behavior.rcore','rcore_behavior',`rcore 1;package navigation version "1";import model "urn:generic-navigation" as m;${body}`,[model.id]);
    const params = { bundle: { version:1, sources:[model,entry], namespaces:[] }, entry:entry.id, selection:{symbol:{source:entry.id,declaration:1},types:[],arguments:[]} };
    const compiled = await parity(page,params,true); expect(compiled.ok,JSON.stringify(compiled)).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const result = await parity(page,{...params,expected_program:compiled.program,arguments:[{ty,data:{Model:{kind:'model_reference',context:digest,element:'leaf'}}}],reference_contexts:[reference]});
    expect(result.ok,JSON.stringify(result)).toBe(true);
    expect(result.evaluation.value.data.Collection.map(v=>v.data.Model.element)).toEqual(ids);
  }

  const resultIds = value => value.data === 'None' ? [] : value.data.Some ? resultIds(value.data.Some) : value.data.Collection ? value.data.Collection.flatMap(resultIds) : [value.data.Model.element];
  for (const [body, id, expected] of [
    ['fn run(x:m.Child<m.Leaf>)->Option<m.Leaf> =read(x);fn read<T:m.Base>(x:m.Child<T>)->Option<T> =x.value;', 'child', ['leaf']],
    ['fn run(x:m.Child<m.Leaf>)->Sequence<m.Leaf> =read(x);fn read<T:m.Base>(x:m.Child<T>)->Sequence<T> =Sequence(x.items);', 'child', ['leaf','leaf']],
    ['fn run(x:m.Box)->Option<m.Base> =x.value;', 'raw', ['leaf']],
    ['fn run(x:m.Box)->Sequence<m.Base> =Sequence(x.items);', 'raw', ['leaf','leaf']],
    ['fn run(x:m.Box)->Option<m.Base> =x.value;', 'child', ['leaf']],
    ['fn run(x:m.Leaf)->OrderedSet<m.Box> =incoming::<m.Box>(x,"items");', 'leaf', ['child','box','foreign','raw']],
    ['fn run(x:m.Leaf)->OrderedSet<m.Box> =incoming::<m.Box>(x,"value");', 'leaf', ['child','box','foreign','raw']],
  ]) {
    const entry = source('memory:generic-navigation-behavior.rcore','rcore_behavior',`rcore 1;package navigation version "1";import model "urn:generic-navigation" as m;${body}`,[model.id]);
    const params = { bundle:{version:1,sources:[model,entry],namespaces:[]}, entry:entry.id, selection:{symbol:{source:entry.id,declaration:1},types:[],arguments:[]} };
    const compiled = await parity(page,params,true); expect(compiled.ok,JSON.stringify(compiled)).toBe(true);
    const ty = compiled.program.functions[compiled.program.entry].parameters[0];
    const result = await parity(page,{...params,expected_program:compiled.program,arguments:[{ty,data:{Model:{kind:'model_reference',context:digest,element:id}}}],reference_contexts:[reference]});
    expect(result.ok,JSON.stringify(result)).toBe(true); expect(resultIds(result.evaluation.value)).toEqual(expected);
  }
});
