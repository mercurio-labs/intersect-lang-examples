// Frozen observations and host transport controls; Rust owns entry semantics.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelProjection} from './inferred-archive-browser.js';
const read=name=>JSON.parse(readFileSync(new URL(`../.runtime/intersect-text/fixtures/xtext/${name}`,import.meta.url),'utf8'));
export const ordinary=read('imported-parameters/cases.json').cases;
const ordinaryRows=read('imported-parameters/observations.json');
export const supplemental=read('parameter-entry-contexts/cases.json').cases;
const supplementalRows=read('parameter-entry-contexts/observations.json');
export const inferredCases=read('inference-fragment-runtime/cases.json');
const inferredRows=read('inference-fragment-runtime/observations.json');
const counterparts=read('inference-parameters/cases.json').lowercase_counterparts;
export const modelUri='memory:entry-preview.model';
const parsed=row=>!row.exception&&row.errors?.length===0;
export function checkResult(pkg,result,row,raw){
 assert.equal(result.diagnostics.length===0,parsed(row),`${row.case}/${row.entry}/${row.text}: ${JSON.stringify(result.diagnostics)}`);
 if(row.accepted)assert.deepEqual(modelProjection(pkg,result.model),row.model);
 else assert.deepEqual(result.model.elements,[]);
 if(row.entry==='resource'){assert.equal(result.entry_values,undefined);return;}
 if(!parsed(row))assert.deepEqual(result.entry_values,{});
 else if(row.accepted)assert.deepEqual(result.entry_values[modelUri],{kind:'object',value:result.model.elements[0].id});
 if(raw?.value_kind==='string'&&parsed(row))assert.deepEqual(result.entry_values[modelUri],{kind:'datatype',value:raw.value});
}
function checkCatalog(pkg,catalog,inventory){
 assert.equal(catalog.default_entry,pkg.grammar.entry);
 if(inventory)assert.deepEqual(Object.keys(catalog.entries),inventory.map(r=>r.method.slice('entryRule'.length)));
 const bundle=(pkg.compilation||pkg.xtext_inference).bundle;
 for(const [name,rule]of Object.entries(catalog.entries)){
  assert.equal(typeof rule.datatype,'boolean');
  const source=bundle.sources.find(s=>s.id.uri===rule.declaration.source.uri&&s.id.sha256===rule.declaration.source.sha256);assert.ok(source,`${name}: original producer`);
  assert.ok(new TextDecoder().decode(new TextEncoder().encode(source.text).slice(rule.declaration.start,rule.declaration.end)).includes(name));
  assert.ok(!rule.declaration.source.uri.startsWith('intersect:parameter-program:'));
 }
}
export async function verifyNamedPreviews(host){
 const counts={independent_named:0,resource:0,scalar_strings:0,source_rejected:0,generator_obstructed:0,inferred_counterparts:0};
 for(const c of ordinary){
  const runs=ordinaryRows.runs.filter(r=>r.case===c.id&&r.entry!=='resource');if(!runs.length)continue;
  const built=await host.compile('ordinary',c);assert.equal(built.ok,true,JSON.stringify(built.diagnostics));
  checkCatalog(built.package,await host.catalog());
  for(const row of runs){checkResult(built.package,await host.evaluate(row.entry,[{uri:modelUri,text:row.text}]),row);counts.independent_named++;}
 }
 for(const c of supplemental){
  const generation=supplementalRows.generation.find(g=>g.id===c.id),built=await host.compile('ordinary',c);
  if(generation.stage!=='compiled'){
   assert.equal(built.ok,false,c.id);counts[generation.stage==='metadata_rejected'?'source_rejected':'generator_obstructed']++;continue;
  }
  assert.equal(built.ok,true,`${c.id}: ${JSON.stringify(built.diagnostics)}`);checkCatalog(built.package,await host.catalog(),generation.entry_methods);
  for(const row of supplementalRows.runs.filter(r=>r.case===c.id)){
   if(row.entry==='resource'){
    if(host.resource){checkResult(built.package,await host.resource([{uri:modelUri,text:row.text}]),row);counts.resource++;}
    continue;
   }
   const raw=supplementalRows.direct_entries.find(r=>r.case===c.id&&r.entry===row.entry&&r.text===row.text);
   checkResult(built.package,await host.evaluate(row.entry,[{uri:modelUri,text:row.text}]),row,raw);counts.independent_named++;
   if(raw.value_kind==='string'&&parsed(row))counts.scalar_strings++;
  }
  if(host.archive){
   const row=supplementalRows.runs.find(r=>r.case===c.id&&r.entry!=='resource'&&parsed(r));
   if(row){const raw=supplementalRows.direct_entries.find(r=>r.case===c.id&&r.entry===row.entry&&r.text===row.text);for(const python of [false,true]){const loaded=await host.archive(python);assert.deepEqual(loaded.package,built.package);checkCatalog(loaded.package,await host.catalog(),generation.entry_methods);checkResult(loaded.package,await host.evaluate(row.entry,[{uri:modelUri,text:row.text}]),row,raw);}}
  }
 }
 for(const row of inferredRows.runs.filter(r=>r.entry!=='resource')){
  const c=inferredCases.find(c=>c.id===row.case),built=await host.compile('inferred',c);assert.equal(built.ok,true,JSON.stringify(built.diagnostics));checkCatalog(built.package,await host.catalog());
  checkResult(built.package,await host.evaluate(row.entry,[{uri:modelUri,text:row.text}]),row);counts.independent_named++;
 }
 for(const id of ['false_call','recursive_context','inherited_parameters','parameterized_entry']){
  const c=counterparts.find(c=>c.id===id),built=await host.compile('inferred',c);assert.equal(built.ok,true,JSON.stringify(built.diagnostics));const entry=id==='parameterized_entry'?'Model':'Node';const catalog=await host.catalog();assert.ok(catalog.entries[entry]);
  const result=await host.evaluate(entry,[{uri:modelUri,text:id==='recursive_context'?'no alpha':'alpha'}]);assert.deepEqual(result.diagnostics,[]);assert.ok(result.model.elements.length);assert.equal(result.entry_values[modelUri].kind,'object');counts.inferred_counterparts++;
  if(host.archive)for(const python of [false,true]){await host.archive(python);const result=await host.evaluate(entry,[{uri:modelUri,text:id==='recursive_context'?'no alpha':'alpha'}]);assert.deepEqual(result.diagnostics,[]);assert.ok(result.model.elements.length);}
 }
 assert.deepEqual(counts,{independent_named:41,resource:host.resource?13:0,scalar_strings:3,source_rejected:1,generator_obstructed:2,inferred_counterparts:4});return counts;
}
export async function verifyPreviewAuthority(host){
 const c=ordinary.find(c=>c.id==='false_call');assert.equal((await host.compile('ordinary',c)).ok,true);
 const good=await host.evaluate('Node',[{uri:'memory:a',text:'alpha'},{uri:'memory:b',text:'beta'}]);assert.deepEqual(good.diagnostics,[]);assert.equal(Object.keys(good.entry_values).length,2);
 const partial=await host.evaluate('Node',[{uri:'memory:a',text:'alpha'},{uri:'memory:b',text:'alpha beta'}]);assert.ok(partial.diagnostics.length);assert.equal(partial.model.elements.length,1);assert.deepEqual(Object.keys(partial.entry_values),['memory:a']);assert.deepEqual(partial.model.resources['memory:b'].roots,[]);assert.equal(partial.model.resources['memory:b'].source,null);
 const unknown=await host.evaluate('FORGED',[{uri:modelUri,text:'alpha'}]);assert.ok(unknown.diagnostics.length);assert.deepEqual(unknown.model.resources,{});assert.deepEqual(unknown.entry_values,{});
}

export async function verifyEmptyPreview(host){
 const c=read('inference-parameter-empty/cases.json').find(c=>c.id==='root_empty');
 assert.equal((await host.compile('inferred',c)).ok,true);
 const result=await host.evaluate('Model',[{uri:modelUri,text:'node'}]);
 assert.deepEqual(result.diagnostics,[]);assert.deepEqual(result.model.elements,[]);
 assert.deepEqual(result.entry_values[modelUri],{kind:'empty'});
 assert.deepEqual(result.model.resources[modelUri].roots,[]);assert.ok(result.model.resources[modelUri].source);
}
