// Real application-created language/execution workers, actual general ResourcePending.
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../.runtime/intersect-text/',import.meta.url);
const plan=JSON.parse(readFileSync(new URL('fixtures/rcore-json-resource/plan.json',root),'utf8'));
const observer=readFileSync(new URL('fixtures/rcore-json-resource/resource-worker-observer.js',root),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
const publicSha=sha(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
const invalid=plan.cases.find(c=>c.id==='label_nested_json_invalid'),positive=plan.cases.find(c=>c.id==='labels_sequence');
const request=c=>c.request;

async function boot(page,context,instrument=false){
 if(instrument)await context.route(/\/[^/]*language\.worker[^/]*\.js(?:\?.*)?$/,async route=>{const response=await route.fetch();await route.fulfill({response,body:observer+'\n'+await response.text()});});
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.resourceTraces=[];window.resourceReplies={};window.resourceRequests=new Map();window.resourceWorkers=[];
  window.Worker=class extends NativeWorker{
   constructor(url,options){super(url,options);if(String(url).includes('language.worker')){window.resourceWorker=this;window.resourceWorkers.push(this);this.addEventListener('message',({data})=>{if(data.method==='qualification/resourceTrace')window.resourceTraces.push(data.params);if(data.id!==undefined){window.resourceReplies[data.id]=(window.resourceReplies[data.id]||0)+1;const p=window.resourceRequests.get(data.id);if(p){window.resourceRequests.delete(data.id);data.error?p.reject(new Error(data.error.message)):p.resolve(data.result);}}});}}
   terminate(){this.qualificationTerminated=true;return super.terminate();}
  };
  window.resourceSend=(id,method,params={})=>new Promise((resolve,reject)=>{window.resourceRequests.set(id,{resolve,reject});window.resourceWorker.postMessage({jsonrpc:'2.0',id,method,params});});
 });
 await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
 const loaded=await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch('/intersect_web.wasm',{cache:'no-store'})).arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''));assert.equal(loaded,publicSha);
}
const rpc=(page,id,method,params={})=>page.evaluate(({id,method,params})=>window.resourceSend(id,method,params),{id,method,params});
const probe=(page,id,params)=>rpc(page,id,'qualification/probeResourceHost',params);
const held=page=>page.evaluate(()=>window.resourceTraces.filter(v=>v.kind==='held'));
async function configure(page,all=false){await rpc(page,'configure','qualification/configureResource',{enabled:true,all,counts:{'memory:s09-label_nested_json_invalid.rcore':3}});}
async function start(page,id,c=invalid){await page.evaluate(({id,params})=>{window[id]=window.resourceSend(id,'intersect/evaluateFunctionRcore',params).then(result=>({result}),error=>({error:error.message}));},{id,params:request(c)});}
const collect=(page,id)=>page.evaluate(id=>window[id],id);
function check(c,result){assert.deepEqual(result,c.complete);assert.deepEqual(result.program,c.request.expected_program);if(c.intended_positive)assert.deepEqual(result.evaluation.value,c.literal_expected_echo);}
async function cancelled(page,id){const value=await collect(page,id);assert.deepEqual(value.result,plan.cancel_result);assert.equal(value.result.failure.kind,'Cancelled');assert.ok(!Object.hasOwn(value.result,'evaluation'));return value;}

