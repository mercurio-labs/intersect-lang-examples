// Verification-only draft. Install only after actual public/typed phase coupling passes.
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../.runtime/intersect-text/',import.meta.url);
const cases=JSON.parse(readFileSync(new URL('fixtures/rcore-numeric-payload/public/worker-plan.json',root),'utf8'));
const observer=readFileSync(new URL('fixtures/rcore-numeric-payload/public/resource-worker-observer.js',root),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
const wasmSha=sha(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
const expected=c=>({stage:'function_execution',ok:true,source_backed:true,program:c.request.expected_program,evaluation:c.typed_complete_before_public.Ok});
const check=(c,value)=>{assert.deepEqual(value,expected(c));assert.deepEqual(value.evaluation.value,c.literal_expected_value);};
async function boot(page,context,instrument=false){
 if(instrument)await context.route(/\/[^/]*language\.worker[^/]*\.js(?:\?.*)?$/,async route=>{const response=await route.fetch();await route.fulfill({response,body:observer+'\n'+await response.text()});});
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.numericTraces=[];window.numericReplies={};window.numericRequests=new Map();window.numericWorkers=[];
  window.Worker=class extends NativeWorker{
   constructor(url,options){super(url,options);if(String(url).includes('language.worker')){window.numericWorker=this;window.numericWorkers.push(this);this.addEventListener('message',({data})=>{if(data.method==='qualification/resourceTrace')window.numericTraces.push(data.params);if(data.id!==undefined){window.numericReplies[data.id]=(window.numericReplies[data.id]||0)+1;const p=window.numericRequests.get(data.id);if(p){window.numericRequests.delete(data.id);data.error?p.reject(new Error(data.error.message)):p.resolve(data.result);}}});}}
   terminate(){this.qualificationTerminated=true;return super.terminate();}
  };
  window.numericSend=(id,method,params={})=>new Promise((resolve,reject)=>{window.numericRequests.set(id,{resolve,reject});window.numericWorker.postMessage({jsonrpc:'2.0',id,method,params});});
 });
 await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
 const loaded=await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch('/intersect_web.wasm',{cache:'no-store'})).arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''));assert.equal(loaded,wasmSha);
}
const rpc=(page,id,method,params={})=>page.evaluate(({id,method,params})=>window.numericSend(id,method,params),{id,method,params});
const probe=(page,id,params)=>rpc(page,id,'qualification/probeResourceHost',params);
const held=page=>page.evaluate(()=>window.numericTraces.filter(v=>v.kind==='held'));
const collect=(page,id)=>page.evaluate(id=>window[id],id);
async function start(page,id,c){await page.evaluate(({id,params})=>{window[id]=window.numericSend(id,'intersect/evaluateFunctionRcore',params).then(result=>({result}),error=>({error:error.message}));},{id,params:c.request});}
const configure=(page,id,c,point,all=false)=>rpc(page,id,'qualification/configureResource',{enabled:true,all,counts:{[c.request.entry.uri]:point.resumes}});

test('all original numeric String/Bytes/Unicode sources preserve complete actual worker outcomes',async({page,context})=>{
 test.setTimeout(120000);await boot(page,context);
 for(const c of cases)check(c,await rpc(page,'complete-'+c.id,'intersect/evaluateFunctionRcore',c.request));
});

