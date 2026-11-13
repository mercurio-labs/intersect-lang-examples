import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { generatePythonApi } from '../src/python-api.js';
import { migratedFixtureRequest, migrateDefinitionFixture, fixtureDeclaration } from './migration-fixtures.js';

function sourceFixture(uri,kind,text,dependencies=[]) {
  const original={id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies};
  return kind === 'ecore' ? migrateDefinitionFixture(original,nativeOracle) : original;
}

function nativeOracle(request) {
  const executable = process.env.INTERSECT_TEST_NATIVE_ORACLE;
  return JSON.parse(execFileSync(executable || 'cargo', executable ? [] : ['run','-q','-p','intersect-web','--example','rcore_behavior_parse','--locked'], {
    cwd:new URL('../.runtime/intersect-text/',import.meta.url),input:JSON.stringify(request),encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,
  }));
}
function migratedCompilationFixture(compilation) {
  const prepared=migratedFixtureRequest({method:'fixture/compileBundle',compilation},nativeOracle);
  expect(prepared.result,JSON.stringify(prepared.result)).toBeUndefined();
  return prepared.request.compilation;
}

function canonicalFixtureParams(original) {
  const prepared = migratedFixtureRequest({method:'fixture/compile',...original},nativeOracle);
  if (prepared.result) throw new Error(JSON.stringify(prepared.result));
  const canonical=prepared.request;
  for (const field of ['conversions','applied_conversions','constructors']) {
    if (Array.isArray(original[field])) original[field].splice(0,original[field].length,...canonical[field]);
  }
  return canonical;
}

async function compileMigratedFixture(page, text) {
  const migration = await page.evaluate(text => window.workbench.request('intersect/migrateEcore', {uri:'memory:ecore',text,target_uri:'memory:model.rcore'}), text);
  expect(migration.ok, JSON.stringify(migration)).toBe(true);
  await page.evaluate(async text => {window.workbench.definitionModels.rcore.setValue(text); await window.workbench.compile();}, migration.report.converted.text);
}

function canonicalTyping(packageValue, entry, text, conversions) {
  const model = packageValue.compilation.bundle.sources.find(s => s.id.uri === packageValue.compilation.ecore.uri && s.id.sha256 === packageValue.compilation.ecore.sha256);
  return {bundle:{version:1,sources:[model,{id:entry,kind:'rcore_behavior',text,dependencies:[model.id]}],namespaces:[]},entry,conversions};
}

function migratedSourceFixture(original) {
  const migrated = nativeOracle({method:'ecore/migrate',uri:original.id.uri,text:original.text,target_uri:original.id.uri+'.rcore'});
  expect(migrated.ok, JSON.stringify(migrated)).toBe(true);
  const ids = new Map(migrated.report.correspondence.map(row=>[JSON.stringify(row.original.path),row.converted]));
  return {source:migrated.report.converted, id:path=>{
    const value=ids.get(JSON.stringify(path));
    if (!value) throw new Error('Missing migrated fixture declaration '+JSON.stringify(path));
    return value;
  }};
}

// Original Ecore qualification uses explicit migration and its matching semantic fixture, independently
// of the curated starter's typed inline Rcore behavior and multiplicities.
async function loadMigratedLibrary(page) {
  const definitions = Object.fromEntries(Object.entries({ecore:'library.ecore',xtext:'library.xtext',rcore_behavior:'library-behavior.rcore'}).map(([kind,file]) =>
    [kind, readFileSync(new URL(`../.runtime/intersect-text/fixtures/library/${file}`, import.meta.url), 'utf8')]));
  await page.evaluate(async definitions => {
    const w = window.workbench;
    const migration = await w.request('intersect/migrateEcore', {uri:'memory:library.ecore',text:definitions.ecore,target_uri:'memory:library.rcore'});
    if (!migration.ok) throw new Error(JSON.stringify(migration));
    definitions.rcore = migration.report.converted.text;
    delete definitions.ecore;
    for (const [kind, text] of Object.entries(definitions)) w.definitionModels[kind].setValue(text);
    await window.workbench.compile();
  }, definitions);
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
}

