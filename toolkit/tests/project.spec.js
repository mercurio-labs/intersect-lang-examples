import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function expectLibraryDiagram(page) {
  const classes = page.locator('.structure-class:not([data-enum])');
  await expect(classes).toHaveCount(5);
  expect(await classes.evaluateAll(cards => cards.map(card => card.dataset.class).sort()))
    .toEqual(['BookCopy', 'Library', 'Loan', 'Member', 'Named']);
  await expect(page.locator('.structure-class[data-enum]')).toHaveCount(1);
  const condition = page.locator('.structure-class[data-enum="BookCondition"]');
  await expect(condition).toBeVisible();
  await expect(condition.locator('[data-literal]')).toHaveCount(3);
  expect(await condition.locator('[data-literal]').evaluateAll(rows => rows.map(row => row.dataset.literal)))
    .toEqual(['GOOD', 'WORN', 'DAMAGED']);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 });
  await expectLibraryDiagram(page);
});

test('empty and sample projects replace all sources and runtime state from either activity', async ({ page }) => {
  test.setTimeout(90000);
  const sample = await page.evaluate(() => window.workbench.project.snapshot());
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 30000 });
  await page.evaluate(() => window.workbench.python.model.setValue('while True:\n    pass\n'));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-cancel')).toBeEnabled();
  await page.locator('.ide-file-menu > summary').click();
  await page.getByRole('button', { name: 'New Blank Project', exact: true }).click();
  await expect(page.locator('#project-status')).toContainText('New empty project');
  await expect(page.locator('[data-definition="xtext"]')).toBeDisabled();
  await expect(page.locator('.structure-class')).toHaveCount(1);
  await expect(page.locator('#element-count')).toHaveText('0 elements');
  const empty = await page.evaluate(() => window.workbench.project.snapshot());
  expect(empty.mode).toBe('structure'); expect(empty.definitions.rcore).toContain('class Element');
  expect(empty.definitions.xtext).toBe(''); expect(empty.definitions.rcore_behavior).toBe('');
  expect(Object.values(empty.models)).toEqual(['', '']); expect(empty.python).toBe('');
  expect((await page.evaluate(() => window.workbench.inspect())).package).toBeNull();
  await expect(page.locator('#python-output')).toBeEmpty();
  await expect(page.locator('#python-error')).toBeEmpty();
  await expect(page.locator('#transaction-count')).toContainText('0 runs');
  await page.locator('.ide-file-menu > summary').click();
  await page.getByRole('button', { name: 'New Library Project', exact: true }).click();
  await expect(page.locator('#project-status')).toContainText('New sample project');
  await expect(page.locator('[data-definition="xtext"]')).toBeEnabled();
  await expectLibraryDiagram(page);
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  const restored = await page.evaluate(() => window.workbench.project.snapshot());
  expect(restored.definitions).toEqual(sample.definitions);
  expect(restored.models).toEqual(sample.models); expect(restored.python).toEqual(sample.python);
  expect(restored.mode).toBe('language'); expect(restored.windows.documents).toHaveLength(4);
  await expect(page.locator('#python-enable')).toBeEnabled();
  await page.locator('.ide-file-menu > summary').click();
  await expect(page.getByRole('button', { name: /Reset/ })).toHaveCount(0);
});

