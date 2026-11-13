// Actual application-created Worker and source project/archive UI consumers.
// Full Java partial/error streams remain oracle evidence; native errors are atomic.
import {test, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bundleSourceSnapshot} from '../src/bundle-project.js';
import {fixtures, get, successes, profile, projectFor} from './grouped-negation-fixtures.js';
const sha = value => createHash('sha256').update(value).digest('hex');
const publicSha = sha(readFileSync(new URL('../public/intersect_web.wasm', import.meta.url)));
async function observe(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) { super(url, options); if (String(url).includes('language.worker')) window.groupedWorker = this; }
    };
  });
}
const request = (page, method, params={}) => page.evaluate(({method,params}) => new Promise((resolve,reject) => {
  const worker = window.groupedWorker;
  if (!worker) { reject(new Error('Missing actual application language worker')); return; }
  const id = `grouped-negation:${window.groupedRequestId=(window.groupedRequestId||0)+1}`;
  const listener = ({data}) => { if (data.id!==id) return; clearTimeout(timer); worker.removeEventListener('message',listener); if (data.error) reject(new Error(data.error.message)); else resolve(data.result); };
  const timer = setTimeout(() => { worker.removeEventListener('message',listener); reject(new Error('Language worker response timeout')); },15000);
  worker.addEventListener('message',listener); worker.postMessage({jsonrpc:'2.0',id,method,params});
}), {method,params});
const inspect = page => request(page,'intersect/inspect');
async function ready(page, closeDefaults=false) {
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  const actual = await page.evaluate(async () => {
    const response=await fetch('/intersect_web.wasm',{cache:'no-store'}); if(!response.ok) throw new Error('Missing runtime');
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
  });
  assert.equal(actual,publicSha,'Page and observed worker must use the pinned public artifact');
  if(closeDefaults) for(const name of ['catalog','loans']) await request(page,'textDocument/didClose',{textDocument:{uri:`file:///models/${name}.library`}});
}
function verifySources(state,c) {
  assert.equal(state.package.grammar.profile,profile); assert.deepEqual(state.package.compilation,c.compilation);
  const originals=c.compilation.bundle.sources;
  assert.deepEqual(state.package.schema.declarations.Model.source,c.compilation.ecore);
  assert.deepEqual(state.package.grammar.declaration_sources.Model.source,c.compilation.xtext);
  for(const span of Object.values(state.package.grammar.declaration_sources)) {
    const source=originals.find(s=>s.id.uri===span.source.uri && s.id.sha256===span.source.sha256);
    assert.ok(source,'Declaration must retain an exact original source identity');
    assert.equal(source.kind,'xtext'); assert.ok(span.start>=0 && span.end<=Buffer.byteLength(source.text));
  }
  const grammar=state.package.grammar;
  if(c.id==='nested_inline_multi' || c.id==='nested_multi_group') {
    const outer=grammar.terminals.VALUE.body.kind.Negated,group=outer.operand.kind.Sequence;
    assert.equal(group.length,1);const inner=group[0].kind.Negated;
    assert.ok(inner);assert.deepEqual(inner.excluded,[[120,120]]);
    assert.deepEqual(outer.excluded,[[0,119],[121,65535]]);
    assert.equal(inner.operand.kind.Sequence.length,1);assert.equal(inner.operand.kind.Sequence[0].kind.Alternative.length,2);
  }
  if(c.id==='nested_multi_call' || c.id==='nested_fragment') {
    const outer=grammar.terminals.VALUE.body.kind.Negated.operand.kind.Call;
    assert.equal(outer.name,'PAIR'); assert.equal(outer.body.kind.Call.name,'INNER'); assert.deepEqual(outer.body.kind.Call.body.kind.Literal,[97,98]);
  }
  if(c.id==='inherited_program_override') {
    const parent=originals.find(s=>s.kind==='xtext' && s.text.includes('grammar audit.MultiProgramBase '));
    assert.deepEqual(grammar.declaration_sources.VALUE.source,parent.id);
    assert.deepEqual(grammar.declaration_sources.PAIR.source,c.compilation.xtext);
    assert.equal(grammar.terminals.VALUE.body.kind.Negated.operand.kind.Call.name,'PAIR');
    assert.deepEqual(grammar.terminals.VALUE.body.kind.Negated.operand.kind.Call.body.kind.Literal,[120]);
  }
  if(c.id==='explicit_parent_multi') {
    const call=grammar.terminals.VALUE.body.kind.Negated.operand.kind.Call;
    const parent=originals.find(s=>s.kind==='xtext' && s.text.includes('grammar audit.ExplicitMultiBase '));
    assert.equal(call.name,'@audit.ExplicitMultiBase::PAIR');
    assert.deepEqual(grammar.declaration_sources[call.name].source,parent.id); assert.deepEqual(call.body.kind.Literal,[97,98]);
    assert.deepEqual(grammar.declaration_sources.PAIR.source,c.compilation.xtext);
  }
}
function verifyModel(state,c,inputs) {
  verifySources(state,c); assert.deepEqual(state.evaluation.diagnostics,[]);
  assert.equal(state.evaluation.model.elements.length,inputs.length);
  for(const element of state.evaluation.model.elements) {
    const input=inputs.find(v=>v.uri===element.resource); assert.ok(input);
    const oracle=successes(c).find(v=>v.text===input.text); assert.ok(oracle);
    assert.equal(element.id,input.uri+'#0'); assert.equal(element.class,'Model');
    assert.deepEqual(element.values,oracle.resource.model[0].values);
    assert.equal(element.start,0); assert.equal(element.end,Buffer.byteLength(input.text));
  }
}
async function openModels(page,c) {
  const inputs=successes(c).map((row,index)=>({uri:`memory:grouped-negation/${c.id}/${index}.model`,text:row.text}));
  for(const input of inputs) await request(page,'textDocument/didOpen',{textDocument:{...input,version:1,languageId:'intersect-model'}});
  await expect.poll(async()=>{const s=await inspect(page);return s.evaluation.diagnostics.length===0 && s.evaluation.model.elements.length===inputs.length;},{timeout:30000}).toBe(true);
  return inputs;
}
async function closeModels(page,inputs) { for(const input of inputs) await request(page,'textDocument/didClose',{textDocument:{uri:input.uri}}); }
function rehash(files,path,value) {
  const text=JSON.stringify(value),manifest=JSON.parse(files['manifest.json']);files[path]=text;
  manifest.files[path]={bytes:Buffer.byteLength(text),sha256:sha(text)};files['manifest.json']=JSON.stringify(manifest);
}

