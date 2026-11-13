import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceIdentity,withSourceEdits} from '../src/source-drafts.js';
import {validateProject} from '../src/project.js';
import {validateBundleProject,bundleSourceSnapshot} from '../src/bundle-project.js';
async function sample(){
 const sources=await Promise.all([['memory:model.rcore','rcore','rcore 1;'],['memory:language.xtext','xtext','grammar example.Model'],['memory:behavior.rcore','rcore_behavior','rcore 1; package test version "1";']].map(async([uri,kind,text])=>({id:await sourceIdentity(uri,text),kind,text,dependencies:[]})));
 const compilation={bundle:{version:1,sources,namespaces:[]},ecore:sources[0].id,namespace:'urn:model',xtext:sources[1].id,rcore_behavior:sources[2].id,materialized_types:[]};
 const compilerProfile='intersect.xtext.native.v57';
 return{format:'intersect.toolkit.project.v3',mode:'language',profile:'default',compilerProfile,structureSource:'rcore',definitionBundle:compilation,definitionRecovery:{compilation:structuredClone(compilation),compilerProfile},definitions:{ecore:'',rcore:'rcore 1;',xtext:'current invalid draft',rcore_behavior:''},models:{catalog:'alpha',loans:'alpha'},python:'',layout:{version:1,positions:{},zoom:1}};
}
test('ordinary recovery keeps original recipes separate from invalid drafts',async()=>{
 const p=await sample();assert.equal(validateProject(p),p);assert.notEqual(p.definitions.xtext,p.definitionRecovery.compilation.bundle.sources[1].text);
 assert.deepEqual(bundleSourceSnapshot(p.definitionRecovery.compilation),{ecore:'',rcore:'rcore 1;',xtext:'grammar example.Model',rcore_behavior:'rcore 1; package test version "1";'});
 const legacy=structuredClone(p);delete legacy.definitionRecovery;legacy.format='intersect.toolkit.project.v2';legacy.compilerProfile='intersect.xtext.native.v56';assert.equal(validateProject(legacy),legacy);
});
test('recovery rejects cached IR, conflicting modes, and mismatched profile metadata',async()=>{
 const p=await sample();
 for(const change of [v=>v.format='intersect.toolkit.project.v2',v=>delete v.definitionRecovery,v=>v.definitionRecovery.package={},v=>v.definitionRecovery.evaluation={},v=>v.definitionRecovery.compilerProfile='intersect.xtext.native.v56',v=>v.mode='structure',v=>delete v.definitionBundle,v=>v.definitionInference={},v=>v.definitionRecovery.compilation.xtext=null]){
  const bad=structuredClone(p);change(bad);assert.throws(()=>validateProject(bad));
 }
});
test('recovery preserves invalid source identities for native rejection rather than repairing them',async()=>{
 const p=await sample();p.definitionRecovery.compilation.bundle.sources[0].id.sha256='0'.repeat(64);assert.equal(validateProject(p),p);
 assert.deepEqual(await withSourceEdits(p.definitionRecovery.compilation,new Map()),p.definitionRecovery.compilation);
});
test('recovery preserves source bytes, namespace dependencies and resource ceilings',async()=>{
 const p=await sample(),record=p.definitionRecovery.compilation;record.bundle.sources[1].text='// α\r\ngrammar example.Model';record.bundle.sources[1].id=await sourceIdentity(record.bundle.sources[1].id.uri,record.bundle.sources[1].text);record.xtext=record.bundle.sources[1].id;
 record.bundle.namespaces=[{namespace:'urn:model',source:record.ecore}];record.bundle.sources[1].dependencies=[record.ecore];assert.equal(validateBundleProject(record),record);
 assert.ok(record.bundle.sources[1].text.includes(String.fromCharCode(13,10)));
 assert.equal(bundleSourceSnapshot(record).xtext,record.bundle.sources[1].text);
 const oversized=structuredClone(p);oversized.definitionRecovery.compilation.bundle.sources[0].text='x'.repeat(256001);assert.throws(()=>validateProject(oversized),/source/);
 const badKind=structuredClone(p);badKind.definitionRecovery.compilation.bundle.sources[0].kind='ecore';assert.throws(()=>validateProject(badKind),/source/);
});
