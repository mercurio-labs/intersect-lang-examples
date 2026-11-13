// Source/project transport only; Rust owns grammar/model semantics.
import {readFileSync} from 'node:fs';
import {bundleSourceSnapshot} from '../src/bundle-project.js';
export const native=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/full-generated-lexical/native-cases.json',import.meta.url),'utf8'));
export const full=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/full-generated-lexical/observations.json',import.meta.url),'utf8'));
export const before=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/full-generated-lexical/before-v58.json',import.meta.url),'utf8'));
export const positive=JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/full-generated-lexical/positive-resources.json',import.meta.url),'utf8'));
export const profile='intersect.xtext.native.v59';
export const get=id=>native.cases.find(c=>c.id===id);
export function projectFor(c){const compilation=structuredClone(c.compilation);return {format:'intersect.toolkit.project.v3',mode:'language',profile:'default',compilerProfile:profile,structureSource:'rcore',definitionBundle:compilation,definitionRecovery:{compilation:structuredClone(compilation),compilerProfile:profile},definitions:bundleSourceSnapshot(compilation),models:{catalog:'a',loans:'a'},python:'',layout:{version:1,positions:{},zoom:1}};}
