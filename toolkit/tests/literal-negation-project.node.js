import test from 'node:test';import assert from 'node:assert/strict';
import {validateProject}from '../src/project.js';import {get,projectFor,profile}from './literal-negation-fixtures.js';
test('ordinary V59 project JSON retains actual original source graphs and recovery without cached execution authority',()=>{
 for(const id of ['multichar','astral_literal']){const original=projectFor(get(id)),loaded=JSON.parse(JSON.stringify(original));assert.equal(validateProject(loaded),loaded);assert.equal(loaded.compilerProfile,profile);assert.deepEqual(loaded.definitionBundle,get(id).compilation);assert.deepEqual(loaded.definitionRecovery,{compilation:get(id).compilation,compilerProfile:profile});assert.deepEqual(loaded.definitions,original.definitions);assert.ok(loaded.definitions.xtext.includes(id==='multichar'?"!'ab'":"!'🌍'"));}
});
test('V59 transport rejects future profiles, mismatched recovery and inferred-mode selection',()=>{
 for(const mutate of [p=>p.compilerProfile='intersect.xtext.native.v60',p=>p.definitionRecovery.compilerProfile='intersect.xtext.native.v58',p=>p.definitionRecovery.package={},p=>p.mode='inferred']){const p=projectFor(get('multichar'));mutate(p);assert.throws(()=>validateProject(p));}
 for(const compilerProfile of ['intersect.xtext.native.v57','intersect.xtext.native.v58']){const p=projectFor(get('multichar'));p.compilerProfile=compilerProfile;p.definitionRecovery.compilerProfile=compilerProfile;assert.equal(validateProject(p),p);}
});
