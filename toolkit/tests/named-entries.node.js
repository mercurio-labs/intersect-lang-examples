import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ordinaryInputs} from './ordinary-parameter-inputs.js';
import {inferenceInputs} from './inferred-archive-browser.js';
import {packageArchive} from '../src/package-export.js';
import {unpackLanguageArchive} from '../src/package-import.js';
import {verifyNamedPreviews,verifyPreviewAuthority,verifyEmptyPreview,ordinary} from './named-entry-controls.js';
const module=await WebAssembly.compile(readFileSync(new URL('../public/intersect_web.wasm',import.meta.url)));assert.deepEqual(WebAssembly.Module.imports(module),[]);
async function runtime(){const {exports:e}=await WebAssembly.instantiate(module,{});return request=>{const bytes=new TextEncoder().encode(JSON.stringify(request));const p=e.input_buffer(bytes.length);assert.ok(p);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);const n=e.execute();const value=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.output_buffer(),n)));if(value.error)throw new Error(value.error);return value;};}
const metadata={package_id:'entry.preview',release:'1',display_name:'Named entries',description:''};
async function host(){let invoke=await runtime(),active,input,variant;
 return{
  async compile(kind,c){variant=kind;if(kind==='ordinary'){const original=ordinaryInputs(c);const migrated=invoke({method:'ecore/migrateCompilation',compilation:original,targets:c.metamodels.map((m,i)=>({source:original.bundle.sources[i].id,uri:m.uri.replace('.ecore','.rcore')}))});assert.equal(migrated.ok,true);input=migrated.compilation;active=invoke({method:'compile_bundle',compilation:input,xtext_profile:'intersect.xtext.native.v57'});}else{input=inferenceInputs(c);active=invoke({method:'compile_inferred',inference:input});}return active;},
  async catalog(){return invoke({method:'text/entries',package:active.package});},
  async evaluate(entry,sources){return invoke({method:'evaluate',package:active.package,entry_rule:entry,sources});},
  async resource(sources){return invoke({method:'evaluate',package:active.package,sources});},
  async archive(python){const d=invoke({method:'package/export',...(variant==='ordinary'?{compilation:input,xtext_profile:'intersect.xtext.native.v57'}:{inference:input}),metadata});const files=unpackLanguageArchive(await packageArchive(d,python));invoke=await runtime();active=invoke({method:'package/import',files});return active;},
  async forged(){const catalog=invoke({method:'text/entries',package:active.package});const cached=structuredClone(active.package);cached.grammar.entry='FORGED';cached.grammar.rules.FORGED=structuredClone(cached.grammar.rules.Node);cached.sources={};assert.deepEqual(invoke({method:'text/entries',package:cached}),catalog);const sources=[{uri:'memory:default',text:'alpha'}];assert.deepEqual(invoke({method:'evaluate',package:active.package,sources,entry_rule:null}),invoke({method:'evaluate',package:active.package,sources}));for(const bad of [false,[],{}])assert.throws(()=>invoke({method:'evaluate',package:active.package,entry_rule:bad,sources:[]}));}
 };
}
test('fresh JSON WASM consumes frozen entry catalogs, scalar returns, resource contexts and both ZIP forms',async()=>{await verifyNamedPreviews(await host());});
test('entry values follow per-resource atomic parsing and cached programs do not authorize entries',async()=>{const transport=await host();await verifyPreviewAuthority(transport);await transport.compile('ordinary',ordinary.find(c=>c.id==='false_call'));await transport.forged();await verifyEmptyPreview(transport);});
