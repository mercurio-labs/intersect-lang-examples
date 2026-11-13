import {readFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
import {inferenceCases, inferenceObservations, inferenceInputs, modelProjection} from './inferred-archive-browser.js';

const metadata={package_id:'worker.inference',release:'1',display_name:'Worker inferred language',description:''};
const uri='memory:worker-inference.model';
async function observeWorker(page){
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{
      constructor(url,options){super(url,options);if(String(url).includes('language.worker')){window.observedInferenceWorker=this;window.inferenceModelEvents=[];this.addEventListener('message',({data})=>{if(data.method==='intersect/model')window.inferenceModelEvents.push(data.params);});}}
    };
  });
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
}
async function raw(page,method,params={}){
  return page.evaluate(({method,params})=>new Promise((resolve,reject)=>{
    const worker=window.observedInferenceWorker;
    const id=`inference-worker:${window.inferenceRequestId=(window.inferenceRequestId||0)+1}`;
    const listener=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',listener);resolve(data);};
    const timer=setTimeout(()=>{worker.removeEventListener('message',listener);reject(new Error('Observed language worker did not respond'));},15000);
    worker.addEventListener('message',listener);worker.postMessage({jsonrpc:'2.0',id,method,params});
  }),{method,params});
}
async function call(page,method,params={}){const response=await raw(page,method,params);assert.equal(response.error,undefined,JSON.stringify(response.error));return response.result;}
async function closeExamples(page){for(const name of ['catalog','loans'])await call(page,'textDocument/didClose',{textDocument:{uri:`file:///models/${name}.library`}});}
async function model(page,text,version=1){await call(page,'textDocument/didOpen',{textDocument:{uri,version,text,languageId:'intersect-model'}});}
const inspect=page=>call(page,'intersect/inspect');
async function archive(page,python){const state=await inspect(page);const d=await call(page,'intersect/packageExport',{revision:state.interfaceRevision,metadata});return unpackLanguageArchive(await packageArchive(d,python));}

// This file runs against both Vite and the static production bundle. All requests
// pass through the actual language worker constructed by the application client.
test('inferred worker executes frozen models and rebuilds both ZIP forms',async({page})=>{
  test.setTimeout(180000);await observeWorker(page);await closeExamples(page);
  let positives=0,negatives=0;
  for(const c of inferenceCases){
    const input=inferenceInputs(c);
    const compiled=await call(page,'intersect/compileInferred',{inference:input});
    assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.package.xtext_inference,input);
    assert.equal(compiled.package.compilation,undefined);
    assert.equal(compiled.package.grammar.profile,'intersect.xtext.native.v56');
    for(const run of inferenceObservations.runs.filter(r=>r.case===c.id&&r.entry==='resource')){
      await model(page,run.text);const expected=await inspect(page);
      assert.equal(expected.evaluation.diagnostics.length===0,run.accepted);
      if(run.accepted){positives++;assert.deepEqual(modelProjection(expected.package,expected.evaluation.model),run.model);}else{negatives++;assert.deepEqual(expected.evaluation.model.elements,[]);}
      for(const python of [false,true]){
        const files=await archive(page,python);assert.deepEqual(JSON.parse(files['definitions/inference.json']),input);
        const before=await inspect(page);const eventCount=await page.evaluate(()=>window.inferenceModelEvents.length);
        const loaded=await call(page,'intersect/packageImport',{files,revision:before.interfaceRevision,keywords:['forged']});
        assert.equal(loaded.ok,true);assert.deepEqual(loaded.package,compiled.package);
        const after=await inspect(page);assert.equal(after.revision,before.revision+1);assert.equal(after.generation,before.generation+1);
        assert.deepEqual(after.evaluation,expected.evaluation);
        const events=await page.evaluate(n=>window.inferenceModelEvents.slice(n),eventCount);assert.equal(events.length,1);assert.equal(events[0].revision,after.revision);assert.equal(events[0].generation,after.generation);assert.deepEqual(events[0].model,after.evaluation.model);
      }
    }
  }
  assert.deepEqual([positives,negatives],[7,4]);
});

