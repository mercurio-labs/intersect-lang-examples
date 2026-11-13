import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function twoSources(page){
  await page.goto('/prepared-draft.html');await page.locator('#draft-mode').selectOption('project');
  await page.locator('#draft-model').fill('package A {}');await page.locator('#draft-source-uri').fill('memory://physical/a.kerml');await page.locator('#draft-source-uri').dispatchEvent('change');
  await page.locator('#draft-source-add').click();await page.locator('#draft-model').fill('package B {}');
  await page.locator('#draft-source-uri').fill('memory://physical/b.kerml');await page.locator('#draft-source-uri').dispatchEvent('change');
}
async function analyze(page){await page.locator('#draft-analyze').click();await expect(page.locator('#draft-status')).toContainText(/KerML construction available|KerML construction has diagnostics|Draft unavailable/,{timeout:125000});}
async function save(page){const pending=page.waitForEvent('download');await page.locator('#draft-save').click();return readFile(await(await pending).path());}
test('real worker project mode returns complete DTO and keeps executable APIs unavailable',async({page})=>{
  await twoSources(page);const project=JSON.parse(await save(page));
  const result=await page.evaluate(async project=>{
    const worker=new Worker('/src/language.worker.js',{type:'module'});let id=0;const pending=new Map();
    worker.onmessage=({data})=>{const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(new Error(data.error.message)):p.resolve(data.result);}};
    const request=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});worker.postMessage({id:key,method,params});});
    try{await request('initialize');const native=await request('intersect/prepareKerMLPhysicalProject',{original:project.original,sources:project.sources,version:1});
      const inspected=await request('intersect/inspect');const saved=await request('intersect/preparedDraftProject',{presentation:project.presentation});let denied;
      try{await request('intersect/query',{query:'all'});}catch(error){denied=error.message;}
      return {native,inspected,saved,denied};
    }finally{worker.terminate();}
  },project);
  expect(result.native.status).toBe('available');expect(result.inspected.mode).toBe('prepared-physical-project');
  expect(result.inspected.package).toBeNull();expect(result.inspected.evaluation).toBeNull();expect(result.saved).toEqual(project);
  expect(result.denied).toContain('cannot query');expect(result.native.preview.sources).toHaveLength(2);
});
