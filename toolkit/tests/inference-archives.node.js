import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
import {PYTHON_BINDING_VERSION} from '../src/python-api.js';
const root=fileURLToPath(new URL('../.runtime/intersect-text/',import.meta.url));
const target=resolve(root,process.env.CARGO_TARGET_DIR||'target');
for(const args of [
  ['build','-p','intersect-text-acceptance','--example','compatibility_corpus','--locked'],
  ['build','-p','intersect-web','--target','wasm32-unknown-unknown','--locked'],
]){const r=spawnSync('cargo',args,{cwd:root,stdio:'inherit'});assert.equal(r.status,0,r.error?.message);}
const output=spawnSync(resolve(target,`debug/examples/compatibility_corpus${process.platform==='win32'?'.exe':''}`),['archive-baseline'],{cwd:root,encoding:'utf8',maxBuffer:10_000_000});
assert.equal(output.status,0,output.stderr);
const ordinary=JSON.parse(output.stdout).distribution;
const baseline=JSON.parse(readFileSync(resolve(root,'fixtures/xtext/inference-archive/ordinary-baseline.json'),'utf8'));
const module=await WebAssembly.compile(readFileSync(resolve(target,'wasm32-unknown-unknown/debug/intersect_web.wasm')));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
async function runtime(){const {exports:e}=await WebAssembly.instantiate(module,{});return request=>{const bytes=new TextEncoder().encode(JSON.stringify(request));const p=e.input_buffer(bytes.length);assert.ok(p);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);const length=e.execute();const result=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),length)));if(result.error)throw new Error(result.error);return result;};}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cases=JSON.parse(readFileSync(resolve(root,'fixtures/xtext/inference-fragment-runtime/cases.json'),'utf8'));
const observations=JSON.parse(readFileSync(resolve(root,'fixtures/xtext/inference-fragment-runtime/observations.json'),'utf8'));
function inputs(c){const ids=new Map();const sources=c.sources.map(s=>{const id={uri:`memory:archive/${c.id}/${s.id}.xtext`,sha256:hash(s.source)};const dependencies=s.dependencies.map(n=>{assert.ok(ids.has(n));return ids.get(n);});ids.set(s.id,id);return {id,kind:'xtext',text:s.source,dependencies};});return {version:1,bundle:{version:1,sources,namespaces:[]},grammar:ids.get(c.entry)};}
const metadata={package_id:'inference.archive',release:'1',display_name:'Inferred source archive',description:''};
function projection(pkg,model){const uri=k=>{const d=pkg.schema.declarations[k];return `${d.namespace}#//${d.name}`;};const value=v=>{if(typeof v==='string'){const i=model.elements.findIndex(e=>e.id===v);if(i>=0)return {object:i,class:uri(model.elements[i].class)};}return Array.isArray(v)?v.map(value):v;};return model.elements.map(e=>({class:uri(e.class),values:Object.fromEntries(Object.entries(e.values).map(([k,v])=>[k,value(v)]))}));}
const source=text=>[{uri:'memory:archive-model.test',text}];
async function distribution(c){const invoke=await runtime();return invoke({method:'package/export',inference:inputs(c),metadata});}
test('ordinary manifest, payloads and both complete ZIP byte hashes remain unchanged',async()=>{
  assert.deepEqual(ordinary.manifest,baseline.manifest);
  assert.deepEqual(Object.fromEntries(Object.entries(ordinary.files).map(([k,v])=>[k,{bytes:Buffer.byteLength(v),sha256:hash(v)}])),baseline.files);
  for(const python of [false,true]){const bytes=await packageArchive(ordinary,python);const expected=baseline.zip[python?'python':'plain'];assert.equal(bytes.length,expected.bytes);assert.equal(hash(bytes),expected.sha256);const invoke=await runtime();assert.deepEqual(invoke({method:'package/import',files:unpackLanguageArchive(bytes)}).package,ordinary.package);}
});
for(const python of [false,true])test(`inferred actual ZIP sources -> fresh WASM import -> frozen models/rejections (Python ${python})`,async()=>{
  let successes=0,rejections=0;
  for(const c of cases){
    const d=await distribution(c);assert.equal(d.manifest.compiler.name,'intersect-text');assert.deepEqual(d.package.xtext_inference,inputs(c));assert.equal(d.package.compilation,undefined);
    const bytes=await packageArchive(d,python);assert.deepEqual(await packageArchive(d,python),bytes);
    const files=unpackLanguageArchive(bytes);const manifest=JSON.parse(files['manifest.json']);
    assert.match(files['README.txt'],/intersect_text::distribution::import_files/);assert.match(files['README.txt'],/definitions\/inference.json/);
    if(python){assert.equal(manifest.python.version,PYTHON_BINDING_VERSION);assert.equal(manifest.python.revision,manifest.revision);assert.equal(typeof files[manifest.python.source],'string');}
    else assert.equal(manifest.python,null);
    assert.deepEqual(JSON.parse(files['definitions/inference.json']),inputs(c));
    const invoke=await runtime();const loaded=invoke({method:'package/import',files});assert.deepEqual(loaded.package,d.package);
    for(const run of observations.runs.filter(r=>r.case===c.id&&r.entry==='resource')){
      const result=invoke({method:'evaluate',package:loaded.package,sources:source(run.text)});assert.equal(result.diagnostics.length===0,run.accepted,`${c.id}: ${JSON.stringify(result.diagnostics)}`);
      if(run.accepted){successes++;assert.deepEqual(projection(loaded.package,result.model),run.model);}else{rejections++;assert.deepEqual(result.model.elements,[]);}
    }
  }
  assert.deepEqual([cases.length,successes,rejections],[10,7,4]);
});
function redigest(files,path,value){files[path]=JSON.stringify(value);const m=JSON.parse(files['manifest.json']);m.files[path]={bytes:Buffer.byteLength(files[path]),sha256:hash(files[path])};files['manifest.json']=JSON.stringify(m);}
test('actual inferred archives reject corruption, forged IR, source/revision and metadata changes then recover',async()=>{
  const d=await distribution(cases[0]);const bytes=await packageArchive(d,true);const files=unpackLanguageArchive(bytes);const invoke=await runtime();
  const valid=()=>invoke({method:'package/import',files});const expected=valid().package;
  const invalids=[];
  let bad=structuredClone(files);bad['package.json']+=' ';invalids.push(bad);
  bad=structuredClone(files);let v=JSON.parse(bad['package.json']);v.grammar.entry='FORGED';redigest(bad,'package.json',v);invalids.push(bad);
  bad=structuredClone(files);v=JSON.parse(bad['definitions/inference.json']);v.bundle.sources[0].text+=' ';redigest(bad,'definitions/inference.json',v);invalids.push(bad);
  bad=structuredClone(files);v=JSON.parse(bad['definitions/inference.json']);v.extra={};redigest(bad,'definitions/inference.json',v);invalids.push(bad);
  for(const edit of [m=>{m.compiler.name='intersect-model';},m=>{m.compiler.version='other';},m=>{m.runtime.source_policy.xtext_bytes=256001;},m=>{m.python.version=999;},m=>{m.definitions.bundle=m.definitions.inference;},m=>{m.format_version=99;}]){bad=structuredClone(files);v=JSON.parse(bad['manifest.json']);edit(v);bad['manifest.json']=JSON.stringify(v);invalids.push(bad);}
  bad=structuredClone(files);delete bad['package.json'];invalids.push(bad);
  bad=structuredClone(files);bad['../unsafe']='';invalids.push(bad);
  bad=structuredClone(files);bad.oversized='x'.repeat(2_000_001);invalids.push(bad);
  bad=structuredClone(files);for(let i=0;i<65;i++)bad[`extra/${i}`]='';invalids.push(bad);
  for(const invalid of invalids){assert.throws(()=>invoke({method:'package/import',files:invalid}));assert.deepEqual(valid().package,expected);}
  const result=invoke({method:'evaluate',package:valid().package,sources:source('alpha')});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements[0].values.name,'alpha');
  const exported=invoke({method:'model/export',package:expected,model:result.model,format:'xmi'});const imported=invoke({method:'model/import',package:expected,format:'xmi',resources:exported.resources});assert.deepEqual(projection(expected,imported.model),projection(expected,result.model));
});
test('pinned source-encoding outcomes preserve Unicode bytes and explicitly reject leading BOM',async()=>{
  const encodingCases=JSON.parse(readFileSync(resolve(root,'fixtures/xtext/inference-archive/source-encoding-cases.json'),'utf8'));
  const encodingRows=JSON.parse(readFileSync(resolve(root,'fixtures/xtext/inference-archive/source-encoding-observations.json'),'utf8'));
  const original=await distribution(cases[0]);
  for(const [i,c] of encodingCases.entries()){
    const input=inputs(cases[0]);const s=input.bundle.sources[0];s.text=c.sources[0].source;s.id={...s.id,sha256:hash(s.text)};input.grammar=s.id;
    const invoke=await runtime();
    if(!encodingRows[i].all_sources_accepted){assert.throws(()=>invoke({method:'package/export',inference:input,metadata}));continue;}
    const changed=invoke({method:'package/export',inference:input,metadata});
    if(c.id==='archive_unicode')assert.notEqual(changed.manifest.revision,original.manifest.revision);
    const files=unpackLanguageArchive(await packageArchive(changed,false));assert.deepEqual(JSON.parse(files['definitions/inference.json']),input);
    const loaded=(await runtime())({method:'package/import',files});assert.deepEqual(loaded.package.xtext_inference,input);
    const result=invoke({method:'evaluate',package:loaded.package,sources:source('alpha')});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements[0].values.name,'alpha');
  }
});

test('unsupported inferred Python names remain explicit while the source-only archive executes',async()=>{
  const input=inputs(cases[0]);const s=input.bundle.sources[0];s.text=s.text.replace('name=ID','class=ID');s.id={...s.id,sha256:hash(s.text)};input.grammar=s.id;
  const invoke=await runtime();const d=invoke({method:'package/export',inference:input,metadata});
  await assert.rejects(packageArchive(d,true),/Python binding does not support identifier class/);
  const files=unpackLanguageArchive(await packageArchive(d,false));const loaded=(await runtime())({method:'package/import',files});
  const result=invoke({method:'evaluate',package:loaded.package,sources:source('alpha')});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements[0].values.class,'alpha');
});
