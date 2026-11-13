// Complete original source/profile calls and new explicit-profile consumers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const record=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/imported-assignment-v66/native/public-WASM-record.json',import.meta.url),'utf8'));
const artifact=process.env.INTERSECT_TEST_WASM??new URL('../public/intersect_web.wasm',import.meta.url);
test('V66 complete source/archive/model results retain all 60 old responses and source authority in fresh WASM instances',async()=>{
 const module=await WebAssembly.compile(readFileSync(artifact));assert.deepEqual(WebAssembly.Module.imports(module),[]);assert.equal(record.transcript.length,116);
 for(const [index,row]of record.transcript.entries()){
  const {exports:w}=await WebAssembly.instantiate(module,{}),input=Buffer.from(JSON.stringify(row.request),'utf8'),p=w.input_buffer(input.length);new Uint8Array(w.memory.buffer,p,input.length).set(input);const length=w.execute(),result=JSON.parse(Buffer.from(new Uint8Array(w.memory.buffer,w.output_buffer(),length)).toString('utf8'));assert.deepEqual(result,row.result,`Complete request ${index}: ${row.request.method}`);
 }
});
