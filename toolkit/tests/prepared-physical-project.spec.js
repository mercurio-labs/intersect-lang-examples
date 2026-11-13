import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const observation=async page=>JSON.parse(await page.locator('#draft-result').textContent());
async function twoSources(page){
  await page.goto('/prepared-draft.html');await page.locator('#draft-mode').selectOption('project');
  await page.locator('#draft-model').fill('package A {}');await page.locator('#draft-source-uri').fill('memory://physical/a.kerml');await page.locator('#draft-source-uri').dispatchEvent('change');
  await page.locator('#draft-source-add').click();await page.locator('#draft-model').fill('package B {}');
  await page.locator('#draft-source-uri').fill('memory://physical/b.kerml');await page.locator('#draft-source-uri').dispatchEvent('change');
}
async function analyze(page){await page.locator('#draft-analyze').click();await expect(page.locator('#draft-status')).toContainText(/KerML construction available|KerML construction has diagnostics|Draft unavailable/,{timeout:125000});}
async function save(page){const pending=page.waitForEvent('download');await page.locator('#draft-save').click();return readFile(await(await pending).path());}
test('real native multi-resource physical project uses complete originals and source-only save reopen',async({page})=>{
  await twoSources(page);await analyze(page);const result=await observation(page);
  expect(result.kind).toBe('prepared_physical_project');expect(result.status).toBe('available');
  expect(result.language_validated).toBe(false);expect(result.publication_permitted).toBe(false);
  const native=result.preview;expect(native.kind).toBe('frozen_kerml_load');expect(native.mode).toBe('frozen-kerml-load.v1');
  expect(native.sources).toEqual(['memory://physical/a.kerml','memory://physical/b.kerml']);
  expect(native.linked).toBe(false);expect(native.language_validated).toBe(false);expect(native.diagnostics).toEqual([]);
  expect(native.model.elements.filter(e=>e.class==='Package').map(e=>e.values.declaredName).sort()).toEqual(['A','B']);
  const saved=await save(page),project=JSON.parse(saved);
  expect(project.format).toBe('intersect.toolkit.project.v8');expect(Object.keys(project).sort()).toEqual(['format','mode','original','presentation','sources']);
  expect(project.sources).toEqual([{uri:'memory://physical/a.kerml',text:'package A {}'},{uri:'memory://physical/b.kerml',text:'package B {}'}]);
  expect(Buffer.byteLength(project.original.bundle.sources[0].text)).toBe(629610);
  expect(createHash('sha256').update(project.original.bundle.sources[0].text).digest('hex')).toBe('22719934c65588180fc19658f8a7c891cb209458e4027bf90ddf005c80ddc17f');
  await page.locator('#draft-model').fill('package Changed {}');expect(await page.locator('#draft-result').textContent()).toBe('No current observation.');
  await page.locator('#draft-file').setInputFiles({name:'project.json',mimeType:'application/json',buffer:saved});
  await expect(page.locator('#draft-mode')).toHaveValue('project');await expect(page.locator('#draft-model')).toHaveValue('package B {}');
  await analyze(page);const reopened=await observation(page);expect(reopened.preview).toEqual(native);
});
test('physical project edit stop and restart invalidate observations and reject source list forgery',async({page})=>{
  await twoSources(page);await page.locator('#draft-analyze').click();await expect(page.locator('#draft-stop')).toBeEnabled();
  await page.locator('#draft-model').fill('package Fresh {}');await expect(page.locator('#draft-result')).toHaveText('No current observation.');
  await expect(page.locator('#draft-stop')).toBeDisabled();await page.locator('#draft-analyze').click();await page.locator('#draft-stop').click();
  await expect(page.locator('#draft-status')).toContainText('Analysis stopped');await analyze(page);expect((await observation(page)).status).toBe('available');
  const saved=JSON.parse(await save(page));const duplicate={...saved,sources:[saved.sources[0],saved.sources[0]]};
  await page.locator('#draft-file').setInputFiles({name:'duplicate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(duplicate))});
  await expect(page.locator('#draft-file-status')).toContainText('Could not open');expect((await observation(page)).status).toBe('available');
  await page.locator('#draft-source-select').selectOption(saved.sources[0].uri);await page.locator('#draft-source-uri').fill(saved.sources[1].uri);await page.locator('#draft-source-uri').dispatchEvent('change');
  await expect(page.locator('#draft-file-status')).toContainText('Duplicate');await expect(page.locator('#draft-source-uri')).toHaveValue(saved.sources[0].uri);
});
