// Shared Rust/WASM consumers. No terminal semantics are implemented in JavaScript.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../.runtime/intersect-text/',import.meta.url));
const read=name=>readFileSync(resolve(root,'fixtures/xtext/terminal-negation',name));
const fixture=JSON.parse(read('native-cases.json'));
const originalCases=[...JSON.parse(read('cases.json')),...JSON.parse(read('nested-cases.json'))];
const observations=[...JSON.parse(read('observations.json')),...JSON.parse(read('nested-observations.json'))];
const allCases=[...fixture.cases,...fixture.nested_companions];
const binary=readFileSync(process.env.INTERSECT_TEST_WASM||resolve(root,'../../public/intersect_web.wasm'));
const digest=b=>createHash('sha256').update(b).digest('hex');
assert.equal(digest(read('cases.json')),fixture.oracle_cases_sha256);
assert.equal(digest(read('nested-cases.json')),fixture.nested_cases_sha256);
const supported=new Set(['literal','range','alternatives','nested_groups','fragment','fragment_alternatives','fragment_nested','committed_failure','negated_repeat','inherited_override','explicit_parent','inherited_program_override','committed_path','nested_negated','negated_fragment']);
const get=id=>allCases.find(c=>c.id===id);
async function runtime(){
  const module=await WebAssembly.compile(binary);assert.deepEqual(WebAssembly.Module.imports(module),[]);
  const {exports:w}=await WebAssembly.instantiate(module,{});
  return request=>{const bytes=new TextEncoder().encode(JSON.stringify(request));const pointer=w.input_buffer(bytes.length);assert.ok(pointer);new Uint8Array(w.memory.buffer,pointer,bytes.length).set(bytes);const size=w.execute();const result=JSON.parse(new TextDecoder().decode(new Uint8Array(w.memory.buffer,w.output_buffer(),size)));if(result.error)throw new Error(result.error);return result;};
}
function compile(invoke,c,profile='intersect.xtext.native.v58'){
  return invoke({method:'compile_bundle',compilation:c.compilation,xtext_profile:profile});
}
function value(invoke,pkg,text,accepted,uri='memory:terminal-negation/value.model'){
  const result=invoke({method:'evaluate',package:pkg,sources:[{uri,text}]});
  assert.equal(result.diagnostics.length===0,accepted,JSON.stringify({text,result}));
  if(accepted){assert.equal(result.model.elements.length,1);const element=result.model.elements[0];assert.equal(element.id,uri+'#0');assert.equal(element.class,'Model');assert.equal(element.values.name,text);assert.equal(element.start,0);assert.equal(element.end,new TextEncoder().encode(text).length);}
  else assert.deepEqual(result.model.elements,[]);
  return result;
}
test('fresh zero-import WASM preserves all six exact original results and every older profile boundary',async()=>{
  const invoke=await runtime();
  for(const c of fixture.original_before){assert.deepEqual(invoke(c.request),c.result,c.id);const opt=invoke({...c.request,xtext_profile:'intersect.xtext.native.v58'});assert.equal(opt.ok,['old_character_negation','range_negation','fragment_negation'].includes(c.id),c.id);if(['alternative_until','fragment_until','local_hidden'].includes(c.id))assert.deepEqual(opt,c.result);}
  for(let version=1;version<=57;version++)assert.equal(compile(invoke,get('range'),'intersect.xtext.native.v'+version).ok,false,'widened profile '+version);
});
test('exact upstream source graphs execute native model values, byte spans, two resources and source reconstruction',async()=>{
  const invoke=await runtime();
  for(const c of allCases){
    if(!supported.has(c.id))continue;
    const original=originalCases.find(o=>o.id===c.id);
    for(const source of original.sources){const retained=c.compilation.bundle.sources.find(s=>s.kind==='xtext'&&s.text===source.text);assert.ok(retained,c.id+' changed original source '+source.name);assert.equal(retained.id.sha256,digest(Buffer.from(source.text,'utf8')));}
    const built=compile(invoke,c);assert.equal(built.ok,true,JSON.stringify({id:c.id,built}));assert.equal(built.package.grammar.profile,'intersect.xtext.native.v58');assert.deepEqual(built.package.compilation,c.compilation);
    const observed=observations.find(o=>o.id===c.id);assert.equal((observed.generation?.exit_code??observed.generation_exit),0,c.id);const positives=[];
    for(const run of observed.runtime){
      if(run.timeout_seconds!==undefined){value(invoke,built.package,run.text,false);continue;} // Upstream timeout is inconclusive; this only checks native termination.
      const accepted=run.complete_single_value&&run.lexer_errors===0&&run.failure===null;
      value(invoke,built.package,run.text,accepted);if(accepted)positives.push(run.text);
    }
    if(positives.length>=2){const sources=positives.slice(0,2).map((text,index)=>({uri:`memory:${c.id}/${index}.model`,text}));const result=invoke({method:'evaluate',package:built.package,sources});assert.deepEqual(result.diagnostics,[]);assert.equal(result.model.elements.length,2);result.model.elements.forEach((e,index)=>{assert.equal(e.id,sources[index].uri+'#0');assert.equal(e.values.name,sources[index].text);});}
    assert.deepEqual(compile(invoke,c).package,built.package);
  }
});
test('unproven operand failures retain successful multichar and astral upstream outcomes as open disagreements',async()=>{
  const invoke=await runtime();
  for(const c of allCases){if(supported.has(c.id))continue;const rejected=compile(invoke,c);assert.equal(rejected.ok,false,c.id);assert.ok(rejected.diagnostics.length,c.id);if(['multichar','astral_literal'].includes(c.id)){const oracle=observations.find(o=>o.id===c.id);assert.equal(oracle.generation.exit_code,0);assert.ok(oracle.runtime.some(r=>r.complete_single_value));assert.ok(rejected.diagnostics.some(d=>d.message.includes('one UTF-16 unit')));}}
  const valid=get('fragment');const before=compile(invoke,valid);const changed=structuredClone(valid);changed.compilation.bundle.sources.find(s=>s.id.uri===changed.compilation.xtext.uri).text+=' ';
  assert.equal(compile(invoke,changed).ok,false);assert.deepEqual(compile(invoke,valid),before);value(invoke,before.package,'A',true);
});
test('inherited operands and explicit parent aliases retain distinct original source identities',async()=>{
  const invoke=await runtime();
  for(const id of ['inherited_override','inherited_program_override','explicit_parent']){const built=compile(invoke,get(id));assert.equal(built.ok,true,JSON.stringify(built));const grammar=built.package.grammar;const operand=grammar.terminals.VALUE.body.kind.Negated.operand;assert.ok(operand.kind.Call.body);if(id==='explicit_parent'){assert.equal(operand.kind.Call.name,'@audit.NegationBaseExplicit::LETTER');assert.equal(grammar.terminals['@audit.NegationBaseExplicit::LETTER'].identity,'audit.NegationBaseExplicit::LETTER');value(invoke,built.package,'a',false);value(invoke,built.package,'b',true);}else{assert.equal(operand.kind.Call.name,'LETTER');value(invoke,built.package,'a',true);value(invoke,built.package,'b',false);}const span=grammar.declaration_sources.VALUE;const source=built.package.compilation.bundle.sources.find(s=>s.id.uri===span.source.uri&&s.id.sha256===span.source.sha256);assert.ok(Buffer.from(source.text,'utf8').subarray(span.start,span.end).toString('utf8').startsWith('terminal VALUE'));}
});
test('ordinary parameter specialization and archive import retain opt-in V58 through fresh WASM instances',async()=>{
  const invoke=await runtime(),c=fixture.parameterized,built=compile(invoke,c);assert.equal(built.ok,true,JSON.stringify(built));assert.equal(built.package.grammar.profile,'intersect.xtext.native.v58');assert.ok(Object.keys(built.package.sources).some(k=>k.startsWith('generated:xtext:')));assert.deepEqual(built.package.compilation,c.compilation);assert.equal(built.package.xtext_inference,undefined);
  for(const text of c.positive)value(invoke,built.package,text,true);for(const text of c.negative)value(invoke,built.package,text,false);assert.equal(compile(invoke,c,'intersect.xtext.native.v57').ok,false);
  const exported=invoke({method:'package/export',compilation:c.compilation,xtext_profile:'intersect.xtext.native.v58',metadata:{package_id:'terminal.negation',release:'1',display_name:'Terminal negation',description:'Authored X05 consumer'}});assert.deepEqual(exported.package,built.package);
  const fresh=await runtime(),originalFiles={...exported.files,'manifest.json':JSON.stringify(exported.manifest)};
  for(const field of ['excluded','operand']){const forged=structuredClone(originalFiles),cached=JSON.parse(forged['package.json']),negated=cached.grammar.terminals.VALUE.body.kind.Negated;assert.ok(negated);if(field==='excluded')negated.excluded=[];else negated.operand.kind={Literal:[98]};assert.deepEqual(cached.compilation,built.package.compilation);const text=JSON.stringify(cached),manifest=JSON.parse(forged['manifest.json']);forged['package.json']=text;manifest.files['package.json']={bytes:Buffer.byteLength(text),sha256:digest(Buffer.from(text,'utf8'))};forged['manifest.json']=JSON.stringify(manifest);assert.throws(()=>fresh({method:'package/import',files:forged}),/Archived compiled package differs from freshly compiled definitions/);value(fresh,built.package,'A',true);}
  const loaded=fresh({method:'package/import',files:originalFiles});assert.deepEqual(loaded.package,built.package);value(fresh,loaded.package,'A',true);assert.deepEqual(compile(fresh,c).package,built.package);
});

test('selected VALUE recognition failure cannot fall back to SHORT in public WASM',async()=>{
  const invoke=await runtime(),built=compile(invoke,get('committed_path'));assert.equal(built.ok,true);
  for(const text of ['ad','ac']){const result=value(invoke,built.package,text,false);assert.ok(result.diagnostics.some(d=>d.start===0&&d.message.includes('Incomplete or invalid terminal audit.CommittedPath::VALUE')));}
  value(invoke,built.package,'adc',true);
});
