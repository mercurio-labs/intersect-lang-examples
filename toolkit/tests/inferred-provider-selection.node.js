// Authored selector and preview prerequisite; native extension evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>JSON.parse(readFileSync(new URL(`../.runtime/intersect-text/fixtures/xtext/inferred-provider-selection/${name}`,import.meta.url),'utf8'));
const plan=read('plan.json'),before=read('before.json');
const module=await WebAssembly.compile(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
async function runtime(){const {exports:e}=await WebAssembly.instantiate(module,{});return request=>{const bytes=new TextEncoder().encode(JSON.stringify(request)),p=e.input_buffer(bytes.length);assert.ok(p);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);const n=e.execute(),response=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),n)));if(response?.error)throw new Error(response.error);return response;};}
const request=c=>({method:'inferred/selectProviders',inference:c.inference,provider_selection:c.provider_selection});
function selected(invoke,c){const result=invoke(request(c));assert.equal(result.ok,true,JSON.stringify(result));return result;}
function evaluate(invoke,result,c){return invoke({method:'evaluate',package:result.package,sources:[{uri:'memory:provider-selection.model',text:c.model_text}]});}
function verify(result,e,c){assert.deepEqual(e.diagnostics,[]);assert.equal(e.model.elements.length,2);const item=e.model.elements.find(e=>result.package.schema.declarations[e.class].name==='Item');const value=c.id.startsWith('collection')?['alpha','beta']:'alpha';assert.deepEqual(item.values,{backing:value});assert.deepEqual(e.derived[item.id].computed,value);}
function rejected(invoke,request){try{const r=invoke(request);assert.notEqual(r.ok,true,JSON.stringify(r));}catch(error){if(error.code==='ERR_ASSERTION')throw error;}}
test('fresh WASM resolves authored choices to exact existing contexts and real provider model values',async()=>{
 for(const c of plan.cases){const invoke=await runtime(),catalog=invoke({method:'inferred/providerCandidates',inference:c.inference});assert.equal(catalog.ok,true);assert.equal(catalog.boundary,'authored_direct_nongeneric_rcore');assert.ok(catalog.candidates.some(s=>s.class==='Item'&&s.feature==='computed'&&s.source.sha256===c.provider_selection.computed_settings[0].source.sha256));
  const result=selected(invoke,c);assert.deepEqual(result.inference_context,c.expected_context);assert.deepEqual(invoke({...request(c),inference_context:{version:1,conversions:[]}}).inference_context,c.expected_context);assert.deepEqual(result.provider_selection,c.provider_selection);assert.deepEqual(result.package.xtext_inference.bundle,c.inference.bundle);const e=evaluate(invoke,result,c);verify(result,e,c);assert.deepEqual(e,before.cases.find(old=>old.id===c.id).observations[5].response);
  const fresh=await runtime();assert.deepEqual(selected(fresh,c),result);assert.deepEqual(evaluate(fresh,result,c),e);
 }
});
test('contextual generated preview rebuilds exact original sources and keeps legacy failures unchanged',async()=>{
 for(const c of plan.cases){const invoke=await runtime(),result=selected(invoke,c),request={method:'inferred/structurePreviewWithContext',inference:c.inference,inference_context:result.inference_context,generated_source:result.generated_definitions.entry},preview=invoke(request);assert.equal(preview.ok,true);assert.deepEqual(preview.lowering.original.id,result.generated_definitions.entry);const child=preview.document.classes.find(c=>c.name==='Model').features.find(f=>f.name==='child');assert.equal(child.containment,true);assert.match(child.type,/Item/);
  assert.deepEqual(invoke({...request,package:{schema:null,grammar:null},generated_definitions:{sources:[]}}),preview);
  const stale=structuredClone(request);stale.generated_source.sha256='0'.repeat(64);assert.throws(()=>invoke(stale),/exact freshly generated/);
  const old=before.cases.find(old=>old.id===c.id);assert.throws(()=>invoke(old.observations[3].request),/explicit context method/);assert.deepEqual(invoke(old.observations[4].request),old.observations[4].response);
 }
});
test('WASM rejects stale, unsupported, duplicate, generated, inherited, generic and unused selections',async()=>{
 for(const c of plan.cases){const invoke=await runtime(),result=selected(invoke,c),baseline=evaluate(invoke,result,c);const missingRequired=request(structuredClone(c));missingRequired.provider_selection.computed_settings[0].operations=c.id.startsWith('collection')?['set','unset']:['unset'];const omitted=invoke(missingRequired);assert.equal(omitted.ok,false);assert.match(JSON.stringify(omitted.diagnostics),/Cannot assign derived feature/);assert.deepEqual(evaluate(invoke,result,c),baseline);assert.deepEqual(selected(invoke,c),result);for(const field of ['namespace','class','feature']){const bad=request(structuredClone(c));bad.provider_selection.computed_settings[0][field]='missing';rejected(invoke,bad);}
  for(const variant of ['source','behavior','provider','operations','duplicate','generated','empty','version','internal','context']){const bad=request(structuredClone(c)),s=bad.provider_selection.computed_settings[0];if(variant==='source')s.source.sha256='0'.repeat(64);if(variant==='behavior')bad.provider_selection.behavior.sha256='0'.repeat(64);if(variant==='provider')s.provider.version='2';if(variant==='operations')s.operations=[];if(variant==='duplicate')bad.provider_selection.computed_settings.push(structuredClone(s));if(variant==='generated')s.source=result.generated_definitions.entry;if(variant==='empty')bad.provider_selection.computed_settings=[];if(variant==='version')bad.provider_selection.version=2;if(variant==='internal')s.class_identity='forged';if(variant==='context')bad.inference_context=result.inference_context;rejected(invoke,bad);}
  assert.deepEqual(selected(invoke,c),result);
 }
 for(const c of plan.negative_cases){const invoke=await runtime();if(c.id==='ambiguous'){assert.throws(()=>invoke(request(c)),/InvalidDefinition: Duplicate classifier\/package name/);continue;}const r=invoke(request(c));assert.equal(r.ok,false,JSON.stringify(r));if(c.expected_message)assert.ok(JSON.stringify(r.diagnostics).toLowerCase().includes(c.expected_message.toLowerCase()),JSON.stringify(r));}
});
test('source edits require fresh native member resolution rather than rehashed old contracts',async()=>{
 for(const c of plan.cases){const invoke=await runtime(),changed=structuredClone(c),s=changed.inference.bundle.sources.find(s=>s.id.sha256===changed.provider_selection.computed_settings[0].source.sha256&&s.id.uri===changed.provider_selection.computed_settings[0].source.uri),old=structuredClone(s.id);s.text+='// current authored source café\n';s.id={uri:s.id.uri,sha256:createHash('sha256').update(s.text).digest('hex')};
  for(const source of changed.inference.bundle.sources)source.dependencies=source.dependencies.map(id=>id.uri===old.uri&&id.sha256===old.sha256?s.id:id);for(const binding of changed.inference.bundle.namespaces)if(binding.source.uri===old.uri&&binding.source.sha256===old.sha256)binding.source=s.id;
  rejected(invoke,request(changed));const choices=invoke({method:'inferred/providerCandidates',inference:changed.inference});const candidate=choices.candidates.find(candidate=>candidate.class==='Item'&&candidate.feature==='computed');assert.deepEqual(candidate.source,s.id);changed.provider_selection.computed_settings[0].source=candidate.source;
  const result=selected(invoke,changed);assert.notDeepEqual(result.inference_context,c.expected_context);verify(result,evaluate(invoke,result,changed),changed);const stale=invoke({method:'compile_inferred_with_context',inference:changed.inference,inference_context:c.expected_context});assert.equal(stale.ok,false);
 }
});

test('catalog-v1 language compilation remains valid while custom RGB structure projection stays explicitly unsupported',async()=>{
 for(const c of read('catalog-before.json').cases){const invoke=await runtime(),p=invoke({method:'compile_inferred_with_context',inference:c.request.inference,inference_context:c.request.inference_context});assert.equal(p.ok,true);assert.deepEqual(p.generated_definitions.entry,c.request.generated_source);
  assert.throws(()=>invoke(c.request),error=>/Cannot project inferred resource context/.test(error.message)&&/Unsupported datatype RGB/.test(error.message)&&/an explicit provider is required/.test(error.message)&&error.message.includes(c.request.inference.bundle.sources[0].id.uri));
  assert.throws(()=>invoke(c.legacy_request),error=>error.message===c.legacy_response.error);
 }
});
