import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const read=name=>JSON.parse(readFileSync(new URL(`../.runtime/intersect-text/fixtures/xtext/inferred-host-contexts/${name}`,import.meta.url),'utf8'));
const plan=read('plan.json'),contexts=read('contexts.json');
async function raw(page,method,params={}){return page.evaluate(({method,params})=>new Promise((resolve,reject)=>{const worker=window.nominalWorker,id=`nominal:${window.nominalRequest=(window.nominalRequest||0)+1}`,listener=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',listener);resolve(data);},timer=setTimeout(()=>{worker.removeEventListener('message',listener);reject(new Error('Worker timeout'));},15000);worker.addEventListener('message',listener);worker.postMessage({jsonrpc:'2.0',id,method,params});}),{method,params});}
async function call(page,method,params={}){const result=await raw(page,method,params);assert.equal(result.error,undefined,JSON.stringify(result.error));return result.result;}
test('actual worker queries nominal values after source activation and rejects stale queries',async({page})=>{
 test.setTimeout(120000);
 await page.addInitScript(()=>{const Native=window.Worker;window.Worker=class extends Native{constructor(url,options){super(url,options);if(String(url).includes('language.worker'))window.nominalWorker=this;}};});
 await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
 for(const name of ['catalog','loans'])await call(page,'textDocument/didClose',{textDocument:{uri:`file:///models/${name}.library`}});
 await call(page,'textDocument/didOpen',{textDocument:{uri:'memory:nominal-worker.model',version:1,text:'paint',languageId:'intersect-model'}});
 for(const c of plan.cases){
  const context=contexts.find(x=>x.id===c.id).inference_context;assert.equal((await call(page,'intersect/compileInferred',{inference:c.inference,inference_context:context})).ok,true);
  const state=await call(page,'intersect/inspect');assert.deepEqual(state.evaluation.diagnostics,[]);
  const paint=state.evaluation.model.elements.find(e=>state.package.schema.declarations[e.class].name==='Paint');
  const query={schema_uri:state.package.schema.uri,schema_revision:state.package.schema.revision,from:paint.class,select:[{name:'color',expression:{op:'field',path:'color'}}],limit:10};
  const request={query,interfaceRevision:state.interfaceRevision,generation:state.generation};
  assert.deepEqual((await call(page,'intersect/query',request)).rows,[[paint.values.color]]);
  const ordered=structuredClone(request);ordered.query.order_by=[{expression:{op:'field',path:'color'}}];assert.match((await raw(page,'intersect/query',ordered)).error.message,/ordering/);
  assert.match((await raw(page,'intersect/query',{...request,generation:state.generation-1})).error.message,/Stale query/);
  assert.deepEqual(await call(page,'intersect/inspect'),state);
  assert.deepEqual((await call(page,'intersect/query',request)).rows,[[paint.values.color]]);
 }
});
