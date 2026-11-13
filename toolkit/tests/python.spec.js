import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { generatePythonApi } from '../src/python-api.js';
test.setTimeout(90000);
async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
}
async function script(page, text) {
  await page.evaluate(text => window.workbench.python.model.setValue(text), text);
}
async function run(page) { await page.locator('#python-run').click(); }

test('Python reports its C3 limitation without changing the Ecore graph', () => {
  const cls = (...parents) => ({ parents, features: {} });
  const pkg = { schema: { uri: 'urn:c3', classes: { A: cls(), B: cls(), X: cls('A', 'B'), Y: cls('B', 'A'), Z: cls('X', 'Y') } }, semantics: { derived: [] } };
  expect(() => generatePythonApi(pkg, 'test')).toThrow('inconsistent C3 order');
  expect(pkg.schema.classes.Z.parents).toEqual(['X', 'Y']);
});

test('diamond inheritance exposes secondary features and nominal Python subtypes', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const w = window.workbench;
    const model = w.definitionModels.rcore;
    const branch = 'interface class Labeled extends Named { attr label: String [0,1] default "secondary"; } class Tracked extends Named {}';
    model.setValue(model.getValue().replace('class BookCopy extends Named', branch + '\nclass BookCopy extends Tracked, Labeled'));
    await w.compile();
  });
  await expect(page.locator('#active-revision')).toContainText('REV 2');
  await expect.poll(() => page.evaluate(() => window.workbench.python.api.stub)).toContain('class BookCopy(Tracked, Labeled)');
  await page.locator('#python-bind').click();
  await expect(page.locator('#python-status')).toContainText('Python ready');
  await script(page, 'from intersect_api import BookCopy, Tracked, Labeled, Named\nc = BookCopy.find("earthsea")\nassert isinstance(c, Tracked) and isinstance(c, Labeled) and isinstance(c, Named)\nassert c.label == "secondary"\nc.label = "edited"\nassert c.label == "edited"\nassert len(Labeled.all()) == 2\nprint("diamond verified")');
  await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  await expect(page.locator('#python-output')).toContainText('diamond verified');
  const state = await page.evaluate(() => window.workbench.inspect());
  expect(state.evaluation.model.elements.find(e => e.values.name === 'earthsea').values.label).toBe('edited');
});

test('C3 binding failure leaves the native compiled model usable', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const w = window.workbench;
    const declarations = 'class Alpha {} class Beta {} class First extends Alpha, Beta {} class Second extends Beta, Alpha {}';
    const model = w.definitionModels.rcore;
    model.setValue(model.getValue().replace('class BookCopy extends Named', declarations + '\nclass BookCopy extends Named, First, Second'));
    await w.compile();
  });
  await expect(page.locator('#active-revision')).toContainText('REV 2');
  await expect(page.locator('#python-error')).toContainText('inconsistent C3 order');
  const state = await page.evaluate(() => window.workbench.inspect());
  expect(state.evaluation.diagnostics).toEqual([]);
  expect(state.evaluation.model.elements).toHaveLength(6);
  const copy = state.evaluation.model.elements.find(e => e.values.name === 'earthsea');
  expect(state.evaluation.derived[copy.id].available).toBe(true);
  await page.evaluate(() => {
    const model = window.workbench.modelModels.catalog;
    model.setValue(model.getValue().replace('A Wizard of Earthsea', 'Edited title'));
  });
  await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.title)).toBe('Edited title');
});
test('generated API, Monaco services, Python loan and shared model inspection', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  const api = await page.evaluate(() => window.workbench.python.api);
  expect(api.stub).toContain('class Loan(Named)');
  expect(api.stub).toContain('def available(self) -> bool');
  expect(api.stub).not.toContain('@available.setter');
  expect(await page.evaluate(() => window.workbench.python.apiEditor.getRawOptions().readOnly)).toBe(true);
  await script(page, 'from intersect_api import BookCopy, Loan\ncopy = BookCopy.find("earthsea")\ncopy.ava\n');
  await page.evaluate(() => { const e = window.workbench.python.editor; e.setPosition({ lineNumber: 3, column: 9 }); e.focus(); e.trigger('test', 'editor.action.triggerSuggest', {}); });
  await expect(page.locator('.suggest-widget.visible')).toContainText('available');
  await page.keyboard.press('Escape');
  await script(page, 'from intersect_api import BookCopy\ncopy = BookCopy.find("earthsea")\ncopy.available\n');
  expect(JSON.stringify(await page.evaluate(() => window.workbench.python.request('hover', 2, 8)))).toContain('bool');
  expect(JSON.stringify(await page.evaluate(() => window.workbench.python.request('signatureHelp', 1, 21)))).toContain('name: str');
  await page.evaluate(() => { const e = window.workbench.python.editor; e.setPosition({ lineNumber: 2, column: 22 }); e.focus(); e.trigger('test', 'editor.action.triggerParameterHints', {}); });
  await expect(page.locator('.parameter-hints-widget.visible')).toContainText('name: str');
  await page.keyboard.press('Escape');
  await script(page, 'from intersect_api import BookCopy\nbad = BookCopy(name=42)\n');
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.workbench.python.diagnostics))).toContain('reportArgumentType');
  await page.evaluate(async () => { const { exampleScript } = await import('/src/python-api.js'); window.workbench.python.model.setValue(exampleScript); });
  await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  await expect(page.locator('#python-output')).toContainText('Available before: True');
  await expect(page.locator('#python-output')).toContainText('Available after: False');
  await expect(page.locator('#python-output')).toContainText('Validation: []');
  await expect(page.locator('#element-count')).toHaveText('7 elements');
  await expect(page.locator('#model-status')).toContainText('SCRIPT OVERLAY');
  const state = await page.evaluate(() => window.workbench.inspect());
  const copy = state.evaluation.model.elements.find(e => e.values.name === 'earthsea');
  expect(state.evaluation.derived[copy.id].available).toBe(false);
  expect(state.evaluation.diagnostics).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/python-usage.png', fullPage: true });
});

