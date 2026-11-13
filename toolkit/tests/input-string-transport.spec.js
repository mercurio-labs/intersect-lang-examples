// Real application-created language/execution workers, actual input-copy Pending.
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../.runtime/intersect-text/',import.meta.url);
const plan=JSON.parse(readFileSync(new URL('fixtures/rcore-input-string-transport/plan.json',root),'utf8'));
const observer=readFileSync(new URL('fixtures/rcore-input-string-transport/string-worker-observer.js',root),'utf8');
const phaseWitness=JSON.parse(readFileSync(new URL('fixtures/rcore-input-string-transport/phase-witness.json',root),'utf8'));
const copyCheckpoint=phaseWitness.copy,measureCheckpoint=phaseWitness.measure;
const sha=b=>createHash('sha256').update(b).digest('hex');
const publicSha=sha(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
const [ascii,unicode]=plan.cases;
assert.equal(sha(readFileSync(new URL(phaseWitness.original_plan.path,root))),phaseWitness.original_plan.sha256);
assert.deepEqual(phaseWitness.entry,ascii.request.entry);assert.equal(phaseWitness.quantum,256);
assert.deepEqual(copyCheckpoint.phase.slice(0,2),['decode','string-copy']);assert.ok(copyCheckpoint.phase[2][7]>0&&copyCheckpoint.phase[2][7]<copyCheckpoint.phase[2][6]);
const request=c=>c.request;
const expectedDebit=c=>({...Object.fromEntries(Object.keys(c.complete.evaluation.consumed).map(k=>[k,0])),value_bytes:c.decoder_admission});
async function boot(page,context,instrument=false){
 if(instrument)await context.route(/\/[^/]*language\.worker[^/]*\.js(?:\?.*)?$/,async route=>{const response=await route.fetch();await route.fulfill({response,body:observer+'\n'+await response.text()});});
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.stringTraces=[];window.stringReplies={};window.stringRequests=new Map();window.stringWorkers=[];
  window.Worker=class extends NativeWorker{
   constructor(url,options){super(url,options);if(String(url).includes('language.worker')){window.stringWorker=this;window.stringWorkers.push(this);this.addEventListener('message',({data})=>{if(data.method==='qualification/stringTrace')window.stringTraces.push(data.params);if(data.id!==undefined){window.stringReplies[data.id]=(window.stringReplies[data.id]||0)+1;const p=window.stringRequests.get(data.id);if(p){window.stringRequests.delete(data.id);data.error?p.reject(new Error(data.error.message)):p.resolve(data.result);}}});}}
   terminate(){this.qualificationTerminated=true;return super.terminate();}
  };
  window.stringSend=(id,method,params={})=>new Promise((resolve,reject)=>{window.stringRequests.set(id,{resolve,reject});window.stringWorker.postMessage({jsonrpc:'2.0',id,method,params});});
 });
 await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
 const loaded=await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch('/intersect_web.wasm',{cache:'no-store'})).arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''));assert.equal(loaded,publicSha);
}
const rpc=(page,id,method,params={})=>page.evaluate(({id,method,params})=>window.stringSend(id,method,params),{id,method,params});
const probe=(page,id,params)=>rpc(page,id,'qualification/probeStringHost',params);
const held=page=>page.evaluate(()=>window.stringTraces.filter(v=>v.kind==='held'));
async function configure(page,all=false,checkpoint=copyCheckpoint){await rpc(page,'configure','qualification/configureString',{enabled:true,all,counts:{[ascii.literal_bytes]:checkpoint.poll}});}
async function start(page,id,c=ascii){await page.evaluate(({id,params})=>{window[id]=window.stringSend(id,'intersect/evaluateFunctionRcore',params).then(result=>({result}),error=>({error:error.message}));},{id,params:request(c)});}
const collect=(page,id)=>page.evaluate(id=>window[id],id);
function check(c,result){assert.deepEqual(result,c.complete);assert.deepEqual(result.program,c.request.expected_program);const payload=result.evaluation.value.data.Scalar.payload;assert.equal(sha(Buffer.from(payload)),c.literal_sha256);assert.equal(Buffer.byteLength(payload),c.literal_bytes);assert.equal(payload,c.id==='ascii240000'?'x'.repeat(240000):String.fromCodePoint(34,92,10,9,0,233,128512).repeat(2048));}
async function cancelled(page,id,c,checkpoint=copyCheckpoint){const value=await collect(page,id);assert.equal(value.result.failure.kind,'Cancelled');assert.deepEqual(value.result.failure,checkpoint.failure);if(checkpoint===copyCheckpoint)assert.deepEqual(value.result.failure.consumed,expectedDebit(c));assert.ok(!Object.hasOwn(value.result,'evaluation'));return value;}

