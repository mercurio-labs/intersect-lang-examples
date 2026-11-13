// Actual app-created language worker and its persistent execution worker/ABI.
// Prefix-only test observation delays genuine messages; it fabricates no results.
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../.runtime/intersect-text/',import.meta.url);
const plan=JSON.parse(readFileSync(new URL('fixtures/rcore-string-transport/plan.json',root),'utf8'));
const observer=readFileSync(new URL('fixtures/rcore-string-transport/string-worker-observer.js',root),'utf8');
const fixtures=Object.fromEntries(plan.cases.map(c=>[c.id,JSON.parse(readFileSync(new URL(`fixtures/rcore-string-transport/${c.id}.json`,root),'utf8'))]));
const sha=b=>createHash('sha256').update(b).digest('hex');
const publicSha=sha(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
async function boot(page,context,instrument=false){
  if(instrument)await context.route(/\/[^/]*language\.worker[^/]*\.js(?:\?.*)?$/,async route=>{
    const response=await route.fetch(),original=await response.text();
    await route.fulfill({response,body:observer+'\n'+original});
  });
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;window.stringTraces=[];window.stringReplies={};window.stringRequests=new Map();window.stringNext=0;
    window.Worker=class extends NativeWorker{
      constructor(url,options){super(url,options);if(String(url).includes('language.worker')){
        window.stringWorker=this;
        this.addEventListener('message',({data})=>{
          if(data.method==='qualification/stringTrace')window.stringTraces.push(data.params);
          if(data.id!==undefined){window.stringReplies[data.id]=(window.stringReplies[data.id]||0)+1;const p=window.stringRequests.get(data.id);if(p){window.stringRequests.delete(data.id);data.error?p.reject(new Error(data.error.message)):p.resolve(data.result);}}
        });
      }}
    };
    window.stringSend=(id,method,params={})=>new Promise((resolve,reject)=>{window.stringRequests.set(id,{resolve,reject});window.stringWorker.postMessage({jsonrpc:'2.0',id,method,params});});
  });
  await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  const hash=await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch('/intersect_web.wasm',{cache:'no-store'})).arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''));
  assert.equal(hash,publicSha);
}
const rpc=(page,id,method,params={})=>page.evaluate(({id,method,params})=>window.stringSend(id,method,params),{id,method,params});
const fixture=c=>fixtures[c.id].request;
function check(c,result){assert.deepEqual(result,c.complete);const text=c.id==='ascii-original'?'x'.repeat(240000):String.fromCodePoint(34,92,10,9,0,233,128512).repeat(8192);assert.equal(result.evaluation.value.data.Scalar.payload,text);assert.equal(sha(Buffer.from(text)),c.literal_payload_sha256);assert.deepEqual(result.program,fixture(c).expected_program);}
async function start(page,id,c){await page.evaluate(({id,params})=>{window[id]=window.stringSend(id,'intersect/evaluateFunctionRcore',params).then(result=>({result}),error=>({error:error.message}));},{id,params:fixture(c)});}
const collect=(page,id)=>page.evaluate(id=>window[id],id);
const held=page=>page.evaluate(()=>window.stringTraces.filter(x=>x.kind==='held'));
const counts=Object.fromEntries(plan.cases.map(c=>[c.model_context,c.last_pending_resume_q256]));
const probe=(page,id,request)=>rpc(page,id,'qualification/probeStringHost',request);

test('default String results use the unmodified application worker for both exact stored source contexts',async({page,context})=>{
  test.setTimeout(120000);await boot(page,context);
  for(const c of plan.cases)check(c,await rpc(page,`complete-${c.id}`,'intersect/evaluateFunctionRcore',fixture(c)));
});