test('general resource frontier preserves all six exact source-backed application worker outcomes',async({page,context})=>{
 test.setTimeout(120000);await boot(page,context);
 for(const c of plan.cases)check(c,await rpc(page,'complete-'+c.id,'intersect/evaluateFunctionRcore',request(c)));
});
test('actual ResourcePending rejects invalid quantum, cancels without publication and preserves concurrent recovery',async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);await configure(page);await start(page,'resourceCancel');await expect.poll(async()=>(await held(page)).length).toBe(1);
 const point=(await held(page))[0];assert.equal(point.resumes,3);assert.equal(point.context,invalid.request.entry.uri);assert.equal(await page.evaluate(()=>window.resourceReplies.resourceCancel||0),0);
 for(const [i,quantum]of[0,'1',null,4097].entries()){const v=await probe(page,'bad-quantum-'+i,{method:'rcore_behavior/resumeFunction',job:point.job,quantum});assert.equal(v.error,i===0||i===3?'Scheduling quantum must be 1..4096':'Invalid scheduling quantum');}
 check(positive,await rpc(page,'concurrent','intersect/evaluateFunctionRcore',request(positive)));
 await rpc(page,'cancel','$/cancelRequest',{id:'resourceCancel'});await rpc(page,'release','qualification/releaseResource',{token:point.token});await cancelled(page,'resourceCancel');
 for(const [id,job]of[['stale',point.job],['foreign','foreign-resource-host:1']])assert.equal((await probe(page,id,{method:'rcore_behavior/resumeFunction',job,quantum:1})).error,'Unknown, stale or foreign function job');
 check(positive,await rpc(page,'recovery','intersect/evaluateFunctionRcore',request(positive)));assert.equal(await page.evaluate(()=>window.resourceReplies.resourceCancel),1);
 await testInfo.attach('actual-resource-cancel',{body:JSON.stringify(await page.evaluate(()=>window.resourceTraces)),contentType:'application/json'});
});
test('ResourcePending drop releases actual host slots and stale identities while other jobs cancel and recover',async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);await configure(page,true);
 for(let i=0;i<4;i++){await start(page,'resourceDrop'+i);await expect.poll(async()=>(await held(page)).length).toBe(i+1);}
 await assert.rejects(()=>rpc(page,'manager-limit','intersect/evaluateFunctionRcore',request(invalid)),/Active function job budget exceeded/);
 assert.equal((await probe(page,'native-limit',{...request(invalid),method:'rcore_behavior/startFunction'})).error,'Active function job budget exceeded (4)');
 const points=await held(page);assert.deepEqual((await probe(page,'drop',{method:'rcore_behavior/dropFunction',job:points[0].job})).response,{dropped:true});
 await rpc(page,'disable','qualification/configureResource',{enabled:false,all:false,counts:{}});await rpc(page,'release-dropped','qualification/releaseResource',{token:points[0].token});assert.equal((await collect(page,'resourceDrop0')).error,'Unknown, stale or foreign function job');
 check(positive,await rpc(page,'slot-recovery','intersect/evaluateFunctionRcore',request(positive)));
 for(let i=1;i<4;i++)await rpc(page,'cancel-'+i,'$/cancelRequest',{id:'resourceDrop'+i});await rpc(page,'release-others','qualification/releaseResource');for(let i=1;i<4;i++)await cancelled(page,'resourceDrop'+i);
 assert.equal((await probe(page,'stale-drop',{method:'rcore_behavior/dropFunction',job:points[0].job})).error,'Unknown, stale or foreign function job');check(positive,await rpc(page,'final-recovery','intersect/evaluateFunctionRcore',request(positive)));
 await testInfo.attach('actual-resource-drop',{body:JSON.stringify(await page.evaluate(()=>window.resourceTraces)),contentType:'application/json'});
});
test('project save and replacement terminate held resource work before a fresh worker admits the same original source',async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);
 const before=await rpc(page,'before-inspect','intersect/inspect');await page.locator('.ide-file-menu > summary').click();const saving=page.waitForEvent('download');await page.locator('#save-project').click();const download=await saving,bytes=readFileSync(await download.path());
 await configure(page);await start(page,'replacedResource');await expect.poll(async()=>(await held(page)).length).toBe(1);const point=(await held(page))[0];await page.evaluate(()=>{window.oldResourceWorker=window.resourceWorker;window.oldResourceCount=window.resourceWorkers.length;});
 if(!await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();await page.locator('#new-empty-project').click();
 await expect.poll(()=>page.evaluate(()=>window.resourceWorkers.length)).toBeGreaterThan(await page.evaluate(()=>window.oldResourceCount));assert.equal(await page.evaluate(()=>window.oldResourceWorker.qualificationTerminated),true);
 await expect(page.locator('#compile')).toBeEnabled({timeout:60000});assert.equal((await rpc(page,'empty-inspect','intersect/inspect')).package,null);await page.locator('#project-file').setInputFiles({name:'resource-retained.intersect.json',mimeType:'application/json',buffer:bytes});await expect(page.locator('#compile')).toBeEnabled({timeout:60000});await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
 const restored=await rpc(page,'after-inspect','intersect/inspect');assert.deepEqual(restored.package,before.package);assert.deepEqual(restored.evaluation,before.evaluation);assert.notEqual(restored.interfaceRevision,before.interfaceRevision);
 check(positive,await rpc(page,'new-host-first','intersect/evaluateFunctionRcore',request(positive)));
 assert.equal((await probe(page,'old-host-job',{method:'rcore_behavior/resumeFunction',job:point.job,quantum:1})).error,'Unknown, stale or foreign function job');
 assert.equal(await page.evaluate(()=>window.resourceReplies.replacedResource||0),0);check(positive,await rpc(page,'new-host-recovery','intersect/evaluateFunctionRcore',request(positive)));
 await testInfo.attach('actual-resource-project-replacement',{body:JSON.stringify({project_sha256:sha(bytes),saved:JSON.parse(bytes),traces:await page.evaluate(()=>window.resourceTraces),old_job:point.job,old_reply_count:await page.evaluate(()=>window.resourceReplies.replacedResource||0)}),contentType:'application/json'});
});

