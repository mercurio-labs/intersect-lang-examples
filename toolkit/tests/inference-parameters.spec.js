import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
import {modelProjection} from './inferred-archive-browser.js';
const cases=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-parameters/cases.json',import.meta.url),'utf8'));
const observations=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-parameters/observations.json',import.meta.url),'utf8'));
const uri='memory:parameter-worker.model';
const metadata={package_id:'parameters.worker',release:'1',display_name:'Parameterized language',description:''};
function inputs(c){const ids=new Map();const sources=c.sources.map(s=>{const id={uri:`memory:parameter-browser/${c.id}/${s.id}.xtext`,sha256:createHash('sha256').update(s.source).digest('hex')};const dependencies=s.dependencies.map(id=>ids.get(id));ids.set(s.id,id);return{id,kind:'xtext',text:s.source,dependencies};});return{version:1,bundle:{version:1,sources,namespaces:[]},grammar:ids.get(c.entry)};}
async function boot(page){
 test.setTimeout(240000);page.setDefaultTimeout(20000);
 await page.addInitScript(()=>{const Base=window.Worker;window.Worker=class extends Base{
  constructor(url,options){super(url,options);this.parameterLanguage=String(url).includes('language.worker');if(this.parameterLanguage)window.parameterWorker=this;}
  postMessage(message,...rest){if(this.parameterLanguage&&window.failNextParameterFormats&&message.method==='intersect/modelFormats'){window.failNextParameterFormats=false;queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'controlled ordinary format publication failure'}}})));return;}return super.postMessage(message,...rest);}
 };});
 await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
}
async function raw(page,method,params={}){return page.evaluate(({method,params})=>new Promise((resolve,reject)=>{const worker=window.parameterWorker,id=`parameter:${window.parameterId=(window.parameterId||0)+1}`;const listener=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',listener);resolve(data);};const timer=setTimeout(()=>{worker.removeEventListener('message',listener);reject(new Error('Parameter worker did not respond'));},25000);worker.addEventListener('message',listener);worker.postMessage({jsonrpc:'2.0',id,method,params});}),{method,params});}
async function call(page,method,params={}){const response=await raw(page,method,params);assert.equal(response.error,undefined,JSON.stringify(response.error));return response.result;}
const inspect=page=>call(page,'intersect/inspect');
async function closeExamples(page){for(const name of ['catalog','loans'])await call(page,'textDocument/didClose',{textDocument:{uri:`file:///models/${name}.library`}});}
async function model(page,text,version){await call(page,'textDocument/didOpen',{textDocument:{uri,version,text,languageId:'intersect-model'}});}
async function menu(page){if(!await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();}
async function closeMenu(page){if(await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();}
async function save(page){await menu(page);const pending=page.waitForEvent('download');await page.locator('#save-project').click();const bytes=await readFile(await(await pending).path());await closeMenu(page);return{bytes,value:JSON.parse(bytes.toString('utf8'))};}
async function open(page,value){await page.locator('#project-file').setInputFiles({name:'parameters.intersect.json',mimeType:'application/json',buffer:Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value))});await expect(page.locator('#project-status')).toContainText('Project opened');await expect(page.locator('#compile')).toBeEnabled();await page.locator('[data-definition="xtext"]').click();}
async function edit(page,text){await page.locator('.definition-guide-editor .view-lines').click({position:{x:30,y:12}});await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(text);}
async function compile(page){await expect(page.locator('#compile')).toBeEnabled();const before=await inspect(page);await page.locator('#compile').click();await expect.poll(async()=>(await inspect(page)).revision,{timeout:60000}).toBe(before.revision+1);await expect(page.locator('#definition-state')).toContainText('Compiled');return inspect(page);}
const nodes=state=>state.evaluation.model.elements.filter(e=>state.package.schema.declarations[e.class].name==='Node').map(e=>e.values);

test('actual worker consumes parameter resource models and source-rejection controls',async({page})=>{
 await boot(page);await closeExamples(page);let version=0,positive=0,negative=0,sourceRejected=0;
 for(const variant of ['lowercase_counterparts','additional_controls'])for(const c of cases[variant]){
  const expected=observations[variant].metadata.find(row=>row.id===c.id),before=await inspect(page);
  const compiled=await call(page,'intersect/compileInferred',{inference:inputs(c)});
  assert.equal(compiled.ok,expected.all_sources_accepted,`${c.id}: ${JSON.stringify(compiled.diagnostics)}`);
  if(!compiled.ok){sourceRejected++;assert.deepEqual(await inspect(page),before);continue;}
  assert.equal(compiled.package.grammar.profile,'intersect.xtext.native.v57');assert.deepEqual(compiled.package.xtext_inference,inputs(c));
  for(const run of observations[variant].runs.filter(row=>row.case===c.id&&row.entry==='resource')){
   await model(page,run.text,++version);const state=await inspect(page);
   assert.equal(state.evaluation.diagnostics.length===0,run.accepted,`${c.id}: ${JSON.stringify(state.evaluation.diagnostics)}`);
   if(run.accepted){positive++;assert.deepEqual(modelProjection(state.package,state.evaluation.model),run.model);}else{negative++;assert.deepEqual(state.evaluation.model.elements,[]);}
  }
 }
 assert.deepEqual([positive,negative,sourceRejected],[30,35,15]);
});

test('parameter worker rebuilds both real ZIP forms and rejects forged runtime profiles atomically',async({page})=>{
 await boot(page);await closeExamples(page);let version=0;
 for(const [variant,id]of [['lowercase_counterparts','true_call'],['lowercase_counterparts','recursive_context'],['lowercase_counterparts','guarded_action'],['additional_controls','inherited_fragment_parameters']]){
  const c=cases[variant].find(c=>c.id===id),input=inputs(c),run=observations[variant].runs.find(r=>r.case===id&&r.accepted&&r.entry==='resource');
  assert.equal((await call(page,'intersect/compileInferred',{inference:input})).ok,true);await model(page,run.text,++version);
  const compiled=await inspect(page);assert.deepEqual(compiled.evaluation.diagnostics,[]);
  for(const python of [false,true]){
   const before=await inspect(page),distribution=await call(page,'intersect/packageExport',{revision:before.interfaceRevision,metadata});
   const files=unpackLanguageArchive(await packageArchive(distribution,python));
   assert.deepEqual(JSON.parse(files['definitions/inference.json']),input);assert.equal(JSON.parse(files['manifest.json']).runtime.profile,'intersect.xtext.native.v57');
   assert.equal((await call(page,'intersect/packageImport',{files,revision:before.interfaceRevision})).ok,true);
   const loaded=await inspect(page);assert.deepEqual(loaded.package,compiled.package);assert.deepEqual(loaded.evaluation,compiled.evaluation);
   const forged=structuredClone(files),manifest=JSON.parse(forged['manifest.json']);manifest.runtime.profile='intersect.xtext.native.v56';forged['manifest.json']=JSON.stringify(manifest);
   const denied=await raw(page,'intersect/packageImport',{files:forged,revision:loaded.interfaceRevision});assert.ok(denied.error);assert.match(denied.error.message,/runtime requirements differ/);assert.deepEqual(await inspect(page),loaded);
  }
 }
});

test('parameter authoring edits, saved drafts and restart recovery preserve original source authority',async({page})=>{
 await boot(page);await menu(page);await page.locator('#new-inferred-project').click();await expect(page.locator('#project-status')).toContainText('New inferred language');await closeMenu(page);
 const base=(await save(page)).value,c=cases.lowercase_counterparts.find(c=>c.id==='false_call'),input=inputs(c),project=structuredClone(base);
 project.definitionInference={inputs:input,drafts:[]};project.definitions.xtext=c.sources[0].source;project.models={catalog:'alpha',loans:'alpha'};
 await open(page,project);const first=await compile(page);assert.equal(nodes(first).length,2);assert.ok(nodes(first).every(node=>node.a===null&&node.b==='alpha'));
 const edited=c.sources[0].source.replace('Node<false>','Node<true>');await edit(page,edited);const active=await compile(page);assert.ok(nodes(active).every(node=>node.a==='alpha'&&node.b===null));
 const invalid=edited.replace('Node<true>','Node');await edit(page,invalid);await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');
 const failed=await inspect(page);for(const key of ['package','evaluation','revision','generation'])assert.deepEqual(failed[key],active[key]);
 const saved=await save(page);assert.equal(saved.value.definitions.xtext,invalid);assert.ok(!JSON.stringify(saved.value).includes('intersect:parameter-program:'));
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
 await expect.poll(async()=>{try{const state=await inspect(page);return state.interfaceRevision!==active.interfaceRevision&&state.package?.xtext_inference?.grammar.sha256===active.package.xtext_inference.grammar.sha256;}catch{return false;}},{timeout:60000}).toBe(true);
 await expect(page.locator('#definition-state')).toHaveText('Draft failed · previous language restored');const restored=await inspect(page);assert.deepEqual(restored.package,active.package);assert.ok(nodes(restored).every(node=>node.a==='alpha'&&node.b===null));assert.equal((await save(page)).value.definitions.xtext,invalid);
 await open(page,saved.bytes);await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');assert.deepEqual((await inspect(page)).package,active.package);assert.equal((await save(page)).value.definitions.xtext,invalid);
});

test('nullable parameter forwarding and error-free empty resources reach the actual worker',async({page})=>{
 await boot(page);await closeExamples(page);
 const cases=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-parameter-empty/cases.json',import.meta.url),'utf8'));
 const rows=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-parameter-empty/observations.json',import.meta.url),'utf8'));
 let version=0;const counts=[0,0,0];
 for(const c of cases){
  const compiled=await call(page,'intersect/compileInferred',{inference:inputs(c)});assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  for(const run of rows.runs.filter(r=>r.case===c.id)){
   await model(page,run.text,++version);const state=await inspect(page);
   const syntaxSuccess=run.errors.length===0;
   assert.equal(state.evaluation.diagnostics.length===0,syntaxSuccess,`${c.id}: ${JSON.stringify(state.evaluation.diagnostics)}`);
   const record=state.evaluation.model.resources[uri];assert.ok(record);assert.equal(record.load_state,'Loaded');
   assert.equal(record.roots.length,syntaxSuccess?run.resource_contents:0);
   if(syntaxSuccess){assert.deepEqual(record.source,{uri,revision:createHash('sha256').update(run.text).digest('hex')});assert.deepEqual(record.diagnostics,[]);}
   else{assert.equal(record.source,null);assert.ok(record.diagnostics.length>0);}
   if(run.accepted){counts[0]++;assert.deepEqual(modelProjection(state.package,state.evaluation.model),run.model);}
   else{counts[syntaxSuccess?2:1]++;assert.deepEqual(state.evaluation.model.elements,[]);}
  }
 }
 assert.deepEqual(counts,[1,2,1]);
});

// Ordinary imported languages remain ordinary throughout activation and persistence.
const ordinaryCases=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/imported-parameters/cases.json',import.meta.url),'utf8')).cases;
const ordinaryRows=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/imported-parameters/observations.json',import.meta.url),'utf8'));
async function ordinaryInput(page,c){
 const {ordinaryInputs}=await import('./ordinary-parameter-inputs.js');const original=ordinaryInputs(c);
 const result=await call(page,'intersect/migrateEcoreCompilation',{compilation:original,targets:c.metamodels.map((m,i)=>({source:original.bundle.sources[i].id,uri:m.uri.replace('.ecore','.rcore')}))});
 assert.equal(result.ok,true);return result.compilation;
}
test('ordinary parameter worker activates original bundles and both ZIP forms atomically',async({page})=>{
 await boot(page);await closeExamples(page);let version=0;
 for(const id of ['false_call','recursive_context','inherited_parameters','override_behavior']){
  const c=ordinaryCases.find(c=>c.id===id);assert.ok(c,id);const input=await ordinaryInput(page,c);
  const compiled=await call(page,'intersect/compileBundle',{compilation:input,xtext_profile:'intersect.xtext.native.v57'});assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
  assert.deepEqual(compiled.package.compilation,input);assert.equal(compiled.package.xtext_inference,undefined);
  const run=ordinaryRows.runs.find(r=>r.case===id&&r.entry==='resource'&&r.accepted);
  await model(page,run.text,++version);const active=await inspect(page);assert.deepEqual(active.evaluation.diagnostics,[]);assert.deepEqual(modelProjection(active.package,active.evaluation.model),run.model);
  for(const python of [false,true]){
   const before=await inspect(page),d=await call(page,'intersect/packageExport',{revision:before.interfaceRevision,metadata});
   const bytes=await packageArchive(d,python);assert.deepEqual(await packageArchive(d,python),bytes);const files=unpackLanguageArchive(bytes);
   assert.deepEqual(JSON.parse(files['definitions/bundle.json']),input);assert.match(files['README.txt'],/intersect_text::distribution::import_files/);
   await call(page,'intersect/packageImport',{files,revision:before.interfaceRevision});const loaded=await inspect(page);assert.deepEqual(loaded.package,active.package);assert.deepEqual(loaded.evaluation,active.evaluation);
   const forged=structuredClone(files),manifest=JSON.parse(forged['manifest.json']);manifest.compiler.name='intersect-model';forged['manifest.json']=JSON.stringify(manifest);
   const failed=await raw(page,'intersect/packageImport',{files:forged,revision:loaded.interfaceRevision});assert.ok(failed.error);assert.deepEqual(await inspect(page),loaded);
  }
 }
});
test('ordinary parameter project retains failed drafts and successful source recipes across reopen and restart',async({page})=>{
 await boot(page);const base=(await save(page)).value,c=ordinaryCases.find(c=>c.id==='false_call'),input=await ordinaryInput(page,c);
 const selected=role=>input.bundle.sources.find(s=>s.id.uri===input[role]?.uri&&s.id.sha256===input[role]?.sha256).text;
 const project=structuredClone(base);project.mode='language';project.profile='default';project.compilerProfile='intersect.xtext.native.v57';project.definitionBundle=input;
 project.definitions.rcore=selected('ecore');project.definitions.xtext=selected('xtext');project.definitions.rcore_behavior=selected('rcore_behavior');project.models={catalog:'alpha',loans:'alpha'};
 await open(page,project);const first=await compile(page);assert.ok(nodes(first).every(n=>n.b==='alpha'&&n.a===null));
 const edited=project.definitions.xtext.replace('Node<false>','Node<true>');await edit(page,edited);
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
 await expect(page.locator('#definition-state')).toContainText('Compiled',{timeout:60000});const active=await inspect(page);assert.notEqual(active.interfaceRevision,first.interfaceRevision);assert.notEqual(active.package.compilation.xtext.sha256,first.package.compilation.xtext.sha256);assert.ok(nodes(active).every(n=>n.a==='alpha'&&n.b===null));
 const invalid=edited.replace('Node<true>','Node');await edit(page,invalid);await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');
 for(const key of ['package','evaluation','revision','generation'])assert.deepEqual((await inspect(page))[key],active[key]);
 const saved=await save(page);assert.equal(saved.value.format,'intersect.toolkit.project.v3');assert.equal(saved.value.definitions.xtext,invalid);assert.deepEqual(saved.value.definitionRecovery.compilation,active.package.compilation);assert.equal(saved.value.definitionRecovery.compilerProfile,'intersect.xtext.native.v57');
 assert.ok(!JSON.stringify(saved.value).includes('intersect:parameter-program:'));assert.equal(saved.value.definitionInference,undefined);
 await page.evaluate(()=>{window.failNextParameterFormats=true;});
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
 await expect(page.locator('#compile-status')).toHaveText('Language restored · UI setup incomplete',{timeout:60000});
 const partial=await inspect(page);assert.notEqual(partial.interfaceRevision,active.interfaceRevision);assert.deepEqual(partial.package,active.package);assert.deepEqual((await save(page)).value,saved.value);await expect(page.locator('#compile')).toBeEnabled();
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
 await expect(page.locator('#definition-state')).toHaveText('Draft failed · previous language restored',{timeout:60000});assert.deepEqual((await inspect(page)).package,active.package);assert.equal((await save(page)).value.definitions.xtext,invalid);
 // Reopen into an unrelated fresh runtime: recovery must come from saved sources.
 await page.reload();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});await open(page,saved.bytes);
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
 await expect(page.locator('#definition-state')).toHaveText('Draft failed · previous language restored',{timeout:60000});assert.deepEqual((await inspect(page)).package,active.package);assert.equal((await save(page)).value.definitions.xtext,invalid);
 const recovered=await inspect(page);assert.ok(nodes(recovered).every(n=>n.a==='alpha'&&n.b===null));
});

test('ordinary parameter worker consumes all frozen default resources and source rejections',async({page})=>{
 await boot(page);await closeExamples(page);let version=0;const counts=[0,0,0,0,0];
 for(const c of ordinaryCases){
  const input=await ordinaryInput(page,c),before=await inspect(page),expected=ordinaryRows.metadata.find(r=>r.id===c.id);
  const compiled=await call(page,'intersect/compileBundle',{compilation:input,xtext_profile:'intersect.xtext.native.v57'});
  assert.equal(compiled.ok,expected.all_sources_accepted,`${c.id}: ${JSON.stringify(compiled.diagnostics)}`);
  if(!compiled.ok){counts[1]++;assert.deepEqual(await inspect(page),before);continue;}
  counts[0]++;assert.deepEqual(compiled.package.compilation,input);assert.equal(compiled.package.xtext_inference,undefined);
  for(const run of ordinaryRows.runs.filter(r=>r.case===c.id&&r.entry==='resource')){
   await model(page,run.text,++version);const state=await inspect(page),parsed=run.exception===null&&run.errors.length===0;
   assert.equal(state.evaluation.diagnostics.length===0,parsed,`${c.id}: ${run.text}`);
   const record=state.evaluation.model.resources[uri];assert.equal(record.load_state,'Loaded');assert.equal(record.roots.length,parsed?run.resource_contents:0);
   if(parsed){assert.deepEqual(record.source,{uri,revision:createHash('sha256').update(run.text).digest('hex')});assert.deepEqual(record.diagnostics,[]);}
   else{assert.equal(record.source,null);assert.ok(record.diagnostics.length>0);}
   if(run.accepted){counts[2]++;assert.deepEqual(modelProjection(state.package,state.evaluation.model),run.model);}
   else if(parsed){counts[4]++;assert.deepEqual(state.evaluation.model.elements,[]);}
   else{counts[3]++;assert.deepEqual(state.evaluation.model.elements,[]);}
  }
 }
 assert.deepEqual(counts,[31,17,34,42,1]);
});
test('ordinary recovery revalidates source digests and never admits a cached package',async({page})=>{
 await boot(page);const base=(await save(page)).value,c=ordinaryCases.find(c=>c.id==='false_call'),input=await ordinaryInput(page,c);
 const selected=role=>input.bundle.sources.find(s=>s.id.uri===input[role]?.uri&&s.id.sha256===input[role]?.sha256).text;
 const project=structuredClone(base);project.mode='language';project.profile='default';project.compilerProfile='intersect.xtext.native.v57';project.definitionBundle=input;
 project.definitions.rcore=selected('ecore');project.definitions.xtext=selected('xtext');project.definitions.rcore_behavior=selected('rcore_behavior');project.models={catalog:'alpha',loans:'alpha'};
 await open(page,project);const active=await compile(page);const saved=await save(page);
 const forbidden=structuredClone(saved.value);forbidden.definitionRecovery.package=active.package;
 await page.locator('#project-file').setInputFiles({name:'forged.intersect.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(forbidden))});
 await expect(page.locator('#project-status')).toContainText('Invalid ordinary source recovery recipe');assert.deepEqual(await inspect(page),active);
 const invalid=project.definitions.xtext.replace('Node<false>','Node');const corrupt=structuredClone(saved.value);corrupt.definitions.xtext=invalid;corrupt.definitionRecovery.compilation.bundle.sources[0].text+=' ';
 await open(page,corrupt);await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
 await expect(page.locator('#compile-status')).toHaveText('Could not recover ordinary language',{timeout:60000});assert.equal(Boolean((await inspect(page)).package),false);
 assert.equal((await save(page)).value.definitions.xtext,invalid);
});


const guardCases=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/guard-sequences/cases.json',import.meta.url),'utf8'));
const guardRows=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/guard-sequences/observations.json',import.meta.url),'utf8'));
test('guard sequences preserve all frozen ordinary and inferred worker outcomes and ZIPs',async({page})=>{
 await boot(page);await closeExamples(page);let version=0;const counts=[0,0,0,0];
 for(const variant of ['ordinary','inferred'])for(const c of guardCases[variant]){
  const stage=guardRows[variant].generation.find(g=>g.id===c.id).stage;
  if(stage==='generator_failed'){counts[3]+=c.runs.length;continue;}
  const input=variant==='ordinary'?await ordinaryInput(page,c):inputs(c),before=await inspect(page);
  const compiled=variant==='ordinary'?await call(page,'intersect/compileBundle',{compilation:input,xtext_profile:'intersect.xtext.native.v57'}):await call(page,'intersect/compileInferred',{inference:input});
  if(stage==='metadata_rejected'){
   assert.equal(compiled.ok,false,c.id);assert.ok(compiled.diagnostics.length);
   const failed=await inspect(page);for(const key of ['package','evaluation','revision','generation'])assert.deepEqual(failed[key],before[key]);
   counts[2]++;counts[3]+=c.runs.length;continue;
  }
  assert.equal(compiled.ok,true,`${c.id}: ${JSON.stringify(compiled.diagnostics)}`);
  if(variant==='ordinary'){assert.deepEqual(compiled.package.compilation,input);assert.equal(compiled.package.xtext_inference,undefined);}
  else assert.deepEqual(compiled.package.xtext_inference,input);
  const rows=guardRows[variant].runs.filter(r=>r.case===c.id);
  for(const run of rows){
   await model(page,run.text,++version);const state=await inspect(page);
   assert.equal(state.evaluation.diagnostics.length===0,run.accepted,`${c.id}/${run.text}: ${JSON.stringify(state.evaluation.diagnostics)}`);
   if(run.accepted){counts[0]++;assert.deepEqual(modelProjection(state.package,state.evaluation.model),run.model);}
   else{counts[1]++;assert.deepEqual(state.evaluation.model.elements,[]);}
  }
  const positive=rows.find(r=>r.accepted);assert.ok(positive,c.id);await model(page,positive.text,++version);
  const active=await inspect(page);assert.deepEqual(modelProjection(active.package,active.evaluation.model),positive.model);
  for(const python of [false,true]){
   const beforeExport=await inspect(page);
   const distribution=await call(page,'intersect/packageExport',{revision:beforeExport.interfaceRevision,metadata});
   const files=unpackLanguageArchive(await packageArchive(distribution,python));
   assert.deepEqual(JSON.parse(files[variant==='ordinary'?'definitions/bundle.json':'definitions/inference.json']),input);
   await call(page,'intersect/packageImport',{files,revision:beforeExport.interfaceRevision});
   const loaded=await inspect(page);assert.deepEqual(loaded.package,active.package);assert.deepEqual(loaded.evaluation,active.evaluation);
  }
 }
 assert.deepEqual(counts,[20,115,2,25]);
});


import {verifyNamedPreviews,verifyPreviewAuthority,verifyEmptyPreview,ordinary as entryOrdinaryCases} from './named-entry-controls.js';
async function entryPreviewHost(page){
 return{
  async compile(kind,c){
   const before=await inspect(page),input=kind==='ordinary'?await ordinaryInput(page,c):inputs(c);
   const result=kind==='ordinary'?await call(page,'intersect/compileBundle',{compilation:input,xtext_profile:'intersect.xtext.native.v57'}):await call(page,'intersect/compileInferred',{inference:input});
   if(!result.ok)assert.deepEqual(await inspect(page),before);return result;
  },
  async catalog(){const before=await inspect(page);const result=await call(page,'intersect/entryRules');assert.equal(result.interfaceRevision,before.interfaceRevision);assert.deepEqual(await inspect(page),before);return result;},
  async evaluate(entry,sources){const before=await inspect(page);const result=await call(page,'intersect/evaluateEntry',{interfaceRevision:before.interfaceRevision,entry_rule:entry,sources});assert.deepEqual(await inspect(page),before);return result;},
  async archive(python){const before=await inspect(page);const d=await call(page,'intersect/packageExport',{revision:before.interfaceRevision,metadata});const files=unpackLanguageArchive(await packageArchive(d,python));const loaded=await call(page,'intersect/packageImport',{files,revision:before.interfaceRevision});assert.deepEqual(loaded.package,before.package);return loaded;}
 };
}
test('named entry previews consume frozen catalogs, scalar values and both ZIPs without publishing a model',async({page})=>{
 await boot(page);await closeExamples(page);await verifyNamedPreviews(await entryPreviewHost(page));
});
test('named entry previews preserve resource atomicity and reject stale or malformed invocation contexts',async({page})=>{
 await boot(page);await closeExamples(page);const host=await entryPreviewHost(page);await verifyPreviewAuthority(host);
 await model(page,'alpha',1);const published=await inspect(page);assert.equal(published.evaluation.model.elements.length,2);
 const snapshot=await call(page,'intersect/evaluateEntry',{interfaceRevision:published.interfaceRevision,entry_rule:'Node'});
 assert.deepEqual(snapshot.diagnostics,[]);assert.equal(snapshot.model.elements.length,1);assert.equal(snapshot.entry_values[uri].kind,'object');assert.deepEqual(await inspect(page),published);
 const before=await inspect(page);await host.compile('ordinary',entryOrdinaryCases.find(c=>c.id==='true_call'));const current=await inspect(page);assert.notEqual(current.interfaceRevision,before.interfaceRevision);
 for(const params of [{interfaceRevision:before.interfaceRevision,entry_rule:'Node',sources:[]},{interfaceRevision:current.interfaceRevision,entry_rule:[]},{interfaceRevision:current.interfaceRevision}]){
  assert.ok((await raw(page,'intersect/evaluateEntry',params)).error);assert.deepEqual(await inspect(page),current);
 }
 await verifyEmptyPreview(host);
});


async function entryProject(page,id,rule){
 const original=(await save(page)).value,c=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/parameter-entry-contexts/cases.json',import.meta.url),'utf8')).cases.find(c=>c.id===id),input=await ordinaryInput(page,c);
 const text=role=>input.bundle.sources.find(s=>s.id.uri===input[role].uri&&s.id.sha256===input[role].sha256).text;
 const project={...original,format:'intersect.toolkit.project.v4',entryRule:rule,mode:'language',profile:'default',compilerProfile:'intersect.xtext.native.v57',definitionBundle:input,definitions:{ecore:'',rcore:text('ecore'),xtext:text('xtext'),rcore_behavior:text('rcore_behavior')},models:{catalog:'no',loans:'no'}};
 delete project.definitionRecovery;delete project.definitionInference;await open(page,project);return{c,input,project};
}
test('parser entry UI publishes scalar values, persists v4 and rebuilds original sources after reopen',async({page},testInfo)=>{
 await boot(page);await entryProject(page,'scalar_both','Word');await compile(page);
 await expect(page.locator('#parser-entry')).toHaveValue('Word');await expect(page.locator('#parser-entry-status')).toContainText('Active: Word');await expect(page.locator('#entry-results')).toContainText('Raw datatype text');
 let state=await inspect(page);assert.equal(state.entry_rule,'Word');assert.deepEqual(state.evaluation.diagnostics,[]);assert.deepEqual(state.evaluation.model.elements,[]);assert.equal(Object.keys(state.evaluation.entry_values).length,2);
 const saved=await save(page);assert.equal(saved.value.format,'intersect.toolkit.project.v4');assert.equal(saved.value.entryRule,'Word');assert.equal(saved.value.definitionRecovery.entryRule,'Word');assert.ok(!JSON.stringify(saved.value).includes('entry_values'));
 await page.reload();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});await open(page,saved.bytes);await compile(page);state=await inspect(page);assert.equal(state.entry_rule,'Word');assert.deepEqual(state.evaluation.diagnostics,[]);await expect(page.locator('#entry-results')).toContainText('Raw datatype text');
 const before=await inspect(page);const pending=await call(page,'intersect/transactionBegin',{});await page.locator('[data-activity="usage"]').click();await page.locator('#parser-entry').selectOption('');await expect.poll(async()=>(await inspect(page)).entry_rule).toBe(null);
 const resource=await inspect(page);assert.equal(resource.revision,before.revision);assert.ok(resource.generation>before.generation);assert.deepEqual(resource.package,before.package);assert.equal(resource.evaluation.entry_values,undefined);const stale=await raw(page,'intersect/scriptCommit',{interfaceRevision:pending.interfaceRevision,generation:pending.generation,transactionId:pending.transaction.context.id,model:pending.evaluation.model});assert.match(stale.error.message,/Stale transaction/);await call(page,'intersect/transactionFinish',{id:pending.transaction.context.id,status:'rolled_back',reason:'Entry changed',changes_complete:true});await expect(page.locator('#entry-results')).toBeHidden();
 await page.locator('#parser-entry').selectOption('Word');await expect.poll(async()=>(await inspect(page)).entry_rule).toBe('Word');assert.deepEqual((await inspect(page)).evaluation.diagnostics,[]);await page.screenshot({path:testInfo.outputPath('named-entry-ui.png')});
});
test('named parser activation rejects missing entries atomically and source recovery keeps the last successful entry',async({page})=>{
 await boot(page);const {c,input}=await entryProject(page,'scalar_both','Word');await compile(page);const active=await inspect(page);
 const bad=await raw(page,'intersect/compileBundle',{compilation:input,xtext_profile:'intersect.xtext.native.v57',entry_rule:'FORGED'});assert.ok(bad.error);assert.deepEqual(await inspect(page),active);
 const stale=await raw(page,'intersect/selectEntry',{interfaceRevision:'stale',entry_rule:null});assert.ok(stale.error);assert.deepEqual(await inspect(page),active);
 await edit(page,c.sources.find(s=>s.id===c.entry).source+' ??? invalid');await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');assert.deepEqual((await inspect(page)).package,active.package);
 const saved=await save(page);assert.equal(saved.value.entryRule,'Word');assert.equal(saved.value.definitionRecovery.entryRule,'Word');
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();await expect(page.locator('#compile-status')).toHaveText('Draft failed · previous ordinary language restored',{timeout:60000});
 const recovered=await inspect(page);assert.equal(recovered.entry_rule,'Word');assert.deepEqual(recovered.package,active.package);assert.deepEqual(recovered.evaluation.diagnostics,[]);await expect(page.locator('#entry-results')).toContainText('Raw datatype text');assert.equal((await save(page)).value.definitions.xtext,saved.value.definitions.xtext);
});


test('active entry selection consumes every frozen named request through the worker publication path',async({page})=>{
 await boot(page);await closeExamples(page);let version=0;const counts=[0,0,0];
 const extraCases=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/parameter-entry-contexts/cases.json',import.meta.url),'utf8')).cases;
 const extraRows=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/parameter-entry-contexts/observations.json',import.meta.url),'utf8'));
 const inferredCases=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-fragment-runtime/cases.json',import.meta.url),'utf8'));
 const inferredRows=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-fragment-runtime/observations.json',import.meta.url),'utf8'));
 for(const [kind,cases,rows]of [['ordinary',ordinaryCases,ordinaryRows],['ordinary',extraCases,extraRows],['inferred',inferredCases,inferredRows]])for(const c of cases){
  const runs=rows.runs.filter(r=>r.case===c.id&&r.entry!=='resource');if(!runs.length)continue;
  const input=kind==='ordinary'?await ordinaryInput(page,c):inputs(c);
  const built=kind==='ordinary'?await call(page,'intersect/compileBundle',{compilation:input,xtext_profile:'intersect.xtext.native.v57'}):await call(page,'intersect/compileInferred',{inference:input});assert.equal(built.ok,true,JSON.stringify(built.diagnostics));
  const catalog=await call(page,'intersect/entryRules');
  for(const run of runs){
   await model(page,run.text,++version);const before=await inspect(page);counts[0]++;
   if(!Object.hasOwn(catalog.entries,run.entry)){
    assert.ok(run.exception||run.errors?.length);assert.ok((await raw(page,'intersect/selectEntry',{interfaceRevision:before.interfaceRevision,entry_rule:run.entry})).error);assert.deepEqual(await inspect(page),before);continue;
   }
   await call(page,'intersect/selectEntry',{interfaceRevision:before.interfaceRevision,entry_rule:run.entry});const state=await inspect(page);
   assert.equal(state.entry_rule,run.entry);assert.equal(state.revision,before.revision);assert.ok(state.generation>before.generation);assert.deepEqual(state.package,before.package);
   const parsed=!run.exception&&run.errors?.length===0;assert.equal(state.evaluation.diagnostics.length===0,parsed,`${c.id}/${run.entry}/${run.text}`);
   if(run.accepted){assert.deepEqual(modelProjection(state.package,state.evaluation.model),run.model);counts[1]++;}else if(!parsed)assert.deepEqual(state.evaluation.model.elements,[]);
   const direct=rows.direct_entries?.find(r=>r.case===c.id&&r.entry===run.entry&&r.text===run.text);
   if(parsed&&direct?.value_kind==='string'){assert.deepEqual(state.evaluation.entry_values[uri],{kind:'datatype',value:direct.value});counts[2]++;}
  }
 }
 assert.equal(counts[0],41);assert.equal(counts[2],3);assert.ok(counts[1]>0);
});
async function inferredEntryProject(page,c,rule,text){
 const base=(await save(page)).value;const project={...base,format:'intersect.toolkit.project.v4',entryRule:rule,mode:'inferred',profile:'default',compilerProfile:'intersect.xtext.native.v56',definitionInference:{inputs:inputs(c),drafts:[]},definitions:{ecore:'',rcore:'',xtext:c.sources.find(s=>s.id===c.entry).source,rcore_behavior:''},models:{catalog:text,loans:text}};
 delete project.definitionBundle;delete project.definitionRecovery;delete project.definitionInferenceRecovery;delete project.definitionProviderDraft;await open(page,project);return project;
}
test('inferred entry UI persists named object and empty returns through save reopen and restart',async({page})=>{
 await boot(page);const matrix=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-parameters/cases.json',import.meta.url),'utf8')).lowercase_counterparts;
 await inferredEntryProject(page,matrix.find(c=>c.id==='false_call'),'Node','alpha');await compile(page);
 let state=await inspect(page);assert.equal(state.entry_rule,'Node');assert.equal(state.evaluation.model.elements.length,2);assert.deepEqual(state.evaluation.diagnostics,[]);await expect(page.locator('#parser-entry')).toHaveValue('Node');
 const saved=await save(page);assert.equal(saved.value.format,'intersect.toolkit.project.v6');assert.equal(saved.value.entryRule,'Node');assert.equal(saved.value.definitionInferenceRecovery.entryRule,'Node');assert.equal(Object.hasOwn(saved.value.definitionInferenceRecovery,'inference_context'),false);assert.equal(saved.value.definitionRecovery,undefined);
 await open(page,saved.bytes);await compile(page);await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});await expect.poll(async()=>(await inspect(page)).entry_rule,{timeout:60000}).toBe('Node');
 const empty=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-parameter-empty/cases.json',import.meta.url),'utf8')).find(c=>c.id==='root_empty');
 await inferredEntryProject(page,empty,'Model','node');await compile(page);state=await inspect(page);assert.equal(state.entry_rule,'Model');assert.deepEqual(state.evaluation.diagnostics,[]);assert.deepEqual(state.evaluation.model.elements,[]);assert.ok(Object.values(state.evaluation.entry_values).every(v=>v.kind==='empty'));await expect(page.locator('#entry-results')).toContainText('No object or datatype value');
});
test('requested entry and recovered entry remain distinct across fresh-page failed activation',async({page})=>{
 await boot(page);await entryProject(page,'scalar_both','Word');await compile(page);const saved=await save(page);saved.value.entryRule='FORGED';
 await page.reload();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});await open(page,saved.value);
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();await expect(page.locator('#compile-status')).toHaveText('Draft failed · previous ordinary language restored',{timeout:60000});
 assert.equal((await inspect(page)).entry_rule,'Word');await expect(page.locator('#parser-entry')).toHaveValue('FORGED');await expect(page.locator('#parser-entry-status')).toContainText('Active: Word · Requested: FORGED');
 const again=await save(page);assert.equal(again.value.entryRule,'FORGED');assert.equal(again.value.definitionRecovery.entryRule,'Word');
});

test('failed inferred draft restart restores its last successful entry without replacing the draft',async({page})=>{
 await boot(page);const matrix=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/inference-parameters/cases.json',import.meta.url),'utf8')).lowercase_counterparts;
 await inferredEntryProject(page,matrix.find(c=>c.id==='false_call'),'Node','alpha');await compile(page);const before=await inspect(page);
 await edit(page,'grammar invalid current draft ???');await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');
 await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();await expect(page.locator('#compile-status')).toHaveText('Draft failed · previous inferred language restored',{timeout:60000});
 const restored=await inspect(page);assert.equal(restored.entry_rule,'Node');assert.deepEqual(restored.package,before.package);assert.deepEqual(restored.evaluation.diagnostics,[]);assert.equal((await save(page)).value.definitions.xtext,'grammar invalid current draft ???');
});
