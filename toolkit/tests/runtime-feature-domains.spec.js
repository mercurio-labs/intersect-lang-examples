import {migrateDefinitionFixture,fixtureDeclaration} from './migration-fixtures.js';
const nativeFixture = request => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run','-q','-p','intersect-web','--example','rcore_behavior_parse','--locked'], {cwd:new URL('../.runtime/intersect-text/',import.meta.url),input:JSON.stringify(request),encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024}));
function definitionFixture(uri,kind,text,dependencies=[]) {
  const original={id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies};
  return kind==='ecore' ? migrateDefinitionFixture(original,nativeFixture) : original;
}
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 });
  await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('runtime feature domains preserve native WASM bounds and source replay', async ({ page }) => {
  test.setTimeout(240000);
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/raw-feature-domains.ecore', import.meta.url), 'utf8');
  const source = migrateDefinitionFixture({ id: { uri: 'memory:browser-feature-domains', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] },nativeFixture);
  const bundle = { version: 1, sources: [source], namespaces: [] };
  const type = (n, args = [], raw = false) => ({ kind: 'classifier', declaration: fixtureDeclaration(source, [n]), arguments: args, raw });
  const a = type(1), b = type(2), other = type(3);
  const pair = (left, right) => type(4, [left, right]);
  const ab = pair(a, b), aa = pair(a, a), bad = pair(a, other);
  const nestedGood = pair(ab, a), nestedBad = pair(bad, a);
  const named = [
    ['ab', ab], ['aa', aa], ['bad', bad], ['raw', type(5, [], true)], ['closed', type(5, [a])],
    ['nested', type(16, [], true)], ['nested-good', nestedGood], ['nested-bad', nestedBad],
    ['intersection', type(12, [], true)], ['both', type(11)], ['a', a],
  ];
  // Include structural erasures without requiring an inhabitant for every domain.
  const types = [type(0), a, b, other, type(4, [], true), type(10), ...named.map(([, t]) => t)];
  const uniqueTypes = [...new Map(types.map(t => [JSON.stringify(t), t])).values()];
  const request = { bundle, types: uniqueTypes, instances: named.map(([id, type]) => ({ id, type })) };
  const initial = await page.evaluate(() => window.workbench.inspect());
  const parity = async params => {
    const native = JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], {
      cwd: new URL('../.runtime/intersect-text/', import.meta.url), input: JSON.stringify({ method: 'ecore/materialize', ...params }), encoding: 'utf8', timeout: 90000,
    }));
    const wasm = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), params);
    expect(wasm).toEqual(native);
    return wasm;
  };
  const acceptedEdits = [['raw', 'pair', 'ab'], ['closed', 'pair', 'aa'], ['nested', 'value', 'nested-good'], ['intersection', 'value', 'both']];
  const accepted = await parity({ ...request, edits: acceptedEdits });
  expect(accepted.ok).toBe(true);
  for (const [id, feature, target] of acceptedEdits) {
    expect(accepted.model.elements.find(e => e.id === id).values[feature]).toBe(target);
  }
  expect(accepted.model.elements.find(e => e.id === 'raw').type_identity).not.toBe(accepted.model.elements.find(e => e.id === 'closed').type_identity);
  for (const rejected of [
    ['raw', 'pair', 'bad'], ['closed', 'pair', 'ab'],
    ['nested', 'value', 'nested-bad'], ['intersection', 'value', 'a'],
  ]) {
    const result = await parity({ ...request, edits: [['raw', 'pair', 'aa'], rejected] });
    expect(result.ok).toBe(false);
    // This endpoint publishes no partial model on a rejected edit batch.
    expect(result.model).toBeUndefined();
  }
  const replay = JSON.parse(JSON.stringify({ ...request, edits: acceptedEdits }));
  expect(await parity(replay)).toEqual(accepted);
  const sparse = await parity({ bundle, types: [type(0), type(4, [], true), type(5, [], true)], instances: [{ id: 'empty', type: type(5, [], true) }] });
  expect(sparse.ok).toBe(true);
  expect(sparse.model.elements[0].values.pair).toBeNull();
  const sparseDomains = Object.values(sparse.schema.runtime_feature_domains).flat().filter(d => d.source.projection.source.name === 'pair');
  expect(sparseDomains.length).toBeGreaterThan(0);
  expect(sparseDomains.every(d => d.alternatives.length === 0)).toBe(true);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('raw inherited attributes preserve native WASM text codecs and replay', async ({ page }) => {
  test.setTimeout(180000);
  const definition = definitionFixture;
  const source = definition('memory:raw-attribute.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/raw-feature-domains.ecore', import.meta.url), 'utf8'));
  const grammar = definition('memory:raw-attribute.xtext', 'xtext', 'grammar example.RawAttribute import "urn:raw-domains" as r Root returns r::AttrChild: \'attribute\' value=STRING;', [source.id]);
  const semantics = definition('memory:raw-attribute-behavior.rcore', 'rcore_behavior', 'rcore 1; package emptyRules version "1";', [source.id]);
  const receiver = { kind: 'classifier', declaration: fixtureDeclaration(source, [9]), arguments: [], raw: true };
  const compilation = { bundle: { version: 1, sources: [source, grammar, semantics], namespaces: [] }, ecore: source.id, namespace: 'urn:raw-domains', xtext: grammar.id, rcore_behavior: semantics.id, materialized_types: [receiver] };
  const native = request => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], {
    cwd: new URL('../.runtime/intersect-text/', import.meta.url), input: JSON.stringify(request), encoding: 'utf8', timeout: 90000,
  }));
  const compiled = await page.evaluate(compilation => window.workbench.request('intersect/compileBundle', { compilation }), compilation);
  expect(compiled.ok).toBe(true);
  expect(compiled.package).toEqual(native({ method: 'compile_bundle', compilation }).package);
  const sources = await page.evaluate(() => {
    window.workbench.modelModels.catalog.setValue('attribute "one"');
    window.workbench.modelModels.loans.setValue('attribute "two"');
    return Object.values(window.workbench.modelModels).map(model => ({ uri: model.uri.toString(), text: model.getValue() }));
  });
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  await expect(page.locator('#element-count')).toHaveText('2 elements');
  const active = await page.evaluate(() => window.workbench.inspect());
  expect(active.evaluation).toEqual(native({ method: 'evaluate', package: compiled.package, sources }));
  expect(active.evaluation.model.elements.map(element => element.values.value).sort((a, b) => a.value.localeCompare(b.value))).toEqual([
    { kind: 'datatype', datatype: fixtureDeclaration(source, [6]), value: 'one' },
    { kind: 'datatype', datatype: fixtureDeclaration(source, [6]), value: 'two' },
  ]);
  const domains = Object.values(compiled.package.schema.runtime_feature_domains).flat();
  const inherited = domains.find(domain => domain.source.projection.receiver.raw
    && domain.source.projection.receiver.declaration.source.uri === source.id.uri
    && domain.source.projection.receiver.declaration.source.sha256 === source.id.sha256
    && domain.source.projection.receiver.declaration.path.length === 1
    && domain.source.projection.receiver.declaration.path[0] === receiver.declaration.path[0]
    && domain.source.projection.source.name === 'value');
  expect(inherited).toBeDefined();
  expect(inherited.source.projection.receiver).toEqual(receiver);
  expect(inherited.source.projection.source.declaration).toEqual(fixtureDeclaration(source, [8, 1]));
  expect(inherited.source.projection.source.owner).not.toEqual(inherited.source.projection.storage_owner);
  expect(inherited.alternatives.length).toBeGreaterThan(0);
  expect(compiled.package.schema.runtime_warnings.length).toBeGreaterThan(0);
  const retained = JSON.parse(JSON.stringify(compiled.package));
  const replayed = await page.evaluate(compilation => window.workbench.request('intersect/compileBundle', { compilation }), retained.compilation);
  expect(replayed.ok).toBe(true);
  expect(replayed.package).toEqual(retained);
  const replay = await page.evaluate(() => window.workbench.inspect());
  expect(replay.evaluation).toEqual(active.evaluation);
  expect(replay.evaluation).toEqual(native({ method: 'evaluate', package: retained, sources }));
});