test('generic materialization constructs and validates native WASM models', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/materialize.ecore', import.meta.url), 'utf8');
  const {source, id} = migratedSourceFixture({ id: { uri: 'memory:materialize', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] });
  const type = n => ({ kind: 'classifier', declaration: id([n]), arguments: [], raw: false });
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [target, ok] of [['v', true], ['o', false]]) {
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, types: [type(3), type(0), type(1)], instances: [{id:'v',type:type(0)},{id:'o',type:type(1)},{id:'b',type:type(3)}], edits: [['b','value',target]] };
    const native = nativeOracle({ method: 'ecore/materialize', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok);
    if (ok) {
      expect(browser.profile).toBe('explicit_closed_set');
      expect(browser.model.elements.find(e => e.id === 'v').values.name).toBe('new');
      expect(browser.model.elements.find(e => e.id === 'b').values.value).toBe('v');
      expect(Object.keys(browser.schema.instantiations)).toHaveLength(1);
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('generic opposite materialization shares native WASM reciprocal links', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/materialize-opposites.ecore', import.meta.url), 'utf8');
  const {source, id} = migratedSourceFixture({ id: { uri: 'memory:opposites', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] });
  const type = (n, args = []) => ({ kind: 'classifier', declaration: id([n]), arguments: args, raw: false });
  const valueBox = type(2, [type(0)]), otherBox = type(2, [type(1)]);
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [target, ok] of [['c', true], ['o', false]]) {
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, types: [type(0), type(1), type(3), valueBox, otherBox], instances: [{ id: 'p', type: valueBox }, { id: 'c', type: type(3) }, { id: 'o', type: otherBox }], edits: [['p', 'children', [target]]] };
    const native = nativeOracle({ method: 'ecore/materialize', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), params);
    expect(browser).toEqual(native);
    expect(browser.ok).toBe(ok);
    if (ok) {
      expect(browser.model.elements.find(e => e.id === 'c').values.parent).toBe('p');
      expect(browser.model.elements.find(e => e.id === 'p').values.children).toEqual(['c']);
      expect(Object.keys(browser.schema.instantiations)).toHaveLength(2);
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('generic attribute materialization uses the same native WASM conversion catalog', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/materialize-conversions.ecore', import.meta.url), 'utf8');
  const {source, id} = migratedSourceFixture({ id: { uri: 'memory:colors', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] });
  const datatype = id([0]);
  const provider = { name: 'example.rgb', version: '1' };
  const receiver = { kind: 'classifier', declaration: id([1]), arguments: [{ kind: 'classifier', declaration: datatype, arguments: [], raw: false }], raw: false };
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const scenario of ['valid', 'missing', 'invalid']) {
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, types: [receiver], instances: [{ id: 'h', type: receiver }] };
    if (scenario !== 'missing') params.conversions = [{ datatype, provider, serializable: true }];
    if (scenario === 'invalid') params.edits = [['h', 'color', { kind: 'converted', datatype, provider, value: { red: 256, green: 0, blue: 0 } }]];
    const native = nativeOracle({ method: 'ecore/materialize', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), params);
    expect(browser).toEqual(native);
    expect(browser.ok).toBe(scenario === 'valid');
    if (scenario === 'valid') {
      expect(browser.model.elements[0].values.color.value).toEqual({ red: 18, green: 58, blue: 188 });
      expect(browser.schema.conversion_contracts).toEqual(params.conversions);
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('explicit generic operation arguments preserve native WASM bound evidence', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/members.ecore', import.meta.url), 'utf8');
  const source = { id: { uri: 'memory:operations', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] };
  const type = n => ({ kind: 'classifier', declaration: { source: source.id, path: [n] }, arguments: [], raw: false });
  const initial = await page.evaluate(() => window.workbench.inspect());
  const stale = type(0); stale.declaration = { source: { ...source.id, sha256: '0'.repeat(64) }, path: [0] };
  for (const [args, ok] of [[[type(0)], true], [[type(3)], false], [[], false], [[stale], false]]) {
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, receiver: type(2), operation: { source: source.id, path: [1, 2] }, arguments: args };
    const native = nativeOracle({ method: 'ecore/generic-operation-types', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/instantiateGenericOperation', params), params);
    expect(browser).toEqual(native);
    expect(browser.ok).toBe(ok);
    expect(browser.executable).toBe(false);
    expect(browser.selection_verified).toBe(false);
    if (ok) {
      expect(browser.report.argument_bounds[0].satisfied).toBe(true);
      expect(browser.report.operation.formals[0].declaration.declaration.path).toEqual([1, 2, 0]);
      for (const signature of browser.report.operation.signatures) {
        for (const value of signature.specialized) expect(value).toEqual(type(0));
      }
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('generic bundles activate and execute text through the existing worker pipeline', async ({ page }) => {
  test.setTimeout(120000);
  const compilation = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/language-bundle-canonical.json', import.meta.url), 'utf8'));
  const native = request => nativeOracle(request);
  const compiled = native({ method: 'compile_bundle', compilation });
  expect(compiled.ok).toBe(true);
  const accepted = await page.evaluate(compilation => window.workbench.compileBundle(compilation), compilation);
  expect(accepted.ok).toBe(true);
  expect(accepted.package).toEqual(compiled.package);
  const sources = await page.evaluate(() => {
    window.workbench.modelModels.catalog.setValue('root { value v; }');
    window.workbench.modelModels.loans.setValue('root { box v; }');
    return Object.values(window.workbench.modelModels).map(m => ({ uri: m.uri.toString(), text: m.getValue() }));
  });
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  await expect(page.locator('#element-count')).toHaveText('4 elements');
  const active = await page.evaluate(() => window.workbench.inspect());
  const evaluated = native({ method: 'evaluate', package: compiled.package, sources });
  expect(active.evaluation).toEqual(evaluated);
  expect(active.evaluation.references).toHaveLength(1);
  expect(Object.values(active.evaluation.derived).some(d => d.valueCount === 1)).toBe(true);
  const stale = structuredClone(compilation);
  stale.materialized_types[0].declaration.source.sha256 = '0'.repeat(64);
  const failed = await page.evaluate(compilation => window.workbench.compileBundle(compilation), stale);
  expect(failed.ok).toBe(false);
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after.revision).toBe(active.revision);
  expect(after.package).toEqual(active.package);
  expect(after.evaluation).toEqual(active.evaluation);
});

test('requested generic instances recheck exact declarations without a source application', async ({ page }) => {
  test.setTimeout(120000);
  const fixture = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/members.ecore', import.meta.url), 'utf8');
  const text = fixture.split('<eClassifiers x:type="e:EClass" name="Child"')[0] + '</e:EPackage>';
  const source = { id: { uri: 'memory:template', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] };
  const classifier = (path, arguments_ = []) => ({ kind: 'classifier', declaration: { source: source.id, path }, arguments: arguments_, raw: false });
  const receiver = classifier([1], [classifier([0])]);
  const stale = structuredClone(receiver); stale.arguments[0].declaration.source.sha256 = '1'.repeat(64);
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [requested, ok] of [[receiver, true], [classifier([1]), false], [stale, false]]) {
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, receiver: requested };
    const native = nativeOracle({ method: 'ecore/generic-instantiate-members', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/instantiateGenericMembers', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok);
    expect(browser.executable).toBe(false); expect(browser.selection_verified).toBe(false);
    if (ok) {
      expect(browser.report.receiver).toEqual(receiver);
      expect(browser.report.members).toHaveLength(2);
      expect(browser.report.members[0].signatures[0].specialized[0]).toEqual(classifier([0]));
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('generic member projection preserves native WASM identities and operation-local formals', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/members.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [sourceText, ok] of [[text, true], [text.replace('e:EReference" name="value', 'e:EAttribute" name="value'), false]]) {
    const source = { id: { uri: 'memory:members', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] };
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: { source: source.id, path: [3,0,0] } };
    const native = nativeOracle({ method: 'ecore/generic-member-types', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/genericMemberTypes', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok);
    expect(browser.executable).toBe(false); expect(browser.selection_verified).toBe(false);
    if (ok) {
      expect(browser.report.members).toHaveLength(2);
      const [feature, operation] = browser.report.members;
      expect(feature.signatures[0].specialized[0].declaration.path).toEqual([0]);
      expect(feature.declaration.path).toEqual([1,1]);
      expect(operation.signatures[0].specialized[0].declaration.path).toEqual([1,2,0]);
      expect(operation.formals[0].bounds[0].declaration.path).toEqual([0]);
    } else expect(browser.diagnostics[0].span.source).toEqual(source.id);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('closed nominal generic bounds agree across native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/bounds.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [sourceText, ok] of [
    [text, true],
    [text.replace('<eGenericType eClassifier="#//Box"><eTypeArguments eClassifier="#//Good"/>', '<eGenericType eClassifier="#//Box"><eTypeArguments eClassifier="#//Bad"/>'), false],
    [text.replace('<eGenericSuperTypes eClassifier="#//Comparable"><eTypeArguments eClassifier="#//Good"/>', '<eGenericSuperTypes eClassifier="#//Comparable"><eTypeArguments eClassifier="#//Bad"/>'), false],
  ]) {
    const source = { id: { uri: 'memory:bounds', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] };
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: { source: source.id, path: [4,0,0] } };
    const native = nativeOracle({ method: 'ecore/generic-application-bounds', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/checkGenericApplicationBounds', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok);
    expect(browser.report.valid).toBe(ok); expect(browser.profile).toBe('nominal_with_raw_warnings');
    expect(browser.executable).toBe(false);
    expect(browser.report.checks).toHaveLength(1);
    expect(browser.report.checks[0].satisfied).toBe(ok);
    expect(browser.report.checks[0].declared_bound.span.source).toEqual(source.id);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('open parameter bounds preserve nominal identities across native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/open-bounds.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [sourceText, ok] of [
    [text, true],
    [text.replace('<eBounds eClassifier="#//Good"/>', ''), false],
    [text.replace('<eBounds eClassifier="#//Good"/>', '<eBounds eClassifier="#//Other"/>'), false],
  ]) {
    const source = { id: { uri: 'memory:bounds', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] };
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: { source: source.id, path: [4,1,0] } };
    const native = nativeOracle({ method: 'ecore/generic-application-bounds', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/checkGenericApplicationBounds', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok);
    expect(browser.report.valid).toBe(ok); expect(browser.profile).toBe('nominal_with_raw_warnings');
    expect(browser.executable).toBe(false);
    expect(browser.report.checks).toHaveLength(1);
    expect(browser.report.checks[0].satisfied).toBe(ok);
    expect(browser.report.checks[0].argument).toEqual({ kind: 'parameter', declaration: { source: source.id, path: [4,0] } });
    expect(browser.report.checks[0].declared_bound.span.source).toEqual(source.id);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('raw application warnings and ancestor bounds agree across native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/raw-bounds.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [sourceText, ok] of [
    [text, true],
    [text.replace('<eBounds eClassifier="#//Good"/>', ''), false],
    [text.replace('<eBounds eClassifier="#//Good"/>', '<eBounds eClassifier="#//Use"/>'), false],
  ]) {
    const source = { id: { uri: 'memory:bounds', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] };
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: { source: source.id, path: [4,0,0] } };
    const native = nativeOracle({ method: 'ecore/generic-application-bounds', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/checkGenericApplicationBounds', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok);
    expect(browser.report.valid).toBe(ok); expect(browser.profile).toBe('nominal_with_raw_warnings');
    expect(browser.executable).toBe(false);
    expect(browser.report.selected.expression.raw).toBe(true);
    expect(browser.report.warnings).toHaveLength(1);
    expect(browser.report.warnings[0].code).toBe('raw_type');
    expect(browser.report.warnings[0].span.source).toEqual(source.id);
    expect(browser.report.checks).toHaveLength(1);
    expect(browser.report.checks[0].satisfied).toBe(ok);
    expect(browser.report.checks[0].argument).toEqual({ kind: 'parameter', declaration: { source: source.id, path: [3,0] } });
    expect(browser.report.checks[0].declared_bound.span.source).toEqual(source.id);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('generic inheritance specializes diamonds identically in native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/inheritance.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [sourceText, ok, raw = false] of [
    [text, true],
    [text.replace('<eTypeArguments eClassifier="#//Value"/>', ''), true, true],
    [text.replace('eClassifier="#//Base"', 'eClassifier="#//Diamond"'), false],
    [text.replace('<eGenericSuperTypes eClassifier="#//Left"><eTypeArguments eTypeParameter="#//Diamond/W"/></eGenericSuperTypes>', edge => edge + edge), false],
    [text.replace('<eGenericSuperTypes eClassifier="#//Right"><eTypeArguments eTypeParameter="#//Diamond/W"/></eGenericSuperTypes>', '<eGenericSuperTypes eClassifier="#//Right"><eTypeArguments eClassifier="#//Other"/></eGenericSuperTypes>'), false],
  ]) {
    const source = { id: { uri: 'memory:inheritance', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] };
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: { source: source.id, path: [6,0,0] } };
    const native = nativeOracle({ method: 'ecore/generic-inheritance', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/genericInheritance', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok);
    expect(browser.bounds_verified).toBe(false); expect(browser.executable).toBe(false);
    if (ok) {
      expect(browser.report.supertypes.map(t => t.expression.declaration.path)).toEqual([[3],[2],[4]]);
      for (const type of browser.report.supertypes) {
        expect(type.expression.arguments[0].kind).toBe(raw ? 'parameter' : 'classifier');
        expect(type.expression.arguments[0].declaration.path).toEqual(raw ? [5,0] : [0]);
      }
      expect(browser.report.receiver.expression.raw).toBe(raw);
    } else expect(browser.diagnostics[0].span.source).toEqual(source.id);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('source checked substitution matches native reports without replacing the active language', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/signatures.ecore', import.meta.url), 'utf8');
  const source = { id: { uri: 'memory:generics', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] };
  const id = path => ({ source: source.id, path });
  const initial = await page.evaluate(() => window.workbench.inspect());
  const good = { parameter: id([1,0]), argument: id([2,1,0]) };
  for (const [bindings, ok] of [
    [[], true], [[good], true],
    [[{ parameter: id([1,0]), argument: id([1,0,0]) }], false],
    [[{ parameter: id([1]), argument: id([2,1,0]) }], false],
    [[good, good], false],
    [[{ parameter: id([1,0]), argument: { source: { ...source.id, sha256: '0'.repeat(64) }, path: [2,1,0] } }], false],
  ]) {
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: id([1,1,0]), bindings };
    const native = nativeOracle({ method: 'ecore/generic-substitute', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/substituteGenericType', params), params);
    expect(browser).toEqual(native);
    expect(browser.ok).toBe(ok); expect(browser.stage).toBe('generic_substitution');
    expect(browser.executable).toBe(false); expect(browser.bounds_verified).toBe(false);
    if (ok && bindings.length) {
      expect(browser.report.expression.kind).toBe('classifier');
      expect(browser.report.expression.arguments[0].kind).toBe('wildcard');
      expect(browser.report.arguments[0].declaration).toEqual(good.argument);
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('generic signatures preserve native WASM reports and the active package', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/signatures.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [sourceText, path, parameter, ok] of [
    [text, [1, 0], true, true], [text, [1, 2, 1], false, true],
    [text, [2, 0, 0], false, true], [text, [2, 1, 0], false, true],
    [text.replace('#//Box/convert/U', '#//Comparable/T'), [1, 2, 1], false, false],
    [text.replace('<eTypeArguments/>', '<eTypeArguments/><eTypeArguments/>'), [2, 1, 0], false, false],
  ]) {
    const source = { id: { uri: 'memory:generics', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] };
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: { source: source.id, path } };
    const method = parameter ? 'ecore/generic-parameter' : 'ecore/generic-type';
    const native = nativeOracle({ method, ...params });
    const browser = await page.evaluate(({ params, parameter }) => window.workbench.request(parameter ? 'intersect/checkGenericParameter' : 'intersect/checkGenericType', params), { params, parameter });
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok); expect(browser.executable).toBe(false);
    if (ok && path.join() === '2,0,0') expect(browser.report.warnings[0].code).toBe('raw_type');
    if (!ok) {
      const span = browser.diagnostics[0].span;
      expect(span.source).toEqual(source.id);
      const selected = Buffer.from(sourceText).subarray(span.start, span.end).toString('utf8');
      expect(selected).toContain(path.join() === '1,2,1' ? '#//Comparable/T' : '<eGenericType');
      expect(span.start).toBeGreaterThan(Buffer.byteLength(sourceText.slice(0, sourceText.indexOf('λ'))));
    }
  }
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after).toEqual(initial);
});

test('complete generic inventory checks unused declarations and revised sources', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/signatures.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  const make = (uri, text) => ({ id: { uri, sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] });
  const main = make('memory:generics', text);
  const empty = make('memory:empty', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" name="empty" nsURI="urn:empty"/>');
  const reports = [];
  for (const [sources, ok] of [
    [[main, empty], true], [[empty, main], true],
    [[make(main.id.uri, text.replace('name="raw"', 'name="renamed"')), empty], true],
    [[main, make('memory:unused', text.replace('urn:generics', 'urn:unused').replace('#//Box/convert/U', '#//Comparable/T'))], false],
    [[make('memory:names', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="names" nsURI="urn:names"><eClassifiers x:type="e:EClass" name="Holder"><eTypeParameters name="λ𐐀"/></eClassifiers></e:EPackage>')], true],
    [[make('memory:names', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="names" nsURI="urn:names"><eClassifiers x:type="e:EClass" name="Holder"><eTypeParameters name="T T"/></eClassifiers></e:EPackage>')], false],
  ]) {
    const params = { bundle: { version: 1, sources, namespaces: [] } };
    const native = nativeOracle({ method: 'ecore/generic-signatures', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/checkGenericSignatures', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok); expect(browser.executable).toBe(false);
    reports.push(browser);
  }
  expect(reports[0]).toEqual(reports[1]);
  expect(reports[0].report.parameters).toHaveLength(3); expect(reports[0].report.types).toHaveLength(5);
  expect(reports[2].report.sources).not.toEqual(reports[0].report.sources);
  expect(reports[3].diagnostics[0].span.source.uri).toBe('memory:unused');
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('generic raw projections reject legacy disagreement without replacing the model', async ({ page }) => {
  test.setTimeout(120000);
  const original = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/signatures.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  const valid = original.replace('name="value"', 'name="value" eType="#//Comparable"');
  for (const [text, ok] of [[valid, true], [valid.replace('eType="#//Comparable"', 'eType="#//Holder"'), false]]) {
    const source = { id: { uri: 'memory:agreement', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] };
    const params = { bundle: { version: 1, sources: [source], namespaces: [] } };
    const native = nativeOracle({ method: 'ecore/generic-signatures', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/checkGenericSignatures', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok); expect(browser.executable).toBe(false);
    if (ok) {
      const member = browser.report.raw_signatures.find(r => r.owner.path.join() === '1,1');
      expect(member.raw_types).toEqual([{ source: source.id, path: [0] }]);
      expect(member.legacy[0].href).toBe('#//Comparable');
      expect(member.generic).toEqual([{ source: source.id, path: [1, 1, 0] }]);
    } else {
      const diagnostic = browser.diagnostics[0];
      expect(diagnostic.message).toContain('disagrees');
      expect(Buffer.from(text).subarray(diagnostic.span.start, diagnostic.span.end).toString('utf8')).toBe('eType="#//Holder"');
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('concrete generic schemas execute and failed generic definition edits retain the package', async ({ page }) => {
  await loadMigratedLibrary(page);
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/library.ecore', import.meta.url), 'utf8');
  const native = request => nativeOracle(request);
  const original = await page.evaluate(() => window.workbench.inspect());
  for (const [ecore, edition] of [[text, 1], [text.replace('defaultValueLiteral="1"', 'defaultValueLiteral="3"'), 3]]) {
    await compileMigratedFixture(page, ecore);
    await expect(page.locator('#compile-status')).toContainText('Language compiled');
    const state = await page.evaluate(() => window.workbench.inspect());
    const inputs = await page.evaluate(() => ({ definitions: Object.fromEntries(Object.entries(window.workbench.definitionModels).map(([name, model]) => [name, model.getValue()])), sources: Object.values(window.workbench.modelModels).map(model => ({ uri: model.uri.toString(), text: model.getValue() })) }));
    const compiled = native({ ...inputs.definitions, method: 'compile_rcore' });
    expect(compiled.ok).toBe(true); expect(state.package).toEqual(compiled.package);
    expect(state.package.schema.generic_signatures.types.length).toBeGreaterThan(10);
    expect(state.evaluation).toEqual(native({ method: 'evaluate', package: compiled.package, sources: inputs.sources }));
    expect(state.evaluation.derived).toEqual(original.evaluation.derived);
    expect(state.evaluation.model.elements.find(e => e.values.name === 'dune').values.edition).toBe(edition);
  }
  const accepted = await page.evaluate(() => window.workbench.inspect());
  const changed = text.replace('defaultValueLiteral="1"', 'defaultValueLiteral="3"');
  for (const [invalid, message] of [
    [changed.replace('name="copy" lowerBound="1"', 'name="copy" lowerBound="1" eType="#//Member"'), 'disagrees'],
    [changed.replace('name="Named" abstract="true">', 'name="Named" abstract="true"><eTypeParameters name="T"/>'), 'E08'],
  ]) {
    const migration = await page.evaluate(text=>window.workbench.request('intersect/migrateEcore',{uri:'memory:ecore',text,target_uri:'memory:model.rcore'}),invalid);
    if (!migration.ok) {
      expect(migration.report.issues.some(issue=>issue.blocks_conversion && issue.message.includes(message))).toBe(true);
    } else {
      await page.evaluate(async text=>{window.workbench.definitionModels.rcore.setValue(text);await window.workbench.compile();},migration.report.converted.text);
      await expect(page.locator('#compile-status')).toHaveText('Definition compilation failed');
      await expect(page.locator('#diagnostic-list')).toContainText(message);
    }
    expect(await page.evaluate(() => window.workbench.inspect())).toEqual(accepted);
  }
});

test('feature references resolve actual subtype objects with native WASM parity and Python rollback', async ({ page }) => {
  test.setTimeout(150000);
  const read = name => readFileSync(new URL(`../.runtime/intersect-text/fixtures/feature-references/${name}`, import.meta.url), 'utf8');
  const conversions = JSON.parse(read('conversions-rcore.json'));
  const params = { rcore: read('references-structure.rcore'), xtext: read('references.xtext'), rcore_behavior: read('references-behavior.rcore'), conversions };
  const nativeRequest = request => nativeOracle(request);
  const native = nativeRequest({ ...params, method: 'compile_rcore' }); expect(native.ok).toBe(true);
  const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params);
  expect(browser.ok).toBe(true); expect(browser.package).toEqual(native.package);
  const feature = conversions[0].declarations[0]; const datatype = conversions[0].datatype;
  const context = conversions[0].members[0].value.context;
  const exact = context.model.elements.find(e => e.values.name === 'dune');
  const unrelated = context.model.elements.find(e => e.values.name === 'ada');
  let reference;
  for (const element of [exact.id, 'special']) {
    const args = { datatype, feature, element };
    reference = await page.evaluate(args => window.workbench.request('intersect/bindFeatureReference', args), args);
    expect(reference).toEqual(nativeRequest({ ...args, method: 'feature-map/reference-bind', package: browser.package }));
    const readArgs = { datatype: conversions[1].datatype, feature, reference };
    const object = await page.evaluate(args => window.workbench.request('intersect/readFeatureReference', args), readArgs);
    expect(object).toEqual(nativeRequest({ ...readArgs, method: 'feature-map/reference-read', package: browser.package }));
    expect(object).toEqual(context.model.elements.find(e => e.id === element));
  }
  for (const element of ['missing', unrelated.id]) {
    await expect(page.evaluate(args => window.workbench.request('intersect/bindFeatureReference', args), { datatype, feature, element })).rejects.toThrow();
  }
  for (const bad of [{ ...reference, context: 'stale' }, { ...reference, element: unrelated.id }, { ...reference, class: 'BookCopy' }]) {
    await expect(page.evaluate(args => window.workbench.request('intersect/readFeatureReference', args), { datatype, feature, reference: bad })).rejects.toThrow();
  }
  // A caller-supplied package must never replace the active worker context.
  expect(await page.evaluate(args => window.workbench.request('intersect/readFeatureReference', args), { datatype, feature, reference, package: {} })).toEqual(context.model.elements.find(e => e.id === 'special'));
  const entry = (await page.evaluate(args => window.workbench.request('intersect/stepFeatureMap', args), { datatype, operation: { kind: 'entry', feature, value: reference } })).value;
  const empty = (await page.evaluate(args => window.workbench.request('intersect/stepFeatureMap', args), { datatype: conversions[1].datatype, operation: { kind: 'empty' } })).value;
  const map = (await page.evaluate(args => window.workbench.request('intersect/stepFeatureMap', args), { datatype: conversions[1].datatype, value: empty, operation: { kind: 'insert', index: 0, entry: entry.value } })).value;
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click(); await page.locator('#python-enable').click(); await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const script = value => `import json
from intersect_api import BookCopy
BookCopy.find("earthsea").featureMap = json.loads(${JSON.stringify(JSON.stringify(value))})
`;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(map)); await page.locator('#python-run').click();
  await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.featureMap), { timeout: 60000 }).toEqual(map);
  const committed = await page.evaluate(() => window.workbench.inspect()); const bad = structuredClone(map); bad.value.entries[0].value.context = 'stale';
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(bad)); await page.locator('#python-run').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#python-error')).not.toBeEmpty();
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  const exported = await page.evaluate(revision => window.workbench.request('intersect/packageExport', { revision, metadata: { package_id: 'example.references', release: '1', display_name: 'References', description: 'Checked immutable objects' } }), committed.interfaceRevision);
  expect(exported.manifest.runtime.conversions).toEqual(browser.package.schema.conversion_contracts);
});

test('feature maps share native WASM operations Python rollback and export policies', async ({ page }) => {
  test.setTimeout(90000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="entry" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EFeatureMapEntry"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="featureMap" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EFeatureMap"/>');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8'); const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const source = { uri: 'memory:ecore', sha256: createHash('sha256').update(ecore).digest('hex') }; let feature = { source, path: [2, 2] };
  const conversions = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/feature-maps/conversions.json', import.meta.url), 'utf8')).slice(0, 2).map(c => ({ ...c, declarations: [feature], members: [{ nullable: false, value: { kind: 'builtin', codec: 'EString' } }] }));
  const params = canonicalFixtureParams({ ecore, xtext, rcore_behavior, conversions });
  feature = conversions[0].declarations[0];
  const nativeRequest = request => nativeOracle(request);
  const native = nativeRequest({ ...params, method: 'compile_rcore' }); expect(native.ok).toBe(true);
  const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params); expect(browser.ok).toBe(true); expect(browser.package).toEqual(native.package);
  for (const [body, ok] of [['fn same(a: l.BookCopy,b: l.BookCopy) -> Bool = a.entry == b.entry;', true], ['fn wrong(a: l.BookCopy) -> Bool = a.entry == a.featureMap;', false]]) {
    const text = `rcore 1; package checks version "1"; import model "urn:intersect:example:library:1" as l; ${body}`;
    const entry = { uri: 'features-behavior.rcore', sha256: createHash('sha256').update(text).digest('hex') };
    const typing = canonicalTyping(browser.package, entry, text, conversions);
    const checked = nativeRequest({ method: 'rcore_behavior/check', ...typing }); expect(checked.ok).toBe(ok); expect(checked.executable).toBe(false);
    expect(await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), typing)).toEqual(checked);
  }
  const before = await page.evaluate(() => window.workbench.inspect());
  const step = async (datatype, operation, value) => {
    const args = { datatype, operation, ...(value ? { value } : {}) };
    const result = await page.evaluate(args => window.workbench.request('intersect/stepFeatureMap', args), args);
    expect(result).toEqual(nativeRequest({ ...args, method: 'feature-map/step', package: browser.package })); return result;
  };
  const entry = (await step(conversions[0].datatype, { kind: 'entry', feature, value: 'first' })).value;
  let map = (await step(conversions[1].datatype, { kind: 'empty' })).value;
  for (let index = 0; index < 2; index++) map = (await step(conversions[1].datatype, { kind: 'insert', index, entry: entry.value }, map)).value;
  expect((await step(conversions[1].datatype, { kind: 'values', feature }, map)).result).toEqual(['first', 'first']);
  const changed = (await step(conversions[1].datatype, { kind: 'set', index: 1, entry: { feature, value: 'second' } }, map)).value;
  const moved = await step(conversions[1].datatype, { kind: 'move', new_position: 0, old_position: 1 }, changed); expect(moved.result.value).toBe('second');
  expect((await step(conversions[1].datatype, { kind: 'remove', index: 0 }, moved.value)).result.value).toBe('second');
  expect((await step(conversions[1].datatype, { kind: 'clear' }, map)).value.value.entries).toEqual([]);
  await expect(page.evaluate(args => window.workbench.request('intersect/stepFeatureMap', args), { datatype: conversions[1].datatype, value: map, operation: { kind: 'insert', index: 99, entry: entry.value } })).rejects.toThrow('out of bounds');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click(); await page.locator('#python-enable').click(); await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const script = value => `import json
from intersect_api import BookCopy
BookCopy.find("earthsea").featureMap = json.loads(${JSON.stringify(JSON.stringify(value))})
`;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(map)); await page.locator('#python-run').click();
  await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.featureMap), { timeout: 60000 }).toEqual(map);
  const committed = await page.evaluate(() => window.workbench.inspect()); const bad = structuredClone(map); bad.value.entries[0].value = 99;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(bad)); await page.locator('#python-run').click(); await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 }); await expect(page.locator('#python-error')).not.toBeEmpty(); expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  const exported = await page.evaluate(revision => window.workbench.request('intersect/packageExport', { revision, metadata: { package_id: 'example.features', release: '1', display_name: 'Features', description: 'Checked feature entries' } }), committed.interfaceRevision);
  expect(exported.manifest.runtime.conversions).toEqual(native.package.schema.conversion_contracts);
  const wrong = structuredClone(params); wrong.conversions[0].members[0].value.codec = 'EInt'; expect((await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), wrong)).ok).toBe(false);
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
});

test('collection catalog preserves nested policies across native WASM Python and export', async ({ page }) => {
  test.setTimeout(90000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="numbers" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EEList"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="groups" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EMap"/>');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8');
  const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const conversions = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/collections/conversions.json', import.meta.url), 'utf8')).slice(0, 2);
  const params = canonicalFixtureParams({ ecore, xtext, rcore_behavior, conversions });
  const nativeRequest = request => nativeOracle(request);
  const native = nativeRequest({ ...params, method: 'compile_rcore' }); expect(native.ok).toBe(true);
  const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params);
  expect(browser.ok).toBe(true); expect(browser.package).toEqual(native.package);
  const accepted = await page.evaluate(() => window.workbench.inspect());
  expect(accepted.evaluation.model.elements.find(e => e.values.name === 'earthsea').values.groups).toBeNull();
  const step = async (datatype, operation, collection) => {
    const args = { datatype, operation, ...(collection ? { collection } : {}) };
    const result = await page.evaluate(args => window.workbench.request('intersect/stepCollection', args), args);
    expect(result).toEqual(nativeRequest({ ...args, method: 'collection/step', package: browser.package }));
    return result;
  };
  let operated;
  for (const operation of [{ kind: 'empty' }, { kind: 'insert', index: 0, item: 1 }, { kind: 'insert', index: 1, item: 2 }, { kind: 'move', new_position: 0, old_position: 1 }, { kind: 'set', index: 0, item: 3 }, { kind: 'remove_at', index: 1 }]) {
    operated = (await step(conversions[0].datatype, operation, operated)).collection;
  }
  expect(operated.value.items).toEqual([3]);
  let mapping = (await step(conversions[1].datatype, { kind: 'empty' })).collection;
  mapping = (await step(conversions[1].datatype, { kind: 'put', key: 'a', item: null }, mapping)).collection;
  expect((await step(conversions[1].datatype, { kind: 'get', key: 'a' }, mapping)).result).toEqual({ present: true, value: null });
  expect((await step(conversions[1].datatype, { kind: 'get', key: 'missing' }, mapping)).result).toEqual({ present: false, value: null });
  mapping = (await step(conversions[1].datatype, { kind: 'put', key: 'a', item: operated }, mapping)).collection;
  expect((await step(conversions[1].datatype, { kind: 'remove_key', key: 'a' }, mapping)).result.value).toEqual(operated);
  expect((await step(conversions[1].datatype, { kind: 'clear' }, mapping)).collection.value.entries).toEqual([]);
  await expect(page.evaluate(args => window.workbench.request('intersect/stepCollection', args), { datatype: conversions[0].datatype, collection: operated, operation: { kind: 'insert', index: 99, item: 7 } })).rejects.toThrow('out of bounds');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(accepted.evaluation.model);
  for (const [body, ok] of [['fn same(a: l.BookCopy,b: l.BookCopy) -> Bool = a.numbers == b.numbers;', true], ['fn wrong(a: l.BookCopy) -> Bool = a.numbers == a.groups;', false]]) {
    const text = `rcore 1; package checks version "1"; import model "urn:intersect:example:library:1" as l; ${body}`;
    const source = { uri: 'memory:ecore', sha256: createHash('sha256').update(ecore).digest('hex') };
    const entry = { uri: 'collections-behavior.rcore', sha256: createHash('sha256').update(text).digest('hex') };
    const typing = canonicalTyping(browser.package, entry, text, conversions);
    const checked = nativeRequest({ method: 'rcore_behavior/check', ...typing }); expect(checked.ok).toBe(ok); expect(checked.executable).toBe(false);
    expect(await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), typing)).toEqual(checked);
  }
  const list = { kind: 'converted', datatype: conversions[0].datatype, provider: conversions[0].provider, value: { items: [1, 2, 1] } };
  const map = { kind: 'converted', datatype: conversions[1].datatype, provider: conversions[1].provider, value: { entries: [{ key: 'a', value: list }, { key: 'absent', value: null }] } };
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click(); await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const script = value => `import json
from intersect_api import BookCopy
BookCopy.find("earthsea").groups = json.loads(${JSON.stringify(JSON.stringify(value))})
`;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(map)); await page.locator('#python-run').click();
  await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.groups), { timeout: 60000 }).toEqual(map);
  const committed = await page.evaluate(() => window.workbench.inspect());
  const bad = structuredClone(map); bad.value.entries[0].value.value.items.push('wrong');
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(bad)); await page.locator('#python-run').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#python-error')).not.toBeEmpty(); expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  const exported = await page.evaluate(revision => window.workbench.request('intersect/packageExport', { revision, metadata: { package_id: 'example.collections', release: '1', display_name: 'Collections', description: 'Nested collection contracts' } }), committed.interfaceRevision);
  expect(exported.manifest.runtime.conversions).toEqual(conversions);
  const unsupported = structuredClone(params); unsupported.conversions[1].members[1].value.contract.provider.version = '2';
  expect((await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), unsupported)).ok).toBe(false);
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
});

test('tree iterator lifecycle agrees natively and in WASM with checked Python snapshots', async ({ page }) => {
  test.setTimeout(90000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="cursor" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//ETreeIterator"/>');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8'); const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const source = { uri: 'memory:ecore', sha256: createHash('sha256').update(ecore).digest('hex') };
  const datatype = { source: { uri: 'http://www.eclipse.org/emf/2002/Ecore', sha256: '4ef00e244eda85b2da8670bb5582eb7c8d762d459e3e2c834b228384733c0aa6' }, path: [49] };
  const conversions = [{ datatype, provider: { name: 'ecore.definition-tree-iterator', version: '1' }, serializable: false, declarations: [{ source, path: [2] }] }]; const params = canonicalFixtureParams({ ecore, xtext, rcore_behavior, conversions });
  const nativeRequest = request => nativeOracle(request);
  const native = nativeRequest({ ...params, method: 'compile_rcore' }); expect(native.ok).toBe(true); const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params); expect(browser.ok).toBe(true); expect(browser.package).toEqual(native.package);
  const accepted = await page.evaluate(() => window.workbench.inspect()); expect(accepted.evaluation.model.elements.find(e => e.values.name === 'earthsea').values.cursor).toBeNull();
  let cursor, first;
  for (const action of ['start', 'has_next', 'next', 'prune', 'has_next', 'next']) {
    const args = { datatype, action, ...(cursor ? { cursor } : {}) }; const result = await page.evaluate(args => window.workbench.request('intersect/stepIterator', args), args); expect(result).toEqual(nativeRequest({ ...args, method: 'iterator/step', package: browser.package })); cursor = result.cursor;
    if (action === 'next' && !first) { expect(result.item).toEqual(conversions[0].declarations[0]); first = structuredClone(cursor); }
    if (action === 'prune') expect(result.has_next).toBe(false);
  }
  expect(cursor.value.position).toBe(1); expect(cursor.value.pruned).toEqual([1]);
  await expect(page.evaluate(args => window.workbench.request('intersect/stepIterator', args), { datatype, action: 'remove', cursor })).rejects.toThrow('Removal is unsupported');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(accepted.evaluation.model);
  for (const [body, ok] of [['fn same(a: l.BookCopy, b: l.BookCopy) -> Bool = a.cursor == b.cursor;', true], ['fn wrong(a: l.BookCopy) -> String? = a.cursor;', false]]) {
    const text = `rcore 1; package checks version "1"; import model "urn:intersect:example:library:1" as l; ${body}`; const entry = { uri: 'iterators-behavior.rcore', sha256: createHash('sha256').update(text).digest('hex') }; const typing = canonicalTyping(browser.package, entry, text, conversions); const checked = nativeRequest({ method: 'rcore_behavior/check', ...typing }); expect(checked.ok).toBe(ok); expect(checked.executable).toBe(false); expect(await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), typing)).toEqual(checked);
  }
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click(); await page.locator('#python-enable').click(); await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const script = value => `import json
from intersect_api import BookCopy
BookCopy.find("earthsea").cursor = json.loads(${JSON.stringify(JSON.stringify(value))})
`;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(first)); await page.locator('#python-run').click(); await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.cursor), { timeout: 60000 }).toEqual(first);
  const committed = await page.evaluate(() => window.workbench.inspect()); const bad = structuredClone(first); bad.value.position = 99;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(bad)); await page.locator('#python-run').click(); await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 }); await expect(page.locator('#python-error')).toContainText('position exceeds exhaustion'); expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  const exported = await page.evaluate(revision => window.workbench.request('intersect/packageExport', { revision, metadata: { package_id: 'example.iterators', release: '1', display_name: 'Iterators', description: 'Checked tree cursors' } }), committed.interfaceRevision); expect(exported.manifest.runtime.conversions).toEqual(conversions);
  const wrong = structuredClone(conversions); wrong[0].declarations[0].path = [99]; expect((await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), { ...params, conversions: wrong })).ok).toBe(false); expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
});

test('scoped resource handles read and resolve identically in native WASM and Python models', async ({ page }) => {
  test.setTimeout(90000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="definition" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EResource"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="definitions" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EResourceSet"/>');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8');
  const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  let source = { uri: 'memory:ecore', sha256: createHash('sha256').update(ecore).digest('hex') };
  const standard = { uri: 'http://www.eclipse.org/emf/2002/Ecore', sha256: '4ef00e244eda85b2da8670bb5582eb7c8d762d459e3e2c834b228384733c0aa6' };
  const conversions = ['ecore.definition-resource', 'ecore.definition-resource-set'].map((name, index) => ({ datatype: { source: standard, path: [43 + index] }, provider: { name, version: '1' }, serializable: false, declarations: [{ source, path: [] }] }));
  const params = canonicalFixtureParams({ ecore, xtext, rcore_behavior, conversions });
  const nativeRequest = request => nativeOracle(request);
  const native = nativeRequest({ ...params, method: 'compile_rcore' }); expect(native.ok).toBe(true);
  const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params); expect(browser.ok).toBe(true); expect(browser.package).toEqual(native.package);
  source = conversions[0].declarations[0].source;
  const accepted = await page.evaluate(() => window.workbench.inspect());
  const handles = conversions.map((contract, index) => ({ kind: 'converted', datatype: contract.datatype, provider: contract.provider, value: index ? { resources: [source] } : { resource: source } }));
  for (const handle of handles) {
    const args = { handle, from: source };
    const read = await page.evaluate(args => window.workbench.request('intersect/readResource', args), args);
    expect(read).toEqual(nativeRequest({ ...args, method: 'resource/read', package: browser.package })); expect(read.source.text).toBe(params.rcore);
    const resolved = await page.evaluate(args => window.workbench.request('intersect/resolveResource', args), { ...args, href: '#//BookCopy' });
    expect(resolved).toEqual(nativeRequest({ ...args, href: '#//BookCopy', method: 'resource/resolve', package: browser.package })); expect(resolved.declaration).toEqual({ source, path: [2] });
    await expect(page.evaluate(args => window.workbench.request('intersect/resolveResource', args), { ...args, href: 'https://not-loaded.test/missing.ecore#//Item' })).rejects.toThrow();
  }
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(accepted.evaluation.model);
  for (const [body, ok] of [['fn same(a: l.BookCopy, b: l.BookCopy) -> Bool = a.definition == b.definition && a.definitions == b.definitions;', true], ['fn wrong(a: l.BookCopy) -> Bool = a.definition == a.definitions;', false]]) {
    const text = `rcore 1; package checks version "1"; import model "urn:intersect:example:library:1" as l; ${body}`;
    const entry = { uri: 'resources.rcore_behavior', sha256: createHash('sha256').update(text).digest('hex') };
    const typing = canonicalTyping(browser.package, entry, text, conversions);
    const checked = nativeRequest({ method: 'rcore_behavior/check', ...typing }); expect(checked.ok).toBe(ok); expect(checked.executable).toBe(false);
    expect(await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), typing)).toEqual(checked);
  }
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click(); await page.locator('#python-enable').click(); await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const script = values => `import json
from intersect_api import BookCopy
copy = BookCopy.find("earthsea")
copy.definition = json.loads(${JSON.stringify(JSON.stringify(values[0]))})
copy.definitions = json.loads(${JSON.stringify(JSON.stringify(values[1]))})
`;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(handles)); await page.locator('#python-run').click();
  await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.definitions), { timeout: 60000 }).toEqual(handles[1]);
  const committed = await page.evaluate(() => window.workbench.inspect());
  const invalid = structuredClone(handles); invalid[1].value.resources.push(source);
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(invalid)); await page.locator('#python-run').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#python-error')).toContainText('Duplicate resource identity'); expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  const stale = structuredClone(handles[0]); stale.value.resource.sha256 = 'stale';
  await expect(page.evaluate(args => window.workbench.request('intersect/readResource', args), { handle: stale, from: source })).rejects.toThrow('outside the exact selected scope');
  const exported = await page.evaluate(revision => window.workbench.request('intersect/packageExport', { revision, metadata: { package_id: 'example.resources', release: '1', display_name: 'Resources', description: 'Explicit scopes' } }), committed.interfaceRevision);
  expect(exported.manifest.runtime.conversions).toEqual(conversions); expect(JSON.parse(exported.files['definitions/conversions.json'])).toEqual(conversions);
  const wrong = structuredClone(conversions); wrong[0].declarations[0].path = [2];
  expect((await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), { ...params, conversions: wrong })).ok).toBe(false);
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
});

