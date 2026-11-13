// Browser release/debug host transport over the same frozen source/model cases.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
const cases=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inference-fragment-runtime/cases.json',import.meta.url),'utf8'));
const observations=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inference-fragment-runtime/observations.json',import.meta.url),'utf8'));
function inputs(c){const ids=new Map();const sources=c.sources.map(s=>{const id={uri:`memory:browser-archive/${c.id}/${s.id}.xtext`,sha256:createHash('sha256').update(s.source).digest('hex')};const dependencies=s.dependencies.map(n=>ids.get(n));ids.set(s.id,id);return{id,kind:'xtext',text:s.source,dependencies};});return{version:1,bundle:{version:1,sources,namespaces:[]},grammar:ids.get(c.entry)};}
function projection(pkg,model){const uri=k=>{const d=pkg.schema.declarations[k];return `${d.namespace}#//${d.name}`;};const value=v=>{if(typeof v==='string'){const i=model.elements.findIndex(e=>e.id===v);if(i>=0)return{object:i,class:uri(model.elements[i].class)};}return Array.isArray(v)?v.map(value):v;};return model.elements.map(e=>({class:uri(e.class),values:Object.fromEntries(Object.entries(e.values).map(([k,v])=>[k,value(v)]))}));}
export async function verifyInferredArchiveBrowser(page){
  await page.evaluate(async()=>{window.__archiveTestModule=await WebAssembly.compile(await(await fetch('/intersect_web.wasm')).arrayBuffer());});
  const fresh=()=>page.evaluate(async()=>{window.__archiveTestExports=(await WebAssembly.instantiate(window.__archiveTestModule,{})).exports;});
  const invoke=request=>page.evaluate(request=>{const e=window.__archiveTestExports;const b=new TextEncoder().encode(JSON.stringify(request));const p=e.input_buffer(b.length);if(!p)throw new Error('Input budget');new Uint8Array(e.memory.buffer,p,b.length).set(b);const n=e.execute();const value=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),n)));if(value.error)throw new Error(value.error);return value;},request);
  let successes=0,rejections=0;
  for(const python of [false,true])for(const c of cases){
    await fresh();const input=inputs(c);const d=await invoke({method:'package/export',inference:input,metadata:{package_id:'browser.inference',release:'1',display_name:'Browser inferred source archive',description:''}});
    const bytes=await packageArchive(d,python);assert.deepEqual(await packageArchive(d,python),bytes);
    const files=unpackLanguageArchive(bytes);assert.deepEqual(JSON.parse(files['definitions/inference.json']),input);
    await fresh();const loaded=await invoke({method:'package/import',files});assert.deepEqual(loaded.package,d.package);
    for(const run of observations.runs.filter(r=>r.case===c.id&&r.entry==='resource')){
      const result=await invoke({method:'evaluate',package:loaded.package,sources:[{uri:'memory:browser-model.test',text:run.text}]});
      assert.equal(result.diagnostics.length===0,run.accepted,JSON.stringify(result.diagnostics));
      if(run.accepted){successes++;assert.deepEqual(projection(loaded.package,result.model),run.model);}else{rejections++;assert.deepEqual(result.model.elements,[]);}
    }
  }
  assert.deepEqual([successes,rejections],[14,8]);
}

export {cases as inferenceCases, observations as inferenceObservations, inputs as inferenceInputs, projection as modelProjection};
