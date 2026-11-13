import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceIdentity,sourceKey,sourceEol,withSourceEdits} from '../src/source-drafts.js';
import {validateInferenceProject,inferenceStarter} from '../src/inference-project.js';
import {validateProject} from '../src/project.js';
async function record(){const id=await sourceIdentity('memory:entry.xtext',inferenceStarter);return {inputs:{version:1,bundle:{version:1,sources:[{id,kind:'xtext',text:inferenceStarter,dependencies:[]}],namespaces:[]},grammar:id},drafts:[]};}
const project=record=>({format:'intersect.toolkit.project.v2',mode:'inferred',profile:'default',compilerProfile:'intersect.xtext.native.v56',structureSource:'rcore',definitionInference:record,definitions:{ecore:'',rcore:'',xtext:inferenceStarter,rcore_behavior:''},models:{catalog:'alpha',loans:'alpha'},python:'',layout:{version:1,positions:{},zoom:1}});
test('source edits rewrite exact dependencies, selections and namespace identities',async()=>{
 const r=await record(),old=r.inputs.grammar,parent=await sourceIdentity('memory:parent.xtext','parent');
 r.inputs.bundle.sources.unshift({id:parent,kind:'xtext',text:'parent',dependencies:[]});r.inputs.bundle.sources[1].dependencies=[parent];r.inputs.bundle.namespaces=[{namespace:'urn:parent',source:parent}];
 const edited=await withSourceEdits(r.inputs,new Map([[sourceKey(parent),'changed']]));const fresh=await sourceIdentity(parent.uri,'changed');
 assert.deepEqual(edited.bundle.sources[0].id,fresh);assert.deepEqual(edited.bundle.sources[1].dependencies,[fresh]);assert.deepEqual(edited.bundle.namespaces[0].source,fresh);assert.deepEqual(edited.grammar,old);assert.equal(r.inputs.bundle.sources[0].text,'parent');
});
test('unchanged invalid source digests are not silently repaired',async()=>{
 const r=await record();r.inputs.bundle.sources[0].id.sha256='0'.repeat(64);r.inputs.grammar.sha256='0'.repeat(64);
 assert.deepEqual(await withSourceEdits(r.inputs,new Map([[sourceKey(r.inputs.grammar),inferenceStarter]])),r.inputs);
});
test('project validates source authority independently of invalid authored drafts',async()=>{
 const r=await record();const parent={id:await sourceIdentity('memory:parent.rcore','rcore 1;'),kind:'rcore',text:'rcore 1;',dependencies:[]};r.inputs.bundle.sources.unshift(parent);r.drafts=[{source:parent.id,text:'unfinished invalid draft'}];
 assert.equal(validateProject(project(r)).definitionInference,r);assert.equal(validateInferenceProject(r),r);
 for(const changed of [{...r,generated_sources:[]},{...r,inputs:{...r.inputs,unknown:true}},{...r,drafts:[{source:r.inputs.grammar,text:'ambiguous'}]},{...r,drafts:[...r.drafts,...r.drafts]}])assert.throws(()=>validateProject(project(changed)));
});
test('inferred projects reject conflicting recipes and mismatched profiles',async()=>{
 const p=project(await record());for(const changed of [{...p,mode:'language'},{...p,definitionBundle:{}},{...p,compilerProfile:'intersect.workbench.v1'},{...p,profile:'rcore'}])assert.throws(()=>validateProject(changed));
});
test('source identity transport preserves BOM, Unicode and CRLF bytes',async()=>{
 const r=await record();const text='\ufeff// α\r\n'+inferenceStarter.replaceAll('\n','\r\n');const result=await withSourceEdits(r.inputs,new Map([[sourceKey(r.inputs.grammar),text]]));assert.equal(result.bundle.sources[0].text,text);assert.deepEqual(result.grammar,await sourceIdentity(r.inputs.grammar.uri,text));assert.equal(sourceEol(text),1);assert.throws(()=>sourceEol('mixed\r\nends\n'));assert.throws(()=>sourceEol('one\rtwo'));
});
test('project rejects editor-incompatible parent endings before source replacement',async()=>{
 const r=await record();r.inputs.bundle.sources.push({id:await sourceIdentity('memory:parent.xtext','one\rline'),kind:'xtext',text:'one\rline',dependencies:[]});assert.throws(()=>validateProject(project(r)),/line endings/);
});
