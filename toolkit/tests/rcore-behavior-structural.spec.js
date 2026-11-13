import {migrateDefinitionFixture, fixtureDeclaration} from './migration-fixtures.js';
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const cwd = new URL('../.runtime/intersect-text/', import.meta.url);
const source = (uri, kind, text, dependencies = []) => {
  const original = {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies};
  return kind === 'ecore' ? migrateDefinitionFixture(original, native) : original;
};
const standalone = body => {
  const entry = source('memory:structural-behavior.rcore', 'rcore_behavior', `rcore 1; package structural version "1"; ${body}`);
  return { bundle: { version: 1, sources: [entry], namespaces: [] }, entry: entry.id };
};
const native = params => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], { cwd, input: JSON.stringify({ method: 'rcore_behavior/check', ...params }), encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 }));
test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 }); });
async function parity(page, params, ok) {
  const result = await page.evaluate(params => window.workbench.request('intersect/checkRcore', params), params);
  expect(result).toEqual(native(params)); expect(result.ok).toBe(ok);
  expect(result.stage).toBe('typing'); expect(result.executable).toBe(false);
  return result;
}
test('structural source typing and rejection reports agree in native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const program = 'fn data() -> Sequence<(Int8, {label: String, flags: Set<Bool>})> = [(127, {flags: Set::<Bool>([true, true]), label: "ok"})]; fn position(xs: OrderedSet<Int>, i: Int) -> Int? = xs[i]; fn record(x: {right: Bool, left: Int}) -> Int = x.left;';
  const input = standalone(program);
  const accepted = await parity(page, input, true);
  expect(JSON.stringify(accepted)).toContain('OrderedSet');
  for (const body of [
    'fn bad() -> Sequence<Int8> = [128];',
    'fn bad(x: Set<Int>) -> Sequence<Int> = Sequence::<Int>(x);',
    'fn bad() -> {value: Int} = {value: 1, extra: true};',
    'fn bad() -> Int = (1, true)[2];',
    'fn bad(xs: Bag<Int>) -> Int? = xs[0];',
    'fn bad() -> Int = { let empty = []; 0 };',
  ]) { await parity(page, standalone(body), false); }
  expect(await parity(page, input, true)).toEqual(accepted);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});
test('Ecore feature cardinality and collection kinds survive checked structural reads', async ({ page }) => {
  test.setTimeout(120000);
  const fields = [['sequence', true, false], ['ordered', true, true], ['set', false, true], ['bag', false, false]];
  const xml = `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="model" nsURI="urn:s04"><eClassifiers x:type="e:EClass" name="Owner">${fields.map(([name, ordered, unique]) => `<eStructuralFeatures x:type="e:EAttribute" name="${name}" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString" lowerBound="1" upperBound="3" ordered="${ordered}" unique="${unique}"/>`).join('')}</eClassifiers></e:EPackage>`;
  const model = source('memory:structural.ecore', 'ecore', xml);
  const body = 'import model "urn:s04" as m; fn seq(x:m.Owner)->Sequence<String> =x.sequence; fn ord(x:m.Owner)->OrderedSet<String> =x.ordered; fn set(x:m.Owner)->Set<String> =x.set; fn bag(x:m.Owner)->Bag<String> =x.bag;';
  const rcore_behavior = source('memory:model-types-behavior.rcore', 'rcore_behavior', `rcore 1; package modeltypes version "1"; ${body}`, [model.id]);
  const input = { bundle: { version: 1, sources: [model, rcore_behavior], namespaces: [] }, entry: rcore_behavior.id };
  const result = await parity(page, input, true);
  const reordered = structuredClone(input); reordered.bundle.sources.reverse();
  expect(await parity(page, reordered, true)).toEqual(result);
  const bad = source(rcore_behavior.id.uri, rcore_behavior.kind, rcore_behavior.text.replace('Sequence<String>', 'Set<String>'), [model.id]);
  await parity(page, { bundle: { ...input.bundle, sources: [model, bad] }, entry: bad.id }, false);
});
test('Monaco structural authoring diagnoses invalid values and preserves active language', async ({ page }) => {
  const initial = await page.evaluate(() => window.workbench.inspect());
  await page.evaluate(() => window.workbench.definitionModels.rcore_behavior.setValue('rcore 1; package author version "1";'));
  await page.locator('.ide-file-menu > summary').click();
  await page.locator('#open-behavior-source').click();
  const write = async text => {
    await page.evaluate(() => window.workbench.definitionEditor.focus());
    await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(text);
    await page.locator('#compile').click();
  };
  await write('rcore 1; package author version "1"; fn items()->Sequence<{name:String}> =[{name:"ok"}];');
  await expect(page.locator('#diagnostic-list')).toContainText('Expected exactly one semantic provider');
  await write('rcore 1; package author version "1"; fn items()->Sequence<{name:Int}> =[{name:"😀"}];');
  await expect(page.locator('#diagnostic-list')).toContainText('Type mismatch');
  const marker = await page.evaluate(() => window.workbench.definitionModels.rcore_behavior.getAllDecorations().find(d => d.options.className?.includes('squiggly-error'))?.range);
  expect(marker.endColumn - marker.startColumn).toBe(4);
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after.revision).toBe(initial.revision); expect(after.package).toEqual(initial.package); expect(after.evaluation).toEqual(initial.evaluation);
});

