import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundleSourceSnapshot} from '../src/bundle-project.js';
const read=url=>JSON.parse(readFileSync(new URL(url,import.meta.url),'utf8'));
export const profile='intersect.xtext.native.v64';
const originals=read('../.runtime/intersect-text/crates/intersect-web/tests/fixtures/hidden-scope-v64/cases.json').cases;
const upstream=read('./fixtures/hidden-scope-v64/upstream.json').cases;
export const all=originals;
export const executable=originals.filter(c=>c.clean_upstream_generation).map(c=>({...c,...upstream.find(u=>u.id===c.id)}));
assert.equal(executable.length,22);
export const get=id=>{const c=executable.find(c=>c.id===id);assert(c,id);return c;};
export const successes=c=>c.resources.filter(r=>r.expected.accepted);
export function projectFor(c){const values=successes(c),compilation=structuredClone(c.compilation);return {format:'intersect.toolkit.project.v3',mode:'language',profile:'default',compilerProfile:profile,structureSource:'rcore',definitionBundle:compilation,definitionRecovery:{compilation:structuredClone(compilation),compilerProfile:profile},definitions:bundleSourceSnapshot(compilation),models:{catalog:values[0].text,loans:(c.cohort==='reference2'?values.at(-1):values[0]).text},python:'',layout:{version:1,positions:{},zoom:1}};}