test('retained input/output uses unmodified application worker with exact ASCII, escaped Unicode and nested source results',async({page,context})=>{
 test.setTimeout(120000);await boot(page,context);
 for(const c of plan.cases)check(c,await rpc(page,'complete-'+c.id,'intersect/evaluateFunctionRcore',request(c)));
 for(const c of plan.nested)for(const invalid of [false,true]){const params=c[invalid?'invalid':'sync'];assert.deepEqual(await rpc(page,c.id+'-'+invalid,'intersect/evaluateFunctionRcore',params),c[invalid?'invalid_complete':'complete']);}
});

test('input measurement Pending cancels before scalar admission with the exact original source failure',async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);await configure(page,false,measureCheckpoint);await start(page,'measureCancel');await expect.poll(async()=>(await held(page)).length).toBe(1);
 const point=(await held(page))[0];assert.equal(point.resumes,measureCheckpoint.poll);assert.equal(point.context,ascii.literal_bytes);assert.equal(await page.evaluate(()=>window.stringReplies.measureCancel||0),0);
 await rpc(page,'cancel-measure','$/cancelRequest',{id:'measureCancel'});await rpc(page,'release-measure','qualification/releaseString',{token:point.token});await cancelled(page,'measureCancel',ascii,measureCheckpoint);
 check(ascii,await rpc(page,'measure-recovery','intersect/evaluateFunctionRcore',request(ascii)));assert.equal(await page.evaluate(()=>window.stringReplies.measureCancel),1);
 await testInfo.attach('actual-input-measure-cancel',{body:JSON.stringify(await page.evaluate(()=>window.stringTraces)),contentType:'application/json'});
});

test('input-copy Pending cancels before publication and concurrent/recovery jobs preserve complete source results',async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);await configure(page);await start(page,'inputCancel');await expect.poll(async()=>(await held(page)).length).toBe(1);
 const point=(await held(page))[0];assert.equal(point.resumes,copyCheckpoint.poll);assert.equal(point.context,240000);assert.equal(await page.evaluate(()=>window.stringReplies.inputCancel||0),0);
 check(unicode,await rpc(page,'concurrent','intersect/evaluateFunctionRcore',request(unicode)));
 await rpc(page,'cancel','$/cancelRequest',{id:'inputCancel'});await rpc(page,'release','qualification/releaseString',{token:point.token});await cancelled(page,'inputCancel',ascii);
 for(const [id,job]of [['stale',point.job],['foreign','foreign-input-host:1']])assert.equal((await probe(page,id,{method:'rcore_behavior/resumeFunction',job,quantum:1})).error,'Unknown, stale or foreign function job');
 check(ascii,await rpc(page,'recovery','intersect/evaluateFunctionRcore',request(ascii)));assert.equal(await page.evaluate(()=>window.stringReplies.inputCancel),1);
 await testInfo.attach('actual-input-copy-cancel',{body:JSON.stringify(await page.evaluate(()=>window.stringTraces)),contentType:'application/json'});
});