test('inferred worker preserves active state after failures and replays into a fresh worker',async({page})=>{
  test.setTimeout(120000);await observeWorker(page);await closeExamples(page);await model(page,'alpha');
  const input=inferenceInputs(inferenceCases[0]);
  const compiled=await call(page,'intersect/compileInferred',{inference:input});assert.equal(compiled.ok,true);
  const preparedState=await inspect(page);
  // Fail model preparation after a different candidate language has compiled.
  // Active package/model publication must be atomic even at this transport edge.
  const oversized=await raw(page,'textDocument/didOpen',{textDocument:{uri,version:2,text:'a'.repeat(4_200_000),languageId:'intersect-model'}});
  assert.match(oversized.error.message,/input budget/);
  const deniedCandidate=await raw(page,'intersect/compileInferred',{inference:inferenceInputs(inferenceCases[1])});
  assert.match(deniedCandidate.error.message,/input budget/);
  assert.deepEqual(await inspect(page),preparedState);
  await model(page,'alpha',3);
  const before=await inspect(page),files=await archive(page,true);
  assert.deepEqual(before.evaluation.diagnostics,[]);
  const invalid=structuredClone(input);invalid.version=99;
  assert.equal((await call(page,'intersect/compileInferred',{inference:invalid})).ok,false);
  for(const params of [{inference:input,bindings:{}},{inference:input,xtext_profile:'intersect.xtext.native.v56'},{inference:{...input,unknown:true}}])assert.ok((await raw(page,'intersect/compileInferred',params)).error);
  assert.deepEqual(await inspect(page),before);
  const corrupted=structuredClone(files);const pkg=JSON.parse(corrupted['package.json']);pkg.schema.uri='urn:forged';corrupted['package.json']=JSON.stringify(pkg);
  const manifest=JSON.parse(corrupted['manifest.json']);manifest.files['package.json']={bytes:Buffer.byteLength(corrupted['package.json']),sha256:createHash('sha256').update(corrupted['package.json']).digest('hex')};corrupted['manifest.json']=JSON.stringify(manifest);
  assert.ok((await raw(page,'intersect/packageImport',{files:corrupted,revision:before.interfaceRevision})).error);
  assert.ok((await raw(page,'intersect/packageImport',{files,revision:'stale'})).error);
  assert.deepEqual(await inspect(page),before);
  const query={schema_uri:before.package.schema.uri,schema_revision:before.package.schema.revision,from:before.evaluation.model.elements[0].class,select:[{name:'name',expression:{op:'field',path:'name'}}],limit:10};
  assert.deepEqual((await call(page,'intersect/query',{query,interfaceRevision:before.interfaceRevision,generation:before.generation})).rows,[['alpha']]);
  const xmi=await call(page,'intersect/modelExport',{format:'xmi'});
  await call(page,'intersect/modelImport',{format:'xmi',resources:xmi.resources,interfaceRevision:before.interfaceRevision,generation:before.generation});
  const imported=await inspect(page);assert.deepEqual(modelProjection(imported.package,imported.evaluation.model),modelProjection(before.package,before.evaluation.model));
  assert.equal(imported.modelOrigin,'import');
  await call(page,'intersect/packageImport',{files,revision:imported.interfaceRevision});
  assert.ok((await raw(page,'intersect/packageExport',{metadata,revision:before.interfaceRevision})).error);
  assert.ok((await raw(page,'intersect/query',{query,interfaceRevision:before.interfaceRevision,generation:before.generation})).error);
  const active=await inspect(page);assert.equal(active.modelOrigin,'text');assert.deepEqual(active.evaluation.model,before.evaluation.model);
  const tx=await call(page,'intersect/transactionBegin',{disposable:true});assert.deepEqual(tx.package,active.package);
  await call(page,'intersect/packageImport',{files,revision:active.interfaceRevision});
  assert.ok((await raw(page,'intersect/testFinish',{transactionId:tx.transaction.context.id,interfaceRevision:tx.interfaceRevision,generation:tx.generation,model:tx.evaluation.model})).error);
  await call(page,'intersect/transactionFinish',{id:tx.transaction.context.id,status:'rolled_back',reason:'language changed',changes_complete:true});
  await page.evaluate(()=>{window.beforeInferenceRestart=window.observedInferenceWorker;});
  await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
  // The old status text remains visible while start() awaits the new worker.
  // Wait on the actual replacement worker and its completed ordinary activation.
  await expect.poll(()=>page.evaluate(()=>window.observedInferenceWorker!==window.beforeInferenceRestart)).toBe(true);
  await expect.poll(async()=>{const s=await inspect(page);return {ordinary:!!s.package?.compilation,elements:s.evaluation?.model?.elements.length};}).toEqual({ordinary:true,elements:6});
  await expect(page.locator('#active-revision')).toHaveText('ACTIVE · REV 1');
  await closeExamples(page);await model(page,'alpha');const fresh=await inspect(page);
  assert.notEqual(fresh.interfaceRevision,active.interfaceRevision);
  await call(page,'intersect/packageImport',{files,revision:fresh.interfaceRevision});
  const recovered=await inspect(page);assert.deepEqual(recovered.package,before.package);assert.deepEqual(recovered.evaluation,before.evaluation);
  assert.deepEqual((await call(page,'textDocument/completion',{textDocument:{uri},position:{line:0,character:0}})).items.map(i=>i.label),['alpha']);
});