test('enum sample displays literals, supports enum attributes and runs Python with exact defaults', async ({ page }) => {
  test.setTimeout(90000);
  await page.evaluate(async () => {
    const wb = window.workbench; const {enumSample} = await import('/src/enum-sample.js');
    wb.project.load({...wb.project.snapshot(), ...enumSample, profile:'default', structureSource:'rcore', mode:'structure', layout:{version:1,positions:{},zoom:1}});
    await wb.compile();
  });
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('[data-definition="xtext"]')).toBeDisabled();
  const card = page.locator('[data-enum="Status"]');
  await expect(card).toContainText('ENUM');
  await expect(card.locator('[data-literal]')).toHaveCount(3);
  await page.getByRole('treeitem', { name: 'v ACTIVE', exact: true }).click();
  await expect(page.locator('input[name="enum_value"]')).toHaveValue('7');
  await expect(page.locator('input[name="enum_literal"]')).toHaveValue('active');
  const source = await page.evaluate(() => window.workbench.definitionModels.ecore.getValue());
  await page.getByRole('treeitem', { name: 'C Item', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add attribute', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workbench.definitionModels.ecore.getValue())).toBe(source);
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-run')).toBeEnabled({ timeout: 30000 });
  await page.locator('#python-run').click();
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  await expect(page.locator('#model-properties')).toContainText('Status.ACTIVE');
  await expect(page.locator('#python-error')).toBeEmpty();
  const inspection = await page.evaluate(() => window.workbench.inspect());
  const status = inspection.evaluation.model.elements[0].values.status;
  expect(status.literal).toEqual(inspection.package.schema.enumerations.Status.literals[1].declaration);
  expect(inspection.package.schema.enumerations.Status.literals[0].value).toBe(7);
  await page.getByRole('tab', { name: 'Define', exact: true }).click();
  await page.getByRole('treeitem', { name: 'E Status', exact: true }).click();
  await page.screenshot({ path: 'test-results/enum-sample.png' });
});

test('project download and reopen preserves exact sources, Python and independent diagram layout', async ({ page }) => {
  const expected = await page.evaluate(() => {
    const wb = window.workbench;
    const layout = wb.structure.getLayout();
    layout.positions.Library = { x: 321, y: 123 }; layout.zoom = 0.8;
    wb.structure.setLayout(layout);
    wb.python.model.setValue('# saved fixture\nassert 1 + 1 == 2\n');
    const source = wb.definitionModels.rcore.getValue();
    wb.definitionModels.rcore.setValue('// retained project note: café\n' + source);
    return wb.project.snapshot();
  });
  const pending = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#save-project').click();
  const download = await pending;
  const bytes = await readFile(await download.path());
  expect(JSON.parse(bytes.toString())).toEqual(expected);
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#new-empty-project').click();
  await expect(page.locator('.structure-class')).toHaveCount(1);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#open-project').click();
  await (await chooser).setFiles({ name: 'saved.intersect.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.locator('#project-status')).toContainText('Project opened');
  await expectLibraryDiagram(page);
  expect(await page.evaluate(() => window.workbench.project.snapshot())).toEqual(expected);
  const ecoreDownload = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#save-rcore').click();
  expect((await readFile(await (await ecoreDownload).path())).toString()).toBe(expected.definitions.rcore);
});

test('explicit bundle migration preserves originals and compiles Rcore dependencies in WASM', async ({page}) => {
  const result = await page.evaluate(async () => {
    const source = async (uri, kind, text) => ({
      id:{uri, sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('')},
      kind,text,dependencies:[],
    });
    const value = await source('memory:value.rcore', 'rcore', 'rcore 1; package value version "1"; metamodel "urn:value" prefix v { class Value {} }');
    const holder = await source('memory:holder.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:t="http://www.w3.org/2001/XMLSchema-instance" name="holder" nsURI="urn:holder"><eClassifiers t:type="e:EClass" name="Holder"><eStructuralFeatures t:type="e:EReference" name="value" eType="memory:value.rcore#//Value"/></eClassifiers></e:EPackage>');
    holder.dependencies = [value.id];
    const bundle = {version:1,sources:[holder,value],namespaces:[]};
    const migrated = await window.workbench.request('intersect/migrateEcoreBundle', {bundle,targets:[{source:holder.id,uri:'memory:holder.rcore'}]});
    if (!migrated.ok) throw new Error(JSON.stringify(migrated));
    const converted = migrated.report.converted, model = converted.sources.find(s=>s.id.uri==='memory:holder.rcore');
    const compiled = await window.workbench.compileBundle({bundle:converted,ecore:model.id,namespace:'urn:holder',xtext:null,rcore_behavior:model.id,materialized_types:[]});
    return {bundle,migrated,compiled};
  });
  expect(result.migrated.report.original).toEqual(result.bundle);
  expect(result.compiled.ok).toBe(true);
  expect(result.compiled.package.grammar).toBeNull();
  const classes = result.compiled.package.schema.classes;
  const declarations = result.compiled.package.schema.declarations;
  expect(Object.keys(classes)).toHaveLength(2);
  const valueKey = Object.keys(classes).find(key=>declarations[key].name==='Value');
  expect(declarations[valueKey].source).toEqual(result.bundle.sources.find(s=>s.id.uri==='memory:value.rcore').id);
  expect(classes.Holder.features.value.target).toBe(valueKey);
  expect(result.compiled.package.compilation.bundle.sources.every(s=>s.kind==='rcore')).toBe(true);
});

test('explicit compilation migration carries generic selections into canonical WASM compilation', async ({page}) => {
  const original = JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-generics/language-bundle.json', import.meta.url), 'utf8'));
  const canonical = JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-generics/language-bundle-canonical.json', import.meta.url), 'utf8'));
  const behavior = structuredClone(canonical.bundle.sources.find(s=>s.kind==='rcore_behavior'));
  behavior.dependencies = [original.ecore];
  original.bundle.sources = original.bundle.sources.map(s=>s.kind==='rcore_behavior' ? behavior : s);
  original.rcore_behavior = behavior.id;
  const result = await page.evaluate(async compilation => {
    const request = (method, params) => window.workbench.request(method, params);
    const migrated = await request('intersect/migrateEcoreCompilation', {compilation,targets:[{source:compilation.ecore,uri:'memory:generic.rcore'}]});
    if (!migrated.ok) throw new Error(JSON.stringify(migrated));
    const compiled = await request('intersect/compileBundle', {compilation:migrated.compilation});
    return {migrated,compiled};
  }, original);
  expect(result.migrated.report.original).toEqual(original.bundle);
  expect(result.migrated.compilation.ecore).not.toEqual(original.ecore);
  expect(result.migrated.compilation.materialized_types).toHaveLength(original.materialized_types.length);
  expect(result.migrated.compilation.bundle.sources.some(s=>s.kind==='ecore')).toBe(false);
  expect(result.compiled.ok).toBe(true);
  expect(result.compiled.package.semantics.derived).toHaveLength(1);
});

test('invalid project is rejected atomically and invalid source drafts can be reopened', async ({ page }) => {
  const original = await page.evaluate(() => window.workbench.project.snapshot());
  expect(original.format).toBe('intersect.toolkit.project.v2');
  const rejected = await page.evaluate(() => {
    const wb = window.workbench, original = wb.project.snapshot();
    const drafts = [
      {...original, format:'intersect.toolkit.project.v1'},
      {...original, structureSource:'ecore'},
      {...original, compilerProfile:undefined},
      {...original, definitions:{...original.definitions, rcore:undefined}},
    ];
    return drafts.map(draft => {
      try { wb.project.load(draft); return false; }
      catch { return JSON.stringify(wb.project.snapshot()) === JSON.stringify(original); }
    });
  });
  expect(rejected).toEqual([true,true,true,true]);
  const invalid = structuredClone(original);
  invalid.definitions.ecore = 'overwritten'; invalid.layout.positions.Library.x = -1;
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#open-project').click();
  await (await chooser).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.locator('#project-status')).toContainText('Invalid diagram position');
  expect(await page.evaluate(() => window.workbench.project.snapshot())).toEqual(original);
  const draft = structuredClone(original); draft.definitions.rcore = 'rcore 1; unfinished';
  await page.evaluate(value => window.workbench.project.load(value), draft);
  await expect(page.locator('.structure-message')).toContainText('Rcore draft cannot be drawn');
  expect(await page.evaluate(() => window.workbench.definitionModels.rcore.getValue())).toBe('rcore 1; unfinished');
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toHaveText('Definition compilation failed');
  expect((await page.evaluate(() => window.workbench.inspect())).revision).toBe(1);
});

test('new Rcore project compiles without a grammar and source edits share undo/redo', async ({ page }) => {
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#new-empty-project').click();
  await expect(page.locator('.structure-class')).toHaveCount(1);
  await expect(page.locator('.structure-message')).not.toContainText('At least one EClass is required');
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const state = await page.evaluate(() => window.workbench.inspect());
  expect(state.package.grammar).toBeNull(); expect(state.evaluation.model.elements).toEqual([]);
  expect(Object.keys(state.package.schema.classes)).toEqual(['Element']);
  await page.evaluate(() => {
    const model = window.workbench.definitionModels.rcore;
    model.pushEditOperations([], [{ range:model.getFullModelRange(), text:model.getValue().replace('class Element {}', 'class Element {}\n  class Book {}') }], () => null);
  });
  await expect(page.locator('.structure-class')).toHaveCount(2);
  await page.locator('#definition-undo').click();
  await expect(page.locator('.structure-class')).toHaveCount(1);
  await page.locator('#definition-redo').click();
  await expect(page.locator('.structure-class')).toHaveCount(2);
});

test('Rcore open/save preserves CRLF; unsupported BOM and mixed endings are rejected atomically', async ({ page }) => {
  const source = (await page.evaluate(() => window.workbench.definitionModels.rcore.getValue())).replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
  const chooser = page.waitForEvent('filechooser'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#open-rcore').click();
  await (await chooser).setFiles({ name: 'windows.rcore', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.locator('#project-status')).toContainText('Rcore opened');
  expect(await page.evaluate(() => window.workbench.definitionModels.rcore.getValue())).toBe(source);
  const pending = page.waitForEvent('download'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#save-rcore').click();
  expect(await readFile(await (await pending).path())).toEqual(Buffer.from(source));
  // Import refreshes the diagram asynchronously; compare stable layout state.
  await expect.poll(() => page.evaluate(() => Object.keys(window.workbench.structure.getLayout().positions).sort()))
    .toEqual(['BookCondition', 'BookCopy', 'Library', 'Loan', 'Member', 'Named']);
  const original = await page.evaluate(() => window.workbench.project.snapshot());
  const bomChooser = page.waitForEvent('filechooser'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#open-rcore').click();
  await (await bomChooser).setFiles({ name:'bom.rcore', mimeType:'text/plain', buffer:Buffer.from('\ufeff' + source) });
  await expect(page.locator('#project-status')).toContainText('Unexpected character');
  expect(await page.evaluate(() => window.workbench.project.snapshot())).toEqual(original);
  const mixed = source.replace('\r\n', '\n');
  const badChooser = page.waitForEvent('filechooser'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#open-rcore').click();
  await (await badChooser).setFiles({ name: 'mixed.rcore', mimeType: 'text/plain', buffer: Buffer.from(mixed) });
  await expect(page.locator('#project-status')).toContainText('Mixed or standalone CR');
  expect(await page.evaluate(() => window.workbench.project.snapshot())).toEqual(original);
});

test('opening a file cannot overwrite newer diagram layout changes', async ({ page }) => {
  const project = await page.evaluate(() => window.workbench.project.snapshot());
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await read.call(this);
      await new Promise(resolve => { window.finishProjectRead = resolve; });
      return bytes;
    };
  });
  const chooser = page.waitForEvent('filechooser'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#open-project').click();
  await (await chooser).setFiles({ name: 'delayed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => typeof window.finishProjectRead === 'function');
  await page.evaluate(() => {
    const layout = window.workbench.structure.getLayout();
    layout.positions.Library.x += 70;
    window.workbench.structure.setLayout(layout);
    window.finishProjectRead();
  });
  await expect(page.locator('#project-status')).toContainText('project changed');
  expect((await page.evaluate(() => window.workbench.structure.getLayout())).positions.Library.x).toBe(project.layout.positions.Library.x + 70);
});
