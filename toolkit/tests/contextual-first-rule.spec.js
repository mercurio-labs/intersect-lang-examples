// Actual application worker and bounded project save/reopen controls in dev and production.
// These retain original oracle graphs; they do not qualify all editor lifecycles or Ecore.
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bundleSourceSnapshot} from '../src/bundle-project.js';
const fixture=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/contextual-first-rule/native/native-cases.json',import.meta.url),'utf8'));
const get=id=>{const value=fixture.cases.find(c=>c.id===id);assert.ok(value,id);return value;};
const good=get('same_name_class_first');
const profile='intersect.xtext.native.v61';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicSha=sha(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
async function observeWorker(page){
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{
      constructor(url,options){super(url,options);if(String(url).includes('language.worker'))window.observedContextualWorker=this;}
    };
  });
}
const request=(page,method,params={})=>page.evaluate(({method,params})=>new Promise((resolve,reject)=>{
  const worker=window.observedContextualWorker;
  if(!worker){reject(new Error('Application language worker was not observed'));return;}
  const id=`contextual-first-rule:${window.contextualRequestId=(window.contextualRequestId||0)+1}`;
  const listener=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',listener);if(data.error)reject(new Error(data.error.message));else resolve(data.result);};
  const timer=setTimeout(()=>{worker.removeEventListener('message',listener);reject(new Error('Observed language worker did not respond'));},15000);
  worker.addEventListener('message',listener);worker.postMessage({jsonrpc:'2.0',id,method,params});
}),{method,params});
const inspect=page=>request(page,'intersect/inspect');
async function ready(page,closeDefaults=true){
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  const loadedSha=await page.evaluate(async()=>{const response=await fetch('/intersect_web.wasm',{cache:'no-store'});if(!response.ok)throw new Error('Missing public WASM');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');});
  assert.equal(loadedSha,publicSha,'The worker page must consume the verified public artifact');
  if(closeDefaults)for(const name of ['catalog','loans'])await request(page,'textDocument/didClose',{textDocument:{uri:`file:///models/${name}.library`}});
}
async function boot(page){await observeWorker(page);await page.goto('/');await ready(page);}

function verify(state,resources){
  assert.equal(state.package.grammar.profile,profile);
  assert.deepEqual(state.package.compilation,good.compilation);
  assert.deepEqual(state.package.grammar.declaration_sources.Model.source,good.compilation.xtext);
  assert.deepEqual(state.package.schema.declarations.EString.source,good.compilation.ecore);
  assert.equal(state.package.schema.declarations.EString.namespace,good.compilation.namespace);
  assert.deepEqual(state.evaluation.diagnostics,[]);
  assert.equal(state.evaluation.model.elements.length,resources.length);
  for(const element of state.evaluation.model.elements){
    assert.ok(resources.includes(element.resource));
    assert.equal(element.id,element.resource+'#0');assert.equal(element.class,'EString');
    assert.deepEqual(element.values,{members:[],name:'a'});assert.equal(element.start,0);assert.equal(element.end,1);
  }
}
async function openModel(page){
  const uri='memory:contextual-first-rule.model';
  await request(page,'textDocument/didOpen',{textDocument:{uri,text:'a',version:1,languageId:'intersect-model'}});
  await expect.poll(async()=>{const s=await inspect(page);return s.evaluation.diagnostics.length===0&&s.evaluation.model.elements.length===1;},{timeout:30000}).toBe(true);
  return [uri];
}
function rehash(files,manifest,path,value){
  const text=JSON.stringify(value);files[path]=text;
  manifest.files[path]={bytes:Buffer.byteLength(text),sha256:sha(Buffer.from(text))};
  files['manifest.json']=JSON.stringify(manifest);
}

test('V61 worker validates original local and inherited first rules before publication and archive replay',async({page})=>{
  test.setTimeout(180000);await boot(page);
  const compiled=await request(page,'intersect/compileBundle',{compilation:good.compilation,xtext_profile:profile});
  assert.equal(compiled.ok,true,JSON.stringify(compiled));
  const resources=await openModel(page),active=await inspect(page);verify(active,resources);
  for(const id of ['terminal_before_local_model','terminal_child_over_model_parent','enum_before_local_model']){
    const original=get(id),before=await inspect(page);
    const rejected=await request(page,'intersect/compileBundle',{compilation:original.compilation,xtext_profile:profile});
    assert.equal(rejected.ok,false,id);assert.ok(rejected.diagnostics.some(d=>/first rule must be a parser rule/.test(d.message)),JSON.stringify(rejected));
    assert.deepEqual(await inspect(page),before,'A rejected authored graph must preserve the active package and model');
  }
  const before=await inspect(page);
  const exported=await request(page,'intersect/packageExport',{revision:before.interfaceRevision,metadata:{package_id:'contextual.browser.entry',release:'1',display_name:'Contextual first rule',description:'Original source authority'}});
  const originalFiles={...exported.files,'manifest.json':JSON.stringify(exported.manifest)};
  const invalidBundle=structuredClone(originalFiles),badManifest=structuredClone(exported.manifest);
  rehash(invalidBundle,badManifest,badManifest.definitions.bundle,get('enum_before_local_model').compilation);
  await assert.rejects(()=>request(page,'intersect/packageImport',{files:invalidBundle,revision:before.interfaceRevision}),/first rule must be a parser rule/);
  assert.deepEqual(await inspect(page),before);
  const invalidCache=structuredClone(originalFiles),cacheManifest=structuredClone(exported.manifest);
  const cached=JSON.parse(invalidCache[cacheManifest.compiled_package]);cached.grammar.entry='forgedEntry';
  assert.deepEqual(cached.compilation,good.compilation);
  rehash(invalidCache,cacheManifest,cacheManifest.compiled_package,cached);
  await assert.rejects(()=>request(page,'intersect/packageImport',{files:invalidCache,revision:before.interfaceRevision}),/Archived compiled package differs from freshly compiled definitions/);
  assert.deepEqual(await inspect(page),before);
  const imported=await request(page,'intersect/packageImport',{files:originalFiles,revision:before.interfaceRevision});assert.equal(imported.ok,true);
  assert.deepEqual((await inspect(page)).evaluation,active.evaluation);
  await page.reload();await ready(page);assert.notEqual((await inspect(page)).interfaceRevision,before.interfaceRevision);
  const replay=await request(page,'intersect/compileBundle',{compilation:active.package.compilation,xtext_profile:profile});
  assert.equal(replay.ok,true);assert.deepEqual(replay.package,active.package);
  const restoredResources=await openModel(page),restored=await inspect(page);verify(restored,restoredResources);
  assert.deepEqual(restored.evaluation,active.evaluation);
});

function projectFor(){
  const compilation=structuredClone(good.compilation);
  return {format:'intersect.toolkit.project.v3',mode:'language',profile:'default',compilerProfile:profile,structureSource:'rcore',definitionBundle:compilation,definitionRecovery:{compilation:structuredClone(compilation),compilerProfile:profile},definitions:bundleSourceSnapshot(compilation),models:{catalog:'a',loans:'a'},python:'',layout:{version:1,positions:{},zoom:1}};
}
async function openProject(page,bytes){
  await page.locator('#project-file').setInputFiles({name:'contextual-first-rule.intersect.json',mimeType:'application/json',buffer:bytes});
  await page.locator('#compile').click();await ready(page,false);
  await expect.poll(async()=>{const s=await inspect(page);return s.package?.grammar?.profile===profile&&s.evaluation.diagnostics.length===0&&s.evaluation.model.elements.length===2;},{timeout:60000}).toBe(true);
}

test('V61 original source project saves and reopens into a fresh application worker',async({page})=>{
  test.setTimeout(180000);await boot(page);
  await openProject(page,Buffer.from(JSON.stringify(projectFor())));
  const resources=['file:///models/catalog.library','file:///models/loans.library'];
  const original=await inspect(page);verify(original,resources);
  // The saved XML field is a native-rendered preview, not an original Ecore input.
  const retained=bundleSourceSnapshot(good.compilation);
  const preview=await request(page,'intersect/lowerRcoreStructure',{uri:'memory:structure.rcore',text:retained.rcore,generated_uri:'memory:ecore'});
  assert.equal(preview.ok,true,JSON.stringify(preview));
  await page.locator('.ide-file-menu > summary').click();
  const saving=page.waitForEvent('download');await page.locator('#save-project').click();
  const download=await saving,bytes=readFileSync(await download.path()),saved=JSON.parse(bytes.toString('utf8'));
  assert.equal(saved.compilerProfile,profile);assert.deepEqual(saved.definitionBundle,good.compilation);
  assert.deepEqual(saved.definitionRecovery,{compilation:good.compilation,compilerProfile:profile});
  for(const key of ['rcore','xtext','rcore_behavior'])assert.equal(saved.definitions[key],retained[key],key+' authored source must remain exact');
  assert.equal(saved.definitions.ecore,preview.lowering.generated.text,'Saved XML must equal the separately requested native preview of the retained Rcore');
  await page.reload();await ready(page);assert.notEqual((await inspect(page)).interfaceRevision,original.interfaceRevision);
  await openProject(page,bytes);const restored=await inspect(page);verify(restored,resources);
  assert.deepEqual(restored.package,original.package);assert.deepEqual(restored.evaluation,original.evaluation);
});
