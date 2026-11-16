import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const structure = await readFile(new URL('../.runtime/intersect-text/fixtures/rcore/bindings/external-project.rcore', import.meta.url), 'utf8');
const implementation = await readFile(new URL('../.runtime/intersect-text/fixtures/rcore/bindings/external.rhai', import.meta.url), 'utf8');
const libraryImplementation = await readFile(new URL('../.runtime/intersect-text/fixtures/library/library-implementations.rhai', import.meta.url), 'utf8');
async function edit(page, label, text) {
  await page.getByRole('textbox', { name: label, exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(text);
}
async function createStub(page) {
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#create-stub').click();
}
async function open(page) {
  await page.goto('/'); await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:30000});
  await page.locator('#rcore-file').setInputFiles({ name:'external.rcore',mimeType:'text/plain',buffer:Buffer.from(structure) });
  await expect(page.locator('#project-status')).toContainText('Rcore opened');
  await createStub(page); await expect(page.locator('#rhai-file')).toBeVisible();
  await expect(page.locator('#rhai-status')).toContainText('2 stub(s) created');
}
async function compile(page) {
  await page.locator('#compile').click(); await expect(page.locator('#rhai-status')).toContainText('Compiled.', {timeout:30000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:30000});
}
async function run(page, value) {
  await page.locator('#rhai-arguments').fill('["21"]'); await page.locator('#rhai-run').click();
  await expect(page.locator('#rhai-status')).toContainText('Completed with rhai');
  expect(JSON.parse(await page.locator('#rhai-result').textContent()).data.Scalar.payload.value).toBe(value);
}
async function exportedModel(page) {
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  const download = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export').click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}

test('Rhai property completion uses generated inherited types and actual parameter names', async ({page}) => {
  test.setTimeout(60000);
  await page.goto('/?example=library-implementations');
  await expect(page.locator('#rhai-status')).toContainText('Compiled.', {timeout:30000});
  await edit(page, 'Rhai source', 'fn overdueFee(daysLate) { daysLate * 25 }\nfn copyLabel(renamed) {\n  renamed.\n}');
  await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('End');
  await page.keyboard.press('Control+Space');
  const suggestions = page.locator('#rhai-file .suggest-widget.visible');
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText('name');
  await expect(suggestions).toContainText('edition');
  await page.keyboard.type('ed');
  await expect(suggestions).toContainText('Int32? (read-only)');
  await page.keyboard.press('Enter');
  await page.locator('#rhai-file .view-line').filter({hasText:'renamed.edition'}).getByText('edition', {exact:true}).hover();
  const hover = page.locator('#rhai-file .monaco-hover:visible');
  await expect(hover).toContainText('BookCopy.edition');
  await expect(hover).toContainText('An absent value returns');
  const download = page.waitForEvent('download'); await page.locator('#save-rhai').click();
  expect(await readFile(await (await download).path(), 'utf8')).toContain('renamed.edition');
  await edit(page, 'Rhai source', libraryImplementation);
  await compile(page);
  // Opening a different schema regenerates editor metadata before implementations
  // are compiled, so properties from the previous project do not leak.
  await page.locator('#rcore-file').setInputFiles({name:'external.rcore',mimeType:'text/plain',buffer:Buffer.from(structure)});
  await expect(page.locator('#project-status')).toContainText('Rcore opened');
  await createStub(page); await expect(page.locator('#rhai-status')).toContainText('2 stub(s) created');
  await edit(page, 'Rhai source', 'fn twice(value) { value * 2 }\nfn doubled(renamed) {\n  renamed.\n}');
  await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('End');
  await page.keyboard.press('Control+Space');
  await expect(suggestions).toBeVisible(); await expect(suggestions).toContainText('value');
  await expect(suggestions).not.toContainText('edition');
});

test('Library w/ Implementations loads working scripts, reads live models and survives project reload', async ({page}) => {
  test.setTimeout(60000);
  await page.goto('/'); await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:30000});
  await page.locator('#example').selectOption({label:'Library w/ Implementations'});
  await expect(page.locator('#rhai-file')).toBeVisible();
  await expect(page.locator('#rhai-status')).toContainText('Compiled.', {timeout:30000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:30000});
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await page.locator('#rhai-run').click();
  await expect(page.locator('#rhai-status')).toContainText('Completed with rhai');
  expect(JSON.parse(await page.locator('#rhai-result').textContent()).data.Scalar.payload.value).toBe('100');
  const projectDownload = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#save-project').click();
  const projectPath = await (await projectDownload).path();
  const saved = JSON.parse(await readFile(projectPath, 'utf8'));
  expect(saved.profile).toBe('library-implementations');
  expect(saved.definitions.rcore).toContain('extern fn copyLabel');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  const modelDownload = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export').click();
  const inspected = JSON.parse(await readFile(await (await modelDownload).path(), 'utf8'));
  const copy = inspected.model.elements.find(e => e.values.name === 'earthsea');
  const loan = inspected.model.elements.find(e => e.values.name === 'first');
  expect(inspected.derived[copy.id].copyLabel).toBe('earthsea (edition 2)');
  expect(inspected.derived[loan.id].overdueFee).toEqual({kind:'int64',value:'100'});
  expect(loan.values.overdueFee).toBeUndefined();
  await page.getByRole('tab',{name:'Define',exact:true}).click();
  await page.locator('#rhai-function').selectOption({label:'copyLabel'});
  await page.locator('#rhai-arguments').fill(JSON.stringify([copy.id]));
  await page.locator('#rhai-run').click();
  await expect(page.locator('#rhai-status')).toContainText('Completed with rhai');
  expect(JSON.parse(await page.locator('#rhai-result').textContent()).data.Scalar.payload).toBe('earthsea (edition 2)');
  await edit(page, 'Rhai source', saved.bindings.source.replace('daysLate * 25', 'daysLate * 50'));
  await compile(page);
  await page.locator('#rhai-function').selectOption({label:'overdueFee'});
  await page.locator('#rhai-arguments').fill('["4"]'); await page.locator('#rhai-run').click();
  await expect(page.locator('#rhai-status')).toContainText('Completed with rhai');
  expect(JSON.parse(await page.locator('#rhai-result').textContent()).data.Scalar.payload.value).toBe('200');
  const repriced = await exportedModel(page);
  expect(repriced.derived[loan.id].overdueFee.value).toBe('200');
  await page.getByRole('tab',{name:'Define',exact:true}).click();
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:30000});
  await expect(page.locator('[data-ecore-view="rhai"]')).toBeHidden();
  await expect(page.locator('#rhai-file')).toBeHidden();
  await page.locator('#project-file').setInputFiles(projectPath);
  await expect(page.locator('#project-status')).toContainText('Project opened');
  await expect(page.locator('#example')).toHaveValue('library-implementations');
  await page.locator('[data-ecore-view="rhai"]').click(); await compile(page);
  const rhaiDownload = page.waitForEvent('download'); await page.locator('#save-rhai').click();
  expect(await readFile(await (await rhaiDownload).path(), 'utf8')).toBe(saved.bindings.source);
  await page.locator('#rhai-run').click(); await expect(page.locator('#rhai-status')).toContainText('Completed with rhai');
  expect(JSON.parse(await page.locator('#rhai-result').textContent()).data.Scalar.payload.value).toBe('100');
});

