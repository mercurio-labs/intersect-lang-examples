import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceIdentity,sourceKey,withSourceEdits} from '../src/source-drafts.js';
import {inferenceStarter} from '../src/inference-project.js';
import {inferenceGraphState,mutateInferenceGraph,inferenceSourceTexts,retainInferenceDrafts,createInferenceGraphHistory} from '../src/inference-graph.js';
async function state(){const id=await sourceIdentity('memory:entry.xtext',inferenceStarter);return inferenceGraphState({inputs:{version:1,bundle:{version:1,sources:[{id,kind:'xtext',text:inferenceStarter,dependencies:[]}],namespaces:[]},grammar:id},drafts:[]},inferenceStarter);}
const add=(s,uri,text,kind='xtext')=>mutateInferenceGraph(s,{type:'add',uri,kind,text});

test('adding original sources preserves exact encoding, identities and caller ownership',async()=>{
 const before=await state(),text='\ufeff// café\r\nrcore 1;\r\n',after=await add(before,'memory:canonical.rcore',text,'rcore');const source=after.record.inputs.bundle.sources[1];assert.equal(before.record.inputs.bundle.sources.length,1);assert.equal(source.text,text);assert.deepEqual(source.id,await sourceIdentity('memory:canonical.rcore',text));assert.equal(source.kind,'rcore');assert.equal(after.entryText,inferenceStarter);
 for(const change of [{uri:'',kind:'xtext',text:''},{uri:'memory:bad\n',kind:'xtext',text:''},{uri:'memory:a',kind:'fake',text:''},{uri:'memory:a',kind:'xtext',text:'mixed\r\nends\n'}])await assert.rejects(()=>mutateInferenceGraph(before,{type:'add',...change}));
 await assert.rejects(()=>add(before,'memory:entry.xtext',inferenceStarter),/already retained/);
});

test('multiple revisions of one opaque URI retain separate exact relationship identities',async()=>{
 const first=await state(),after=await add(first,first.record.inputs.grammar.uri,'another revision'),old=first.record.inputs.grammar,fresh=after.selectedSource;assert.notDeepEqual(old,fresh);assert.equal(old.uri,fresh.uri);
 const linked=await mutateInferenceGraph(after,{type:'dependencies',source:fresh,dependencies:[old]});assert.deepEqual(linked.record.inputs.bundle.sources[1].dependencies,[old]);assert.deepEqual(linked.record.inputs.bundle.sources[0].id,old);
});

test('switching entry preserves both invalid drafts without rehashing source authority',async()=>{
 let s=await state();const old=s.record.inputs.grammar;s.entryText='invalid entry draft';s=await add(s,'memory:second.xtext','second original');const second=s.selectedSource;s.record.drafts=[{source:second,text:'second invalid draft'}];
 const next=await mutateInferenceGraph(s,{type:'entry',source:second});assert.equal(next.entryText,'second invalid draft');assert.deepEqual(next.record.drafts,[{source:old,text:'invalid entry draft'}]);assert.deepEqual(next.record.inputs.bundle.sources[0].id,old);
 const back=await mutateInferenceGraph(next,{type:'entry',source:old});assert.equal(back.entryText,'invalid entry draft');assert.deepEqual(back.record.drafts,[{source:second,text:'second invalid draft'}]);
 const rcore=await add(s,'memory:other.rcore','unfinished','rcore');await assert.rejects(()=>mutateInferenceGraph(rcore,{type:'entry',source:rcore.selectedSource}),/Xtext/);
});

test('removal requires explicit entry, incoming dependency and namespace decisions',async()=>{
 let s=await state();const entry=s.record.inputs.grammar;await assert.rejects(()=>mutateInferenceGraph(s,{type:'remove',source:entry}),/another entry/);
 s=await add(s,'memory:parent.rcore','parent','rcore');const parent=s.selectedSource;s=await mutateInferenceGraph(s,{type:'dependencies',source:entry,dependencies:[parent]});s=await mutateInferenceGraph(s,{type:'namespaceAdd',namespace:'urn:parent',source:parent});
 await assert.rejects(()=>mutateInferenceGraph(s,{type:'remove',source:parent}),/explicitly/);s=await mutateInferenceGraph(s,{type:'dependencies',source:entry,dependencies:[]});await assert.rejects(()=>mutateInferenceGraph(s,{type:'remove',source:parent}),/explicitly/);
 s=await mutateInferenceGraph(s,{type:'namespaceRemove',index:0});s=await mutateInferenceGraph(s,{type:'remove',source:parent});assert.equal(s.record.inputs.bundle.sources.length,1);assert.deepEqual(s.selectedSource,entry);
});

