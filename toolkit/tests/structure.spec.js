import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 });
  await expect(page.locator('.structure-class[data-class="Library"]')).toBeVisible();
});

test('KerML operations appear in the diagram and containment with preserved declaration metadata', async ({ page }) => {
  await page.locator('#example').selectOption('rcore',{force:true});
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 60000 });
  const operation = page.locator('.structure-class[data-class="Type"] [data-operation="0"]');
  await expect(operation).toContainText('allGenerals(');
  await expect(page.locator('.structure-message')).not.toContainText('eOperations');
  const before = await page.evaluate(() => window.workbench.definitionModels.rcore.getValue());
  await operation.click();
  await expect(page.locator('.structure-properties')).toContainText('Execution requires a supported semantic binding');
  await expect(page.locator('.structure-operation-metadata')).toContainText('declaration');
  await expect(page.locator('.structure-operation-metadata')).not.toContainText('eOperations');
  await expect(page.getByRole('treeitem').filter({ hasText: 'allGenerals(' })).toHaveCount(1);
  expect(await page.evaluate(() => window.workbench.definitionModels.rcore.getValue())).toBe(before);
});

test('copy diagram writes a PNG of the full arrangement without changing source or layout', async ({ page }) => {
  const before = await page.evaluate(() => {
    const wb = window.workbench;
    const layout = wb.structure.getLayout();
    layout.positions.BookCopy = { x: 1300, y: 800 }; layout.zoom = 0.5;
    wb.structure.setLayout(layout);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async items => {
        const blob = await items[0].getType('image/png');
        window.copiedDiagram = { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
      },
    } });
    return { source: wb.definitionModels.ecore.getValue(), layout: wb.structure.getLayout() };
  });
  await page.getByRole('button', { name: 'Copy diagram', exact: true }).click();
  await expect(page.locator('.structure-message')).toContainText('Diagram copied to clipboard as PNG');
  const copied = await page.evaluate(async () => {
    const copy = window.copiedDiagram;
    const image = await createImageBitmap(new Blob([new Uint8Array(copy.bytes)], { type: copy.type }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
    const result = { ...copy, width: image.width, height: image.height, background: pixel(0, 0), offscreenCard: pixel(2620, 1620) };
    image.close(); return result;
  });
  expect(copied.type).toBe('image/png');
  expect(copied.bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(copied.width).toBe(3268);
  expect(copied.height).toBeGreaterThan(1900);
  expect(copied.offscreenCard).not.toEqual(copied.background);
  await writeFile('test-results/copied-diagram.png', Buffer.from(copied.bytes));
  expect(await page.evaluate(() => ({ source: window.workbench.definitionModels.ecore.getValue(), layout: window.workbench.structure.getLayout() }))).toEqual(before);
});

test('copy reports blocked clipboard access and disables stale diagrams', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    write: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
  } }));
  await page.getByRole('button', { name: 'Copy diagram', exact: true }).click();
  await expect(page.locator('.structure-message')).toContainText('Clipboard access was blocked');
  await expect(page.getByRole('button', { name: 'Copy diagram', exact: true })).toBeEnabled();
  await page.evaluate(() => window.workbench.definitionModels.rcore.setValue('rcore 1; unfinished'));
  await expect(page.getByRole('button', { name: 'Copy diagram', exact: true })).toBeDisabled();
});

test('Rcore edits generate inherited attributes and containment relationships; source undo preserves identity', async ({ page }) => {
  const original = await page.evaluate(() => window.workbench.definitionModels.rcore.getValue());
  await page.evaluate(() => {
    const model = window.workbench.definitionModels.rcore;
    const source = model.getValue().replace('  class Loan extends Named {', '  class Book extends Named { attr title: String [1, 1]; ref copies: BookCopy [0, *] containment; }\n  class Loan extends Named {');
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: source }], () => null);
  });
  const book = page.locator('.structure-class[data-class="Book"]');
  await expect(book).toContainText('title: EString');
  await expect(book.locator('[data-feature="title"]')).toContainText('1..1');
  await expect(page.locator('.structure-inheritance title').filter({ hasText: 'Book extends → Named' })).toHaveCount(1);
  await expect(page.locator('.structure-reference title').filter({ hasText: 'Book copies → BookCopy [0..*] (containment)' })).toHaveCount(1);
  await page.getByRole('treeitem', { name: 'C Book', exact: true }).click();
  await expect(page.locator('.structure-properties input[name="name"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.workbench.definitionModels.rcore.undo());
  await expect(book).toHaveCount(0);
  expect(await page.evaluate(() => window.workbench.definitionModels.rcore.getValue())).toBe(original);
});

