import projectedXtext from '../.runtime/intersect-text/fixtures/xtext/projected-prediction/model.xtext?raw';
import naryXtext from '../.runtime/intersect-text/fixtures/xtext/projected-prediction/nary.xtext?raw';
import filteredXtext from '../.runtime/intersect-text/fixtures/xtext/projected-prediction/filtered.xtext?raw';
import discoveryXtext from '../.runtime/intersect-text/fixtures/xtext/projected-prediction/discovery.xtext?raw';
import libraryComposedXtext from '../.runtime/intersect-text/fixtures/xtext/composed-web/library-v52.xtext?raw';
import libraryComposedCatalog from '../.runtime/intersect-text/fixtures/xtext/composed-web/catalog-v52.library?raw';
import libraryComposedLoans from '../.runtime/intersect-text/fixtures/xtext/composed-web/loans.library?raw';
import expressionsComposedXtext from '../.runtime/intersect-text/fixtures/xtext/composed-web/expressions.xtext?raw';
import expressionsComposedCatalog from '../.runtime/intersect-text/fixtures/xtext/composed-web/catalog.kerml?raw';
import expressionsComposedLoans from '../.runtime/intersect-text/fixtures/xtext/composed-web/more.kerml?raw';
import libraryAdvancedStructure from '../.runtime/intersect-text/fixtures/library/library-structure.rcore?raw';
import libraryAdvancedRcore from '../.runtime/intersect-text/fixtures/library/library-behavior.rcore?raw';
import libraryAdvancedXtext from '../.runtime/intersect-text/fixtures/xtext/advanced-web/library.xtext?raw';
import libraryAdvancedCatalog from '../.runtime/intersect-text/fixtures/xtext/advanced-web/catalog.library?raw';
import libraryAdvancedLoans from '../.runtime/intersect-text/fixtures/xtext/advanced-web/loans.library?raw';
import expressionsAdvancedXtext from '../.runtime/intersect-text/fixtures/xtext/advanced-web/expressions.xtext?raw';
import expressionsAdvancedCatalog from '../.runtime/intersect-text/fixtures/xtext/advanced-web/catalog.kerml?raw';
import expressionsAdvancedLoans from '../.runtime/intersect-text/fixtures/xtext/advanced-web/more.kerml?raw';
import argumentStructure from '../.runtime/intersect-text/fixtures/xtext/recursive-fragments/model-structure.rcore?raw';
import argumentXtext from '../.runtime/intersect-text/fixtures/xtext/recursive-fragments/model.xtext?raw';
import argumentRcore from '../.runtime/intersect-text/fixtures/xtext/recursive-fragments/model-behavior.rcore?raw';
import argumentCatalog from '../.runtime/intersect-text/fixtures/xtext/recursive-fragments/example.kerml?raw';
import doubleStructure from '../.runtime/intersect-text/fixtures/xtext/double-datatypes/model-structure.rcore?raw';
import doubleXtext from '../.runtime/intersect-text/fixtures/xtext/double-datatypes/model.xtext?raw';
import doubleRcore from '../.runtime/intersect-text/fixtures/xtext/double-datatypes/model-behavior.rcore?raw';
import doubleCatalog from '../.runtime/intersect-text/fixtures/xtext/double-datatypes/example.kerml?raw';
import recursiveStructure from '../.runtime/intersect-text/fixtures/xtext/recursive-predicates/model-structure.rcore?raw';
import recursiveXtext from '../.runtime/intersect-text/fixtures/xtext/recursive-predicates/model.xtext?raw';
import recursiveRcore from '../.runtime/intersect-text/fixtures/xtext/recursive-predicates/model-behavior.rcore?raw';
import recursiveCatalog from '../.runtime/intersect-text/fixtures/xtext/recursive-predicates/example.model?raw';
import converterStructure from '../.runtime/intersect-text/fixtures/xtext/converter-showcase/model-structure.rcore?raw';
import converterBase from '../.runtime/intersect-text/fixtures/xtext/converter-showcase/base.xtext?raw';
import converterXtext from '../.runtime/intersect-text/fixtures/xtext/converter-showcase/model.xtext?raw';
import converterRcore from '../.runtime/intersect-text/fixtures/xtext/converter-showcase/model-behavior.rcore?raw';
import converterCatalog from '../.runtime/intersect-text/fixtures/xtext/converter-showcase/example.kerml?raw';
import converterLoans from '../.runtime/intersect-text/fixtures/xtext/converter-showcase/more.kerml?raw';
import enumStructure from '../.runtime/intersect-text/fixtures/xtext/enum-showcase/model-structure.rcore?raw';
import enumBase from '../.runtime/intersect-text/fixtures/xtext/enum-showcase/base.xtext?raw';
import enumXtext from '../.runtime/intersect-text/fixtures/xtext/enum-showcase/model.xtext?raw';
import enumRcore from '../.runtime/intersect-text/fixtures/xtext/enum-showcase/model-behavior.rcore?raw';
import enumCatalog from '../.runtime/intersect-text/fixtures/xtext/enum-showcase/example.kerml?raw';
import enumLoans from '../.runtime/intersect-text/fixtures/xtext/enum-showcase/more.kerml?raw';
import predicateStructure from '../.runtime/intersect-text/fixtures/xtext/first-token-predicates/model-structure.rcore?raw';
import predicateXtext from '../.runtime/intersect-text/fixtures/xtext/first-token-predicates/model.xtext?raw';
import predicateRcore from '../.runtime/intersect-text/fixtures/xtext/first-token-predicates/model-behavior.rcore?raw';
import currentStructure from '../.runtime/intersect-text/fixtures/xtext/current-actions/model-structure.rcore?raw';
import currentXtext from '../.runtime/intersect-text/fixtures/xtext/current-actions/model.xtext?raw';
import currentRcore from '../.runtime/intersect-text/fixtures/xtext/current-actions/model-behavior.rcore?raw';
import currentCatalog from '../.runtime/intersect-text/fixtures/xtext/current-actions/example.kerml?raw';
import inferenceStructure from '../.runtime/intersect-text/fixtures/xtext/inferred-datatypes/model-structure.rcore?raw';
import inferenceBase from '../.runtime/intersect-text/fixtures/xtext/inferred-datatypes/base.xtext?raw';
import inferenceXtext from '../.runtime/intersect-text/fixtures/xtext/inferred-datatypes/model.xtext?raw';
import inferenceRcore from '../.runtime/intersect-text/fixtures/xtext/inferred-datatypes/model-behavior.rcore?raw';
import inferenceCatalog from '../.runtime/intersect-text/fixtures/xtext/inferred-datatypes/example.kerml?raw';
import inferenceLoans from '../.runtime/intersect-text/fixtures/xtext/inferred-datatypes/more.kerml?raw';
// Authored demonstration inputs only. Shared Rust/WASM owns all semantics.
import structure from '../.runtime/intersect-text/fixtures/xtext/boolean-keywords/model-structure.rcore?raw';
import xtext from '../.runtime/intersect-text/fixtures/xtext/boolean-keywords/model.xtext?raw';
import rcore_behavior from '../.runtime/intersect-text/fixtures/xtext/boolean-keywords/model-behavior.rcore?raw';
import catalog from '../.runtime/intersect-text/fixtures/xtext/boolean-keywords/example.kerml?raw';
import loans from '../.runtime/intersect-text/fixtures/xtext/boolean-keywords/more.kerml?raw';
export const xtextDefaults = { ecore:'', xtext, rcore_behavior, catalog, loans, rcore:structure };