test('diagnostic chains accumulate through native WASM and publish checked Python snapshots', async ({ page }) => {
  test.setTimeout(90000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="reports" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EDiagnosticChain"/>');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8');
  const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const conversions = [{ datatype: { source: { uri: 'http://www.eclipse.org/emf/2002/Ecore', sha256: '4ef00e244eda85b2da8670bb5582eb7c8d762d459e3e2c834b228384733c0aa6' }, path: [27] }, provider: { name: 'ecore.diagnostic-chain', version: '1' }, serializable: false }];
  const params = canonicalFixtureParams({ ecore, xtext, rcore_behavior, conversions });
  const nativeRequest = request => nativeOracle(request);
  const native = nativeRequest({ ...params, method: 'compile_rcore' });
  expect(native.ok).toBe(true);
  const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params);
  expect(browser.ok).toBe(true);
  expect(browser.package).toEqual(native.package);
  const accepted = await page.evaluate(() => window.workbench.inspect());
  expect(accepted.evaluation.model.elements.find(e => e.values.name === 'earthsea').values.reports).toBeNull();
  for (const [body, ok] of [['fn same(a: l.BookCopy, b: l.BookCopy) -> Bool = a.reports == b.reports;', true], ['fn wrong(a: l.BookCopy) -> String? = a.reports;', false]]) {
    const source = { uri: 'memory:ecore', sha256: createHash('sha256').update(ecore).digest('hex') };
    const text = `rcore 1; package checks version "1"; import model "urn:intersect:example:library:1" as l; ${body}`;
    const entry = { uri: 'diagnostics-behavior.rcore', sha256: createHash('sha256').update(text).digest('hex') };
    const typing = canonicalTyping(browser.package, entry, text, conversions);
    const native = nativeRequest({ method: 'rcore_behavior/check', ...typing });
    expect(native.ok).toBe(ok);
    expect(native.executable).toBe(false);
    expect(await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), typing)).toEqual(native);
  }
  const leaf = { severity: 'error', source: 'library.check', code: 7, message: null, data: [{ kind: 'scalar', datatype: 'ELong', value: { kind: 'int64', value: '9223372036854775807' } }], children: [] };
  const parent = { ...leaf, severity: 'warning', children: [leaf, leaf] };
  let chain = { kind: 'converted', datatype: conversions[0].datatype, provider: conversions[0].provider, value: { diagnostics: [] } };
  for (const [operation, diagnostic, count, severity] of [['add', parent, 1, 'warning'], ['add_all', parent, 3, 'error'], ['merge', parent, 5, 'error'], ['add_all', leaf, 5, 'error'], ['merge', leaf, 6, 'error']]) {
    const args = { chain, operation, diagnostic };
    const native = nativeRequest({ ...args, method: 'diagnostic/collect', package: browser.package });
    const result = await page.evaluate(args => window.workbench.request('intersect/collectDiagnostics', args), args);
    expect(result).toEqual(native);
    expect(result.severity).toBe(severity);
    expect(result.chain.value.diagnostics).toHaveLength(count);
    chain = result.chain;
  }
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(accepted.evaluation.model);
  await expect(page.evaluate(args => window.workbench.request('intersect/collectDiagnostics', args), { chain, operation: 'add', diagnostic: { ...leaf, severity: 'fatal' } })).rejects.toThrow('Invalid diagnostic');
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const script = value => `import json
from intersect_api import BookCopy
BookCopy.find("earthsea").reports = json.loads(${JSON.stringify(JSON.stringify(value))})
`;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(chain));
  await page.locator('#python-run').click();
  await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.reports), { timeout: 60000 }).toEqual(chain);
  const committed = await page.evaluate(() => window.workbench.inspect());
  const bad = structuredClone(chain); bad.value.diagnostics[0].hostObject = 42;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(bad));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 }); await expect(page.locator('#python-error')).toContainText('Invalid diagnostic chain');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  const exported = await page.evaluate(revision => window.workbench.request('intersect/packageExport', { revision, metadata: { package_id: 'example.diagnostics', release: '1', display_name: 'Diagnostics', description: 'Explicit chain provider' } }), committed.interfaceRevision);
  expect(exported.manifest.runtime.conversions).toEqual(conversions);
  expect(JSON.parse(exported.files['definitions/conversions.json'])).toEqual(conversions);
  expect((await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), { ...params, conversions: [] })).ok).toBe(false);
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
});

test('invocation error descriptors preserve native WASM typing Python edits and exports', async ({ page }) => {
  test.setTimeout(90000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="failure" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EInvocationTargetException"/>');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8');
  const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const conversions = [{ datatype: { source: { uri: 'http://www.eclipse.org/emf/2002/Ecore', sha256: '4ef00e244eda85b2da8670bb5582eb7c8d762d459e3e2c834b228384733c0aa6' }, path: [52] }, provider: { name: 'ecore.invocation-error', version: '1' }, serializable: false }];
  const params = canonicalFixtureParams({ ecore, xtext, rcore_behavior, conversions });
  const nativeRequest = request => nativeOracle(request);
  const native = nativeRequest({ ...params, method: 'compile_rcore' });
  expect(native.ok).toBe(true);
  const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params);
  expect(browser.ok).toBe(true);
  expect(browser.package).toEqual(native.package);
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.failure).toBeNull();
  for (const [body, ok] of [['fn same(a: l.BookCopy, b: l.BookCopy) -> Bool = a.failure == b.failure;', true], ['fn wrong(a: l.BookCopy) -> String? = a.failure;', false]]) {
    const source = { uri: 'memory:ecore', sha256: createHash('sha256').update(ecore).digest('hex') };
    const text = `rcore 1; package checks version "1"; import model "urn:intersect:example:library:1" as l; ${body}`;
    const entry = { uri: 'errors-behavior.rcore', sha256: createHash('sha256').update(text).digest('hex') };
    const typing = canonicalTyping(browser.package, entry, text, conversions);
    const native = nativeRequest({ method: 'rcore_behavior/check', ...typing });
    expect(native.ok).toBe(ok);
    expect(native.executable).toBe(false);
    expect(await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), typing)).toEqual(native);
  }
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const wire = value => ({ kind: 'converted', datatype: conversions[0].datatype, provider: conversions[0].provider, value });
  const script = value => `import json
from intersect_api import BookCopy
BookCopy.find("earthsea").failure = json.loads(${JSON.stringify(JSON.stringify(value))})
`;
  for (const value of [wire({ message: null, target: null }), wire({ message: '', target: { domain: { name: 'sysml.check', version: '2' }, code: 'invalid', message: 'constraint failed' } })]) {
    await page.evaluate(text => window.workbench.python.model.setValue(text), script(value));
    await page.locator('#python-run').click();
    await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.failure), { timeout: 60000 }).toEqual(value);
  }
  const committed = await page.evaluate(() => window.workbench.inspect());
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(wire({ message: null, target: { javaObject: 42 } })));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 }); await expect(page.locator('#python-error')).toContainText('Invalid invocation error descriptor');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  const exported = await page.evaluate(revision => window.workbench.request('intersect/packageExport', { revision, metadata: { package_id: 'example.errors', release: '1', display_name: 'Errors', description: 'Portable errors' } }), committed.interfaceRevision);
  expect(exported.manifest.runtime.conversions).toEqual(conversions);
  expect(JSON.parse(exported.files['definitions/conversions.json'])).toEqual(conversions);
  // Migrated Rcore spells plain identifiers bare (definitions/rcore_names.rs).
  const opaqueDefault = params.rcore.replace(/(attr failure[^;]*);/, '$1 default "opaque";');
  expect(opaqueDefault).not.toBe(params.rcore);
  for (const invalid of [{ ...params, conversions: [] }, { ...params, rcore: opaqueDefault }]) {
    expect((await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), invalid)).ok).toBe(false);
    expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  }
});

test('explicit EEnumerator scope preserves aliases in browser Python and exported contracts', async ({ page }) => {
  test.setTimeout(90000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('</ecore:EPackage>', '<eClassifiers xsi:type="ecore:EEnum" name="Mode"><eLiterals name="First" value="7"/><eLiterals name="Alias" value="7"/></eClassifiers><eClassifiers xsi:type="ecore:EEnum" name="Other"><eLiterals name="First" value="7"/></eClassifiers></ecore:EPackage>')
    .replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="selected" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EEnumerator"/>');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8');
  const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const source = { uri: 'memory:ecore', sha256: createHash('sha256').update(ecore).digest('hex') };
  const conversions = [{ datatype: { source: { uri: 'http://www.eclipse.org/emf/2002/Ecore', sha256: '4ef00e244eda85b2da8670bb5582eb7c8d762d459e3e2c834b228384733c0aa6' }, path: [31] }, provider: { name: 'ecore.enumerator', version: '1' }, serializable: false, declarations: [{ source, path: [5] }] }];
  const params = canonicalFixtureParams({ ecore, xtext, rcore_behavior, conversions });
  const native = nativeOracle({ ...params, method: 'compile_rcore' });
  expect(native.ok).toBe(true);
  const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params);
  expect(browser.ok).toBe(true);
  expect(browser.package).toEqual(native.package);
  const accepted = await page.evaluate(() => window.workbench.inspect());
  expect(accepted.evaluation.model.elements.find(e => e.values.name === 'earthsea').values.selected).toBeNull();
  const {id: enumId} = migratedSourceFixture({id:source,kind:'ecore',text:ecore,dependencies:[]});
  const wire = (enumeration, literal) => ({ kind: 'converted', datatype: conversions[0].datatype, provider: conversions[0].provider, value: { kind: 'enum', enumeration: {source:conversions[0].declarations[0].source,path:enumId([enumeration]).path}, literal: {source:conversions[0].declarations[0].source,path:enumId([enumeration,literal]).path} } });
  const first = wire(5, 0), alias = wire(5, 1), wrong = wire(6, 0);
  const text = 'rcore 1; package checks version "1"; import model "urn:intersect:example:library:1" as l; fn same(a: l.BookCopy, b: l.BookCopy) -> Bool = a.selected == b.selected;';
  const entry = { uri: 'enums-behavior.rcore', sha256: createHash('sha256').update(text).digest('hex') };
  const typing = canonicalTyping(browser.package, entry, text, conversions);
  const nativeTyping = nativeOracle({ method: 'rcore_behavior/check', ...typing });
  expect(nativeTyping.ok).toBe(true);
  expect(await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), typing)).toEqual(nativeTyping);
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const script = value => `import json
from intersect_api import BookCopy
BookCopy.find("earthsea").selected = json.loads(${JSON.stringify(JSON.stringify(value))})
`;
  for (const value of [first, alias]) {
    await page.evaluate(text => window.workbench.python.model.setValue(text), script(value));
    await page.locator('#python-run').click();
    await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
    await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.selected), { timeout: 60000 }).toEqual(value);
  }
  const committed = await page.evaluate(() => window.workbench.inspect());
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(wrong));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#python-error')).toContainText('Unresolved enum declaration');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  const exported = await page.evaluate(revision => window.workbench.request('intersect/packageExport', { revision, metadata: { package_id: 'example.enums', release: '1', display_name: 'Enums', description: 'Exact enum scope' } }), committed.interfaceRevision);
  expect(exported.manifest.runtime.conversions).toEqual(conversions);
  expect(JSON.parse(exported.files['definitions/conversions.json'])).toEqual(conversions);
  const bad = structuredClone(conversions);
  bad[0].declarations[0].path = [1]; // Library is a class, not an enum.
  expect((await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), { ...params, conversions: bad })).ok).toBe(false);
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
});

test('pinned EJavaClass descriptors share native WASM defaults and Python validation', async ({ page }) => {
  test.setTimeout(90000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="representedType" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EJavaClass" defaultValueLiteral="[Ljava.lang.String;"/>');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8');
  const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const conversions = [{ datatype: { source: { uri: 'http://www.eclipse.org/emf/2002/Ecore', sha256: '4ef00e244eda85b2da8670bb5582eb7c8d762d459e3e2c834b228384733c0aa6' }, path: [38] }, provider: { name: 'ecore.class', version: '1' }, serializable: true }];
  const params = canonicalFixtureParams({ ecore, xtext, rcore_behavior, conversions });
  const native = nativeOracle({ ...params, method: 'compile_rcore' });
  expect(native.ok).toBe(true);
  const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params);
  expect(browser.ok).toBe(true);
  expect(browser.package).toEqual(native.package);
  const accepted = await page.evaluate(() => window.workbench.inspect());
  for (const copy of accepted.evaluation.model.elements.filter(e => e.class === 'BookCopy')) {
    expect(copy.values.representedType).toEqual({ kind: 'converted', datatype: conversions[0].datatype, provider: conversions[0].provider, value: { component: { kind: 'named', name: 'java.lang.String', identity: { name: 'intersect.portable-java-core', version: '1' } }, dimensions: 1 } });
  }
  for (const [body, ok] of [
    ['fn same(a: l.BookCopy, b: l.BookCopy) -> Bool = a.representedType == b.representedType;', true],
    ['fn wrong(a: l.BookCopy) -> String? = a.representedType;', false],
  ]) {
    const make = (uri, kind, text, dependencies = []) => ({ id: { uri, sha256: createHash('sha256').update(text).digest('hex') }, kind, text, dependencies });
    const model = make('memory:ecore', 'ecore', ecore);
    const semantic = make('class-check-behavior.rcore', 'rcore_behavior', `rcore 1; package checks version "1"; import model "urn:intersect:example:library:1" as l; ${body}`, [model.id]);
    const typing = canonicalTyping(browser.package,semantic.id,semantic.text,conversions);
    const nativeTyping = nativeOracle({ method: 'rcore_behavior/check', ...typing });
    const browserTyping = await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), typing);
    expect(browserTyping).toEqual(nativeTyping);
    expect(browserTyping.ok).toBe(ok);
    expect(browserTyping.executable).toBe(false);
    const missing = await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), { ...typing, conversions: [] });
    expect(missing.ok).toBe(false);
    expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(accepted.evaluation);
  }
  for (const bad of ['[V', '[Lmissing.Type;']) {
    const rejected = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), { ...params, rcore: params.rcore.replace('[Ljava.lang.String;', bad) });
    expect(rejected.ok).toBe(false);
    expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(accepted.evaluation);
  }
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const script = name => `from intersect_api import BookCopy
copy = BookCopy.find("earthsea")
value = copy.representedType
value["value"] = {"component": {"kind": "primitive", "name": "${name}"}, "dimensions": 2}
copy.representedType = value
`;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script('int'));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  const committed = await page.evaluate(() => window.workbench.inspect());
  expect(committed.evaluation.model.elements.find(e => e.values.name === 'earthsea').values.representedType.value).toEqual({ component: { kind: 'primitive', name: 'int' }, dimensions: 2 });
  await page.evaluate(text => window.workbench.python.model.setValue(text), script('void'));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#python-error')).toContainText('Void cannot be an array component');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
});

for (const standardObject of [false, true]) test(`${standardObject ? 'standard object' : 'custom conversion'} catalog preserves native WASM defaults and rejected selections`, async ({ page }) => {
  test.setTimeout(90000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  let ecore = base.replace('</ecore:EPackage>', '<eClassifiers xsi:type="ecore:EDataType" name="RGB" instanceClassName="example.RGB"/></ecore:EPackage>')
    .replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="color" eType="#//RGB" defaultValueLiteral="#123abc"/>');
  if (standardObject) ecore = ecore.replace('<eClassifiers xsi:type="ecore:EDataType" name="RGB" instanceClassName="example.RGB"/>', '').replace('eType="#//RGB"', 'eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EJavaObject"');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8');
  const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const conversions = [{ datatype: { source: { uri: 'memory:ecore', sha256: createHash('sha256').update(ecore).digest('hex') }, path: [5] }, provider: { name: 'example.rgb', version: '1' }, serializable: true }];
  if (standardObject) conversions[0].datatype = { source: { uri: 'http://www.eclipse.org/emf/2002/Ecore', sha256: '4ef00e244eda85b2da8670bb5582eb7c8d762d459e3e2c834b228384733c0aa6' }, path: [39] };
  const params = canonicalFixtureParams({ ecore, xtext, rcore_behavior, conversions });
  const native = nativeOracle({ ...params, method: 'compile_rcore' });
  expect(native.ok).toBe(true);
  const browser = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), params);
  expect(browser.ok).toBe(true);
  expect(browser.package).toEqual(native.package);
  expect(browser.keywords).toEqual(native.keywords);
  const accepted = await page.evaluate(() => window.workbench.inspect());
  const copies = accepted.evaluation.model.elements.filter(element => element.class === 'BookCopy');
  expect(copies).toHaveLength(2);
  for (const copy of copies) expect(copy.values.color).toEqual({ kind: 'converted', datatype: conversions[0].datatype, provider: conversions[0].provider, value: { red: 18, green: 58, blue: 188 } });
  const exported = await page.evaluate(revision => window.workbench.request('intersect/packageExport', { revision, metadata: { package_id: 'example.library.rgb', release: '1', display_name: 'Library RGB', description: 'Provider export control' } }), accepted.interfaceRevision);
  expect(exported.manifest.runtime.conversions).toEqual(conversions);
  expect(JSON.parse(exported.files['definitions/conversions.json'])).toEqual(conversions);
  expect(JSON.parse(exported.files['package.json'])).toEqual(accepted.package);
  expect(exported.manifest.files['definitions/conversions.json'].sha256).toBe(createHash('sha256').update(exported.files['definitions/conversions.json']).digest('hex'));
  for (const bad of [[], [{ ...conversions[0], provider: { name: 'example.rgb', version: '2' } }]]) {
    const result = await page.evaluate(params => window.workbench.request('intersect/compileRcore', params), { ...params, conversions: bad });
    expect(result.ok).toBe(false);
    const retained = await page.evaluate(() => window.workbench.inspect());
    expect(retained.package).toEqual(accepted.package);
    expect(retained.evaluation).toEqual(accepted.evaluation);
  }
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const script = red => `from intersect_api import BookCopy
copy = BookCopy.find("earthsea")
color = copy.color
color["value"]["red"] = ${red}
copy.color = color
`;
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(255));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  const committed = await page.evaluate(() => window.workbench.inspect());
  expect(committed.evaluation.model.elements.find(e => e.values.name === 'earthsea').values.color.value).toEqual({ red: 255, green: 58, blue: 188 });
  await page.evaluate(text => window.workbench.python.model.setValue(text), script(256));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 }); await expect(page.locator('#python-error')).toContainText('256');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);

});

test('declared datatype defaults and operation identities agree in native and WASM packages', async ({ page }) => {
  await loadMigratedLibrary(page);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('</ecore:EPackage>', '<eClassifiers xsi:type="ecore:EDataType" name="Counter" instanceClassName="long"/></ecore:EPackage>')
    .replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', '<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eStructuralFeatures xsi:type="ecore:EAttribute" name="counter" eType="#//Counter" defaultValueLiteral="9007199254740993"/><eOperations name="count" eType="#//Counter"><eParameters name="value" eType="#//Counter"/></eOperations>');
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8');
  const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const native = nativeOracle(canonicalFixtureParams({ecore,xtext,rcore_behavior}));
  expect(native.ok).toBe(true);
  await compileMigratedFixture(page, ecore);
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const accepted = await page.evaluate(() => window.workbench.inspect());
  expect(accepted.package).toEqual(native.package);
  expect(generatePythonApi(native.package, 'declared-test').stub).toContain('def counter(self) -> dict[str, object]');
  const declaration = accepted.package.schema.datatypes.Counter.declaration;
  const copies = accepted.evaluation.model.elements.filter(element => element.class === 'BookCopy');
  expect(copies).toHaveLength(2);
  for (const copy of copies) expect(copy.values.counter).toEqual({ kind: 'datatype', datatype: declaration, value: { kind: 'int64', value: '9007199254740993' } });
  expect(accepted.package.schema.classes.BookCopy.operations[0].result.target).toEqual({ kind: 'datatype', name: 'Counter' });
  const make = (uri, kind, text, dependencies = []) => ({ id: { uri, sha256: createHash('sha256').update(text).digest('hex') }, kind, text, dependencies });
  const model = sourceFixture('file:///declared.ecore', 'ecore', ecore);
  for (const [body, ok] of [
    ['fn f(value: m.Counter) -> m.Counter = value;', true],
    ['fn f(copy: m.BookCopy) -> m.Counter? = copy.counter;', true],
    ['fn f(value: m.Counter) -> Int64 = value;', false],
    ['fn f() -> m.Counter = 1;', false],
  ]) {
    const source = make('file:///declared-behavior.rcore', 'rcore_behavior', `rcore 1; package declared version "1"; import model "urn:intersect:example:library:1" as m; ${body}`, [model.id]);
    const params = { bundle: { version: 1, sources: [model, source], namespaces: [] }, entry: source.id };
    const nativeTyping = nativeOracle({ method: 'rcore_behavior/check', ...params });
    const browserTyping = await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), params);
    expect(browserTyping).toEqual(nativeTyping);
    expect(browserTyping.ok).toBe(ok);
    expect(browserTyping.executable).toBe(false);
  }
  await compileMigratedFixture(page, ecore.replace('instanceClassName="long"', 'instanceClassName="example.Unknown"'));
  await expect(page.locator('#diagnostic-list')).toContainText('No native scalar binding');
  const rejected = await page.evaluate(() => window.workbench.inspect());
  expect(rejected.package).toEqual(accepted.package);
  expect(rejected.evaluation).toEqual(accepted.evaluation);
});

