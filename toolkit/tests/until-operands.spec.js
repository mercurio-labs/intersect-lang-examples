// Actual browser language-worker dispatch, not UI authoring/lifecycle qualification.
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const fixture=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/full-generated-until/native-cases.json',import.meta.url),'utf8'));
const source=fixture.cases.find(c=>c.id==='direct_until_suffix_c');
const profile='intersect.xtext.native.v60';
const publicSha=createHash('sha256').update(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url))).digest('hex');
// Observe the actual application-created worker in both Vite and static production.
async function observeWorker(page){
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{
      constructor(url,options){super(url,options);if(String(url).includes('language.worker'))window.observedUntilWorker=this;}
    };
  });
}
const request=(page,method,params={})=>page.evaluate(({method,params})=>new Promise((resolve,reject)=>{
  const worker=window.observedUntilWorker;
  if(!worker){reject(new Error('Application language worker was not observed'));return;}
  const id=`until-operands:${window.untilRequestId=(window.untilRequestId||0)+1}`;
  const listener=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',listener);if(data.error)reject(new Error(data.error.message));else resolve(data.result);};
  const timer=setTimeout(()=>{worker.removeEventListener('message',listener);reject(new Error('Observed language worker did not respond'));},15000);
  worker.addEventListener('message',listener);worker.postMessage({jsonrpc:'2.0',id,method,params});
}),{method,params});
const inspect=page=>request(page,'intersect/inspect');
async function ready(page){
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  const loadedSha=await page.evaluate(async()=>{const response=await fetch('/intersect_web.wasm',{cache:'no-store'});if(!response.ok)throw new Error('Missing public WASM');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');});
  assert.equal(loadedSha,publicSha,'The worker page must consume the verified public artifact');
  for(const name of ['catalog','loans'])await request(page,'textDocument/didClose',{textDocument:{uri:`file:///models/${name}.library`}});
}
async function boot(page){await observeWorker(page);await page.goto('/');await ready(page);}
async function models(page){
  const sources=[{uri:'memory:until-a.model',text:'@abc'},{uri:'memory:until-b.model',text:'@abcc'}];
  for(const source of sources)await request(page,'textDocument/didOpen',{textDocument:{...source,version:1,languageId:'intersect-model'}});
  await expect.poll(async()=>{const state=await inspect(page);return state.evaluation.diagnostics.length===0&&state.evaluation.model.elements.length===2&&state.evaluation.model.elements.every(e=>e.values.name===sources.find(s=>s.uri===e.resource)?.text);},{timeout:30000}).toBe(true);
  return sources;
}
function verify(state,sources){
  assert.equal(state.package.grammar.profile,profile);assert.deepEqual(state.package.compilation,source.compilation);
  assert.deepEqual(state.evaluation.diagnostics,[]);assert.equal(state.evaluation.model.elements.length,2);
  for(const element of state.evaluation.model.elements){const original=sources.find(s=>s.uri===element.resource);assert.ok(original);assert.equal(element.id,original.uri+'#0');assert.equal(element.class,'Model');assert.equal(element.values.name,original.text);assert.equal(element.start,0);assert.equal(element.end,Buffer.byteLength(original.text,'utf8'));}
  const node=until(state.package.grammar);assert.ok(node);assert.ok(node.operand);assert.ok(node.decision.states.length>2);
  const identity=source.compilation.xtext;assert.deepEqual(state.package.grammar.declaration_sources.VALUE.source,identity);
}
function until(value){if(value&&typeof value==='object'){if(value.UntilOperand)return value.UntilOperand;for(const v of Object.values(value)){const found=until(v);if(found)return found;}}}
test('explicit V60 worker consumes original Until graph with failed-publication atomicity, source-authoritative archives and fresh replay',async({page})=>{
  test.setTimeout(180000);await boot(page);
  const initial=await inspect(page);
  const compiled=await request(page,'intersect/compileBundle',{compilation:source.compilation,xtext_profile:profile});
  assert.equal(compiled.ok,true,JSON.stringify(compiled));assert.equal(compiled.revision,initial.revision+1);
  const sources=await models(page);const active=await inspect(page);verify(active,sources);
  const stale=structuredClone(source.compilation);stale.bundle.sources.find(s=>s.id.uri===stale.xtext.uri).text+=' ';
  for(const params of [
    {compilation:source.compilation,xtext_profile:'intersect.xtext.native.v59'},
    {compilation:stale,xtext_profile:profile},
  ]){
    const before=await inspect(page);const failed=await request(page,'intersect/compileBundle',params);
    assert.equal(failed.ok,false,JSON.stringify(failed));assert.ok(failed.diagnostics.length);assert.deepEqual(await inspect(page),before);
  }
  const beforeArchive=await inspect(page),exported=await request(page,'intersect/packageExport',{revision:beforeArchive.interfaceRevision,metadata:{package_id:'terminal.worker.until',release:'1',display_name:'Worker finite Until',description:'Exact source replay'}});
  const originalFiles={...exported.files,'manifest.json':JSON.stringify(exported.manifest)};
  for(const field of ['decision','operand']){
    const corrupted=structuredClone(originalFiles),cached=JSON.parse(corrupted['package.json']),node=until(cached.grammar);assert.ok(node);
    if(field==='decision')node.decision.states[0].accepting=!node.decision.states[0].accepting;else node.operand.kind={Literal:[120,121]};assert.deepEqual(cached.compilation,source.compilation);
    const text=JSON.stringify(cached),manifest=JSON.parse(corrupted['manifest.json']);corrupted['package.json']=text;manifest.files['package.json']={bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')};corrupted['manifest.json']=JSON.stringify(manifest);
    await assert.rejects(()=>request(page,'intersect/packageImport',{files:corrupted,revision:beforeArchive.interfaceRevision}),/Archived compiled package differs from freshly compiled definitions/);assert.deepEqual(await inspect(page),beforeArchive);
  }
  const imported=await request(page,'intersect/packageImport',{files:originalFiles,revision:beforeArchive.interfaceRevision});assert.equal(imported.ok,true);assert.deepEqual((await inspect(page)).evaluation,active.evaluation);
  const retained=structuredClone(active.package.compilation),oldSession=active.interfaceRevision;
  await page.reload();await ready(page);
  assert.notEqual((await inspect(page)).interfaceRevision,oldSession);
  const replay=await request(page,'intersect/compileBundle',{compilation:retained,xtext_profile:profile});assert.equal(replay.ok,true);assert.deepEqual(replay.package,active.package);
  const restoredSources=await models(page);const restored=await inspect(page);verify(restored,restoredSources);assert.deepEqual(restored.evaluation,active.evaluation);
});
