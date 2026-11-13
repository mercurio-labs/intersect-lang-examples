// Verification-only draft. Install only after actual public/typed phase coupling passes.
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../.runtime/intersect-text/',import.meta.url);
const plan=JSON.parse(readFileSync(new URL('fixtures/rcore-scalar-comparison/public/worker-plan.json',root),'utf8'));
const cases=plan.cases;
const observer=readFileSync(new URL('fixtures/rcore-scalar-comparison/public/resource-worker-observer.js',root),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
const wasmSha=sha(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
const expected=c=>c.complete;
const check=(c,value)=>{assert.deepEqual(value,expected(c));assert.equal(value.evaluation.value.data.Scalar.payload,c.literal_expected);};
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


export {test,expect,assert,readFileSync,sha,cases,plan,check,boot,rpc,probe,held,collect,start,configure};