test('enum defaults and exact scalars preserve values across native and WASM compilation and failed edits', async ({ page }) => {
  await loadMigratedLibrary(page);
  test.setTimeout(120000);
  const base = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const ecore = base.replace('<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named">', `<eClassifiers xsi:type="ecore:EClass" name="BookCopy" eSuperTypes="#//Named"><eOperations name="selectMode" eType="#//EInt"><eParameters name="mode" eType="#//EInt"/></eOperations><eStructuralFeatures xsi:type="ecore:EAttribute" name="mode" eType="#//EInt" defaultValueLiteral="alias"/>`)
    .replace('name="mode" eType="#//EInt" defaultValueLiteral="alias"/>', `name="mode" eType="#//EInt" defaultValueLiteral="alias"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="longValue" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//ELong" defaultValueLiteral="٩٠٠٧١٩٩٢٥٤٧٤٠٩٩٣"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//ELongObject"/>`)
    .replace('<eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"', `<eStructuralFeatures xsi:type="ecore:EAttribute" name="floatValue" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EFloat" defaultValueLiteral="-0x1p-150"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="doubleValue" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EDouble" defaultValueLiteral="NaN"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"`)
    .replace('<eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"', `<eStructuralFeatures xsi:type="ecore:EAttribute" name="unicodeBoolean" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EBoolean" defaultValueLiteral="falſe"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"`)
    .replace('<eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"', `<eStructuralFeatures xsi:type="ecore:EAttribute" name="hugeInteger" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EBigInteger" defaultValueLiteral="184467440737095516160000000000000000000"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"`)
    .replace('<eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"', `<eStructuralFeatures xsi:type="ecore:EAttribute" name="exactDecimal" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EBigDecimal" defaultValueLiteral="18446744073709551616.00"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"`)
    .replace('<eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"', `<eStructuralFeatures xsi:type="ecore:EAttribute" name="binaryValue" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EByteArray" defaultValueLiteral="ABC"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"`)
    .replace('<eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"', `<eStructuralFeatures xsi:type="ecore:EAttribute" name="characterValue" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EChar" defaultValueLiteral="55296"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"`)
    .replace('<eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"', `<eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedCharacter" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//ECharacterObject" defaultValueLiteral="65535"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"`)
    .replace('<eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"', `<eStructuralFeatures xsi:type="ecore:EAttribute" name="dateValue" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EDate" defaultValueLiteral="1969-12-31T23:59:59.999+0000"/><eStructuralFeatures xsi:type="ecore:EAttribute" name="boxedValue"`)
    .replace('</ecore:EPackage>', `<eClassifiers xsi:type="ecore:EEnum" name="EInt"><eLiterals name="Primary" literal="primary" value="٧"/><eLiterals name="Alias" literal="alias" value="7"/></eClassifiers></ecore:EPackage>`);
  const xtext = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.xtext', import.meta.url), 'utf8');
  const rcore_behavior = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-behavior.rcore', import.meta.url), 'utf8');
  const native = nativeOracle(canonicalFixtureParams({ecore,xtext,rcore_behavior}));
  expect(native.ok).toBe(true);
  expect(generatePythonApi(native.package, 'enum-test').stub).toContain('def mode(self) -> dict[str, object]');
  expect(generatePythonApi(native.package, 'enum-test').stub).toContain('def longValue(self) -> dict[str, object]');
  expect(generatePythonApi(native.package, 'enum-test').stub).toContain('def hugeInteger(self) -> dict[str, object]');
  expect(generatePythonApi(native.package, 'enum-test').stub).toContain('def exactDecimal(self) -> dict[str, object]');
  expect(generatePythonApi(native.package, 'enum-test').stub).toContain('def dateValue(self) -> dict[str, object]');
  expect(generatePythonApi(native.package, 'enum-test').stub).toContain('def boxedValue(self) -> dict[str, object] | None');
  await compileMigratedFixture(page, ecore);
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const accepted = await page.evaluate(() => window.workbench.inspect());
  expect(accepted.package).toEqual(native.package);
  const enumeration = accepted.package.schema.enumerations.EInt;
  expect(enumeration.literals[0].value).toBe(7);
  const operation = accepted.package.schema.classes.BookCopy.operations[0];
  expect(operation.result.target).toEqual({ kind: 'enumeration', name: 'EInt' });
  expect(operation.parameters[0].value.target).toEqual(operation.result.target);
  const alias = { kind: 'enum', enumeration: enumeration.declaration, literal: enumeration.literals[1].declaration };
  const copies = accepted.evaluation.model.elements.filter(element => element.class === 'BookCopy');
  expect(copies).toHaveLength(2);
  for (const copy of copies) expect(copy.values.mode).toEqual(alias);
  for (const copy of copies) {
    expect(copy.values.longValue).toEqual({ kind: 'int64', value: '9007199254740993' });
    expect(copy.values.boxedValue).toBeNull();
    expect(copy.values.dateValue).toEqual({ kind: 'date', milliseconds: '-1' });
    expect(copy.values.binaryValue).toEqual({ kind: 'bytes', hex: 'AB0C' });
    expect(copy.values.characterValue).toEqual({ kind: 'char16', unit: 55296 });
    expect(copy.values.boxedCharacter).toEqual({ kind: 'char16', unit: 65535 });
    expect(copy.values.exactDecimal).toEqual({ kind: 'decimal', coefficient: '1844674407370955161600', scale: 2 });
    expect(copy.values.hugeInteger).toEqual({ kind: 'bigint', value: '184467440737095516160000000000000000000' });
    expect(copy.values.unicodeBoolean).toBe(false);
    expect(copy.values.floatValue).toEqual({ kind: 'float32', bits: '80000000' });
    expect(copy.values.doubleValue).toEqual({ kind: 'float64', bits: '7ff8000000000000' });
  }
  const acceptedRcore = await page.evaluate(() => window.workbench.definitionModels.rcore.getValue());
  const compileEditedRcore = text => page.evaluate(async text => { window.workbench.definitionModels.rcore.setValue(text); await window.workbench.compile(); }, text);
  await compileEditedRcore(acceptedRcore.replace('1969-12-31T23:59:59.999+0000', 'invalid-date'));
  await expect(page.locator('#diagnostic-list')).toContainText('Invalid EDate default');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(accepted.evaluation);
  await compileEditedRcore(acceptedRcore.replace('default "alias"', 'default "Alias"'));
  await expect(page.locator('#diagnostic-list')).toContainText('Invalid literal');
  const rejected = await page.evaluate(() => window.workbench.inspect());
  expect(rejected.package).toEqual(accepted.package);
  expect(rejected.evaluation).toEqual(accepted.evaluation);
  await compileEditedRcore(acceptedRcore.replace('٩٠٠٧١٩٩٢٥٤٧٤٠٩٩٣', '9223372036854775808'));
  await expect(page.locator('#diagnostic-list')).toContainText('Invalid ELong default');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(accepted.evaluation);
  // Exercise all six E06 scalar domains through actual Python transaction publication.
  await compileMigratedFixture(page, ecore);
  await page.getByRole('tab', { name: 'Test', exact: true }).click(); await page.getByRole('tab', { name: 'script.py', exact: true }).click(); await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  const values = {
    hugeInteger: { kind: 'bigint', value: '-999999999999999999999999999999999999999' },
    exactDecimal: { kind: 'decimal', coefficient: '1000', scale: 3 },
    binaryValue: { kind: 'bytes', hex: '' },
    characterValue: { kind: 'char16', unit: 56320 },
    boxedCharacter: null,
    dateValue: { kind: 'date', milliseconds: '9223372036854775807' }
  };
  const updates = fields => `import json
from intersect_api import BookCopy
item = BookCopy.find("earthsea")
` + Object.entries(fields).map(([field, value]) => `item.${field} = json.loads(${JSON.stringify(JSON.stringify(value))})`).join('\n');
  await page.evaluate(text => window.workbench.python.model.setValue(text), updates(values)); await page.locator('#python-run').click();
  await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.dateValue), { timeout: 60000 }).toEqual(values.dateValue);
  const committed = await page.evaluate(() => window.workbench.inspect());
  const changedCopy = committed.evaluation.model.elements.find(e => e.values.name === 'earthsea');
  for (const [field, value] of Object.entries(values)) expect(changedCopy.values[field]).toEqual(value);
  for (const [field, value] of Object.entries({
    hugeInteger: { kind: 'bigint', value: '01' },
    exactDecimal: { kind: 'decimal', coefficient: '1', scale: 2147483648 },
    binaryValue: { kind: 'bytes', hex: 'ab' },
    characterValue: { kind: 'char16', unit: 65536 },
    boxedCharacter: { kind: 'char16', unit: -1 },
    dateValue: { kind: 'date', milliseconds: '+1' }
  })) {
    await page.evaluate(text => window.workbench.python.model.setValue(text), updates({ title: 'must roll back', [field]: value }));
    await page.locator('#python-run').click();
    await expect(page.locator('#python-run')).toBeEnabled({ timeout: 60000 });
    await expect(page.locator('#python-error')).not.toBeEmpty();
    expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(committed.evaluation.model);
  }

});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 });
  await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('Ecore effective members agree natively and in WASM and conflicting edits keep the active package', async ({ page }) => {
  await loadMigratedLibrary(page);
  test.setTimeout(90000);
  const library = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore', import.meta.url), 'utf8');
  const operation = '<eOperations name="lookup" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EInt"><eParameters name="index" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EInt"/></eOperations>';
  const valid = library.replace('</eClassifiers>', operation + '</eClassifiers>').replace('name="Member" eSuperTypes="#//Named"/>', `name="Member" eSuperTypes="#//Named">${operation}</eClassifiers>`);
  const duplicate = valid.replace(operation, operation + operation);
  const generic = valid.replace(operation, '<eOperations name="generic"><eTypeParameters name="T"/></eOperations>');
  const typed = valid.replaceAll('<eOperations ', '<eOperations xsi:type="ecore:EOperation" ').replaceAll('<eParameters ', '<eParameters xsi:type="ecore:EParameter" ');
  const siblings = `<eClassifiers xsi:type="ecore:EClass" name="Other" eSuperTypes="#//Named">${operation}</eClassifiers><eClassifiers xsi:type="ecore:EClass" name="Leaf" eSuperTypes="#//Member #//Other"></eClassifiers>`;
  const ambiguous = valid.replace('</ecore:EPackage>', siblings + '</ecore:EPackage>');
  const disambiguated = ambiguous.replace('name="Leaf" eSuperTypes="#//Member #//Other">', `name="Leaf" eSuperTypes="#//Member #//Other">${operation}`);
  const responses = [];
  for (const [text, ok] of [[valid, true], [duplicate, false], [generic, false], [typed, true], [ambiguous, false], [disambiguated, true]]) {
    const source = { id: { uri: 'file:///members.ecore', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] };
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, entry: source.id, namespace: 'urn:intersect:example:library:1', class: 'Member' };
    const native = nativeOracle({ method: 'ecore/members', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/ecoreMembers', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok); expect(browser.operations_executable).toBe(false);
    responses.push(browser);
  }
  const members = responses[0].members;
  expect(members.features[0].identity.declaration.path).toEqual([0, 0]);
  expect(members.operations.map(entry => entry.operation.declaration.path)).toEqual([[0, 1], [3, 0]]);
  expect(members.resolved_operations[0].selected.owner).toBe('Member');
  expect(members.resolved_operations[0].overridden[0].path).toEqual([0, 1]);
  await compileMigratedFixture(page, valid);
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const accepted = await page.evaluate(() => window.workbench.inspect());
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  const migration=await page.evaluate(text=>window.workbench.request('intersect/migrateEcore',{uri:'memory:members.ecore',text,target_uri:'memory:members.rcore'}),duplicate);
  expect(migration.ok).toBe(false);
  expect(migration.report.issues.some(issue=>issue.blocks_conversion && issue.message.includes('Duplicate local operation signature'))).toBe(true);
  const rejected = await page.evaluate(() => window.workbench.inspect());
  expect(rejected.revision).toBe(accepted.revision); expect(rejected.package).toEqual(accepted.package); expect(rejected.evaluation).toEqual(accepted.evaluation);
});
test('actual WASM compiler, model inspector and the three Monaco definition editors', async ({ page }) => {
  await loadMigratedLibrary(page);
  await expect(page.locator('#runtime-label')).toHaveText('Native WASM ready');
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  await expect(page.locator('#model-tree')).toContainText('available: false');
  for (const name of ['xtext', 'rcore_behavior', 'rcore']) {
    if (name === 'rcore_behavior') {
      await page.locator('.ide-file-menu > summary').click();
      await page.locator('#open-behavior-source').click();
    } else {
      await page.locator(`[data-definition="${name}"]`).click();
    }
    await expect(page.locator('#definition-file')).toHaveText(name === 'rcore' ? 'model.rcore' : `library.${name}`);
  }
  const state = await page.evaluate(() => window.workbench.inspect());
  expect(state.evaluation.references).toHaveLength(2);
  expect(state.package.schema.uri).toBe('urn:intersect:example:library:1');
  await page.screenshot({ path: 'test-results/workbench-desktop.png', fullPage: true });
});

test('Rcore v2 native and WASM ASTs agree and syntax diagnostics preserve the active package', async ({ page }) => {
  await loadMigratedLibrary(page);
  test.setTimeout(90000);
  const valid = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-v2-behavior.rcore', import.meta.url), 'utf8');
  const malformed = 'rcore 1;\npackage sample version "1";\nfn broken() -> String = "😀" + ;\nfn recovered() -> Int = 1;';
  const deep = `rcore 1; package deep version "1"; fn f() -> Int = ${'('.repeat(200)}1${')'.repeat(200)};`;
  const unary = `rcore 1; package deep version "1"; fn f() -> Int = ${'-'.repeat(200)}1;`;
  const types = `rcore 1; package deep version "1"; fn f() -> ${'List<'.repeat(200)}Int${'>'.repeat(200)} = [];`;
  const patterns = `rcore 1; package deep version "1"; fn f() -> Int = match item { ${'Some('.repeat(200)}x${')'.repeat(200)} => 0 };`;
  const before = await page.evaluate(() => window.workbench.inspect());
  for (const text of [valid, malformed, deep, unary, types, patterns]) {
    const params = { uri: 'file:///definitions/library-behavior.rcore', text };
    const native = nativeOracle({ method: 'rcore_behavior/parse', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/parseRcore', params), params);
    expect(browser).toEqual(native);
    expect(browser.executable).toBe(false);
    expect(browser.stage).toBe('syntax');
    expect(browser.ok).toBe(text === valid);
  }
  await page.evaluate(async text => { window.workbench.definitionModels.rcore_behavior.setValue(text); await window.workbench.compile(); }, valid);
  await expect(page.locator('#diagnostic-list')).toContainText('Derivation result must match feature type');
  await page.evaluate(async text => { window.workbench.definitionModels.rcore_behavior.setValue(text); await window.workbench.compile(); }, malformed);
  await expect(page.locator('#diagnostic-list')).toContainText('Expected an identifier');
  const range = await page.evaluate(() => window.workbench.definitionModels.rcore_behavior.getAllDecorations().find(d => d.options.className?.includes('squiggly-error'))?.range);
  expect(range.startLineNumber).toBe(3);
  expect(range.startColumn).toBe(malformed.split('\n')[2].indexOf(';') + 1);
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after.revision).toBe(before.revision);
  expect(after.package).toEqual(before.package);
  expect(after.evaluation).toEqual(before.evaluation);
});

test('Rcore module binding has native/WASM parity for exact imports, cycles, scopes and revisions', async ({ page }) => {
  test.setTimeout(90000);
  const compilation = migratedCompilationFixture(JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/library/rcore-behavior-modules.json', import.meta.url), 'utf8')));
  const initial = await page.evaluate(() => window.workbench.inspect());
  const make = (uri, text) => ({ id: { uri, sha256: createHash('sha256').update(text).digest('hex') }, kind: 'rcore_behavior', text, dependencies: [] });
  const missing = structuredClone(compilation);
  missing.bundle.sources.find(s => s.id.sha256 === missing.rcore_behavior.sha256).dependencies = [missing.ecore];
  const changed = structuredClone(compilation);
  const oldRules = changed.bundle.sources[3];
  const rules = make(oldRules.id.uri, oldRules.text + '\npub fn scoped(value: Int) -> Int = { let value = value + 1; let f = |x: Int| value + x; f(value) };\n');
  changed.bundle.sources[3] = rules;
  changed.bundle.sources[2].dependencies = [changed.ecore, rules.id];
  const ambiguous = structuredClone(changed);
  ambiguous.bundle.sources.push(oldRules);
  ambiguous.bundle.sources[2].dependencies.push(oldRules.id);
  const hidden = structuredClone(compilation);
  const privateRules = make(oldRules.id.uri, oldRules.text.replace('pub fn atMostOne', 'private fn atMostOne'));
  hidden.bundle.sources[3] = privateRules;
  hidden.bundle.sources[2].dependencies = [hidden.ecore, privateRules.id];
  const a = make('file:///a-behavior.rcore', 'rcore 1; package cycle.a version "1"; import package cycle.b version "1" as b; pub fn first() -> Int = b.second();');
  const b = make('file:///b-behavior.rcore', 'rcore 1; package cycle.b version "1"; import package cycle.a version "1" as a; pub fn second() -> Int = a.first();');
  a.dependencies = [b.id]; b.dependencies = [a.id];
  const cycle = { bundle: { version: 1, sources: [a, b], namespaces: [] }, rcore_behavior: a.id };
  const broken = structuredClone(changed);
  const brokenRules = make(rules.id.uri, rules.text + '\npub fn broken() -> Int = missingName;\n');
  broken.bundle.sources[3] = brokenRules;
  broken.bundle.sources[2].dependencies = [broken.ecore, brokenRules.id];
  const reordered = structuredClone(compilation); reordered.bundle.sources.reverse();
  const responses = [];
  for (const [value, ok] of [[compilation, true], [reordered, true], [missing, false], [changed, true], [ambiguous, false], [hidden, false], [cycle, true], [broken, false]]) {
    const params = { bundle: value.bundle, entry: value.rcore_behavior };
    const native = nativeOracle({ method: 'rcore_behavior/bind', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/bindRcore', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok); expect(browser.executable).toBe(false);
    responses.push(browser);
  }
  expect(responses[0]).toEqual(responses[1]);
  expect(responses[2].diagnostics[0].message).toContain('No exact dependency');
  expect(responses[4].diagnostics[0].message).toContain('Ambiguous');
  expect(responses[5].diagnostics[0].message).toContain('Private');
  expect(responses[7].diagnostics[0].span.source).toEqual(brokenRules.id);
  const validCompilation = await page.evaluate(input => window.workbench.compileBundle(input), compilation);
  expect(validCompilation.ok).toBe(false);
  expect(validCompilation.diagnostics[0].message).toContain('Derivation result must match feature type');
  const rejected = await page.evaluate(input => window.workbench.compileBundle(input), missing);
  expect(rejected.diagnostics[0].source).toBe(compilation.rcore_behavior.uri);
  await expect(page.locator('#diagnostic-list')).toContainText('No exact dependency');
  const externalError = await page.evaluate(input => window.workbench.compileBundle(input), broken);
  expect(externalError.diagnostics[0].source).toBe(brokenRules.id.uri);
  await expect(page.locator('#diagnostic-list')).toContainText('Unresolved value name missingName');
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after.revision).toBe(initial.revision); expect(after.package).toEqual(initial.package); expect(after.evaluation).toEqual(initial.evaluation);
});

test('Rcore enum annotations literals and pattern coverage agree natively and in WASM', async ({ page }) => {
  const make = sourceFixture;
  const model = make('file:///enums.ecore', 'ecore', `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="enums" nsURI="urn:enums"><eClassifiers xsi:type="e:EEnum" name="Mode"><eLiterals name="First" value="7"/><eLiterals name="Alias" value="7"/></eClassifiers><eClassifiers xsi:type="e:EEnum" name="Empty"/></e:EPackage>`);
  for (const [body, ok] of [
    ['fn f(x: m.Mode) -> Bool = match x { m.Mode.First => true, m.Mode.Alias => false }; fn value() -> m.Mode = m.Mode.Alias;', true],
    ['fn f(x: Result<m.Mode?, String>) -> Bool = match x { Ok(Some(m.Mode.First)) => true, Ok(Some(m.Mode.Alias)) => false, Ok(none) => false, Err(_) => false };', true],
    ['fn f(x: m.Empty?) -> Bool = match x { none => false };', true],
    ['fn f(x: m.Mode) -> Bool = match x { m.Mode.First => true };', false],
    ['fn f() -> Int = m.Mode.First;', false],
    ['fn f(x: m.Mode) -> Bool = match x { m.Mode.First => true, m.Mode.Alias => false, _ => false };', false],
  ]) {
    const source = make('file:///enums-behavior.rcore', 'rcore_behavior', `rcore 1; package enums version "1"; import model "urn:enums" as m; ${body}`, [model.id]);
    const params = { bundle: { version: 1, sources: [source, model], namespaces: [] }, entry: source.id };
    const native = nativeOracle({ method: 'rcore_behavior/check', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok);
    expect(browser.stage).toBe('typing'); expect(browser.executable).toBe(false);
  }
});

test('Rcore typing has native/WASM parity and failed type edits retain the active package', async ({ page }) => {
  test.setTimeout(120000);
  const fixture = migratedCompilationFixture(JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/rcore-behavior-typing/bundle.json', import.meta.url), 'utf8')));
  const initial = await page.evaluate(() => window.workbench.inspect());
  const make = (uri, text) => ({ id: { uri, sha256: createHash('sha256').update(text).digest('hex') }, kind: 'rcore_behavior', text, dependencies: [] });
  const single = body => {
    const source = make('file:///typing/standalone-behavior.rcore', `rcore 1; package standalone version "1"; ${body}`);
    return { bundle: { version: 1, sources: [source], namespaces: [] }, rcore_behavior: source.id };
  };
  const revised = structuredClone(fixture);
  const helper = revised.bundle.sources[3];
  const changed = make(helper.id.uri, helper.text + '\npub fn identity(x: Int) -> Int = x;\n');
  revised.bundle.sources[3] = changed;
  revised.bundle.sources[2].dependencies = [revised.ecore, changed.id];
  const broken = structuredClone(revised);
  const wrong = make(changed.id.uri, changed.text.replace('-> String = value;', '-> String = 1;'));
  broken.bundle.sources[3] = wrong;
  broken.bundle.sources[2].dependencies = [broken.ecore, wrong.id];
  const reordered = structuredClone(fixture); reordered.bundle.sources.reverse();
  const responses = [];
  for (const [input, ok] of [
    [fixture, true], [reordered, true], [revised, true], [broken, false],
    [single('fn f() -> UInt64 = 18446744073709551615; fn g() -> Float32 = 1.401298464324817e-45;'), true],
    [single('fn f() -> UInt64 = 18446744073709551616;'), false],
    [single('fn f() -> Float32 = 1e-46;'), false],
    [single('fn f(x: Result<Bool?, String>) -> Int = match x { Ok(Some(true)) => 1, Ok(Some(false)) => 2, Ok(none) => 3, Err(_) => 0 };'), true],
    [single('fn f(x: Bool?) -> Int = match x { Some(true) => 1, none => 0 };'), false],
    [single('fn f(x: Decimal) -> Int = match x { 1e1000000000000000000000000 => 1, 10e999999999999999999999999 => 2, _ => 0 };'), false],
    [single(`fn f() -> Int = ${Array(10000).fill('1').join(' + ')};`), true],
  ]) {
    const params = { bundle: input.bundle, entry: input.rcore_behavior };
    const native = nativeOracle({ method: 'rcore_behavior/check', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), params);
    expect(browser).toEqual(native); expect(browser.ok).toBe(ok);
    expect(browser.stage).toBe('typing'); expect(browser.executable).toBe(false);
    responses.push(browser);
  }
  expect(responses[0]).toEqual(responses[1]);
  expect(responses[3].diagnostics.some(d => d.span.source.sha256 === wrong.id.sha256 && d.message.includes('Type mismatch'))).toBe(true);
  const accepted = await page.evaluate(input => window.workbench.compileBundle(input), fixture);
  expect(accepted.ok).toBe(false);
  expect(accepted.diagnostics[0].message).toContain('Typed package function activation is not implemented');
  const rejected = await page.evaluate(input => window.workbench.compileBundle(input), broken);
  expect(rejected.diagnostics.some(d => d.source === wrong.id.uri && d.message.includes('Type mismatch'))).toBe(true);
  const invalid = 'rcore 1;\npackage edit version "1";\nfn wrong() -> Int = "😀";';
  await page.evaluate(async text => { window.workbench.definitionModels.rcore_behavior.setValue(text); await window.workbench.compile(); }, invalid);
  await expect(page.locator('#diagnostic-list')).toContainText('Type mismatch');
  const range = await page.evaluate(() => window.workbench.definitionModels.rcore_behavior.getAllDecorations().find(d => d.options.className?.includes('squiggly-error'))?.range);
  expect(range.startLineNumber).toBe(3); expect(range.startColumn).toBe(invalid.split('\n')[2].indexOf('"') + 1);
  expect(range.endColumn - range.startColumn).toBe(4);
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after.revision).toBe(initial.revision); expect(after.package).toEqual(initial.package); expect(after.evaluation).toEqual(initial.evaluation);
});

test('multi-resource bundles activate in the real worker and failed resolution preserves the active package', async ({ page }) => {
  const compilation = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/library/multi-resource-canonical.json', import.meta.url), 'utf8'));
  const result = await page.evaluate(compilation => window.workbench.compileBundle(compilation), compilation);
  expect(result.ok).toBe(true);
  expect(result.revision).toBe(2);
  await expect(page.locator('#active-revision')).toContainText('REV 2');
  await expect(page.locator('#export-package')).toBeEnabled();
  const state = await page.evaluate(() => window.workbench.inspect());
  expect(state.package.version).toBe(2);
  expect(state.package.compilation.bundle.sources).toHaveLength(4);
  expect(state.evaluation.model.elements).toHaveLength(6);
  expect(state.evaluation.references).toHaveLength(2);
  expect(state.evaluation.diagnostics).toHaveLength(0);
  await page.evaluate(() => {
    const model = window.workbench.definitionModels.rcore;
    model.setValue(model.getValue().replace('default "1"', 'default "3"'));
  });
  await page.locator('#compile').click();
  await expect(page.locator('#active-revision')).toContainText('REV 3');
  const edited = await page.evaluate(() => window.workbench.inspect());
  expect(edited.package.compilation.ecore.sha256).not.toBe(compilation.ecore.sha256);
  expect(edited.package.compilation.bundle.sources[2].dependencies[0]).toEqual(edited.package.compilation.ecore);
  expect(edited.evaluation.model.elements.find(e => e.values.name === 'dune').values.edition).toBe(3);
  compilation.bundle.sources[0].dependencies = [];
  const failed = await page.evaluate(compilation => window.workbench.compileBundle(compilation), compilation);
  expect(failed.ok).toBe(false);
  expect(failed.diagnostics[0].source).toBe(compilation.ecore.uri);
  expect(failed.diagnostics[0].start).toBeGreaterThan(0);
  expect(failed.revision).toBe(3);
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model.elements).toHaveLength(6);
});

test('migrated nested packages compile from the Rcore definition tab', async ({ page }) => {
  await loadMigratedLibrary(page);
  const original = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore',import.meta.url),'utf8');
  const declaration = original.match(/<eClassifiers xsi:type="ecore:EClass" name="Named"[\s\S]*?<\/eClassifiers>/)[0];
  const nested = original.replace(declaration, `<eSubpackages name="common" nsURI="urn:intersect:example:common:1">${declaration}</eSubpackages>`).replaceAll('#//Named','#//common/Named');
  await compileMigratedFixture(page,nested);
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  const state = await page.evaluate(() => window.workbench.inspect());
  expect(Object.values(state.package.schema.declarations).some(d=>d.namespace==='urn:intersect:example:common:1' && d.name==='Named')).toBe(true);
});

test('grammar edit changes accepted syntax and failed compilation preserves last package', async ({ page }) => {
  await page.evaluate(() => { const m = window.workbench.definitionModels.xtext; m.setValue(m.getValue().replace("'copy' name", "'book' name")); });
  await page.getByRole('button', { name: /^Compile/ }).click();
  await expect(page.locator('#active-revision')).toContainText('REV 2');
  await expect(page.locator('#diagnostic-list')).toContainText('Expected');
  await page.evaluate(() => { const m = window.workbench.modelModels.catalog; m.setValue(m.getValue().replaceAll('copy ', 'book ')); });
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  await page.evaluate(() => window.workbench.definitionModels.rcore.setValue('invalid Rcore'));
  await page.getByRole('button', { name: /^Compile/ }).click();
  await expect(page.locator('#compile-status')).toHaveText('Definition compilation failed');
  expect((await page.evaluate(() => window.workbench.inspect())).revision).toBe(2);
  await expect(page.locator('#element-count')).toHaveText('6 elements');

});

test('Ecore migration preserves namespace aliases and Unicode diagnostic byte ranges', async ({page}) => {
  await loadMigratedLibrary(page);
  const original=readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library.ecore',import.meta.url),'utf8');
  const aliased=original.replaceAll('ecore:','model:').replaceAll('xmlns:ecore','xmlns:model').replaceAll('xsi:','instance:').replaceAll('xmlns:xsi','xmlns:instance');
  await compileMigratedFixture(page,aliased);
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const accepted=await page.evaluate(()=>window.workbench.inspect());
  for(const attribute of ['volatile="true"','volatile="true\nx"']) {
    const text=aliased.replace('name="Loan"','name="Loan😀" '+attribute);
    const params={uri:'memory:aliased.ecore',text,target_uri:'memory:aliased.rcore'};
    const result=await page.evaluate(p=>window.workbench.request('intersect/migrateEcore',p),params);
    expect(result).toEqual(nativeOracle({method:'ecore/migrate',...params}));
    expect(result.ok).toBe(false);
    const issue=result.report.issues.find(i=>i.code==='unsupported_attribute');
    expect(issue.blocks_conversion).toBe(true);
    expect(Buffer.from(text).subarray(issue.span.start,issue.span.end).toString('utf8')).toBe(attribute);
    expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(accepted);
  }
});
test('semantic invalidation, unresolved references and versioned language services', async ({ page }) => {
  const uri = 'file:///models/loans.library';
  const params = { textDocument: { uri }, position: { line: 1, character: 19 } };
  const result = await page.evaluate(async params => ({
    completions: await window.workbench.request('textDocument/completion', params),
    hover: await window.workbench.request('textDocument/hover', params),
    definitions: await window.workbench.request('textDocument/definition', params),
  }), params);
  expect(result.completions.items.map(x => x.label)).toContain('dune');
  expect(result.hover.contents.value).toContain('BookCopy dune');
  expect(result.definitions[0].uri).toBe('file:///models/catalog.library');
  await page.evaluate(() => window.workbench.modelModels.loans.setValue('library Circulation {}'));
  await expect(page.locator('#model-tree').getByText('available: true')).toHaveCount(2);
  await page.evaluate(() => window.workbench.modelModels.loans.setValue('library Circulation { loan bad copy absent to ada; }'));
  await expect(page.locator('#diagnostic-list')).toContainText("Unresolved reference 'absent'");
  await expect(page.locator('#export')).toBeDisabled();
});
test('Monaco completion UI and go to definition use the browser server', async ({ page }) => {
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.locator('[data-model="loans"]').click();
  await page.evaluate(() => {
    const editor = window.workbench.modelEditor;
    editor.setPosition({ lineNumber: 2, column: 19 }); editor.focus(); editor.trigger('test', 'editor.action.triggerSuggest', {});
  });
  await expect(page.locator('.suggest-widget.visible')).toBeVisible();
  await expect(page.locator('.suggest-widget.visible')).toContainText('dune');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const e = window.workbench.modelEditor; e.setPosition({ lineNumber: 2, column: 20 }); e.trigger('test', 'editor.action.revealDefinition', {}); });
  await expect(page.locator('#model-file')).toHaveText('catalog.library');
});
test('runtime recovery and narrow layout', async ({ page }) => {
  await page.locator('.ide-info > summary').click(); await page.getByRole('button', { name: 'Restart runtime' }).click(); await page.locator('.ide-info > summary').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/workbench-mobile.png', fullPage: true });
});

test('Rcore defaults and behavior rules compile and stale document versions are ignored', async ({ page }) => {
  await loadMigratedLibrary(page);
  await page.evaluate(async () => {
    const { rcore, rcore_behavior } = window.workbench.definitionModels;
    rcore.setValue(rcore.getValue().replace('default "1"', 'default "7"'));
    rcore_behavior.setValue(rcore_behavior.getValue().replace('<= 1', '<= 0'));
    await window.workbench.compile();
  });
  await expect(page.locator('#diagnostic-list')).toContainText('more than one active loan');
  const before = await page.evaluate(() => window.workbench.inspect());
  expect(before.evaluation.model.elements[1].values.edition).toBe(7);
  await page.evaluate(() => window.workbench.request('textDocument/didChange', { textDocument: { uri: 'file:///models/catalog.library', version: 0 }, contentChanges: [{ text: 'invalid old text' }] }));
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after.evaluation.model).toEqual(before.evaluation.model);
});

test('mixed raw and applied ancestor paths preserve bound alternatives in native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/mixed-ancestry.ecore', import.meta.url), 'utf8');
  const nestedText = text
    .replace('name="Raw" eSuperTypes="#//Base"', 'name="Raw" eSuperTypes="#//Mid"')
    .replace('<eGenericSuperTypes eClassifier="#//Base"><eTypeArguments eClassifier="#//Value"/></eGenericSuperTypes>', '<eGenericSuperTypes eClassifier="#//Mid"><eTypeArguments eClassifier="#//Value"/></eGenericSuperTypes>')
    .replace('</e:EPackage>', '<eClassifiers x:type="e:EClass" name="Mid"><eTypeParameters name="M"/><eGenericSuperTypes eClassifier="#//Base"><eTypeArguments eTypeParameter="#//Mid/M"/></eGenericSuperTypes></eClassifiers></e:EPackage>');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [sourceText, valid, nested = false] of [
    [text, true],
    [nestedText, true, true],
    [nestedText.replace('#//Raw #//Applied', '#//Applied #//Raw'), true, true],
    [text.replace('#//Raw #//Applied', '#//Applied #//Raw'), true],
    [text.replace('<eBounds eClassifier="#//Base"><eTypeArguments eClassifier="#//Value"/></eBounds>', '<eBounds eClassifier="#//Base"><eTypeArguments eClassifier="#//Other"/></eBounds>'), false],
  ]) {
    const source = { id: { uri: 'memory:mixed-ancestry', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] };
    for (const [method, workerMethod, path] of [
      ['ecore/generic-application-bounds', 'intersect/checkGenericApplicationBounds', [7,0,0]],
      ['ecore/generic-inheritance', 'intersect/genericInheritance', [7,1,0]],
    ]) {
      const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: { source: source.id, path } };
      const native = nativeOracle({ method, ...params });
      const browser = await page.evaluate(({ params, workerMethod }) => window.workbench.request(workerMethod, params), { params, workerMethod });
      expect(browser).toEqual(native);
      expect(browser.executable).toBe(false);
      if (path[1] === 0) {
        expect(browser.ok).toBe(valid);
        expect(browser.report.valid).toBe(valid);
        expect(browser.report.warnings[0].code).toBe('raw_type');
      } else {
        expect(browser.ok).toBe(true);
        const bases = browser.report.supertypes.filter(t => JSON.stringify(t.expression.declaration.path) === '[2]');
        expect(bases).toHaveLength(2);
        if (nested) {
          expect(bases.map(t => t.expression.arguments[0].kind).sort()).toEqual(['classifier', 'parameter']);
          expect(bases.find(t => t.expression.arguments[0].kind === 'parameter').expression.arguments[0].declaration.path).toEqual([8,0]);
        } else {
          expect(bases.map(t => t.expression.raw).sort()).toEqual([false, true]);
          expect(bases.find(t => !t.expression.raw).expression.arguments[0].declaration.path).toEqual([0]);
        }
      }
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('native scalar aliases preserve exact generic identities in WASM bound reports', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/scalar-alias-bounds.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [binding, valid] of [['java.lang.String', true], ['java.lang.Integer', false], ['example.Unknown', null]]) {
    const sourceText = text.replace('instanceTypeName="java.lang.String"', 'instanceTypeName="' + binding + '"');
    const source = { id: { uri: 'memory:scalar-aliases', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] };
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: { source: source.id, path: [4,0,0] } };
    const native = nativeOracle({ method: 'ecore/generic-application-bounds', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/checkGenericApplicationBounds', params), params);
    expect(browser).toEqual(native);
    expect(browser.ok).toBe(valid === true);
    if (valid === null) expect(browser.diagnostics[0].message).toContain('provider contract');
    else {
      expect(browser.report.valid).toBe(valid);
      expect(browser.report.checks[0].argument.arguments[0].declaration.path).toEqual([0]);
      expect(browser.report.checks[0].substituted_bound.arguments[0].declaration.path).toEqual([1]);
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('scalar bound materialization shares native WASM defaults and rejected edits', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/materialize-scalar-bounds.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [value, badBound] of [['updated', false], [12, false], ['updated', true]]) {
    const sourceText = badBound ? text.replace('#//EJavaObject', '#//EDate') : text;
    const {source, id:migratedId} = migratedSourceFixture({ id: { uri: 'memory:scalar-materialization', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] });
    const bundle = { version: 1, sources: [source], namespaces: [] };
    const bounds = await page.evaluate(params => window.workbench.request('intersect/checkGenericApplicationBounds', params), { bundle, declaration: migratedId([1,0,0]) });
    expect(bounds.report.valid).toBe(!badBound);
    const receiver = bounds.report.selected.expression;
    const params = { bundle, types: [receiver], instances: [{ id: 'h', type: receiver }], edits: [['h', 'value', value]] };
    const native = nativeOracle({ method: 'ecore/materialize', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), params);
    expect(browser).toEqual(native);
    expect(browser.ok).toBe(!badBound && typeof value === 'string');
    if (browser.ok) expect(browser.model.elements[0].values.value).toBe('updated');
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('explicit generic arguments enforce source primitive rules in native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/explicit-arguments.ecore', import.meta.url), 'utf8');
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const metadata of ['instanceClassName', 'instanceTypeName']) {
    for (const [binding, valid] of [['int', false], ['java.lang.Integer', true], ['byte[]', true]]) {
      const sourceText = text.replace('instanceClassName', metadata).replace('"int"', '"' + binding + '"');
      const {source, id:migratedId} = migratedSourceFixture({ id: { uri: 'memory:argument-parity', sha256: createHash('sha256').update(sourceText).digest('hex') }, kind: 'ecore', text: sourceText, dependencies: [] });
      const bundle = { version: 1, sources: [source], namespaces: [] };
      const type = (n, args = []) => ({ kind: 'classifier', declaration: migratedId([n]), arguments: args, raw: false });
      const boxed = type(1, [type(0)]);
      for (const [method, workerMethod, request] of [
        ['ecore/generic-instantiate-members', 'intersect/instantiateGenericMembers', { receiver: boxed }],
        ['ecore/generic-operation-types', 'intersect/instantiateGenericOperation', { receiver: type(2), operation: migratedId([2,1]), arguments: [type(0)] }],
        ['ecore/materialize', 'intersect/materializeGenericTypes', { types: [boxed], instances: [{ id: 'b', type: boxed }] }],
      ]) {
        const params = { bundle, ...request };
        const native = nativeOracle({ method, ...params });
        const browser = await page.evaluate(({ params, workerMethod }) => window.workbench.request(workerMethod, params), { params, workerMethod });
        expect(browser).toEqual(native);
        expect(browser.ok).toBe(valid);
        if (!valid) expect(browser.diagnostics[0].message).toContain('Primitive classifier');
      }
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('custom provider bounds materialize with retained dependencies and nominal values', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/provider-alias-bounds.ecore', import.meta.url), 'utf8').replace('</e:EPackage>', '<eClassifiers x:type="e:EDataType" name="Unused" instanceClassName="example.RGB"/></e:EPackage>');
  const {source, id:migratedId} = migratedSourceFixture({ id: { uri: 'memory:provider-materialization', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] });
  const id = n => migratedId([n]);
  const type = n => ({ kind: 'classifier', declaration: id(n), arguments: [], raw: false });
  const receiver = { ...type(2), arguments: [type(1)] };
  const contract = n => ({ datatype: id(n), provider: { name: 'example.rgb', version: '1' }, serializable: true });
  const converted = n => ({ kind: 'converted', datatype: id(n), provider: contract(n).provider, value: { red: 1, green: 2, blue: 3 } });
  const params = { bundle: { version: 1, sources: [source], namespaces: [] }, types: [receiver], instances: [{ id: 'h', type: receiver }], conversions: [contract(0), contract(1)] };
  const native = params => nativeOracle({ method: 'ecore/materialize', ...params });
  const initial = await page.evaluate(() => window.workbench.inspect());
  const result = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), params);
  expect(result).toEqual(native(params)); expect(result.ok).toBe(true);
  expect(result.schema.conversion_contracts).toEqual(params.conversions);
  expect(Object.values(result.schema.datatypes)).toHaveLength(2);
  expect(result.model.elements[0].values.color.datatype).toEqual(id(1));
  const replay = { ...params, conversions: result.schema.conversion_contracts };
  expect(await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), replay)).toEqual(result);
  for (const [changes, ok] of [
    [{ edits: [['h', 'color', converted(1)]] }, true],
    [{ edits: [['h', 'color', converted(0)]] }, false],
    [{ conversions: [contract(1)] }, false],
  ]) {
    const request = { ...params, ...changes };
    const browser = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), request);
    expect(browser).toEqual(native(request)); expect(browser.ok).toBe(ok);
  }
  const unused = { ...params, conversions: [...params.conversions, contract(4)] };
  expect(() => native(unused)).toThrow('Unused conversion provider selection');
  await expect(page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), unused)).rejects.toThrow('Unused conversion provider selection');
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('provider selected generic reports agree across native and WASM without activation', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/provider-alias-bounds.ecore', import.meta.url), 'utf8').replace('  </eClassifiers>', '<eOperations name="identity"><eTypeParameters name="U"><eBounds eClassifier="#//RGB"/></eTypeParameters><eGenericType eTypeParameter="#//Holder/identity/U"/></eOperations>  </eClassifiers>');
  const source = { id: { uri: 'memory:provider-reports', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] };
  const id = path => ({ source: source.id, path });
  const type = n => ({ kind: 'classifier', declaration: id([n]), arguments: [], raw: false });
  const conversions = [0,1].map(n => ({ datatype: id([n]), provider: { name: 'example.rgb', version: '1' }, serializable: true }));
  const base = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: id([3,0,0]), receiver: { ...type(2), arguments: [type(1)] }, operation: id([2,2]), arguments: [type(1)] };
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const [method, worker] of [
    ['ecore/generic-application-bounds','intersect/checkGenericApplicationBounds'],
    ['ecore/generic-member-types','intersect/genericMemberTypes'],
    ['ecore/generic-instantiate-members','intersect/instantiateGenericMembers'],
    ['ecore/generic-operation-types','intersect/instantiateGenericOperation'],
    ['ecore/generic-inheritance','intersect/genericInheritance'],
  ]) {
    for (const selection of [undefined, [conversions[1]], conversions]) {
      const params = { ...base, ...(selection ? { conversions: selection } : {}) };
      const native = nativeOracle({ method, ...params });
      const browser = await page.evaluate(({worker,params}) => window.workbench.request(worker, params), {worker,params});
      expect(browser).toEqual(native);
      expect(browser.ok).toBe(method === 'ecore/generic-inheritance' || selection?.length === 2);
      expect(browser.executable).toBe(false);
    }
  }
  const bad = structuredClone(conversions); bad[0].provider.version = 'unknown';
  await expect(page.evaluate(params => window.workbench.request('intersect/checkGenericApplicationBounds', params), { ...base, conversions: bad })).rejects.toThrow('Unknown native conversion provider');
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('generic operation selection and override reports match native and preserve active state', async ({ page }) => {
  test.setTimeout(120000);
  const fixture = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/operation-overrides.ecore', import.meta.url), 'utf8');
  const custom = fixture.replaceAll('java.lang.String', 'example.RGB');
  const right = '<eClassifiers x:type="e:EClass" name="Right"><eGenericSuperTypes eClassifier="#//Base"><eTypeArguments eClassifier="#//B"/></eGenericSuperTypes><eOperations name="f"><eParameters name="p" eType="#//A"/></eOperations></eClassifiers>';
  const cases = [{text:fixture, receiver:3, ok:true}, {text:custom, receiver:3, ok:false}, {text:custom, receiver:3, ok:true, providers:true}];
  for (const parents of ['#//Derived #//Right','#//Right #//Derived']) {
    cases.push({text:fixture.replace('</e:EPackage>', `${right}<eClassifiers x:type="e:EClass" name="Diamond" eSuperTypes="${parents}"/></e:EPackage>`),receiver:6,ok:false});
  }
  const native = (method,params) => nativeOracle({method,...params});
  const initial = await page.evaluate(() => window.workbench.inspect());
  for (const entry of cases) {
    const source = {id:{uri:'memory:operation-selection',sha256:createHash('sha256').update(entry.text).digest('hex')},kind:'ecore',text:entry.text,dependencies:[]};
    const id = path => ({source:source.id,path});
    const params = {bundle:{version:1,sources:[source],namespaces:[]},receiver:{kind:'classifier',declaration:id([entry.receiver]),arguments:[],raw:false}};
    if(entry.providers) params.conversions = [0,1].map(n=>({datatype:id([n]),provider:{name:'example.rgb',version:'1'},serializable:true}));
    const result = await page.evaluate(params => window.workbench.request('intersect/resolveGenericOperations',params),params);
    expect(result).toEqual(native('ecore/generic-operation-selection',params));
    expect(result.ok).toBe(entry.ok); expect(result.selection_verified).toBe(entry.ok); expect(result.executable).toBe(false);
    if(entry.ok) {
      expect(result.report.operations[0].selected.member.declaration).toEqual(id([3,1]));
      expect(result.report.operations[0].overridden[0].member.declaration).toEqual(id([2,1]));
      for(const [operation,base,overrides] of [[[3,1],[2,1],true],[[2,1],[3,1],false]]) {
        const comparison = {...params,operation:id(operation),base:id(base)};
        const compared = await page.evaluate(params => window.workbench.request('intersect/compareGenericOperationOverride',params),comparison);
        expect(compared).toEqual(native('ecore/generic-operation-override',comparison));
        expect(compared.report.overrides).toBe(overrides); expect(compared.selection_verified).toBe(false); expect(compared.executable).toBe(false);
      }
      const stale = structuredClone(params); stale.receiver.declaration.source = { ...stale.receiver.declaration.source, sha256: '0'.repeat(64) }; stale.selection_verified = true;
      const rejected = await page.evaluate(params => window.workbench.request('intersect/resolveGenericOperations',params),stale);
      expect(rejected).toEqual(native('ecore/generic-operation-selection',stale));
      expect(rejected.ok).toBe(false); expect(rejected.selection_verified).toBe(false);
    } else expect(result.diagnostics[0].span.source).toEqual(source.id);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('materialization retains declared groups across substituted operation signatures', async ({ page }) => {
  test.setTimeout(120000);
  const fixture = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/materialize-operation-selection.ecore', import.meta.url), 'utf8');
  const matching = fixture.replaceAll('eClassifier="#//B"', 'eClassifier="#//A"').replaceAll('eType="#//B"', 'eType="#//A"');
  const inherited = fixture.replace('<eOperations name="f"><eParameters name="p" eType="#//B"/></eOperations>', '');
  const cases = [
    {text:fixture, receiver:3, count:2},
    {text:fixture.replaceAll('eType="#//B"', 'eType="#//A"'), receiver:3, count:1},
    {text:matching, receiver:3, count:1}, {text:inherited, receiver:3, count:1},
  ];
  const custom = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/operation-overrides.ecore', import.meta.url), 'utf8')
    .replaceAll('java.lang.String', 'example.RGB')
    .replace('<eTypeParameters name="U"><eBounds eClassifier="#//B"/></eTypeParameters>', '')
    .replace('eTypeParameter="#//Derived/f/U"', 'eClassifier="#//B"');
  cases.push({text:custom,receiver:3,count:1,providers:true});
  for(const parents of ['#//Derived #//Right', '#//Right #//Derived']) {
    cases.push({text:inherited.replace('</e:EPackage>', `<eClassifiers x:type="e:EClass" name="Right"><eOperations name="f"><eParameters name="p" eType="#//A"/></eOperations></eClassifiers><eClassifiers x:type="e:EClass" name="Diamond" eSuperTypes="${parents}"/></e:EPackage>`), receiver:5, message:'Ambiguous inherited generic operation'});
  }
  const initial = await page.evaluate(() => window.workbench.inspect());
  for(const entry of cases) {
    const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:materialized-selection',sha256:createHash('sha256').update(entry.text).digest('hex')},kind:'ecore',text:entry.text,dependencies:[]});
    const type = n => ({kind:'classifier',declaration:migratedId([n]),arguments:[],raw:false});
    const params = {bundle:{version:1,sources:[source],namespaces:[]},types:entry.providers ? [type(entry.receiver)] : [type(0),type(1),type(entry.receiver)],instances:[{id:'d',type:type(entry.receiver)}]};
    if(entry.providers) params.conversions = [0,1].map(n=>({datatype:migratedId([n]),provider:{name:'example.rgb',version:'1'},serializable:true}));
    const native = nativeOracle({method:'ecore/materialize',...params});
    const result = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes',params),params);
    expect(result).toEqual(native);
    expect(result.ok).toBe(!entry.message);
    if(entry.message) {
      expect(result.diagnostics[0].message).toContain(entry.message);
      expect(result.diagnostics[0].span.source).toEqual(source.id);
    } else {
      expect(result.model.elements.map(e=>e.id)).toEqual(['d']);
      const contract = Object.values(result.schema.declared_operation_selections).find(c => c.receiver.declaration.path[0] === migratedId([entry.receiver]).path[0]);
      expect(contract.groups).toHaveLength(entry.count);
      if(entry.count === 2) {
        expect(contract.groups[0].signature).not.toEqual(contract.groups[1].signature);
        expect(contract.groups.every(group => group.operations.length === 1)).toBe(true);
      } else if(entry.text !== inherited) {
        expect(contract.groups[0].selected).toEqual(migratedId([3,1]));
        expect(contract.groups[0].operations.map(o=>o.operation.declaration)).toEqual([migratedId([3,1]),migratedId([2,1])]);
      }
    }
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('materialized method templates check explicit applications with native WASM parity', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/method-templates.ecore', import.meta.url), 'utf8');
  const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:method-templates',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
  const id = path => migratedId(path);
  const type = n => ({kind:'classifier',declaration:id([n]),arguments:[],raw:false});
  const params = {bundle:{version:1,sources:[source],namespaces:[]},types:[type(0),type(2),type(3)],instances:[{id:'child',type:type(2)}]};
  const native = params => nativeOracle({method:'ecore/materialize',...params});
  const initial = await page.evaluate(() => window.workbench.inspect());
  for(const [args,ok] of [[[type(0)],true],[[],false],[[type(3)],false],[[type(0),type(0)],false]]) {
    const request = {...params,operation_applications:[{receiver:type(2),operation:id([1,1]),arguments:args}]};
    const result = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes',params),request);
    expect(result).toEqual(native(request)); expect(result.ok).toBe(ok);
    if(ok) {
      const contract = Object.values(result.schema.declared_operation_selections).find(c=>c.receiver.declaration.path[0]===2);
      const selected = contract.groups[0].operations[0];
      expect(selected.operation.generic).toBe(true);
      expect(selected.template.formals[0].bounds).toEqual([type(0)]);
      expect(selected.operation.result.target.name.kind).toBe('parameter');
      expect(selected.operation.parameters[1].value.upper).toBe(-1);
      expect(selected.operation.parameters[1].value.unique).toBe(false);
      expect(result.operation_applications[0].executable).toBe(false);
      const standalone = await page.evaluate(params=>window.workbench.request('intersect/instantiateGenericOperation',params),{bundle:params.bundle,receiver:type(2),operation:id([1,1]),arguments:args});
      expect(result.operation_applications[0].report).toEqual(standalone.report);
      expect(result.model.elements.map(e=>e.id)).toEqual(['child']);
    } else expect(result.diagnostics[0].span).toBeTruthy();
  }
  const stale = {...params,operation_applications:[{receiver:type(2),operation:{source:{...source.id,sha256:'0'.repeat(64)},path:[1,1]},arguments:[type(0)]}]};
  const rejected = await page.evaluate(params=>window.workbench.request('intersect/materializeGenericTypes',params),stale);
  expect(rejected).toEqual(native(stale)); expect(rejected.ok).toBe(false);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('generic datatype catalog rejects erased conversion domains in native and WASM', async ({ page }) => {
  const text = '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="g" nsURI="urn:g"><eClassifiers x:type="e:EDataType" name="Color"><eTypeParameters name="T"/></eClassifiers></e:EPackage>';
  const source = { id: { uri: 'memory:generic-color.ecore', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] };
  const params = { bundle: { version: 1, sources: [source], namespaces: [] }, declaration: { source: source.id, path: [0,0] }, conversions: [{ datatype: { source: source.id, path: [0] }, provider: { name: 'example.rgb', version: '1' }, serializable: true }] };
  const initial = await page.evaluate(() => window.workbench.inspect());
  const message = 'Generic datatype requires a specialized application provider';
  let nativeFailure;
  try {
    execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], { cwd: new URL('../.runtime/intersect-text/', import.meta.url), input: JSON.stringify({ method: 'ecore/generic-application-bounds', ...params }), encoding: 'utf8', timeout: 60000, stdio: ['pipe','pipe','pipe'] });
  } catch (error) { nativeFailure = error; }
  expect(nativeFailure?.status).toBe(1);
  expect(nativeFailure?.stderr).toContain(message);
  await expect(page.evaluate(params => window.workbench.request('intersect/checkGenericApplicationBounds', params), params)).rejects.toThrow(message);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('closed datatype applications check exact bounds and identity in native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/datatype-applications.ecore', import.meta.url), 'utf8');
  const source = { id: { uri: 'memory:applications.ecore', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] };
  const type = (index, arguments_ = []) => ({ kind: 'classifier', declaration: { source: source.id, path: [index] }, arguments: arguments_, raw: false });
  const cases = [[type(3,[type(0)]),true],[type(3,[type(1)]),true],[type(9,[type(1)]),true],
    [type(4,[type(0),type(1)]),true],[type(8,[type(3,[type(1)])]),true],[type(6),true],
    [type(0),false],[type(7),false],[type(3),false],[type(3,[type(0),type(1)]),false],
    [type(3,[type(2)]),false],[type(4,[type(1),type(0)]),false],[type(8,[type(3,[type(2)])]),false],
    [type(8,[type(5)]),false]];
  const stale = structuredClone(type(3,[type(1)]));
  stale.arguments[0].declaration.source = { ...source.id, sha256: '0'.repeat(64) };
  cases.push([stale,false]);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const identities = new Set();
  for (const [application, ok] of cases) {
    const params = { bundle: { version: 1, sources: [source], namespaces: [] }, application };
    const native = nativeOracle({ method: 'ecore/generic-datatype-application', ...params });
    const browser = await page.evaluate(params => window.workbench.request('intersect/instantiateGenericDatatype', params), params);
    expect(browser).toEqual(native);
    expect(browser.ok).toBe(ok);
    expect(browser.executable).toBe(false);
    if (ok) {
      identities.add(JSON.stringify(browser.report.application));
      expect(browser.report.bounds.every(bound => bound.satisfied)).toBe(true);
    }
  }
  expect(identities.size).toBe(6);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('applied collection values retain exact native WASM domains and nested tags', async ({ page }) => {
  test.setTimeout(120000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/applied-collections.ecore', import.meta.url), 'utf8');
  const source = { id: { uri: 'memory:applied-collections.ecore', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] };
  const id = n => ({source:source.id,path:[n]});
  const type = (n,args=[]) => ({kind:'classifier',declaration:id(n),arguments:args,raw:false});
  const member = n => ({nullable:false,value:{kind:'datatype',declaration:id(n)}});
  const selected = (n,name,args,members) => ({application:type(n,args),conversion:{datatype:id(n),provider:{name,version:'1'},serializable:false,members}});
  const textList = selected(2,'ecore.list',[type(0)],[member(0)]);
  const numberList = selected(2,'ecore.list',[type(1)],[member(1)]);
  const nestedList = selected(2,'ecore.list',[textList.application],[{nullable:false,value:{kind:'applied',contract:textList}}]);
  const map = selected(3,'ecore.map',[type(0),type(1)],[member(0),member(1)]);
  const conversions = [textList,numberList,nestedList,map];
  const nominal = (n,value) => ({kind:'datatype',datatype:id(n),value});
  const initial = await page.evaluate(() => window.workbench.inspect());
  const run = async (operation, selected=conversions) => {
    const params = {bundle:{version:1,sources:[source],namespaces:[]},conversions:selected,operation};
    const native = nativeOracle({method:'conversion/applied',...params});
    const result = await page.evaluate(params => window.workbench.request('intersect/appliedConversion',params),params);
    expect(result).toEqual(native); expect(result.model_published).toBe(false);
    return result;
  };
  const bound = await run({kind:'bind',application:textList.application,payload:{items:[nominal(0,'hello')]}});
  expect(bound.ok).toBe(true); expect(bound.value_verified).toBe(true);
  expect(bound.value.kind).toBe('converted_application_v1');
  const other = await run({kind:'bind',application:numberList.application,payload:{items:[nominal(1,42)]}});
  expect(other.ok).toBe(true);
  expect((await run({kind:'validate',application:numberList.application,value:bound.value})).ok).toBe(false);
  expect((await run({kind:'validate',application:textList.application,value:JSON.parse(JSON.stringify(bound.value))})).ok).toBe(true);
  expect((await run({kind:'bind',application:nestedList.application,payload:{items:[bound.value]}})).ok).toBe(true);
  expect((await run({kind:'bind',application:nestedList.application,payload:{items:[other.value]}})).ok).toBe(false);
  expect((await run({kind:'bind',application:map.application,payload:{entries:[{key:nominal(0,'key'),value:nominal(1,42)}]}})).ok).toBe(true);
  const wrong = structuredClone(conversions); wrong[0].conversion.members = [member(1)];
  expect((await run({kind:'bind',application:textList.application,payload:{items:[]}},wrong)).ok).toBe(false);
  expect((await run({kind:'validate',application:numberList.application,value:other.value},[textList])).ok).toBe(false);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});


test('applied datatype attributes materialize edit and replay packages in native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const make = (uri,kind,text,dependencies=[]) => ({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies});
  const {source, id:migratedId} = migratedSourceFixture(make('memory:applied-model.ecore','ecore',readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/applied-model.ecore',import.meta.url),'utf8')));
  const id = n => migratedId([n]);
  const type = (n,args=[]) => ({kind:'classifier',declaration:id(n),arguments:args,raw:false});
  const member = n => ({nullable:false,value:{kind:'datatype',declaration:id(n)}});
  const selected = (n,name,args,members) => ({application:type(n,args),conversion:{datatype:id(n),provider:{name,version:'1'},serializable:false,members}});
  const textList = selected(2,'ecore.list',[type(0)],[member(0)]);
  const numberList = selected(2,'ecore.list',[type(1)],[member(1)]);
  const nested = selected(2,'ecore.list',[textList.application],[{nullable:false,value:{kind:'applied',contract:textList}}]);
  const mapping = selected(3,'ecore.map',[type(0),type(1)],[member(0),member(1)]);
  const applied_conversions = [textList,numberList,nested,mapping];
  const grammar = make('memory:applied-model.xtext','xtext','grammar example.Values import "urn:values" as v\nHolder returns v::Holder: \'holder\' name=ID;',[source.id]);
  const semantics = make('memory:applied-model-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";',[source.id]);
  const bundle = {version:1,sources:[source,grammar,semantics],namespaces:[]};
  const compilation = {ecore:source.id,xtext:grammar.id,rcore_behavior:semantics.id,namespace:'urn:values',materialized_types:[type(4),type(6)],bundle};
  const native = request => nativeOracle(request);
  const bind = (application,payload) => native({method:'conversion/applied',bundle,conversions:applied_conversions,operation:{kind:'bind',application,payload}}).value;
  const words = bind(textList.application,{items:[{kind:'datatype',datatype:id(0),value:'hello'}]});
  const numbers = bind(numberList.application,{items:[{kind:'datatype',datatype:id(1),value:42}]});
  const initial = await page.evaluate(() => window.workbench.inspect());
  const base = {bundle,types:compilation.materialized_types,applied_conversions,instances:[{id:'h',type:type(4)},{id:'child',type:type(6)}]};
  for (const [edits,ok] of [
    [[['h','texts',words],['h','numbers',numbers],['child','values',words],['h','manyTexts',[words]]],true],
    [[['h','name','must roll back'],['h','texts',numbers]],false],
    [[['h','manyTexts',[words,words]]],false],
  ]) {
    const params={...base,edits};
    const result=await page.evaluate(params=>window.workbench.request('intersect/materializeGenericTypes',params),params);
    expect(result).toEqual(native({method:'ecore/materialize',...params})); expect(result.ok).toBe(ok);
    if(ok) { expect(result.schema.applied_conversion_contracts).toHaveLength(4); expect(result.model.elements.find(e=>e.id==='h').values.texts).toEqual(words); }
  }
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
  const compiled=native({method:'compile_bundle',compilation,applied_conversions});
  expect(compiled.ok).toBe(true);
  const accepted=await page.evaluate(params=>window.workbench.request('intersect/compileBundle',params),{compilation,applied_conversions});
  expect(accepted.package).toEqual(compiled.package);
  const sources=await page.evaluate(()=> {
    window.workbench.modelModels.catalog.setValue('holder first');
    window.workbench.modelModels.loans.setValue('holder second');
    return Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}));
  });
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  await expect(page.locator('#element-count')).toHaveText('2 elements');
  const active=await page.evaluate(()=>window.workbench.inspect());
  expect(active.evaluation).toEqual(native({method:'evaluate',package:compiled.package,sources}));
  const rejected=await page.evaluate(params=>window.workbench.request('intersect/compileBundle',params),{compilation,applied_conversions:applied_conversions.slice(0,1)});
  expect(rejected.ok).toBe(false);
  const after=await page.evaluate(()=>window.workbench.inspect());
  expect(after.revision).toBe(active.revision); expect(after.package).toEqual(active.package); expect(after.evaluation).toEqual(active.evaluation);
});


test('applied provider bounds share selected context and retain nested-only dependencies', async ({ page }) => {
  test.setTimeout(120000);
  const text=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/applied-provider-bounds.ecore',import.meta.url),'utf8');
  const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:applied-provider-bounds',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
  const id=n=>(migratedId([n]));
  const type=(n,args=[])=>({kind:'classifier',declaration:id(n),arguments:args,raw:false});
  const contract=(n,name,serializable,members=[])=>({datatype:id(n),provider:{name,version:'1'},serializable,...(members.length?{members}:{})});
  const rgb=contract(0,'example.rgb',true), alias=contract(1,'example.rgb',true);
  const list={application:type(2,[type(1)]),conversion:contract(2,'ecore.list',false,[{nullable:false,value:{kind:'converted',contract:alias}}])};
  const member={nullable:false,value:{kind:'applied',contract:list}};
  const nested={application:type(3,[list.application]),conversion:contract(3,'ecore.list',false,[member])};
  const wrapper=contract(4,'ecore.list',false,[member]);
  const conversions=[wrapper,alias,rgb], applied_conversions=[list,nested];
  const bundle={version:1,sources:[source],namespaces:[]};
  const native=request=>nativeOracle(request);
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const color={kind:'converted',datatype:id(1),provider:alias.provider,value:{red:18,green:58,blue:188}};
  const value={kind:'converted_application_v1',application:list.application,converted:{kind:'converted',datatype:id(2),provider:list.conversion.provider,value:{items:[color]}}};
  const params={bundle,types:[type(5)],conversions,applied_conversions,instances:[{id:'h',type:type(5)}],edits:[['h','values',value]]};
  const result=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),params);
  expect(result).toEqual(native({method:'ecore/materialize',...params})); expect(result.ok).toBe(true);
  expect(result.schema.conversion_contracts).toHaveLength(3);
  expect(result.model.elements[0].values.values).toEqual(value);
  const wrong=structuredClone(value); wrong.converted.value.items[0].datatype=id(0);
  const invalid={...params,edits:[['h','values',wrong]]};
  const rejectedValue=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),invalid);
  expect(rejectedValue).toEqual(native({method:'ecore/materialize',...invalid})); expect(rejectedValue.ok).toBe(false);
  const reversed={...params,conversions:[...conversions].reverse()};
  expect(await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),reversed)).toEqual(result);
  for(const selected of [conversions.slice(0,2),conversions.slice(0,1)]) {
    await expect(page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),{...params,conversions:selected})).rejects.toThrow('assignability contract');
  }
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
  const definition=(uri,kind,text)=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[source.id]});
  const grammar=definition('memory:bound.xtext','xtext',`grammar example.Bound import "urn:colors" as c
OnlyWrapped returns c::OnlyWrapped: 'holder';`);
  const rcore_behavior=definition('memory:bound-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";');
  const compilation={bundle:{...bundle,sources:[source,grammar,rcore_behavior]},ecore:source.id,namespace:'urn:colors',xtext:grammar.id,rcore_behavior:rcore_behavior.id,materialized_types:[type(6)]};
  const compiled=native({method:'compile_bundle',compilation,conversions}); expect(compiled.ok).toBe(true);
  const accepted=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),{compilation,conversions});
  expect(accepted.package).toEqual(compiled.package);
  expect(accepted.package.schema.applied_conversion_contracts).toBeUndefined();
  expect(accepted.package.schema.conversion_contracts).toHaveLength(3);
  const sources=await page.evaluate(()=>{
    window.workbench.modelModels.catalog.setValue('holder'); window.workbench.modelModels.loans.setValue('holder');
    return Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}));
  });
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  await expect(page.locator('#element-count')).toHaveText('2 elements');
  const active=await page.evaluate(()=>window.workbench.inspect());
  expect(active.evaluation).toEqual(native({method:'evaluate',package:compiled.package,sources}));
  const rejected=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),{compilation,conversions:conversions.slice(0,2)});
  expect(rejected.ok).toBe(false);
  const after=await page.evaluate(()=>window.workbench.inspect());
  expect(after.revision).toBe(active.revision); expect(after.evaluation).toEqual(active.evaluation);
});