test('combined Rcore structure and behavior regenerate the VFS; old interfaces cannot publish', async ({ page }) => {
  await ready(page);
  const old = await page.evaluate(() => window.workbench.inspect());
  const compiled = await page.evaluate(async () => {
    const w = window.workbench;
    const r = w.definitionModels.rcore;
    r.setValue(r.getValue().replace('attr title:', 'attr subtitle:').replace('size(self.copies)', 'size(self.members)'));
    const x = w.definitionModels.xtext;
    x.setValue(x.getValue().replace('title=STRING', 'subtitle=STRING'));
    return w.compile();
  });
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
  await expect(page.locator('#python-binding')).toContainText('STALE');
  const api = await page.evaluate(() => window.workbench.python.api);
  expect(api.stub).toContain('def subtitle'); expect(api.stub).not.toContain('def title');
  const rejection = await page.evaluate(async old => {
    try { await window.workbench.request('intersect/scriptCommit', { interfaceRevision: old.interfaceRevision, generation: old.generation, model: old.evaluation.model }); return 'accepted'; } catch (e) { return e.message; }
  }, old);
  expect(rejection).toContain('Stale transaction');
  await page.locator('#python-bind').click();
  await expect(page.locator('#python-status')).toContainText('Python ready');
  expect(api.stub).toContain('def copyCount(self) -> dict[str, object]');
  await script(page, 'from intersect_api import Library, BookCopy\ncopy = BookCopy.find("earthsea")\nprint(copy.subtitle)\ncount = Library.find("Catalog").copyCount\nassert count == {"kind": "int64", "value": "1"}\nprint("Count:", int(count["value"]))');
  const completion = await page.evaluate(() => window.workbench.python.request('completion', 2, 11));
  expect(completion.items.some(i => i.label === 'subtitle')).toBe(true);
  expect(completion.items.some(i => i.label === 'title')).toBe(false);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  await expect(page.locator('#python-output')).toContainText('Count: 1');
});

test('exceptions, derived writes, invalid types and semantic errors roll back', async ({ page }) => {
  await ready(page);
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  for (const [text, message] of [
    ['from intersect_api import BookCopy\nBookCopy.find("earthsea").title = "Changed"\nraise ValueError("stop here")', 'stop here'],
    ['from intersect_api import BookCopy\nBookCopy.find("earthsea").available = False', 'has no setter'],
    ['from intersect_api import BookCopy\nBookCopy.find("earthsea").edition = "bad"', 'Invalid EInt'],
    ['from intersect_api import Loan, BookCopy, Member\nLoan(name="duplicate", copy=BookCopy.find("dune"), member=Member.find("ada"))', 'Semantic validation failed'],
    ['from intersect_api import Loan\nLoan(name="missing", copy=None, member=None)', 'Multiplicity violation'],
    ['from intersect_api import BookCopy\nBookCopy.find("earthsea").title = "Uncommitted"\ntry:\n    print("x" * 65537)\nexcept OSError:\n    pass', 'output budget exceeded'],
  ]) {
    await script(page, text); await run(page);
    await expect(page.locator('#python-error')).not.toBeEmpty({ timeout: 60000 });
    await expect(page.locator('#python-error')).toContainText(message);
    expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
  }
});

