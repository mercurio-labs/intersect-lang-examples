// Handwritten host orchestration. Rust owns definition/model semantics.
import {executionLimits} from '../.runtime/intersect-text/fixtures/rcore/execution-limits.mjs';
import structure from '../.runtime/intersect-text/fixtures/rcore/web/specialization-project.rcore?raw';
import grammar from '../.runtime/intersect-text/fixtures/rcore/web/specialization.xtext?raw';
import types from '../.runtime/intersect-text/fixtures/rcore/web/types.demo?raw';
import relations from '../.runtime/intersect-text/fixtures/rcore/web/relations.demo?raw';
export const rcoreDefaults = {rcore:structure,rcore_behavior:'',xtext:grammar,ecore:'',catalog:types,loans:relations};
const orderedSource = s => ({id:{uri:s.id.uri,sha256:s.id.sha256},kind:s.kind,text:s.text,dependencies:s.dependencies});
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const type = (source,index) => ({kind:'classifier',declaration:{source:source.id,path:[index]},arguments:[],raw:false});
const diagnostics = (result,source) => (result.diagnostics || []).map(d=>({source,start:d.span?.start ?? d.start ?? 0,end:d.span?.end ?? d.end ?? 1,message:d.message}));
export async function prepareRcore(client, snapshot) {
  const structure = await client.request('intersect/inspectRcoreStructure',{uri:'memory:model.rcore',text:snapshot.rcore});
  if (!structure.ok) return {ok:false,diagnostics:diagnostics(structure,'rcore')};
  const model = orderedSource(structure.source);
  const separate = snapshot.rcore_behavior.trim();
  const entry = separate ? {id:{uri:'memory:behavior.rcore',sha256:await hash(snapshot.rcore_behavior)},kind:'rcore_behavior',text:snapshot.rcore_behavior,dependencies:[model.id]} : model;
  const owner=structure.classifiers.find(c=>c.name==='Type');
  const operation=structure.operations.find(o=>o.name==='allGenerals' && JSON.stringify(o.owner)===JSON.stringify(owner?.declaration));
  if (!operation) return {ok:false,diagnostics:[{source:'rcore',start:0,end:1,message:'The example requires Type.allGenerals() -> Type [0,*].'}]};
  const request = {receiver_type:type(model,owner.declaration.path[0]),operation:operation.declaration,materialized_types:structure.classifiers.map((_,i)=>type(model,i)),bundle:{version:1,sources:separate?[model,entry]:[model],namespaces:[]},entry:entry.id,selection:{symbol:{source:entry.id,declaration:1},types:[],arguments:[]}};
  const compiled = await client.request('intersect/compileRcoreOperation',request);
  if (!compiled.ok) return {ok:false,diagnostics:diagnostics(compiled,separate?'rcore_behavior':'rcore')};
  return {ok:true,model,request,compiled,structure};
}
export async function runRcore(client, active, seedName, observe = true) {
  if (!active) throw new Error('Compile the Rcore example first.');
  const inspected = await client.request('intersect/inspect');
  if (!inspected.evaluation || inspected.evaluation.diagnostics.length) throw new Error('Fix the language model diagnostics before running behavior.');
  const elements = inspected.evaluation.model.elements;
  const seed = elements.find(e=>e.class==='Type' && e.values.name===seedName);
  if (!seed) throw new Error(`No Type named ${seedName}.`);
  // Checked fresh view of the current parsed model. Preserve all element IDs and
  // stored values; materialization assigns its own resource/initialization evidence.
  const classes = active.structure.classifiers.map(c=>c.name);
  const types = active.structure.classifiers.map(c=>type(active.model,c.declaration.path[0]));
  const bundle = {version:1,sources:[active.model],namespaces:[]};
  const constructed = await client.request('intersect/materializeGenericTypes',{bundle,entry:active.model.id,namespace:active.namespace,types,
    instances:elements.map(e=>({id:e.id,type:types[classes.indexOf(e.class)]})),
    edits:elements.flatMap(e=>Object.entries(e.values).filter(([,v])=>v!==null).map(([field,v])=>[e.id,field,v]))});
  if (!constructed.ok) throw new Error(JSON.stringify(constructed.diagnostics));
  const context = {bundle,entry:active.model.id,namespace:active.namespace,conversions:[],materialized_types:types,model:constructed.model};
  const digest = await hash(JSON.stringify(context));
  const program = active.compiled.program;
  const parameter = program.functions[program.entry].parameters[0];
  const result = await client.request('intersect/invokeRcoreOperation',{...active.request,
    receiver_argument:{ty:parameter,data:{Model:{kind:'model_reference',context:digest,element:seed.id}}},arguments:[],reference_contexts:[context],execution_limits:{...executionLimits,observation:{enabled:observe,max_events:4096,max_event_bytes:65536}}});
  if (!result.ok) throw new Error(result.failure?.message || JSON.stringify(result.diagnostics));
  return {names:result.evaluation.value.data.Collection.map(v=>elements.find(e=>e.id===v.data.Model.element)?.values.name),result};
}
