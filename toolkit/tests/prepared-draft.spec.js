import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const observation=async page=>JSON.parse(await page.locator('#draft-result').textContent());
async function analyze(page){await page.locator('#draft-analyze').click();await expect(page.locator('#draft-status')).toContainText(/KerML construction available|KerML construction has diagnostics|Draft unavailable/,{timeout:125000});}
function checkDraft(result,name){
  expect(result.language_validated).toBe(false);expect(result.publication_permitted).toBe(false);
  const native=result.preview;
  expect(native.kind).toBe('frozen_kerml_load');expect(native.linked).toBe(false);
  expect(native.language_validated).toBe(false);expect(native.publication_permitted).toBe(false);
  expect(native.diagnostics).toEqual([]);
  expect(native.model.elements.map(e=>e.class).sort()).toEqual(['Namespace','OwningMembership','Package']);
  expect(native.model.elements.find(e=>e.class==='Package').values.declaredName).toBe(name);
}
test('real native draft P/Q, unsupported/recovery and exact source-only save/reopen',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/prepared-draft.html');
  await expect(page.locator('#draft-scope')).toContainText('Unvalidated');
  await expect(page.locator('#draft-original')).toHaveAttribute('readonly','');
  const originalText=await page.locator('#draft-original').inputValue();
  await expect(page.locator('#draft-original-identity')).toContainText('629610 bytes');
  await analyze(page);checkDraft(await observation(page),'P');
  const download=page.waitForEvent('download');await page.locator('#draft-save').click();
  const saved=await readFile(await(await download).path());const project=JSON.parse(saved);
  expect(project.format).toBe('intersect.toolkit.project.v7');expect(Object.keys(project).sort()).toEqual(['format','mode','model','original','presentation']);
  const exactOriginal=project.original.bundle.sources[0].text;
  expect(Buffer.byteLength(exactOriginal)).toBe(629610);
  expect(createHash('sha256').update(exactOriginal).digest('hex')).toBe('22719934c65588180fc19658f8a7c891cb209458e4027bf90ddf005c80ddc17f');
  // Textarea rendering normalizes CRLF. Persistence and native hashing use the
  // untouched source recipe, never the rendered read-only view.
  expect(exactOriginal.replace(/\r\n?/g,'\n')).toBe(originalText);
  expect(project.model.text).toBe('package P {}');
  await page.locator('#draft-model').fill('package Q {}');
  await expect(page.locator('#draft-result')).toHaveText('No current observation.');
  await analyze(page);checkDraft(await observation(page),'Q');
  await page.locator('#draft-model').fill('class C;');await analyze(page);
  await expect(page.locator('#draft-status')).toContainText('KerML construction has diagnostics');
  const rejected=await observation(page);
  expect(rejected.status).toBe('rejected');expect(rejected.preview.diagnostics.length).toBeGreaterThan(0);
  await page.locator('#draft-file').setInputFiles({name:'draft.intersect.json',mimeType:'application/json',buffer:saved});
  await expect(page.locator('#draft-file-status')).toContainText('opened');
  await expect(page.locator('#draft-model')).toHaveValue('package P {}');
  await expect(page.locator('#draft-result')).toHaveText('No current observation.');
  await analyze(page);checkDraft(await observation(page),'P');
  const forged={...project,package:{forged:true}};
  await page.locator('#draft-file').setInputFiles({name:'forged.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(forged))});
  await expect(page.locator('#draft-file-status')).toContainText('Could not open');
  checkDraft(await observation(page),'P');
  expect(errors).toEqual([]);
});

test('edit/stop disposes an in-flight worker, clears previews and permits fresh recovery',async({page})=>{
  await page.goto('/prepared-draft.html');await page.locator('#draft-analyze').click();
  await expect(page.locator('#draft-stop')).toBeEnabled();
  await page.locator('#draft-model').fill('package Q {}');
  await expect(page.locator('#draft-result')).toHaveText('No current observation.');
  await expect(page.locator('#draft-stop')).toBeDisabled();
  await page.locator('#draft-analyze').click();await page.locator('#draft-stop').click();
  await expect(page.locator('#draft-status')).toContainText('Analysis stopped');
  await expect(page.locator('#draft-result')).toHaveText('No current observation.');
  await analyze(page);checkDraft(await observation(page),'Q');
});

test('ordinary Library still compiles and links to the isolated draft page',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.locator('.ide-file-menu > summary').click();
  await expect(page.getByRole('link',{name:'KerML drafts · unvalidated'})).toHaveAttribute('href','/prepared-draft.html');
  await page.locator('.ide-file-menu > summary').click();
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#model-samples > summary').click();
  await page.locator('[data-model-sample="circulation"]').click();
  await expect(page.locator('#element-count')).toHaveText('9 elements');
});