const providerPlan=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inferred-host-contexts/plan.json',import.meta.url),'utf8'));
const providerContexts=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inferred-host-contexts/contexts.json',import.meta.url),'utf8'));
function convertedPaint(state,context,count=2){
  assert.deepEqual((state.evaluation??state).diagnostics,[]);
  const model=state.evaluation?.model ?? state.model;
  assert.equal(model.elements.length,count);
  const package_=state.package;
  const paint=model.elements.find(e=>package_.schema.declarations[e.class].name==='Paint');
  assert.equal(package_.schema.declarations[paint.class].namespace,'urn:inferred:paint');
  const contract=context.conversions[0];
  assert.deepEqual(paint.values.color,{kind:'converted',datatype:contract.datatype,provider:contract.provider,value:{red:18,green:58,blue:188}});
  assert.deepEqual(Object.keys(paint.values),['color']);
  if(count===2){const root=model.elements.find(e=>e.id!==paint.id);assert.deepEqual(root.values,{child:paint.id});}
}
test('explicit inferred catalog executes actual defaults, named entries and source ZIPs with atomic worker activation',async({page})=>{
  test.setTimeout(180000);await observeWorker(page);await closeExamples(page);await model(page,'paint');
  let last;
  for(const c of providerPlan.cases){
    const context=providerContexts.find(r=>r.id===c.id).inference_context;
    const compiled=await call(page,'intersect/compileInferred',{inference:c.inference,inference_context:context});assert.equal(compiled.ok,true);
    let state=await inspect(page);convertedPaint(state,context);assert.deepEqual(state.package.xtext_inference,c.inference);
    const preview=await call(page,'intersect/evaluateEntry',{entry_rule:'Paint',interfaceRevision:state.interfaceRevision});convertedPaint({package:state.package,...preview},context,1);
    assert.deepEqual(await inspect(page),state);
    const invalid=structuredClone(context);invalid.conversions[0].provider.version='uninstalled';
    assert.ok((await raw(page,'intersect/compileInferred',{inference:c.inference,inference_context:invalid})).error);assert.deepEqual(await inspect(page),state);
    for(const python of [false,true]){
      const files=await archive(page,python);
      assert.ok((await raw(page,'intersect/packageImport',{files,revision:state.interfaceRevision})).error);assert.deepEqual(await inspect(page),state);
      const imported=await call(page,'intersect/packageImport',{files,revision:state.interfaceRevision,inference_context:context});assert.equal(imported.ok,true);
      const next=await inspect(page);convertedPaint(next,context);assert.equal(next.revision,state.revision+1);assert.equal(next.generation,state.generation+1);
      assert.ok((await raw(page,'intersect/packageImport',{files,revision:state.interfaceRevision,inference_context:context})).error);assert.deepEqual(await inspect(page),next);
      const tampered=structuredClone(files);tampered['package.json']='forged cached schema';
      assert.ok((await raw(page,'intersect/packageImport',{files:tampered,revision:next.interfaceRevision,inference_context:context})).error);assert.deepEqual(await inspect(page),next);
      state=next;last={files,context,expected:next.evaluation,package:next.package};
    }
  }
  await page.evaluate(()=>{window.providerOldWorker=window.observedInferenceWorker;});
  await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
  await expect.poll(()=>page.evaluate(()=>window.observedInferenceWorker!==window.providerOldWorker)).toBe(true);
  await expect.poll(async()=>{const s=await inspect(page);return {ordinary:!!s.package?.compilation,elements:s.evaluation?.model?.elements.length};}).toEqual({ordinary:true,elements:6});
  await closeExamples(page);await model(page,'paint');const fresh=await inspect(page);
  await call(page,'intersect/packageImport',{files:last.files,revision:fresh.interfaceRevision,inference_context:last.context});
  const recovered=await inspect(page);convertedPaint(recovered,last.context);assert.deepEqual(recovered.package,last.package);assert.deepEqual(recovered.evaluation,last.expected);
});