test('Ecore definition API retains enum authoring, aliases, references and validation outside the XML-free UI', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const wb = window.workbench;
    let source = (await import('/src/project.js')).emptyEcore;
    const edit = async edit => { const result = await wb.request('intersect/definitionEdit', {source, edit}); source = result.source; return result; };
    await edit({op:'add_enum',name:'Status'});
    await edit({op:'add_literal',enumeration:'Status',name:'DRAFT',value:-7,literal:null});
    await edit({op:'add_literal',enumeration:'Status',name:'ACTIVE',value:-7,literal:'active'});
    const before = source;
    let duplicate;
    try { await edit({op:'set_literal',enumeration:'Status',literal:'ACTIVE',spelling:'DRAFT'}); }
    catch (error) { duplicate = error.message; }
    // The edit API uses the literal field for the selected declaration and
    // the spelling field for its new serialized representation.
    await edit({op:'add_attribute',class:'Element',name:'status',type:'Status'});
    await edit({op:'set_enum',enumeration:'Status',name:'State'});
    const renamed = source;
    let referenced;
    try { await edit({op:'delete_enum',enumeration:'State'}); } catch (error) { referenced = error.message; }
    const inspected = await wb.request('intersect/definitionInspect', {source});
    await edit({op:'delete_literal',enumeration:'State',literal:'ACTIVE'});
    return {before, duplicate, renamed, referenced, inspected, final:source};
  });
  expect(result.duplicate).toContain('Duplicate enum literal spelling');
  expect(result.renamed).toContain('name="State"');
  expect(result.renamed).toContain('#//State');
  expect(result.referenced).toContain('still references');
  expect(result.final).not.toContain('name="ACTIVE"');
  expect(result.final).toContain('name="DRAFT"');
});

