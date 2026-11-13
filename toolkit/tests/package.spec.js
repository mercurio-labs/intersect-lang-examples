import {verifyInferredArchiveBrowser} from './inferred-archive-browser.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function downloadPackage(page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  const download = await downloading;
  const bytes = await readFile(await download.path());
  return { name: download.suggestedFilename(), bytes, files: unzipSync(bytes) };
}
const json = (files, path) => JSON.parse(strFromU8(files[path]));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
});

test('ZIP contains verified sources, compiled IR and Python bindings; definitions reload and execute', async ({ page }) => {
  const original = await page.evaluate(() => window.workbench.inspect());
  await page.locator('.ide-file-menu > summary').click(); await page.getByRole('button', { name: 'Export language ZIP' }).click();
  await page.getByLabel('Package ID', { exact: false }).fill('org.example.library');
  await page.getByLabel('Release', { exact: false }).fill('1.2.0');
  await page.getByLabel('Display name', { exact: true }).fill('Library for reuse');
  await page.getByLabel('Description', { exact: false }).fill('A shared language — café.');
  await page.screenshot({ path: 'test-results/package-dialog-desktop.png', fullPage: true });
  const archive = await downloadPackage(page);
  expect(archive.name).toBe('org.example.library-1.2.0.zip');
  const manifest = json(archive.files, 'manifest.json');
  expect(manifest.metadata.description).toBe('A shared language — café.');
  expect(manifest.runtime.profile).toBe('intersect.workbench.v1');
  expect(manifest.ecore_namespace).toBe(original.package.schema.uri);
  expect(Object.keys(archive.files).sort()).toEqual([
    'README.txt', 'definitions/bundle.json', 'manifest.json', 'package.json',
    'python/intersect_api.py', 'python/intersect_api.pyi',
  ]);
  for (const [path, digest] of Object.entries(manifest.files)) {
    expect(sha256(archive.files[path])).toBe(digest.sha256);
    expect(archive.files[path].length).toBe(digest.bytes);
  }
  expect(Object.keys(manifest.files).sort()).toEqual(Object.keys(archive.files).filter(p => p !== 'manifest.json').sort());
  expect(manifest.definitions).toEqual({bundle:'definitions/bundle.json'});
  const compilation = json(archive.files, 'definitions/bundle.json');
  expect(compilation).toEqual(original.package.compilation);
  expect(compilation.bundle.sources.find(s => s.kind === 'rcore').text).toBe(await page.evaluate(() => window.workbench.definitionModels.rcore.getValue()));
  expect(compilation.bundle.sources.some(s => s.kind === 'ecore')).toBe(false);
  expect(manifest.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(json(archive.files, 'package.json')).toEqual(original.package);
  expect(strFromU8(archive.files[manifest.python.source])).toContain(`REVISION = "${manifest.revision}"`);
  expect(strFromU8(archive.files[manifest.python.stub])).toContain('class BookCopy');
  expect(manifest.python.host_api).toBe('intersect.script.v1');
  // Compile and execute through a fresh WASM instance, not the active worker.
  const reloaded = await page.evaluate(async files => {
    const { loadRuntime } = await import('/src/runtime.js');
    const runtime = await loadRuntime();
    const compiled = runtime({ method: 'package/import', files });
    return runtime({ method: 'evaluate', package: compiled.package, sources: Object.values(window.workbench.modelModels).map(m => ({ uri: m.uri.toString(), text: m.getValue() })) });
  }, Object.fromEntries(Object.entries(archive.files).map(([path, bytes]) => [path, strFromU8(bytes)])));
  expect(reloaded.diagnostics).toEqual([]);
  expect(reloaded.model).toEqual(original.evaluation.model);
  expect(reloaded.derived).toEqual(original.evaluation.derived);
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export-package').click();
  const again = await downloadPackage(page);
  expect(again.bytes.equals(archive.bytes)).toBe(true);
});

test('dialog validation, cancel, mobile and optional Python; metadata persists during the session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export-package').click();
  await page.getByLabel('Package ID', { exact: false }).fill('../bad');
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  expect(await page.locator('[name=package_id]').evaluate(el => el.validity.valid)).toBe(false);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Package ID', { exact: false }).fill('org.example.library');
  await page.getByLabel('Include Python wrappers').uncheck();
  await page.screenshot({ path: 'test-results/package-dialog-mobile.png', fullPage: true });
  expect(await page.locator('#package-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const { files } = await downloadPackage(page);
  expect(json(files, 'manifest.json').python).toBeNull();
  expect(Object.keys(files).some(p => p.startsWith('python/'))).toBe(false);
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export-package').click();
  await expect(page.locator('[name=package_id]')).toHaveValue('org.example.library');
  await expect(page.getByLabel('Include Python wrappers')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.ide-file-menu > summary')).toBeFocused();
});

test('failed and pending definition edits export the last compiled snapshot despite model errors', async ({ page }) => {
  const original = await page.evaluate(() => window.workbench.inspect());
  await page.evaluate(async () => {
    window.workbench.definitionModels.rcore_behavior.setValue('{}');
    await window.workbench.compile();
    window.workbench.modelModels.catalog.setValue('bad model');
  });
  await expect(page.locator('#export')).toBeDisabled();
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export-package').click();
  await expect(page.locator('#package-snapshot')).toContainText('Uncompiled definition edits are excluded');
  const { files } = await downloadPackage(page);
  expect(json(files, 'package.json')).toEqual(original.package);
});

test('language changes while dialog is open require a fresh snapshot', async ({ page }) => {
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export-package').click();
  await page.evaluate(() => window.workbench.compile());
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  await expect(page.locator('#package-error')).toContainText('active language changed');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('unsupported Python names report an error and allow language-only export', async ({ page }) => {
  await page.evaluate(async () => {
    const m = window.workbench.definitionModels.rcore;
    m.setValue(m.getValue().replace('attr edition:', 'attr `class`:'));
    const x = window.workbench.definitionModels.xtext;
    x.setValue(x.getValue().replace('edition=INT', 'class=INT'));
    await window.workbench.compile();
  });
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#export-package').click();
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  await expect(page.locator('#package-error')).toContainText('Uncheck Python bindings');
  await page.getByLabel('Include Python wrappers').uncheck();
  const { files } = await downloadPackage(page);
  expect(json(files, 'manifest.json').python).toBeNull();
});

test('inferred source archive API uses the shipped runtime',async({page})=>{
  test.setTimeout(120000);
  await verifyInferredArchiveBrowser(page);
});