test('inherited schema candidate expansion reaches its aggregate comparison boundary', async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.evaluate(async () => {
    const { loadRuntime } = await import('/src/runtime.js');
    window.schemaStressInvoke = await loadRuntime();
  });
  // The final small request verifies recovery in the same WASM instance.
  for (const count of [8, 32, 128, 129, 8]) {
    const features = Array.from({ length: 4 }, (_, i) => `<eStructuralFeatures x:type="e:EReference" name="r${i}"><eGenericType eTypeParameter="#//Root/T"/></eStructuralFeatures>`).join('');
    const children = Array.from({ length: count - 1 }, (_, i) => `<eClassifiers x:type="e:EClass" name="C${i}" eSuperTypes="#//Root"/>`).join('');
    const text = `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:expansion"><eClassifiers x:type="e:EClass" name="Root"><eTypeParameters name="T"><eBounds eClassifier="#//Root"/></eTypeParameters>${features}</eClassifiers>${children}</e:EPackage>`;
    const source = migrateDefinitionFixture({ id: { uri: 'memory:expansion.ecore', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] },nativeFixture);
    const types = Array.from({ length: count }, (_, i) => ({ kind: 'classifier', declaration: fixtureDeclaration(source, [i]), arguments: [], raw: i === 0 }));
    const request = { method: 'ecore/materialize', bundle: { version: 1, sources: [source], namespaces: [] }, types, instances: [] };
    const measured = await page.evaluate(request => {
      const started = performance.now();
      const result = window.schemaStressInvoke(request);
      return { result, milliseconds: performance.now() - started };
    }, request);
    await testInfo.attach(`schema-expansion-${count}`, {
      body: JSON.stringify({ types: count, comparisons: count * count * 4, sourceBytes: Buffer.byteLength(text), milliseconds: measured.milliseconds, ok: measured.result.ok, diagnostics: measured.result.diagnostics }, null, 2),
      contentType: 'application/json',
    });
    const native = JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], {
      cwd: new URL('../.runtime/intersect-text/', import.meta.url), input: JSON.stringify(request), encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024,
    }));
    expect(measured.result).toEqual(native);
    if (count <= 128) {
      expect(measured.result.ok, JSON.stringify(measured.result.diagnostics)).toBe(true);
      expect(Object.keys(measured.result.schema.classes)).toHaveLength(count);
      const domains = Object.values(measured.result.schema.runtime_feature_domains).flat();
      expect(domains).toHaveLength(count * 4);
      expect(domains.every(domain => domain.alternatives.length === count && (domain.unresolved ?? []).length === 0)).toBe(true);
    } else {
      expect(measured.result.ok).toBe(false);
      expect(measured.result.stage).toBe('generic_schema');
      expect(measured.result.diagnostics[0].message).toBe('Runtime feature candidate comparison budget exceeded');
      expect(measured.result.schema).toBeUndefined();
    }
  }
});