test('collection and feature-map operations retain applied bound context in WASM', async ({ page }) => {
  test.setTimeout(120000);
  const text=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/applied-provider-operations.ecore',import.meta.url),'utf8');
  const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:applied-operations',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
  const id=n=>(migratedId([n]));
  const type=(n,args=[])=>({kind:'classifier',declaration:id(n),arguments:args,raw:false});
  const rgb={datatype:id(0),provider:{name:'example.rgb',version:'1'},serializable:true};
  const alias={...rgb,datatype:id(1)};
  const applied={application:type(2,[type(1)]),conversion:{datatype:id(2),provider:{name:'ecore.list',version:'1'},serializable:false,members:[{nullable:false,value:{kind:'converted',contract:alias}}]}};
  const nested={application:type(3,[applied.application]),conversion:{datatype:id(3),provider:{name:'ecore.list',version:'1'},serializable:false,members:[{nullable:false,value:{kind:'applied',contract:applied}}]}};
  const wrapper={datatype:id(4),provider:{name:'ecore.list',version:'1'},serializable:false,members:[{nullable:false,value:{kind:'applied',contract:applied}}]};
  const feature=migratedId([6,0]);
  const map={datatype:id(7),provider:{name:'ecore.feature-map',version:'1'},serializable:false,declarations:[feature],members:[{nullable:false,value:{kind:'converted',contract:wrapper}}]};
  const entry={...map,datatype:id(8),provider:{name:'ecore.feature-entry',version:'1'}};
  const definition=(uri,kind,text)=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[source.id]});
  const grammar=definition('memory:operations.xtext','xtext',`grammar example.Operations import "urn:colors" as c
OnlyWrapped returns c::OnlyWrapped: 'holder';`);
  const semantics=definition('memory:operations-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";');
  const params={compilation:{bundle:{version:1,sources:[source,grammar,semantics],namespaces:[]},ecore:source.id,namespace:'urn:colors',xtext:grammar.id,rcore_behavior:semantics.id,materialized_types:[type(5),type(6),type(9)]},conversions:[map,wrapper,entry,alias,rgb],applied_conversions:[applied,nested]};
  const native=request=>nativeOracle(request);
  const compiled=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),params);
  expect(compiled).toMatchObject({ok:true}); expect(compiled.package).toEqual(native({method:'compile_bundle',...params}).package);
  await page.evaluate(()=>{window.workbench.modelModels.catalog.setValue('holder');window.workbench.modelModels.loans.setValue('holder');});
  await expect(page.locator('#element-count')).toHaveText('2 elements');
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const run=async (method,worker,args)=>{
    const result=await page.evaluate(({worker,args})=>window.workbench.request(worker,args),{worker,args});
    expect(result).toEqual(native({method,package:compiled.package,...args}));return result;
  };
  const collection=args=>run('collection/step','intersect/stepCollection',{datatype:id(4),...args});
  const featureMap=(datatype,args)=>run('feature-map/step','intersect/stepFeatureMap',{datatype:id(datatype),...args});
  const value={kind:'converted_application_v1',application:applied.application,converted:{kind:'converted',datatype:id(2),provider:applied.conversion.provider,value:{items:[{kind:'converted',datatype:id(1),provider:alias.provider,value:{red:1,green:2,blue:3}}]}}};
  const appliedStep=args=>run('collection/step','intersect/stepCollection',{application:applied.application,...args});
  const direct=(await appliedStep({operation:{kind:'empty'}})).collection;
  expect((await appliedStep({collection:direct,operation:{kind:'insert',index:0,item:value.converted.value.items[0]}})).collection).toEqual(value);
  const empty=(await collection({operation:{kind:'empty'}})).collection;
  const inserted=(await collection({collection:empty,operation:{kind:'insert',index:0,item:value}})).collection;
  expect((await collection({collection:inserted,operation:{kind:'set',index:0,item:value}})).collection).toEqual(inserted);
  const wrong=structuredClone(value);wrong.converted.value.items[0].datatype=id(0);
  await expect(page.evaluate(args=>window.workbench.request('intersect/stepCollection',args),{datatype:id(4),collection:inserted,operation:{kind:'set',index:0,item:wrong}})).rejects.toThrow();
  const e=(await featureMap(8,{operation:{kind:'entry',feature,value:inserted}})).value;
  const m=(await featureMap(7,{operation:{kind:'empty'}})).value;
  const full=(await featureMap(7,{value:m,operation:{kind:'insert',index:0,entry:e.value}})).value;
  expect((await featureMap(7,{value:full,operation:{kind:'set',index:0,entry:e.value}})).value).toEqual(full);
  const bad=structuredClone(e.value);bad.value.value.items[0]=wrong;
  await expect(page.evaluate(args=>window.workbench.request('intersect/stepFeatureMap',args),{datatype:id(7),value:full,operation:{kind:'set',index:0,entry:bad}})).rejects.toThrow();
  expect((await featureMap(7,{value:full,operation:{kind:'values',feature}})).result).toEqual([inserted]);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
});