test('V62 application worker consumes all ten original graphs and rejects old profiles and rehashed nested execution caches atomically',async({page})=>{
  test.setTimeout(240000);await observe(page);await page.goto('/');await ready(page,true);
  assert.equal(fixtures.cases.length,10);assert.equal(fixtures.cases.reduce((n,c)=>n+successes(c).length,0),31);
  for(const c of fixtures.cases) {
    const compiled=await request(page,'intersect/compileBundle',{compilation:c.compilation,xtext_profile:profile});assert.equal(compiled.ok,true,JSON.stringify(compiled));
    const inputs=await openModels(page,c),active=await inspect(page);verifyModel(active,c,inputs);
    const rejected=await request(page,'intersect/compileBundle',{compilation:c.compilation,xtext_profile:'intersect.xtext.native.v61'});
    assert.equal(rejected.ok,false,c.id);assert.ok(rejected.diagnostics.length);assert.deepEqual(await inspect(page),active);
    await closeModels(page,inputs);
    const rejectedText={nested_inline_multi:'a',nested_multi_group:'a',inline_multi_call:'x',mixed_call:'x',inherited_program_override:'x'}[c.id] ?? 'ab';
    const uri=`memory:grouped-negation/${c.id}/atomic-rejection.model`;
    await request(page,'textDocument/didOpen',{textDocument:{uri,text:rejectedText,version:1,languageId:'intersect-model'}});
    await expect.poll(async()=>(await inspect(page)).evaluation.diagnostics.length).toBeGreaterThan(0);
    const failure=await inspect(page);assert.deepEqual(failure.package,active.package);assert.deepEqual(failure.evaluation.model.elements,[],'Native rejected resources must not publish upstream-style partial models');
    await request(page,'textDocument/didClose',{textDocument:{uri}});
  }
  const c=get('nested_multi_call');assert.equal((await request(page,'intersect/compileBundle',{compilation:c.compilation,xtext_profile:profile})).ok,true);
  const inputs=await openModels(page,c),active=await inspect(page);verifyModel(active,c,inputs);
  const exported=await request(page,'intersect/packageExport',{revision:active.interfaceRevision,metadata:{package_id:'browser.grouped.negation',release:'1',display_name:'Resolved negation',description:'Exact original graphs'}});
  const files={...exported.files,'manifest.json':JSON.stringify(exported.manifest)};
  for(const mutation of ['callee','nested-body','terminal-body','excluded']) {
    const forged=structuredClone(files),cached=JSON.parse(forged[exported.manifest.compiled_package]);
    const negated=cached.grammar.terminals.VALUE.body.kind.Negated;
    if(mutation==='callee') negated.operand.kind.Call.body.kind.Call.name='PAIR';
    if(mutation==='nested-body') negated.operand.kind.Call.body.kind.Call.body.kind={Literal:[120,121]};
    if(mutation==='terminal-body') cached.grammar.terminals.INNER.body.kind={Literal:[120,121]};
    if(mutation==='excluded') negated.excluded=[[120,120]];
    assert.deepEqual(cached.compilation,c.compilation);rehash(forged,exported.manifest.compiled_package,cached);
    await assert.rejects(()=>request(page,'intersect/packageImport',{files:forged,revision:active.interfaceRevision}),/Archived compiled package differs from freshly compiled definitions/);
    assert.deepEqual(await inspect(page),active,mutation+' must not publish cached execution authority');
  }
  assert.equal((await request(page,'intersect/packageImport',{files,revision:active.interfaceRevision})).ok,true);
  assert.deepEqual((await inspect(page)).package,active.package);assert.deepEqual((await inspect(page)).evaluation,active.evaluation);
  // A nested inline cache is also regenerated from its complete original source.
  await closeModels(page,inputs);
  const inline=get('nested_inline_multi');assert.equal((await request(page,'intersect/compileBundle',{compilation:inline.compilation,xtext_profile:profile})).ok,true);
  const inlineInputs=await openModels(page,inline),inlineActive=await inspect(page);verifyModel(inlineActive,inline,inlineInputs);
  const inlineExport=await request(page,'intersect/packageExport',{revision:inlineActive.interfaceRevision,metadata:{package_id:'browser.nested.inline',release:'1',display_name:'Nested source',description:'Original nested operand'}});
  const inlineFiles={...inlineExport.files,'manifest.json':JSON.stringify(inlineExport.manifest)};
  for(const field of ['excluded','operand']) {
    const forged=structuredClone(inlineFiles),cached=JSON.parse(forged[inlineExport.manifest.compiled_package]);
    const nested=cached.grammar.terminals.VALUE.body.kind.Negated.operand.kind.Sequence[0].kind.Negated;
    if(field==='excluded')nested.excluded=[];else nested.operand.kind={Literal:[120]};
    assert.deepEqual(cached.compilation,inline.compilation);rehash(forged,inlineExport.manifest.compiled_package,cached);
    await assert.rejects(()=>request(page,'intersect/packageImport',{files:forged,revision:inlineActive.interfaceRevision}),/Archived compiled package differs from freshly compiled definitions/);
    assert.deepEqual(await inspect(page),inlineActive);
  }
  await closeModels(page,inlineInputs);assert.equal((await request(page,'intersect/compileBundle',{compilation:c.compilation,xtext_profile:profile})).ok,true);
  // Atomic native rejection is separate from preserved upstream partial models.
  const uri='memory:grouped-negation/rejected.model';
  await request(page,'textDocument/didOpen',{textDocument:{uri,text:'ab',version:1,languageId:'intersect-model'}});
  await expect.poll(async()=>(await inspect(page)).evaluation.diagnostics.length).toBeGreaterThan(0);
  const failed=await inspect(page);assert.deepEqual(failed.package,active.package);assert.deepEqual(failed.evaluation.model.elements,[]);
  await request(page,'textDocument/didClose',{textDocument:{uri}});
  const restored=await openModels(page,c);verifyModel(await inspect(page),c,restored);
});

