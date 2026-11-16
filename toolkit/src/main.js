import {mixedBindingsProject} from './mixed-bindings-example.js';
import {createInferredProviderControls} from './inferred-provider-controls.js';
import {createEntrySelection} from './entry-selection.js';
import './entry-selection.css';
import {bundleSourceSnapshot} from './bundle-project.js';
import {projectInferenceDiagnostics,inferenceDiagnosticRows} from './inference-diagnostics.js';
import {createInferenceProject} from './inference-project.js';
import {sourceText, sourceKey, withSourceEdits} from './source-drafts.js';
import './inference-project.css';
import {graphTypes, graphRelations, circulationCatalog, circulationLoans, duplicateLoans, kermlScript} from './showcase-scenarios.js';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints';
import 'monaco-editor/features/folding/register';
import { exampleScript } from './python-api.js';
import { createPythonPane } from './python-pane.js';
import { LanguageClient } from './client.js';
import { createPackageExport } from './package-export.js';
import { createQueryPane } from './query-pane.js';
import { createModelInterchange } from './model-interchange.js';
import { createStructurePane } from './structure-pane.js';
import { createProjectControls } from './project.js';
import { createBindingsFile } from './bindings-file.js';
import { createIdeShell } from './ide-shell.js';
import { createEditorWindows } from './editor-windows.js';
import { createModelTree } from './model-tree.js';
import { createXtextGuide } from './xtext-guide.js';
import { createRcoreGuide } from './rcore-guide.js';
import { createRunnerExport } from './runner-export.js';
import ecore from '../.runtime/intersect-text/fixtures/library/library.ecore?raw';
import libraryRcore from '../.runtime/intersect-text/fixtures/library/library-project.rcore?raw';
import libraryImplementationsRcore from '../.runtime/intersect-text/fixtures/library/library-implementations.rcore?raw';
import libraryImplementationsPython from '../.runtime/intersect-text/fixtures/library/library-implementations.py?raw';
import libraryRhai from '../.runtime/intersect-text/fixtures/library/library-implementations.rhai?raw';
import xtext from '../.runtime/intersect-text/fixtures/library/library.xtext?raw';
const rcore_behavior = ''; // Behavior is authored inside the combined Rcore starter.
import catalog from '../.runtime/intersect-text/fixtures/library/catalog.library?raw';
import loans from '../.runtime/intersect-text/fixtures/library/loans.library?raw';
import './style.css';
import {rcoreDefaults,prepareRcore,runRcore} from './rcore-example.js';
import {xtextExamples} from './xtext-example.js';
import {showDemoChoices, testCaseChoices} from './demo-choices.js';
import './ide-shell.css';
import './editor-windows.css';
import { createMercurioShell } from './mercurio-shell.js';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
monaco.editor.defineTheme('intersect', {
  base: 'vs-dark', inherit: true,
  rules: [{ token: 'keyword', foreground: 'A8B5FF' }, { token: 'string', foreground: 'E9BE76' }, { token: 'comment', foreground: '929EB5' }],
  colors: { 'editor.background': '#171B27', 'editor.foreground': '#E7EAF3', 'editorLineNumber.foreground': '#78859D', 'editorCursor.foreground': '#A8B5FF', 'editor.lineHighlightBackground': '#202637', 'editor.selectionBackground': '#354367', 'editorWidget.background': '#202637', 'editorWidget.border': '#414D66' },
});
for (const id of ['xtext', 'rcore_behavior', 'rcore', 'rhai', 'intersect-model']) {
  monaco.languages.register({ id });
  monaco.languages.setMonarchTokensProvider(id, {
    tokenizer: { root: [[/\/\/.*$/, 'comment'], [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, 'string'], [/\b(grammar|with|import|as|returns|library|copy|member|loan|to|edition|true|false|rcore|package|version|metamodel|prefix|class|abstract|extends|attr|ref|op|containment|opposite|unordered|nonunique|derived|default|fn|let)\b/, 'keyword'], [/\d+/, 'number'], [/[{}()[\]<>]/, '@brackets']] },
  });
}
const $ = id => document.getElementById(id);
document.querySelector('#app').innerHTML = `
  <header class="topbar"><a class="brand" href="./" aria-label="Intersect home"><span class="brand-mark">⋈</span> intersect<span class="brand-slash">/</span><span class="brand-label">toolkit</span></a><div class="runtime"><span class="dot"></span><span id="runtime-label">Starting native runtime</span><span class="badge">BOUNDED PREVIEW</span></div></header>
  <main>
    <section class="intro"><div><div class="eyebrow">STRUCTURE · SYNTAX · SEMANTICS</div><h1>Design a model. Put it to the test.</h1><p>Edit Rcore, explore its diagram, and test instances with Python.</p></div><div class="actions"><button id="compile" class="primary" disabled><span>▷</span> Compile language <kbd>Ctrl ↵</kbd></button></div></section>
    <section class="compile-strip" aria-live="polite"><div><span id="status-dot" class="dot muted"></span><strong id="compile-status">Loading WebAssembly…</strong><span id="compile-detail">All compilation and model execution happen in your browser.</span></div><button id="restart" class="text-button">Restart runtime</button></section>
    <section class="workspace">
      <article class="panel definitions"><div class="panel-heading"><div><span class="step">01</span><h2>Language definition</h2></div><span class="small-label">LIBRARY EXAMPLE</span></div><div class="tabs" role="tablist" aria-label="Definition editors"><button class="tab selected" role="tab" aria-selected="true" data-definition="rcore">Containment<span>Structure</span></button><button class="tab" role="tab" aria-selected="false" data-definition="xtext">Xtext<span>Syntax</span></button></div><div class="file-path"><span id="definition-file">model.rcore</span><span id="definition-state">Ready to compile</span></div><div id="definition-editor" class="editor definition-editor" aria-label="Language definition editor"></div><div class="panel-footer"><span id="definition-hint">Classes, attributes, and relationships.</span><span>UTF-8</span></div></article>
      <article class="panel model"><div class="panel-heading"><div><span class="step">02</span><h2>Try your language</h2></div><span id="active-revision" class="small-label">NO ACTIVE PACKAGE</span></div><div class="tabs" role="tablist" aria-label="Model documents"><button class="tab selected" role="tab" aria-selected="true" data-model="catalog">catalog.library</button><button class="tab" role="tab" aria-selected="false" data-model="loans">loans.library</button></div><div class="file-path"><span id="model-file">catalog.library</span><span>Completion · Hover · Go to definition</span></div><div id="model-editor" class="editor model-editor" aria-label="Model text editor"></div><div class="panel-footer"><span id="model-status">Waiting for a language package</span><span>Monaco + LSP</span></div></article>
    </section>
    <section class="results">
      <article class="panel inspector"><div class="panel-heading"><div><span class="step">03</span><h2>Intersect Model</h2><span id="element-count" class="count">0 elements</span></div><button id="export" class="text-button" disabled>Export JSON ↓</button></div><div id="entry-controls" class="entry-controls"></div><div id="entry-results" class="entry-results" hidden></div><div id="model-tree" class="model-tree"><div class="empty">Compile a language to inspect its model.</div></div></article>
      <article class="panel diagnostics"><div class="panel-heading"><div><h2>Diagnostics</h2><span id="diagnostic-count" class="count">0</span></div><span class="small-label">DEFINITIONS + MODELS</span></div><div id="diagnostic-list" class="diagnostic-list" aria-live="polite"><div class="empty">Compiler and language diagnostics appear here.</div></div></article>
    </section>
    <footer class="page-footer"><span><span class="dot"></span> Local execution. No Java or compilation service.</span><details><summary>Supported preview profile</summary><p>One EPackage; EClasses with single inheritance; EString, EInt and EBoolean; stored references, containment, opposites and defaults. Xtext sequences, alternatives, assignments, repetitions and ID cross-references. Rcore v1 supplies count and no_incoming derivations and max_incoming validation. Unique-name scope spans all model documents in the project. Completion is a keyword/name inventory, not grammar-position prediction. Unsupported definitions are rejected. No full Ecore, Xtext or SysML conformance is claimed.</p></details></footer>
  </main>`;