test('direct applied list and map transitions preserve native WASM application identity', async ({ page }) => {
  test.setTimeout(180000);
  const text=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/applied-model.ecore',import.meta.url),'utf8');
  const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:applied-model.ecore',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
  const id=n=>(migratedId([n]));
  const type=(n,args=[])=>({kind:'classifier',declaration:id(n),arguments:args,raw:false});
  const member=n=>({nullable:false,value:{kind:'datatype',declaration:id(n)}});
  const selected=(n,name,args,members)=>({application:type(n,args),conversion:{datatype:id(n),provider:{name,version:'1'},serializable:false,members}});
  const list=selected(2,'ecore.list',[type(0)],[member(0)]), numberList=selected(2,'ecore.list',[type(1)],[member(1)]);
  const nested=selected(2,'ecore.list',[list.application],[{nullable:false,value:{kind:'applied',contract:list}}]);
  const map=selected(3,'ecore.map',[type(0),type(1)],[member(0),member(1)]);
  const contracts=[list,numberList,nested,map];
  const definition=(uri,kind,text)=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[source.id]});
  const grammar=definition('memory:direct.xtext','xtext',`grammar example.Direct import "urn:values" as v
Holder returns v::Holder: 'holder' name=ID;`);
  const semantics=definition('memory:direct-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";');
  const params={compilation:{bundle:{version:1,sources:[source,grammar,semantics],namespaces:[]},ecore:source.id,namespace:'urn:values',xtext:grammar.id,rcore_behavior:semantics.id,materialized_types:[type(4),type(6)]},applied_conversions:contracts};
  const native=request=>nativeOracle(request);
  const compiled=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),params);
  expect(compiled.ok).toBe(true);expect(compiled.package).toEqual(native({method:'compile_bundle',...params}).package);
  await page.evaluate(()=>{window.workbench.modelModels.catalog.setValue('holder a');window.workbench.modelModels.loans.setValue('holder b');});
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  await expect(page.locator('#element-count')).toHaveText('2 elements');
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const step=async(n,operation,collection)=>{
    const args={application:contracts[n].application,operation,...(collection?{collection}:{})};
    const result=await page.evaluate(args=>window.workbench.request('intersect/stepCollection',args),args);
    expect(result).toEqual(native({method:'collection/step',package:compiled.package,...args}));return result;
  };
  const nominal=(n,value)=>({kind:'datatype',datatype:id(n),value});
  const a=nominal(0,'a'),b=nominal(0,'b'),number=nominal(1,42);
  const empty=(await step(0,{kind:'empty'})).collection;
  expect(empty.kind).toBe('converted_application_v1');
  const one=(await step(0,{kind:'insert',index:0,item:a},empty)).collection;
  const two=(await step(0,{kind:'insert',index:1,item:b},one)).collection;
  const moved=await step(0,{kind:'move',new_position:0,old_position:1},two);expect(moved.result.value).toEqual(b);
  expect((await step(0,{kind:'set',index:0,item:a},moved.collection)).result.value).toEqual(b);
  expect((await step(0,{kind:'remove_at',index:0},one)).collection).toEqual(empty);
  expect((await step(0,{kind:'clear'},two)).collection).toEqual(empty);
  const nestedEmpty=(await step(2,{kind:'empty'})).collection;
  const nestedValue=(await step(2,{kind:'insert',index:0,item:one},nestedEmpty)).collection;
  const numeric=(await step(1,{kind:'empty'})).collection;
  const mapEmpty=(await step(3,{kind:'empty'})).collection;
  const mapped=(await step(3,{kind:'put',key:a,item:number},mapEmpty)).collection;
  expect((await step(3,{kind:'get',key:a},mapped)).result.value).toEqual(number);
  expect((await step(3,{kind:'put',key:a,item:number},mapped)).result.value).toEqual(number);
  expect((await step(3,{kind:'remove_key',key:a},mapped)).collection).toEqual(mapEmpty);
  for(const [n,collection,operation] of [[1,one,{kind:'clear'}],[0,one,{kind:'set',index:0,item:number}],[2,nestedValue,{kind:'set',index:0,item:numeric}],[3,mapped,{kind:'put',key:number,item:number}],[0,one,{kind:'remove_at',index:99}]]) {
    await expect(page.evaluate(args=>window.workbench.request('intersect/stepCollection',args),{application:contracts[n].application,collection,operation})).rejects.toThrow();
  }
  await expect(page.evaluate(args=>window.workbench.request('intersect/stepCollection',args),{application:list.application,datatype:id(2),operation:{kind:'empty'}})).rejects.toThrow('not both');
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
});


