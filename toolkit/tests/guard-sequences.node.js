// Fresh JSON/WASM instances rebuild source authority and both actual ZIP forms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
import {ordinaryInputs} from './ordinary-parameter-inputs.js';
import {inferenceInputs,modelProjection} from './inferred-archive-browser.js';
const root=fileURLToPath(new URL('../.runtime/intersect-text/',import.meta.url));
const cases=JSON.parse(readFileSync(resolve(root,'fixtures/xtext/guard-sequences/cases.json'),'utf8'));
const expected=JSON.parse(readFileSync(resolve(root,'fixtures/xtext/guard-sequences/observations.json'),'utf8'));
const module=await WebAssembly.compile(readFileSync(resolve(root,process.env.INTERSECT_GUARD_WASM||'../../public/intersect_web.wasm')));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
async function runtime(){const {exports:e}=await WebAssembly.instantiate(module,{});return request=>{const bytes=new TextEncoder().encode(JSON.stringify(request));const p=e.input_buffer(bytes.length);assert.ok(p);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);const n=e.execute();const result=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),n)));if(result.error)throw new Error(result.error);return result;};}
const metadata={package_id:'guard.sequences',release:'1',display_name:'Guard sequences',description:''};
for(const python of [false,true])test(`guard sequence JSON and actual ZIP outcomes (Python ${python})`,async()=>{
 const counts=[0,0,0,0];
 for(const variant of ['ordinary','inferred'])for(const c of cases[variant]){
  const stage=expected[variant].generation.find(g=>g.id===c.id).stage;
  if(stage==='generator_failed'){counts[3]+=c.runs.length;continue;}
  const invoke=await runtime();let input;
  if(variant==='ordinary'){
   const original=ordinaryInputs(c);
   const migrated=invoke({method:'ecore/migrateCompilation',compilation:original,targets:c.metamodels.map((m,i)=>({source:original.bundle.sources[i].id,uri:m.uri.replace('.ecore','.rcore')}))});
   assert.equal(migrated.ok,true);input=migrated.compilation;
   const compiled=invoke({method:'compile_bundle',compilation:input,xtext_profile:'intersect.xtext.native.v57'});
   if(stage==='metadata_rejected'){assert.equal(compiled.ok,false);counts[2]++;counts[3]+=c.runs.length;continue;}
   assert.equal(compiled.ok,true,`${c.id}: ${JSON.stringify(compiled.diagnostics)}`);
  }else input=inferenceInputs(c);
  const distribution=invoke({method:'package/export',...(variant==='ordinary'?{compilation:input,xtext_profile:'intersect.xtext.native.v57'}:{inference:input}),metadata});
  assert.equal(distribution.manifest.compiler.name,'intersect-text');
  const files=unpackLanguageArchive(await packageArchive(distribution,python));
  assert.deepEqual(JSON.parse(files[variant==='ordinary'?'definitions/bundle.json':'definitions/inference.json']),input);
  const fresh=await runtime(),loaded=fresh({method:'package/import',files});assert.deepEqual(loaded.package,distribution.package);
  for(const run of expected[variant].runs.filter(r=>r.case===c.id)){
   const result=fresh({method:'evaluate',package:loaded.package,sources:[{uri:'memory:guard-archive.model',text:run.text}]});
   assert.equal(result.diagnostics.length===0,run.accepted,`${c.id}/${run.text}: ${JSON.stringify(result.diagnostics)}`);
   if(run.accepted){counts[0]++;assert.deepEqual(modelProjection(loaded.package,result.model),run.model);}else{counts[1]++;assert.deepEqual(result.model.elements,[]);}
  }
 }
 assert.deepEqual(counts,[20,115,2,25]);
});
