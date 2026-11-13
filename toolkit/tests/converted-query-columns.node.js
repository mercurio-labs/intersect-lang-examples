import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
const read=name=>JSON.parse(readFileSync(new URL(`../.runtime/intersect-text/fixtures/xtext/inferred-host-contexts/${name}`,import.meta.url),'utf8'));
const plan=read('plan.json'),contexts=read('contexts.json');
const module=await WebAssembly.compile(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
async function runtime(){const {exports:e}=await WebAssembly.instantiate(module,{});return request=>{const bytes=new TextEncoder().encode(JSON.stringify(request)),p=e.input_buffer(bytes.length);assert.ok(p);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);const n=e.execute(),result=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),n)));if(result.error)throw new Error(result.error);return result;};}
function check(invoke,p,entry_rule=null){
 const evaluated=invoke({method:'evaluate',package:p,entry_rule,sources:[{uri:'memory:nominal-query.model',text:'paint'}]});assert.deepEqual(evaluated.diagnostics,[]);
 const paint=evaluated.model.elements.find(e=>p.schema.declarations[e.class].name==='Paint'),query={schema_uri:p.schema.uri,schema_revision:p.schema.revision,from:paint.class,select:[{name:'color',expression:{op:'field',path:'color'}}],limit:10};
 const request={method:'query/execute_with_conversions',package:p,model:evaluated.model,query};
 assert.deepEqual(invoke(request).rows,[[paint.values.color]]);
 assert.throws(()=>invoke({...request,method:'query/execute'}),/Unsupported query datatype/);
 const forged=structuredClone(request);forged.package.schema.classes=null;forged.package.grammar={forged:true};forged.package.semantics=null;assert.deepEqual(invoke(forged),invoke(request));
 const bad=structuredClone(request);bad.model.elements.find(e=>e.id===paint.id).values.color.provider.version='stale';assert.throws(()=>invoke(bad),/provider|Provider/);
 const order=structuredClone(request);order.query.order_by=[{expression:{op:'field',path:'color'}}];assert.throws(()=>invoke(order),/ordering/);
 assert.deepEqual(invoke(request).rows,[[paint.values.color]]);
}
test('fresh WASM executes exact nominal host columns through default and named source replay',async()=>{
 for(const c of plan.cases){const invoke=await runtime(),context=contexts.find(x=>x.id===c.id).inference_context,p=invoke({method:'compile_inferred_with_context',inference:c.inference,inference_context:context}).package;check(invoke,p);check(await runtime(),p,'Paint');}
});
test('both actual ZIP forms rebuild nominal query contexts in fresh WASM instances',async()=>{
 for(const c of plan.cases)for(const python of [false,true]){const invoke=await runtime(),context=contexts.find(x=>x.id===c.id).inference_context,archive=invoke({method:'package/export',inference:c.inference,inference_context:context,metadata:{package_id:'test.nominal-query',release:'1',display_name:'Nominal query',description:''}}),files=unpackLanguageArchive(await packageArchive(archive,python)),fresh=await runtime(),p=fresh({method:'package/import_with_context',files,inference_context:context}).package;check(fresh,p);}
});