async function openProject(page,bytes) {
  await page.locator('#project-file').setInputFiles({name:'resolved-negation.intersect.json',mimeType:'application/json',buffer:bytes});
  await page.locator('#compile').click();await ready(page);
  await expect.poll(async()=>(await inspect(page)).package?.grammar?.profile,{timeout:60000}).toBe(profile);
}
test('V62 original nested and inherited source projects save and reopen complete packages and models in fresh application workers',async({page})=>{
  test.setTimeout(300000);await observe(page);
  for(const id of ['nested_inline_multi','inline_multi_call','nested_multi_call','inherited_program_override','explicit_parent_multi']) {
    await page.goto('/');await ready(page);const c=get(id),project=projectFor(c);await openProject(page,Buffer.from(JSON.stringify(project)));
    const originals=[{uri:'file:///models/catalog.library',text:project.models.catalog},{uri:'file:///models/loans.library',text:project.models.loans}];
    const original=await inspect(page);verifyModel(original,c,originals);
    await page.locator('.ide-file-menu > summary').click();const saving=page.waitForEvent('download');await page.locator('#save-project').click();
    const bytes=readFileSync(await(await saving).path()),saved=JSON.parse(bytes.toString('utf8'));
    assert.equal(saved.compilerProfile,profile);assert.deepEqual(saved.definitionBundle,c.compilation);assert.deepEqual(saved.definitionRecovery,{compilation:c.compilation,compilerProfile:profile});
    const retained=bundleSourceSnapshot(c.compilation);for(const key of ['rcore','xtext','rcore_behavior'])assert.equal(saved.definitions[key],retained[key]);
    const preview=await request(page,'intersect/lowerRcoreStructure',{uri:'memory:structure.rcore',text:retained.rcore,generated_uri:'memory:ecore'});
    assert.equal(preview.ok,true);assert.equal(saved.definitions.ecore,preview.lowering.generated.text,'XML is the native preview, not original Ecore');
    await page.reload();await ready(page);assert.notEqual((await inspect(page)).interfaceRevision,original.interfaceRevision);
    await openProject(page,bytes);const restored=await inspect(page);verifyModel(restored,c,originals);
    assert.deepEqual(restored.package,original.package);assert.deepEqual(restored.evaluation,original.evaluation);
  }
});
