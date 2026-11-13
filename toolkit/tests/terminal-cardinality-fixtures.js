import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundleSourceSnapshot} from '../src/bundle-project.js';
const read=name=>JSON.parse(readFileSync(new URL('../.runtime/intersect-text/crates/intersect-web/tests/fixtures/terminal-cardinality-v63/'+name,import.meta.url),'utf8'));
export const profile='intersect.xtext.native.v63';
export const originals=read('cases.json').cases;
const context=read('context-addendum.json'),inherited=read('inherited-workflow-addendum.json');
export const executable=[...originals.filter(c=>c.clean_upstream_generation),...context.cases.map(c=>({...c,runtime:inherited.runtime.filter(r=>r.id===c.id).map(r=>({text:r.text,upstream_complete:true,upstream_accepted:r.accepted,positive:r.positive}))}))];
export const get=id=>{const c=executable.find(c=>c.id===id);assert(c,id);return c;};
export const successes=c=>c.runtime.filter(r=>r.upstream_complete&&r.upstream_accepted);
export function projectFor(c){const compilation=structuredClone(c.compilation),text=successes(c)[0].text;return{format:'intersect.toolkit.project.v3',mode:'language',profile:'default',compilerProfile:profile,structureSource:'rcore',definitionBundle:compilation,definitionRecovery:{compilation:structuredClone(compilation),compilerProfile:profile},definitions:bundleSourceSnapshot(compilation),models:{catalog:text,loans:text},python:'',layout:{version:1,positions:{},zoom:1}};}
