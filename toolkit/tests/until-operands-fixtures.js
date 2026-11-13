// Definition/project transport only. Rust owns every grammar/model operation.
import {readFileSync}from'node:fs';import{bundleSourceSnapshot}from'../src/bundle-project.js';
const read=n=>JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/full-generated-until/'+n,import.meta.url),'utf8'));
export const native=read('native-cases.json'),observations=read('native-observations.json'),before=read('before-calls-v59.json'),beforeFull7=read('before-full7-v59.json');
export const profile='intersect.xtext.native.v60';export const get=id=>native.cases.find(c=>c.id===id);
export function projectFor(c,text='@abc'){const compilation=structuredClone(c.compilation);return{format:'intersect.toolkit.project.v3',mode:'language',profile:'default',compilerProfile:profile,structureSource:'rcore',definitionBundle:compilation,definitionRecovery:{compilation:structuredClone(compilation),compilerProfile:profile},definitions:bundleSourceSnapshot(compilation),models:{catalog:text,loans:text},python:'',layout:{version:1,positions:{},zoom:1}};}