test('generic calls retain scoped constraints and deterministic native WASM diagnostics', async ({ page }) => {
  test.setTimeout(120000);
  for (const [body, ok] of [
    ['fn id<T>(x:T)->T=x; fn call()->Int8=id::<Int8>(127); fn nested<U>(x:U)->U=id(x);', true],
    ['fn empty<T>()->Sequence<T> = []; fn call()->Sequence<Int8> = empty();', true],
    ['fn wrap<T>(x:T)->{items:Sequence<T>, pair:(T,Bool)}={items:[x],pair:(x,true)}; fn call()->{pair:(Int8,Bool),items:Sequence<Int8>} = wrap(127);', true],
    ['fn bounded<T:Int>(x:T)->T=x; fn call()->Bool=bounded::<Bool>(true);', false],
    ['fn empty<T>()->Sequence<T> = []; fn call()->Int={let values=empty(); 0};', false],
    ['fn same<T>(a:T,b:T)->T=a; fn call()->Int=same(1,true);', false],
    ['fn eq<T>(a:T,b:T)->Bool=a==b;', false],
    ['fn wrong<T>(x:T)->T=1;', false],
  ]) { await parity(page, standalone(body), ok); }
});


test('symbolic Ecore formals retain identity across native and WASM checking', async ({ page }) => {
  test.setTimeout(180000);
  const model = source('memory:symbolic.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/rcore-behavior-handoff.ecore', import.meta.url), 'utf8'));
  const input = body => {
    const entry = source('memory:symbolic-behavior.rcore', 'rcore_behavior', `rcore 1; package symbolic version "1"; import model "urn:rcore-behavior-handoff" as m; ${body}`, [model.id]);
    return { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id };
  };
  const accepted = input('fn read<T:m.Base>(box:m.Box<T>)->T=box.value; fn items<T:m.Base>(box:m.Box<T>)->Bag<T> =box.items; fn call(box:m.Box<m.Leaf>)->m.Leaf=read(box);');
  const report = await parity(page, accepted, true);
  const reordered = structuredClone(accepted); reordered.bundle.sources.reverse();
  expect(await parity(page, reordered, true)).toEqual(report);
  for (const body of [
    'fn bad<T>(box:m.Box<T>)->T=box.value;',
    'fn bad<T:m.Other>(box:m.Box<T>)->T=box.value;',
    'fn bad<T:m.Base>(box:m.Box<T>)->m.Box<m.Base> =box;',
    'fn bad<T:m.Base>(box:m.Box<m.Base>)->T=box.value;',
    'fn read<T:m.Base>(box:m.Box<T>)->T=box.value; fn bad(box:m.Box<m.Leaf>)->m.Other=read(box);',
  ]) { await parity(page, input(body), false); }
  expect(await parity(page, accepted, true)).toEqual(report);
});


test('symbolic bounds require installed provider evidence before concrete calls', async ({ page }) => {
  test.setTimeout(120000);
  const model = source('memory:symbolic-provider.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/rcore-behavior-provider-handoff.ecore', import.meta.url), 'utf8'));
  const entry = source('memory:symbolic-provider-behavior.rcore', 'rcore_behavior', 'rcore 1; package provider_bound version "1"; import model "urn:rcore-behavior-provider-handoff" as m; fn read<T:m.Alias>(x:m.Box<T>)->T=x.value;', [model.id]);
  const conversions = [0, 1].map(index => ({ datatype: fixtureDeclaration(model, [index]), provider: { name: 'example.rgb', version: '1' }, serializable: true, declarations: [], members: [] }));
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id, conversions, constructors: [], applied_conversions: [] };
  const accepted = await parity(page, params, true);
  for (const remaining of [[], conversions.slice(0, 1), conversions.slice(1)]) {
    await parity(page, { ...params, conversions: remaining }, false);
  }
  const replay = structuredClone(params); replay.bundle.sources.reverse(); replay.conversions.reverse();
  expect(await parity(page, replay, true)).toEqual(accepted);
});


