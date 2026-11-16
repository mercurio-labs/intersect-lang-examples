import { test, expect } from '@playwright/test';
import { exampleScript } from '../src/python-api.js';
import { readFile } from 'node:fs/promises';

test('static query panel runs derived and relationship queries without development hooks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  expect(await page.evaluate(() => typeof window.workbench)).toBe('undefined');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'Queries', exact: true }).click();
  await page.getByRole('button', { name: 'Available copies', exact: true }).click();
  await page.locator('#query-run').click();
  await expect(page.locator('#query-results')).toContainText('A Wizard of Earthsea');
  await expect(page.locator('#query-count')).toHaveText('1 row');
  await page.getByRole('button', { name: 'Loans and borrowers', exact: true }).click();
  await page.locator('#query-run').click();
  await expect(page.locator('#query-results')).toContainText('ada');
});

import { readFileSync } from 'node:fs';

test('static Rcore operation declarations compile and duplicate declarations preserve the model', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const library = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-project.rcore', import.meta.url), 'utf8');
  const operation = 'op identify() -> String [0,1];';
  const valid = library.replace('abstract class Named {', 'abstract class Named {' + operation);
  await page.locator('[data-definition="rcore"]').click();
  await page.getByRole('button', { name: 'Rcore source', exact: true }).click();
  for (const [text, expected] of [[valid, 'Language compiled'], [valid.replace(operation, operation + operation), 'Definition compilation failed']]) {
    await page.getByRole('textbox', { name: 'Definition source', exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.evaluate(text => navigator.clipboard.writeText(text), text);
    await page.keyboard.press('ControlOrMeta+V');
    await page.locator('#compile').click();
    await expect(page.locator('#compile-status')).toContainText(expected);
    await expect(page.locator('#active-revision')).toContainText('REV 2');
    await expect(page.locator('#element-count')).toHaveText('6 elements');
  }
  await page.getByRole('tab', { name: /Problems/ }).click();
  await expect(page.locator('#diagnostic-list')).toContainText('Duplicate local operation signature');
});

test('static typed Rcore authoring checks syntax, names and types while preserving the active package', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('button', {name:'Rcore source',exact:true}).click();
  await page.getByRole('tab', { name: /Problems/ }).click();
  const structure = readFileSync(new URL('../.runtime/intersect-text/fixtures/library/library-project.rcore',import.meta.url),'utf8');
  await page.getByRole('textbox', { name: 'Definition source', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(structure.replace('behavior {', 'behavior { fn value(x: Int?) -> Int = match x { Some(n) => n, none => 0 };'));
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  for (const [text, message] of [
    ['rcore 1; package sample version "1"; fn bad() -> Int = ;', 'Expected an identifier'],
    ['rcore 1; package sample version "1"; fn bad() -> Int = missingName;', 'Unresolved value name missingName'],
    ['rcore 1; package sample version "1"; import package absent version "1" as absent;', 'No exact dependency'],
    ['rcore 1; package sample version "1"; fn bad() -> Int = true;', 'Type mismatch'],
    ['rcore 1; package sample version "1"; fn bad() -> Int8 = 128;', 'outside Int8'],
    ['rcore 1; package sample version "1"; fn bad(x: Int?) -> Int = match x { Some(n) => n };', 'Non-exhaustive'],
  ]) {
    await page.getByRole('textbox', { name: 'Definition source', exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+A');
    const body = text.slice(text.indexOf(';',text.indexOf(';')+1)+1);
    await page.keyboard.insertText(structure.replace('behavior {', `behavior { ${body}`));
    await page.locator('#compile').click();
    await expect(page.locator('#diagnostic-list')).toContainText(message);
    await expect(page.locator('#active-revision')).toContainText('REV 2');
    await expect(page.locator('#element-count')).toHaveText('6 elements');
  }
  expect(errors).toEqual([]);
});
test('static production bundle compiles locally, edits in Monaco, and exports', async ({ page }) => {
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  expect(await page.evaluate(() => typeof window.workbench)).toBe('undefined');
  await page.locator('.ide-file-menu > summary').click();
  await page.locator('#export-package').click();
  const languageDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  expect((await languageDownload).suggestedFilename()).toBe('library-0.1.0.zip');
  await page.getByRole('button', {name:'Rcore source',exact:true}).click();
  await page.getByRole('textbox', { name: 'Definition source', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('{}');
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toHaveText('Definition compilation failed');
  await expect(page.locator('#active-revision')).toContainText('REV 1');
  await page.locator('.ide-file-menu > summary').click();
  await page.locator('#new-sample-project').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click();
  await page.locator('#export').click();
  expect((await download).suggestedFilename()).toBe('intersect-model.json');
  const xmiDownload = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click();
  await page.getByRole('button', { name: 'Export XMI' }).click();
  const xmi = await xmiDownload;
  expect(xmi.suggestedFilename()).toBe('intersect-model-xmi.zip');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.ide-file-menu > summary').click();
  await page.locator('#import-model').click();
  await (await chooser).setFiles({ name: xmi.suggestedFilename(), mimeType: 'application/zip', buffer: await readFile(await xmi.path()) });
  await expect(page.locator('#interchange-status')).toContainText('Imported 2 resource');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  expect(errors).toEqual([]);
  expect(requests.some(r => r.url.endsWith('intersect_web.wasm'))).toBe(true);
  expect(requests.every(r => r.method === 'GET' && (r.url.startsWith(`${new URL(page.url()).origin}/`) || r.url.startsWith('blob:')))).toBe(true);
});

test('static Python workflow uses only local assets and real Monaco input', async ({ page }) => {
  test.setTimeout(90000);
  const requests = [], errors = [];
  page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  expect(requests.some(r => r.url.includes('/python/'))).toBe(false);
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  await page.getByRole('textbox', { name: 'Python script', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(exampleScript + '\ncopy.unset_edition()\nassert copy.edition == 1 and not copy.is_set_edition()\nassert not copy.is_set_available()\nassert not Library.find("Catalog").add_copies(copy)\nprint("Completed:", copy.ava');
  await page.keyboard.press('ControlOrMeta+Space');
  await expect(page.locator('.suggest-widget.visible')).toContainText('available');
  await page.keyboard.press('Enter');
  await page.keyboard.type(')');
  await page.locator('#python-run').click();
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  await expect(page.locator('#python-output')).toContainText('Completed: False');
  await expect(page.locator('#python-output')).toContainText('Validation: []');
  await expect(page.locator('#element-count')).toHaveText('7 elements');
  await expect(page.locator('#model-tree')).toContainText('second');
  await page.getByRole('tab', { name: 'Transactions', exact: true }).click();
  await expect(page.locator('#transaction-list')).toContainText('committed');
  await expect(page.locator('#transaction-detail')).toContainText('BookCopy.available');
  await expect(page.locator('#transaction-detail')).toContainText('Validation: passed');
  await expect(page.locator('#python-error')).toBeEmpty();
  expect(requests.some(r => r.url.includes('pyodide.asm.wasm'))).toBe(true);
  expect(requests.some(r => r.url.includes('pyright.worker.js'))).toBe(true);
  expect(requests.every(r => r.method === 'GET' && (r.url.startsWith(`${new URL(page.url()).origin}/`) || r.url.startsWith('blob:')))).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/python-production-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/python-production-mobile.png', fullPage: true });
});

test('optimized WASM executes scalar branches and exact IEEE results', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const outcomes = await page.evaluate(async () => {
    const { instance } = await WebAssembly.instantiate(await (await fetch('/intersect_web.wasm')).arrayBuffer(), {});
    const invoke = async body => {
      const text = `rcore 1; package production version "1"; ${body}`;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const id = { uri: 'memory:production-behavior.rcore', sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') };
      const request = { method: 'rcore_behavior/evaluateScalar', bundle: { version: 1, sources: [{ id, kind: 'rcore_behavior', text, dependencies: [] }], namespaces: [] }, entry: id, selected: { source: id, declaration: 0 }, arguments: [] };
      const bytes = new TextEncoder().encode(JSON.stringify(request));
      const pointer = instance.exports.input_buffer(bytes.length);
      if (!pointer) throw new Error('Unexpected scalar input budget failure');
      new Uint8Array(instance.exports.memory.buffer, pointer, bytes.length).set(bytes);
      const length = instance.exports.execute();
      return JSON.parse(new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, instance.exports.output_buffer(), length)));
    };
    return [await invoke('fn main()->Bool=false && (1/0==0);'), await invoke('fn main()->Float32=0/0;'), await invoke('fn main()->Int8=1/0;')];
  });
  expect(outcomes[0].ok).toBe(true); expect(outcomes[0].evaluation.value.payload).toBe(false);
  expect(outcomes[1].ok).toBe(true); expect(outcomes[1].evaluation.value.payload).toEqual({ kind: 'float32', bits: '7fc00000' });
  expect(outcomes[2].ok).toBe(false); expect(outcomes[2].failure.arithmetic_kind).toBe('division_by_zero');
  await expect(page.locator('#active-revision')).toContainText('REV 1');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
});


test('optimized callable WASM retains closures, overload selection and generic failure traces', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const outcomes = await page.evaluate(async () => {
    const { instance } = await WebAssembly.instantiate(await (await fetch('/intersect_web.wasm')).arrayBuffer(), {});
    const invoke = async (body, expected_program) => {
      const text = `rcore 1;package production_functions version "1";${body}`;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const id = { uri: 'memory:production-functions-behavior.rcore', sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') };
      const request = { method: 'rcore_behavior/evaluateFunction', bundle: { version: 1, sources: [{ id, kind: 'rcore_behavior', text, dependencies: [] }], namespaces: [] }, entry: id, selection: { symbol: { source: id, declaration: 0 }, types: [], arguments: [] }, arguments: [] };
      if (expected_program) request.expected_program = expected_program;
      const bytes = new TextEncoder().encode(JSON.stringify(request));
      const pointer = instance.exports.input_buffer(bytes.length);
      if (!pointer) throw new Error('Unexpected callable input budget failure');
      new Uint8Array(instance.exports.memory.buffer, pointer, bytes.length).set(bytes);
      const length = instance.exports.execute();
      return JSON.parse(new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, instance.exports.output_buffer(), length)));
    };
    const body = 'fn run()->Int8={let f=make(40);f(2)};fn make(x:Int8)->(Int8)->Int8=|y:Int8|pick(x+y);fn pick(x:Int8)->Int8=x;fn pick(x:Bool)->Bool=x;';
    const accepted = await invoke(body);
    const failed = await invoke('fn run()->Int8=fail::<Bool>(true);fn fail<T>(x:T)->Int8=1/0;');
    const ambiguous = await invoke('fn run()->Int8=pick(1);fn pick(x:Int8)->Int8=1;fn pick(x:Int16)->Int8=2;');
    const recursive = await invoke('fn run()->Int8=run();');
    const recursiveValue = await invoke('fn run()->Int8=sum(5);fn sum(n:Int8)->Int8=if n==0 {0} else {n+sum(n-1)};');
    return { accepted, failed, ambiguous, recursive, recursiveValue, recovered: await invoke(body, accepted.program) };
  });
  expect(outcomes.accepted.ok, JSON.stringify(outcomes.accepted)).toBe(true);
  expect(outcomes.accepted.evaluation.value.data.Scalar.payload).toBe(42);
  expect(outcomes.accepted.evaluation.consumed.closures).toBeGreaterThan(0);
  expect(outcomes.accepted.evaluation.consumed_providers).toEqual([]);
  expect(outcomes.failed.failure.kind).toBe('Arithmetic');
  expect(outcomes.failed.failure.trace).toHaveLength(2);
  const named = outcomes.failed.failure.trace[0].function.Named;
  expect(named.symbol.declaration).toBe(1);
  expect(named.type_arguments).toHaveLength(1);
  expect(outcomes.failed.program.types[named.type_arguments[0]]).toEqual({ Scalar: 'Bool' });
  expect(outcomes.ambiguous.stage).toBe('function_compile');
  expect(outcomes.ambiguous.diagnostics.some(d => d.message.includes('Ambiguous overload'))).toBe(true);
  expect(outcomes.recursive.failure.kind).toBe('ResourceExhausted');
  expect(outcomes.recursiveValue.ok).toBe(true);
  expect(outcomes.recursiveValue.evaluation.value.data.Scalar.payload).toBe(15);
  expect(outcomes.recovered).toEqual(outcomes.accepted);
  await expect(page.locator('#active-revision')).toContainText('REV 1');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
});


test('built language worker cancels live callable work and preserves independent requests and active models', async ({ page }) => {
  // Observe the worker constructed by the production client without exposing a
  // development-only API or importing unbundled worker/client source.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes('language.worker')) window.productionLanguageWorker = this;
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  const observed = await page.evaluate(async () => {
    const worker = window.productionLanguageWorker;
    if (!worker) throw new Error('Production language worker was not constructed');
    const pending = new Map();
    const counts = {};
    const listener = ({ data }) => {
      if (typeof data.id !== 'string' || !data.id.startsWith('s07:')) return;
      counts[data.id] = (counts[data.id] || 0) + 1;
      const handler = pending.get(data.id);
      if (handler) { pending.delete(data.id); handler(data); }
    };
    worker.addEventListener('message', listener);
    const request = (id, method, params = {}) => new Promise(resolve => {
      pending.set(id, resolve);
      worker.postMessage({ jsonrpc: '2.0', id, method, params });
    });
    const input = async body => {
      const text = `rcore 1;package production_control version "1";${body}`;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const id = { uri: 'memory:production-control-behavior.rcore', sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') };
      return { bundle: { version: 1, sources: [{ id, kind: 'rcore_behavior', text, dependencies: [] }], namespaces: [] }, entry: id, selection: { symbol: { source: id, declaration: 0 }, types: [], arguments: [] }, arguments: [] };
    };
    try {
      const before = await request('s07:before', 'intersect/inspect');
      const long = await input('fn run()->Int8=f12();fn f0()->Int8=1;' + Array.from({ length: 12 }, (_, n) => `fn f${n + 1}()->Int8={let ignored=f${n}();f${n}()};`).join(''));
      const small = await input('fn run()->Int8=even(6);fn even(n:Int8)->Int8=if n==0 {42} else {odd(n-1)};fn odd(n:Int8)->Int8=even(n-1);');
      // Warm the dedicated execution host before probing live execution slices.
      await request('s07:warm', 'intersect/evaluateFunctionRcore', small);
      const running = request('s07:long', 'intersect/evaluateFunctionRcore', long);
      const independent = request('s07:small', 'intersect/evaluateFunctionRcore', small);
      const probe = await request('s07:probe', 'intersect/parseRcore', { uri: 'memory:probe-behavior.rcore', text: 'rcore 1;package probe version "1";' });
      // Completion of the independently scheduled short job lets the long job
      // advance without assuming a wall-clock duration for execution slices.
      const completed = await independent;
      const active = pending.has('s07:long');
      worker.postMessage({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 's07:long' } });
      const cancelled = await running;
      worker.postMessage({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 's07:long' } });
      const recovered = await request('s07:recovery', 'intersect/evaluateFunctionRcore', small);
      const typed = await request('s07:typed', 'intersect/evaluateFunctionRcore', await input('fn run()->Result<Int8,String> =carry(4,Err::<Int8,String>("kept"));fn carry<T>(n:Int8,x:T)->T=if n==0 {x} else {carry::<T>(n-1,x)};'));
      const after = await request('s07:after', 'intersect/inspect');
      return { active, probe, cancelled, completed, recovered, typed, before, after, counts, pending: pending.size };
    } finally { worker.removeEventListener('message', listener); }
  });
  expect(observed.active).toBe(true);
  expect(observed.probe.result.ok).toBe(true);
  expect(observed.cancelled.error).toBeUndefined();
  expect(observed.cancelled.result.failure.kind).toBe('Cancelled');
  expect(observed.cancelled.result.failure.consumed.steps).toBeGreaterThan(0);
  expect(observed.completed.result.evaluation.value.data.Scalar.payload).toBe(42);
  expect(observed.recovered.result).toEqual(observed.completed.result);
  expect(observed.typed.result.ok).toBe(true);
  expect(observed.typed.result.evaluation.value.data.Err.data.Scalar.payload).toBe('kept');
  expect(observed.after).toEqual({ ...observed.before, id: 's07:after' });
  expect(observed.counts['s07:long']).toBe(1);
  expect(observed.pending).toBe(0);
  await expect(page.locator('#active-revision')).toContainText('REV 1');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
});


test('built collection worker executes comprehensions and cancels callback work with replay recovery', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes('language.worker')) window.productionLanguageWorker = this;
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const observed = await page.evaluate(async () => {
    const worker = window.productionLanguageWorker;
    const pending = new Map();
    const counts = {};
    const listener = ({ data }) => {
      if (typeof data.id !== 'string' || !data.id.startsWith('s08:')) return;
      counts[data.id] = (counts[data.id] || 0) + 1;
      const resolve = pending.get(data.id);
      if (resolve) { pending.delete(data.id); resolve(data); }
    };
    worker.addEventListener('message', listener);
    const request = (id, method, params = {}) => new Promise(resolve => {
      pending.set(id, resolve);
      worker.postMessage({ jsonrpc: '2.0', id, method, params });
    });
    const input = async body => {
      const text = `rcore 1;package production_collections version "1";${body}`;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const id = { uri: 'memory:production-collections-behavior.rcore', sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') };
      return { bundle: { version: 1, sources: [{ id, kind: 'rcore_behavior', text, dependencies: [] }], namespaces: [] }, entry: id, selection: { symbol: { source: id, declaration: 0 }, types: [], arguments: [] }, arguments: [] };
    };
    try {
      const before = await request('s08:before', 'intersect/inspect');
      const small = await input('fn run()->Bool={let xs=[for x in [1,2], y in [x,3] where y>1 yield x+y];let sorted=sortedWith(xs,|a:Int,b:Int|a-b);first(sorted)==Some(4) && size(groupBy(sorted,|x:Int|x))==2 && size(distinct(sorted))==2 && count(sorted,4)==2};');
      const accepted = await request('s08:accepted', 'intersect/evaluateFunctionRcore', small);
      const replay = await request('s08:replay', 'intersect/evaluateFunctionRcore', {...small,expected_program:accepted.result.program});
      const long = await input('fn run()->Sequence<Int> =map([1,2,3],|x:Int|f12());fn f0()->Int=1;' + Array.from({length:12},(_,n)=>`fn f${n+1}()->Int={let ignored=f${n}();f${n}()};`).join(''));
      const running = request('s08:long', 'intersect/evaluateFunctionRcore', long);
      const independent = await request('s08:independent', 'intersect/evaluateFunctionRcore', small);
      const active = pending.has('s08:long');
      const probe = await request('s08:probe', 'intersect/parseRcore', {uri:'memory:collection-probe-behavior.rcore',text:'rcore 1;package probe version "1";'});
      worker.postMessage({jsonrpc:'2.0',method:'$/cancelRequest',params:{id:'s08:long'}});
      const cancelled = await running;
      const recovered = await request('s08:recovery', 'intersect/evaluateFunctionRcore', small);
      const failure = await request('s08:failure', 'intersect/evaluateFunctionRcore', await input('fn run()->Sequence<Int> =map([1,0],|x:Int|10/x);'));
      const after = await request('s08:after', 'intersect/inspect');
      return {before,after,accepted,replay,independent,active,probe,cancelled,recovered,failure,counts,pending:pending.size};
    } finally { worker.removeEventListener('message',listener); }
  });
  expect(observed.accepted.result.ok,JSON.stringify(observed.accepted)).toBe(true);
  expect(observed.accepted.result.evaluation.value.data.Scalar.payload).toBe(true);
  expect(observed.replay.result).toEqual(observed.accepted.result);
  expect(observed.independent.result).toEqual(observed.accepted.result);
  expect(observed.active).toBe(true);
  expect(observed.probe.result.ok).toBe(true);
  expect(observed.cancelled.result.failure.kind).toBe('Cancelled');
  expect(observed.cancelled.result.failure.consumed.steps).toBeGreaterThan(0);
  expect(observed.recovered.result).toEqual(observed.accepted.result);
  expect(observed.failure.result.failure.kind).toBe('Arithmetic');
  expect(observed.after).toEqual({...observed.before,id:'s08:after'});
  expect(observed.counts['s08:long']).toBe(1);
  expect(observed.pending).toBe(0);
  await expect(page.locator('#active-revision')).toContainText('REV 1');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
});


test('static Rcore example supports definition and language usage without development hooks', async ({page}) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?example=rcore');
  await expect(page.locator('#definition-file')).toHaveText('specialization.rcore');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#element-count')).toHaveText('8 elements');
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.getByRole('tab',{name:'types.demo',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'relations.demo',exact:true})).toBeVisible();
  await expect(page.locator('#model-file')).toHaveText('types.demo');
  await page.locator('#dock-tab-rcore').click();
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A → B → C');
  await expect(page.locator('#rcore-read-status')).toContainText('10 semantic read records · 1 validated model context');
  await expect(page.locator('#rcore-reads')).toContainText('incoming_end');
  await page.locator('#rcore-seed').fill('D');
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('D');
  await expect(page.locator('#rcore-read-status')).toContainText('2 semantic read records · 1 validated model context');
  await page.locator('#rcore-seed').fill('missing');
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('No Type named missing.');
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  expect(errors).toEqual([]);
});