test('installed constructor policies retain bound-only dependencies across native WASM packages', async ({ page }) => {
  test.setTimeout(180000);
  const text=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/constructor-model.ecore',import.meta.url),'utf8');
  const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:constructor-model',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
  const bundle={version:1,sources:[source],namespaces:[]};
  const id=n=>(migratedId([n]));
  const type=(n,args=[])=>({kind:'classifier',declaration:id(n),arguments:args,raw:false});
  const codec=(n,members)=>({datatype:id(n),provider:{name:'ecore.list',version:'1'},serializable:false,members});
  const alias={application:type(2,[type(0)]),conversion:codec(2,[{nullable:false,value:{kind:'datatype',declaration:id(0)}}])};
  const bounded={application:type(3,[alias.application]),conversion:codec(3,[{nullable:false,value:{kind:'applied',contract:alias}}])};
  const wrapper=codec(4,[{nullable:false,value:{kind:'applied',contract:bounded}}]);
  const native=request=>nativeOracle(request);
  const constructors=[];
  for(const n of [1,2]) {
    const params={bundle,datatype:id(n),provider:{name:'ecore.list.constructor',version:'1'}};
    const result=await page.evaluate(p=>window.workbench.request('intersect/constructorContract',p),params);
    expect(result).toEqual(native({method:'conversion/constructor',...params}));
    expect(result.model_published).toBe(false); constructors.push(result.contract);
  }
  const aliasValue={kind:'converted_application_v1',application:alias.application,converted:{kind:'converted',datatype:id(2),provider:alias.conversion.provider,value:{items:[{kind:'datatype',datatype:id(0),value:'a'}]}}};
  const value={kind:'converted_application_v1',application:bounded.application,converted:{kind:'converted',datatype:id(3),provider:bounded.conversion.provider,value:{items:[aliasValue]}}};
  const definition=(uri,kind,text)=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[source.id]});
  for(const wrapped of [false,true]) {
    const name=wrapped?'OnlyWrapped':'Holder', field=wrapped?'wrapped':'values';
    const grammar=definition('memory:constructor.xtext','xtext',`grammar example.Constructors import "urn:constructors" as c
${name} returns c::${name}: 'holder' name=ID;`);
    const rcore_behavior=definition('memory:constructor-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";');
    const compilation={bundle:{...bundle,sources:[source,grammar,rcore_behavior]},ecore:source.id,namespace:'urn:constructors',xtext:grammar.id,rcore_behavior:rcore_behavior.id,materialized_types:[type(wrapped?6:5)]};
    const selected={conversions:wrapped?[wrapper]:[],applied_conversions:wrapped?[]:[bounded],constructors};
    const currentValue=wrapped?{kind:'converted',datatype:id(4),provider:wrapper.provider,value:{items:[value]}}:value;
    const materialize={...selected,bundle:compilation.bundle,types:compilation.materialized_types,instances:[{id:'h',type:compilation.materialized_types[0]}],edits:[['h',field,currentValue]]};
    const modeled=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),materialize);
    expect(modeled).toEqual(native({method:'ecore/materialize',...materialize})); expect(modeled.ok).toBe(true);
    expect(modeled.schema.constructor_contracts).toHaveLength(2);
    expect(modeled.model.elements[0].values[field]).toEqual(currentValue);
    const wrong=structuredClone(currentValue), nested=wrapped?wrong.value.items[0]:wrong;
    nested.converted.value.items[0].application.declaration=id(1);
    nested.converted.value.items[0].converted.datatype=id(1);
    const invalid={...materialize,edits:[['h',field,wrong]]};
    const rejected=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),invalid);
    expect(rejected).toEqual(native({method:'ecore/materialize',...invalid})); expect(rejected.ok).toBe(false);
    const request={compilation,...selected};
    const compiled=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),request);
    const nativeCompiled=native({method:'compile_bundle',...request});
    expect(compiled.ok).toBe(true); expect(compiled.package).toEqual(nativeCompiled.package);
    if(wrapped) expect(compiled.package.schema.applied_conversion_contracts).toBeUndefined();
    expect(native({method:'compile_bundle',...request,constructors:[...constructors].reverse()}).package).toEqual(compiled.package);
    if(!wrapped) {
      const bind={bundle:compilation.bundle,conversions:[bounded],constructors,operation:{kind:'bind',application:bounded.application,payload:value.converted.value}};
      const bound=await page.evaluate(p=>window.workbench.request('intersect/appliedConversion',p),bind);
      expect(bound).toEqual(native({method:'conversion/applied',...bind})); expect(bound.value).toEqual(value);
      const params={application:bounded.application,operation:{kind:'empty'}};
      const empty=await page.evaluate(p=>window.workbench.request('intersect/stepCollection',p),params);
      expect(empty).toEqual(native({method:'collection/step',package:compiled.package,...params}));
      const insert={application:bounded.application,collection:empty.collection,operation:{kind:'insert',index:0,item:aliasValue}};
      const inserted=await page.evaluate(p=>window.workbench.request('intersect/stepCollection',p),insert);
      expect(inserted).toEqual(native({method:'collection/step',package:compiled.package,...insert}));
      expect(inserted.collection).toEqual(value);
    }
    const sources=await page.evaluate(()=>{
      window.workbench.modelModels.catalog.setValue('holder one'); window.workbench.modelModels.loans.setValue('holder two');
      return Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}));
    });
    await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
    await expect(page.locator('#element-count')).toHaveText('2 elements');
    const active=await page.evaluate(()=>window.workbench.inspect());
    expect(active.evaluation).toEqual(native({method:'evaluate',package:compiled.package,sources}));
    const stale=structuredClone(constructors); stale[0].provider.version='2';
    const forged=structuredClone(constructors); forged[0].datatype.name='Forged';
    for(const policies of [[],constructors.slice(0,1),stale,forged]) {
      const failed=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),{...request,constructors:policies});
      expect(failed.ok).toBe(false);
      expect(native({method:'compile_bundle',...request,constructors:policies}).ok).toBe(false);
      const after=await page.evaluate(()=>window.workbench.inspect());
      expect(after.revision).toBe(active.revision); expect(after.evaluation).toEqual(active.evaluation);
    }
  }
});


test('installed collection constructor direction preserves arguments and native WASM model values', async ({ page }) => {
  test.setTimeout(180000);
  const original=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/constructor-model.ecore',import.meta.url),'utf8');
  const domains=[['ecore.list','org.eclipse.emf.common.util.EList'],['java.list','java.util.List'],['java.collection','java.util.Collection']];
  const native=request=>nativeOracle(request);
  const initial=await page.evaluate(()=>window.workbench.inspect());
  for(let b=0;b<domains.length;b++) for(let a=0;a<domains.length;a++) {
    const text=original.replace('name="List" instanceClassName="org.eclipse.emf.common.util.EList"',`name="List" instanceClassName="${domains[b][1]}"`).replace('name="Alias" instanceClassName="org.eclipse.emf.common.util.EList"',`name="Alias" instanceClassName="${domains[a][1]}"`);
    const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:constructor-model',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
    const bundle={version:1,sources:[source],namespaces:[]};
    const id=n=>(migratedId([n]));
    const type=(n,args=[])=>({kind:'classifier',declaration:id(n),arguments:args,raw:false});
    const codec=(n,name,members)=>({datatype:id(n),provider:{name,version:'1'},serializable:false,members});
    const alias={application:type(2,[type(0)]),conversion:codec(2,domains[a][0],[{nullable:false,value:{kind:'datatype',declaration:id(0)}}])};
    const bounded={application:type(3,[alias.application]),conversion:codec(3,'ecore.list',[{nullable:false,value:{kind:'applied',contract:alias}}])};
    const constructors=[];
    for(const [n,provider] of [[1,domains[b][0]],[2,domains[a][0]]]) {
      const params={bundle,datatype:id(n),provider:{name:provider+'.constructor',version:'1'}};
      const result=await page.evaluate(p=>window.workbench.request('intersect/constructorContract',p),params);
      expect(result).toEqual(native({method:'conversion/constructor',...params})); constructors.push(result.contract);
    }
    const aliasValue={kind:'converted_application_v1',application:alias.application,converted:{kind:'converted',datatype:id(2),provider:alias.conversion.provider,value:{items:[{kind:'datatype',datatype:id(0),value:'a'}]}}};
    const value={kind:'converted_application_v1',application:bounded.application,converted:{kind:'converted',datatype:id(3),provider:bounded.conversion.provider,value:{items:[aliasValue]}}};
    const bind={bundle,conversions:[bounded],constructors,operation:{kind:'bind',application:bounded.application,payload:value.converted.value}};
    const result=await page.evaluate(p=>window.workbench.request('intersect/appliedConversion',p),bind);
    expect(result).toEqual(native({method:'conversion/applied',...bind})); expect(result.ok).toBe(a<=b);
    if(a>b) continue;
    expect(result.value).toEqual(value);
    const params={bundle,types:[type(5)],applied_conversions:[bounded],constructors,instances:[{id:'h',type:type(5)}],edits:[['h','values',value]]};
    const modeled=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),params);
    expect(modeled).toEqual(native({method:'ecore/materialize',...params})); expect(modeled.ok).toBe(true);
    expect(modeled.model.elements[0].values.values).toEqual(value);
    const mismatch=structuredClone(bind);
    mismatch.conversions[0].application.arguments[0].arguments[0].declaration=id(7);
    mismatch.conversions[0].conversion.members[0].value.contract.application.arguments[0].declaration=id(7);
    mismatch.conversions[0].conversion.members[0].value.contract.conversion.members[0].value.declaration=id(7);
    mismatch.operation.application=mismatch.conversions[0].application;
    const rejected=await page.evaluate(p=>window.workbench.request('intersect/appliedConversion',p),mismatch);
    expect(rejected).toEqual(native({method:'conversion/applied',...mismatch})); expect(rejected.ok).toBe(false);
    expect(rejected.diagnostics[0].message).toContain('violates generic bounds');
  }
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
});


test('map constructor aliases preserve argument order values operations and package replay', async ({ page }) => {
  test.setTimeout(180000);
  const text=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/constructor-map.ecore',import.meta.url),'utf8');
  const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:constructor-map',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
  const bundle={version:1,sources:[source],namespaces:[]};
  const id=n=>(migratedId([n]));
  const type=(n,args=[])=>({kind:'classifier',declaration:id(n),arguments:args,raw:false});
  const codec=(n,name,members)=>({datatype:id(n),provider:{name,version:'1'},serializable:false,members});
  const scalar=n=>({nullable:false,value:{kind:'datatype',declaration:id(n)}});
  const alias={application:type(3,[type(0),type(1)]),conversion:codec(3,'ecore.map',[scalar(0),scalar(1)])};
  const bounded={application:type(4,[alias.application]),conversion:codec(4,'ecore.list',[{nullable:false,value:{kind:'applied',contract:alias}}])};
  const wrapper=codec(6,'ecore.list',[{nullable:false,value:{kind:'applied',contract:bounded}}]);
  const native=request=>nativeOracle(request);
  const constructors=[];
  for(const n of [2,3]) {
    const params={bundle,datatype:id(n),provider:{name:'ecore.map.constructor',version:'1'}};
    const result=await page.evaluate(p=>window.workbench.request('intersect/constructorContract',p),params);
    expect(result).toEqual(native({method:'conversion/constructor',...params})); constructors.push(result.contract);
  }
  const key={kind:'datatype',datatype:id(0),value:'key'}, item={kind:'datatype',datatype:id(1),value:7};
  const map={kind:'converted_application_v1',application:alias.application,converted:{kind:'converted',datatype:id(3),provider:alias.conversion.provider,value:{entries:[{key,value:item}]}}};
  const value={kind:'converted_application_v1',application:bounded.application,converted:{kind:'converted',datatype:id(4),provider:bounded.conversion.provider,value:{items:[map]}}};
  const definition=(uri,kind,text)=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[source.id]});
  for(const wrapped of [false,true]) {
    const name=wrapped?'OnlyWrapped':'Holder', field=wrapped?'wrapped':'values';
    const grammar=definition('memory:constructor-map.xtext','xtext',`grammar example.Maps import "urn:constructor-maps" as m
${name} returns m::${name}: 'holder' name=ID;`);
    const rcore_behavior=definition('memory:constructor-map-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";');
    const compilation={bundle:{...bundle,sources:[source,grammar,rcore_behavior]},ecore:source.id,namespace:'urn:constructor-maps',xtext:grammar.id,rcore_behavior:rcore_behavior.id,materialized_types:[type(wrapped?7:5)]};
    const selected={conversions:wrapped?[wrapper]:[],applied_conversions:wrapped?[]:[alias,bounded],constructors};
    const currentValue=wrapped?{kind:'converted',datatype:id(6),provider:wrapper.provider,value:{items:[value]}}:value;
    const params={...selected,bundle:compilation.bundle,types:compilation.materialized_types,instances:[{id:'h',type:compilation.materialized_types[0]}],edits:[['h',field,currentValue]]};
    const modeled=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),params);
    expect(modeled).toEqual(native({method:'ecore/materialize',...params})); expect(modeled.ok).toBe(true);
    expect(modeled.model.elements[0].values[field]).toEqual(currentValue);
    expect(modeled.schema.constructor_contracts).toHaveLength(2);
    if(wrapped) expect(modeled.schema.applied_conversion_contracts).toBeUndefined();
    const request={compilation,...selected};
    const compiled=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),request);
    expect(compiled.ok).toBe(true); expect(compiled.package).toEqual(native({method:'compile_bundle',...request}).package);
    if(!wrapped) {
      const operation=async args=>{
        const result=await page.evaluate(p=>window.workbench.request('intersect/stepCollection',p),args);
        expect(result).toEqual(native({method:'collection/step',package:compiled.package,...args})); return result;
      };
      const empty=await operation({application:alias.application,operation:{kind:'empty'}});
      const put=await operation({application:alias.application,collection:empty.collection,operation:{kind:'put',key,item}});
      expect(put.collection).toEqual(map);
      expect((await operation({application:alias.application,collection:map,operation:{kind:'get',key}})).result.value).toEqual(item);
      expect((await operation({application:alias.application,collection:map,operation:{kind:'remove_key',key}})).collection).toEqual(empty.collection);
      const duplicate={bundle:compilation.bundle,conversions:[alias,bounded],constructors,operation:{kind:'bind',application:alias.application,payload:{entries:[{key,value:item},{key,value:item}]}}};
      const rejected=await page.evaluate(p=>window.workbench.request('intersect/appliedConversion',p),duplicate);
      expect(rejected).toEqual(native({method:'conversion/applied',...duplicate})); expect(rejected.ok).toBe(false);
      const swapped=structuredClone(request);
      swapped.applied_conversions[0].application.arguments.reverse(); swapped.applied_conversions[0].conversion.members.reverse();
      swapped.applied_conversions[1].application.arguments[0]=swapped.applied_conversions[0].application;
      swapped.applied_conversions[1].conversion.members[0].value.contract=swapped.applied_conversions[0];
      expect((await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),swapped)).ok).toBe(false);
      expect(native({method:'compile_bundle',...swapped}).ok).toBe(false);
    }
    const sources=await page.evaluate(()=>{
      window.workbench.modelModels.catalog.setValue('holder one'); window.workbench.modelModels.loans.setValue('holder two');
      return Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}));
    });
    await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
    await expect(page.locator('#element-count')).toHaveText('2 elements');
    const active=await page.evaluate(()=>window.workbench.inspect());
    expect(active.evaluation).toEqual(native({method:'evaluate',package:compiled.package,sources}));
    const missing=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),{...request,constructors:constructors.slice(0,1)});
    expect(missing.ok).toBe(false);
    const after=await page.evaluate(()=>window.workbench.inspect());
    expect(after.revision).toBe(active.revision); expect(after.evaluation).toEqual(active.evaluation);
  }
});


test('method-only provider dependencies replay across native and WASM without schema pollution', async ({ page }) => {
  test.setTimeout(120000);
  const text=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/method-provider-bounds.ecore',import.meta.url),'utf8');
  const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:method-providers',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
  const bundle={version:1,sources:[source],namespaces:[]};
  const id=(...path)=>(migratedId(path));
  const type=(n,args=[])=>({kind:'classifier',declaration:id(n),arguments:args,raw:false});
  const native=request=>nativeOracle(request);
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const constructors=[];
  for(const n of [2,3]) {
    const params={bundle,datatype:id(n),provider:{name:'ecore.list.constructor',version:'1'}};
    const result=await page.evaluate(p=>window.workbench.request('intersect/constructorContract',p),params);
    expect(result).toEqual(native({method:'conversion/constructor',...params})); constructors.push(result.contract);
  }
  const conversions=[5,6].map(n=>({datatype:id(n),provider:{name:'example.rgb',version:'1'},serializable:true}));
  const request={bundle,types:[type(7)],conversions,constructors,operation_applications:[
    {receiver:type(7),operation:id(7,1),arguments:[type(3,[type(0)])]},
    {receiver:type(7),operation:id(7,2),arguments:[type(6)]}
  ],instances:[{id:'o',type:type(7)}],edits:[['o','name','checked']]};
  const check=async params=>{
    const result=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),params);
    expect(result).toEqual(native({...params,method:'ecore/materialize'})); return result;
  };
  const result=await check(request);
  expect(result.ok).toBe(true); expect(result.model.elements[0].values.name).toBe('checked');
  expect(result.schema.constructor_contracts).toBeUndefined(); expect(result.schema.conversion_contracts).toBeUndefined();
  expect(result.operation_dependencies.constructors).toHaveLength(2); expect(result.operation_dependencies.conversions).toHaveLength(2);
  expect(result.operation_applications.every(a=>a.executable===false)).toBe(true);
  const replay=JSON.parse(JSON.stringify(result.operation_replay));
  const replayed=await check(replay);
  for(const field of ['schema','operation_applications','operation_dependencies','operation_replay']) expect(replayed[field]).toEqual(result[field]);
  expect(await check({...request,constructors:[...constructors].reverse(),conversions:[...conversions].reverse()})).toEqual(result);
  for(const field of ['constructors','conversions']) expect((await check({...replay,[field]:[]})).ok).toBe(false);
  const bad=structuredClone(replay); bad.operation_applications[0].arguments[0].arguments[0]=type(1);
  expect((await check(bad)).ok).toBe(false);
  const stale=structuredClone(replay); stale.operation_applications[0].operation.source.sha256='0'.repeat(64);
  expect((await check(stale)).ok).toBe(false);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
});