test('Library external derived properties recompute through Python and publish to the inspector', async ({page}) => {
  test.setTimeout(90000);
  await page.goto('/?example=library-implementations');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:30000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  const tree = page.getByRole('tree', {name:'Model containment tree'});
  const properties = page.getByRole('region', {name:'Instance properties'});
  await tree.getByRole('treeitem',{name:'first · Loan',exact:true}).locator(':scope > .instance-row').click();
  await expect(properties).toContainText('overdueFee · derived');
  await expect(properties).toContainText('100');
  await tree.getByRole('treeitem',{name:'earthsea · BookCopy',exact:true}).locator(':scope > .instance-row').click();
  await expect(properties).toContainText('copyLabel · derived');
  await expect(properties).toContainText('earthsea (edition 2)');
  await page.getByRole('tab',{name:'script.py',exact:true}).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready',{timeout:30000});
  await page.locator('#python-run').click();
  await expect(page.locator('#python-run')).toBeEnabled({timeout:30000});
  await expect(page.locator('#python-error')).toHaveText('');
  await expect(page.locator('#python-output')).toContainText('Fee before (cents): 100');
  await expect(page.locator('#python-output')).toContainText('Fee after (cents): 175');
  await expect(page.locator('#python-output')).toContainText('Label after: earthsea (edition 3)');
  const snapshot = await exportedModel(page);
  const loan = snapshot.model.elements.find(e => e.values.name === 'first');
  const copy = snapshot.model.elements.find(e => e.values.name === 'earthsea');
  expect(snapshot.derived[loan.id].overdueFee.value).toBe('175');
  expect(snapshot.derived[copy.id].copyLabel).toBe('earthsea (edition 3)');
});
test('Library implementation example opens from its direct link', async ({page}) => {
  await page.goto('/?example=library-implementations');
  await expect(page.locator('#example')).toHaveValue('library-implementations');
  await expect(page.locator('#rhai-file')).toBeVisible();
  await expect(page.locator('#rhai-status')).toContainText('Compiled.', {timeout:30000});
  await page.locator('#rhai-run').click();
  await expect(page.locator('#rhai-status')).toContainText('Completed with rhai');
  expect(JSON.parse(await page.locator('#rhai-result').textContent()).data.Scalar.payload.value).toBe('100');
});