test('diagram arrangement is independent of Ecore source and survives refresh and layout restore', async ({ page }) => {
  const original = await page.evaluate(() => ({ source: window.workbench.definitionModels.ecore.getValue(), layout: window.workbench.structure.getLayout() }));
  const title = page.locator('.structure-class[data-class="Library"] .structure-class-title');
  await title.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  const moved = await page.evaluate(() => ({ source: window.workbench.definitionModels.ecore.getValue(), layout: window.workbench.structure.getLayout() }));
  expect(moved.source).toBe(original.source);
  expect(moved.layout.positions.Library).toEqual({ x: original.layout.positions.Library.x + 10, y: original.layout.positions.Library.y + 30 });
  await page.evaluate(() => window.workbench.structure.refresh());
  expect(await page.evaluate(() => window.workbench.structure.getLayout())).toEqual(moved.layout);
  await page.getByRole('button', { name: 'Auto-layout', exact: true }).click();
  expect(await page.evaluate(() => window.workbench.structure.getLayout())).toEqual(original.layout);
  await page.evaluate(layout => window.workbench.structure.setLayout(layout), moved.layout);
  expect(await page.evaluate(() => window.workbench.structure.getLayout())).toEqual(moved.layout);
  await title.scrollIntoViewIfNeeded();
  const bounds = await title.boundingBox();
  await page.mouse.move(bounds.x + 40, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 40, { steps: 8 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => ({ source: window.workbench.definitionModels.ecore.getValue(), layout: window.workbench.structure.getLayout() }));
  expect(dragged.source).toBe(original.source);
  expect(dragged.layout.positions.Library.x).toBe(moved.layout.positions.Library.x + 50);
  expect(dragged.layout.positions.Library.y).toBe(moved.layout.positions.Library.y + 20);
});

test('invalid Rcore retains the previous diagram, disables stale copying, and recovers', async ({ page }) => {
  const source = await page.evaluate(() => window.workbench.definitionModels.rcore.getValue());
  await page.evaluate(() => window.workbench.definitionModels.rcore.setValue('rcore 1; unfinished'));
  await expect(page.locator('.structure-message')).toContainText('Rcore draft cannot be drawn');
  await expect(page.locator('.structure-message')).toContainText('last readable definition');
  await expect(page.getByRole('button', { name: 'Copy diagram', exact: true })).toBeDisabled();
  await expect(page.locator('.structure-class[data-class="Library"]')).toBeVisible();
  await page.evaluate(value => window.workbench.definitionModels.rcore.setValue(value), source);
  await expect(page.getByRole('button', { name: 'Copy diagram', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a delayed definition edit cannot overwrite newer source typing', async ({ page }) => {
  await page.evaluate(async () => {
    const { createStructurePane } = await import('/src/structure-pane.js');
    const host = document.createElement('section'); host.id = 'delayed-structure'; document.body.append(host);
    const model = window.workbench.definitionModels.ecore;
    window.delayedStructure = createStructurePane({ host, model, request: async (method, params) => {
      const result = await window.workbench.request(method, params);
      if (method === 'intersect/definitionEdit') await new Promise(resolve => { window.releaseDefinitionEdit = resolve; });
      return result;
    } });
    await window.delayedStructure.refresh();
  });
  const pane = page.locator('#delayed-structure');
  await pane.getByRole('button', { name: 'Add class', exact: true }).click();
  await pane.getByLabel('Name', { exact: true }).fill('StaleClass');
  await pane.getByRole('button', { name: 'Create class', exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseDefinitionEdit === 'function');
  const newer = await page.evaluate(() => {
    const model = window.workbench.definitionModels.ecore;
    const source = model.getValue().replace('name="library"', 'name="newerLibrary"');
    model.setValue(source); window.releaseDefinitionEdit(); return source;
  });
  await expect(pane.locator('.structure-message')).toContainText('newer source was kept');
  expect(await page.evaluate(() => window.workbench.definitionModels.ecore.getValue())).toBe(newer);
  await expect(pane.locator('.structure-class[data-class="StaleClass"]')).toHaveCount(0);
  await page.evaluate(() => { window.delayedStructure.destroy(); document.getElementById('delayed-structure').remove(); });
});


test('Library starter displays its Rcore enum and applies the typed BookCopy default', async ({ page }) => {
  const enumeration = page.locator('.structure-class[data-enum="BookCondition"]');
  await expect(enumeration).toContainText('GOOD');
  await expect(enumeration).toContainText('WORN');
  await expect(enumeration).toContainText('DAMAGED');
  await expect(page.locator('.structure-class[data-class="BookCopy"] [data-feature="condition"]')).toContainText('BookCondition');
  await page.getByRole('treeitem', { name: 'E BookCondition', exact: true }).click();
  await expect(page.locator('input[name="enum_default"]')).toHaveValue('GOOD');
  const state = await page.evaluate(() => window.workbench.inspect());
  const definition = state.package.schema.enumerations.BookCondition;
  expect(definition.literals.map(literal => literal.name)).toEqual(['GOOD', 'WORN', 'DAMAGED']);
  const copies = state.evaluation.model.elements.filter(element => element.class === 'BookCopy');
  expect(copies.length).toBeGreaterThan(0);
  for (const copy of copies) {
    expect(copy.values.condition).toEqual({ kind: 'enum', enumeration: definition.declaration, literal: definition.literals[0].declaration });
  }
});

test('Library typed Rcore providers activate and reject unsupported edits without losing the model', async ({ page }) => {
  const source = await page.evaluate(() => window.workbench.definitionModels.rcore.getValue());
  expect(source).toContain('pub derive lib.Library.copyCount');
  expect(source).toContain('pub validate lib.Loan.singleLoan');
  expect(source).not.toContain('behavior legacy');
  const state = await page.evaluate(() => window.workbench.inspect());
  const root = state.evaluation.model.elements.find(e => e.class === 'Library' && e.values.name === 'Catalog');
  expect(state.package.schema.classes.Library.features.copyCount.target).toBe('ELong');
  expect(state.evaluation.derived[root.id].copyCount).toEqual({ kind: 'int64', value: '2' });
  const copies = state.evaluation.model.elements.filter(e => e.class === 'BookCopy');
  expect(state.evaluation.derived[copies.find(e => e.values.name === 'dune').id].available).toBe(false);
  expect(state.evaluation.derived[copies.find(e => e.values.name === 'earthsea').id].available).toBe(true);
  await page.evaluate(text => window.workbench.definitionModels.rcore.setValue(text), source.replace('size(self.copies)', '1 + size(self.copies)'));
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Definition compilation failed');
  await page.getByRole('tab', { name: /Problems/ }).click();
  await expect(page.locator('#diagnostic-list')).toContainText('Derivation requires a supported builtin or a direct external call');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.derived).toEqual(state.evaluation.derived);
  await page.evaluate(text => window.workbench.definitionModels.rcore.setValue(text), source);
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
});
