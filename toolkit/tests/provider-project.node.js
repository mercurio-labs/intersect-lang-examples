import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInferenceProviderState,validateInferenceContext,validateInferenceRecovery,validateProviderDraft} from '../src/inference-provider-state.js';
import {createProjectControls,validateProject} from '../src/project.js';
import {createInferenceProject} from '../src/inference-project.js';
import {sourceIdentity,sourceKey,withSourceEdits} from '../src/source-drafts.js';
const plan=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inferred-computed-host-contexts/plan.json',import.meta.url),'utf8'));
const contexts=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inferred-computed-host-contexts/contexts.json',import.meta.url),'utf8'));
function recovery(index=0){const c=plan.cases[index];return {inference:structuredClone(c.inference),inference_context:structuredClone(contexts.find(v=>v.id===c.id).inference_context),entryRule:c.entry};}
function value(index=0){
 const active=recovery(index),entry=active.inference.bundle.sources.find(s=>sourceKey(s.id)===sourceKey(active.inference.grammar));
 return {format:'intersect.toolkit.project.v5',mode:'inferred',profile:'default',compilerProfile:'intersect.xtext.native.v56',structureSource:'rcore',entryRule:'MissingDraftEntry',definitionInference:{inputs:structuredClone(active.inference),drafts:[]},definitionProviderDraft:{version:1,selection:'{ invalid provider draft · café 雪'},definitionInferenceRecovery:active,definitions:{ecore:'',rcore:'',xtext:entry.text+'// invalid current draft ???\n',rcore_behavior:''},models:{catalog:plan.cases[index].model_text,loans:plan.cases[index].model_text},python:'',layout:{version:1,positions:{},zoom:1}};
}
const ordinary=()=>({format:'intersect.toolkit.project.v2',mode:'language',profile:'default',compilerProfile:'intersect.xtext.native.v57',structureSource:'rcore',definitions:{ecore:'projection',rcore:'rcore 1;',xtext:'grammar example.Model',rcore_behavior:''},models:{catalog:'alpha',loans:'alpha'},python:'',layout:{version:1,positions:{},zoom:1}});

test('v5 separates exact invalid source/provider drafts, successful original recipes and requested/active entries',()=>{
 for(let index=0;index<plan.cases.length;index++){
  const p=value(index),original=structuredClone(p.definitionInferenceRecovery);assert.equal(validateProject(p),p);
  assert.equal(p.entryRule,'MissingDraftEntry');assert.equal(p.definitionInferenceRecovery.entryRule,'Item');
  const state=createInferenceProviderState();state.restoreProviders(p.definitionProviderDraft);state.captureSuccessfulRecovery({ok:true,...original});
  state.setProviderDraft('\ufeff// café 雪 ·\r\n{ invalid newer selection');
  assert.equal(state.providerDraft(),'\ufeff// café 雪 ·\r\n{ invalid newer selection');assert.deepEqual(state.recovery(),original);
  p.definitionInferenceRecovery.inference.bundle.sources[0].text='caller mutated';assert.deepEqual(state.recovery(),original);
  const output=state.recovery();output.inference_context.computed_settings.length=0;assert.deepEqual(state.recovery(),original);
 }
});

test('failed/uncompiled/cached authority cannot replace last successful recovery',()=>{
 const state=createInferenceProviderState(),active=recovery();state.captureSuccessfulRecovery({ok:true,...active});
 for(const candidate of [{ok:false,...active},{...active},{ok:true,...active,package:{}},{ok:true,inference:active.inference,inference_context:active.inference_context}]){
  assert.throws(()=>state.captureSuccessfulRecovery(candidate));assert.deepEqual(state.recovery(),active);
 }
 state.setProviderDraft('unfinished JSON');assert.deepEqual(state.recovery(),active);state.clear();assert.equal(state.recovery(),null);assert.equal(state.providerSnapshot(),null);
});

test('v5 rejects conflicting modes, formats, versions, unknown authority and missing selections',()=>{
 const p=value();
 for(const mutate of [v=>v.mode='language',v=>v.mode='structure',v=>v.definitionBundle={},v=>v.definitionRecovery={},v=>delete v.definitionInference,v=>delete v.definitionProviderDraft,v=>v.definitionProviderDraft.version=2,v=>v.definitionProviderDraft.checked_context={},v=>v.definitionInferenceRecovery.package={},v=>v.cachedPackage={},v=>delete v.entryRule,v=>v.entryRule=42,v=>v.definitionInferenceRecovery.entryRule='',v=>v.definitionInferenceRecovery.inference.version=2,v=>v.definitionInferenceRecovery.inference.behavior=v.definitionInferenceRecovery.inference_context.behavior]){
  const bad=structuredClone(p);mutate(bad);assert.throws(()=>validateProject(bad));
 }
 for(const format of ['intersect.toolkit.project.v2','intersect.toolkit.project.v3','intersect.toolkit.project.v4'])assert.throws(()=>validateProject({...p,format}),/v5/);
 const draftOnly=structuredClone(p);delete draftOnly.definitionInferenceRecovery;assert.equal(validateProject(draftOnly),draftOnly);
 assert.throws(()=>validateProviderDraft({version:1,selection:'x'.repeat(256001)}));
});