test('unrelated metadata and invalid identities are preserved for native rejection',async()=>{
 let s=await state();const source=s.record.inputs.bundle.sources[0];source.id.sha256='0'.repeat(64);s.record.inputs.grammar=structuredClone(source.id);s.selectedSource=source.id;const missing={uri:'memory:missing',sha256:'1'.repeat(64)};source.dependencies=[missing];s.record.inputs.bundle.namespaces=[{namespace:'urn:old',source:missing,unsupported:'retained'}];
 s=await add(s,'memory:extra','extra');assert.deepEqual(s.record.inputs.bundle.sources[0].dependencies,[missing]);assert.equal(s.record.inputs.bundle.sources[0].id.sha256,'0'.repeat(64));assert.equal(s.record.inputs.bundle.namespaces[0].unsupported,'retained');
 s=await mutateInferenceGraph(s,{type:'namespaceEdit',index:0,namespace:'urn:changed',source:s.selectedSource});assert.equal(s.record.inputs.bundle.namespaces[0].unsupported,'retained');assert.deepEqual(await withSourceEdits(s.record.inputs,new Map()),s.record.inputs);
});

test('duplicate namespace bindings remain explicit graph drafts until Rust validates them',async()=>{
 let s=await state();const source=s.record.inputs.grammar;for(let i=0;i<2;i++)s=await mutateInferenceGraph(s,{type:'namespaceAdd',namespace:'urn:duplicate',source});assert.equal(s.record.inputs.bundle.namespaces.length,2);
 await assert.rejects(()=>mutateInferenceGraph(s,{type:'namespaceRemove',index:2}),/no longer/);await assert.rejects(()=>mutateInferenceGraph(s,{type:'dependencies',source:{uri:'wrong',sha256:'2'.repeat(64)},dependencies:[]}),/no longer/);
});

test('graph undo and redo preserve newer text on surviving exact identities',async()=>{
 const initial=await state(),history=createInferenceGraphHistory();history.record(initial);let s=await add(initial,'memory:new.xtext','original new');const created=s.selectedSource;s.entryText='newer entry text';s.record.drafts=[{source:created,text:'newer added-file text'}];
 const undone=history.move('undo',s);assert.equal(undone.entryText,'newer entry text');assert.equal(undone.record.inputs.bundle.sources.length,1);const redone=history.move('redo',undone);assert.equal(redone.entryText,'newer entry text');assert.equal(inferenceSourceTexts(redone).get(sourceKey(created)),'newer added-file text');assert.equal(history.canRedo,false);
});

test('undoing entry and metadata changes retains current edits independently of selected editor',async()=>{
 let s=await state();s=await add(s,'memory:parent.xtext','parent');const parent=s.selectedSource,history=createInferenceGraphHistory();history.record(s);s=await mutateInferenceGraph(s,{type:'entry',source:parent});s.entryText='current parent';s.record.drafts=[{source:s.record.inputs.bundle.sources[0].id,text:'current original entry'}];const back=history.move('undo',s);assert.equal(back.entryText,'current original entry');assert.equal(inferenceSourceTexts(back).get(sourceKey(parent)),'current parent');
 const merged=retainInferenceDrafts(s,back);assert.equal(merged.entryText,'current parent');
});

test('removed byte-exact sources are restored and host history remains bounded and disposable',async()=>{
 let s=await state();s=await add(s,'memory:deleted','\ufeff// café\r\n');const removed=s.selectedSource,history=createInferenceGraphHistory(2);history.record(s);s=await mutateInferenceGraph(s,{type:'remove',source:removed});s=history.move('undo',s);assert.equal(inferenceSourceTexts(s).get(sourceKey(removed)),'\ufeff// café\r\n');
 for(let i=0;i<3;i++){history.record(s);s=await mutateInferenceGraph(s,{type:'namespaceAdd',namespace:`urn:${i}`,source:s.record.inputs.grammar});}s=history.move('undo',s);s=history.move('undo',s);assert.equal(s.record.inputs.bundle.namespaces.length,1);assert.equal(history.canUndo,false);history.clear();assert.equal(history.canRedo,false);assert.equal(Object.hasOwn(s.record,'history'),false);
});


test('source and graph size limits reject new edits without truncating retained data',async()=>{
 let s=await state();await assert.rejects(()=>add(s,'memory:large','a'.repeat(256001)),/256 KB/);const text='a'.repeat(255000);for(let i=0;i<7;i++)s=await add(s,`memory:size-${i}`,text);const before=structuredClone(s);await assert.rejects(()=>add(s,'memory:too-much',text),/2 MB/);assert.deepEqual(s,before);
});


test('source rehash preserves unsupported identity information independently on owner and references',async()=>{
 const s=await state(),id=s.record.inputs.grammar;s.record.inputs.grammar=structuredClone(id);s.record.inputs.bundle.sources[0].id.owner_metadata='retained owner';s.record.inputs.grammar.reference_metadata='retained reference';
 const edited=await withSourceEdits(s.record.inputs,new Map([[sourceKey(id),inferenceStarter+'// explicit edit\n']]));assert.equal(edited.bundle.sources[0].id.owner_metadata,'retained owner');assert.equal(edited.grammar.reference_metadata,'retained reference');assert.equal(edited.grammar.owner_metadata,undefined);assert.deepEqual({uri:edited.grammar.uri,sha256:edited.grammar.sha256},await sourceIdentity(id.uri,inferenceStarter+'// explicit edit\n'));
});
