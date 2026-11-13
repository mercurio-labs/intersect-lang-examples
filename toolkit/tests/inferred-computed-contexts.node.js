// Original source/projection consumers, not independent JVM qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
const read=name=>JSON.parse(readFileSync(new URL(`../.runtime/intersect-text/fixtures/xtext/inferred-computed-host-contexts/${name}`,import.meta.url),'utf8'));
const plan=read('plan.json'),contexts=read('contexts.json');
const module=await WebAssembly.compile(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
async function runtime(){const {exports:e}=await WebAssembly.instantiate(module,{});return request=>{const bytes=new TextEncoder().encode(JSON.stringify(request)),p=e.input_buffer(bytes.length);assert.ok(p);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);const n=e.execute(),result=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),n)));if(result?.error)throw new Error(result.error);return result;};}
const context=c=>contexts.find(r=>r.id===c.id).inference_context;
const compile=(invoke,c)=>{const r=invoke({method:'compile_inferred_with_context',inference:c.inference,inference_context:context(c)});assert.equal(r.ok,true,JSON.stringify(r));return r.package;};
const evaluate=(invoke,p,text,entry_rule=null)=>invoke({method:'evaluate',package:p,entry_rule,sources:[{uri:'memory:computed-host.model',text}]});
function verify(p,e,count,value='alpha'){
  assert.deepEqual(e.diagnostics,[]);assert.equal(e.model.elements.length,count);
  const item=e.model.elements.find(e=>p.schema.declarations[e.class].name==='Item');assert.deepEqual(item.values,{backing:value});assert.equal(e.derived[item.id].computed,value);
  if(count===2){const root=e.model.elements.find(e=>e.id!==item.id);assert.deepEqual(root.values,{child:item.id});}return item;
}
test('fresh WASM executes actual source projections through text, queries and script transactions',async()=>{
  for(const c of plan.cases){const invoke=await runtime(),p=compile(invoke,c),actual=evaluate(invoke,p,c.model_text),item=verify(p,actual,2);
    assert.deepEqual(p.xtext_inference.bundle,c.inference.bundle);assert.deepEqual(p.xtext_inference.behavior,c.behavior);
    verify(p,evaluate(invoke,p,c.named_model_text,'Item'),1);
    const next=await runtime();assert.deepEqual(evaluate(next,p,c.model_text),actual);assert.ok(next({method:'text/entries',package:p}).entries.Item);
    const query={schema_uri:p.schema.uri,schema_revision:p.schema.revision,from:item.class,select:[{name:'computed',expression:{op:'field',path:'computed'}}],limit:10};
    assert.deepEqual(next({method:'query/execute',package:p,model:actual.model,query}).rows,[['alpha']]);assert.deepEqual(next({method:'script/check',package:p,model:actual.model}),actual);
    const forged=structuredClone(p);forged.schema.classes=null;forged.semantics.derived=[];forged.sources={};assert.deepEqual(evaluate(next,forged,c.model_text),actual);
    const tx={id:'computed-wasm',language_revision:'1',base_generation:0};
    next({method:'script/begin',package:p,model:actual.model,revision:'1',context:tx});next({method:'script/set',revision:'1',id:item.id,feature:'computed',value:'beta'});
    const prepared=next({method:'script/commit',revision:'1'});verify(p,prepared,2,'beta');
    verify(p,next({method:'script/publish',package:p,before:actual.model,current:actual.model,model:prepared.model,context:tx,revision:'1',generation:0}),2,'beta');
    next({method:'script/begin',package:p,model:actual.model,revision:'1',context:tx});assert.throws(()=>next({method:'script/set',revision:'1',id:item.id,feature:'computed',value:false}));assert.throws(()=>next({method:'script/commit',revision:'1'}));
    assert.deepEqual(evaluate(next,p,c.model_text),actual);
    for(const provider of [{name:'test.projection',version:'1'},{name:'rcore.projection',version:'missing'}]){const bad=structuredClone(context(c));bad.computed_settings[0].provider=provider;assert.throws(()=>next({method:'compile_inferred_with_context',inference:c.inference,inference_context:bad}),/provider/);}
  }
});
for(const python of [false,true])test(`computed source ZIP with explicit provider reconstructs in fresh WASM (Python ${python})`,async()=>{
  for(const c of plan.cases){const invoke=await runtime(),p=compile(invoke,c),selected=context(c),metadata={package_id:'test.computed-host',release:'1',display_name:'Computed host',description:''};
    const archive=invoke({method:'package/export',inference:p.xtext_inference,inference_context:selected,metadata});assert.deepEqual(archive.package,p);
    const bytes=await packageArchive(archive,python);assert.deepEqual(await packageArchive(archive,python),bytes);const files=unpackLanguageArchive(bytes),fresh=await runtime();
    assert.throws(()=>fresh({method:'package/import',files}));const loaded=fresh({method:'package/import_with_context',files,inference_context:selected});assert.deepEqual(loaded.package,p);verify(p,evaluate(fresh,loaded.package,c.model_text),2);
    const bad=structuredClone(files),cached=JSON.parse(bad['package.json']);cached.semantics.derived=[];const text=JSON.stringify(cached),manifest=JSON.parse(bad['manifest.json']);bad['package.json']=text;manifest.files['package.json']={sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)};bad['manifest.json']=JSON.stringify(manifest);
    assert.throws(()=>fresh({method:'package/import_with_context',files:bad,inference_context:selected}));
    const invalid=structuredClone(selected);invalid.behavior.sha256='0'.repeat(64);assert.throws(()=>fresh({method:'package/import_with_context',files,inference_context:invalid}));
    assert.deepEqual(fresh({method:'package/import_with_context',files,inference_context:selected}).package,p);
  }
});
