import {verifyInferredArchiveBrowser} from './inferred-archive-browser.js';
import {createHash} from 'node:crypto';
import { test, expect } from '@playwright/test';
import { exampleScript } from '../src/python-api.js';
import { unzipSync, strFromU8 } from 'fflate';

test('static starter scenarios execute cyclic closure and recover from Library validation', async ({page}) => {
  test.setTimeout(120000);
  await page.goto('/?example=rcore');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#model-samples > summary').click();
  await page.locator('[data-model-sample="graph"]').click();
  await expect(page.locator('#element-count')).toHaveText('11 elements');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#dock-tab-rcore').click();
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A → B → D → C',{timeout:60000});
  await page.getByRole('tab',{name:'Define',exact:true}).click();
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#model-samples > summary').click();
  await page.locator('[data-model-sample="invalid"]').click();
  await expect(page.locator('#diagnostic-list')).toContainText('A book copy cannot have more than one active loan.');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#model-samples > summary').click();
  await page.locator('[data-model-sample="circulation"]').click();
  await expect(page.locator('#element-count')).toHaveText('9 elements');
  await expect(page.locator('#diagnostic-count')).toHaveText('0');
});
import { readFile } from 'node:fs/promises';

test('static editor windows create model files, Python scripts and queries through the UI', async ({ page }) => {
  test.setTimeout(90000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  async function create(type, name) {
    await page.getByRole('button', { name: 'New file' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('File type').selectOption(type);
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Create file' }).click();
    return page.getByRole('tabpanel', { name, exact: true });
  }
  const model = await create('model', 'branch.library');
  await model.getByRole('textbox').focus();
  await page.keyboard.insertText('library Branch { member grace; }');
  await expect(page.locator('#model-tree')).toContainText('grace');
  const python = await create('python', 'checks.py');
  await python.getByRole('textbox', { name: 'Python script', exact: true }).focus();
  await page.keyboard.insertText('from intersect_api import Member, model\nassert model.find(Member, name="grace") is not None\nprint("branch verified")\n');
  await python.getByRole('button', { name: 'Enable Python' }).click();
  await expect(python.getByRole('button', { name: 'Run script', exact: true })).toBeEnabled({ timeout: 30000 });
  await python.getByRole('button', { name: 'Run script', exact: true }).click();
  await expect(python.getByRole('status')).toContainText('Committed', { timeout: 60000 });
  const query = await create('query', 'copies.query');
  await query.getByRole('button', { name: 'Available copies', exact: true }).click();
  await query.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(query.locator('.query-results')).toContainText('A Wizard of Earthsea');
  await page.getByRole('button', { name: 'Side-by-side' }).click();
  await expect(page.locator('.editor-group:visible')).toHaveCount(2);
  await page.getByRole('button', { name: 'Side-by-side' }).click();
  await expect(page.locator('.editor-group:visible')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#save-project').click();
  const saved = JSON.parse((await readFile(await (await download).path())).toString());
  expect(saved.windows.documents.map(doc => doc.name)).toEqual(['catalog.library', 'loans.library', 'script.py', 'Queries', 'branch.library', 'checks.py', 'copies.query']);
  expect(saved.windows.documents.find(doc => doc.name === 'checks.py').source).toContain('branch verified');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/windows-production.png' });
});

test('static Toolkit authors and reopens Rcore projects and runs disposable Python tests', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  expect(await page.evaluate(() => typeof window.workbench)).toBe('undefined');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#new-empty-project').click();
  await expect(page.locator('.structure-class')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rcore source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Definition source', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('rcore 1;package books version "1";metamodel "urn:books" prefix b {class Element {} class Book {attr title:String [0,1];attr state:String [0,1] default "available";}}');
  await page.getByRole('button', { name: 'Class diagram', exact: true }).click();
  await expect(page.locator('.structure-class')).toHaveCount(2);
  await expect(page.locator('.structure-class[data-class="Book"]')).toContainText('title: EString');
  const heading = page.locator('.structure-class[data-class="Book"] .structure-class-title');
  await heading.focus(); await page.keyboard.press('ArrowRight');
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  await page.getByRole('textbox', { name: 'Python script', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('from intersect_api import Book, model\nbook = Book(title="Earthsea")\nassert book.title == "Earthsea"\nassert book.state == "available"\nassert model.validate() == []\n');
  await page.locator('#python-test').click();
  await expect(page.locator('#python-status')).toContainText('Tests passed', { timeout: 60000 });
  await expect(page.locator('#element-count')).toHaveText('0 elements');
  await page.getByRole('tab', { name: 'Define', exact: true }).click();
  const pending = page.waitForEvent('download'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#save-project').click();
  const saved = await pending;
  const bytes = await readFile(await saved.path());
  const project = JSON.parse(bytes.toString());
  expect(project.mode).toBe('structure'); expect(project.layout.positions.Book.x).toBeGreaterThan(0);
  expect(project.python).toContain('Earthsea');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#new-empty-project').click();
  await expect(page.locator('.structure-class')).toHaveCount(1);
  const chooser = page.waitForEvent('filechooser'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#open-project').click();
  await (await chooser).setFiles({ name: saved.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
  await expect(page.locator('.structure-class[data-class="Book"]')).toContainText('title: EString');
  expect(project.definitions.rcore).toContain('class Book');
  await expect(page.locator('[data-definition="ecore"]')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Ecore source',exact:true})).toHaveCount(0);
  await expect(page.locator('#project-status')).toContainText('Project opened');
});

test('static query panel runs derived and relationship queries without development hooks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  expect(await page.evaluate(() => typeof window.workbench)).toBe('undefined');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'Queries', exact: true }).click();
  await page.getByRole('button', { name: 'Available copies', exact: true }).click();
  await page.getByRole('tab', { name: 'Queries', exact: true }).click(); await page.locator('#query-run').click();
  await expect(page.locator('#query-results')).toContainText('A Wizard of Earthsea');
  await expect(page.locator('#query-count')).toHaveText('1 row');
  await page.getByRole('button', { name: 'Loans and borrowers', exact: true }).click();
  await page.getByRole('tab', { name: 'Queries', exact: true }).click(); await page.locator('#query-run').click();
  await expect(page.locator('#query-results')).toContainText('ada');
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
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export-package').click();
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
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#new-sample-project').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export').click();
  expect((await download).suggestedFilename()).toBe('intersect-model.json');
  const xmiDownload = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.getByRole('button', { name: 'Export XMI' }).click();
  const xmi = await xmiDownload;
  expect(xmi.suggestedFilename()).toBe('intersect-model-xmi.zip');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#import-model').click();
  await (await chooser).setFiles({ name: xmi.suggestedFilename(), mimeType: 'application/zip', buffer: await readFile(await xmi.path()) });
  await expect(page.locator('#interchange-status')).toContainText('Imported 2 resource');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  expect(errors).toEqual([]);
  expect(requests.some(r => r.url.endsWith('intersect_web.wasm'))).toBe(true);
  expect(requests.every(r => r.method === 'GET' && (r.url.startsWith(new URL(page.url()).origin + '/') || r.url.startsWith('blob:')))).toBe(true);
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
  await page.keyboard.insertText(exampleScript + '\nprint("Completed:", copy.ava');
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
  await expect(page.locator('#transaction-list')).toContainText('committed');
  await expect(page.locator('#transaction-detail')).toContainText('BookCopy.available');
  await expect(page.locator('#transaction-detail')).toContainText('Validation: passed');
  await expect(page.locator('#python-error')).toBeEmpty();
  expect(requests.some(r => r.url.includes('pyodide.asm.wasm'))).toBe(true);
  expect(requests.some(r => r.url.includes('pyright.worker.js'))).toBe(true);
  expect(requests.every(r => r.method === 'GET' && (r.url.startsWith(new URL(page.url()).origin + '/') || r.url.startsWith('blob:')))).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/python-production-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/python-production-mobile.png', fullPage: true });
});


test('static bounded KerML syntax example and Library share the shipped WASM runtime', async ({ page }) => {
  test.setTimeout(90000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?example=xtext-kerml');
  await expect(page.locator('#example')).toHaveValue('xtext-kerml',{timeout:60000});
  await expect(page.locator('#definition-file')).toHaveText('mini-kerml.xtext');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.locator('#model-tree')).toContainText('Vehicle');
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#model-tree')).toContainText('dune');
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  expect(errors).toEqual([]);
});


test('static KerML dispatch example creates concrete subtypes and preserves Library switching', async ({ page }) => {
  await page.goto('/?example=xtext-dispatch');
  await expect(page.locator('#example')).toHaveValue('xtext-dispatch');
  await expect(page.locator('#element-count')).toHaveText('5 elements');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', {name:'Test',exact:true}).click();
  await expect(page.locator('#model-tree')).toContainText('Vehicle');
  await expect(page.locator('#model-tree')).toContainText('wheel');
  expect(await page.evaluate(() => typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#model-tree')).toContainText('dune');
});


test('static typed fragment example links its caller features using the shipped runtime', async ({ page }) => {
  await page.goto('/?example=xtext-fragments');
  await expect(page.locator('#example')).toHaveValue('xtext-fragments');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.locator('#model-tree')).toContainText('Vehicle');
  await expect(page.locator('#model-tree')).toContainText('wheel');
  await expect(page.locator('#model-tree')).toContainText('Axle');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#model-tree')).toContainText('dune');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
});


test('static punctuation example executes compound keywords and preserves Library switching', async ({page}) => {
  await page.goto('/?example=xtext-punctuation');
  await expect(page.locator('#example')).toHaveValue('xtext-punctuation');
  await expect(page.locator('#element-count')).toHaveText('7 elements');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['Parts','Units','Wheel','front','Local']) await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static qualified-name example links through the shipped datatype runtime', async ({page}) => {
  await page.goto('/?example=xtext-datatypes');
  await expect(page.locator('#example')).toHaveValue('xtext-datatypes');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['Parts::Wheel','front','distance','Units::Length']) await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static simple-action example and Library share the shipped runtime', async ({page}) => {
  await page.goto('/?example=xtext-actions');
  await expect(page.locator('#example')).toHaveValue('xtext-actions');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['Vehicle','Wheel','wheel','Spare']) await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static native terminal example preserves tagged names and Library switching', async ({page}) => {
  await page.goto('/?example=xtext-terminals');await expect(page.locator('#example')).toHaveValue('xtext-terminals');
  await expect(page.locator('#element-count')).toHaveText('5 elements');await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['@Wheel','wheel','@Spare']) await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static explicit lexical example preserves quoted names and Library switching', async ({page}) => {
  await page.goto('/?example=xtext-lexical');await expect(page.locator('#example')).toHaveValue('xtext-lexical');
  await expect(page.locator('#element-count')).toHaveText('5 elements');await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ["'Wheel assembly'",'wheel','Spare']) await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static predictive lexical example preserves quoted names and Library switching', async ({page}) => {
  await page.goto('/?example=xtext-prediction');await expect(page.locator('#example')).toHaveValue('xtext-prediction');
  await expect(page.locator('#element-count')).toHaveText('5 elements');await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ["'Wheel assembly'",'wheel','Spare']) await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static inherited grammar example executes parent declarations and returns to Library', async ({page}) => {
  await page.goto('/?example=xtext-inheritance');
  await expect(page.locator('#example')).toHaveValue('xtext-inheritance');
  await expect(page.locator('#element-count')).toHaveText('4 elements');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['Wheel','Spare']) await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('static parser override example executes inherited calls and returns to Library', async ({page}) => {
  await page.goto('/?example=xtext-overrides');
  await expect(page.locator('#example')).toHaveValue('xtext-overrides');
  await expect(page.locator('#element-count')).toHaveText('4 elements');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['Wheel','Spare']) await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('static cumulative KerML syntax showcase exposes combined model values and returns to Library', async ({page}) => {
  await page.goto('/?example=xtext-showcase');await expect(page.locator('#example')).toHaveValue('xtext-showcase');
  await expect(page.locator('#element-count')).toHaveText('6 elements');await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['Wheel assembly','Library::Spare','front','spare'])await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static inferred KerML datatypes expose combined model values and returns to Library', async ({page}) => {
  await page.goto('/?example=xtext-inference');await expect(page.locator('#example')).toHaveValue('xtext-inference');
  await expect(page.locator('#element-count')).toHaveText('6 elements');await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['Wheel assembly','Library::Spare','front','spare'])await expect(page.locator('#model-tree')).toContainText(name);
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');await expect(page.locator('#model-tree')).toContainText('dune');
});


test('static current-action expression construction runs without development hooks', async ({page}) => {
  await page.goto('/?example=xtext-current');await expect(page.locator('#example')).toHaveValue('xtext-current');
  await expect(page.locator('#element-count')).toHaveText('8 elements');
  await page.getByRole('tab',{name:'Test',exact:true}).click();await expect(page.locator('#model-tree')).toContainText('OperatorExpression');
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static first-token predicate example selects its guarded branch without development hooks', async ({page}) => {
  await page.goto('/?example=xtext-predicates');await expect(page.locator('#example')).toHaveValue('xtext-predicates');
  await expect(page.locator('#element-count')).toHaveText('5 elements');
  await page.getByRole('tab',{name:'Test',exact:true}).click();await expect(page.locator('#model-tree')).toContainText('Left');
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static cumulative enum example retains KerML teaching links and returns to Library', async ({page}) => {
  await page.goto('/?example=xtext-enums');await expect(page.locator('#example')).toHaveValue('xtext-enums');
  await expect(page.locator('#element-count')).toHaveText('6 elements');await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['Wheel assembly','Library::Spare','front','spare'])await expect(page.locator('#model-tree')).toContainText(name);
  for(const [name,literal] of [["Vehicles::'Wheel assembly' · Type",'VisibilityKind.public'],['Library::Spare · Type','VisibilityKind.private'],['front · Feature','FeatureDirectionKind.out'],['spare · Feature','FeatureDirectionKind.inout']]) {
    await page.getByRole('treeitem',{name,exact:true}).locator(':scope > .instance-row').click();
    await expect(page.getByRole('region',{name:'Instance properties'})).toContainText(literal);
  }
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');await expect(page.locator('#model-tree')).toContainText('dune');
});

test('static cumulative converter example retains distinct Boolean policies and returns to Library', async ({page}) => {
  await page.goto('/?example=xtext-converters');await expect(page.locator('#example')).toHaveValue('xtext-converters');
  await expect(page.locator('#element-count')).toHaveText('7 elements');await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['Wheel assembly','Library::Spare','front','spare'])await expect(page.locator('#model-tree')).toContainText(name);
  for(const [name,literal] of [["Vehicles::'Wheel assembly' · Type",'VisibilityKind.public'],['Library::Spare · Type','VisibilityKind.private'],['front · Feature','FeatureDirectionKind.out'],['spare · Feature','FeatureDirectionKind.inout']]) {
    await page.getByRole('treeitem',{name,exact:true}).locator(':scope > .instance-row').click();
    await expect(page.getByRole('region',{name:'Instance properties'})).toContainText(literal);
  }
  for(const [name,unique,ordered,enabled] of [['front',false,true,true],['spare',false,true,false],['standard',true,false,false]]) {
    await page.getByRole('treeitem',{name:`${name} · Feature`,exact:true}).locator(':scope > .instance-row').click();
    for(const [field,value] of [['isUnique',unique],['isOrdered',ordered],['isEnabled',enabled]])await expect(page.getByRole('region',{name:'Instance properties'}).getByText(field,{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText(String(value));
  }
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');await expect(page.locator('#model-tree')).toContainText('dune');
});


test('static recursive predicates construct nested objects without development hooks', async ({page}) => {
  await page.goto('/?example=xtext-recursive');await expect(page.locator('#example')).toHaveValue('xtext-recursive');
  await expect(page.locator('#element-count')).toHaveText('4 elements');await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();await expect(page.locator('#model-tree')).toContainText('Left');
  await page.locator('.instance-row').filter({hasText:'Left'}).first().click();
  await expect(page.getByRole('region',{name:'Instance properties'}).getByText('number',{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText('12');
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('static real values preserve exact IEEE values without development hooks', async ({page}) => {
  await page.goto('/?example=xtext-double');await expect(page.locator('#example')).toHaveValue('xtext-double');
  await expect(page.locator('#element-count')).toHaveText('7 elements');await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('.instance-row').filter({hasText:'LiteralRational'}).first().click();
  await expect(page.getByRole('region',{name:'Instance properties'})).toContainText('3fe0000000000000');
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
});


test('static recursive arguments preserve nested ownership and named links', async ({page}) => {
  await page.goto('/?example=xtext-arguments');
  await expect(page.locator('#element-count')).toHaveText('22 elements');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  for(const name of ['f \u00b7 Feature','g \u00b7 Feature','target \u00b7 Feature','n \u00b7 Feature'])await expect(page.getByRole('treeitem',{name,exact:true})).toBeVisible();
  await page.locator('.instance-row').filter({hasText:'Redefinition'}).first().click();
  await expect(page.getByRole('region',{name:'Instance properties'})).toContainText('redefinedFeature');
  await expect(page.getByRole('region',{name:'Instance properties'})).toContainText('target');
  await page.screenshot({path:'test-results/xtext-arguments-production.png',fullPage:true});
  expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
  await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
});

for(const [example,count] of [['xtext-library-advanced',6],['xtext-expressions-advanced',9]]) {
  test(`static advanced Xtext example ${example} uses the shared WASM runtime`,async({page})=>{
    await page.goto('/?example='+example);
    await expect(page.locator('#element-count')).toHaveText(`${count} elements`,{timeout:60000});
    await expect(page.locator('#compile-status')).toContainText('Language compiled');
    await expect(page.locator('#diagnostic-count')).toHaveText('0');
    expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
    await page.getByRole('tab',{name:'Test',exact:true}).click();
    if(example==='xtext-library-advanced') {
      await page.getByRole('treeitem',{name:'spare · BookCopy',exact:true}).locator(':scope > .instance-row').click();
      await expect(page.getByRole('region',{name:'Instance properties'}).getByText('title',{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText('untitled');
      await expect(page.locator('#model-status')).toContainText('2 source reference locations');
    } else {
      await expect(page.locator('#model-tree')).toContainText('OperatorExpression');
      await expect(page.locator('#model-tree')).toContainText('Extent');
    }
    await page.getByRole('tab',{name:'Define',exact:true}).click();
    await page.locator('.ide-file-menu > summary').click();await page.locator('#export-package').click();
    const downloading=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
    const download=await downloading;
    const files=unzipSync(await readFile(await download.path()));
    expect(JSON.parse(strFromU8(files['manifest.json'])).runtime.profile).toBe('intersect.xtext.native.v27');
    await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
  });
}

for(const [example,count] of [['xtext-library-composed',6],['xtext-expressions-composed',17]]) {
  test(`static composed Xtext example ${example} uses the shared WASM runtime`,async({page})=>{
    await page.goto('/?example='+example);
    await expect(page.locator('#element-count')).toHaveText(`${count} elements`,{timeout:60000});
    await expect(page.locator('#compile-status')).toContainText('Language compiled');
    await expect(page.locator('#diagnostic-count')).toHaveText('0');
    expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
    await page.getByRole('tab',{name:'Test',exact:true}).click();
    if(example==='xtext-library-composed') {
      await page.getByRole('treeitem',{name:'spare_2 · BookCopy',exact:true}).locator(':scope > .instance-row').click();
      await expect(page.getByRole('region',{name:'Instance properties'}).getByText('title',{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText('untitled');
      await expect(page.locator('#model-status')).toContainText('2 source reference locations');
      await page.getByRole('treeitem',{name:'dune_1 · BookCopy',exact:true}).locator(':scope > .instance-row').click();
      await expect(page.getByRole('region',{name:'Instance properties'}).getByText('title',{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText('Dune\nVolume 1');
    } else {
      await expect(page.locator('#model-tree')).toContainText('OperatorExpression');
      await expect(page.locator('#model-tree')).toContainText('Extent');
    }
    await page.getByRole('tab',{name:'Define',exact:true}).click();
    await page.locator('.ide-file-menu > summary').click();await page.locator('#export-package').click();
    const downloading=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
    const download=await downloading;
    const files=unzipSync(await readFile(await download.path()));
    expect(JSON.parse(strFromU8(files['manifest.json'])).runtime.profile).toBe('intersect.xtext.native.v52');
    await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
  });
}


for(const [name,version,operator] of [['projected',53,'left'],['nary',54,'branch7'],['filtered',55,'right'],['discovery',56,'left']]) {
  test(`static prediction adoption xtext-${name} inspects literal models and preserves project/export profile`,async({page})=>{
    test.setTimeout(180000);page.setDefaultTimeout(15000);
    await page.goto('/?example=xtext-'+name);
    await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
    await expect(page.locator('#element-count')).toHaveText('2 elements');await expect(page.locator('#diagnostic-count')).toHaveText('0');
    expect(await page.evaluate(()=>typeof window.workbench)).toBe('undefined');
    await page.getByRole('tab',{name:'Test',exact:true}).click();
    await page.getByRole('treeitem',{name:'file:///models/catalog.library#0 · OperatorExpression',exact:true}).locator(':scope > .instance-row').click();
    await expect(page.getByRole('region',{name:'Instance properties'}).getByText('operator',{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText(operator);
    await page.locator('.ide-file-menu > summary').click();
    const saving=page.waitForEvent('download');await page.locator('#save-project').click();const saved=await saving;
    const bytes=await readFile(await saved.path()), project=JSON.parse(bytes.toString('utf8'));
    expect(project.profile).toBe('xtext-'+name);expect(project.compilerProfile).toBe('intersect.xtext.native.v'+version);
    await page.locator('.ide-file-menu > summary').click();
    await page.locator('#project-file').setInputFiles({name:'prediction.intersect.json',mimeType:'application/json',buffer:bytes});
    await page.getByRole('tab',{name:'Define',exact:true}).click();
    await page.locator('#compile').click();await expect(page.locator('#element-count')).toHaveText('2 elements');
    await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
    await expect(page.locator('#element-count')).toHaveText('2 elements',{timeout:60000});
    await page.getByRole('tab',{name:'Test',exact:true}).click();
    await page.getByRole('treeitem',{name:'file:///models/catalog.library#0 · OperatorExpression',exact:true}).locator(':scope > .instance-row').click();
    await expect(page.getByRole('region',{name:'Instance properties'}).getByText('operator',{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText(operator);
    await page.getByRole('tab',{name:'Define',exact:true}).click();
    await page.locator('.ide-file-menu > summary').click();await page.locator('#export-package').click();
    await page.getByLabel('Package ID',{exact:false}).fill('example.static.prediction.'+name);await page.getByLabel('Release',{exact:false}).fill('1');
    const exporting=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();const archive=await exporting;
    const files=unzipSync(await readFile(await archive.path()));
    const manifest=JSON.parse(strFromU8(files['manifest.json']));expect(manifest.runtime.profile).toBe(project.compilerProfile);
    const compilation=JSON.parse(strFromU8(files['definitions/bundle.json']));
    for(const kind of ['rcore','xtext','rcore_behavior']) {
      const source=compilation.bundle.sources.find(s=>s.kind===kind);
      expect(source.text).toBe(project.definitions[kind]);
      expect(createHash('sha256').update(source.text).digest('hex')).toBe(source.id.sha256);
    }
    for(const [path,digest] of Object.entries(manifest.files)) {
      expect(createHash('sha256').update(files[path]).digest('hex')).toBe(digest.sha256);
      expect(files[path].length).toBe(digest.bytes);
    }
    await page.locator('#example').selectOption('library',{force:true});await expect(page.locator('#element-count')).toHaveText('6 elements');
  });
}

test('static inferred source archive API uses the shipped runtime',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await verifyInferredArchiveBrowser(page);
});