// Major workflow tabs preserve editor models while changing the visible activity.
const definitionPage = document.createElement('section'); definitionPage.id = 'definition-page';
definitionPage.append(document.querySelector('.definitions'));
definitionPage.insertAdjacentHTML('afterbegin', '<div id="project-controls" class="toolkit-project-bar"></div><div class="toolkit-definition-options"><label for="definition-mode">Definition mode <select id="definition-mode"><option value="language">Rcore + Xtext language</option><option value="structure">Rcore structure · no grammar</option><option value="inferred">Xtext · inferred structure</option></select></label><span id="definition-mode-hint">Compile structure, syntax, and semantics together.</span></div>');
const usagePage = document.querySelector('.workspace'); usagePage.id = 'usage-page'; usagePage.dataset.usage = ''; usagePage.hidden = true;
let ide, windows;
usagePage.before(definitionPage);
definitionPage.insertAdjacentHTML('beforebegin', '<nav class="tabs major-tabs" role="tablist" aria-label="Metamodel"><span class="activity-label" aria-hidden="true">Metamodel:</span><button role="tab" class="tab selected" data-activity="definition" aria-selected="true">Define</button><button role="tab" class="tab" data-activity="usage" aria-selected="false">Test</button></nav>');
document.querySelector('.inspector').dataset.usage = ''; document.querySelector('.inspector').hidden = true;
function selectActivity(name) {
  definitionPage.hidden = name !== 'definition';
  document.querySelectorAll('[data-usage]').forEach(node => node.hidden = name !== 'usage' || (node===behaviorPanel && !rcoreExample));
  document.querySelectorAll('[data-activity]').forEach(b => { const selected = b.dataset.activity === name; b.classList.toggle('selected', selected); b.setAttribute('aria-selected', String(selected)); });
  ide?.activity(name);
}
document.querySelectorAll('[data-activity]').forEach(b => b.onclick = () => selectActivity(b.dataset.activity));
const libraryDefaults = { ecore, xtext, rcore_behavior, catalog, loans, rcore:libraryRcore };
const libraryImplementationDefaults = { ...libraryDefaults, rcore:libraryImplementationsRcore };
let libraryImplementations = false;
let defaults = libraryDefaults;
let rcoreExample = false;
let xtextExample = false;
let compilerProfile = 'intersect.workbench.v1';
let activeRcore = null;
let exampleLoading = false;
let generatingEcore = false;
document.querySelector('.actions').insertAdjacentHTML('afterbegin','<label>Example <select id="example"></select></label>');
showDemoChoices($('example'));
const behaviorPanel = document.createElement('article'); behaviorPanel.id='rcore-behavior-panel'; behaviorPanel.className='panel rcore-panel'; behaviorPanel.dataset.usage=''; behaviorPanel.hidden=true;
behaviorPanel.innerHTML='<div class="panel-heading"><h2>Rcore behavior</h2><label>Seed type <input id="rcore-seed" value="A" size="10"></label><label><input id="rcore-observe" type="checkbox" checked> Observe reads</label><button id="rcore-run" class="primary">Run reachability</button></div><p id="rcore-result" role="status">Compile the Rcore example, then run its behavior on the current model.</p><details><summary>Operation binding and implementation</summary><pre id="rcore-binding">Compile to inspect the exact declaration and implementation.</pre></details><details><summary>Observed reads and validation</summary><p id="rcore-read-status">Run behavior to inspect its actual reads.</p><pre id="rcore-reads"></pre><p>Stored values and inverse queries only. This is not a complete dependency set.</p></details><p>Explicit specialization projection. No full KerML qualification is claimed.</p>';
document.querySelector('.results').before(behaviorPanel);
const definitionModels = Object.fromEntries(['ecore', 'xtext', 'rcore_behavior', 'rcore'].map(id => [id, monaco.editor.createModel(defaults[id], id === 'ecore' ? 'plaintext' : id, monaco.Uri.parse(`file:///definitions/library.${id}`))]));
const modelModels = Object.fromEntries(['catalog', 'loans'].map(id => [id, monaco.editor.createModel(defaults[id], 'intersect-model', monaco.Uri.parse(`file:///models/${id}.library`))]));
const editorOptions = { automaticLayout: true, fontSize: 13, fontFamily: 'Consolas, "Liberation Mono", monospace', lineHeight: 22, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 16, bottom: 16 }, tabSize: 2, roundedSelection: false, renderLineHighlight: 'line', wordWrap: 'on', fixedOverflowWidgets: true, overviewRulerLanes: 0, stickyScroll: { enabled: false } };
const definitionEditor = monaco.editor.create($('definition-editor'), { ...editorOptions, model: definitionModels.rcore, ariaLabel: 'Definition source', folding: true, showFoldingControls: 'always' });
document.querySelector('.definitions .panel-footer').insertAdjacentHTML('beforeend', '<div id="ecore-folding" class="definition-actions"><button id="ecore-collapse" class="text-button">Collapse all</button><button id="ecore-expand" class="text-button">Expand all</button></div>');
$('ecore-collapse').onclick = () => (activeDefinition === 'xtext' ? xtextEditor : definitionEditor).getAction('editor.foldAll').run();
$('ecore-expand').onclick = () => (activeDefinition === 'xtext' ? xtextEditor : definitionEditor).getAction('editor.unfoldAll').run();
document.querySelector('.definitions .file-path').insertAdjacentHTML('beforebegin', '<nav id="ecore-views" class="tabs" aria-label="Structure view"><button class="tab selected" data-ecore-view="structure" aria-pressed="true">Class diagram</button><button class="tab" data-ecore-view="source" aria-pressed="false">Rcore source</button><button class="tab" data-ecore-view="behavior" aria-pressed="false" hidden>Behavior file</button></nav><div id="structure-editor"></div>');
let ecoreView = 'structure';
const xtextGuide = createXtextGuide(document.querySelector('.definitions'));
const xtextEditor = monaco.editor.create(xtextGuide.editorHost, {...editorOptions, model:definitionModels.xtext, ariaLabel:'Xtext source', folding:true});
const rcoreGuide = createRcoreGuide(document.querySelector('.definitions'));
rcoreGuide.editorHost.append($('definition-editor'));
const behaviorFileCommand = document.createElement('button');
behaviorFileCommand.id = 'open-behavior-source'; behaviorFileCommand.type = 'button';
behaviorFileCommand.textContent = 'Open separate behavior source'; behaviorFileCommand.hidden = true;
behaviorFileCommand.onclick = () => { selectActivity('definition'); selectDefinition('rcore_behavior'); };

