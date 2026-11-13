import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function download(page,button){const pending=page.waitForEvent('download');await button.click();return readFile(await (await pending).path());}
async function modelJson(page){await page.locator('.ide-file-menu > summary').click();return JSON.parse(await download(page,page.locator('#export')));}
async function saveProject(page){await page.locator('.ide-file-menu > summary').click();return JSON.parse(await download(page,page.locator('#save-project')));}
async function upload(page,action,name,bytes){const chooser=page.waitForEvent('filechooser');await page.locator(`.resource-controls [data-action="${action}"]`).click();await (await chooser).setFiles({name,mimeType:'application/json',buffer:bytes});}
function elements(model){return [...model.elements].sort((a,b)=>a.id.localeCompare(b.id));}

test.beforeEach(async({page})=>{
  await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();await page.locator('.resource-controls > summary').click();
});

test('selected resource unload and reload preserve references and unrelated content',async({page})=>{
  test.setTimeout(90000);
  const before=await modelJson(page),catalog=Object.keys(before.model.resources).find(uri=>uri.endsWith('catalog.library'));
  expect(catalog).toBeTruthy();
  await page.getByRole('checkbox',{name:`Select resource ${catalog}`,exact:true}).check();
  const bytes=await download(page,page.locator('.resource-controls [data-action="export"]'));
  expect(JSON.parse(bytes).resources.map(resource=>resource.uri)).toEqual([catalog]);
  await page.locator('.resource-controls [data-discard]').check();
  await page.locator('.resource-controls [data-action="unload"]').click();
  await expect(page.locator('.resource-status')).toContainText('content unloaded');
  await expect(page.locator('.resource-list')).toContainText(`${catalog} · Unloaded`);
  const suspended=await saveProject(page);
  expect(suspended.resources.model.resources[catalog].unloaded.identities.length).toBeGreaterThan(0);
  expect(suspended.resources.model.elements.every(element=>element.resource!==catalog)).toBe(true);
  await upload(page,'reload','bad.resources.json',Buffer.from(JSON.stringify({format:'intersect.resource-files.v1',codec:'xmi',resources:[{uri:catalog,bytes:[60,98,97,100,62]}]})));
  await expect(page.locator('.resource-status')).not.toContainText('reloaded and validated');
  await expect(page.locator('.resource-list')).toContainText(`${catalog} · Unloaded`);
  await upload(page,'reload','model.resources.json',bytes);
  await expect(page.locator('.resource-status')).toContainText('reloaded and validated');
  const after=await modelJson(page);
  expect(elements(after.model)).toEqual(elements(before.model));expect(after.derived).toEqual(before.derived);
  await page.setViewportSize({width:390,height:844});
  expect(await page.locator('.resource-controls').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});

test('prepared library caches reload through actual WASM and reject corrupt artifacts',async({page})=>{
  test.setTimeout(90000);
  const before=await modelJson(page);
  for(const checkbox of await page.locator('.resource-list input').all())await checkbox.check();
  const bytes=await download(page,page.locator('.resource-controls [data-action="prepareCache"]'));
  const cache=JSON.parse(bytes);expect(cache.version).toBe(1);expect(cache.resources).toHaveLength(2);expect(cache.identity.runtime).toMatch(/^[0-9a-f]{64}$/);
  await page.locator('.resource-controls [data-discard]').check();await page.locator('.resource-controls [data-action="unload"]').click();
  await expect(page.locator('#element-count')).toHaveText('0 elements');
  const corrupt=Buffer.from(bytes);corrupt[0]=0;
  await upload(page,'loadCache','corrupt.cache.json',corrupt);
  await expect(page.locator('.resource-status')).toContainText('Invalid prepared cache');
  await expect(page.locator('#element-count')).toHaveText('0 elements');
  await upload(page,'loadCache','library.cache.json',bytes);
  await expect(page.locator('.resource-status')).toContainText('loaded and validated');
  const after=await modelJson(page);expect(elements(after.model)).toEqual(elements(before.model));expect(after.derived).toEqual(before.derived);
});

test('project save and reopen preserve empty resources and unavailable target identities',async({page})=>{
  test.setTimeout(120000);
  await page.getByRole('textbox',{name:'New resource URI',exact:true}).fill('notes.library');
  await page.locator('.resource-controls [data-action="create"]').click();await expect(page.locator('.resource-list')).toContainText('notes.library · Loaded');
  const catalog=await page.locator('.resource-list input').evaluateAll(inputs=>inputs.map(input=>input.value).find(uri=>uri.endsWith('catalog.library')));
  await page.getByRole('checkbox',{name:`Select resource ${catalog}`,exact:true}).check();
  const resourceBytes=await download(page,page.locator('.resource-controls [data-action="export"]'));
  await page.locator('.resource-controls [data-discard]').check();await page.locator('.resource-controls [data-action="unload"]').click();
  await expect(page.locator('.resource-status')).toContainText('content unloaded');
  const saved=await saveProject(page);expect(saved.format).toBe('intersect.toolkit.resource-project.v1');
  await page.reload();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.locator('.ide-file-menu > summary').click();const chooser=page.waitForEvent('filechooser');await page.locator('#open-project').click();
  await (await chooser).setFiles({name:'resources.intersect.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await page.getByRole('tab',{name:'Test',exact:true}).click();await page.locator('.resource-controls > summary').click();
  await expect(page.locator('.resource-list')).toContainText(`${catalog} · Unloaded`,{timeout:60000});
  await expect(page.locator('.resource-list')).toContainText('notes.library · Loaded');
  await page.getByRole('checkbox',{name:`Select resource ${catalog}`,exact:true}).check();
  await upload(page,'reload','model.resources.json',resourceBytes);await expect(page.locator('.resource-status')).toContainText('reloaded and validated');
  const after=await saveProject(page);expect(after.resources.model.resources['notes.library'].roots).toEqual([]);
  expect(after.resources.model.elements).toHaveLength(6);
});
