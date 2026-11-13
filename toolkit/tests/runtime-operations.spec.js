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

test('runtime method projections check bounds and replay identically in native and WASM', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 });
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/runtime-operations.ecore', import.meta.url), 'utf8');
  const source = migrateDefinitionFixture({ id: { uri: 'memory:runtime-operations', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] },nativeFixture);
  const bundle = { version: 1, sources: [source], namespaces: [] };
  const id = path => (fixtureDeclaration(source,path));
  const type = (n, args = [], raw = false) => ({ kind: 'classifier', declaration: id([n]), arguments: args, raw });
  const parity = async (method, worker, params) => {
    const native = JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], { cwd: new URL('../.runtime/intersect-text/', import.meta.url), input: JSON.stringify({ method, ...params }), encoding: 'utf8', timeout: 90000 }));
    const browser = await page.evaluate(({ worker, params }) => window.workbench.request(worker, params), { worker, params });
    expect(browser).toEqual(native); return browser;
  };
  const raw = type(4, [], true), both = type(2), operation = id([4, 1]);
  const application = { receiver: raw, operation, arguments: [both] };
  const checked = await parity('ecore/runtime-operation-types', 'intersect/instantiateRuntimeOperation', { bundle, ...application });
  expect(checked.ok).toBe(true); expect(checked.executable).toBe(false); expect(checked.selection_verified).toBe(false);
  expect(checked.report.projection.receiver).toEqual(raw);
  expect((await parity('ecore/runtime-operation-types', 'intersect/instantiateRuntimeOperation', { bundle, ...application, arguments: [type(3)] })).ok).toBe(false);
  const mixed = type(8);
  const projections = await parity('ecore/runtime-member-types', 'intersect/runtimeMemberTypes', { bundle, receiver: mixed });
  expect(projections.ok).toBe(true);
  const owners = projections.report.filter(p => JSON.stringify(p.source.declaration.path) === JSON.stringify(operation.path)).map(p => p.source.owner);
  expect(owners).toHaveLength(2);
  expect((await parity('ecore/runtime-operation-types', 'intersect/instantiateRuntimeOperation', { bundle, ...application, receiver: mixed })).ok).toBe(false);
  for (const owner of owners) expect((await parity('ecore/runtime-operation-types', 'intersect/instantiateRuntimeOperation', { bundle, ...application, receiver: mixed, owner })).ok).toBe(true);
  const materialized = await parity('ecore/materialize', 'intersect/materializeGenericTypes', { bundle, types: [raw, both], instances: [{ id: 'raw', type: raw }], runtime_operation_applications: [application] });
  expect(materialized.ok).toBe(true);
  expect(materialized.runtime_operation_applications[0].report).toEqual(checked.report);
  const replay = await parity('ecore/materialize', 'intersect/materializeGenericTypes', materialized.operation_replay);
  expect(replay.schema).toEqual(materialized.schema);
  expect(replay.runtime_operation_applications).toEqual(materialized.runtime_operation_applications);
});


test('runtime method argument budgets aggregate across native and WASM requests', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 });
  const formals = n => Array.from({ length: n }, (_, i) => `<eTypeParameters name="T${i}"/>`).join('');
  const leaves = Array.from({ length: 128 }, (_, i) => `<eClassifiers x:type="e:EClass" name="Leaf${i}"/>`).join('');
  const text = `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="budget" nsURI="urn:runtime-budget"><eClassifiers x:type="e:EClass" name="Wide">${formals(128)}</eClassifiers>${leaves}<eClassifiers x:type="e:EClass" name="Methods"><eOperations name="over">${formals(128)}</eOperations><eOperations name="small">${formals(1)}</eOperations></eClassifiers></e:EPackage>`;
  const source = migrateDefinitionFixture({ id: { uri: 'memory:runtime-budget', sha256: createHash('sha256').update(text).digest('hex') }, kind: 'ecore', text, dependencies: [] },nativeFixture);
  const bundle = { version: 1, sources: [source], namespaces: [] };
  const id = path => (fixtureDeclaration(source,path));
  const type = (n, args = []) => ({ kind: 'classifier', declaration: id([n]), arguments: args, raw: false });
  const actuals = Array.from({ length: 128 }, (_, i) => type(0, Array.from({ length: 128 }, () => type(i + 1))));
  const parity = async params => {
    const native = JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], { cwd: new URL('../.runtime/intersect-text/', import.meta.url), input: JSON.stringify({ method: 'ecore/runtime-operation-types', ...params }), encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 }));
    const browser = await page.evaluate(params => window.workbench.request('intersect/instantiateRuntimeOperation', params), params);
    expect(browser).toEqual(native); return browser;
  };
  const failed = await parity({ bundle, receiver: type(129), operation: id([129, 0]), arguments: actuals });
  expect(failed.ok).toBe(false);
  expect(failed.diagnostics[0].kind).toBe('ResourceLimit');
  expect(failed.diagnostics[0].message).toContain('budget');
  const recovered = await parity({ bundle, receiver: type(129), operation: id([129, 1]), arguments: [actuals[0]] });
  expect(recovered.ok).toBe(true);
  expect(recovered.executable).toBe(false);
});