test('real late-copy Pending cancels through application RPC while concurrent work and same-host recovery remain exact',async({page,context},testInfo)=>{
  test.setTimeout(120000);await boot(page,context,true);
  const [target,other]=plan.cases;
  await rpc(page,'configure','qualification/configureString',{enabled:true,all:false,counts:{[target.model_context]:target.last_pending_resume_q256}});
  await start(page,'lateTarget',target);
  await expect.poll(async()=> (await held(page)).length).toBe(1);
  const point=(await held(page))[0];assert.equal(point.context,target.model_context);assert.equal(point.resumes,target.last_pending_resume_q256);
  const before=await page.evaluate(()=>window.stringReplies.lateTarget||0);assert.equal(before,0);
  check(other,await rpc(page,'concurrent','intersect/evaluateFunctionRcore',fixture(other)));
  const authoring=await rpc(page,'authoring','intersect/parseRcore',{uri:'memory:string-copy-authoring.rcore',text:'rcore 1;package authoring version "1";'});assert.equal(authoring.ok,true);
  await rpc(page,'cancel','$/cancelRequest',{id:'lateTarget'});
  await rpc(page,'release','qualification/releaseString',{token:point.token});
  const result=await collect(page,'lateTarget');assert.equal(result.result.ok,false);assert.equal(result.result.failure.kind,'Cancelled');assert.deepEqual(result.result.failure.consumed,target.complete.evaluation.consumed);assert.ok(!Object.hasOwn(result.result,'evaluation'));
  for(const [id,job]of [['stale',point.job],['foreign','foreign-string-host:1']]){
    const denied=await probe(page,id,{method:'rcore_behavior/resumeFunction',job,quantum:1});assert.equal(denied.error,'Unknown, stale or foreign function job');assert.ok(!Object.hasOwn(denied,'response'));
  }
  check(target,await rpc(page,'recovery','intersect/evaluateFunctionRcore',fixture(target)));
  assert.equal(await page.evaluate(()=>window.stringReplies.lateTarget),1);
  await testInfo.attach('actual-worker-trace',{body:JSON.stringify(await page.evaluate(()=>window.stringTraces)),contentType:'application/json'});
});

test('late-copy native drop on the actual worker releases its slot and manager error recovery preserves other jobs',async({page,context},testInfo)=>{
  test.setTimeout(120000);await boot(page,context,true);
  await rpc(page,'configure-all','qualification/configureString',{enabled:true,all:true,counts});
  for(let i=0;i<4;i++){await start(page,`heldJob${i}`,plan.cases[i%2]);await expect.poll(async()=> (await held(page)).length).toBe(i+1);}
  await assert.rejects(()=>rpc(page,'manager-budget','intersect/evaluateFunctionRcore',fixture(plan.cases[0])),/Active function job budget exceeded/);
  const nativeBudget=await probe(page,'native-budget',fixture(plan.cases[0]));assert.equal(nativeBudget.error,'Active function job budget exceeded (4)');
  const points=await held(page);assert.equal(await page.evaluate(()=>window.stringReplies.heldJob0||0),0);
  const dropped=await probe(page,'drop',{method:'rcore_behavior/dropFunction',job:points[0].job});assert.deepEqual(dropped.response,{dropped:true});
  await rpc(page,'disable','qualification/configureString',{enabled:false,all:false,counts:{}});
  await rpc(page,'release-dropped','qualification/releaseString',{token:points[0].token});
  const failed=await collect(page,'heldJob0');assert.equal(failed.error,'Unknown, stale or foreign function job');assert.ok(!Object.hasOwn(failed,'result'));
  check(plan.cases[0],await rpc(page,'slot-recovery','intersect/evaluateFunctionRcore',fixture(plan.cases[0])));
  for(let i=1;i<4;i++)await rpc(page,`cancel-${i}`,'$/cancelRequest',{id:`heldJob${i}`});
  await rpc(page,'release-other','qualification/releaseString');
  for(let i=1;i<4;i++){const cancelled=await collect(page,`heldJob${i}`);assert.equal(cancelled.result.failure.kind,'Cancelled');assert.ok(!Object.hasOwn(cancelled.result,'evaluation'));assert.deepEqual(cancelled.result.failure.consumed,plan.cases[i%2].complete.evaluation.consumed);}
  const stale=await probe(page,'drop-stale',{method:'rcore_behavior/dropFunction',job:points[0].job});assert.equal(stale.error,'Unknown, stale or foreign function job');
  check(plan.cases[1],await rpc(page,'final-recovery','intersect/evaluateFunctionRcore',fixture(plan.cases[1])));
  assert.equal(await page.evaluate(()=>window.stringReplies.heldJob0),1);
  await testInfo.attach('actual-worker-drop-budget-trace',{body:JSON.stringify(await page.evaluate(()=>window.stringTraces)),contentType:'application/json'});
});
