import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {migrateDefinitionFixture,fixtureDeclaration} from './migration-fixtures.js';
const cwd = new URL('../.runtime/intersect-text/', import.meta.url);
const fixtures = () => JSON.parse(execFileSync(process.env.INTERSECT_TEST_RUNTIME_FIXTURES || 'cargo', process.env.INTERSECT_TEST_RUNTIME_FIXTURES ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'e08_runtime_controls', '--locked'], { cwd, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 }));
const native = request => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], { cwd, input: JSON.stringify(request), encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 }));
test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 }); });
for (const name of ['eobject', 'lower']) {
 test(`${name} reference grammar shares native WASM model linking and source replay`, async ({ page }) => {
  test.setTimeout(180000);
  const fixture = fixtures()[name];
  const compiled = await page.evaluate(compilation => window.workbench.request('intersect/compileBundle', { compilation }), fixture.compilation);
  expect(compiled.ok).toBe(true);
  expect(compiled.package).toEqual(native({ method: 'compile_bundle', compilation: fixture.compilation }).package);
  const sources = await page.evaluate(({text, empty}) => {
   window.workbench.modelModels.catalog.setValue(text); window.workbench.modelModels.loans.setValue(empty);
   return Object.values(window.workbench.modelModels).map(m => ({ uri: m.uri.toString(), text: m.getValue() }));
  }, {text: fixture.source.text, empty: name === 'eobject' ? '' : 'model {}'});
  await expect.poll(async () => (await page.evaluate(() => window.workbench.inspect())).evaluation.model.elements.some(e => e.values.name === 'R')).toBe(true);
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  const active = await page.evaluate(() => window.workbench.inspect());
  expect(active.evaluation).toEqual(native({ method: 'evaluate', package: compiled.package, sources }));
  expect(active.evaluation.model.elements.filter(e => e.resource === sources[0].uri)).toHaveLength(name === 'eobject' ? 7 : 6);
  expect(active.evaluation.model.elements).toHaveLength(name === 'eobject' ? 8 : 7);
  const retained = JSON.parse(JSON.stringify(compiled.package));
  const replay = await page.evaluate(compilation => window.workbench.request('intersect/compileBundle', { compilation }), retained.compilation);
  expect(replay.package).toEqual(retained);
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(active.evaluation);
  const badText = name === 'eobject' ? 'other O bound B target O' : 'model { narrow N raw R N }';
  const badSources = await page.evaluate(text => {
   window.workbench.modelModels.catalog.setValue(text);
   return Object.values(window.workbench.modelModels).map(m => ({ uri: m.uri.toString(), text: m.getValue() }));
  }, badText);
  await expect(page.locator('#diagnostic-list')).toContainText('Unresolved');
  const bad = await page.evaluate(() => window.workbench.inspect());
  expect(bad.evaluation).toEqual(native({ method: 'evaluate', package: retained, sources: badSources }));
  if (name === 'eobject') {
   const broken = structuredClone(fixture.compilation);
   const grammar = broken.bundle.sources.find(s => s.kind === 'xtext'); grammar.text = grammar.text.replaceAll('[e::EObject', '[missing::EObject');
   grammar.id.sha256 = createHash('sha256').update(grammar.text).digest('hex'); broken.xtext = grammar.id;
   const result = await page.evaluate(compilation => window.workbench.request('intersect/compileBundle', { compilation }), broken);
   expect(result.ok).toBe(false);
   expect(result.diagnostics).toEqual(native({ method: 'compile_bundle', compilation: broken }).diagnostics);
   expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(bad.evaluation);
  }
 });
}
test('raw method-only policies replay through checked native and WASM schema applications', async ({ page }) => {
 test.setTimeout(180000); const f = fixtures().providers;
 const applications = f.operations.map((operation, i) => ({ receiver: f.receiver, owner: f.receiver, operation, arguments: [f.arguments[i]] }));
 const request = { bundle: f.compilation.bundle, entry: f.compilation.ecore, namespace: f.compilation.namespace, types: f.compilation.materialized_types, conversions: f.conversions, constructors: f.constructors, instances: [{ id: 'holder', type: f.receiver }], runtime_operation_applications: applications };
 const parity = async params => {
  const result = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), params);
  expect(result).toEqual(native({ method: 'ecore/materialize', ...params })); return result;
 };
 const result = await parity(request); expect(result.ok).toBe(true);
 expect(result.schema.conversion_contracts ?? []).toHaveLength(0); expect(result.schema.constructor_contracts ?? []).toHaveLength(0);
 expect(result.operation_dependencies.conversions).toHaveLength(2); expect(result.operation_dependencies.constructors).toHaveLength(2);
 const replay = await parity(result.operation_replay); expect(replay.schema).toEqual(result.schema); expect(replay.runtime_operation_applications).toEqual(result.runtime_operation_applications);
 for (const field of ['conversions', 'constructors']) {
  const missing = { ...result.operation_replay, [field]: [] };
  expect((await parity(missing)).ok).toBe(false);
 }
});
test('ordinary concrete method signatures use the source-checked schema bridge in WASM', async ({ page }) => {
 const text = '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="ordinary" nsURI="urn:ordinary"><eClassifiers x:type="e:EClass" name="Value"/><eClassifiers x:type="e:EClass" name="Owner"><eOperations name="echo" eType="#//Value"><eParameters name="value" eType="#//Value"/></eOperations></eClassifiers></e:EPackage>';
 const source = migrateDefinitionFixture({ id: { uri: 'memory:ordinary.ecore', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] },native);
 const id = path => fixtureDeclaration(source,path); const type = n => ({ kind: 'classifier', declaration: id([n]), arguments: [], raw: false });
 const request = { bundle: { version: 1, sources: [source], namespaces: [] }, types: [type(0), type(1)], runtime_operation_applications: [{ receiver: type(1), operation: id([1, 0]), arguments: [] }] };
 const result = await page.evaluate(params => window.workbench.request('intersect/materializeGenericTypes', params), request);
 expect(result).toEqual(native({ method: 'ecore/materialize', ...request })); expect(result.ok).toBe(true); expect(result.runtime_operation_applications[0].executable).toBe(false);
});