const rcoreSourceHost=document.createElement('div'); rcoreSourceHost.className='rcore-source-view'; rcoreSourceHost.hidden=true; document.querySelector('.definitions').append(rcoreSourceHost);
function updateDefinitionView() {
  rcoreSourceHost.hidden = true;
  const sourceVisible = ecoreView === 'source' || ecoreView === 'behavior';
  const xtextVisible = ecoreView === 'xtext';
  bindings.show(ecoreView === 'rhai');
  inferenceHost.hidden=definitionMode!=='inferred'||!xtextVisible;
  generatedHost.hidden=definitionMode!=='inferred'||xtextVisible||activeDefinition==='rcore_behavior';
  document.querySelector('[data-ecore-view="source"]').textContent=definitionMode==='inferred'?'Generated Rcore':'Rcore source';
  $('structure-editor').hidden = false;
  $('definition-editor').hidden = !sourceVisible;
  $('ecore-views').hidden = false;
  $('ecore-history').hidden = false;
  $('ecore-folding').hidden = false;
  $('ecore-folding').style.visibility = (sourceVisible || xtextVisible) ? 'visible' : 'hidden';
  $('ecore-folding').inert = !(sourceVisible || xtextVisible);
  document.querySelector('.structure-tree').hidden = false;
  xtextGuide.setActive(activeDefinition === 'xtext');
  rcoreGuide.setActive(sourceVisible && activeDefinition !== 'xtext');
  // A separate imported file stays available through File; it never adds a tab automatically.
  behaviorFileCommand.hidden = !definitionModels.rcore_behavior.getValue().trim();
  document.querySelector('[data-ecore-view="behavior"]').hidden = activeDefinition !== 'rcore_behavior';
  const editorParent = document.querySelector('.structure-diagram-panel');
  if (rcoreGuide.editorHost.parentElement.parentElement !== editorParent) editorParent.append(rcoreGuide.editorHost.parentElement);
  structure.setView(ecoreView === 'structure' ? 'structure' : 'source');
  document.querySelectorAll('[data-ecore-view]').forEach(button => {
    const selected = button.dataset.ecoreView === ecoreView;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  $('definition-undo').disabled=definitionMode==='inferred'&&!xtextVisible&&activeDefinition!=='rcore_behavior';
  $('definition-redo').disabled=$('definition-undo').disabled;
  definitionEditor.layout(); xtextEditor.layout();
}

document.querySelectorAll('[data-ecore-view]').forEach(button => button.onclick = () => { ecoreView = button.dataset.ecoreView; selectDefinition(button.dataset.ecoreView === 'behavior' ? 'rcore_behavior' : 'rcore'); });
$('ecore-views').insertAdjacentHTML('beforeend', '<div id="ecore-history" class="definition-actions"><button id="definition-undo" class="text-button">Undo</button><button id="definition-redo" class="text-button">Redo</button></div>');
$('definition-undo').onclick = () => (ecoreView === 'rhai' ? bindings.model : activeDefinition==='xtext'?xtextEditor.getModel():definitionModels[activeDefinition === 'rcore_behavior' ? 'rcore_behavior' : 'rcore']).undo();
$('definition-redo').onclick = () => (ecoreView === 'rhai' ? bindings.model : activeDefinition==='xtext'?xtextEditor.getModel():definitionModels[activeDefinition === 'rcore_behavior' ? 'rcore_behavior' : 'rcore']).redo();
let modelEditor = monaco.editor.create($('model-editor'), { ...editorOptions, model: modelModels.catalog, ariaLabel: 'Model source' });
let client;
$('model-tree').insertAdjacentHTML('afterend', '<div id="model-properties"></div>');
const modelTree = createModelTree($('model-tree'), $('model-properties'), () => ide?.showModelDetails(), uri => {
  const doc = windows?.documents.find(d => d.model?.uri.toString() === uri);
  return doc?.displayName || doc?.name || uri.split('/').at(-1) || uri;
});
const interchange = createModelInterchange(() => client, message => status('Model interchange failed', message, true));
const python = createPythonPane(monaco, editorOptions, () => client);
async function navigateQuery(id) {
  const observed=latestModel, observedClient=client;
  if (observed?.modelOrigin === 'import') return;
  let element = observed?.model.elements.find(e => e.id === id);
  if (!element) return;
  if(observed.documentAnalysisValid!==undefined){
    if(!observed.documentAnalysisValid||observed.overlay||!observedClient)return;
    const models=Object.entries(observed.versions).map(([uri,version])=>({uri,version,model:monaco.editor.getModel(monaco.Uri.parse(uri))}));
    const current=()=>client===observedClient&&latestModel===observed&&models.every(({uri,version,model})=>model&&monaco.editor.getModel(monaco.Uri.parse(uri))===model&&model.getVersionId()===version);
    if(!current())return;
    try{
      const state=await observedClient.request('intersect/inspect');
      if(!current()||state.generation!==observed.generation||state.analysisVersion!==observed.analysisVersion)return;
      const result=await observedClient.request('intersect/documentElementSource',{element:id,uri:element.resource,version:observed.versions[element.resource],versions:observed.versions,interfaceRevision:state.interfaceRevision,generation:observed.generation,analysisVersion:observed.analysisVersion});
      if(!current()||result.interfaceRevision!==state.interfaceRevision||result.generation!==observed.generation||result.analysisVersion!==observed.analysisVersion||result.version!==observed.versions[element.resource])return;
      element=result.object;
    }catch{return;}
  }
  const key = Object.keys(modelModels).find(k => modelModels[k].uri.toString() === element.resource);
  if (!key) return;
  selectActivity('usage'); selectModel(key);
  const position = utf8Position(modelModels[key], element.start);
  modelEditor.setPosition(position); modelEditor.revealPositionInCenter(position); modelEditor.focus();
}
const queries = createQueryPane(() => client, navigateQuery);
document.querySelector('.definitions .panel-heading .small-label').outerHTML = '<button id="export-package" class="text-button" disabled>Export language ZIP ↓</button>';
$('export-package').onclick = createPackageExport(() => client, sources => Object.entries(definitionModels).filter(([key]) => key !== 'ecore').some(([key,model]) => sourceText(model) !== (activeSources?.[key] ?? sources[key])) || (definitionMode==='inferred' && (inferred.hasPendingEdits(activeInferenceDraft)||inferred.providerDraft()!==activeProviderDraft)));
let ready = false;
let compiling = false;
let activeRevision = 0;
let definitionEpoch = 0;
let runtimeEpoch = 0;
let definitionDiagnostics = [];
let definitionBundle = null;
const modelDiagnostics = new Map();
let latestModel = null;
let latestPackage = null;
let activeSources = null;
let activeInferenceDraft = null;
let activeProviderDraft = null;
let activeProviderContext = false;
let sourceReplacement = false;
// Original successful source authority; durable project recipes never contain IR.
let lastSourceActivation = null;
let activeAuthoredRcore = null;
let activeDefinition = 'rcore';
let definitionMode = 'language';
let structureSource = 'rcore';
const entries = createEntrySelection({host:$('entry-controls'),results:$('entry-results'),choose:async rule=>{
  if(!ready||compiling)throw new Error('Wait for language compilation before choosing an entry.');
  const choosingClient=client,recovery=lastSourceActivation,before=await choosingClient.request('intersect/inspect');
  const result=await choosingClient.request('intersect/selectEntry',{entry_rule:rule,interfaceRevision:before.interfaceRevision});
  if(client!==choosingClient)return;
  if(recovery&&lastSourceActivation===recovery){recovery.entryRule=result.entry_rule;if(recovery.inference)inferred.captureSuccessfulRecovery({ok:true,inference:recovery.inference,...(recovery.inference_context?{inference_context:recovery.inference_context}:{}),entryRule:result.entry_rule});}
}});
async function refreshEntryCatalog(currentClient=client){
  const pkg=latestPackage;
  if(!pkg?.grammar){entries.reset();entries.enabled(false);return;}
  try{const catalog=await currentClient.request('intersect/entryRules');if(client===currentClient&&latestPackage===pkg)entries.catalog(catalog);}
  catch(error){if(client===currentClient&&latestPackage===pkg)entries.unavailable(`Entry selection unavailable: ${error.message}`);}
}

const structure = createStructurePane({
  host: $('structure-editor'), model: definitionModels.ecore,
  request: (method, params) => {
    if (!ready) return Promise.reject(new Error('Starting the definition runtime…'));
    if(definitionMode==='inferred'&&method==='intersect/definitionInspect')return Promise.resolve(inferred.previewDocument(params.source));
    return client.request(method, params);
  },
  readOnly: () => true, autoRefresh: false,
  onSource: source => {
    const model = definitionModels.ecore;
    model.pushStackElement();
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: source }], () => null);
    model.pushStackElement();
  },
});
const inferenceHost=document.createElement('div');inferenceHost.id='inference-source-controls';inferenceHost.className='inference-source-controls';inferenceHost.hidden=true;
xtextGuide.editorHost.parentElement.before(inferenceHost);
const generatedHost=document.createElement('div');generatedHost.id='inference-generated-controls';generatedHost.className='inference-source-controls';generatedHost.hidden=true;
$('definition-editor').before(generatedHost);
const inferred=createInferenceProject({monaco,primary:definitionModels.xtext,editor:xtextEditor,host:inferenceHost,generatedHost,
  changed:()=>{definitionEpoch++;definitionDiagnostics=[];inferred.diagnostics([]);$('definition-state').textContent='Uncompiled changes';structure.invalidate('Inference sources changed. Compile to rebuild the generated preview.');showDiagnostics();},
  onGenerated:()=>{$('save-rcore').disabled=!sourceText(inferred.generatedModel);void refreshStructure();},
});
const providerHost=document.createElement('div');providerHost.id='inference-provider-controls';providerHost.className='inference-source-controls';providerHost.hidden=true;inferenceHost.after(providerHost);
const providers=createInferredProviderControls({host:providerHost,enabled:()=>inferred.providerDraft()!==null,
  draft:()=>inferred.providerDraft(),setDraft:value=>inferred.setProviderDraft(value),
  clear:()=>{inferred.restoreProviders(null);},
  prepare:()=>inferred.prepare(sourceText(definitionModels.xtext),{providerMode:true}),
  request:(method,params)=>{if(!ready)throw new Error('Wait for the native runtime.');return client.request(method,params);},
  stamp:()=>JSON.stringify([definitionEpoch,runtimeEpoch]),changed:()=>{definitionEpoch++;$('definition-state').textContent='Uncompiled changes';},
});
function fenceSourceRuntime(){
  definitionEpoch++;runtimeEpoch++;providers.close();providers.showActive(null);ready=false;
  const previous=client;client=null;previous?.dispose();lastSourceActivation=null;
}
inferred.generatedModel.onDidChangeContent(()=>{if(definitionMode==='inferred')$('save-rcore').disabled=!sourceText(inferred.generatedModel);});
function setDefinitionMode(mode) {
  definitionMode = ['structure','inferred'].includes(mode) ? mode : 'language';
  inferred.setActive(definitionMode==='inferred');
  providers.setActive(definitionMode==='inferred');
  $('save-rcore').textContent=definitionMode==='inferred'?'Save generated Rcore':'Save Rcore';
  $('save-rcore').disabled=definitionMode==='inferred'&&!sourceText(inferred.generatedModel);
  $('definition-mode').value = definitionMode;
  const xtextTab = document.querySelector('[data-definition="xtext"]');
  xtextTab.disabled = definitionMode === 'structure';
  xtextTab.title = xtextTab.disabled ? 'Xtext is unavailable in structure-only mode.' : '';
  if (xtextTab.disabled && activeDefinition === 'xtext') selectDefinition('rcore');
  modelSamplesMenu.hidden = !!xtextExample || definitionMode === 'structure';
  if (windows) windows.setMode(definitionMode);
  else document.querySelector('.model').hidden = definitionMode === 'structure';
  $('definition-mode-hint').textContent = definitionMode === 'structure' ? 'Create instances with Python. Semantic rules are optional; Xtext and model text are inactive.' : definitionMode==='inferred'?'Edit original Xtext sources. Compile to infer structure; generated Rcore is a read-only preview.':'Compile structure, syntax, and semantics together.';
  definitionEditor.setModel(definitionMode==='inferred'&&activeDefinition!=='rcore_behavior'?inferred.generatedModel:definitionModels[activeDefinition==='rcore_behavior'?'rcore_behavior':'rcore']);
  definitionEditor.updateOptions({readOnly:definitionMode==='inferred'&&activeDefinition!=='rcore_behavior'});
  updateDefinitionView();
  definitionEpoch += 1;
  $('definition-state').textContent = 'Uncompiled changes';
  if(ready)void refreshStructure();
}
$('definition-mode').onchange = () => {
  const clearProviders=$('definition-mode').value!=='inferred'&&(definitionMode==='inferred'||inferred.providerDraft()!==null||activeProviderContext);
  setDefinitionMode($('definition-mode').value);
  if(clearProviders){inferred.restoreProviders(null);inferred.restoreRecovery(null);lastSourceActivation=null;providers.refresh();void start({compile:false,recover:false});}
  if(definitionMode==='structure')entries.restore(null);
  status('Definition mode changed', 'Compile to activate this definition mode.');
};
const bindings = createBindingsFile({ monaco, editorOptions,
  definitions: () => ({rcore:definitionModels.rcore.getValue(),rcore_behavior:definitionModels.rcore_behavior.getValue()}),
  open: () => { selectActivity('definition'); ecoreView = 'rhai'; selectDefinition('rcore'); },
  changed: () => { definitionEpoch++; $('definition-state').textContent = 'Uncompiled changes'; },
  inspectModel: async structure => {
    if (activeAuthoredRcore !== structure) throw new Error('The model and implementation use different definitions. Compile the project first.');
    const result = await client.request('intersect/inspect');
    if (!result.evaluation || result.evaluation.diagnostics.length) throw new Error('Create a valid model in Test before calling a model query.');
    return result.evaluation.model.elements.map(e => ({id:e.id,class:e.class,values:e.values}));
  },
});
const project = createProjectControls({
  getResourceState:()=>latestModel?.resourceState??null,
  getProviderDraft:()=>definitionMode==='inferred'?inferred.providerSnapshot():null,
  setProviderDraft:value=>{inferred.restoreProviders(value);providers.refresh();},
  getInferenceRecovery:()=>definitionMode==='inferred'?inferred.recovery():null,
  setInferenceRecovery:value=>{inferred.restoreRecovery(value);if(value)lastSourceActivation=structuredClone(value);else if(lastSourceActivation?.inference)lastSourceActivation=null;},
  beforeReplace:value=>{
    sourceReplacement=definitionMode==='inferred'||value?.mode==='inferred'||inferred.providerDraft()!==null||activeProviderContext;
    if(sourceReplacement)fenceSourceRuntime();
  },
  loaded:async(value,{reason,resourceState})=>{
    providers.refresh();
    if(resourceState){
      sourceReplacement=false;await start({compile:true});
      const snapshot=await client.request('intersect/inspect');
      await client.request('intersect/resources',{action:'restore',state:resourceState,interfaceRevision:snapshot.interfaceRevision,generation:snapshot.generation});
    }else if(sourceReplacement){sourceReplacement=false;if(reason==='load')await start({compile:Boolean(value.definitionProviderDraft||value.definitionInferenceRecovery)});else if(reason==='openRcore')await start({compile:false,recover:false});}
  },
  getEntryRule:()=>entries.rule(),setEntryRule:value=>entries.restore(value),
  getBindings: () => bindings.snapshot(), restoreBindings: state => bindings.restore(state),
  getBundle: () => definitionMode==='inferred'?null:definitionBundle, setBundle: value => { definitionBundle = value; },
  getGeneratedRcore:()=>sourceText(inferred.generatedModel),
  getRecovery:()=>definitionMode==='language'&&lastSourceActivation?.compilation&&lastSourceActivation.compilerProfile===compilerProfile?{compilation:lastSourceActivation.compilation,compilerProfile:lastSourceActivation.compilerProfile,...(lastSourceActivation.entryRule!=null?{entryRule:lastSourceActivation.entryRule}:{})}:null,
  setRecovery:value=>{if(value)lastSourceActivation=structuredClone(value);else if(lastSourceActivation?.compilation)lastSourceActivation=null;},
  getInference:()=>definitionMode==='inferred'?inferred.snapshot():null,setInference:value=>{inferred.restore(value);if(definitionMode==='inferred')definitionModels.ecore.setValue('');},
  host: $('project-controls'), definitionModels, modelModels, python,
  getCompilerProfile: () => definitionMode==='inferred'?'intersect.xtext.native.v56':compilerProfile, setCompilerProfile: profile => { compilerProfile = profile; },
  getProfile: () => rcoreExample ? 'rcore' : xtextExample || (libraryImplementations ? 'library-implementations' : 'default'), setProfile: profile => setRcorePresentation(profile === 'rcore', Object.hasOwn(xtextExamples, profile) ? profile : false, profile === 'library-implementations'),
  getMode: () => definitionMode, setMode: setDefinitionMode, structure,
  getStructureSource: () => structureSource, setStructureSource: value => {structureSource = value;},
  getWindows: () => windows?.snapshot(), restoreWindows: state => windows?.restore(state),
  cancelScripts: () => { bindings.cancel(); return Promise.all(pythonPanes().map(p => p.cancel())); },
  sample: { definitions: { ecore, xtext, rcore_behavior, rcore:libraryRcore }, models: { catalog, loans }, python: exampleScript },
  kerml: { definitions: rcoreDefaults, models: { catalog: rcoreDefaults.catalog, loans: rcoreDefaults.loans }, python: kermlScript },
  created: async kind => {
    activeRcore = null; $('rcore-result').textContent = 'Compile the Rcore example, then run its behavior on the current model.'; $('rcore-read-status').textContent = 'Run behavior to inspect its actual reads.'; $('rcore-reads').textContent = ''; $('rcore-binding').textContent = 'Compile to inspect the exact declaration and implementation.'; $('rcore-seed').value = 'A'; $('rcore-observe').checked = true;
    python.clearProject(); python.transactions.clear(); queries.clearDraft();
    await start({ compile: kind !== 'empty', recover: false });
  },
  request: (method, params) => client.request(method, params),
  changed: () => { definitionBundle = null; inferred.clear(); selectActivity('definition'); selectDefinition(definitionMode==='inferred'?'xtext':'rcore'); ecoreView = definitionMode==='inferred'?'xtext':'structure'; updateDefinitionView(); },
});
$('project-controls').append(behaviorFileCommand);
const preparedDraftLink=document.createElement('a');preparedDraftLink.href='/prepared-draft.html';preparedDraftLink.textContent='KerML drafts · unvalidated';
const libraryTextLink=document.createElement('a');libraryTextLink.href='/library-text.html';libraryTextLink.textContent='Library · model ↔ text';
const modelTextLink=document.createElement('a');modelTextLink.href='/model-text.html';modelTextLink.textContent='Xtext · model ↔ text';
$('project-controls').append(preparedDraftLink,libraryTextLink,modelTextLink);
const testCasesMenu = document.createElement('details'); testCasesMenu.className = 'ide-test-cases';
testCasesMenu.innerHTML = '<summary>Language test cases</summary>';
for (const [id,label] of testCaseChoices) {
  const button = document.createElement('button'); button.type = 'button';
  button.dataset.loadExample = id; button.textContent = label;
  button.onclick = () => loadExample(id); testCasesMenu.append(button);
}
$('project-controls').append(testCasesMenu);
updateDefinitionView();