test('context-v1 catalog fields and context-v2 explicit fields retain exact boundaries',()=>{
 assert.deepEqual(validateInferenceContext({version:1,conversions:[],applied_conversions:[],constructors:[]}),{version:1,conversions:[],applied_conversions:[],constructors:[]});
 assert.equal(validateInferenceContext({version:2,behavior:null,computed_settings:[]}).behavior,null);
 for(const context of [{version:3},{version:1,behavior:null},{version:1,computed_settings:[]},{version:2,behavior:null},{version:2,computed_settings:[]},{version:1,conversions:null},{version:1,conversions:[1]},{version:2,behavior:42,computed_settings:[]},{version:2,behavior:null,computed_settings:[null]},{version:1,unknown:true}])assert.throws(()=>validateInferenceContext(context));
 // Installed provider versions and generated source/member contracts remain native
 // obligations. JS transports them verbatim instead of owning an implementation list.
 const untrusted=recovery();untrusted.inference_context.computed_settings[0].provider.version='uninstalled';assert.equal(validateInferenceRecovery(untrusted),untrusted);
});

test('recovery rejects ambiguous or missing exact graph identities without repairing source bytes',async()=>{
 const active=recovery();
 for(const mutate of [v=>v.inference.bundle.sources.push(structuredClone(v.inference.bundle.sources[0])),v=>v.inference.grammar.sha256='0'.repeat(64),v=>v.inference.bundle.sources[0].id.extra=true,v=>v.inference.bundle.sources[1].dependencies.push({uri:'missing',sha256:'1'.repeat(64)}),v=>v.inference.bundle.namespaces.push(structuredClone(v.inference.bundle.namespaces[0])),v=>v.inference_context.behavior.sha256='0'.repeat(64)]){
  const bad=structuredClone(active);mutate(bad);assert.throws(()=>validateInferenceRecovery(bad));
 }
 const draft=structuredClone(active);draft.inference.bundle.sources[0].text+='// changed without source digest repair\n';assert.equal(validateInferenceRecovery(draft),draft);assert.deepEqual(await withSourceEdits(draft.inference,new Map()),draft.inference);
 const first=active.inference.bundle.sources[0],edited=await withSourceEdits(active.inference,new Map([[sourceKey(first.id),first.text+'// actual current edit\n']]));assert.notDeepEqual(edited.bundle.sources[0].id,first.id);assert.deepEqual(active,recovery());
});

class Model{
 constructor(text=''){this.text=text;this.version=1;this.listeners=[];}getValue(){return this.text;}getVersionId(){return this.version;}setValue(text){this.text=text;this.version++;for(const listener of this.listeners)listener();}setEOL(){}getEOL(){return '\n';}pushStackElement(){}pushEOL(){}getFullModelRange(){return {};}pushEditOperations(_,edits){this.setValue(edits[0].text);}onDidChangeContent(listener){this.listeners.push(listener);}dispose(){}
}
function controls(options={}){
 const elements=new Map(),events=[];let state={...ordinary(),inference:null,provider:null,inferenceRecovery:null,recovery:null,bundle:null,entry:null};
 const host={set innerHTML(value){this.markup=value;},querySelector(selector){if(!elements.has(selector))elements.set(selector,{textContent:'',value:'',files:[],classList:{toggle(){}}});return elements.get(selector);}};
 const definitions=Object.fromEntries(Object.entries(state.definitions).map(([key,text])=>[key,new Model(text)])),models=Object.fromEntries(Object.entries(state.models).map(([key,text])=>[key,new Model(text)]));
 const project=createProjectControls({host,definitionModels:definitions,modelModels:models,python:{model:new Model(''),cancel(){}},structure:{getLayout:()=>state.layout,setLayout:layout=>state.layout=layout},request:async()=>({ok:true,lowering:{generated:{text:'projection'}}}),changed(){events.push('changed');state.inference=null;state.provider=null;state.inferenceRecovery=null;},getMode:()=>state.mode,setMode:mode=>state.mode=mode,getProfile:()=>state.profile,setProfile:profile=>state.profile=profile,getCompilerProfile:()=>state.compilerProfile,setCompilerProfile:profile=>state.compilerProfile=profile,getEntryRule:()=>state.entry,setEntryRule:entry=>state.entry=entry,getInference:()=>state.inference,setInference:record=>{events.push('inference');state.inference=record;},getProviderDraft:()=>state.provider,setProviderDraft:record=>{events.push('provider');state.provider=record;},getInferenceRecovery:()=>state.inferenceRecovery,setInferenceRecovery:record=>{events.push('inferenceRecovery');state.inferenceRecovery=record;},getRecovery:()=>state.recovery,setRecovery:record=>state.recovery=record,getBundle:()=>state.bundle,setBundle:bundle=>state.bundle=bundle,beforeReplace(value,detail){events.push(`before:${detail.reason}`);options.beforeReplace?.(value,detail,state,definitions);},loaded(value,detail){events.push(`loaded:${detail.reason}`);return options.loaded?.(value,detail,state,definitions);},created:async kind=>{events.push(`created:${kind}`);if(kind==='inferred')state.compilerProfile='intersect.xtext.native.v56';}});
 return {project,elements,definitions,models,events,get state(){return state;}};
}

