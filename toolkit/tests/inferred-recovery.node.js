import test from 'node:test';
import assert from 'node:assert/strict';
import {createInferenceProviderState,validateInferenceRecovery,validateDurableInferenceRecovery} from '../src/inference-provider-state.js';
import {createProjectControls,validateProject} from '../src/project.js';
import {inferenceStarter} from '../src/inference-project.js';
import {sourceIdentity} from '../src/source-drafts.js';
const saved=value=>JSON.parse(JSON.stringify(value));
async function recipe(){const text='\ufeff// café 雪\r\n'+inferenceStarter.replaceAll('\n','\r\n'),id=await sourceIdentity('memory:durable/model.xtext',text);return {inference:{version:1,bundle:{version:1,sources:[{id,kind:'xtext',text,dependencies:[]}],namespaces:[]},grammar:id},entryRule:null};}
async function value(){const active=await recipe();return {format:'intersect.toolkit.project.v6',mode:'inferred',profile:'default',compilerProfile:'intersect.xtext.native.v56',structureSource:'rcore',entryRule:'MissingDraftEntry',definitionInference:{inputs:structuredClone(active.inference),drafts:[]},definitionInferenceRecovery:active,definitions:{ecore:'',rcore:'',xtext:'grammar unfinished ???',rcore_behavior:''},models:{catalog:'alpha',loans:'alpha'},python:'',layout:{version:1,positions:{},zoom:1}};}
test('ordinary durable recipe has an absent context, exact source bytes and separate requested/active entries',async()=>{
 const p=await value(),original=structuredClone(p.definitionInferenceRecovery);assert.equal(validateProject(p),p);assert.equal(validateDurableInferenceRecovery(original),original);assert.throws(()=>validateInferenceRecovery(original));
 assert.equal(Object.hasOwn(original,'inference_context'),false);assert.equal(p.entryRule,'MissingDraftEntry');assert.equal(original.entryRule,null);
 const state=createInferenceProviderState();state.captureSuccessfulRecovery({ok:true,...original});p.definitionInferenceRecovery.inference.bundle.sources[0].text='caller mutation';assert.deepEqual(state.recovery(),original);
 state.recovery().inference.bundle.sources.length=0;assert.deepEqual(state.recovery(),original);state.restoreProviders({version:1,selection:'{ invalid future provider draft'});assert.deepEqual(state.recovery(),original);
});
test('v6 rejects ambiguous, cached, context-null and wrong-mode recovery before activation',async()=>{
 const p=await value();for(const mutate of [v=>delete v.definitionInferenceRecovery,v=>delete v.entryRule,v=>v.definitionInferenceRecovery.entryRule='',v=>v.definitionInferenceRecovery.inference_context=null,v=>v.definitionInferenceRecovery.package={},v=>v.definitionInferenceRecovery.generated_sources=[],v=>v.mode='language',v=>v.compilerProfile='intersect.xtext.native.v58',v=>v.definitionBundle={},v=>v.definitionRecovery={},v=>delete v.definitionInference,v=>v.cachedPackage={},v=>v.definitionProviderDraft=null,v=>v.definitionInferenceRecovery.inference.bundle.sources.push(structuredClone(v.definitionInferenceRecovery.inference.bundle.sources[0]))]){const bad=structuredClone(p);mutate(bad);assert.throws(()=>validateProject(bad));}
 for(const format of [2,3,4,5])assert.throws(()=>validateProject({...p,format:`intersect.toolkit.project.v${format}`}));
 const state=createInferenceProviderState();state.captureSuccessfulRecovery({ok:true,...p.definitionInferenceRecovery});for(const bad of [{ok:false,...p.definitionInferenceRecovery},{...p.definitionInferenceRecovery},{ok:true,...p.definitionInferenceRecovery,cachedPackage:{}},{ok:true,inference:p.definitionInferenceRecovery.inference}]){assert.throws(()=>state.captureSuccessfulRecovery(bad));assert.deepEqual(state.recovery(),p.definitionInferenceRecovery);}
});
test('v6 can retain a checked active context without a current provider draft or with an ordinary newer draft',async()=>{
 const p=await value();p.definitionInferenceRecovery.inference_context={version:1,conversions:[],applied_conversions:[],constructors:[]};assert.equal(validateProject(p),p);assert.equal(Object.hasOwn(p,'definitionProviderDraft'),false);
 p.definitionProviderDraft={version:1,selection:'{ invalid newer selector'};assert.equal(validateProject(p),p);assert.equal(validateProject({...p,format:'intersect.toolkit.project.v5'}).format,'intersect.toolkit.project.v5');
 delete p.definitionInferenceRecovery.inference_context;assert.equal(validateProject(p),p);assert.throws(()=>validateProject({...p,format:'intersect.toolkit.project.v5'}));
});
class Model{constructor(text=''){this.text=text;this.version=1;}getValue(){return this.text;}getVersionId(){return this.version;}pushStackElement(){}pushEOL(){}getFullModelRange(){return {};}pushEditOperations(_,edits){this.text=edits[0].text;this.version++;}}
function harness(){const elements=new Map(),events=[];let mode='language',profile='default',compilerProfile='intersect.xtext.native.v57',layout={version:1,positions:{},zoom:1},inference=null,provider=null,recovery=null,entry=null;
 const host={set innerHTML(_value){},querySelector(selector){if(!elements.has(selector))elements.set(selector,{textContent:'',value:'',files:[],classList:{toggle(){}}});return elements.get(selector);}};
 const definitions=Object.fromEntries(['ecore','rcore','xtext','rcore_behavior'].map(key=>[key,new Model()])),models=Object.fromEntries(['catalog','loans'].map(key=>[key,new Model()]));
 const project=createProjectControls({host,definitionModels:definitions,modelModels:models,python:{model:new Model(),cancel(){}},structure:{getLayout:()=>layout,setLayout:value=>layout=value},getMode:()=>mode,setMode:value=>mode=value,getProfile:()=>profile,setProfile:value=>profile=value,getCompilerProfile:()=>compilerProfile,setCompilerProfile:value=>compilerProfile=value,getEntryRule:()=>entry,setEntryRule:value=>entry=value,getInference:()=>inference,setInference:value=>inference=value,getProviderDraft:()=>provider,setProviderDraft:value=>provider=value,getInferenceRecovery:()=>recovery,setInferenceRecovery:value=>recovery=value,beforeReplace(){events.push('before');},loaded(){events.push('loaded');},changed(){events.push('changed');},created:async()=>{},sample:{},kerml:{}});
 return {project,events,elements,definitions,get recovery(){return recovery;}};
}
test('v6 load installs only its own original recipe and snapshots the correct compatibility format',async()=>{
 const p=await value(),h=harness();await h.project.load(p);assert.deepEqual(h.events,['before','changed','loaded']);assert.deepEqual(h.recovery,p.definitionInferenceRecovery);assert.deepEqual(saved(h.project.snapshot()),p);
 const ordinaryWithProvider=structuredClone(p);ordinaryWithProvider.definitionProviderDraft={version:1,selection:'invalid'};await h.project.load(ordinaryWithProvider);assert.deepEqual(saved(h.project.snapshot()),ordinaryWithProvider);
 const checked=structuredClone(ordinaryWithProvider);checked.definitionInferenceRecovery.inference_context={version:2,behavior:null,computed_settings:[]};checked.format='intersect.toolkit.project.v5';await h.project.load(checked);assert.deepEqual(saved(h.project.snapshot()),checked);
 delete checked.definitionProviderDraft;checked.format='intersect.toolkit.project.v6';await h.project.load(checked);assert.deepEqual(saved(h.project.snapshot()),checked);
 const legacy=structuredClone(p);legacy.format='intersect.toolkit.project.v2';delete legacy.entryRule;delete legacy.definitionInferenceRecovery;await h.project.load(legacy);assert.equal(h.recovery,null);assert.deepEqual(saved(h.project.snapshot()),legacy);
});
test('invalid v6 cannot fence or mutate an existing project, and held reads reject newer recovery choices',async()=>{
 const h=harness(),p=await value();await h.project.load(p);h.events.length=0;const invalid=structuredClone(p);invalid.definitionInferenceRecovery.inference.grammar={...invalid.definitionInferenceRecovery.inference.grammar,sha256:'0'.repeat(64)};assert.throws(()=>h.project.load(invalid));assert.deepEqual(h.events,[]);assert.deepEqual(saved(h.project.snapshot()),p);
 const bytes=new TextEncoder().encode(JSON.stringify(p)),input=h.elements.get('#project-file');let release;input.files=[{size:bytes.length,arrayBuffer:()=>new Promise(resolve=>release=()=>resolve(bytes.buffer))}];const pending=input.onchange({target:input});h.recovery.entryRule='NewActiveEntry';release();await pending;assert.match(h.elements.get('#project-status').textContent,/project changed while opening/);assert.equal(h.recovery.entryRule,'NewActiveEntry');assert.deepEqual(h.events,[]);
});
