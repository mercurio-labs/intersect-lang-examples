// Native/provider extension consumers, not new JVM qualification outcomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
const read=name=>JSON.parse(readFileSync(new URL(`../.runtime/intersect-text/fixtures/xtext/inferred-host-contexts/${name}`,import.meta.url),'utf8'));
const plan=read('plan.json'),contexts=read('contexts.json');
const module=await WebAssembly.compile(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
async function runtime(){const {exports:e}=await WebAssembly.instantiate(module,{});return request=>{const bytes=new TextEncoder().encode(JSON.stringify(request)),p=e.input_buffer(bytes.length);assert.ok(p);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);const n=e.execute(),result=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),n)));if(result.error)throw new Error(result.error);return result;};}
const selection=c=>contexts.find(r=>r.id===c.id).inference_context;
const compile=(invoke,c)=>{const r=invoke({method:'compile_inferred_with_context',inference:c.inference,inference_context:selection(c)});assert.equal(r.ok,true,JSON.stringify(r));return r.package;};
const evaluate=(invoke,package_,entry_rule=null)=>invoke({method:'evaluate',package:package_,entry_rule,sources:[{uri:'memory:host-context.model',text:'paint'}]});
function verify(package_,evaluation,count){
  assert.deepEqual(evaluation.diagnostics,[]);assert.equal(evaluation.model.elements.length,count);
  const paint=evaluation.model.elements.find(e=>package_.schema.declarations[e.class].name==='Paint'),contract=package_.schema.conversion_contracts[0];
  assert.equal(package_.schema.declarations[paint.class].namespace,'urn:inferred:paint');
  assert.deepEqual(paint.values,{color:{kind:'converted',datatype:contract.datatype,provider:contract.provider,value:{red:18,green:58,blue:188}}});
  if(count===2){const root=evaluation.model.elements.find(e=>e.id!==paint.id);assert.deepEqual(root.values,{child:paint.id});}return paint;
}
test('fresh WASM executes installed inferred defaults and reconstructs source authority across host services',async()=>{
  for(const c of plan.cases){const invoke=await runtime(),p=compile(invoke,c),actual=evaluate(invoke,p),paint=verify(p,actual,2);verify(p,evaluate(invoke,p,'Paint'),1);
    const next=await runtime();assert.deepEqual(evaluate(next,p),actual);assert.ok(next({method:'text/entries',package:p}).entries.Paint);
    const root=actual.model.elements.find(e=>e.id!==paint.id),query={schema_uri:p.schema.uri,schema_revision:p.schema.revision,from:root.class,select:[{name:'child',expression:{op:'field',path:'child'}}],limit:10};
    assert.deepEqual(next({method:'query/execute',package:p,model:actual.model,query}).rows,[[paint.id]]);
    assert.deepEqual(next({method:'script/check',package:p,model:actual.model}),actual);
    assert.throws(()=>next({method:'model/export',package:p,model:actual.model,format:'xmi'}),/Explicit conversion registry required/);
    const bad=structuredClone(p);bad.schema.classes=null;bad.grammar={forged:true};bad.sources={};assert.deepEqual(evaluate(next,bad),actual);
    const invalid=structuredClone(selection(c));invalid.conversions[0].provider.version='missing';assert.throws(()=>next({method:'compile_inferred_with_context',inference:c.inference,inference_context:invalid}),/provider|Provider/);
    assert.throws(()=>next({method:'compile_inferred',inference:c.inference,conversions:selection(c).conversions}),/does not accept conversions/);
    assert.deepEqual(evaluate(next,p),actual);
  }
});
for(const python of [false,true])test(`inferred converted sources survive real ZIP export and fresh-instance import (Python ${python})`,async()=>{
  for(const c of plan.cases){const invoke=await runtime(),p=compile(invoke,c),context=selection(c);
    const archive=invoke({method:'package/export',inference:c.inference,inference_context:context,metadata:{package_id:'test.inferred-host',release:'1',display_name:'Host catalog',description:''}});
    assert.deepEqual(archive.package,p);const bytes=await packageArchive(archive,python);assert.deepEqual(await packageArchive(archive,python),bytes);
    const files=unpackLanguageArchive(bytes),fresh=await runtime();assert.throws(()=>fresh({method:'package/import',files}));
    const loaded=fresh({method:'package/import_with_context',files,inference_context:context});assert.deepEqual(loaded.package,p);verify(p,evaluate(fresh,loaded.package),2);
    const invalid=structuredClone(files),cached=JSON.parse(invalid['package.json']);cached.grammar.entry='FORGED';const text=JSON.stringify(cached),manifest=JSON.parse(invalid['manifest.json']);
    invalid['package.json']=text;manifest.files['package.json']={sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)};invalid['manifest.json']=JSON.stringify(manifest);
    assert.throws(()=>fresh({method:'package/import_with_context',files:invalid,inference_context:context}));
    assert.deepEqual(fresh({method:'package/import_with_context',files,inference_context:context}).package,p);
  }
});
