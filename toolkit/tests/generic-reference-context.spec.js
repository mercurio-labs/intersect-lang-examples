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

test('exact generic reference contexts preserve native WASM identity and replay', async ({ page }) => {
  test.setTimeout(600000);
  const native = request => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], {
    cwd: new URL('../.runtime/intersect-text/', import.meta.url), input: JSON.stringify(request), encoding: 'utf8', timeout: 120000,
  }));
  const browser = (method, params) => page.evaluate(({ method, params }) => window.workbench.request(method, params), { method, params });
  const parity = async (method, nativeMethod, params) => {
    const result = await browser(method, params);
    expect(result).toEqual(native({ method: nativeMethod, ...params }));
    return result;
  };
  const definition = definitionFixture;
  const source = definition('memory:reference-context.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/reference-context.ecore', import.meta.url), 'utf8'));
  const bundle = { version: 1, sources: [source], namespaces: [] };
  const id = n => (fixtureDeclaration(source, [n]));
  const type = (n, args = []) => ({ kind: 'classifier', declaration: id(n), arguments: args, raw: false });
  const codec = (n, name, members) => ({ datatype: id(n), provider: { name, version: '1' }, serializable: false, members });
  const alias = { application: type(2, [type(0)]), conversion: codec(2, 'ecore.list', [{ nullable: false, value: { kind: 'datatype', declaration: id(0) } }]) };
  const bounded = { application: type(3, [alias.application]), conversion: codec(3, 'ecore.list', [{ nullable: false, value: { kind: 'applied', contract: alias } }]) };
  const constructors = [];
  for (const n of [1, 2]) {
    const result = await parity('intersect/constructorContract', 'conversion/constructor', { bundle, datatype: id(n), provider: { name: 'ecore.list.constructor', version: '1' } });
    expect(result.ok).toBe(true); constructors.push(result.contract);
  }
  // Construct both application tags through their checked bind endpoint.
  const boundAlias = await parity('intersect/appliedConversion', 'conversion/applied', { bundle, conversions: [alias], operation: { kind: 'bind', application: alias.application, payload: { items: [{ kind: 'datatype', datatype: id(0), value: 'retained' }] } } });
  expect(boundAlias.ok).toBe(true);
  const bound = await parity('intersect/appliedConversion', 'conversion/applied', { bundle, conversions: [bounded], constructors, operation: { kind: 'bind', application: bounded.application, payload: { items: [boundAlias.value] } } });
  expect(bound.ok).toBe(true);
  const target = type(6, [type(4)]), other = type(6, [type(5)]), raw = { ...type(6), raw: true };
  const types = [target, other, raw, type(7), type(10)];
  const names = ['value', 'other', 'raw', 'sub', 'plain'];
  const modeled = await parity('intersect/materializeGenericTypes', 'ecore/materialize', {
    bundle, entry: source.id, namespace: 'urn:generic-refs', types, applied_conversions: [bounded], constructors,
    instances: types.map((type, n) => ({ id: names[n], type })), edits: names.map(name => [name, 'values', bound.value]),
  });
  expect(modeled.ok).toBe(true);
  for (const invalid of [{ entry: source.id }, { entry: source.id, namespace: 'urn:wrong' }]) {
    const params = { bundle, types: [type(4)], ...invalid };
    // Selection errors may be reported as diagnostics or rejected host requests.
    const rejected = await browser('intersect/materializeGenericTypes', params).catch(error => ({ rejected: error.message }));
    expect(rejected.ok === false || typeof rejected.rejected === 'string').toBe(true);
    let nativeRejected;
    try { nativeRejected = native({ method: 'ecore/materialize', ...params }); }
    catch { nativeRejected = { rejected: true }; }
    expect(nativeRejected.ok === false || nativeRejected.rejected === true).toBe(true);
  }
  const context = { bundle, entry: source.id, namespace: 'urn:generic-refs', conversions: [], materialized_types: types, applied_conversions: [bounded], constructors, model: modeled.model };
  const member = { nullable: false, value: { kind: 'runtime_reference', target, context } };
  const list = { application: type(1, [target]), conversion: codec(1, 'ecore.list', [member]) };
  const map = { application: type(11, [target, target]), conversion: codec(11, 'ecore.map', [member, member]) };
  const conversions = [codec(9, 'ecore.list', [{ nullable: false, value: { kind: 'runtime_reference', target: raw, context } }]), codec(12, 'ecore.list', [{ nullable: false, value: { kind: 'reference', class: id(10), context } }])];
  const grammar = definition('memory:reference-context.xtext', 'xtext', 'grammar example.Refs import "urn:generic-refs" as r\nHolder returns r::Holder: \'holder\' name=ID;', [source.id]);
  const semantics = definition('memory:reference-context-behavior.rcore', 'rcore_behavior', 'rcore 1; package emptyRules version "1";', [source.id]);
  const compilation = { bundle: { version: 1, sources: [source, grammar, semantics], namespaces: [] }, ecore: source.id, namespace: 'urn:generic-refs', xtext: grammar.id, rcore_behavior: semantics.id, materialized_types: [type(8)] };
  const request = { compilation, conversions, applied_conversions: [list, map] };
  const compiled = await browser('intersect/compileBundle', request);
  expect(compiled.ok).toBe(true);
  expect(compiled.package).toEqual(native({ method: 'compile_bundle', ...request }).package);
  const selection = { package: compiled.package, application: list.application, member: 0 };
  const value = await parity('intersect/bindCollectionReference', 'collection/reference-bind', { ...selection, element: 'value' });
  const subtype = await parity('intersect/bindCollectionReference', 'collection/reference-bind', { ...selection, element: 'sub' });
  expect(await parity('intersect/readCollectionReference', 'collection/reference-read', { ...selection, reference: subtype })).toEqual(modeled.model.elements.find(e => e.id === 'sub'));
  // Same declaration with different arguments and a stale snapshot digest both reject.
  for (const [method, nativeMethod, params] of [
    ['intersect/bindCollectionReference', 'collection/reference-bind', { ...selection, element: 'other' }],
    ['intersect/readCollectionReference', 'collection/reference-read', { ...selection, reference: { ...value, context: 'stale' } }],
  ]) {
    await expect(browser(method, params)).rejects.toThrow();
    expect(() => native({ method: nativeMethod, ...params })).toThrow();
  }
  const step = (application, operation, collection) => parity('intersect/stepCollection', 'collection/step', { package: compiled.package, application, operation, ...(collection ? { collection } : {}) });
  const empty = (await step(list.application, { kind: 'empty' })).collection;
  const populated = (await step(list.application, { kind: 'insert', index: 0, item: value }, empty)).collection;
  expect((await step(list.application, { kind: 'remove_at', index: 0 }, populated)).result.value).toEqual(value);
  const emptyMap = (await step(map.application, { kind: 'empty' })).collection;
  const mapping = (await step(map.application, { kind: 'put', key: value, item: subtype }, emptyMap)).collection;
  expect((await step(map.application, { kind: 'get', key: value }, mapping)).result.value).toEqual(subtype);
  // Reactivate from serialized retained inputs; the original reference stays valid.
  const retained = JSON.parse(JSON.stringify(compiled.package));
  const replayed = await browser('intersect/compileBundle', { compilation: retained.compilation, conversions: retained.schema.conversion_contracts, applied_conversions: retained.schema.applied_conversion_contracts, constructors: retained.schema.constructor_contracts || [] });
  expect(replayed.ok).toBe(true); expect(replayed.package).toEqual(retained);
  expect(await parity('intersect/readCollectionReference', 'collection/reference-read', { ...selection, package: retained, reference: value })).toEqual(modeled.model.elements.find(e => e.id === 'value'));
});