const computedPlan=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inferred-computed-host-contexts/plan.json',import.meta.url),'utf8'));
const computedContexts=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inferred-computed-host-contexts/contexts.json',import.meta.url),'utf8'));
function computedItem(state,count=2){
  const p=state.package,e=state.evaluation ?? state;assert.deepEqual(e.diagnostics,[]);assert.equal(e.model.elements.length,count);
  const item=e.model.elements.find(e=>p.schema.declarations[e.class].name==='Item');assert.deepEqual(item.values,{backing:'alpha'});assert.equal(e.derived[item.id].computed,'alpha');
  if(count===2){const root=e.model.elements.find(e=>e.id!==item.id);assert.deepEqual(root.values,{child:item.id});}
}
test('explicit source projection context executes and survives ZIP replay with atomic worker activation',async({page})=>{
  test.setTimeout(180000);await observeWorker(page);await closeExamples(page);let last;
  for(const c of computedPlan.cases){await model(page,c.model_text);
    const context=computedContexts.find(r=>r.id===c.id).inference_context;
    const compiled=await call(page,'intersect/compileInferred',{inference:c.inference,inference_context:context});assert.equal(compiled.ok,true);
    let state=await inspect(page);computedItem(state);assert.deepEqual(state.package.xtext_inference.bundle,c.inference.bundle);assert.deepEqual(state.package.xtext_inference.behavior,c.behavior);
    const preview=await call(page,'intersect/evaluateEntry',{entry_rule:'Item',sources:[{uri,text:c.named_model_text}],interfaceRevision:state.interfaceRevision});
    computedItem({package:state.package,...preview},1);assert.deepEqual(await inspect(page),state);
    for(const field of ['provider','sources','operations']){const invalid=structuredClone(context);invalid.computed_settings[0][field]=field==='provider'?{name:'uninstalled',version:'1'}:[];
      const rejected=await raw(page,'intersect/compileInferred',{inference:c.inference,inference_context:invalid});assert.ok(rejected.error || rejected.result?.ok===false);assert.deepEqual(await inspect(page),state);
    }
    for(const python of [false,true]){const files=await archive(page,python);
      assert.ok((await raw(page,'intersect/packageImport',{files,revision:state.interfaceRevision})).error);assert.deepEqual(await inspect(page),state);
      const imported=await call(page,'intersect/packageImport',{files,revision:state.interfaceRevision,inference_context:context});assert.equal(imported.ok,true);
      const next=await inspect(page);computedItem(next);assert.equal(next.revision,state.revision+1);assert.equal(next.generation,state.generation+1);
      assert.ok((await raw(page,'intersect/packageImport',{files,revision:state.interfaceRevision,inference_context:context})).error);assert.deepEqual(await inspect(page),next);
      const invalid=structuredClone(context);invalid.behavior.sha256='0'.repeat(64);assert.ok((await raw(page,'intersect/packageImport',{files,revision:next.interfaceRevision,inference_context:invalid})).error);assert.deepEqual(await inspect(page),next);
      state=next;last={files,context,expected:next.evaluation,package:next.package,c};
    }
  }
  await page.evaluate(()=>{window.computedOldWorker=window.observedInferenceWorker;});
  await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
  await expect.poll(()=>page.evaluate(()=>window.observedInferenceWorker!==window.computedOldWorker)).toBe(true);
  await expect.poll(async()=>{const s=await inspect(page);return {ordinary:!!s.package?.compilation,elements:s.evaluation?.model?.elements.length};}).toEqual({ordinary:true,elements:6});
  await closeExamples(page);await model(page,last.c.model_text);const fresh=await inspect(page);
  await call(page,'intersect/packageImport',{files:last.files,revision:fresh.interfaceRevision,inference_context:last.context});const restored=await inspect(page);
  computedItem(restored);assert.deepEqual(restored.package,last.package);assert.deepEqual(restored.evaluation,last.expected);
});