test('input-copy drop releases the actual host slot and held concurrent jobs cancel without published values',async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);await configure(page,true);
 for(let i=0;i<4;i++){await start(page,'inputDrop'+i);await expect.poll(async()=>(await held(page)).length).toBe(i+1);}
 await assert.rejects(()=>rpc(page,'manager-limit','intersect/evaluateFunctionRcore',request(ascii)),/Active function job budget exceeded/);
 assert.equal((await probe(page,'native-limit',{...request(ascii),method:'rcore_behavior/startFunction'})).error,'Active function job budget exceeded (4)');
 const points=await held(page);assert.deepEqual((await probe(page,'drop',{method:'rcore_behavior/dropFunction',job:points[0].job})).response,{dropped:true});
 await rpc(page,'disable','qualification/configureString',{enabled:false,all:false,counts:{}});await rpc(page,'release-dropped','qualification/releaseString',{token:points[0].token});assert.equal((await collect(page,'inputDrop0')).error,'Unknown, stale or foreign function job');
 check(ascii,await rpc(page,'slot-recovery','intersect/evaluateFunctionRcore',request(ascii)));
 for(let i=1;i<4;i++)await rpc(page,'cancel-'+i,'$/cancelRequest',{id:'inputDrop'+i});await rpc(page,'release-others','qualification/releaseString');for(let i=1;i<4;i++)await cancelled(page,'inputDrop'+i,ascii);
 assert.equal((await probe(page,'stale-drop',{method:'rcore_behavior/dropFunction',job:points[0].job})).error,'Unknown, stale or foreign function job');
 check(unicode,await rpc(page,'final-recovery','intersect/evaluateFunctionRcore',request(unicode)));
 await testInfo.attach('actual-input-copy-drop',{body:JSON.stringify(await page.evaluate(()=>window.stringTraces)),contentType:'application/json'});
});

test('project save and replacement terminate held input work before a fresh worker admits the same original source',async({page,context},testInfo)=>{
 test.setTimeout(120000);await boot(page,context,true);
 const before=await rpc(page,'before-inspect','intersect/inspect');await page.locator('.ide-file-menu > summary').click();const saving=page.waitForEvent('download');await page.locator('#save-project').click();const download=await saving,bytes=readFileSync(await download.path());
 await configure(page);await start(page,'replacedInput');await expect.poll(async()=>(await held(page)).length).toBe(1);const point=(await held(page))[0];await page.evaluate(()=>{window.oldInputWorker=window.stringWorker;window.oldInputCount=window.stringWorkers.length;});
 if(!await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();await page.locator('#new-empty-project').click();
 await expect.poll(()=>page.evaluate(()=>window.stringWorkers.length)).toBeGreaterThan(await page.evaluate(()=>window.oldInputCount));assert.equal(await page.evaluate(()=>window.oldInputWorker.qualificationTerminated),true);
 await expect(page.locator('#compile')).toBeEnabled({timeout:60000});assert.equal((await rpc(page,'empty-inspect','intersect/inspect')).package,null);await page.locator('#project-file').setInputFiles({name:'input-retained.intersect.json',mimeType:'application/json',buffer:bytes});await expect(page.locator('#compile')).toBeEnabled({timeout:60000});await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
 const restored=await rpc(page,'after-inspect','intersect/inspect');assert.deepEqual(restored.package,before.package);assert.deepEqual(restored.evaluation,before.evaluation);assert.notEqual(restored.interfaceRevision,before.interfaceRevision);
 check(unicode,await rpc(page,'new-host-first','intersect/evaluateFunctionRcore',request(unicode)));
 assert.equal((await probe(page,'old-host-job',{method:'rcore_behavior/resumeFunction',job:point.job,quantum:1})).error,'Unknown, stale or foreign function job');
 assert.equal(await page.evaluate(()=>window.stringReplies.replacedInput||0),0);check(ascii,await rpc(page,'new-host-recovery','intersect/evaluateFunctionRcore',request(ascii)));
 await testInfo.attach('actual-input-project-replacement',{body:JSON.stringify({project_sha256:sha(bytes),saved:JSON.parse(bytes),traces:await page.evaluate(()=>window.stringTraces),old_job:point.job,old_reply_count:await page.evaluate(()=>window.stringReplies.replacedInput||0)}),contentType:'application/json'});
});