test('actual numeric left/right measurement Pending cancels and drops with exact recovery',async({page,context},testInfo)=>{
 test.setTimeout(180000);await boot(page,context,true);
 let sequence=0;
 for(const c of cases)for(const point of c.typed_owned_phase_points){
  // The plan is admitted for browser use only after fresh SomeRegistry typed + ABI checks.
  assert.equal(point.public_phase_verified,true);assert.ok(point.actual_numeric_phase[1][1]>0);
  const tag=String(sequence++),before=(await held(page)).length;
  await configure(page,'configure-'+tag,c,point);await start(page,'numericCancel'+tag,c);await expect.poll(async()=>(await held(page)).length).toBe(before+1);
  let h=(await held(page)).at(-1);assert.equal(h.resumes,point.resumes);assert.equal(h.context,c.request.entry.uri);assert.equal(await page.evaluate(id=>window.numericReplies[id]||0,'numericCancel'+tag),0);
  for(const [i,quantum]of [0,'1',null,4097].entries())assert.equal((await probe(page,'quantum-'+tag+'-'+i,{method:'rcore_behavior/resumeFunction',job:h.job,quantum})).error,i===0||i===3?'Scheduling quantum must be 1..4096':'Invalid scheduling quantum');
  const concurrent=cases.find(x=>x.id==='string_escaped_unicode');check(concurrent,await rpc(page,'concurrent-'+tag,'intersect/evaluateFunctionRcore',concurrent.request));
  await rpc(page,'cancel-'+tag,'$/cancelRequest',{id:'numericCancel'+tag});await rpc(page,'release-cancel-'+tag,'qualification/releaseResource',{token:h.token});
  const cancellation=await collect(page,'numericCancel'+tag);assert.deepEqual(cancellation.result,point.cancel_result);assert.equal(cancellation.result.failure.kind,'Cancelled');assert.equal(Object.hasOwn(cancellation.result,'evaluation'),false);
  for(const [suffix,job]of [['stale',h.job],['foreign','foreign-numeric:1']])assert.equal((await probe(page,tag+suffix,{method:'rcore_behavior/resumeFunction',job,quantum:1})).error,'Unknown, stale or foreign function job');
  check(c,await rpc(page,'recovery-cancel-'+tag,'intersect/evaluateFunctionRcore',c.request));
  await configure(page,'configure-drop-'+tag,c,point);await start(page,'numericDrop'+tag,c);await expect.poll(async()=>(await held(page)).length).toBe(before+2);h=(await held(page)).at(-1);
  assert.deepEqual((await probe(page,'drop-'+tag,{method:'rcore_behavior/dropFunction',job:h.job})).response,{dropped:true});
  await rpc(page,'disable-'+tag,'qualification/configureResource',{enabled:false,counts:{}});await rpc(page,'release-drop-'+tag,'qualification/releaseResource',{token:h.token});assert.equal((await collect(page,'numericDrop'+tag)).error,'Unknown, stale or foreign function job');
  check(c,await rpc(page,'recovery-drop-'+tag,'intersect/evaluateFunctionRcore',c.request));
 }
 await testInfo.attach('numeric-left-right-cancel-drop',{body:JSON.stringify({cases,traces:await page.evaluate(()=>window.numericTraces)}),contentType:'application/json'});
});

test('numeric Pending project replacement terminates old worker and restores exact saved language',async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);const c=cases[0],point=c.typed_owned_phase_points.at(-1);assert.equal(point.public_phase_verified,true);
 const before=await rpc(page,'inspect-before','intersect/inspect');await page.locator('.ide-file-menu > summary').click();const saving=page.waitForEvent('download');await page.locator('#save-project').click();const bytes=readFileSync(await(await saving).path());
 await configure(page,'configure-project',c,point);await start(page,'numericReplaced',c);await expect.poll(async()=>(await held(page)).length).toBe(1);const old=(await held(page))[0];
 await page.evaluate(()=>{window.numericOld=window.numericWorker;window.numericOldCount=window.numericWorkers.length;});
 if(!await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();await page.locator('#new-empty-project').click();
 await expect.poll(()=>page.evaluate(()=>window.numericWorkers.length)).toBeGreaterThan(await page.evaluate(()=>window.numericOldCount));assert.equal(await page.evaluate(()=>window.numericOld.qualificationTerminated),true);
 await expect(page.locator('#compile')).toBeEnabled({timeout:60000});assert.equal((await rpc(page,'empty','intersect/inspect')).package,null);
 await page.locator('#project-file').setInputFiles({name:'numeric-retained.intersect.json',mimeType:'application/json',buffer:bytes});await expect(page.locator('#compile')).toBeEnabled({timeout:60000});await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
 const restored=await rpc(page,'restored','intersect/inspect');assert.deepEqual(restored.package,before.package);assert.deepEqual(restored.evaluation,before.evaluation);assert.notEqual(restored.interfaceRevision,before.interfaceRevision);
 check(c,await rpc(page,'fresh-host','intersect/evaluateFunctionRcore',c.request));assert.equal((await probe(page,'old-id',{method:'rcore_behavior/resumeFunction',job:old.job,quantum:1})).error,'Unknown, stale or foreign function job');assert.equal(await page.evaluate(()=>window.numericReplies.numericReplaced||0),0);
 await testInfo.attach('numeric-project-replacement',{body:JSON.stringify({project_sha256:sha(bytes),saved:JSON.parse(bytes),old_job:old.job,traces:await page.evaluate(()=>window.numericTraces)}),contentType:'application/json'});
});