const computedCollectionPlan=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inferred-computed-collection-contexts/plan.json',import.meta.url),'utf8'));
const computedCollectionContexts=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inferred-computed-collection-contexts/contexts.json',import.meta.url),'utf8'));
function computedCollectionItem(state,count=2){
  const p=state.package,e=state.evaluation ?? state;assert.deepEqual(e.diagnostics,[]);assert.equal(e.model.elements.length,count);
  const item=e.model.elements.find(e=>p.schema.declarations[e.class].name==='Item');assert.deepEqual(item.values,{backing:['alpha','beta']});assert.deepEqual(e.derived[item.id].computed,['alpha','beta']);assert.deepEqual(item.assignment_state,{version:1,set_features:['backing']});
  if(count===2){const root=e.model.elements.find(e=>e.id!==item.id);assert.deepEqual(root.values,{child:item.id});}
}
test('source-backed computed collection append survives actual worker ZIP replay and explicit restart re-import',async({page})=>{
  test.setTimeout(180000);await observeWorker(page);await closeExamples(page);let last;
  for(const c of computedCollectionPlan.cases){await model(page,c.model_text);
    const context=computedCollectionContexts.find(r=>r.id===c.id).inference_context;
    const compiled=await call(page,'intersect/compileInferred',{inference:c.inference,inference_context:context});assert.equal(compiled.ok,true);
    let state=await inspect(page);computedCollectionItem(state);assert.deepEqual(state.package.xtext_inference.bundle,c.inference.bundle);assert.deepEqual(state.package.xtext_inference.behavior,c.behavior);
    const preview=await call(page,'intersect/evaluateEntry',{entry_rule:'Item',sources:[{uri,text:c.named_model_text}],interfaceRevision:state.interfaceRevision});if(c.id==='plain')computedCollectionItem({package:state.package,...preview},1);else{assert.deepEqual(preview.model.elements,[]);assert.match(preview.diagnostics[0].message,/No emitted no-argument parser entry/);}assert.deepEqual(await inspect(page),state);
    for(const operations of [[],['set','unset']]){const invalid=structuredClone(context);invalid.computed_settings[0].operations=operations;const rejected=await raw(page,'intersect/compileInferred',{inference:c.inference,inference_context:invalid});assert.ok(rejected.error || rejected.result?.ok===false);assert.deepEqual(await inspect(page),state);}
    for(const python of [false,true]){const files=await archive(page,python);assert.ok((await raw(page,'intersect/packageImport',{files,revision:state.interfaceRevision})).error);assert.deepEqual(await inspect(page),state);
      const imported=await call(page,'intersect/packageImport',{files,revision:state.interfaceRevision,inference_context:context});assert.equal(imported.ok,true);const next=await inspect(page);computedCollectionItem(next);assert.equal(next.revision,state.revision+1);assert.equal(next.generation,state.generation+1);
      assert.ok((await raw(page,'intersect/packageImport',{files,revision:state.interfaceRevision,inference_context:context})).error);assert.deepEqual(await inspect(page),next);
      const invalid=structuredClone(context);invalid.computed_settings[0].sources=[];assert.ok((await raw(page,'intersect/packageImport',{files,revision:next.interfaceRevision,inference_context:invalid})).error);assert.deepEqual(await inspect(page),next);
      state=next;last={files,context,expected:next.evaluation,package:next.package,c};
    }
  }
  await page.evaluate(()=>{window.computedCollectionOldWorker=window.observedInferenceWorker;});
  await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
  await expect.poll(()=>page.evaluate(()=>window.observedInferenceWorker!==window.computedCollectionOldWorker)).toBe(true);
  await expect.poll(async()=>{const s=await inspect(page);return {ordinary:!!s.package?.compilation,elements:s.evaluation?.model?.elements.length};}).toEqual({ordinary:true,elements:6});
  await closeExamples(page);await model(page,last.c.model_text);const fresh=await inspect(page);
  await call(page,'intersect/packageImport',{files:last.files,revision:fresh.interfaceRevision,inference_context:last.context});const restored=await inspect(page);computedCollectionItem(restored);assert.deepEqual(restored.package,last.package);assert.deepEqual(restored.evaluation,last.expected);
});