test('load validates before fencing or editor mutation, then restores own sources/drafts/recovery before loaded',async()=>{
 const p=value(),s=controls({beforeReplace(_value,{reason},state,definitions){assert.equal(reason,'load');assert.equal(definitions.rcore.getValue(),ordinary().definitions.rcore);assert.equal(state.provider,null);},async loaded(_value,{reason},state,definitions){assert.equal(reason,'load');assert.deepEqual(state.provider,p.definitionProviderDraft);assert.deepEqual(state.inferenceRecovery,p.definitionInferenceRecovery);assert.equal(definitions.xtext.getValue(),p.definitions.xtext);}});
 const bad=structuredClone(p);bad.definitionProviderDraft.version=3;assert.throws(()=>s.project.load(bad));assert.deepEqual(s.events,[]);
 await s.project.load(p);assert.deepEqual(s.events,['before:load','changed','inference','provider','inferenceRecovery','loaded:load']);
 assert.equal(s.project.snapshot().format,'intersect.toolkit.project.v5');assert.deepEqual(s.project.snapshot().definitionInferenceRecovery,p.definitionInferenceRecovery);assert.equal(s.project.snapshot().entryRule,'MissingDraftEntry');
 p.definitionProviderDraft.selection='caller mutation';assert.notEqual(s.project.snapshot().definitionProviderDraft.selection,p.definitionProviderDraft.selection);
});

test('v2/v3/v4 ordinary snapshots preserve encoding and provider replacement clears its own authority',async()=>{
 const s=controls();await s.project.load(value());
 for(const version of [2,3,4]){
  const p=ordinary();p.format=`intersect.toolkit.project.v${version}`;
  if(version>=3){const id=uri=>({uri,sha256:'0'.repeat(64)}),model=id('memory:model.rcore'),grammar=id('memory:language.xtext');const compilation={bundle:{version:1,sources:[{id:model,kind:'rcore',text:'rcore 1;',dependencies:[]},{id:grammar,kind:'xtext',text:'grammar example.Model',dependencies:[model]}],namespaces:[]},ecore:model,xtext:grammar,rcore_behavior:model,namespace:'urn:model',materialized_types:[]};p.definitionBundle=compilation;p.definitionRecovery={compilation:structuredClone(compilation),compilerProfile:p.compilerProfile};}
  if(version===4){p.entryRule='Node';p.definitionRecovery.entryRule='Node';}
  await s.project.load(p);assert.equal(s.state.provider,null);assert.equal(s.state.inferenceRecovery,null);
  // Frozen legacy encoder property order, including optional recipe/entry fields.
  const expected={format:p.format,mode:p.mode,profile:p.profile,compilerProfile:p.compilerProfile,structureSource:p.structureSource,...(version===4?{entryRule:p.entryRule}:{}),...(version>=3?{definitionBundle:p.definitionBundle,definitionRecovery:p.definitionRecovery}:{}),definitions:p.definitions,models:p.models,python:p.python,layout:p.layout};
  assert.equal(JSON.stringify(s.project.snapshot()),JSON.stringify(expected));
 }
});

test('cross-project provider recipes are replaced by own recovery or none and held reads observe provider edits',async()=>{
 const s=controls();await s.project.load(value(0));await s.project.load(value(1));assert.deepEqual(s.state.inferenceRecovery,recovery(1));
 const noRecovery=value(0);delete noRecovery.definitionInferenceRecovery;await s.project.load(noRecovery);assert.equal(s.state.inferenceRecovery,null);
 const bytes=new TextEncoder().encode(JSON.stringify(value(1))),input=s.elements.get('#project-file');let release;input.files=[{size:bytes.length,arrayBuffer:()=>new Promise(resolve=>release=()=>resolve(bytes.buffer))}];const pending=input.onchange({target:input});s.state.provider.selection='newer user provider draft';release();await pending;
 assert.match(s.elements.get('#project-status').textContent,/project changed while opening/);assert.equal(s.state.provider.selection,'newer user provider draft');
});