test('File Create Stub opens a center Rhai tab and preserves implementations', async ({page}) => {
  await open(page); await expect(page.locator('#open-bindings')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download'); await page.locator('#save-rhai').click();
  expect(await readFile(await (await downloadEvent).path(),'utf8')).toContain('fn twice(value)');
  await edit(page, 'Rhai source', implementation);
  await createStub(page); await expect(page.locator('#rhai-status')).toContainText('Existing implementations preserved');
  await compile(page); await run(page,'42');
  await page.screenshot({path:'test-results/rhai-file.png'});
});
test('normal Compile rejects missing implementations and keeps the last successful source', async ({page}) => {
  await open(page); await compile(page);
  await page.locator('#rhai-arguments').fill('["21"]'); await page.locator('#rhai-run').click();
  await expect(page.locator('#rhai-status')).toContainText('Implementation required');
  await edit(page,'Rhai source',implementation); await compile(page); await run(page,'42');
  const selected = await page.locator('#rhai-implementation').textContent();
  expect(selected).toMatch(/^Implementation: rhai · rhai-1\.26\.1\/bindings-v2:/);
  await edit(page,'Rhai source','fn twice(value) { value * 3 }'); await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Compilation stopped');
  await expect(page.locator('#rhai-status')).toContainText('Missing doubled');
  await expect(page.locator('#rhai-implementation')).toHaveText(selected);
  await run(page,'42');
  await expect(page.locator('#rhai-implementation')).toHaveText(selected);
});
test('project save and reopen preserves the Rhai file without activating drafts', async ({page}) => {
  await open(page); await edit(page,'Rhai source',implementation); await compile(page); await run(page,'42');
  const selected = await page.locator('#rhai-implementation').textContent();
  expect(selected).toMatch(/^Implementation: rhai · rhai-1\.26\.1\/bindings-v2:/);
  await page.locator('.ide-file-menu > summary').click();
  const downloadEvent=page.waitForEvent('download'); await page.locator('#save-project').click();
  const path=await (await downloadEvent).path(); const saved=JSON.parse(await readFile(path,'utf8'));
  expect(saved.bindings.source.replaceAll('\r\n','\n')).toBe(implementation.replaceAll('\r\n','\n')); expect(saved.bindings.version).toBe(2);
  await page.locator('#project-file').setInputFiles(path); await expect(page.locator('#project-status')).toContainText('Project opened');
  await page.locator('[data-ecore-view="rhai"]').click(); await page.locator('#rhai-run').click();
  await expect(page.locator('#rhai-status')).toContainText('Compile the project first');
  await expect(page.locator('#rhai-implementation')).toBeEmpty();
  const fileEvent=page.waitForEvent('download'); await page.locator('#save-rhai').click();
  expect(await readFile(await (await fileEvent).path(),'utf8')).toBe(saved.bindings.source);
  await compile(page); await run(page,'42');
  await expect(page.locator('#rhai-implementation')).toHaveText(selected);
});
test('regeneration appends new external functions and diagnoses changed arity', async ({page}) => {
  await open(page); await edit(page,'Rhai source',implementation);
  await page.locator('[data-ecore-view="source"]').click();
  await edit(page,'Definition source',structure.replace('extern fn twice', 'extern fn triple(value:Int64)->Int64;\n  extern fn twice'));
  await createStub(page); await expect(page.locator('#rhai-status')).toContainText('1 stub(s) created');
  await page.locator('[data-ecore-view="source"]').click();
  await edit(page,'Definition source',structure.replace('twice(value: Int64)', 'twice(value: Int64, extra: Int64)'));
  await createStub(page); await expect(page.locator('#project-status')).toContainText('Signature changed for twice');
});
test('in-flight cancellation recovers with the compiled file and resource limits remain enforced', async ({page}) => {
  await open(page); await edit(page,'Rhai source',implementation); await compile(page);
  await page.route('**/intersect_web.wasm', async route => { await new Promise(resolve=>setTimeout(resolve,1000)); await route.continue().catch(()=>{}); });
  await page.locator('#rhai-run').click(); await expect(page.locator('#rhai-status')).toContainText('Running compiled');
  await page.locator('#rhai-cancel').click(); await expect(page.locator('#rhai-status')).toContainText('cancelled');
  await page.unroute('**/intersect_web.wasm'); await run(page,'42');
  await edit(page,'Rhai source',implementation.replace('value * 2','loop {}'));
  await compile(page); await page.locator('#rhai-run').click(); await expect(page.locator('#rhai-status')).toContainText('budget exhausted');
});
test('Rhai reads the checked model created through the workbench Python API', async ({page}) => {
  test.setTimeout(90000);
  await open(page); await edit(page,'Rhai source',implementation); await compile(page);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#python-enable').click(); await expect(page.locator('#python-status')).toContainText('Python ready',{timeout:30000});
  await edit(page,'Python script','from intersect_api import Meter\nmeter = Meter(value={"kind":"int64","value":"21"})\nprint("METER_ID=" + meter.handle)\n');
  await page.locator('#python-run').click(); await expect(page.locator('#python-run')).toBeEnabled({timeout:30000});
  await expect(page.locator('#python-error')).toHaveText('');
  await expect(page.locator('#element-count')).toHaveText('1 elements');
  const id=(await page.locator('#python-output').textContent()).match(/METER_ID=([^\r\n]+)/)?.[1]; expect(id).toBeTruthy();
  await page.getByRole('tab',{name:'Define',exact:true}).click(); await page.locator('[data-ecore-view="rhai"]').click();
  await page.locator('#rhai-function').selectOption({label:'doubled'}); await page.locator('#rhai-arguments').fill(JSON.stringify([id]));
  await page.locator('#rhai-run').click(); await expect(page.locator('#rhai-status')).toContainText('Completed with rhai');
  expect(JSON.parse(await page.locator('#rhai-result').textContent()).data.Scalar.payload.value).toBe('42');
});
