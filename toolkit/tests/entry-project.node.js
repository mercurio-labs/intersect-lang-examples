import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectControls,validateProject} from '../src/project.js';
const base=()=>({format:'intersect.toolkit.project.v2',mode:'language',profile:'default',compilerProfile:'intersect.xtext.native.v57',structureSource:'rcore',definitions:{ecore:'projection',rcore:'rcore 1;',xtext:'grammar example.Model',rcore_behavior:''},models:{catalog:'alpha',loans:'alpha'},python:'',layout:{version:1,positions:{},zoom:1}});
function recovery(){const id=uri=>({uri,sha256:'0'.repeat(64)}),model=id('memory:model.rcore'),grammar=id('memory:language.xtext');return{compilerProfile:'intersect.xtext.native.v57',entryRule:'Node',compilation:{bundle:{version:1,sources:[{id:model,kind:'rcore',text:'rcore 1;',dependencies:[]},{id:grammar,kind:'xtext',text:'grammar example.Model',dependencies:[model]}],namespaces:[]},ecore:model,xtext:grammar,rcore_behavior:model,namespace:'urn:model',materialized_types:[]}};}
test('v4 retains requested and last active entries while older formats reject the new meaning',()=>{
 const p={...base(),format:'intersect.toolkit.project.v4',entryRule:'Missing',definitionRecovery:recovery()};p.definitionBundle=p.definitionRecovery.compilation;assert.equal(validateProject(p),p);
 assert.equal(p.entryRule,'Missing');assert.equal(p.definitionRecovery.entryRule,'Node');
 for(const format of ['intersect.toolkit.project.v2','intersect.toolkit.project.v3'])assert.throws(()=>validateProject({...p,format}),/v4/);
 for(const entryRule of [undefined,1,false,{},[],''])assert.throws(()=>validateProject({...p,entryRule}));
 const noRule=structuredClone(p);delete noRule.entryRule;assert.throws(()=>validateProject(noRule));
 const old={...base(),format:'intersect.toolkit.project.v3',definitionBundle:p.definitionBundle,definitionRecovery:recovery()};assert.throws(()=>validateProject(old));delete old.definitionRecovery.entryRule;assert.equal(validateProject(old),old);
 assert.throws(()=>validateProject({...base(),format:'intersect.toolkit.project.v4',entryRule:'Node',mode:'structure'}));
});
class Model{constructor(text){this.text=text;this.version=1;}getValue(){return this.text;}getVersionId(){return this.version;}getEOL(){return '\n';}pushStackElement(){}pushEOL(){}getFullModelRange(){return{};}pushEditOperations(_,edits){this.setValue(edits[0].text);}setValue(text){this.text=text;this.version++;}}
function controls(){
 const elements=new Map();const host={set innerHTML(value){this.markup=value;},querySelector(selector){if(!elements.has(selector))elements.set(selector,{textContent:'',value:'',files:[],classList:{toggle(){}}});return elements.get(selector);}};
 const definitions=Object.fromEntries(Object.entries(base().definitions).map(([k,v])=>[k,new Model(v)])),models=Object.fromEntries(Object.entries(base().models).map(([k,v])=>[k,new Model(v)]));let rule=null,changed=0,mode='language';
 const project=createProjectControls({host,definitionModels:definitions,modelModels:models,python:{model:new Model(''),cancel(){}},structure:{getLayout:()=>base().layout,setLayout(){}},request(){},changed(){changed++;},getMode:()=>mode,setMode:v=>mode=v,getEntryRule:()=>rule,setEntryRule:v=>rule=v});
 return{project,definitions,models,elements,get changed(){return changed;},set rule(value){rule=value;}};
}
async function heldLoad(state,change){const payload={...base(),definitions:{...base().definitions,rcore:'new authored source'}};let release;const bytes=new TextEncoder().encode(JSON.stringify(payload));const file={size:bytes.length,arrayBuffer:()=>new Promise(resolve=>release=()=>resolve(bytes.buffer))};const input=state.elements.get('#project-file');input.files=[file];const pending=input.onchange({target:input});change();release();await pending;return state.elements.get('#project-status').textContent;}
test('read-only Ecore projection refresh cannot cancel an otherwise unchanged project open',async()=>{
 const state=controls();const message=await heldLoad(state,()=>state.definitions.ecore.setValue('new generated projection'));
 assert.match(message,/Project opened/);assert.equal(state.definitions.rcore.getValue(),'new authored source');assert.equal(state.changed,1);
});
test('real authored edits and entry preference changes still reject held file reads before editor mutation',async()=>{
 for(const edit of [state=>state.definitions.rcore.setValue('newer user draft'),state=>{state.rule='Node';}]){
  const state=controls();const message=await heldLoad(state,()=>edit(state));assert.match(message,/project changed while opening/);assert.equal(state.changed,0);
  assert.notEqual(state.definitions.rcore.getValue(),'new authored source');
 }
});


test('malformed v4 selection rejects before any project editor mutation',async()=>{
 const state=controls(),input=state.elements.get('#project-file');const payload={...base(),format:'intersect.toolkit.project.v4',entryRule:42,definitions:{...base().definitions,rcore:'must not load'}};
 const bytes=new TextEncoder().encode(JSON.stringify(payload));input.files=[{size:bytes.length,arrayBuffer:async()=>bytes.buffer}];await input.onchange({target:input});
 assert.match(state.elements.get('#project-status').textContent,/Invalid parser entry selection/);assert.equal(state.changed,0);assert.equal(state.definitions.rcore.getValue(),base().definitions.rcore);
});