test('prepared inferred candidates publish only after explicit current-session activation',async({page})=>{
  test.setTimeout(120000);await observeWorker(page);await closeExamples(page);await model(page,'alpha');
  const before=await inspect(page),input=inferenceInputs(inferenceCases[0]);
  const prepared=await call(page,'intersect/prepareInferred',{inference:input});assert.equal(prepared.ok,true);assert.equal(typeof prepared.candidate,'string');
  assert.deepEqual(await inspect(page),before);
  await call(page,'intersect/discardInferred',{candidate:prepared.candidate});
  assert.match((await raw(page,'intersect/activateInferred',{candidate:prepared.candidate})).error.message,/obsolete/);
  assert.deepEqual(await inspect(page),before);
  const first=await call(page,'intersect/prepareInferred',{inference:input});
  const current=await call(page,'intersect/prepareInferred',{inference:input});
  assert.match((await raw(page,'intersect/activateInferred',{candidate:first.candidate})).error.message,/obsolete/);
  const activated=await call(page,'intersect/activateInferred',{candidate:current.candidate});assert.equal(activated.revision,before.revision+1);
  const active=await inspect(page);assert.deepEqual(active.package,activated.package);assert.equal(active.evaluation.diagnostics.length,0);
  assert.match((await raw(page,'intersect/activateInferred',{candidate:current.candidate})).error.message,/obsolete/);
  assert.deepEqual(await inspect(page),active);
  const stale=await call(page,'intersect/prepareInferred',{inference:input});
  await call(page,'intersect/compileInferred',{inference:input});const newer=await inspect(page);
  assert.match((await raw(page,'intersect/activateInferred',{candidate:stale.candidate})).error.message,/obsolete/);
  assert.deepEqual(await inspect(page),newer);
});