test('explicit generic method owner selection preserves raw and applied projections', async ({ page }) => {
  test.setTimeout(120000);
  const text=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/multiple-method-owners.ecore',import.meta.url),'utf8');
  const source={id:{uri:'memory:method-owners',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]};
  const bundle={version:1,sources:[source],namespaces:[]};
  const id=(...path)=>({source:source.id,path});
  const type=(n,args=[],raw=false)=>({kind:'classifier',declaration:id(n),arguments:args,raw});
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const request={bundle,receiver:type(5),operation:id(1,2),arguments:[type(0)]};
  const check=async params=>{
    const result=await page.evaluate(p=>window.workbench.request('intersect/instantiateGenericOperation',p),params);
    const native=nativeOracle({method:'ecore/generic-operation-types',...params});
    expect(result).toEqual(native); return result;
  };
  expect((await check(request)).ok).toBe(false);
  for(const owner of [type(1,[],true),type(1,[type(0)])]) {
    const result=await check({...request,owner});
    expect(result.ok).toBe(true); expect(result.executable).toBe(false);
    expect(result.report.operation.owner).toEqual(owner);
    const input=result.report.operation.signatures.find(s=>JSON.stringify(s.owner.path)==='[1,2,2]');
    expect(input.specialized).toEqual([owner.raw?{kind:'parameter',declaration:id(1,0)}:type(0)]);
    for(const args of [[],[type(0),type(0)],[type(3)]]) expect((await check({...request,owner,arguments:args})).ok).toBe(false);
  }
  for(const owner of [type(0),type(1,[type(3)]),{...type(1,[],true),declaration:{source:{...source.id,sha256:'0'.repeat(64)},path:[1]}}]) expect((await check({...request,owner})).ok).toBe(false);
  expect((await check({...request,receiver:type(7)})).ok).toBe(true);
  expect((await check({...request,owner:type(1,[type(0)]),operation:id(1,1)})).ok).toBe(false);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
});


test('raw runtime models preserve identities intersection bounds transactions and package replay', async ({ page }) => {
  test.setTimeout(180000);
  const text=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/raw-runtime.ecore',import.meta.url),'utf8');
  const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:raw',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
  const bundle={version:1,sources:[source],namespaces:[]};
  const type=(n,args=[],raw=false)=>({kind:'classifier',declaration:migratedId([n]),arguments:args,raw});
  const native=request=>nativeOracle(request);
  const types=[type(0),type(1),type(2),type(3,[],true),type(3,[type(1)]),type(4),type(5,[],true),type(6),type(7,[],true),type(8,[],true)];
  const ids=['v','c','o','r','a','h','d','b','i','n'];
  const params={bundle,types,instances:types.map((type,index)=>({id:ids[index],type})),edits:[['r','value','v'],['a','value','c'],['d','value','v'],['i','value','b'],['n','value','c'],['h','rawBox','a'],['h','childBox','a']]};
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const check=async p=>{const result=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),p);expect(result).toEqual(native({method:'ecore/materialize',...p}));return result;};
  const result=await check(params);expect(result.ok).toBe(true);expect(result.profile).toBe('explicit_runtime_set');
  expect(result.schema.runtime_warnings.some(w=>w.code==='raw_type')).toBe(true);
  const raw=result.model.elements.find(e=>e.id==='r'),applied=result.model.elements.find(e=>e.id==='a');expect(raw.class).not.toBe(applied.class);
  expect(result.schema.instantiations[raw.class].raw).toBe(true);expect(result.schema.instantiations[applied.class].arguments).toEqual([type(1)]);
  const intersection=result.model.elements.find(e=>e.id==='i');expect(result.schema.raw_reference_bounds[intersection.class].value).toHaveLength(2);
  for(const edit of [['r','value','o'],['a','value','v'],['i','value','v'],['i','value','o'],['n','value','v'],['h','childBox','r']]) expect((await check({...params,edits:[...params.edits,edit]})).ok).toBe(false);
  expect(await check(JSON.parse(JSON.stringify(params)))).toEqual(result);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
  const definition=(uri,kind,text)=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies:[source.id]});
  const grammar=definition('memory:raw.xtext','xtext',`grammar example.Raw import "urn:raw" as r Root returns r::Derived: 'raw';`);
  const rcore_behavior=definition('memory:raw-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";');
  const compilation={bundle:{...bundle,sources:[source,grammar,rcore_behavior]},ecore:source.id,namespace:'urn:raw',xtext:grammar.id,rcore_behavior:rcore_behavior.id,materialized_types:[type(5,[],true),type(0)]};
  const compiled=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),{compilation});expect(compiled.ok).toBe(true);expect(compiled.package).toEqual(native({method:'compile_bundle',compilation}).package);
  const sources=await page.evaluate(()=>{for(const model of Object.values(window.workbench.modelModels))model.setValue('raw');return Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}));});
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');await expect(page.locator('#element-count')).toHaveText('2 elements');
  const active=await page.evaluate(()=>window.workbench.inspect());expect(active.evaluation).toEqual(native({method:'evaluate',package:compiled.package,sources}));
  const invalid=structuredClone(compilation);invalid.materialized_types[0].raw=false;
  expect((await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),{compilation:invalid})).ok).toBe(false);
  const after=await page.evaluate(()=>window.workbench.inspect());expect(after.revision).toBe(active.revision);expect(after.evaluation).toEqual(active.evaluation);
});


test('unbounded raw reference domain preserves exact identities across native and WASM', async ({ page }) => {
  test.setTimeout(180000);
  const text=readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/raw-unbounded.ecore',import.meta.url),'utf8');
  const {source, id:migratedId} = migratedSourceFixture({id:{uri:'memory:raw-top',sha256:createHash('sha256').update(text).digest('hex')},kind:'ecore',text,dependencies:[]});
  const bundle={version:1,sources:[source],namespaces:[]};
  const type=(n,args=[],raw=false)=>({kind:'classifier',declaration:migratedId([n]),arguments:args,raw});
  const types=[type(0),type(1),type(2,[],true),type(2,[type(0)]),type(3),type(4)], ids=['v','o','r','a','e','h'];
  const request={bundle,types,instances:types.map((type,i)=>({id:ids[i],type}))};
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const check=async p=>{
    const result=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),p);
    const native=nativeOracle({method:'ecore/materialize',...p});
    expect(result).toEqual(native);return result;
  };
  const base=await check(request);expect(base.ok).toBe(true);
  expect(base.schema.reference_top.source.uri).not.toBe(source.id.uri);
  expect(base.schema.classes.__ecore_eobject_reference_top).toBeUndefined();
  for(const target of ids) expect((await check({...request,edits:[['r','value',target],['h','top',target],['h','local','e'],['a','value','v']]})).ok).toBe(true);
  for(const edit of [['r','value','missing'],['r','value',12],['h','local','v'],['a','value','o']]) expect((await check({...request,edits:[['v','name','rollback'],edit]})).ok).toBe(false);
  expect(await check(JSON.parse(JSON.stringify(request)))).toEqual(base);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
  const definition=sourceFixture;
  const linked=definition('memory:raw-linking','ecore',text.replace('<eClassifiers x:type="e:EClass" name="Holder">','<eClassifiers x:type="e:EClass" name="Holder"><eStructuralFeatures x:type="e:EReference" name="values" eType="#//Value" upperBound="-1" containment="true"/><eStructuralFeatures x:type="e:EReference" name="boxes" eType="#//Box" upperBound="-1" containment="true"/>'));
  const grammar=definition('memory:raw-linking.xtext','xtext',`grammar example.Linking import "urn:raw-unbounded" as u Root returns u::Holder: values+=Value* boxes+=Box*; Value returns u::Value: 'value' name=ID; Box returns u::Box: 'box' value=[u::Value|ID];`,[linked.id]);
  const semantics=definition('memory:raw-linking-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";',[linked.id]);
  const compilation={bundle:{version:1,sources:[linked,grammar,semantics],namespaces:[]},ecore:linked.id,namespace:'urn:raw-unbounded',xtext:grammar.id,rcore_behavior:semantics.id,materialized_types:[[0,false],[2,true],[3,false],[4,false]].map(([n,raw])=>({kind:'classifier',declaration:fixtureDeclaration(linked,[n]),arguments:[],raw}))};
  const native=p=>nativeOracle(p);
  const compiled=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),{compilation});expect(compiled.ok).toBe(true);expect(compiled.package).toEqual(native({method:'compile_bundle',compilation}).package);
  const sources=await page.evaluate(()=>{window.workbench.modelModels.catalog.setValue('value V box V');window.workbench.modelModels.loans.setValue('value W box W');return Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}));});
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');await expect(page.locator('#element-count')).toHaveText('6 elements');
  const active=await page.evaluate(()=>window.workbench.inspect());expect(active.evaluation).toEqual(native({method:'evaluate',package:compiled.package,sources}));

});

test('serializable generic values consume defaults text and package replay in native and WASM', async ({ page }) => {
  test.setTimeout(180000);
  const definition=sourceFixture;
  const source=definition('memory:sequence.ecore','ecore',readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/serializable-sequence.ecore',import.meta.url),'utf8'));
  const id=n=>(fixtureDeclaration(source, [n]));const type=(n,args=[])=>({kind:'classifier',declaration:id(n),arguments:args,raw:false});
  const contract=(argument,value)=>({application:type(2,[argument]),conversion:{datatype:id(2),provider:{name:'intersect.sequence',version:'1'},serializable:true,declarations:[],members:[{nullable:false,value}]}});
  const texts=contract(type(0),{kind:'datatype',declaration:id(0)}), numbers=contract(type(1),{kind:'datatype',declaration:id(1)});
  const nested=contract(texts.application,{kind:'applied',contract:texts});
  const grammar=definition('memory:sequence.xtext','xtext',`grammar example.Sequence import "urn:lexical" as l Holder returns l::Holder: 'holder' name=ID ('texts' texts=STRING)? ('numbers' numbers=STRING)? ('nested' nested=STRING)? ('many' many+=STRING)* ('wide' wide=INT)? ('word' word=ID)?;`,[source.id]);
  const semantics=definition('memory:sequence-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";',[source.id]);
  const compilation={bundle:{version:1,sources:[source,grammar,semantics],namespaces:[]},ecore:source.id,namespace:'urn:lexical',xtext:grammar.id,rcore_behavior:semantics.id,materialized_types:[type(3)]};
  const request={compilation,applied_conversions:[texts,numbers,nested]};
  const native=p=>nativeOracle(p);
  const compiled=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),request);
  expect(compiled.ok).toBe(true);expect(compiled.package).toEqual(native({method:'compile_bundle',...request}).package);
  const quote=JSON.stringify;
  const text=`holder Demo texts ${quote('["hello"]')} numbers ${quote('["2147483648"]')} nested ${quote(quote(['["inside"]']))} many ${quote('["one"]')} many ${quote('["two"]')} wide 0002147483648 word Label`;
  const sources=await page.evaluate(text=>{window.workbench.modelModels.catalog.setValue(text);window.workbench.modelModels.loans.setValue('holder Defaults');return Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}));},text);
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');await expect(page.locator('#element-count')).toHaveText('2 elements');
  const active=await page.evaluate(()=>window.workbench.inspect());
  expect(active.evaluation).toEqual(native({method:'evaluate',package:JSON.parse(JSON.stringify(compiled.package)),sources}));
  const populated=active.evaluation.model.elements.find(e=>e.values.name==='Demo');expect(populated.values.many).toHaveLength(2);expect(populated.values.wide.value.value).toBe('2147483648');
  const stale=structuredClone(request);stale.applied_conversions[0].conversion.provider.version='stale';
  expect((await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),stale)).ok).toBe(false);
  const after=await page.evaluate(()=>window.workbench.inspect());expect(after.revision).toBe(active.revision);expect(after.evaluation).toEqual(active.evaluation);
  const bad=`holder Bad numbers ${quote('["not a number"]')}`;
  const badSources=await page.evaluate(text=>{window.workbench.modelModels.catalog.setValue(text);return Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}));},bad);
  await expect(page.locator('#diagnostic-list')).toContainText('Invalid Sequence literal');
  const failed=await page.evaluate(()=>window.workbench.inspect());expect(failed.evaluation).toEqual(native({method:'evaluate',package:compiled.package,sources:badSources}));
});

test('Rcore generic model handoff preserves application evidence and provider context in WASM', async ({ page }) => {
  test.setTimeout(180000);
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const definition=sourceFixture;
  const check=async p=>{
    const native=nativeOracle({method:'rcore_behavior/check',...p});
    const result=await page.evaluate(p=>window.workbench.request('intersect/checkRcore',p),p);expect(result).toEqual(native);expect(result.executable).toBe(false);return result;
  };
  const model=definition('memory:handoff.ecore','ecore',readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/rcore-behavior-handoff.ecore',import.meta.url),'utf8'));
  for(const [body,ok] of [[`fn read(x: m.Box<m.Leaf>) -> m.Leaf = x.value; fn nested(x: m.Box<m.Box<m.Leaf>>) -> m.Box<m.Leaf> = x.value; fn raw(x: m.Open) -> Bool = x.value == x.value;`,true],[`fn wrong(x: m.Box<m.Leaf>) -> m.Box<m.Base> = x;`,false]]) {
    const source=definition('memory:handoff-behavior.rcore','rcore_behavior',`rcore 1; package handoff version "1"; import model "urn:rcore-behavior-handoff" as m; ${body}`,[model.id]);
    const result=await check({bundle:{version:1,sources:[model,source],namespaces:[]},entry:source.id});expect(result.ok).toBe(ok);
    if(ok) expect(result.typed.generic_models.some(report=>report.warnings.some(w=>w.code==='raw_type'))).toBe(true);
  }
  const provider=definition('memory:provider-handoff','ecore',readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/rcore-behavior-provider-handoff.ecore',import.meta.url),'utf8'));
  const source=definition('memory:provider-handoff-behavior.rcore','rcore_behavior',`rcore 1; package handoff version "1"; import model "urn:rcore-behavior-provider-handoff" as m; fn read(x: m.Box<m.Alias>) -> m.Alias = x.value;`,[provider.id]);
  const contracts=[0,1].map(n=>({datatype:fixtureDeclaration(provider,[n]),provider:{name:'example.rgb',version:'1'},serializable:true,declarations:[],members:[]}));
  const p={bundle:{version:1,sources:[provider,source],namespaces:[]},entry:source.id,conversions:contracts,constructors:[],applied_conversions:[]};
  expect((await check(p)).ok).toBe(true);expect((await check({...p,conversions:[]})).ok).toBe(false);
  const constructorModel=definition('memory:constructor-handoff','ecore',readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/constructor-model.ecore',import.meta.url),'utf8'));
  const cid=n=>(fixtureDeclaration(constructorModel,[n]));const ct=(n,args=[])=>({kind:'classifier',declaration:cid(n),arguments:args,raw:false});
  const applied=(n,arg,value)=>({application:ct(n,[arg]),conversion:{datatype:cid(n),provider:{name:'ecore.list',version:'1'},serializable:false,declarations:[],members:[{nullable:false,value}]}});
  const alias=applied(2,ct(0),{kind:'datatype',declaration:cid(0)}), bounded=applied(3,alias.application,{kind:'applied',contract:alias});
  const modelBundle={version:1,sources:[constructorModel],namespaces:[]}, constructors=[];
  for(const n of [1,2]) constructors.push((await page.evaluate(p=>window.workbench.request('intersect/constructorContract',p),{bundle:modelBundle,datatype:cid(n),provider:{name:'ecore.list.constructor',version:'1'}})).contract);
  const constructorSource=body=>definition('memory:constructor-handoff-behavior.rcore','rcore_behavior',`rcore 1; package handoff version "1"; import model "urn:constructors" as m; ${body}`,[constructorModel.id]);
  const identity=constructorSource('fn identity(x: m.Holder) -> m.Holder = x; fn name(x: m.Holder) -> String? = x.name;');
  const context={bundle:{...modelBundle,sources:[constructorModel,identity]},entry:identity.id,applied_conversions:[alias,bounded],constructors};
  expect((await check(context)).ok).toBe(true);expect((await check({...context,applied_conversions:[]})).ok).toBe(false);
  const read=constructorSource('fn inspect(x: m.Holder) -> m.Bounded<m.Alias<m.Text>>? = x.values;');
  const appliedRead=await check({...context,bundle:{...modelBundle,sources:[constructorModel,read]},entry:read.id});
  expect(appliedRead.ok).toBe(true);expect(appliedRead.typed.generic_datatypes.length).toBeGreaterThan(0);
  const wrong=constructorSource('fn inspect(x: m.Holder) -> m.Alias<m.Text>? = x.values;');
  expect((await check({...context,bundle:{...modelBundle,sources:[constructorModel,wrong]},entry:wrong.id})).ok).toBe(false);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
});


test('generic effective features preserve enum defaults diamonds and model edits in WASM', async ({ page }) => {
  test.setTimeout(180000);
  const definition=sourceFixture;
  const source=definition('memory:generic-feature-matrix.ecore','ecore',readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/effective-feature-matrix.ecore',import.meta.url),'utf8'));
  const bundle={version:1,sources:[source],namespaces:[]};
  const type=(n,args=[])=>({kind:'classifier',declaration:fixtureDeclaration(source, [n]),arguments:args,raw:false});
  const native=p=>nativeOracle(p);
  const check=async p=>{const result=await page.evaluate(p=>window.workbench.request('intersect/materializeGenericTypes',p),p);expect(result).toEqual(native({method:'ecore/materialize',...p}));return result;};
  const initial=await page.evaluate(()=>window.workbench.inspect());
  const request={bundle,types:[type(5),type(6)],instances:[{id:'d',type:type(5)},{id:'o',type:type(6)}]};
  const built=await check(request);expect(built.ok).toBe(true);
  const diamond=built.model.elements.find(e=>e.id==='d'), other=built.model.elements.find(e=>e.id==='o');
  const primary=diamond.values.first, alias=diamond.values.selected;expect(primary).not.toEqual(alias);expect(alias).not.toEqual(other.values.selected);
  const changed=await check({...request,edits:[['d','choices',[primary,alias]],['d','history',[alias,primary,alias]]]});expect(changed.ok).toBe(true);
  expect(changed.model.elements.find(e=>e.id==='d').values.history).toEqual([alias,primary,alias]);
  for(const edit of [['d','selected',other.values.selected],['d','first',null],['d','selected',7],['d','choices',[alias,alias]],['d','choices',[primary,alias,primary]]]) expect((await check({...request,edits:[['d','name','rollback'],edit]})).ok).toBe(false);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(initial);
  const grammar=definition('memory:generic-feature-matrix.xtext','xtext',`grammar example.Features import "urn:generic-features" as m Diamond returns m::Diamond: 'record' name=ID;`,[source.id]);
  const semantics=definition('memory:generic-feature-matrix-behavior.rcore','rcore_behavior','rcore 1; package emptyRules version "1";',[source.id]);
  const compilation={bundle:{...bundle,sources:[source,grammar,semantics]},ecore:source.id,namespace:'urn:generic-features',xtext:grammar.id,rcore_behavior:semantics.id,materialized_types:[type(5)]};
  const compiled=await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),{compilation});expect(compiled.ok).toBe(true);expect(compiled.package).toEqual(native({method:'compile_bundle',compilation}).package);
  const sources=await page.evaluate(()=>{window.workbench.modelModels.catalog.setValue('record one');window.workbench.modelModels.loans.setValue('record two');return Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}));});
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');await expect(page.locator('#element-count')).toHaveText('2 elements');
  const active=await page.evaluate(()=>window.workbench.inspect());expect(active.evaluation).toEqual(native({method:'evaluate',package:compiled.package,sources}));
  expect(active.evaluation.model.elements.every(e=>JSON.stringify(e.values.selected)===JSON.stringify(alias))).toBe(true);
  const invalid={...compilation,materialized_types:[type(2)]};
  expect((await page.evaluate(p=>window.workbench.request('intersect/compileBundle',p),{compilation:invalid})).ok).toBe(false);
  const after=await page.evaluate(()=>window.workbench.inspect());expect(after.revision).toBe(active.revision);expect(after.evaluation).toEqual(active.evaluation);
});


test('self-opposite declarations reject without replacing the active model', async ({page}) => {
  const before = await page.evaluate(() => window.workbench.inspect());
  await page.evaluate(() => {
    const definition = window.workbench.definitionModels.rcore;
    const field = 'ref peer: BookCopy [0,1] opposite BookCopy.peer;';
    definition.setValue(definition.getValue().replace('attr available:', field+'\nattr available:'));
  });
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toHaveText('Definition compilation failed');
  await expect(page.locator('#diagnostic-list')).toContainText('own opposite');
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after.revision).toBe(before.revision);
  expect(after.package).toEqual(before.package);
  expect(after.evaluation.model).toEqual(before.evaluation.model);
});


for (const [label, feature, attribute, diagnostic] of [
  ['nonunique containment', 'copies', 'nonunique', 'must be unique'],
  ['many-valued container', 'library', '[0,*]', 'upper bound 1'],
]) {
  test(`${label} rejects without replacing the active language`, async ({page}) => {
    const before = await page.evaluate(() => window.workbench.inspect());
    await page.evaluate(({feature, attribute}) => {
      const definition = window.workbench.definitionModels.rcore;
      const text = definition.getValue();
      definition.setValue(feature === 'copies'
        ? text.replace('ref copies: BookCopy [0,*]', 'ref copies: BookCopy [0,*] '+attribute)
        : text.replace('ref library: Library [0,1]', 'ref library: Library '+attribute));
    }, {feature, attribute});
    await page.locator('#compile').click();
    await expect(page.locator('#compile-status')).toHaveText('Definition compilation failed');
    await expect(page.locator('#diagnostic-list')).toContainText(diagnostic);
    const after = await page.evaluate(() => window.workbench.inspect());
    expect(after.revision).toBe(before.revision);
    expect(after.package).toEqual(before.package);
    expect(after.evaluation.model).toEqual(before.evaluation.model);
  });
}