function escapeHtml(text) { return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function status(title, detail, error = false) { $('compile-status').textContent = title; $('compile-detail').textContent = detail; $('status-dot').className = `dot ${error ? 'error' : ''}`; }
function definitionFilename(name) {
  if(definitionMode==='inferred'&&name==='rcore')return 'inferred.generated.rcore';
  if (xtextExample) return `mini-kerml.${name}`;
  if (name === 'rcore' && !rcoreExample) return 'model.rcore';
  return rcoreExample ? ({rcore:'specialization.rcore',ecore:'specialization.generated.ecore',xtext:'specialization.xtext',rcore_behavior:'specialization-behavior.rcore'}[name] || name) : `library.${name}`;
}
function selectDefinition(name) {
  activeDefinition = name; definitionEditor.setModel(definitionMode==='inferred'&&name!=='rcore_behavior'?inferred.generatedModel:definitionModels[name === 'rcore_behavior' ? 'rcore_behavior' : 'rcore']);
  if (name === 'rcore_behavior') ecoreView = 'behavior';
  if (name === 'rcore' && ['xtext','behavior'].includes(ecoreView)) ecoreView = 'source';
  if (name === 'xtext') ecoreView = 'xtext';
  document.querySelectorAll('[data-definition]').forEach(b => { const selected = b.dataset.definition === name || (b.dataset.definition === 'rcore' && name === 'xtext'); b.classList.toggle('selected', selected); b.setAttribute('aria-selected', String(selected)); });
  $('definition-file').textContent = definitionFilename(name);
  definitionEditor.updateOptions({readOnly:definitionMode==='inferred'&&name!=='rcore_behavior'});
  $('ecore-folding').hidden = name !== 'rcore';
  $('definition-hint').textContent = { ecore: 'Classes, attributes, and relationships.', xtext: 'Grammar rules construct the same checked model.', rcore_behavior: 'Typed rules. Deterministic evaluation. No arbitrary code.', rcore:'Author classes, attributes, relationships and operations in Rcore.' }[name];
  if(definitionMode==='inferred'&&name==='rcore')$('definition-hint').textContent='Generated by the shared compiler. Edit original sources in the Xtext view.';
  updateDefinitionView();
}
function selectModel(name) {
  if (windows) { windows.open(name); return; }
  modelEditor.setModel(modelModels[name]); $('model-file').textContent = rcoreExample ? (name==='catalog'?'types.demo':'relations.demo') : `${name}.library`;
  document.querySelectorAll('[data-model]').forEach(b => { const selected = b.dataset.model === name; b.classList.toggle('selected', selected); b.setAttribute('aria-selected', String(selected)); });
}
document.querySelectorAll('[data-definition]').forEach(b => b.onclick = () => selectDefinition(b.dataset.definition));
document.querySelectorAll('[data-model]').forEach(b => b.onclick = () => selectModel(b.dataset.model));
function utf8Position(model, offset) {
  return model.getPositionAt(new TextDecoder().decode(new TextEncoder().encode(model.getValue()).slice(0, offset)).length);
}
function showDiagnostics() {
  const all = [...definitionDiagnostics.flatMap(d => d.inferredDiagnostic?inferenceDiagnosticRows([d]):[{...d,label:definitionFilename(d.source)}]), ...[...modelDiagnostics].flatMap(([uri, ds]) => ds.map(d => ({ ...d, source: uri, label: uri.split('/').at(-1) })))];
  $('diagnostic-count').textContent = String(all.length);
  $('diagnostic-list').innerHTML = all.length ? all.map((d, i) => `<button class="diagnostic" data-index="${i}"><span class="diagnostic-icon">!</span><span><strong>${escapeHtml(d.label)}</strong><span>${escapeHtml(d.message)}</span></span></button>`).join('') : `<div class="all-clear"><span>✓</span><div><strong>${activeRevision ? 'All checks passed' : 'No diagnostics'}</strong><p>${activeRevision ? 'The current models satisfy the active profile.' : 'Compile the definitions to begin.'}</p></div></div>`;
  $('diagnostic-list').querySelectorAll('button').forEach(b => b.onclick = () => {
    const d = all[Number(b.dataset.index)];
    if(d.ambiguousSource){status('Choose a source revision', 'This native diagnostic identifies a URI shared by several retained revisions. Choose the exact source in the source picker; no revision-specific marker has been inferred.',true);return;}
    if(d.inferredDiagnostic){
      if(!d.sourceId&&!d.legacySourceId){status(d.scope==='generated'?'Generated diagnostic':'Definition diagnostic',d.scope==='generated'?'Choose an authored location below. Every native correspondence is retained.':d.scope==='context'?'This diagnostic identifies the request context, not an authored culprit.':'Native source ownership is unavailable; no source marker or navigation was inferred.',true);return;}
      selectActivity('definition');selectDefinition('xtext');
      if(!inferred.focusDiagnostic(d))status('Source revision unavailable','This diagnostic belongs to a different source snapshot. Compile the current sources.',true);
      return;
    }
    if (d.source === 'ecore') { selectActivity('definition'); ecoreView = 'structure'; selectDefinition('rcore'); return; }
    if (definitionModels[d.source]) { selectActivity('definition'); ecoreView = 'source'; selectDefinition(d.source); if(definitionMode==='inferred'&&d.source==='xtext')inferred.selectEntry(); const p = utf8Position(definitionModels[d.source], d.start); const editor = d.source === 'xtext' ? xtextEditor : definitionEditor; editor.setPosition(p); editor.revealPositionInCenter(p); editor.focus(); }
    else if(definitionMode==='inferred'&&inferred.snapshot()?.inputs.bundle.sources.some(s=>s.id.uri===d.source)){selectActivity('definition');selectDefinition('xtext');inferred.focusDiagnostic(d);}
    else { const key = Object.keys(modelModels).find(k => modelModels[k].uri.toString() === d.source); if (key) { selectActivity('usage'); selectModel(key); const p = { lineNumber: d.range.start.line + 1, column: d.range.start.character + 1 }; modelEditor.setPosition(p); modelEditor.revealPositionInCenter(p); modelEditor.focus(); } }
  });
}
function renderModel(result) {
  latestModel = result;
  entries.model(result);
  queryPanes().forEach(q => q.changed(result));
  interchange.model(result);
  const elements = result.model.elements;
  $('element-count').textContent = `${elements.length} elements`;
  $('model-status').textContent = `${result.modelOrigin === 'import' ? 'IMPORTED MODEL · ' : result.overlay ? 'SCRIPT OVERLAY · ' : ''}${elements.length} elements · ${result.references.length} source reference locations · ${result.diagnostics.length ? 'needs attention' : 'valid'}`;
  if(result.documentAnalysisValid===false)$('model-status').textContent='Recovered document analysis; last valid model retained';
  if(result.documentAnalysisFailure)$('model-status').textContent='Document analysis unavailable; last valid model retained';
  $('export').disabled = result.documentAnalysisValid===false || result.diagnostics.length !== 0;
  if(result.documentAnalysisValid!==undefined)$('export-package').disabled=result.documentAnalysisValid===false || !latestPackage?.grammar;
  modelTree.update(result, latestPackage?.schema);
}
function notification(method, params) {
  if (method === 'textDocument/publishDiagnostics') {
    const model = monaco.editor.getModel(monaco.Uri.parse(params.uri));
    if (!model || (params.version !== undefined && params.version !== model.getVersionId()) || params.revision < activeRevision) return;
    modelDiagnostics.set(params.uri, params.diagnostics);
    monaco.editor.setModelMarkers(model, 'intersect', params.diagnostics.map(d => ({ severity: monaco.MarkerSeverity.Error, message: d.message, startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1, endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1 })));
    showDiagnostics();
  } else if (method === 'intersect/model') {
    if (params.revision < activeRevision || Object.entries(params.versions).some(([uri, version]) => monaco.editor.getModel(monaco.Uri.parse(uri))?.getVersionId() !== version)) return;
    renderModel(params);
  } else if (method === 'window/logMessage') status('Runtime error', params.message, true);
}
function selectedEditors(compilation) {
  return [['ecore','rcore'], ['xtext','xtext'], ['rcore_behavior','rcore_behavior']]
    .filter(([key]) => compilation[key] && (key !== 'rcore_behavior' || compilation[key].uri !== compilation.ecore.uri || compilation[key].sha256 !== compilation.ecore.sha256));
}
async function compileBundle(compilation) {
  if (!ready || compiling) return;
  const sameId = (a, b) => a.uri === b.uri && a.sha256 === b.sha256;
  const selected = selectedEditors(compilation).map(([key, editor]) => {
    const source = compilation.bundle.sources.find(source => sameId(source.id, compilation[key]));
    if (!source) throw new Error(`Missing selected ${key} source`);
    if (key === 'ecore' && source.kind !== 'rcore') throw new Error('Migrate Ecore definitions to Rcore before compiling.');
    return [editor, source.text];
  });
  definitionModels.xtext.setValue(''); definitionModels.rcore_behavior.setValue('');
  for (const [editor, text] of selected) definitionModels[editor].setValue(text);
  definitionBundle = structuredClone(compilation);
  return compileDefinitions(compilation);
}
async function bundleWithEdits(snapshot) {
  const compilation = structuredClone(definitionBundle);
  const edits=new Map(selectedEditors(compilation).map(([name,editor])=>[sourceKey(compilation[name]),snapshot[editor]]));
  return withSourceEdits(compilation,edits);
}
// Share active-language publication between compilation and source-only recovery.
async function acceptCompilation(result, {snapshot, inferenceInput, bundleInput, bundleProfile, bindingDraft, prepared, compilingClient, inferenceContext=null, providerDraft=null}) {
  if (client !== compilingClient) return false;
  activeRevision = result.revision;
  activeProviderContext = inferenceContext!==null;
  providers.showActive(inferenceContext);
  $('active-revision').textContent = `ACTIVE · REV ${activeRevision}`;
  lastSourceActivation=inferenceInput?structuredClone({inference:inferenceInput,sources:snapshot,entryRule:result.entry_rule??null,...(inferenceContext?{inference_context:inferenceContext}:{})}):bundleInput&&bundleInput.xtext?structuredClone({compilation:bundleInput,compilerProfile:bundleProfile,sources:snapshot,entryRule:result.entry_rule??null}):null;
  activeInferenceDraft=inferenceInput?{inputs:structuredClone(inferenceInput),drafts:[]}:null;
  if(inferenceInput){
    inferred.showGenerated(result.generated_definitions,inferenceInput,inferenceContext);
    activeProviderDraft=providerDraft;
    inferred.captureSuccessfulRecovery({ok:true,inference:inferenceInput,...(inferenceContext!==null?{inference_context:inferenceContext}:{}),entryRule:result.entry_rule??null});
  }
  if (bindingDraft) bindingDraft.commit(); else bindings.deactivate();
  latestPackage = result.package; activeSources = snapshot; activeAuthoredRcore = snapshot.rcore; activeRcore=prepared ? {...prepared,namespace:result.package.schema.uri} : null;
  if (prepared) $('rcore-binding').textContent=JSON.stringify({binding:prepared.compiled.binding,effects:prepared.compiled.effects,boundary:'Shared Rust/WASM execution and model providers.'},null,2);
  if (latestModel) modelTree.update(latestModel, latestPackage.schema);
  queryPanes().forEach(q => q.configure(result.package));
  await refreshEntryCatalog(compilingClient);
  await interchange.ready();
  if (client !== compilingClient) return false;
  const bundleArchive = result.package.version === 2 && (result.package.compilation || result.package.xtext_inference) && result.package.grammar;
  $('export-package').disabled = rcoreExample || !bundleArchive;
  $('export-package').title = result.package.grammar == null ? 'Use Save project or Save Rcore for a structure-only definition.' : !bundleArchive ? 'Compile the current definitions before exporting.' : '';
  if (bindingDraft?.modelBehavior !== undefined) { $('export-package').disabled = true; $('export-package').title = 'Use Save project to preserve Rcore and Rhai implementations together.'; }
  await Promise.all(pythonPanes().map(p => p.compiled()));
  return client === compilingClient;
}
async function compileDefinitions(compilation = null) {
  if (!ready || compiling) return;
  let bindingDraft;
  compiling = true; $('compile').disabled = true; $('example').disabled=true; entries.enabled(false);
  document.querySelectorAll('[data-load-example]').forEach(button => {button.disabled = true;});
  const compilingClient = client;
  const epoch = definitionEpoch;
  const mode = definitionMode;
  const selectedEntry=mode==='structure'?null:entries.rule();
  const selectedProfile = compilerProfile;
  const snapshot = Object.fromEntries(Object.entries(definitionModels).map(([k, m]) => [k, sourceText(m)]));
  status('Compiling definitions…', 'Structure → grammar → semantic contracts');
  try {
    if (mode!=='inferred' && !compilation && definitionBundle) compilation = await bundleWithEdits(snapshot);
    if (compilation) definitionBundle = structuredClone(compilation);
    let prepared;
    let result;
    let inferenceInput;
    let inferenceContext=null;
    const providerDraft=mode==='inferred'?inferred.providerDraft():null;
    let bundleInput;
    if(mode==='inferred'){
      if(snapshot.rcore_behavior.trim()||bindings.snapshot().present)throw new Error('Separate behavior and implementation files are not supported in inferred mode. Their drafts are retained.');
      inferenceInput=await inferred.prepare(snapshot.xtext,{providerMode:providerDraft!==null});
      const current=()=>client===compilingClient&&epoch===definitionEpoch&&inferred.providerDraft()===providerDraft;
      const superseded=()=>{if(client===compilingClient)status('Sources changed during compilation','Compile again to activate the current draft.');return {superseded:true};};
      if(!current())return superseded();
      if(providerDraft!==null){
        const selected=await compilingClient.request('intersect/selectInferredProviders',{inference:inferenceInput,provider_selection:JSON.parse(providerDraft)});
        if(!current())return superseded();
        if(!selected.ok)result=selected;
        else inferenceContext=selected.inference_context;
      }
      if(!result)result=await prepareInferredActivation(compilingClient,{inference:inferenceInput,...(inferenceContext!==null?{inference_context:inferenceContext}:{}),entry_rule:selectedEntry},current);
    } else if (rcoreExample) {
      prepared = await prepareRcore(compilingClient,snapshot);
      result = prepared.ok ? await compilingClient.request('intersect/compileRcore', {...snapshot, xtext_profile:compilerProfile,entry_rule:selectedEntry}) : prepared;
    } else if (compilation) {
      bundleInput=compilation;
      result = await compilingClient.request('intersect/compileBundle', {compilation, xtext_profile:selectedProfile,entry_rule:selectedEntry});
    } else {
      bindingDraft = await bindings.prepare(snapshot);
      result = await compilingClient.request('intersect/compileRcore', {...snapshot, rcore_behavior:bindingDraft?.modelBehavior ?? snapshot.rcore_behavior, bindings:bindingDraft?.request, xtext:mode==='structure'?'':snapshot.xtext, xtext_profile:compilerProfile,entry_rule:selectedEntry});
    }
    if (client !== compilingClient) return;
    if(result.superseded){status('Sources changed during compilation','Compile again to activate the current draft.');return result;}
    activeRevision = result.revision ?? activeRevision;
    const sourceNames = {'memory:model.rcore':'rcore','memory:language.xtext':'xtext','memory:behavior.rcore':'rcore_behavior'};
    definitionDiagnostics = mode==='inferred'?projectInferenceDiagnostics(result,inferenceInput):(result.diagnostics||[]).map(d=>({...d,source:sourceNames[d.source]??(compilation?(selectedEditors(compilation).find(([name])=>compilation[name]?.uri===d.source)?.[1]||d.source):d.source)}));
    for (const [name, model] of Object.entries(definitionModels)) {
      const diagnostics = epoch === definitionEpoch && mode!=='inferred' ? definitionDiagnostics.filter(d => d.source === name) : [];
      monaco.editor.setModelMarkers(model, 'compiler', diagnostics.map(d => { const start = utf8Position(model, d.start); const end = utf8Position(model, d.end); return { severity: monaco.MarkerSeverity.Error, message: d.message, startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.lineNumber === start.lineNumber ? Math.max(start.column + 1, end.column) : end.column }; }));
    }
    if(mode==='inferred')inferred.diagnostics(epoch===definitionEpoch?definitionDiagnostics:[]);
    if (result.ok) {
      try {
        if (!await acceptCompilation(result,{snapshot,inferenceInput,bundleInput,bundleProfile:selectedProfile,bindingDraft,prepared,compilingClient,inferenceContext,providerDraft})) return;
      } catch(error) {
        if(client===compilingClient){$('definition-state').textContent='Language active · UI setup incomplete';status('Language active · UI setup incomplete',error.message,true);}
        return result;
      }
      $('definition-state').textContent = epoch === definitionEpoch ? `Compiled · revision ${activeRevision}` : 'Uncompiled changes';
      status(`Language compiled · revision ${activeRevision}`, epoch === definitionEpoch ? `${result.package.schema.classes && Object.keys(result.package.schema.classes).length} classes · native WASM · unique-name scope` : 'A snapshot compiled successfully. Newer definition edits are not active.');
    } else {
      status('Definition compilation failed', activeRevision ? `Models still use revision ${activeRevision}. Fix the diagnostics and compile again.` : 'Fix the definition diagnostics to activate a language.', true);
      $('definition-state').textContent = 'Compilation failed';
    }
    if (epoch !== definitionEpoch) definitionDiagnostics = [];
    showDiagnostics();
    return result;
  } catch (error) {
    if(client!==compilingClient)return {superseded:true};
    if(epoch!==definitionEpoch){status('Sources changed during compilation','Compile again to activate the current draft.');return {superseded:true};}
    status('Compilation stopped',error.message,true);if(mode!=='inferred')$('project-status').textContent=error.message;
  }
  finally { bindingDraft?.discard(); if (client === compilingClient) { compiling = false; entries.enabled(ready); $('compile').disabled = !ready; $('example').disabled=exampleLoading; document.querySelectorAll('[data-load-example]').forEach(button => {button.disabled = exampleLoading;}); } }
}
// Shared by ordinary inference, provider inference and source-only recovery.
// Preparation is read-only; publication starts only after the captured host fence.
async function prepareInferredActivation(owner,request,current){
  if(!current())return {superseded:true};
  let result;
  try{result=await owner.request('intersect/prepareInferred',request);}
  catch(error){if(!current())return {superseded:true};throw error;}
  if(!current()){
    if(result.candidate)void owner.request('intersect/discardInferred',{candidate:result.candidate}).catch(()=>{});
    return {superseded:true};
  }
  return result.ok?owner.request('intersect/activateInferred',{candidate:result.candidate}):result;
}
async function recoverSourceLanguage(recovery, startingClient) {
  const failureDetail=definitionDiagnostics.map(d=>d.message).join(' ')||$('compile-detail').textContent;
  compiling=true; $('compile').disabled=true; $('example').disabled=true;
  document.querySelectorAll('[data-load-example]').forEach(button=>{button.disabled=true;});
  const inferredRecovery=Boolean(recovery.inference),epoch=definitionEpoch;
  const label=inferredRecovery?'inferred':'ordinary';
  status(`Restoring previous ${label} language…`,'The current draft failed. Rebuilding the last successful original sources.');
  try {
    const result=inferredRecovery?await prepareInferredActivation(startingClient,{inference:recovery.inference,...(recovery.inference_context?{inference_context:recovery.inference_context}:{}),entry_rule:recovery.entryRule??null},()=>client===startingClient&&definitionEpoch===epoch):await startingClient.request('intersect/compileBundle',{compilation:recovery.compilation,xtext_profile:recovery.compilerProfile,entry_rule:recovery.entryRule??null});
    if(client!==startingClient)return;
    if(result.superseded){status('Sources changed during recovery','Your newer draft is retained. Compile it or restart to retry recovery.');return;}
    if(!result.ok)throw new Error((result.diagnostics||[]).map(d=>d.message).join(' ')||'Previous sources did not compile.');
    if(!await acceptCompilation(result,{snapshot:recovery.sources??(recovery.inference?{xtext:recovery.inference.bundle.sources.find(s=>sourceKey(s.id)===sourceKey(recovery.inference.grammar)).text,rcore:'',ecore:'',rcore_behavior:''}:bundleSourceSnapshot(result.package.compilation)),inferenceInput:recovery.inference,bundleInput:recovery.compilation,bundleProfile:recovery.compilerProfile,compilingClient:startingClient,inferenceContext:recovery.inference_context??null,providerDraft:null}))return;
    $('definition-state').textContent='Draft failed · previous language restored';
    status(`Draft failed · previous ${label} language restored`,`The new runtime uses the last successful ${label} sources. Your current draft is unchanged. ${failureDetail}`,true);
    showDiagnostics();
  } catch(error) {
    if(client===startingClient){
      if(activeRevision){$('definition-state').textContent='Draft failed · language restored · UI setup incomplete';status('Language restored · UI setup incomplete',`${error.message} The draft and its diagnostics are retained.`,true);}
      else status(`Could not recover ${label} language`,`${error.message} Your current draft and previous successful sources are retained for another restart.`,true);
    }
  } finally {
    if(client===startingClient){compiling=false; entries.enabled(ready); $('compile').disabled=!ready; $('example').disabled=exampleLoading; document.querySelectorAll('[data-load-example]').forEach(button=>{button.disabled=exampleLoading;});}
  }
}
function canRecoverSource(recovery) {
  if(definitionMode==='inferred')return Boolean(recovery?.inference);
  return definitionMode==='language'&&Boolean(definitionBundle&&recovery?.compilation)&&recovery.compilerProfile===compilerProfile&&definitionBundle.ecore.uri===recovery.compilation.ecore.uri&&definitionBundle.xtext?.uri===recovery.compilation.xtext?.uri;
}
async function start({ compile = true, recover = true } = {}) {
  runtimeEpoch++;providers.close();providers.showActive(null);
  const recovery=recover&&canRecoverSource(lastSourceActivation)?structuredClone(lastSourceActivation):null;
  if(!recover){lastSourceActivation=null;entries.restore(null);}
  entries.reset();entries.enabled(false);
  compiling = false; definitionDiagnostics = []; activeSources = null; activeInferenceDraft=null; activeProviderDraft=null; activeProviderContext=false; activeAuthoredRcore = null;
  if(definitionMode==='inferred')inferred.clearGenerated();
  for (const model of Object.values(definitionModels)) monaco.editor.setModelMarkers(model, 'compiler', []);
  ready = false; $('compile').disabled = true;
  interchange.reset();
  pythonPanes().forEach(p => p.reset()); client?.dispose();
  queryPanes().forEach(q => q.reset());
  activeRevision = 0; modelDiagnostics.clear(); latestModel = null; latestPackage = null;
  $('active-revision').textContent = 'NO ACTIVE PACKAGE'; $('export').disabled = true;
  $('element-count').textContent = '0 elements'; $('model-status').textContent = 'Waiting for a language package';
  $('export-package').disabled = true;
  for (const m of Object.values(modelModels)) monaco.editor.setModelMarkers(m, 'intersect', []);
  modelTree.reset();
  const startingClient = new LanguageClient((...args)=>{if(client===startingClient)notification(...args);}, message => { if(client===startingClient){ready = false; $('compile').disabled = true; status('Runtime stopped', message, true);} });
  client=startingClient;
  try {
    await startingClient.request('initialize', { processId: null, rootUri: 'file:///', capabilities: {} });
    if(client!==startingClient)return;
    startingClient.notify('initialized', {});
    for (const model of Object.values(modelModels)) startingClient.notify('textDocument/didOpen', { textDocument: { uri: model.uri.toString(), languageId: 'intersect-model', version: model.getVersionId(), text: model.getValue() } });
    ready = true; $('runtime-label').textContent = 'Native WASM ready'; $('compile').disabled = false;
    void refreshStructure();
    if (compile) {
      const result=await compileDefinitions();
      if(client===startingClient&&!result?.ok&&!result?.superseded&&activeRevision===0&&canRecoverSource(recovery))await recoverSourceLanguage(recovery,startingClient);
    }
    else { $('definition-state').textContent = 'New metamodel'; showDiagnostics(); status('Empty project', 'Edit the Rcore structure source, then compile.'); }
  } catch (error) { if(client===startingClient){status('Could not start runtime', error.message, true); $('runtime-label').textContent = 'Runtime unavailable';} }
}
let structureEpoch = 0;
let structureTimer;
async function refreshStructure() {
  const epoch = ++structureEpoch;
  const previewMode=definitionMode;
  const sourceModel=previewMode==='inferred'?inferred.generatedModel:definitionModels.rcore;
  const source = sourceText(sourceModel);
  const version = sourceModel.getVersionId();
  const previewClient = client;
  if (!ready) return;
  try {
    let result;
    if(definitionMode==='inferred'){
      const request=inferred.previewRequest();if(!request){structure.invalidate('Compile the original inference sources to generate a diagram.');return;}
      result=await previewClient.request('intersect/inferredStructurePreview',request);
    }else result = await previewClient.request('intersect/lowerRcoreStructure', {uri:'memory:structure.rcore',text:source,generated_uri:'memory:ecore'});
    if (epoch !== structureEpoch || client !== previewClient || previewMode!==definitionMode || sourceModel.getVersionId() !== version) return;
    if (!result.ok) { structure.invalidate('Rcore draft cannot be drawn. ' + (result.diagnostics || []).map(d=>d.message).join(' ') + ' The diagram retains the last readable definition.'); return; }
    if(previewMode==='inferred')inferred.cachePreview(result);
    generatingEcore = true; if (definitionModels.ecore.getValue() !== result.lowering.generated.text) definitionModels.ecore.setValue(result.lowering.generated.text); generatingEcore = false;
    await structure.refresh();
  } catch (error) { if (epoch === structureEpoch && previewMode===definitionMode) structure.invalidate(error.message); }
}
for (const model of Object.values(definitionModels)) model.onDidChangeContent(() => {
  if (generatingEcore && model===definitionModels.ecore) return;
  if (model === definitionModels.ecore) return; // Diagram projection only.
  if (model === definitionModels.rcore_behavior) behaviorFileCommand.hidden = !model.getValue().trim();
  if (model === definitionModels.rcore) { if (model.getValue().trim()) structureSource = 'rcore'; structureEpoch++; structure.invalidate('Rcore source changed. Updating the diagram…'); clearTimeout(structureTimer); structureTimer = setTimeout(refreshStructure, 180); }
  definitionEpoch += 1; $('definition-state').textContent = 'Uncompiled changes';
  definitionDiagnostics = []; monaco.editor.setModelMarkers(model, 'compiler', []); if(definitionMode==='inferred')inferred.diagnostics([]); showDiagnostics();
  if (!compiling) status('Definitions changed', activeRevision ? `Models continue to use revision ${activeRevision} until you compile.` : 'Compile to activate this language.');
});
function observeModel(model) { return model.onDidChangeContent(() => {
  if (ready) client.notify('textDocument/didChange', { textDocument: { uri: model.uri.toString(), version: model.getVersionId() }, contentChanges: [{ text: model.getValue() }] });
}); }
for (const model of Object.values(modelModels)) observeModel(model);
async function languageRequest(method, model, position, token) {
  if (!ready || !activeRevision) return null;
  const version = model.getVersionId(); const revision = activeRevision;
  const result = await client.request(method, { textDocument: { uri: model.uri.toString() }, position: { line: position.lineNumber - 1, character: position.column - 1 } });
  return token.isCancellationRequested || version !== model.getVersionId() || revision !== activeRevision ? null : result;
}
monaco.languages.registerCompletionItemProvider('intersect-model', { triggerCharacters: [' '], async provideCompletionItems(model, position, context, token) {
  const result = await languageRequest('textDocument/completion', model, position, token);
  const word = model.getWordUntilPosition(position);
  return { suggestions: (result?.items || []).map(item => ({ label: item.label, insertText: item.label, detail: item.detail, kind: item.kind === 14 ? monaco.languages.CompletionItemKind.Keyword : monaco.languages.CompletionItemKind.Reference, range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn } })) };
} });
monaco.languages.registerHoverProvider('intersect-model', { async provideHover(model, position, token) {
  const result = await languageRequest('textDocument/hover', model, position, token);
  return result ? { contents: [{ value: result.contents.value.replace(/[\\`*_{}\[\]()#+.!<>|~-]/g, '\\$&'), isTrusted: false }] } : null;
} });
monaco.languages.registerDefinitionProvider('intersect-model', { async provideDefinition(model, position, token) {
  const result = await languageRequest('textDocument/definition', model, position, token);
  return (result || []).map(location => ({ uri: monaco.Uri.parse(location.uri), range: { startLineNumber: location.range.start.line + 1, startColumn: location.range.start.character + 1, endLineNumber: location.range.end.line + 1, endColumn: location.range.end.character + 1 } }));
} });
monaco.editor.registerEditorOpener({ openCodeEditor(source, resource, selection) {
  const name = Object.keys(modelModels).find(k => modelModels[k].uri.toString() === resource.toString());
  if (!name) return false;
  selectActivity('usage'); selectModel(name); if (selection) { modelEditor.setSelection(selection); modelEditor.revealRangeInCenter(selection); } modelEditor.focus(); return true;
} });
$('compile').onclick = () => compileDefinitions();
$('restart').onclick = start;
const modelSamplesMenu = document.createElement('details'); modelSamplesMenu.id = 'model-samples';
modelSamplesMenu.className = 'model-samples';
function resetScenarios(enabled) {
  modelSamplesMenu.innerHTML = '<summary>Sample models</summary><div role="group" aria-label="Sample models"></div>';
  const choices = enabled
    ? [['default','Simple chain'],['graph','Branch, cycle and duplicate edge']]
    : [['default','Simple library'],['circulation','Larger circulation'],['invalid','Duplicate loan (validation demo)']];
  for (const [id,label] of choices) {
    const button = document.createElement('button'); button.type = 'button';
    button.dataset.modelSample = id; button.textContent = label;
    button.onclick = () => loadModelSample(id); modelSamplesMenu.lastElementChild.append(button);
  }
}
resetScenarios(false);
async function loadModelSample(scenario) {
  if (xtextExample) return;
  const selectedDefaults = defaults;
  await Promise.all(pythonPanes().map(p => p.cancel()));
  if (selectedDefaults !== defaults) return;
  const sample = scenario === 'default' ? defaults : rcoreExample
    ? {catalog: graphTypes, loans: graphRelations}
    : {catalog: circulationCatalog, loans: scenario === 'invalid' ? duplicateLoans : circulationLoans};
  modelModels.catalog.setValue(sample.catalog); modelModels.loans.setValue(sample.loans);
  modelSamplesMenu.open = false;
  $('rcore-result').textContent = 'Sample model loaded. Run behavior on the current model.';
  $('rcore-read-status').textContent = 'Run behavior to inspect its actual reads.'; $('rcore-reads').textContent = '';
}
function setRcorePresentation(enabled, xtextProfile = false, implementations = false) {
  resetScenarios(enabled); modelSamplesMenu.hidden = !!xtextProfile || definitionMode === 'structure';
  compilerProfile = xtextProfile ? (xtextExamples[xtextProfile]?.compilerProfile || 'intersect.xtext.native.v1') : 'intersect.workbench.v1';
  libraryImplementations = implementations;
  rcoreExample=enabled; xtextExample=xtextProfile; defaults=enabled?rcoreDefaults:xtextExamples[xtextProfile] || (implementations ? libraryImplementationDefaults : libraryDefaults);
  showDemoChoices($('example'), enabled ? 'rcore' : xtextProfile || (implementations ? 'library-implementations' : 'library'));
  document.querySelector('[data-definition="rcore"]').hidden=false;
  $('definition-mode').disabled=enabled;
  $('definition-undo').disabled=false; $('definition-redo').disabled=false;
  ide?.rcore(enabled);
  windows?.setModelLabels(enabled ? {catalog:'types.demo',loans:'relations.demo'} : {});
}
async function loadExample(selected) {
  if (compiling || exampleLoading) return;
  const replaceProvider=definitionMode==='inferred'||inferred.providerDraft()!==null||activeProviderContext;
  if(replaceProvider)fenceSourceRuntime();
  exampleLoading = true;
  status('Loading example…', 'Preparing its definitions and sample models.');
  showDemoChoices($('example'), selected);
  $('example').disabled = true;
  document.querySelectorAll('[data-load-example]').forEach(button => {button.disabled = true;});
  try {
    await Promise.all(pythonPanes().map(p => p.cancel()));
    structureSource = 'rcore';
    setRcorePresentation(selected==='rcore', Object.hasOwn(xtextExamples, selected) ? selected : false, selected === 'library-implementations');
    bindings.restore(libraryImplementations ? {version:2,present:true,source:libraryRhai,arguments:'["4"]'} : undefined);
    ecoreView = libraryImplementations ? 'rhai' : 'structure';
    definitionBundle=null; inferred.clear(); activeRcore=null;
    windows?.restore();
    structure.setLayout({version:1,positions:{},zoom:rcoreExample?0.9:1});
    for (const [key,m] of Object.entries({...definitionModels,...modelModels})) m.setValue(defaults[key] ?? '');
    python.clearProject(); python.transactions.clear(); queries.clearDraft();
    python.model.setValue(rcoreExample ? kermlScript : xtextExample ? '# Explore the active Xtext example using intersect_api.\n' : libraryImplementations ? libraryImplementationsPython : exampleScript);
    structureSource = 'rcore';
    setDefinitionMode('language'); selectDefinition(xtextExample?'xtext':'rcore'); selectModel('catalog'); selectActivity('definition');
    if(replaceProvider){await start({compile:false,recover:false});if(!ready)return;}
    if (defaults.bundle) await compileBundle(await defaults.bundle()); else await compileDefinitions();
  } finally {
    exampleLoading = false; $('example').disabled = compiling;
    document.querySelectorAll('[data-load-example]').forEach(button => {button.disabled = compiling;});
  }
}
$('example').onchange = () => loadExample($('example').value);
$('rcore-run').onclick = async () => {
  $('rcore-run').disabled=true;
  try {
    const output=await runRcore(client,activeRcore,$('rcore-seed').value.trim(),$('rcore-observe').checked);
    $('rcore-result').textContent=output.names.join(' → ');
    const observation=output.result.evaluation.observation;
    $('rcore-read-status').textContent=observation ? `${observation.semantic_reads.length} semantic read records · ${observation.validation_admissions.length} validated model context · ${observation.truncated?'record limit reached':'complete for stored/inverse query events'}.` : 'Observation disabled.';
    $('rcore-reads').textContent=observation ? JSON.stringify(observation,null,2) : '';
  }
  catch(error) { $('rcore-result').textContent=error.message; }
  finally { $('rcore-run').disabled=false; }
};
$('export').onclick = () => {
  if (!latestModel || latestModel.diagnostics.length) return;
  const blob = new Blob([JSON.stringify({ schema: 'intersect.workbench.v1', package: latestPackage, sources: Object.fromEntries(Object.entries(modelModels).map(([k, m]) => [k, m.getValue()])), overlay: latestModel.overlay || false, model: latestModel.model, derived: latestModel.derived }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'intersect-model.json'; a.click(); URL.revokeObjectURL(url);
};
window.addEventListener('keydown', e => { if (!definitionPage.hidden && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); compileDefinitions(); } });
window.addEventListener('beforeunload', () => client?.dispose());
// Explicit development/test surface: exercises the same editors, client and runtime.
if (import.meta.env.DEV || import.meta.env.MODE === 'test') window.workbench = { python, structure, project, setDefinitionMode, selectActivity, definitionModels, modelModels, definitionEditor, get modelEditor() { return modelEditor; }, get windows() { return windows; }, compile: compileDefinitions, compileBundle, inspect: () => client.request('intersect/inspect'), request: (method, params) => client.request(method, params), get activeSources() { return activeSources; } };
const examplePicker = $('example').closest('label');
examplePicker.remove();
ide = createIdeShell();
document.querySelector('[aria-label="Starter projects"]').append(examplePicker);
document.querySelector('[aria-label="Project"]').append(createRunnerExport(() => client, () => {
  if (bindings.snapshot().present) throw new Error('Runnable ZIP export requires self-contained Rcore/Xtext definitions. Save the project to retain external Rhai implementations.');
  return !activeSources || Object.entries(definitionModels).filter(([key]) => key !== 'ecore').some(([key,model]) => sourceText(model) !== (activeSources[key] ?? '')) || (definitionMode==='inferred' && (inferred.hasPendingEdits(activeInferenceDraft) || inferred.providerDraft()!==activeProviderDraft));
}, (message,error=false) => { $('project-status').textContent=message; $('project-status').classList.toggle('project-error',error); }, () => project.snapshot()));
const createStubCommand = document.createElement('button'); createStubCommand.id = 'create-stub'; createStubCommand.textContent = 'Create Stub';
document.querySelector('[aria-label="Metamodel · Define"]').append(createStubCommand);
createStubCommand.onclick = async () => {
  try { await bindings.createStub(); }
  catch (error) { $('project-status').textContent = error.message; }
};
const mixedBindingsCommand = document.createElement('button'); mixedBindingsCommand.id = 'new-rust-rhai-example'; mixedBindingsCommand.textContent = 'New Rust/Rhai example';
document.querySelector('[aria-label="Starter projects"]').append(mixedBindingsCommand);
mixedBindingsCommand.onclick = async () => {
  try { await project.load(mixedBindingsProject(project.snapshot())); selectActivity('definition'); ecoreView = 'rhai'; selectDefinition('rcore'); }
  catch (error) { $('project-status').textContent = error.message; }
};
const modelPanel = document.querySelector('.model');
modelPanel.querySelector('.tabs').remove();
const primaryEditor = modelEditor;
const loansWindow = createModelWindow('loans', 'loans.library', modelModels.loans);
function pythonPanes() { return windows ? windows.documents.filter(d => d.python).map(d => d.python) : [python]; }
function queryPanes() { return windows ? windows.documents.filter(d => d.query).map(d => d.query) : [queries]; }
function createModelWindow(id, name, model) {
  const panel = document.createElement('article'); panel.className = 'panel model';
  panel.innerHTML = '<div class="panel-heading"><h2>Try your language</h2></div><div class="file-path"></div><div class="editor"></div>';
  panel.querySelector('.file-path').textContent = name;
  const editor = monaco.editor.create(panel.querySelector('.editor'), { ...editorOptions, model, ariaLabel: 'Model source: ' + name });
  return { id, name, type: 'model', group: 0, panel, model, editor };
}
function createWindow(value) {
  if (value.type === 'model') {
    const model = monaco.editor.createModel(value.source || '', 'intersect-model', monaco.Uri.parse('file:///models/' + value.name));
    modelModels[value.id] = model; const subscription = observeModel(model);
    if (ready) client.notify('textDocument/didOpen', { textDocument: { uri: model.uri.toString(), languageId: 'intersect-model', version: model.getVersionId(), text: model.getValue() } });
    const doc = { ...createModelWindow(value.id, value.name, model), group: value.group,
      dispose() {
        if (ready) client.notify('textDocument/didClose', { textDocument: { uri: model.uri.toString() } });
        modelDiagnostics.delete(model.uri.toString()); subscription.dispose(); delete modelModels[value.id];
        doc.editor.dispose(); doc.panel.remove(); model.dispose(); showDiagnostics();
      } };
    return doc;
  }
  if (value.type === 'python') {
    const pane = createPythonPane(monaco, editorOptions, () => client, { host: usagePage, prefix: value.id + '-', name: value.name, source: value.source ?? '# Use the generated intersect_api to explore or test your model.\n', transactions: python.transactions });
    document.querySelector('.window-aux').append(pane.apiPanel, pane.outputPanel);
    pane.results.remove();
    return { ...value, panel: pane.panel, model: pane.model, python: pane, dispose: pane.dispose };
  }
  const query = createQueryPane(() => client, navigateQuery, { host: usagePage, prefix: value.id + '-' });
  if (latestPackage) query.configure(latestPackage); if (latestModel) query.changed(latestModel); if (value.query) query.restore(value.query);
  return { ...value, query, panel: query.panel, dispose: query.dispose };
}
windows = createEditorWindows({
  host: usagePage,
  initial: [
    { id: 'catalog', name: 'catalog.library', type: 'model', group: 0, panel: modelPanel, model: modelModels.catalog, editor: primaryEditor },
    loansWindow,
    { id: 'script', name: 'script.py', type: 'python', group: 1, panel: python.panel, model: python.model, python },
    { id: 'query', name: 'Queries', type: 'query', group: 1, panel: queries.panel, query: queries },
  ],
  create: createWindow,
  onActivate(doc) { if (doc.editor) { modelEditor = doc.editor; } if (doc.python) ide.python(doc.python); },
  extension: () => latestPackage?.grammar?.name?.split('.').at(-1).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'model',
});
document.querySelector('.window-toolbar').append(modelSamplesMenu);
createMercurioShell({monaco,
  files: () => [
    ...['rcore','xtext','rcore_behavior'].filter(key => definitionModels[key].getValue().trim()).map(key=>({id:key,name:definitionFilename(key),kind:'definition'})),
    ...windows.documents.map(doc=>({id:doc.id,name:doc.displayName||doc.name,kind:doc.type})),
  ],
  openFile: file => { if(file.kind==='definition'){selectActivity('definition');ecoreView=file.id==='xtext'?'xtext':'source';selectDefinition(file.id);}else{selectActivity('usage');windows.open(file.id);} },
  newFile: () => { selectActivity('usage');windows.newFile(); },
});
selectDefinition('rcore');
start().then(()=>{const example=new URLSearchParams(location.search).get('example');if((example==='rcore' || example==='library-implementations' || Object.hasOwn(xtextExamples, example))){loadExample(example);}});