test('new project and Rcore replacement invoke reasoned hooks and clear provider/recovery state',async()=>{
 const s=controls();await s.project.load(value());await s.elements.get('#new-empty-project').onclick();assert.equal(s.state.provider,null);assert.equal(s.state.inferenceRecovery,null);assert.ok(s.events.includes('before:create'));assert.ok(s.events.includes('created:empty'));assert.ok(s.events.includes('loaded:create'));
 await s.project.load(value());const input=s.elements.get('#rcore-file'),bytes=new TextEncoder().encode('rcore 1;');input.files=[{size:bytes.length,arrayBuffer:async()=>bytes.buffer}];await input.onchange({target:input});assert.equal(s.state.provider,null);assert.equal(s.state.inferenceRecovery,null);assert.ok(s.events.includes('before:openRcore'));assert.ok(s.events.includes('loaded:openRcore'));
});

class Node{
 constructor(){this.children=[];this.queries=new Map();this.value='';this.open=false;this.dataset={};this.classList={toggle(){}};}
 set innerHTML(value){this.markup=value;}get options(){return this.children;}get selectedOptions(){return this.children.filter(child=>child.selected);}append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}querySelector(selector){if(!this.queries.has(selector))this.queries.set(selector,new Node());return this.queries.get(selector);}querySelectorAll(selector){return selector==='button'?[new Node(),new Node()]:[...this.queries.values()];}setAttribute(){}addEventListener(){}close(){this.open=false;}
}
test('managed editor behavior admission requires explicit provider mode and contextual previews preserve exact context',async()=>{
 const previous=globalThis.document;globalThis.document={createElement:()=>new Node(),body:new Node()};
 try{
  const active=recovery(),entry=active.inference.bundle.sources.find(s=>sourceKey(s.id)===sourceKey(active.inference.grammar)),primary=new Model(entry.text),editor={setModel(){},updateOptions(){}},host=new Node(),generatedHost=new Node();let changes=0;
  const monaco={Uri:{parse:value=>value},editor:{createModel:text=>new Model(text),setModelMarkers(){}}};
  const inferred=createInferenceProject({monaco,primary,editor,host,generatedHost,changed:()=>changes++,onGenerated(){}});
  inferred.restore({inputs:active.inference,drafts:[]});await assert.rejects(()=>inferred.prepare(entry.text),/behavior sources are not supported/);await assert.rejects(()=>inferred.prepare(entry.text,{providerMode:true}),/Explicit provider project mode/);
  inferred.setProviderDraft('invalid selector draft');assert.equal(changes,1);inferred.setProviderDraft('invalid selector draft');assert.equal(changes,1);
  assert.deepEqual(await inferred.prepare(entry.text,{providerMode:true}),active.inference);inferred.restoreProviders({version:1,selection:'restored selection'});assert.equal(changes,1);
  const generated={id:await sourceIdentity('memory:generated.rcore','generated'),text:'generated'},report={sources:[generated],entry:generated.id};
  inferred.showGenerated(report,active.inference,active.inference_context);assert.deepEqual(inferred.previewRequest(),{inference:active.inference,generated_source:generated.id,inference_context:active.inference_context});
  active.inference_context.computed_settings.length=0;assert.notDeepEqual(inferred.previewRequest().inference_context,active.inference_context);
  inferred.showGenerated(report,active.inference);assert.equal(Object.hasOwn(inferred.previewRequest(),'inference_context'),false);
  inferred.restoreRecovery(recovery());inferred.clearProviders();assert.equal(changes,2);assert.equal(inferred.providerSnapshot(),null);assert.deepEqual(inferred.recovery(),recovery());inferred.restore(null);assert.equal(inferred.recovery(),null);
 }finally{globalThis.document=previous;}
});


test('v5 recovery preserves one exact authored Rcore source selected for both structure and behavior',()=>{
 const unified=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/inferred-provider-selection/unified.json',import.meta.url),'utf8'));
 const active={inference:unified.inference,inference_context:{version:2,behavior:unified.provider_selection.behavior,computed_settings:[]},entryRule:null};
 assert.equal(validateInferenceRecovery(active),active);
 const state=createInferenceProviderState();state.captureSuccessfulRecovery({ok:true,...active});assert.deepEqual(state.recovery(),active);
 const p=value();p.definitionInference={inputs:structuredClone(unified.inference),drafts:[]};p.definitionInferenceRecovery=active;p.definitionProviderDraft.selection=JSON.stringify(unified.provider_selection);assert.equal(validateProject(p),p);
 const wrong=structuredClone(active);wrong.inference_context.behavior=wrong.inference.grammar;assert.throws(()=>validateInferenceRecovery(wrong),/behavior source/);
});
