import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const fixture=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/rcore-reference-domain-pending/worker-plan.json',import.meta.url),'utf8'));
const observer=readFileSync(new URL('../.runtime/intersect-text/fixtures/rcore-reference-domain-pending/resource-worker-observer.js',import.meta.url),'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
for(const source of fixture.requests.params.bundle.sources)assert.equal(sha(source.text),source.id.sha256);
for(const point of fixture.points)assert.equal(point.cancel_result.failure.consumed.reference_domains,point.resumes-1);
async function boot(page,context){
 await context.route(/\/[^/]*language\.worker[^/]*\.js(?:\?.*)?$/,async route=>{const response=await route.fetch();await route.fulfill({response,body:observer+'\n'+await response.text()});});
 await page.addInitScript(()=>{const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(url,options){super(url,options);if(String(url).includes('language.worker'))window.qualificationLanguageWorkerUrl=String(url);}};});
 await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
 await page.evaluate(async()=>{
  const worker=new Worker(window.qualificationLanguageWorkerUrl,{type:'module'});window.phaseWorker=worker;window.phaseTraces=[];window.phaseReplies={};window.phasePending=new Map();
  worker.onmessage=({data})=>{if(data.method==='qualification/resourceTrace'){window.phaseTraces.push(data.params);if(data.params.kind==='request'&&data.params.request.method==='rcore_behavior/resumeFunction'&&window.phaseAwaitDispatched){window.phaseAwaitDispatched();window.phaseAwaitDispatched=null;}}if(data.id!==undefined){window.phaseReplies[data.id]=(window.phaseReplies[data.id]||0)+1;const p=window.phasePending.get(data.id);if(p){window.phasePending.delete(data.id);data.error?p.reject(Error(data.error.message)):p.resolve(data.result);}}};
  window.phaseSend=(id,method,params={})=>new Promise((resolve,reject)=>{window.phasePending.set(id,{resolve,reject});worker.postMessage({jsonrpc:'2.0',id,method,params});});
  await window.phaseSend('init','initialize');
 });
}
const rpc=(page,id,method,params={})=>page.evaluate(({id,method,params})=>window.phaseSend(id,method,params),{id,method,params});
async function start(page){await page.evaluate(params=>{window.phaseLarge=window.phaseSend('large','intersect/evaluateFunctionRcore',params);},fixture.requests.params);}
function assertRealPrefix(traces,count){const starts=traces.filter(v=>v.kind==='request'&&v.request.method==='rcore_behavior/startFunction'&&v.context===fixture.requests.params.entry.uri);assert.equal(starts.length,1);const token=starts[0].token;const requests=traces.filter(v=>v.kind==='request'&&v.token===token&&v.request.method==='rcore_behavior/resumeFunction');const responses=traces.filter(v=>v.kind==='response'&&v.data.token===token&&v.request.method==='rcore_behavior/resumeFunction');assert.equal(requests.length,count);assert.equal(responses.length,count);const id=responses[0].data.response.job;for(let i=0;i<count;i++){assert.equal(requests[i].request.quantum,256);assert.equal(requests[i].request.job,id);assert.equal(responses[i].request.job,id);assert.deepEqual(responses[i].data.response,{pending:true,job:id});assert.equal(responses[i].resumes,i+1);}return id;}
async function finish(page,testInfo,point){const result=await page.evaluate(()=>window.phaseLarge);assert.deepEqual(result,point.cancel_result);assert.equal(Object.hasOwn(result,'evaluation'),false);assert.equal(await page.evaluate(()=>window.phaseReplies.large),1);const traces=await page.evaluate(()=>window.phaseTraces);const id=assertRealPrefix(traces,point.resumes);const stale=await rpc(page,'stale','qualification/probeResourceHost',{method:'rcore_behavior/resumeFunction',job:id,quantum:256});assert.deepEqual(stale,{token:'qualification-probe:stale',error:'Unknown, stale or foreign function job'});assert.deepEqual(await rpc(page,'recovery','intersect/evaluateFunctionRcore',fixture.requests.small),point.recovery_result);await testInfo.attach('reference-domain-prefix-'+point.resumes,{body:JSON.stringify({point,traces:await page.evaluate(()=>window.phaseTraces),large:result,recovery:point.recovery_result}),contentType:'application/json'});await page.evaluate(()=>window.phaseWorker.terminate());}

test('second genuine q256 Pending retains the installed reference domain and exact cancellation',async({page,context},testInfo)=>{
 test.setTimeout(180000);await boot(page,context);await rpc(page,'configure','qualification/configureResource',{enabled:true,counts:{[fixture.requests.params.entry.uri]:2}});await start(page);await expect.poll(()=>page.evaluate(()=>window.phaseTraces.filter(v=>v.kind==='held').length)).toBe(1);const traces=await page.evaluate(()=>window.phaseTraces),id=assertRealPrefix(traces,2),held=traces.find(v=>v.kind==='held');assert.equal(held.job,id);assert.equal(held.resumes,2);assert.equal(await page.evaluate(()=>window.phaseReplies.large||0),0);
 const probe=await rpc(page,'probe','intersect/parseRcore',{uri:'memory:probe-behavior.rcore',text:'rcore 1;package probe version "1";'});assert.equal(probe.ok,true);await rpc(page,'cancel','$/cancelRequest',{id:'large'});await rpc(page,'release','qualification/releaseResource',{token:held.token});await finish(page,testInfo,fixture.points[1]);
});
