import test from 'node:test';
import assert from 'node:assert/strict';
import {projectInferenceDiagnostics,inferenceDiagnosticRows} from '../src/inference-diagnostics.js';
const a={uri:'memory:shared.xtext',sha256:'a'.repeat(64)},b={...a,sha256:'b'.repeat(64)};
const inputs={bundle:{sources:[{id:a},{id:b}]},grammar:a};
const diagnostic={source:a.uri,start:2,end:3,message:'failed'};
const project=origin=>projectInferenceDiagnostics({diagnostics:[diagnostic],...(origin?{diagnostic_origins:[origin]}:{})},inputs)[0];
test('producer identity routes a selected revision and its owned range independently of legacy URI',()=>{
  const d=project({kind:'source',source:b,span:{source:b,start:8,end:12}});
  assert.deepEqual(d.sourceId,b);assert.equal(d.start,8);assert.equal(d.end,12);assert.equal(d.ambiguousSource,undefined);
});
test('legacy URI-only ambiguity stays explicit and cannot create a marker location',()=>{
  const d=project();assert.equal(d.ambiguousSource,true);assert.deepEqual(d.locations,[]);assert.equal(d.sourceId,undefined);
  const single=projectInferenceDiagnostics({diagnostics:[diagnostic]},{bundle:{sources:[{id:a}]}})[0];
  assert.equal(single.scope,'legacy');assert.equal(single.sourceId,undefined);assert.deepEqual(single.legacySourceId,a);
});
test('request contexts and unavailable metadata never imply an authored culprit',()=>{
  for(const origin of [{kind:'context',source:a},{kind:'unavailable',reason:'unknown'},{kind:'other'}]){
    const d=project(origin);assert.deepEqual(d.locations,[]);assert.equal(d.sourceId,undefined);
  }
});
test('generated errors expose every correspondence without choosing a source or range',()=>{
  const missing={uri:'memory:removed.xtext',sha256:'c'.repeat(64)};
  const originals=[{source:a,start:0,end:1},{source:b,start:2,end:5},{source:a,start:8,end:10},{source:missing,start:0,end:1}];
  const d=project({kind:'generated',generated:{source:missing,start:3,end:4},originals});
  assert.deepEqual(d.locations,originals);assert.equal(d.sourceId,undefined);
  const rows=inferenceDiagnosticRows([d]);assert.equal(rows.length,5);assert.equal(rows[0].scope,'generated');
  assert.deepEqual(rows.slice(1).map(d=>d.sourceId),[a,b,a,missing]);
  assert.deepEqual(rows.slice(1).map(d=>d.start),[0,2,8,0]);
});
test('an unavailable exact revision and an inconsistent producer span never fall back to URI guessing',()=>{
  for(const origin of [{kind:'source',source:{...a,sha256:'d'.repeat(64)}},{kind:'source',source:a,span:{source:b,start:0,end:1}}]){
    const d=project(origin);assert.equal(d.scope,'unavailable');assert.deepEqual(d.locations,[]);
  }
});