test('File starters open blank, Library and evolving KerML projects with clean demo state', async ({page}) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  const openStarter = async name => {
    await page.locator('.ide-file-menu > summary').click();
    const starters = page.getByRole('group',{name:'Starter projects',exact:true});
    await expect(starters.getByRole('button')).toHaveText(['New Blank Project', 'New Library Project', 'New KerML Project', 'New inferred language', 'New Rust/Rhai example']);
    await starters.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('tab',{name:'Define',exact:true})).toHaveAttribute('aria-selected','true');
  };
  await openStarter('New KerML Project');
  await expect(page.locator('#project-status')).toContainText('New KerML project');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class')).toHaveCount(3);
  await expect(page.locator('#element-count')).toHaveText('8 elements');
  await expect(page.locator('#definition-file')).toHaveText('specialization.rcore');
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.getByRole('tab',{name:'types.demo',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'relations.demo',exact:true})).toBeVisible();
  await expect(page.locator('#model-file')).toHaveText('types.demo');
  await page.locator('#dock-tab-rcore').click();
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A → B → C');
  await page.locator('#rcore-seed').fill('D');
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('D');
  await openStarter('New KerML Project');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#dock-tab-rcore').click();
  await expect(page.locator('#rcore-seed')).toHaveValue('A');
  await expect(page.locator('#rcore-result')).not.toHaveText('D');
  await expect(page.locator('#rcore-reads')).toBeEmpty();
  await openStarter('New Library Project');
  await expect(page.locator('#project-status')).toContainText('New sample project');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class:not([data-enum])')).toHaveCount(5);
  await expect(page.locator('.structure-class[data-enum="BookCondition"]')).toHaveCount(1);
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.locator('#dock-tab-rcore')).toBeHidden();
  await openStarter('New Blank Project');
  await expect(page.locator('#project-status')).toContainText('New empty project');
  await expect(page.locator('.structure-class')).toHaveCount(1);
  await expect(page.locator('#element-count')).toHaveText('0 elements');
  await expect(page.locator('[data-definition="xtext"]')).toBeDisabled();
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class[data-class="Element"]')).toBeVisible();
});