test('a new Python transaction replaces stale success before model admission', async ({ page }) => {
  await ready(page);
  const text = title => `from intersect_api import BookCopy\nBookCopy.find("earthsea").title = "${title}"\nprint("${title}")`;
  await script(page, text('First run')); await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  expect(before.elements.find(e => e.values.name === 'earthsea').values.title).toBe('First run');
  await script(page, text('Second run'));
  // Delay only the host snapshot request. Real Rust/Python execution resumes unchanged.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      if (message?.method === 'intersect/transactionBegin') {
        window.releasePythonSnapshot = () => {
          Worker.prototype.postMessage = post;
          post.call(this, message, ...args);
          delete window.releasePythonSnapshot;
        };
        return;
      }
      return post.call(this, message, ...args);
    };
  });
  await run(page);
  await expect.poll(() => page.evaluate(() => typeof window.releasePythonSnapshot)).toBe('function');
  await expect(page.locator('#python-status')).toContainText('Starting Python');
  await expect(page.locator('#python-status')).not.toContainText('Committed');
  await expect(page.locator('#python-run')).toBeDisabled();
  await expect(page.locator('#python-output')).toBeEmpty();
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
  await page.evaluate(() => window.releasePythonSnapshot());
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  await expect(page.locator('#python-output')).toContainText('Second run');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model.elements.find(e => e.values.name === 'earthsea').values.title).toBe('Second run');
});

test('cancellation, model conflicts, stale revisions, and rebind', async ({ page }) => {
  await ready(page);
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  const loop = 'from intersect_api import BookCopy\nBookCopy.find("earthsea").title = "Uncommitted"\nprint("staged")\nwhile True: pass';
  await script(page, loop); await run(page);
  await expect(page.locator('#python-output')).toContainText('staged', { timeout: 60000 });
  await page.locator('#python-cancel').click();
  await expect(page.locator('#python-error')).toContainText('Cancelled');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
  await script(page, 'import time\nfrom intersect_api import BookCopy\nBookCopy.find("earthsea").title = "Uncommitted"\nprint("staged")\ntime.sleep(2)');
  await run(page); await expect(page.locator('#python-output')).toContainText('staged', { timeout: 60000 });
  await page.evaluate(() => { const m = window.workbench.modelModels.catalog; m.setValue(m.getValue() + '\n'); });
  await expect(page.locator('#python-error')).toContainText('Stale transaction', { timeout: 10000 });
  await page.getByRole('tab', { name: 'Define', exact: true }).click();
  await page.getByRole('button', { name: /^Compile/ }).click();
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await expect(page.locator('#python-binding')).toContainText('STALE');
  await expect(page.locator('#python-run')).toBeDisabled();
  await page.locator('#python-bind').click();
  await expect(page.locator('#python-status')).toContainText('Python ready');
  await script(page, 'from intersect_api import BookCopy\nprint(BookCopy.find("earthsea").available)');
  await run(page); await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
});


test('generic package Python names preserve runtime identity and checked edits', async ({ page }) => {
  await ready(page);
  const compilation = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/language-bundle-canonical.json', import.meta.url), 'utf8'));
  const result = await page.evaluate(compilation => window.workbench.compileBundle(compilation), compilation);
  expect(result.ok).toBe(true);
  await page.evaluate(() => {
    window.workbench.modelModels.catalog.setValue('root { value v; }');
    window.workbench.modelModels.loans.setValue('root { box v; }');
  });
  await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
  await expect.poll(() => page.evaluate(() => window.workbench.python.api?.stub)).toContain('class ValueBox(Box)');
  await page.locator('#python-bind').click();
  await expect(page.locator('#python-status')).toContainText('Python ready');
  await script(page, `from intersect_api import Box, Value, ValueBox, Root, model
v = Value.find("v")
child = ValueBox.all()[0]
assert isinstance(child, Box)
assert child.value.handle == v.handle
root = next(r for r in Root.all() if r.values)
created = model.create(Value, name="new")
root.values = (*root.values, created)
child.value = created
assert root.valueCount == 2
assert model.find(Value, name="new").handle == created.handle
direct = model.create(Box, value=v)
assert isinstance(direct, Box)
assert direct.value.handle == v.handle
print("generic typed API verified")`);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  await expect(page.locator('#python-output')).toContainText('generic typed API verified');
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  expect(before.elements.some(e => e.type_identity.startsWith('intersect:generic:1:'))).toBe(true);
  await script(page, 'from intersect_api import Box, Root\nBox.all()[0].value = Root.all()[0]');
  await run(page);
  await expect(page.locator('#python-status')).toContainText('changes rolled back', { timeout: 60000 });
  await expect(page.locator('#python-error')).toContainText('Reference type mismatch');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
});

