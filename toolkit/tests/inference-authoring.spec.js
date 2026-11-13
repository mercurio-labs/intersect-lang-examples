import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unpackLanguageArchive} from '../src/package-import.js';
import {inferenceCases,inferenceObservations,inferenceInputs,modelProjection} from './inferred-archive-browser.js';
const sha=text=>createHash('sha256').update(text).digest('hex');
async function boot(page){
 page.setDefaultTimeout(15000);
 await page.addInitScript(()=>{const Base=window.Worker;window.Worker=class extends Base{
  constructor(url,options){super(url,options);this.isLanguage=String(url).includes('language.worker');if(this.isLanguage){window.authoringWorker=this;this.holdInitialization=!!window.holdNextAuthoringInitialization;window.holdNextAuthoringInitialization=false;}}
  postMessage(message,...rest){if(this.isLanguage&&window.failNextAuthoringFormats&&message.method==='intersect/modelFormats'){window.failNextAuthoringFormats=false;queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'controlled model-format publication failure'}}})));return;}return super.postMessage(message,...rest);}
  set onmessage(handler){super.onmessage=event=>{if(this.holdInitialization&&event.data.id===1){this.holdInitialization=false;window.releaseAuthoringInitialization=()=>handler(event);}else handler(event);};}
 };});
 await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
}
async function request(page,method,params={}){return page.evaluate(({method,params})=>new Promise((resolve,reject)=>{const worker=window.authoringWorker,id=`authoring:${window.authoringId=(window.authoringId||0)+1}`;const listener=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',listener);data.error?reject(new Error(data.error.message)):resolve(data.result);};const timer=setTimeout(()=>{worker.removeEventListener('message',listener);reject(new Error('Authoring worker did not respond'));},15000);worker.addEventListener('message',listener);worker.postMessage({jsonrpc:'2.0',id,method,params});}),{method,params});}
const inspect=page=>request(page,'intersect/inspect');
async function menu(page){if(!await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();}
async function closeMenu(page){if(await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();}
async function save(page){await menu(page);const downloading=page.waitForEvent('download');await page.locator('#save-project').click();const d=await downloading;const bytes=await readFile(await d.path());await closeMenu(page);return {bytes,value:JSON.parse(bytes.toString('utf8'))};}
async function open(page,value){await page.locator('#project-file').setInputFiles({name:'inference.intersect.json',mimeType:'application/json',buffer:Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value))});await expect(page.locator('#project-status')).toContainText('Project opened');await expect(page.locator('#compile')).toBeEnabled();}
async function compile(page){await expect(page.locator('#compile')).toBeEnabled();const revision=(await inspect(page)).revision;await page.locator('#compile').click();await expect.poll(async()=>(await inspect(page)).revision,{timeout:60000}).toBe(revision+1);await expect(page.locator('#definition-state')).toContainText('Compiled');return inspect(page);}
async function starter(page){await menu(page);await page.locator('#new-inferred-project').click();await expect(page.locator('#project-status')).toContainText('New inferred language',{timeout:60000});await expect(page.locator('#definition-mode')).toHaveValue('inferred');await expect(page.locator('#element-count')).toHaveText('2 elements');return inspect(page);}
async function edit(page,text){await page.locator('.definition-guide-editor .view-lines').click({position:{x:30,y:12}});await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(text);}
function project(base,input,text){const p=structuredClone(base);p.definitionInference={inputs:input,drafts:[]};p.definitions.xtext=input.bundle.sources.find(s=>s.id.uri===input.grammar.uri&&s.id.sha256===input.grammar.sha256).text;p.models={catalog:text,loans:text};return p;}
async function restart(page){const before=await inspect(page);await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();await expect.poll(async()=>{try{const s=await inspect(page);return !!s.package?.xtext_inference&&s.interfaceRevision!==before.interfaceRevision;}catch{return false;}},{timeout:60000}).toBe(true);await expect(page.locator('#definition-state')).toContainText('Compiled');return inspect(page);}

test('inferred authoring saves drafts, preserves active language, restarts and downloads original-source ZIP',async({page},info)=>{
 test.setTimeout(180000);await boot(page);const before=await starter(page);const working=await save(page);
 assert.equal(working.value.definitionBundle,undefined);assert.equal(working.value.definitions.ecore,'');assert.deepEqual(working.value.definitionInference.inputs,before.package.xtext_inference);
 const expected=inferenceObservations.runs.find(r=>r.case==='typed_basic'&&r.entry==='resource').model;
 assert.deepEqual(modelProjection(before.package,before.evaluation.model),[...expected,...expected]);
 await expect(page.locator('.structure-class')).toHaveCount(2);await expect(page.locator('.instance-class').first()).toHaveText('Model');
 await page.locator('[data-ecore-view="source"]').click();await expect(page.getByLabel('Generated Rcore file',{exact:true})).toBeVisible();await expect(page.locator('#definition-undo')).toBeDisabled();
 const preview=await page.locator('#definition-editor .view-lines').innerText();await page.locator('#definition-editor .view-lines').click({position:{x:30,y:12}});await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('forged preview');assert.equal(await page.locator('#definition-editor .view-lines').innerText(),preview);
 await page.locator('[data-definition="xtext"]').click();const bad='grammar unfinished ???';await edit(page,bad);await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');assert.deepEqual((await inspect(page)).package,before.package);
 const draft=await save(page);assert.equal(draft.value.definitions.xtext,bad);assert.equal(draft.value.definitionInference.inputs.bundle.sources[0].id.sha256,sha(bad));
 await open(page,working.bytes);await compile(page);await open(page,draft.bytes);await expect(page.locator('#compile-status')).toHaveText('Draft failed · previous inferred language restored');await expect(page.locator('#save-rcore')).toBeEnabled();assert.deepEqual((await inspect(page)).package,before.package);await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');
 await open(page,working.bytes);const restored=await compile(page);assert.deepEqual(restored.package,before.package);const recovered=await restart(page);assert.deepEqual(recovered.package,before.package);assert.deepEqual(recovered.evaluation,before.evaluation);
 await menu(page);await page.locator('#export-package').click();await page.getByLabel('Package ID',{exact:false}).fill('inference.authoring');await page.getByLabel('Release',{exact:false}).fill('1');const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();const d=await downloading;const files=unpackLanguageArchive(await readFile(await d.path()));assert.deepEqual(JSON.parse(files['definitions/inference.json']),before.package.xtext_inference);
 await page.getByRole('tab',{name:'Define',exact:true}).click();await page.locator('[data-ecore-view="structure"]').click();await page.screenshot({path:info.outputPath('inferred-definition.png'),fullPage:true});
 await page.getByRole('tab',{name:'Test',exact:true}).click();await page.screenshot({path:info.outputPath('inferred-authoring.png'),fullPage:true});
});

test('inferred project UI consumes every frozen runtime graph and independent model outcome',async({page})=>{
 test.setTimeout(240000);await boot(page);await starter(page);const base=(await save(page)).value;let positives=0,negatives=0;
 for(const c of inferenceCases){const input=inferenceInputs(c),runs=inferenceObservations.runs.filter(r=>r.case===c.id&&r.entry==='resource');
  if(!runs.length){await open(page,project(base,input,'alpha'));const compiled=await compile(page);assert.deepEqual(compiled.package.xtext_inference,input);}
  // The original uppercase generator-failure graph has no independent runtime
  // outcome. Verify its source compilation without awarding model equivalence.
  for(const run of runs){
  await open(page,project(base,input,run.text));const state=await compile(page);assert.deepEqual(state.package.xtext_inference,input);assert.equal(state.evaluation.diagnostics.length===0,run.accepted);
  if(run.accepted){positives++;const models=state.evaluation.model.elements;assert.equal(models.length,run.model.length*2);for(const resource of ['file:///models/catalog.library','file:///models/loans.library'])assert.deepEqual(modelProjection(state.package,{elements:models.filter(e=>e.resource===resource)}),run.model);}else{negatives++;assert.deepEqual(state.evaluation.model.elements,[]);}
 }}
 assert.deepEqual([positives,negatives],[7,4]);
});

test('retained parent edits survive uncompiled project drafts, identity remapping and runtime restart',async({page})=>{
 test.setTimeout(180000);await boot(page);await starter(page);const base=(await save(page)).value,c=inferenceCases.find(c=>c.id==='wildcard_override_lowercase'),input=inferenceInputs(c);
 await open(page,project(base,input,'alpha'));const before=await compile(page);const parent=input.bundle.sources[0];await page.getByLabel('Inference source file',{exact:true}).selectOption('0');const text=parent.text+'// retained parent café\n';await edit(page,text);
 const pending=await save(page);assert.deepEqual(pending.value.definitionInference.drafts,[{source:parent.id,text}]);assert.deepEqual((await inspect(page)).package,before.package);
 await open(page,pending.bytes);const after=await restart(page);const changed=after.package.xtext_inference.bundle.sources[0];assert.equal(changed.text,text);assert.equal(changed.id.sha256,sha(text));assert.deepEqual(after.package.xtext_inference.bundle.sources[1].dependencies,[changed.id]);assert.deepEqual(modelProjection(after.package,after.evaluation.model),modelProjection(before.package,before.evaluation.model));
 const saved=await save(page);assert.deepEqual(saved.value.definitionInference.drafts,[]);await open(page,saved.bytes);assert.deepEqual((await compile(page)).package,after.package);
});

test('mixed inferred and canonical imported source projects keep shared model identity after source edits',async({page})=>{
 test.setTimeout(180000);await boot(page);await starter(page);const base=(await save(page)).value;
 const cases=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/metamodel-inference/cases.json',import.meta.url),'utf8')),c=cases.find(c=>c.id==='imported_existing_feature');
 const migrated=await request(page,'intersect/migrateEcore',{uri:'memory:inference-import.ecore',text:await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/metamodel-inference/imported.ecore',import.meta.url),'utf8'),target_uri:'memory:inference-import.rcore'});assert.equal(migrated.ok,true);
 const imported=migrated.report.converted,id={uri:'memory:mixed-authoring.xtext',sha256:sha(c.source)},input={version:1,bundle:{version:1,sources:[{id,kind:'xtext',text:c.source,dependencies:[imported.id]},imported],namespaces:[{namespace:'urn:intersect:inference:imported',source:imported.id}]},grammar:id};
 await open(page,project(base,input,'Alpha Beta'));const before=await compile(page);assert.deepEqual(before.evaluation.diagnostics,[]);assert.equal(before.evaluation.model.elements.filter(e=>before.package.schema.declarations[e.class].namespace==='urn:intersect:inference:imported').length,4);
 await page.getByLabel('Inference source file',{exact:true}).selectOption('1');await edit(page,imported.text+'// canonical source stays editable\n');const after=await compile(page);assert.deepEqual(after.evaluation.diagnostics,[]);assert.deepEqual(modelProjection(after.package,after.evaluation.model),modelProjection(before.package,before.evaluation.model));const changed=after.package.xtext_inference.bundle.sources[1].id;assert.notEqual(changed.sha256,imported.id.sha256);assert.deepEqual(after.package.xtext_inference.bundle.namespaces[0].source,changed);assert.deepEqual(after.package.xtext_inference.bundle.sources[0].dependencies,[changed]);
});


test('inferred project source bytes preserve Unicode and CRLF while the pinned leading BOM rejects',async({page})=>{
 test.setTimeout(180000);await boot(page);await starter(page);const base=(await save(page)).value;
 const cases=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-archive/source-encoding-cases.json',import.meta.url),'utf8'));
 const observations=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-archive/source-encoding-observations.json',import.meta.url),'utf8'));
 for(const [index,c]of cases.entries()){
  const text=c.sources[0].source,id={uri:'memory:encoding-authoring.xtext',sha256:sha(text)},input={version:1,bundle:{version:1,sources:[{id,kind:'xtext',text,dependencies:[]}],namespaces:[]},grammar:id};const before=await inspect(page);
  const ownTemplate=observations[index].all_sources_accepted?base:(await save(page)).value;await open(page,project(ownTemplate,input,'alpha'));
  if(observations[index].all_sources_accepted)await compile(page);else{await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');assert.deepEqual((await inspect(page)).package,before.package);}
  const saved=await save(page);assert.equal(saved.value.definitions.xtext,text);assert.equal(saved.value.definitionInference.inputs.bundle.sources[0].text,text);assert.deepEqual(saved.value.definitionInference.inputs.grammar,id);
 }
 const text=cases[0].sources[0].source.replaceAll('\n','\r\n'),id={uri:'memory:crlf-authoring.xtext',sha256:sha(text)},input={version:1,bundle:{version:1,sources:[{id,kind:'xtext',text,dependencies:[]}],namespaces:[]},grammar:id};await open(page,project(base,input,'alpha'));await compile(page);assert.equal((await save(page)).value.definitions.xtext,text);
});

test('inferred project rejects competing recipes atomically and keeps unsupported provider drafts explicit',async({page})=>{
 test.setTimeout(120000);await boot(page);const before=await starter(page),base=(await save(page)).value;
 const invalid={...base,definitionBundle:{},definitions:{...base.definitions,xtext:'would replace the draft'}};
 await page.locator('#project-file').setInputFiles({name:'ambiguous.intersect.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});await expect(page.locator('#project-status')).toContainText('Conflicting definition source recipes');assert.deepEqual((await save(page)).value,base);assert.deepEqual((await inspect(page)).package,before.package);
 const provider=structuredClone(base);provider.definitions.rcore_behavior='rcore 1; package provider version "1";';await open(page,provider);await page.locator('#compile').click();await expect(page.locator('#compile-detail')).toContainText('not supported in inferred mode');assert.deepEqual((await inspect(page)).package,before.package);assert.equal((await save(page)).value.definitions.rcore_behavior,provider.definitions.rcore_behavior);
});


async function restartRecovered(page,before){
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
 await expect.poll(async()=>{try{const state=await inspect(page);return !!state.package?.xtext_inference&&state.interfaceRevision!==before.interfaceRevision;}catch{return false;}},{timeout:60000}).toBe(true);
 await expect(page.locator('#compile-status')).toHaveText('Draft failed · previous inferred language restored',{timeout:60000});
 const state=await inspect(page);assert.notEqual(state.interfaceRevision,before.interfaceRevision);assert.deepEqual(state.package,before.package);await expect(page.locator('#definition-state')).toHaveText('Draft failed · previous language restored');return state;
}

test('failed inferred drafts recover original active sources through repeated runtime restarts',async({page})=>{
 test.setTimeout(180000);await boot(page);const before=await starter(page),good=(await save(page)).value;
 const query={schema_uri:before.package.schema.uri,schema_revision:before.package.schema.revision,from:before.evaluation.model.elements[0].class,select:[{name:'name',expression:{op:'field',path:'name'}}],limit:10};
 const exported=await request(page,'intersect/modelExport',{format:'xmi'});await request(page,'intersect/modelImport',{format:'xmi',resources:exported.resources,interfaceRevision:before.interfaceRevision,generation:before.generation});assert.equal((await inspect(page)).modelOrigin,'import');
 const overlayTx=await request(page,'intersect/transactionBegin',{disposable:false});const overlayModel=structuredClone(overlayTx.evaluation.model);overlayModel.elements[0].values.name='script overlay';await request(page,'intersect/scriptCommit',{transactionId:overlayTx.transaction.context.id,interfaceRevision:overlayTx.interfaceRevision,generation:overlayTx.generation,model:overlayModel});assert.equal((await inspect(page)).evaluation.model.elements[0].values.name,'script overlay');
 const tx=await request(page,'intersect/transactionBegin',{disposable:true});
 await page.locator('[data-definition="xtext"]').click();const bad='grammar unfinished café ???';await edit(page,bad);await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');
 const diagnostics=await page.locator('#diagnostic-list').innerText(),draft=await save(page);
 const recovered=await restartRecovered(page,before);assert.deepEqual(recovered.evaluation,before.evaluation);assert.equal(recovered.modelOrigin,'text');assert.equal(recovered.overlay,false);assert.equal(await page.locator('#diagnostic-list').innerText(),diagnostics);assert.deepEqual((await save(page)).value,draft.value);
 await assert.rejects(()=>request(page,'intersect/query',{query,interfaceRevision:before.interfaceRevision,generation:before.generation}),/Stale query/);
 await assert.rejects(()=>request(page,'intersect/testFinish',{transactionId:tx.transaction.context.id,interfaceRevision:tx.interfaceRevision,generation:tx.generation,model:tx.evaluation.model}),/transaction|Stale|stale/);
 assert.deepEqual((await request(page,'intersect/query',{query,interfaceRevision:recovered.interfaceRevision,generation:recovered.generation})).rows,[['alpha'],['alpha']]);
 await restartRecovered(page,recovered);assert.deepEqual((await save(page)).value,draft.value);
 await menu(page);await page.locator('#export-package').click();await expect(page.locator('#package-snapshot')).toContainText('Uncompiled definition edits are excluded');await page.getByLabel('Package ID',{exact:false}).fill('inference.recovered');await page.getByLabel('Release',{exact:false}).fill('1');const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();const d=await downloading;const files=unpackLanguageArchive(await readFile(await d.path()));assert.deepEqual(JSON.parse(files['definitions/inference.json']),before.package.xtext_inference);await closeMenu(page);
 await open(page,draft.bytes);await restartRecovered(page,await inspect(page));assert.deepEqual((await save(page)).value,draft.value);
 await open(page,good);const valid=await compile(page);await expect(page.locator('#definition-state')).toContainText('Compiled');
 const provider=structuredClone(good);provider.definitions.rcore_behavior='rcore 1; package unsupported version "1";';provider.models.catalog='?';await open(page,provider);const retained=await save(page);const unsupported=await restartRecovered(page,valid);await expect(page.locator('#compile-detail')).toContainText('not supported in inferred mode');assert.ok(unsupported.evaluation.diagnostics.length>0);assert.equal(unsupported.evaluation.model.elements.filter(e=>e.resource==='file:///models/catalog.library').length,0);assert.equal(unsupported.evaluation.model.elements.filter(e=>e.resource==='file:///models/loans.library').length,1);assert.deepEqual((await save(page)).value,retained.value);
});

test('inferred restart prefers valid drafts and replaces recovery with the last successful graph',async({page})=>{
 test.setTimeout(180000);await boot(page);await starter(page);const base=(await save(page)).value,c=inferenceCases.find(c=>c.id==='wildcard_override_lowercase'),input=inferenceInputs(c);
 await open(page,project(base,input,'alpha'));const before=await compile(page),parent=input.bundle.sources[0];await page.getByLabel('Inference source file',{exact:true}).selectOption('0');
 const valid=parent.text+'// newer successful parent café\n';await edit(page,valid);const newer=await restart(page);assert.notDeepEqual(newer.package,before.package);assert.equal(newer.package.xtext_inference.bundle.sources[0].text,valid);assert.equal(newer.revision,1);
 const bad='grammar parent broken ???';await edit(page,bad);await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');const draft=await save(page);const restored=await restartRecovered(page,newer);assert.deepEqual(restored.evaluation,newer.evaluation);assert.deepEqual((await save(page)).value,draft.value);assert.ok((await page.locator('#diagnostic-list').innerText()).length>0);
 assert.equal((await save(page)).value.definitionInference.drafts.length,0); // Compilation retained the exact failed parent as its source input.
 assert.equal((await save(page)).value.definitionInference.inputs.bundle.sources[0].text,bad);
});

test('inferred restart retains sources after worker failure and ignores an obsolete initialization',async({page})=>{
 test.setTimeout(120000);await boot(page);const before=await starter(page);await page.locator('[data-definition="xtext"]').click();await edit(page,'grammar invalid transport ???');await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');const draft=await save(page);
 await page.evaluate(()=>window.authoringWorker.dispatchEvent(new ErrorEvent('error',{message:'controlled worker transport failure'})));await expect(page.locator('#compile-status')).toHaveText('Runtime stopped');
 await restartRecovered(page,before);assert.deepEqual((await save(page)).value,draft.value);
 await page.evaluate(()=>{window.holdNextAuthoringInitialization=true;});await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseAuthoringInitialization==='function')).toBe(true);await expect(page.locator('#save-rcore')).toBeDisabled();
 await menu(page);await page.locator('#new-empty-project').click();await expect(page.locator('#project-status')).toContainText('New empty project');await closeMenu(page);
 await page.evaluate(()=>window.releaseAuthoringInitialization());await expect(page.locator('#definition-mode')).toHaveValue('structure');await expect(page.locator('#compile-status')).toHaveText('Empty project');assert.equal((await inspect(page)).package,null);
});

test('legacy projects without durable recipes never inherit inferred restart recovery',async({page})=>{
 test.setTimeout(180000);await boot(page);const ordinary=(await save(page)).value;await starter(page);await page.locator('[data-definition="xtext"]').click();await edit(page,'grammar invalid isolated ???');await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');const bad=await save(page);bad.value.format='intersect.toolkit.project.v2';delete bad.value.entryRule;delete bad.value.definitionInferenceRecovery;bad.bytes=Buffer.from(JSON.stringify(bad.value));
 await open(page,ordinary);await compile(page);await open(page,bad.bytes);await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();await expect(page.locator('#compile-status')).toHaveText('Definition compilation failed',{timeout:60000});assert.equal((await inspect(page)).package,null);
 await starter(page);await menu(page);await page.locator('#new-empty-project').click();await expect(page.locator('#project-status')).toContainText('New empty project');await closeMenu(page);await open(page,bad.bytes);
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();await expect(page.locator('#compile-status')).toHaveText('Definition compilation failed',{timeout:60000});assert.equal((await inspect(page)).package,null);assert.deepEqual((await save(page)).value,bad.value);
 await boot(page);await open(page,bad.bytes);await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();await expect(page.locator('#compile-status')).toHaveText('Definition compilation failed',{timeout:60000});assert.equal((await inspect(page)).package,null);assert.deepEqual((await save(page)).value,bad.value);
});


test('native inferred activation survives a later UI publication failure during restart',async({page})=>{
 test.setTimeout(120000);await boot(page);const before=await starter(page),base=(await save(page)).value;
 const text=base.definitions.xtext+'// valid newer source before UI failure\n';await page.locator('[data-definition="xtext"]').click();await edit(page,text);
 await page.evaluate(()=>{window.failNextAuthoringFormats=true;});await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
 await expect(page.locator('#compile-status')).toHaveText('Language active · UI setup incomplete',{timeout:60000});await expect(page.locator('#active-revision')).toHaveText('ACTIVE · REV 1');await expect(page.locator('#definition-state')).toHaveText('Language active · UI setup incomplete');await expect(page.locator('#compile')).toBeEnabled();await expect(page.locator('#compile-detail')).toContainText('controlled model-format publication failure');
 const active=await inspect(page);assert.notEqual(active.interfaceRevision,before.interfaceRevision);assert.equal(active.revision,1);assert.equal(active.package.xtext_inference.bundle.sources[0].text,text);assert.deepEqual(active.evaluation.diagnostics,[]);assert.deepEqual(modelProjection(active.package,active.evaluation.model),modelProjection(before.package,before.evaluation.model));assert.notEqual(active.package.schema.revision,before.package.schema.revision);assert.notEqual(active.evaluation.model.elements[0].type_identity,before.evaluation.model.elements[0].type_identity);assert.equal((await save(page)).value.definitions.xtext,text);
 await edit(page,'grammar invalid after native success ???');await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');const draft=await save(page);
 await page.evaluate(()=>{window.failNextAuthoringFormats=true;});await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();await expect(page.locator('#compile-status')).toHaveText('Language restored · UI setup incomplete',{timeout:60000});await expect(page.locator('#active-revision')).toHaveText('ACTIVE · REV 1');await expect(page.locator('#compile')).toBeEnabled();const partial=await inspect(page);assert.deepEqual(partial.package,active.package);assert.deepEqual((await save(page)).value,draft.value);await restartRecovered(page,partial);
});
