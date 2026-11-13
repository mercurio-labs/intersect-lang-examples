import test from 'node:test';
import assert from 'node:assert/strict';
import {PreparedDraftSession} from '../src/prepared-draft-session.js';
const id = name => ({uri:name,sha256:'a'.repeat(64)});
const original = {bundle:{version:1,namespaces:[],sources:['schema','expressions','grammar','behavior'].map((name,index)=>({id:id(name),kind:['ecore','xtext','xtext','rcore_behavior'][index],text:'',dependencies:[]}))},ecore:id('schema'),xtext:id('grammar'),rcore_behavior:id('behavior'),namespace:'authored transport-only mock',materialized_types:[]};
const source = {uri:'memory://draft/model.kerml',text:'package P {}'};
function response(model = {elements:[],resources:{}}, diagnostics = []) {
  return {version:1,kind:'frozen_kerml_load',sources:[source.uri],linked:false,language_validated:false,
    publication_permitted:false,model,diagnostics,work_ceiling:4000000000};
}
test('only current responses survive replacement, close and source changes', async () => {
  const pending=[];
  const session = new PreparedDraftSession(request=>new Promise((resolve,reject)=>pending.push({request,resolve,reject})));
  const first=session.open(original,source,1);
  assert.equal(session.inspect().status,'analyzing');
  const second=session.change({...source,text:'package Q {}'},2);
  assert.equal(session.inspect().preview,null);
  assert.equal(pending[0].request.source.text,'package P {}');
  assert.equal(pending[1].request.source.text,'package Q {}');
  pending[1].resolve(response());
  const current=await second;
  assert.equal(current.version,2);assert.equal(current.status,'available');
  pending[0].resolve(response());
  await assert.rejects(first,/obsolete/);
  assert.deepEqual(session.inspect(),current);
  await session.change(source,1);assert.equal(pending.length,2);
  assert.equal(session.project().model.text,'package Q {}');
  assert.equal(session.close('memory://foreign'),false);
  assert.equal(session.close(source.uri),true);assert.equal(session.inspect(),null);
});
test('rejected/failed/forged native outcomes cannot retain a prior model', async () => {
  let next=response();const session=new PreparedDraftSession(async()=>next);
  await session.open(original,source,1);
  next=response(undefined,[{phase:'parse',message:'mismatched input',resource:source.uri,start:0,end:1}]);
  assert.equal((await session.change(source,2)).status,'rejected');
  next={...response(),publication_permitted:true};
  await assert.rejects(session.change(source,3),/native KerML load response/);
  assert.equal(session.inspect().preview,null);assert.equal(session.inspect().status,'unavailable');
  next=response();await session.change(source,4);
  next={...response(),package:{}};
  await assert.rejects(session.change(source,5),/native KerML load response/);
  next={...response(),language_validated:true};
  await assert.rejects(session.change(source,6),/native KerML load response/);
  next={...response(),sources:['memory://foreign']};
  await assert.rejects(session.change(source,7),/native KerML load response/);
  next={...response(),model:{elements:'forged'}};
  await assert.rejects(session.change(source,8),/model/);
  next=response(null,[{phase:'parse',message:'Unsupported'}]);
  assert.equal((await session.change(source,9)).status,'rejected');
  next=response();next.padding='x'.repeat(3000000);
  await assert.rejects(session.change(source,10),/response byte/);
  const last=session.inspect();assert.equal(last.preview,null);assert.equal(last.publication_permitted,false);
});
