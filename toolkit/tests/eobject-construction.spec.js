import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const cwd = new URL('../.runtime/intersect-text/', import.meta.url);
const fixtures = () => JSON.parse(execFileSync(process.env.INTERSECT_TEST_EOBJECT_FIXTURES || 'cargo', process.env.INTERSECT_TEST_EOBJECT_FIXTURES ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'e08_eobject_controls', '--locked'], { cwd, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 }));
const native = request => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], { cwd, input: JSON.stringify(request), encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 }));
test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 }); });
test('pinned EObject text construction inheritance and source replay agree in native and WASM', async ({ page }) => {
 test.setTimeout(180000);
 const f = fixtures().eobject;
 const compiled = await page.evaluate(compilation => window.workbench.request('intersect/compileBundle', { compilation }), f.compilation);
 expect(compiled.package).toEqual(native({ method: 'compile_bundle', compilation: f.compilation }).package); expect(compiled.ok).toBe(true);
 const sources = await page.evaluate(text => {
  window.workbench.modelModels.catalog.setValue(text); window.workbench.modelModels.loans.setValue('');
  return Object.values(window.workbench.modelModels).map(m => ({ uri: m.uri.toString(), text: m.getValue() }));
 }, f.source.text);
 await expect.poll(async () => (await page.evaluate(() => window.workbench.inspect())).evaluation.model.elements.some(e => e.values.name === 'R')).toBe(true);
 await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
 const active = await page.evaluate(() => window.workbench.inspect());
 expect(active.evaluation).toEqual(native({ method: 'evaluate', package: compiled.package, sources }));
 expect(active.evaluation.model.elements).toHaveLength(8);
 const top = f.compilation.materialized_types[0].declaration;
 const key = Object.entries(compiled.package.schema.declarations).find(([, d]) => JSON.stringify(d.source) === JSON.stringify(top.source) && JSON.stringify(d.path) === JSON.stringify(top.path))[0];
 expect(active.evaluation.model.elements.filter(e => e.class === key)).toHaveLength(1);
 expect(compiled.package.schema.classes[key].operations).toHaveLength(15);
 for (const receiver of f.compilation.materialized_types.slice(1,3)) {
  const set = Object.values(compiled.package.schema.declared_operation_selections).find(s => JSON.stringify(s.receiver) === JSON.stringify(receiver));
  expect(set.groups).toHaveLength(15);
 }
 const replay = await page.evaluate(compilation => window.workbench.request('intersect/compileBundle', { compilation }), compiled.package.compilation);
 expect(replay.package).toEqual(compiled.package);
 expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(active.evaluation);
 const broken = structuredClone(f.compilation); broken.materialized_types[0].declaration.source.sha256 = '0'.repeat(64);
 const failed = await page.evaluate(compilation => window.workbench.request('intersect/compileBundle', { compilation }), broken);
 expect(failed.diagnostics).toEqual(native({ method: 'compile_bundle', compilation: broken }).diagnostics); expect(failed.ok).toBe(false);
 expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(active.evaluation);
 const badSources = await page.evaluate(() => {
  window.workbench.modelModels.catalog.setValue('child C local C');
  return Object.values(window.workbench.modelModels).map(m => ({ uri: m.uri.toString(), text: m.getValue() }));
 });
 await expect(page.locator('#diagnostic-list')).toContainText('Unresolved');
 expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(native({ method: 'evaluate', package: compiled.package, sources: badSources }));
});
test('real EObject host instances preserve every operation signature and reference identity', async ({ page }) => {
 test.setTimeout(180000); const f=fixtures().eobject.compilation;
 const receiver=f.materialized_types[0];
 const members = await page.evaluate(params => window.workbench.request('intersect/runtimeMemberTypes', params), {bundle:f.bundle,receiver});
 expect(members).toEqual(native({method:'ecore/runtime-member-types',bundle:f.bundle,receiver})); expect(members.ok).toBe(true);
 const applications = members.report.map(m => ({receiver, operation:m.source.declaration, arguments:[]})); expect(applications).toHaveLength(15);
 const names=['object','raw','applied','root','child','other','local'];
 const request={bundle:f.bundle,entry:f.ecore,namespace:f.namespace,types:f.materialized_types,instances:f.materialized_types.map((type,i)=>({id:names[i],type})),edits:[['root','objects',['object','raw','applied','child','other','local']],['root','any','object'],['root','local','local']],runtime_operation_applications:applications};
 const parity=async params=>{const r=await page.evaluate(params=>window.workbench.request('intersect/materializeGenericTypes',params),params);expect(r).toEqual(native({method:'ecore/materialize',...params}));return r;};
 const result=await parity(request); expect(result.ok).toBe(true); expect(result.model.elements).toHaveLength(7);
 expect(result.runtime_operation_applications).toHaveLength(15); expect(result.runtime_operation_applications.every(a=>!a.executable)).toBe(true);
 const replay=await parity(result.operation_replay);expect(replay.schema).toEqual(result.schema);expect(replay.runtime_operation_applications).toEqual(result.runtime_operation_applications);
});
test('explicit provider equivalence preserves operation selection and exact source replay',async({page})=>{
 test.setTimeout(180000);
 for(const f of fixtures().policies){
  const request={bundle:f.compilation.bundle,entry:f.compilation.ecore,namespace:f.compilation.namespace,types:f.compilation.materialized_types,conversions:f.conversions,instances:[{id:'child',type:f.receiver}],edits:[['child','name','Saved']],runtime_operation_applications:[{receiver:f.receiver,operation:f.child,arguments:[]}]};
  const parity=async params=>{const r=await page.evaluate(params=>window.workbench.request('intersect/materializeGenericTypes',params),params);expect(r).toEqual(native({method:'ecore/materialize',...params}));return r;};
  const result=await parity(request);expect(result.ok).toBe(true);
  const set=Object.values(result.schema.declared_operation_selections).find(s=>JSON.stringify(s.receiver)===JSON.stringify(f.receiver));
  expect(set.groups).toHaveLength(1);expect(set.groups[0].selected).toEqual(f.child);expect(set.groups[0].operations.some(o=>JSON.stringify(o.operation.declaration)===JSON.stringify(f.base))).toBe(true);
  const replay=await parity(result.operation_replay);expect(replay.schema).toEqual(result.schema);
  const stale=structuredClone(result.operation_replay);stale.runtime_operation_applications[0].operation.source.sha256='0'.repeat(64);
  expect((await parity(stale)).ok).toBe(false);
 }
});