for (const point of plan.copy_points) test(`admitted general JSON ${point.lane} copy cancels and drops before publication with source-exact recovery`,async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);
 const c=plan.cases.find(c=>c.id===plan.copy_case);
 const configureCopy=()=>rpc(page,'copy-configure-'+point.lane,'qualification/configureResource',{enabled:true,all:false,counts:{[c.request.entry.uri]:point.resumes}});
 await configureCopy();await start(page,'copyCancel',c);await expect.poll(async()=>(await held(page)).length).toBe(1);
 let h=(await held(page))[0];assert.equal(h.resumes,point.resumes);assert.equal(h.context,c.request.entry.uri);assert.equal(await page.evaluate(()=>window.resourceReplies.copyCancel||0),0);
 assert.deepEqual(point.phase_witness.general_phase.slice(0,2),[point.lane,'copy']);assert.ok(point.phase_witness.general_phase[2][7]>0);
 for(const [id,quantum]of[['zero-copy',0],['wrong-copy','1']])assert.equal((await probe(page,id,{method:'rcore_behavior/resumeFunction',job:h.job,quantum})).error,quantum===0?'Scheduling quantum must be 1..4096':'Invalid scheduling quantum');
 await rpc(page,'copy-cancel','$/cancelRequest',{id:'copyCancel'});await rpc(page,'copy-release-cancel','qualification/releaseResource',{token:h.token});
 const cancelledCopy=await collect(page,'copyCancel');assert.deepEqual(cancelledCopy.result,point.cancel_result);assert.equal(cancelledCopy.result.failure.kind,'Cancelled');assert.ok(!Object.hasOwn(cancelledCopy.result,'evaluation'));
 assert.equal((await probe(page,'copy-cancel-stale',{method:'rcore_behavior/resumeFunction',job:h.job,quantum:1})).error,'Unknown, stale or foreign function job');
 check(c,await rpc(page,'copy-cancel-recovery','intersect/evaluateFunctionRcore',request(c)));
 await configureCopy();await start(page,'copyDrop',c);await expect.poll(async()=>(await held(page)).length).toBe(2);h=(await held(page))[1];
 assert.equal(h.resumes,point.resumes);assert.equal(await page.evaluate(()=>window.resourceReplies.copyDrop||0),0);
 assert.deepEqual((await probe(page,'copy-drop',{method:'rcore_behavior/dropFunction',job:h.job})).response,{dropped:true});
 await rpc(page,'copy-disable','qualification/configureResource',{enabled:false,counts:{}});await rpc(page,'copy-release-drop','qualification/releaseResource',{token:h.token});assert.equal((await collect(page,'copyDrop')).error,'Unknown, stale or foreign function job');
 check(c,await rpc(page,'copy-drop-recovery','intersect/evaluateFunctionRcore',request(c)));
 await testInfo.attach('actual-general-json-copy-'+point.lane,{body:JSON.stringify({native_phase:point.phase_witness,public_native:plan.copy_public_native,public_wasm:plan.copy_public_wasm,traces:await page.evaluate(()=>window.resourceTraces)}),contentType:'application/json'});
});

