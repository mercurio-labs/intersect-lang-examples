import test from 'node:test';
import assert from 'node:assert/strict';
import {createInferredProviderControls} from '../src/inferred-provider-controls.js';
class Node{
 constructor(){this.children=[];this.queries=new Map();this.value='';this.open=false;this.dataset={};this.classList={toggle(){}};}
 set innerHTML(value){this.markup=value;}get options(){return this.children;}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}querySelector(selector){if(!this.queries.has(selector))this.queries.set(selector,new Node());return this.queries.get(selector);}setAttribute(){}
}
const id=name=>({uri:`memory:${name}`,sha256:'1'.repeat(64)});
function setup(){
 const previous=globalThis.document;globalThis.document={createElement:()=>new Node(),createTextNode:text=>({textContent:text})};
 const source=id('model.rcore'),behavior=id('behavior.rcore'),candidate={source,namespace:'urn:project',class:'Item',feature:'computed',provider:{name:'rcore.projection',version:'1'},operations:['set']};
 let selection=JSON.stringify({version:1,behavior,computed_settings:[]}),epoch=0,request=async()=>({ok:true,candidates:[candidate],unsupported:[]});
 const host=new Node(),controls=createInferredProviderControls({host,enabled:()=>selection!==null,draft:()=>selection,setDraft:value=>{selection=value;epoch++;},clear:()=>{selection=null;epoch++;},prepare:async()=>({bundle:{sources:[{id:behavior,kind:'rcore_behavior'}]}}),request:(...args)=>request(...args),stamp:()=>String(epoch),changed(){epoch++;}});
 controls.refresh();const box=host.children[0];
 return {controls,box,candidate,behavior,get selection(){return selection;},set selection(value){selection=value;epoch++;},set request(value){request=value;},restore(){globalThis.document=previous;}};
}
test('behavior changes read the current valid JSON draft and preserve unrelated new settings',async()=>{
 const state=setup();try{
  await state.box.querySelector('[data-discover]').onclick();
  const desired={version:1,behavior:null,computed_settings:[{...state.candidate,operations:['set','unset']}]},text=state.box.querySelector('textarea');text.value=JSON.stringify(desired);text.oninput();
  const behavior=state.box.querySelector('select');behavior.value=JSON.stringify(state.behavior);behavior.onchange();
  assert.deepEqual(JSON.parse(state.selection),desired);
  await state.box.querySelector('[data-discover]').onclick();behavior.value=JSON.stringify(state.behavior);behavior.onchange();
  assert.deepEqual(JSON.parse(state.selection),{...desired,behavior:state.behavior});
 }finally{state.restore();}
});
test('behavior changes cannot overwrite an invalid newer selection draft with cached parsed state',async()=>{
 const state=setup();try{
  await state.box.querySelector('[data-discover]').onclick();const text=state.box.querySelector('textarea'),draft='{ invalid newer selector · café';text.value=draft;text.oninput();
  const behavior=state.box.querySelector('select');behavior.value=JSON.stringify(state.behavior);behavior.onchange();
  assert.equal(state.selection,draft);
 }finally{state.restore();}
});
test('closing/replacing a project removes candidate controls from the previous source/session',async()=>{
 const state=setup();try{
  await state.box.querySelector('[data-discover]').onclick();assert.equal(state.box.querySelector('[data-members]').children.length,1);
  state.controls.close();state.selection=JSON.stringify({version:1,behavior:null,computed_settings:[]});state.controls.refresh();
  assert.equal(state.box.querySelector('[data-members]').children.length,0);assert.equal(state.box.querySelector('select').options.length,0);
 }finally{state.restore();}
});
test('late discovery failure cannot overwrite a replacement project status',async()=>{
 const state=setup();try{
  let reject,started;const waiting=new Promise(resolve=>started=resolve);state.request=()=>{started();return new Promise((_,failure)=>reject=failure);};
  const pending=state.box.querySelector('[data-discover]').onclick();await waiting;
  state.controls.close();state.selection=JSON.stringify({version:1,behavior:null,computed_settings:[]});state.controls.refresh();
  const status=state.box.querySelector('[role=status]');status.textContent='Replacement project';reject(new Error('late old discovery failure'));await pending;
  assert.equal(status.textContent,'Replacement project');
 }finally{state.restore();}
});
