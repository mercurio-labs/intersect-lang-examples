// Authored transport controls; mocked responses are not native semantic evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparedDraftProject, encodePreparedDraftProject, decodePreparedDraftProject,
  createPreparedPhysicalProject, encodePreparedDraftSourceProject, decodePreparedDraftSourceProject,
  preparedPhysicalProjectRequest, validatePreparedPhysicalProject, validatePreparedPhysicalSources} from '../src/prepared-draft-project.js';
import {PreparedPhysicalProjectSession} from '../src/prepared-draft-session.js';
import {LanguageClient} from '../src/client.js';
const id = uri => ({uri, sha256:'a'.repeat(64)});
const original = {bundle:{version:1,namespaces:[],sources:['schema','expressions','grammar','behavior'].map((uri,index)=>({
  id:id(uri),kind:['ecore','xtext','xtext','rcore_behavior'][index],text:'',dependencies:[]}))},
ecore:id('schema'),xtext:id('grammar'),rcore_behavior:id('behavior'),namespace:'authored transport mock only',materialized_types:[]};
const sources = [{uri:'memory://draft/raw one',text:'package A {}\r\n// 😀'}, {uri:'memory://draft/raw%20one',text:'package B {}'}];
function response(uris=sources.map(source=>source.uri), diagnostics=[], model={elements:[],resources:{}}) {
  return {version:1,kind:'frozen_kerml_load',method:'draft/kerml/project/analyze',mode:'frozen-kerml-load.v1',
    sources:uris,linked:false,language_validated:false,publication_permitted:false,model,diagnostics,work_ceiling:4000000000};
}
test('v8 source-only roundtrip keeps raw URI Unicode CRLF bytes and leaves v7 exact',()=>{
  const project=createPreparedPhysicalProject(original,sources);
  const saved=encodePreparedDraftSourceProject(project), loaded=decodePreparedDraftSourceProject(saved);
  assert.deepEqual(loaded,project);assert.deepEqual(loaded.sources,sources);
  assert.equal(Buffer.from(loaded.sources[0].text).toString('hex'),Buffer.from(sources[0].text).toString('hex'));
  const request=preparedPhysicalProjectRequest(loaded.original,loaded.sources);
  assert.equal(request.method,'draft/kerml/project/analyze');assert.equal(request.version,1);
  assert.equal(request.mode,'frozen-kerml-load.v1');assert.deepEqual(request.sources,sources);
  assert.deepEqual(Object.keys(project).sort(),['format','mode','original','presentation','sources']);
  const single=createPreparedDraftProject(original,sources[0]);
  assert.equal(encodePreparedDraftSourceProject(single),encodePreparedDraftProject(single));
  assert.deepEqual(decodePreparedDraftSourceProject(encodePreparedDraftProject(single)),decodePreparedDraftProject(encodePreparedDraftProject(single)));
  const fresh=createPreparedPhysicalProject(original,sources);fresh.sources[0].text='changed';
  assert.equal(project.sources[0].text,sources[0].text);
});
test('v8 rejects duplicate raw identities authority and total UTF8 overrun without normalization',()=>{
  const good=createPreparedPhysicalProject(original,sources);
  for(const key of ['package','graph','capability','providers','schema','limits','validated'])assert.throws(()=>validatePreparedPhysicalProject({...good,[key]:{}}),/Invalid physical draft project/);
  assert.throws(()=>validatePreparedPhysicalSources([sources[0],sources[0]]),/Duplicate/);
  assert.throws(()=>validatePreparedPhysicalSources([]),/1 to 8/);
  assert.throws(()=>validatePreparedPhysicalSources(Array.from({length:9},(_,i)=>({uri:`memory:${i}`,text:''}))),/1 to 8/);
  const exact={uri:'memory:astral',text:'😀'.repeat(64000)};
  assert.equal(Buffer.byteLength(exact.text),256000);validatePreparedPhysicalSources([exact]);
  assert.throws(()=>validatePreparedPhysicalSources([exact,{uri:'memory:second',text:'x'}]),/total UTF-8/);
  assert.throws(()=>validatePreparedPhysicalSources([{uri:'memory:bad',text:'\ud800'}]),/surrogate/);
  assert.throws(()=>validatePreparedPhysicalSources([{uri:'memory:\udfff',text:''}]),/surrogate/);
  assert.throws(()=>preparedPhysicalProjectRequest(original,sources,{work:10000001}),/work grant/);
  assert.throws(()=>preparedPhysicalProjectRequest(original,sources,{work:-1}),/work grant/);
  assert.throws(()=>validatePreparedPhysicalProject({...good,mode:'all-kerml'}),/format/);
});
test('multi-resource session fences stale responses per-source versions close and restart',async()=>{
  const pending=[];const session=new PreparedPhysicalProjectSession(request=>new Promise((resolve,reject)=>pending.push({request,resolve,reject})));
  const first=session.open(original,sources,1);assert.equal(session.inspect().status,'analyzing');
  const changed=session.change({...sources[1],text:'package Changed {}'},2);
  assert.deepEqual(pending[0].request.sources,sources);assert.equal(pending[1].request.sources[1].text,'package Changed {}');
  pending[1].resolve(response());const current=await changed;assert.equal(current.status,'available');
  pending[0].resolve(response());await assert.rejects(first,/obsolete/);assert.deepEqual(session.inspect(),current);
  await session.change(sources[1],1);assert.equal(pending.length,2);
  assert.equal(session.project().sources[1].text,'package Changed {}');
  assert.equal(session.close('memory:foreign'),false);assert.equal(session.close(sources[0].uri),true);assert.equal(session.inspect(),null);
  const restarted=session.open(original,sources,7);assert.equal(session.inspect().preview,null);
  pending[2].resolve(response());assert.equal((await restarted).version,7);
});
test('native load results stay whole and rejected or forged results cannot keep a model',async()=>{
  let next=response();const session=new PreparedPhysicalProjectSession(async()=>next);
  await session.open(original,sources,1);assert.deepEqual(session.inspect().preview,next);
  next=response(undefined,[{phase:'parse',message:'mismatched input',resource:sources[0].uri,start:0,end:7}]);
  const rejected=await session.change(sources[0],2);assert.equal(rejected.status,'rejected');assert.deepEqual(rejected.preview,next);
  next=response(undefined,[],null);
  assert.equal((await session.change(sources[0],3)).status,'rejected');
  for(const bad of [{...response(),package:{}},response([sources[0].uri]),{...response(),language_validated:true},{...response(),linked:true}]){
    next=bad;await assert.rejects(session.change(sources[0],session.versions.get(sources[0].uri)+1),/native KerML load/);
    assert.equal(session.inspect().preview,null);assert.equal(session.inspect().status,'unavailable');
  }
  next=response();await session.change(sources[1],2);assert.equal(session.inspect().status,'available');
  next={...response(),padding:'x'.repeat(3000000)};await assert.rejects(session.change(sources[1],3),/byte budget/);
  assert.equal(session.inspect().preview,null);
});
test('project worker abort uses existing draft disposal watchdog and clears pending transport',async()=>{
  const old={Worker:globalThis.Worker,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const timers=new Map();let next=0;
  globalThis.Worker=class{constructor(){this.messages=[];this.terminated=false;}postMessage(value){this.messages.push(value);}terminate(){this.terminated=true;}};
  globalThis.setTimeout=(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
  try{
    const client=new LanguageClient(()=>{},()=>{}),abort=new AbortController();
    const pending=client.request('intersect/prepareKerMLPhysicalProject',{}, {signal:abort.signal});
    assert.equal([...timers.values()][0].ms,120000);assert.equal(client.worker.messages.length,1);
    abort.abort();await assert.rejects(pending,/Draft analysis stopped/);
    assert.equal(client.worker.terminated,true);assert.equal(client.pending.size,0);assert.equal(timers.size,0);
    const fresh=new LanguageClient(()=>{},()=>{});const again=fresh.request('intersect/prepareKerMLPhysicalProject');
    fresh.worker.onmessage({data:{id:1,result:{transport_only:true}}});assert.deepEqual(await again,{transport_only:true});fresh.dispose();
  }finally{Object.assign(globalThis,old);}
});


test('v8 accepts explicit finite1m and preserves explicit100k regression requests', () => {
  for (const work of [0, 100_000, 1_000_000, 10_000_000]) {
    assert.equal(preparedPhysicalProjectRequest(original, sources, {work}).work, work);
  }
  assert.throws(() => preparedPhysicalProjectRequest(original, sources, {work:10_000_001}), /work grant/);
});