test('same-name instantiated Python classes have separate stable bindings', () => {
  const cls = { parents: [], features: {} };
  const pkg = { schema: { uri: 'urn:generic', classes: { __type_a: cls, __type_b: cls }, declarations: { __type_a: { name: 'Box' }, __type_b: { name: 'Box' } } }, semantics: { derived: [] } };
  const api = generatePythonApi(pkg, 'test');
  expect(api.classNames.__type_a).not.toBe(api.classNames.__type_b);
  expect(api.source).toContain('_class_key = "__type_a"');
  expect(api.source).toContain('_class_key = "__type_b"');
  const reordered = structuredClone(pkg); reordered.schema.classes = { __type_b: cls, __type_a: cls };
  expect(generatePythonApi(reordered, 'test').classNames).toEqual(api.classNames);
});


test('generated state and collection methods reject inherited name collisions', () => {
  const field = name => ({name, target:'EString', upper:1, lower:0, default:null});
  for(const collision of ['is_set_value','unset_value','clear_value']) {
    const pkg={schema:{uri:'urn:collision',classes:{Base:{parents:[],features:{value:field('value')}},Child:{parents:['Base'],features:{[collision]:field(collision)}}}},semantics:{derived:[]}};
    expect(()=>generatePythonApi(pkg,'test')).toThrow('Python feature method collision');
  }
});

test('Python state and collection methods use Rust semantics and preserve failed transactions', async ({page}) => {
  await ready(page);
  await page.evaluate(async()=>{
    const w=window.workbench;
    const fields = 'attr note: String [0,1] unsettable default "seed"; attr tags: String [0,3] readonly unsettable volatile transient;';
    const model=w.definitionModels.rcore;
    model.setValue(model.getValue().replace('attr available:',fields+'\nattr available:'));
    await w.compile();
  });
  await expect(page.locator('#active-revision')).toContainText('REV 2');
  await expect.poll(()=>page.evaluate(()=>window.workbench.python.api.stub)).toContain('def unset_note(self) -> None');
  await page.locator('#python-bind').click();
  await expect(page.locator('#python-status')).toContainText('Python ready');
  const stub=await page.evaluate(()=>window.workbench.python.api.stub);
  expect(stub).toContain('def note(self) -> str | None');
  expect(stub).toContain('def insert_tags(self, index: int, value: str) -> bool');
  expect(stub).not.toContain('def unset_available(');
  await script(page, `from intersect_api import BookCopy, Library, model
c = BookCopy.find("earthsea")
assert not c.is_set_note()
c.note = "seed"
assert c.is_set_note()
c.clear_note()
assert c.note is None and c.is_set_note()
c.unset_note()
assert c.note == "seed" and not c.is_set_note()
assert c.is_set_available()
assert not c.is_set_tags()
assert not c.clear_tags()
assert c.is_set_tags()
assert c.add_tags("a") and not c.add_tags("a")
assert c.add_tags("b")
assert c.insert_tags(1, "x")
assert c.replace_tags(2, "c")
assert c.move_tags(0, 2)
assert c.tags == ("x", "c", "a")
assert c.remove_at_tags(0) and c.remove_tags("c")
assert not c.remove_tags("missing")
assert c.tags == ("a",)
assert c.clear_tags() and c.add_tags("kept")
assert not Library.find("Catalog").add_copies(c)
assert len(model.transaction.changes) > 0
print("state operations verified")`);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed',{timeout:60000});
  await expect(page.locator('#python-output')).toContainText('state operations verified');
  const before=(await page.evaluate(()=>window.workbench.inspect())).evaluation.model;
  const copy=before.elements.find(e=>e.values.name==='earthsea');
  expect(copy.values.note).toBe('seed');expect(copy.values.tags).toEqual(['kept']);expect(copy.assignment_state.set_features).toEqual(['tags']);
  for(const [operation,error] of [['c.unset_tags()','non-changeable'],['c.insert_tags(-1, "invalid")','non-negative integer']]) {
    await script(page, `from intersect_api import BookCopy
c = BookCopy.find("earthsea")
c.note = "rollback"
${operation}`);
    await run(page);
    await expect(page.locator('#python-status')).toContainText('changes rolled back',{timeout:60000});
    await expect(page.locator('#python-error')).toContainText(error);
    expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before);
  }
});


