// Frozen source-backed collection consumers; native extension, not JVM evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
const read=name=>JSON.parse(readFileSync(new URL(`../.runtime/intersect-text/fixtures/xtext/inferred-computed-collection-contexts/${name}`,import.meta.url),'utf8'));
const plan=read('plan.json'),contexts=read('contexts.json'),before=read('before.json');
const module=await WebAssembly.compile(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
async function runtime(){const {exports:e}=await WebAssembly.instantiate(module,{});return request=>{const bytes=new TextEncoder().encode(JSON.stringify(request)),p=e.input_buffer(bytes.length);assert.ok(p);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);const n=e.execute(),result=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),n)));if(result?.error)throw new Error(result.error);return result;};}
const context=c=>contexts.find(r=>r.id===c.id).inference_context;
const compile=(invoke,c,selected=context(c))=>{const r=invoke({method:'compile_inferred_with_context',inference:c.inference,inference_context:selected});assert.equal(r.ok,true,JSON.stringify(r));return r.package;};
const evaluate=(invoke,p,text,entry_rule=null)=>invoke({method:'evaluate',package:p,entry_rule,sources:[{uri:'memory:computed-collection.model',text}]});
function verify(p,e,values,count=2,assigned=true){
  assert.deepEqual(e.diagnostics,[],JSON.stringify(e));assert.equal(e.model.elements.length,count);
  const item=e.model.elements.find(e=>p.schema.declarations[e.class].name==='Item');assert.deepEqual(item.values,{backing:values});assert.deepEqual(e.derived[item.id].computed,values);
  assert.equal(item.assignment_state.set_features.includes('backing'),assigned);
  if(count===2){const root=e.model.elements.find(e=>e.id!==item.id);assert.deepEqual(root.values,{child:item.id});}return item;
}
const begin=(invoke,p,e)=>invoke({method:'script/begin',package:p,model:e.model,revision:'1'});
const edit=(invoke,method,id,extra={})=>invoke({method,revision:'1',id,feature:'computed',...extra});
test('fresh WASM replays original append text and checks transactional append, unset and assignment state',async()=>{
 for(const c of plan.cases){const invoke=await runtime(),p=compile(invoke,c),e=evaluate(invoke,p,c.model_text),item=verify(p,e,['alpha','beta']);
  assert.deepEqual(p.xtext_inference.bundle,c.inference.bundle);assert.deepEqual(p.xtext_inference.behavior,c.behavior);
  const named=evaluate(invoke,p,c.named_model_text,'Item');if(c.id==='plain')verify(p,named,['alpha','beta'],1);else assert.deepEqual(named,before.cases.find(old=>old.id===c.id).observations[2].response);
  const fresh=await runtime();assert.deepEqual(evaluate(fresh,p,c.model_text),e);
  begin(fresh,p,e);assert.equal(edit(fresh,'script/collection',item.id,{operation:'add',value:'gamma'}),true);
  assert.deepEqual(edit(fresh,'script/get',item.id),['alpha','beta','gamma']);assert.equal(edit(fresh,'script/is_set',item.id),true);
  verify(p,fresh({method:'script/commit',revision:'1'}),['alpha','beta','gamma']);
  begin(fresh,p,e);edit(fresh,'script/unset',item.id);assert.deepEqual(edit(fresh,'script/get',item.id),[]);assert.equal(edit(fresh,'script/is_set',item.id),false);
  const unset=fresh({method:'script/commit',revision:'1'});verify(p,unset,[],2,false);
  begin(fresh,p,unset);edit(fresh,'script/collection',item.id,{operation:'add',value:'delta'});verify(p,fresh({method:'script/commit',revision:'1'}),['delta']);
  begin(fresh,p,e);edit(fresh,'script/set',item.id,{value:[]});assert.equal(edit(fresh,'script/is_set',item.id),true);verify(p,fresh({method:'script/commit',revision:'1'}),[]);
 }
});
test('WASM source operation contracts and failed collection edits abort without changing the original model',async()=>{
 for(const c of plan.cases){const invoke=await runtime(),p=compile(invoke,c),e=evaluate(invoke,p,c.model_text),item=verify(p,e,['alpha','beta']);
  for(const value of [false,null,['gamma']]){begin(invoke,p,e);assert.throws(()=>edit(invoke,'script/collection',item.id,{operation:'add',value}));assert.throws(()=>invoke({method:'script/commit',revision:'1'}));assert.deepEqual(evaluate(invoke,p,c.model_text),e);}
  begin(invoke,p,e);edit(invoke,'script/collection',item.id,{operation:'add',value:'alpha'});verify(p,invoke({method:'script/commit',revision:'1'}),['alpha','beta','alpha']);
  begin(invoke,p,e);edit(invoke,'script/collection',item.id,{operation:'add',value:'gamma'});assert.throws(()=>edit(invoke,'script/collection',item.id,{operation:'add',value:'delta'}));assert.throws(()=>invoke({method:'script/commit',revision:'1'}));
  begin(invoke,p,e);assert.throws(()=>edit(invoke,'script/set',item.id,{value:['alpha','beta','gamma','delta']}));assert.throws(()=>invoke({method:'script/commit',revision:'1'}));
  for(const operation of ['clear','remove','insert','replace','remove_at','move']){begin(invoke,p,e);assert.throws(()=>edit(invoke,'script/collection',item.id,{operation,value:'alpha',index:0,from:0,to:1}),/computed.*collection|collection.*computed/i);assert.throws(()=>invoke({method:'script/commit',revision:'1'}));}
  const selected=structuredClone(context(c));selected.computed_settings[0].operations=['append'];const narrow=compile(invoke,c,selected);
  for(const method of ['script/set','script/unset']){begin(invoke,narrow,e);assert.throws(()=>edit(invoke,method,item.id,{value:['gamma']}),/operation is not declared/);assert.throws(()=>invoke({method:'script/commit',revision:'1'}));}
  selected.computed_settings[0].operations=['set','unset'];const rejected=invoke({method:'compile_inferred_with_context',inference:c.inference,inference_context:selected});assert.equal(rejected.ok,false);
  begin(invoke,p,e);edit(invoke,'script/collection',item.id,{operation:'add',value:'delta'});verify(p,invoke({method:'script/commit',revision:'1'}),['alpha','beta','delta']);
 }
 for(const old of before.shape_conflicts){const invoke=await runtime();assert.deepEqual(invoke(old.request),old.response);}
});
for(const python of [false,true])test(`collection source ZIP rebuilds original providers in fresh WASM (Python ${python})`,async()=>{
 for(const c of plan.cases){const invoke=await runtime(),p=compile(invoke,c),selected=context(c),metadata={package_id:'test.computed-collections',release:'1',display_name:'Computed collections',description:''};
  const archive=invoke({method:'package/export',inference:p.xtext_inference,inference_context:selected,metadata});assert.deepEqual(archive.package,p);
  const files=unpackLanguageArchive(await packageArchive(archive,python)),fresh=await runtime();assert.throws(()=>fresh({method:'package/import',files}));
  const loaded=fresh({method:'package/import_with_context',files,inference_context:selected});assert.deepEqual(loaded.package,p);
  const e=evaluate(fresh,loaded.package,c.model_text),item=verify(p,e,['alpha','beta']);begin(fresh,loaded.package,e);edit(fresh,'script/collection',item.id,{operation:'add',value:'gamma'});verify(p,fresh({method:'script/commit',revision:'1'}),['alpha','beta','gamma']);
  const bad=structuredClone(selected);bad.computed_settings[0].sources=[];assert.throws(()=>fresh({method:'package/import_with_context',files,inference_context:bad}));assert.deepEqual(fresh({method:'package/import_with_context',files,inference_context:selected}).package,p);
 }
});
