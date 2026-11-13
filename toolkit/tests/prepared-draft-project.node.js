import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPreparedDraftProject, encodePreparedDraftProject, decodePreparedDraftProject,
  validatePreparedDraftProject, preparedDraftRequest} from '../src/prepared-draft-project.js';
import {validateBundleProject} from '../src/bundle-project.js';
const fixture = new URL('../.runtime/intersect-text/fixtures/kerml-draft-pinned/', import.meta.url);
function original() {
  const manifest = JSON.parse(readFileSync(new URL('sources.json', fixture), 'utf8'));
  const sources = manifest.sources.map(source => {
    const text = readFileSync(new URL(source.file, fixture), 'utf8');
    assert.equal(createHash('sha256').update(text).digest('hex'), source.sha256);
    return {id:{uri:source.original_uri,sha256:source.sha256}, kind:source.file.endsWith('.ecore')?'ecore':'xtext',text,dependencies:[]};
  });
  sources[1].dependencies = [sources[0].id]; sources[2].dependencies = [sources[0].id,sources[1].id];
  const text = 'rcore 1; package emptyRules version "1";';
  sources.push({id:{uri:'probe-behavior.rcore',sha256:createHash('sha256').update(text).digest('hex')},kind:'rcore_behavior',text,dependencies:[sources[0].id]});
  return {bundle:{version:1,sources,namespaces:[]},ecore:sources[0].id,xtext:sources[2].id,
    rcore_behavior:sources[3].id,namespace:'https://www.omg.org/spec/SysML/20250201',materialized_types:[]};
}
const model = {uri:'memory://intersect/native-minimal-package/package.kerml',text:'package P {}'};
test('v7 preserves complete original bytes and reconstructs only a source recipe', () => {
  const inputs = original();
  assert.equal(Buffer.byteLength(inputs.bundle.sources[0].text),629610);
  const project = createPreparedDraftProject(inputs,model);
  const encoded = encodePreparedDraftProject(project);
  assert.ok(Buffer.byteLength(encoded)<2000000);
  const loaded = decodePreparedDraftProject(encoded);
  assert.deepEqual(loaded,project);
  assert.deepEqual(loaded.original,inputs);
  const request = preparedDraftRequest(loaded.original,loaded.model);
  assert.equal(request.method,'draft/kerml/analyze');
  assert.deepEqual(request.original,inputs);
  assert.equal(request.package,undefined);
  assert.equal(request.name_object,undefined);
  inputs.bundle.sources[0].text='mutated after snapshot';
  assert.equal(Buffer.byteLength(project.original.bundle.sources[0].text),629610);
  // Ordinary envelopes keep their old 256k/source-kind policy.
  assert.throws(()=>validateBundleProject(project.original),/definition source/);
});
test('v7 rejects serialized authority, wrong modes and invalid envelopes', () => {
  const project = createPreparedDraftProject(original(),model);
  for (const key of ['graph','package','evaluation','publication_permitted','compilerProfile']) {
    assert.throws(()=>validatePreparedDraftProject({...project,[key]:true}),/Invalid prepared draft project/);
  }
  assert.throws(()=>validatePreparedDraftProject({...project,mode:'language'}),/format/);
  assert.throws(()=>validatePreparedDraftProject({...project,format:'intersect.toolkit.project.v6'}),/format/);
  assert.throws(()=>validatePreparedDraftProject({...project,model:{...model,text:'é'.repeat(128001)}}),/model source byte/);
  assert.throws(()=>validatePreparedDraftProject({...project,presentation:{activeSource:'memory://unknown'}}),/presentation source/);
  const big = structuredClone(project);big.original.bundle.sources[0].text='x'.repeat(1000001);
  assert.throws(()=>validatePreparedDraftProject(big),/original source byte/);
  assert.throws(()=>decodePreparedDraftProject(' '.repeat(2000001)),/2 MB/);
  assert.throws(()=>preparedDraftRequest(project.original,model,{work:10000001}),/work grant/);
  assert.throws(()=>preparedDraftRequest(project.original,model,{work:-1}),/work grant/);
});


test('v7 accepts explicit finite1m and preserves explicit100k regression requests', () => {
  const inputs = original();
  for (const work of [0, 100_000, 1_000_000, 10_000_000]) {
    assert.equal(preparedDraftRequest(inputs, model, {work}).work, work);
  }
  assert.throws(() => preparedDraftRequest(inputs, model, {work:10_000_001}), /work grant/);
});