test('declared computed setters share Rust state, reference handles and rollback', async ({page}) => {
  await ready(page);
  const definitions = Object.fromEntries(Object.entries({ecore:'settings.ecore',xtext:'settings.xtext',rcore_behavior:'settings-behavior.rcore'}).map(([kind,file]) => [kind, readFileSync(new URL(`../.runtime/intersect-text/fixtures/ecore-settings/${file}`, import.meta.url), 'utf8')]));
  await page.evaluate(async definitions => {
    const w = window.workbench;
    const migration = await w.request('intersect/migrateEcore', {uri:'memory:settings.ecore',text:definitions.ecore,target_uri:'memory:settings.rcore'});
    if (!migration.report.converted) throw new Error(JSON.stringify(migration.report.issues));
    definitions.rcore = migration.report.converted.text;
    delete definitions.ecore;
    for (const [kind,text] of Object.entries(definitions)) w.definitionModels[kind].setValue(text);
    w.modelModels.catalog.setValue('model Demo { item a item b }');
    w.modelModels.loans.setValue('model Other {}');
    await w.compile();
  }, definitions);
  await expect(page.locator('#active-revision')).toContainText('REV 2');
  await expect.poll(() => page.evaluate(() => window.workbench.python.api.stub)).toContain('def unset_aliasTitle');
  await page.locator('#python-bind').click();
  await expect(page.locator('#python-status')).toContainText('Python ready');
  const stub = await page.evaluate(() => window.workbench.python.api.stub);
  expect(stub).toContain('@aliasTitle.setter');
  expect(stub).not.toContain('@readonlyTitle.setter');
  expect(stub).toContain('def aliasPeer(self) -> Item | None');
  await script(page, `from intersect_api import Item
a = Item.find("a")
b = Item.find("b")
assert a.aliasTitle == "seed" and a.aliasPeer is None
assert not a.is_set_aliasTitle() and not a.is_set_aliasPeer()
a.aliasTitle = "seed"
assert a.is_set_aliasTitle() and not a.is_set_readonlyTitle()
a.aliasTags = ()
assert a.is_set_aliasTags()
a.aliasPeer = None
assert a.is_set_aliasPeer()
a.aliasTitle = "changed"
assert a.title == a.readonlyTitle == "changed" and a.is_set_title()
a.aliasTags = ("one", "two")
assert a.tags == a.aliasTags == ("one", "two")
a.aliasPeer = b
assert a.aliasPeer.handle == b.handle and a.peer.handle == b.handle
a.unset_aliasTitle()
a.unset_aliasTags()
a.unset_aliasPeer()
assert a.aliasTitle == "seed" and not a.is_set_title() and not a.is_set_aliasTitle()
assert a.aliasTags == () and not a.is_set_tags() and not a.is_set_aliasTags()
assert a.aliasPeer is None and not a.is_set_peer() and not a.is_set_aliasPeer()
a.aliasTitle = "published"
print("computed settings verified")`);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed', {timeout:60000});
  await expect(page.locator('#python-output')).toContainText('computed settings verified');
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  for (const failing of ['a.aliasTags = ("same", "same")', 'a.readonlyTitle = "forbidden"']) {
    await script(page, `from intersect_api import Item
a = Item.find("a")
a.aliasTitle = "rollback"
${failing}`);
    await run(page);
    await expect(page.locator('#python-status')).toContainText('changes rolled back', {timeout:60000});
    expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
  }
});