// Actual application-created worker, backed by the same-source native phase witness.
for(const point of plan.scalar_points)test(`actual retained scalar ${point.id} rejects stale work, cancels and drops before publication`,async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);
 const c=plan.cases.find(c=>c.id==='bytes_large');
 const configureScalar=()=>rpc(page,'scalar-configure-'+point.id,'qualification/configureResource',{enabled:true,all:false,counts:{[c.request.entry.uri]:point.resumes}});
 await configureScalar();await start(page,'scalarCancel',c);await expect.poll(async()=>(await held(page)).length).toBe(1);
 let h=(await held(page))[0];assert.equal(h.resumes,point.resumes);assert.equal(h.context,c.request.entry.uri);assert.equal(await page.evaluate(()=>window.resourceReplies.scalarCancel||0),0);
 assert.equal(point.phase_witness.scalar_phase[0],'hex');assert.ok(point.phase_witness.scalar_phase[1]>0);assert.equal(point.phase_witness.scalar_phase[2],240000);
 for(const [i,quantum]of[0,'1',null,4097].entries())assert.equal((await probe(page,'scalar-quantum-'+i,{method:'rcore_behavior/resumeFunction',job:h.job,quantum})).error,i===0||i===3?'Scheduling quantum must be 1..4096':'Invalid scheduling quantum');
 check(positive,await rpc(page,'scalar-concurrent','intersect/evaluateFunctionRcore',request(positive)));
 await rpc(page,'scalar-cancel','$/cancelRequest',{id:'scalarCancel'});await rpc(page,'scalar-release','qualification/releaseResource',{token:h.token});
 const result=await collect(page,'scalarCancel');assert.deepEqual(result.result,point.cancel_result);assert.ok(!Object.hasOwn(result.result,'evaluation'));
 for(const [id,job]of[['scalar-stale',h.job],['scalar-foreign','foreign-scalar:1']])assert.equal((await probe(page,id,{method:'rcore_behavior/resumeFunction',job,quantum:1})).error,'Unknown, stale or foreign function job');
 check(c,await rpc(page,'scalar-recovery','intersect/evaluateFunctionRcore',request(c)));
 await configureScalar();await start(page,'scalarDrop',c);await expect.poll(async()=>(await held(page)).length).toBe(2);h=(await held(page))[1];assert.equal(h.resumes,point.resumes);
 assert.equal(await page.evaluate(()=>window.resourceReplies.scalarDrop||0),0);assert.deepEqual((await probe(page,'scalar-drop',{method:'rcore_behavior/dropFunction',job:h.job})).response,{dropped:true});
 await rpc(page,'scalar-disable','qualification/configureResource',{enabled:false,counts:{}});await rpc(page,'scalar-release-dropped','qualification/releaseResource',{token:h.token});assert.equal((await collect(page,'scalarDrop')).error,'Unknown, stale or foreign function job');
 check(c,await rpc(page,'scalar-drop-recovery','intersect/evaluateFunctionRcore',request(c)));
 let replacement=null;
 if(point.id==='hex-late'){
  const before=await rpc(page,'scalar-before-project','intersect/inspect');await page.locator('.ide-file-menu > summary').click();const saving=page.waitForEvent('download');await page.locator('#save-project').click();const download=await saving,bytes=readFileSync(await download.path());
  await configureScalar();await start(page,'scalarReplaced',c);await expect.poll(async()=>(await held(page)).length).toBe(3);const old=(await held(page))[2];
  await page.evaluate(()=>{window.scalarOldWorker=window.resourceWorker;window.scalarOldCount=window.resourceWorkers.length;});
  if(!await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();await page.locator('#new-empty-project').click();
  await expect.poll(()=>page.evaluate(()=>window.resourceWorkers.length)).toBeGreaterThan(await page.evaluate(()=>window.scalarOldCount));assert.equal(await page.evaluate(()=>window.scalarOldWorker.qualificationTerminated),true);
  await expect(page.locator('#compile')).toBeEnabled({timeout:60000});assert.equal((await rpc(page,'scalar-empty','intersect/inspect')).package,null);
  await page.locator('#project-file').setInputFiles({name:'scalar-retained.intersect.json',mimeType:'application/json',buffer:bytes});await expect(page.locator('#compile')).toBeEnabled({timeout:60000});await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  const restored=await rpc(page,'scalar-restored','intersect/inspect');assert.deepEqual(restored.package,before.package);assert.deepEqual(restored.evaluation,before.evaluation);
  check(c,await rpc(page,'scalar-new-host','intersect/evaluateFunctionRcore',request(c)));assert.equal((await probe(page,'scalar-old-id',{method:'rcore_behavior/resumeFunction',job:old.job,quantum:1})).error,'Unknown, stale or foreign function job');assert.equal(await page.evaluate(()=>window.resourceReplies.scalarReplaced||0),0);
  replacement={saved_project_sha:sha(bytes),saved:JSON.parse(bytes),old_job:old.job,old_reply_count:await page.evaluate(()=>window.resourceReplies.scalarReplaced||0)};
 }
 await testInfo.attach('actual-scalar-'+point.id,{body:JSON.stringify({native_phase:point.phase_witness,native:plan.transport_native,wasm:plan.transport_wasm,replacement,traces:await page.evaluate(()=>window.resourceTraces)}),contentType:'application/json'});
});