test('pinned Mercurio feature shapes retain static native WASM parity', async ({ page }) => {
  test.setTimeout(120000);
  const model = source('fixture:s04/model.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/rcore-behavior-s04/model.ecore', import.meta.url), 'utf8'));
  const text = readFileSync(new URL('../.runtime/intersect-text/fixtures/rcore-behavior-s04/main-behavior.rcore', import.meta.url), 'utf8');
  const entry = source('fixture:s04/main-behavior.rcore', 'rcore_behavior', text, [model.id]);
  const params = { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id };
  const report = await parity(page, params, true);
  const replay = structuredClone(params); replay.bundle.sources.reverse();
  expect(await parity(page, replay, true)).toEqual(report);
  const wrong = source(entry.id.uri, entry.kind, 'rcore 1; package rejected version "1"; import model "https://www.omg.org/spec/SysML/20250201" as m; fn wrong(x:m.AcceptActionUsage)->m.Expression=x.payloadArgument;', [model.id]);
  await parity(page, { bundle: { ...params.bundle, sources: [model, wrong] }, entry: wrong.id }, false);
});


test('generic inference work limits and recovery agree in native and WASM', async ({ page }) => {
  test.setTimeout(120000);
  const program = width => `fn wide<T>(x:(${Array(width).fill('T').join(',')}))->T=x[0]; fn caller(x:(${Array(width).fill('Int').join(',')}))->Int=wide(x);`;
  const small = standalone(program(512));
  const accepted = await parity(page, small, true);
  const large = standalone(program(9000));
  const failed = await parity(page, large, false);
  expect(JSON.stringify(failed)).toContain('Generic inference work limit exceeded');
  expect(await parity(page, large, false)).toEqual(failed);
  expect(await parity(page, small, true)).toEqual(accepted);
});

test('generic execution evidence retains phantom actuals through native WASM replay', async ({ page }) => {
  const input = standalone('fn keep<T,U>(x:T)->T=x; fn call()->Int8=keep::<Int8,Bool>(127);');
  const result = await parity(page, input, true);
  const reports = result.typed.modules;
  const evidence = Object.values(reports[0].function_instantiations);
  expect(evidence).toHaveLength(1);
  expect(evidence[0].symbol).toEqual({ source: input.entry, declaration: 0 });
  expect(evidence[0].arguments).toHaveLength(2);
  expect(evidence[0].arguments[0]).not.toEqual(evidence[0].arguments[1]);
  expect(await parity(page, structuredClone(input), true)).toEqual(result);
});


test('independent Ecore flags survive symbolic and inherited closed native WASM reports', async ({ page }) => {
  test.setTimeout(120000);
  const before = await page.evaluate(() => window.workbench.inspect());
  const xml = readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/rcore-behavior-handoff.ecore', import.meta.url), 'utf8');
  const flags = ['derived', 'changeable', 'transient', 'volatile', 'unsettable'];
  const input = attributes => {
    const model = source('memory:flags.ecore', 'ecore', xml.replace('name="value"', `name="value" ${attributes}`));
    const entry = source('memory:flags-behavior.rcore', 'rcore_behavior', 'rcore 1; package flags version "1"; import model "urn:rcore-behavior-handoff" as m; fn symbolic<T:m.Base>(x:m.Box<T>)->T=x.value; fn closed(x:m.Diamond)->m.Leaf=x.value; fn raw(x:m.Box)->m.Base=x.value;', [model.id]);
    return { bundle: { version: 1, sources: [model, entry], namespaces: [] }, entry: entry.id };
  };
  for (let mask = 0; mask < 32; mask++) {
    const params = input(flags.map((flag, bit) => `${flag}="${Boolean(mask & (1 << bit))}"`).join(' '));
    const result = await parity(page, params, true);
    const module = result.typed.modules[0];
    const symbolic = Object.values(module.symbolic_members);
    const closed = Object.values(module.members);
    expect(symbolic).toHaveLength(1); expect(closed).toHaveLength(2);
    expect(symbolic[0].declaration).toEqual(closed[0].declaration);
    for (const feature of [...symbolic, ...closed]) {
      for (const [bit, flag] of flags.entries()) expect(feature[flag]).toBe(Boolean(mask & (1 << bit)));
    }
  }
  for (const flag of flags) {
    const request = {method:'ecore/migrate',uri:'memory:invalid-flags.ecore',target_uri:'memory:invalid-flags.rcore',text:xml.replace('name="value"', `name="value" ${flag}="invalid"`)};
    const rejected = await page.evaluate(async request => {const {loadRuntime}=await import('/src/runtime.js');return (await loadRuntime())(request);},request);
    expect(rejected).toEqual(native(request));
    expect(rejected.ok).toBe(false);
    expect(rejected.report.original.text).toBe(request.text);
    expect(rejected.report.issues.some(issue=>issue.blocks_conversion && issue.message.includes(flag))).toBe(true);
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(before);
});