test('package constructors share text and Python initialization authority', async ({page}) => {
  await ready(page);
  const definitions = Object.fromEntries(Object.entries({ecore:'settings.ecore',xtext:'settings.xtext',rcore_behavior:'settings-behavior.rcore'}).map(([kind,file]) => [kind, readFileSync(new URL(`../.runtime/intersect-text/fixtures/ecore-settings/${file}`, import.meta.url), 'utf8')]));
  definitions.rcore_behavior += '\ninitialize m.Item using "intersect.constant-attributes" version "1" { title = "constructor"; tags = ["initial"]; }';
  await page.evaluate(async definitions => {
    const w = window.workbench;
    const migration = await w.request('intersect/migrateEcore', {uri:'memory:settings.ecore',text:definitions.ecore,target_uri:'memory:settings.rcore'});
    if (!migration.report.converted) throw new Error(JSON.stringify(migration.report.issues));
    definitions.rcore = migration.report.converted.text;
    delete definitions.ecore;
    for (const [kind,text] of Object.entries(definitions)) w.definitionModels[kind].setValue(text);
    w.modelModels.catalog.setValue('model Demo { item a }');
    w.modelModels.loans.setValue('model Other {}');
    await w.compile();
  }, definitions);
  await expect(page.locator('#active-revision')).toContainText('REV 2');
  await expect.poll(() => page.evaluate(() => window.workbench.python.api.stub)).toContain('class Item');
  await page.locator('#python-bind').click();
  await expect(page.locator('#python-status')).toContainText('Python ready');
  await script(page, `from intersect_api import Item, Model, model
a = Item.find("a")
assert a.title == "constructor" and a.tags == ("initial",)
assert a.is_set_title() and a.is_set_tags()
b = model.create(Item, name="b")
assert b.title == "constructor" and b.is_set_title()
c = model.create(Item, name="c", title="authored")
assert c.title == "authored"
root = Model.find("Demo")
root.items = (*root.items, b, c)
b.unset_title()
assert b.title == "seed" and not b.is_set_title()
print("constructors verified")`);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed', {timeout:60000});
  await expect(page.locator('#python-output')).toContainText('constructors verified');
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  for (const name of ['a', 'b', 'c']) {
    const object = before.elements.find(element => element.values.name === name);
    expect(object.initialization.object).toBe(object.id);
    expect(object.initialization.contract.provider).toEqual({name:'intersect.constant-attributes',version:'1'});
  }

  await script(page, `from intersect_api import Item, model
a = Item.find("a")
a.title = "rollback"
model.create(Item, name="bad", tags=("duplicate", "duplicate"))`);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('changes rolled back', {timeout:60000});
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
});


test('Python containment assignment displaces the old owner and rolls back failed transfers', async ({page}) => {
  await ready(page);
  await script(page, `from intersect_api import BookCopy, Library, model
copy = BookCopy.find("earthsea")
old = Library.find("Catalog")
branch = model.create(Library, name="Branch")
branch.copies = (copy,)
assert copy.library.handle == branch.handle
assert copy.handle not in [item.handle for item in old.copies]
assert copy.handle in [item.handle for item in branch.copies]
print("owner transferred")`);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed', {timeout:60000});
  await expect(page.locator('#python-output')).toContainText('owner transferred');
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  const copy = before.elements.find(e => e.values.name === 'earthsea');
  const branch = before.elements.find(e => e.values.name === 'Branch');
  const catalog = before.elements.find(e => e.values.name === 'Catalog');
  expect(copy.values.library).toBe(branch.id);
  expect(branch.values.copies).toContain(copy.id);
  expect(catalog.values.copies).not.toContain(copy.id);
  await script(page, `from intersect_api import BookCopy, Library
copy = BookCopy.find("earthsea")
old = Library.find("Catalog")
old.add_copies(copy)
assert copy.library.handle == old.handle
raise RuntimeError("reject transfer")`);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('changes rolled back', {timeout:60000});
  await expect(page.locator('#python-error')).toContainText('reject transfer');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
});


test('Python structural services delete subtrees, preserve identities and roll back', async ({page}) => {
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.workbench.python.api.stub)).toContain('def reparent(');
  await script(page, `from intersect_api import Library, Member, model
branch = Library(name="TemporaryBranch")
child = Member(name="TemporaryChild")
catalog = Library.find("Catalog")
assert model.reparent(child, catalog, "members", position=0)
assert model.reparent(child, branch, "members")
assert not model.reparent(child, branch, "members")
removed = model.delete(branch, subtree=True)
assert set(removed) == {branch.handle, child.handle}
replacement = Member(name="Replacement")
assert replacement.handle not in removed
assert model.reparent(replacement, catalog, "members")
print("structural services verified")`);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('Committed', {timeout:60000});
  await expect(page.locator('#python-output')).toContainText('structural services verified');
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  expect(before.elements.some(e => e.values.name === 'TemporaryChild')).toBe(false);
  expect(before.elements.some(e => e.values.name === 'Replacement')).toBe(true);
  await script(page, `from intersect_api import Member, model
obj = Member.find("Replacement")
assert model.reparent(obj)
model.delete(obj)
print(obj.name)`);
  await run(page);
  await expect(page.locator('#python-status')).toContainText('changes rolled back', {timeout:60000});
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
});