import dispatchStructure from '../.runtime/intersect-text/fixtures/xtext/parser-dispatch/model-structure.rcore?raw';
import dispatchXtext from '../.runtime/intersect-text/fixtures/xtext/parser-dispatch/model.xtext?raw';
import dispatchRcore from '../.runtime/intersect-text/fixtures/xtext/parser-dispatch/model-behavior.rcore?raw';
import dispatchCatalog from '../.runtime/intersect-text/fixtures/xtext/parser-dispatch/example.kerml?raw';
import dispatchLoans from '../.runtime/intersect-text/fixtures/xtext/parser-dispatch/more.kerml?raw';
import fragmentStructure from '../.runtime/intersect-text/fixtures/xtext/typed-fragments/model-structure.rcore?raw';
import fragmentXtext from '../.runtime/intersect-text/fixtures/xtext/typed-fragments/model.xtext?raw';
import fragmentRcore from '../.runtime/intersect-text/fixtures/xtext/typed-fragments/model-behavior.rcore?raw';
import fragmentCatalog from '../.runtime/intersect-text/fixtures/xtext/typed-fragments/example.kerml?raw';
import fragmentLoans from '../.runtime/intersect-text/fixtures/xtext/typed-fragments/more.kerml?raw';
import punctuationStructure from '../.runtime/intersect-text/fixtures/xtext/punctuation-keywords/model-structure.rcore?raw';
import punctuationXtext from '../.runtime/intersect-text/fixtures/xtext/punctuation-keywords/model.xtext?raw';
import punctuationRcore from '../.runtime/intersect-text/fixtures/xtext/punctuation-keywords/model-behavior.rcore?raw';
import punctuationCatalog from '../.runtime/intersect-text/fixtures/xtext/punctuation-keywords/example.kerml?raw';
import punctuationLoans from '../.runtime/intersect-text/fixtures/xtext/punctuation-keywords/more.kerml?raw';
import qualifiedStructure from '../.runtime/intersect-text/fixtures/xtext/qualified-names/model-structure.rcore?raw';
import qualifiedXtext from '../.runtime/intersect-text/fixtures/xtext/qualified-names/model.xtext?raw';
import qualifiedRcore from '../.runtime/intersect-text/fixtures/xtext/qualified-names/model-behavior.rcore?raw';
import qualifiedCatalog from '../.runtime/intersect-text/fixtures/xtext/qualified-names/example.kerml?raw';
import qualifiedLoans from '../.runtime/intersect-text/fixtures/xtext/qualified-names/more.kerml?raw';
import actionStructure from '../.runtime/intersect-text/fixtures/xtext/simple-actions/model-structure.rcore?raw';
import actionXtext from '../.runtime/intersect-text/fixtures/xtext/simple-actions/model.xtext?raw';
import actionRcore from '../.runtime/intersect-text/fixtures/xtext/simple-actions/model-behavior.rcore?raw';
import actionCatalog from '../.runtime/intersect-text/fixtures/xtext/simple-actions/example.kerml?raw';
import actionLoans from '../.runtime/intersect-text/fixtures/xtext/simple-actions/more.kerml?raw';
import terminalStructure from '../.runtime/intersect-text/fixtures/xtext/terminal-spellings/model-structure.rcore?raw';
import terminalXtext from '../.runtime/intersect-text/fixtures/xtext/terminal-spellings/model.xtext?raw';
import terminalRcore from '../.runtime/intersect-text/fixtures/xtext/terminal-spellings/model-behavior.rcore?raw';
import terminalCatalog from '../.runtime/intersect-text/fixtures/xtext/terminal-spellings/example.kerml?raw';
import terminalLoans from '../.runtime/intersect-text/fixtures/xtext/terminal-spellings/more.kerml?raw';
import lexicalStructure from '../.runtime/intersect-text/fixtures/xtext/explicit-lexical/model-structure.rcore?raw';
import lexicalXtext from '../.runtime/intersect-text/fixtures/xtext/explicit-lexical/model.xtext?raw';
import lexicalRcore from '../.runtime/intersect-text/fixtures/xtext/explicit-lexical/model-behavior.rcore?raw';
import lexicalCatalog from '../.runtime/intersect-text/fixtures/xtext/explicit-lexical/example.kerml?raw';
import lexicalLoans from '../.runtime/intersect-text/fixtures/xtext/explicit-lexical/more.kerml?raw';
import predictiveStructure from '../.runtime/intersect-text/fixtures/xtext/predictive-lexical/model-structure.rcore?raw';
import predictiveXtext from '../.runtime/intersect-text/fixtures/xtext/predictive-lexical/model.xtext?raw';
import predictiveRcore from '../.runtime/intersect-text/fixtures/xtext/predictive-lexical/model-behavior.rcore?raw';
import predictiveCatalog from '../.runtime/intersect-text/fixtures/xtext/predictive-lexical/example.kerml?raw';
import predictiveLoans from '../.runtime/intersect-text/fixtures/xtext/predictive-lexical/more.kerml?raw';
import inheritedStructure from '../.runtime/intersect-text/fixtures/xtext/inherited-grammar/model-structure.rcore?raw';
import inheritedXtext from '../.runtime/intersect-text/fixtures/xtext/inherited-grammar/model.xtext?raw';
import inheritedBase from '../.runtime/intersect-text/fixtures/xtext/inherited-grammar/base.xtext?raw';
import inheritedRcore from '../.runtime/intersect-text/fixtures/xtext/inherited-grammar/model-behavior.rcore?raw';
import inheritedCatalog from '../.runtime/intersect-text/fixtures/xtext/inherited-grammar/example.kerml?raw';
import overrideStructure from '../.runtime/intersect-text/fixtures/xtext/contextual-overrides/model-structure.rcore?raw';
import overrideXtext from '../.runtime/intersect-text/fixtures/xtext/contextual-overrides/model.xtext?raw';
import overrideBase from '../.runtime/intersect-text/fixtures/xtext/contextual-overrides/base.xtext?raw';
import overrideRcore from '../.runtime/intersect-text/fixtures/xtext/contextual-overrides/model-behavior.rcore?raw';
import overrideCatalog from '../.runtime/intersect-text/fixtures/xtext/contextual-overrides/example.kerml?raw';
import showcaseStructure from '../.runtime/intersect-text/fixtures/xtext/kerml-showcase/model-structure.rcore?raw';
import showcaseXtext from '../.runtime/intersect-text/fixtures/xtext/kerml-showcase/model.xtext?raw';
import showcaseBase from '../.runtime/intersect-text/fixtures/xtext/kerml-showcase/base.xtext?raw';
import showcaseRcore from '../.runtime/intersect-text/fixtures/xtext/kerml-showcase/model-behavior.rcore?raw';
import showcaseCatalog from '../.runtime/intersect-text/fixtures/xtext/kerml-showcase/example.kerml?raw';
import showcaseLoans from '../.runtime/intersect-text/fixtures/xtext/kerml-showcase/more.kerml?raw';
async function grammarBundle(structureText,baseText,childText,rcore_behaviorText,namespace) {
  const source=async(uri,kind,text)=>{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
    return {id:{uri,sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')},kind,text,dependencies:[]};
  };
  const model=await source('model.rcore','rcore',structureText), base=await source('base.xtext','xtext',baseText), child=await source('model.xtext','xtext',childText), rcore_behavior=await source('model-behavior.rcore','rcore_behavior',rcore_behaviorText);
  base.dependencies=[model.id];child.dependencies=[model.id,base.id];rcore_behavior.dependencies=[model.id];
  return {bundle:{version:1,sources:[model,base,child,rcore_behavior],namespaces:[]},ecore:model.id,xtext:child.id,rcore_behavior:rcore_behavior.id,namespace};
}
export const xtextExamples = {
  'xtext-projected': {ecore:'',rcore:currentStructure,xtext:projectedXtext,rcore_behavior:currentRcore,catalog:'x y x y x y x y x y $ :: n left',loans:'right',compilerProfile:'intersect.xtext.native.v53'},
  'xtext-nary': {ecore:'',rcore:currentStructure,xtext:naryXtext,rcore_behavior:currentRcore,catalog:'x y x y x y x y x y $ :: n branch7',loans:'branch2',compilerProfile:'intersect.xtext.native.v54'},
  'xtext-filtered': {ecore:'',rcore:currentStructure,xtext:filteredXtext,rcore_behavior:currentRcore,catalog:'( x y x y x y x y x y $ :: n left right )',loans:'( left left right )',compilerProfile:'intersect.xtext.native.v55'},
  'xtext-discovery': {ecore:'',rcore:currentStructure,xtext:discoveryXtext,rcore_behavior:currentRcore,catalog:'g0v0 g13v1 g47v0 left',loans:'g2v1 g46v0 right',compilerProfile:'intersect.xtext.native.v56'},
  'xtext-expressions-composed': {ecore:'',rcore:currentStructure,xtext:expressionsComposedXtext,rcore_behavior:currentRcore,catalog:expressionsComposedCatalog,loans:expressionsComposedLoans,compilerProfile:'intersect.xtext.native.v52'},
  'xtext-library-composed': {ecore:'',rcore:libraryAdvancedStructure,xtext:libraryComposedXtext,rcore_behavior:libraryAdvancedRcore,catalog:libraryComposedCatalog,loans:libraryComposedLoans,compilerProfile:'intersect.xtext.native.v52'},
  'xtext-library-advanced': {ecore:'',rcore:libraryAdvancedStructure,xtext:libraryAdvancedXtext,rcore_behavior:libraryAdvancedRcore,catalog:libraryAdvancedCatalog,loans:libraryAdvancedLoans,compilerProfile:'intersect.xtext.native.v27'},
  'xtext-expressions-advanced': {ecore:'',rcore:currentStructure,xtext:expressionsAdvancedXtext,rcore_behavior:currentRcore,catalog:expressionsAdvancedCatalog,loans:expressionsAdvancedLoans,compilerProfile:'intersect.xtext.native.v27'},
  'xtext-arguments': {ecore:'',rcore:argumentStructure,xtext:argumentXtext,rcore_behavior:argumentRcore,catalog:argumentCatalog,loans:'model atom target call n(target=atom v)',compilerProfile:'intersect.xtext.native.v11'},
  'xtext-double': {ecore:'',rcore:doubleStructure,xtext:doubleXtext,rcore_behavior:doubleRcore,catalog:doubleCatalog,loans:'values 1e-9999',compilerProfile:'intersect.xtext.native.v10'},
  'xtext-recursive': {ecore:'',rcore:recursiveStructure,xtext:recursiveXtext,rcore_behavior:recursiveRcore,catalog:recursiveCatalog,loans:'a b 4',compilerProfile:'intersect.xtext.native.v9'},
  'xtext-converters': {ecore:'',rcore:converterStructure,xtext:converterXtext,rcore_behavior:converterRcore,catalog:converterCatalog,loans:converterLoans,compilerProfile:'intersect.xtext.native.v8',bundle:()=>grammarBundle(converterStructure,converterBase,converterXtext,converterRcore,'urn:intersect:xtext:mini-kerml:converters:1')},
  'xtext-enums': {ecore:'',rcore:enumStructure,xtext:enumXtext,rcore_behavior:enumRcore,catalog:enumCatalog,loans:enumLoans,compilerProfile:'intersect.xtext.native.v7',bundle:()=>grammarBundle(enumStructure,enumBase,enumXtext,enumRcore,'urn:intersect:xtext:mini-kerml:enums:1')},
  'xtext-predicates': {ecore:'',rcore:predicateStructure,xtext:predicateXtext,rcore_behavior:predicateRcore,catalog:'model { a b 12; a b 13; }',loans:'model { a b 4; }',compilerProfile:'intersect.xtext.native.v6'},
  'xtext-current': {ecore:'',rcore:currentStructure,xtext:currentXtext,rcore_behavior:currentRcore,catalog:currentCatalog,loans:'Single = 4;',compilerProfile:'intersect.xtext.native.v5'},
  'xtext-inference': {ecore:'',rcore:inferenceStructure,xtext:inferenceXtext,rcore_behavior:inferenceRcore,catalog:inferenceCatalog,loans:inferenceLoans,compilerProfile:'intersect.xtext.native.v4',bundle:()=>grammarBundle(inferenceStructure,inferenceBase,inferenceXtext,inferenceRcore,'urn:intersect:xtext:mini-kerml:inference:1')},
  'xtext-showcase': {ecore:'',rcore:showcaseStructure,xtext:showcaseXtext,rcore_behavior:showcaseRcore,catalog:showcaseCatalog,loans:showcaseLoans,compilerProfile:'intersect.xtext.native.v3',bundle:()=>grammarBundle(showcaseStructure,showcaseBase,showcaseXtext,showcaseRcore,'urn:intersect:xtext:mini-kerml:showcase:1')},
  'xtext-overrides': {ecore:'',rcore:overrideStructure,xtext:overrideXtext,rcore_behavior:overrideRcore,catalog:overrideCatalog,loans:'package library { class Spare; }',compilerProfile:'intersect.xtext.native.v3',bundle:()=>grammarBundle(overrideStructure,overrideBase,overrideXtext,overrideRcore,'urn:intersect:xtext:mini-kerml:contextual-overrides:1')},
  'xtext-inheritance': {ecore:'',rcore:inheritedStructure,xtext:inheritedXtext,rcore_behavior:inheritedRcore,catalog:inheritedCatalog,loans:'package library { type Spare; }',compilerProfile:'intersect.xtext.native.v2',bundle:()=>grammarBundle(inheritedStructure,inheritedBase,inheritedXtext,inheritedRcore,'urn:intersect:xtext:mini-kerml:inherited-grammar:1')},
  'xtext-prediction': { ecore:'',rcore:predictiveStructure, xtext: predictiveXtext, rcore_behavior: predictiveRcore, catalog: predictiveCatalog, loans: predictiveLoans, compilerProfile: 'intersect.xtext.native.v2' },
  'xtext-lexical': { ecore:'',rcore:lexicalStructure, xtext: lexicalXtext, rcore_behavior: lexicalRcore, catalog: lexicalCatalog, loans: lexicalLoans },
  'xtext-terminals': { ecore:'',rcore:terminalStructure, xtext: terminalXtext, rcore_behavior: terminalRcore, catalog: terminalCatalog, loans: terminalLoans },
  'xtext-actions': { ecore:'',rcore:actionStructure, xtext: actionXtext, rcore_behavior: actionRcore, catalog: actionCatalog, loans: actionLoans },
  'xtext-datatypes': { ecore:'',rcore:qualifiedStructure, xtext: qualifiedXtext, rcore_behavior: qualifiedRcore, catalog: qualifiedCatalog, loans: qualifiedLoans },
  'xtext-punctuation': { ecore:'',rcore:punctuationStructure, xtext: punctuationXtext, rcore_behavior: punctuationRcore, catalog: punctuationCatalog, loans: punctuationLoans },
  'xtext-kerml': xtextDefaults,
  'xtext-fragments': { ecore:'',rcore:fragmentStructure, xtext: fragmentXtext, rcore_behavior: fragmentRcore, catalog: fragmentCatalog, loans: fragmentLoans },
  'xtext-dispatch': { ecore:'',rcore:dispatchStructure, xtext: dispatchXtext, rcore_behavior: dispatchRcore, catalog: dispatchCatalog, loans: dispatchLoans },
};
