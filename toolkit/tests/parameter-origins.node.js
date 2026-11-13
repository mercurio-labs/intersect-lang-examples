// Authored range controls over fresh actual WASM; Rust owns correspondence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>JSON.parse(readFileSync(new URL(`../.runtime/intersect-text/fixtures/xtext/parameter-origins/${name}`,import.meta.url),'utf8'));
const plan=read('cases.json'),before=read('before.json'),expected=read('expectations.json').scopes;
const module=await WebAssembly.compile(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
test('fresh WASM preserves legacy parameter failures and exposes precise authored AST scopes',async()=>{
 for(const c of plan.cases){
  const {exports:e}=await WebAssembly.instantiate(module,{}),previous=before.find(row=>row.id===c.id);
  function call(request){const b=new TextEncoder().encode(JSON.stringify(request)),p=e.input_buffer(b.length);assert.ok(p);new Uint8Array(e.memory.buffer,p,b.length).set(b);const n=e.execute();const value=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),n)));assert.equal(value.error,undefined);return value;}
  const result=call({method:'compile_inferred_with_origins',inference:previous.inference,diagnostic_origins:[{kind:'forged'}]});
  assert.equal(result.ok,false);assert.deepEqual(result.diagnostics,previous.result.diagnostics);
  const source=c.sources.find(s=>s.id===c.expected_source),span={source:{uri:source.uri,sha256:source.sha256},start:expected[c.id].start,end:expected[c.id].end};
  assert.deepEqual(result.diagnostic_origins[0],{kind:'generated',generated:previous.result.diagnostic_origins[0].generated,originals:[span]},c.id);
  assert.deepEqual(call({method:'compile_inferred',inference:previous.inference}),{ok:false,diagnostics:previous.result.diagnostics});
 }
});
