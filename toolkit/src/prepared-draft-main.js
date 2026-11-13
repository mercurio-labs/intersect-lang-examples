// Handwritten source/project/worker transport. All modeling semantics run in Rust.
import {LanguageClient} from './client.js';
import {createPreparedDraftProject,encodePreparedDraftProject,decodePreparedDraftProject} from './prepared-draft-project.js';
import {createPreparedPhysicalProject,isPreparedPhysicalProject,encodePreparedDraftSourceProject,decodePreparedDraftSourceProject} from './prepared-draft-project.js';
import manifest from '../.runtime/intersect-text/fixtures/kerml-draft-pinned/sources.json';
import ecore from '../.runtime/intersect-text/fixtures/kerml-draft-pinned/SysML.ecore?raw';
import expressions from '../.runtime/intersect-text/fixtures/kerml-draft-pinned/KerMLExpressions.xtext?raw';
import kerml from '../.runtime/intersect-text/fixtures/kerml-draft-pinned/KerML.xtext?raw';
import './prepared-draft.css';

const $=id=>document.getElementById(id);
document.getElementById('app').innerHTML=`
  <header><a href="/">Intersect workbench</a><h1>KerML drafts</h1>
    <p>Physical drafts from the complete original Ecore and KerML grammars.</p></header>
  <p class="notice" id="draft-scope">Unvalidated draft · publication unavailable. Currently supports plain package names such as <code>package P {}</code>. Types, features, imports and linking remain unsupported here.</p>
  <nav aria-label="Draft project"><button id="draft-new">New package draft</button><button id="draft-open">Open draft project</button><button id="draft-save">Save draft project</button><input id="draft-file" type="file" accept=".json,.intersect" hidden></nav>
  <div id="draft-file-status" role="status"></div>
  <label for="draft-mode">Draft mode</label><select id="draft-mode"><option value="single">Single package (existing)</option><option value="project">Multiple resources (physical project)</option></select>
  <div id="draft-project-controls" hidden><label for="draft-source-select">Project source</label><select id="draft-source-select"></select>
    <label for="draft-source-uri">Exact raw source URI</label><input id="draft-source-uri" type="text"><button id="draft-source-add">Add source</button><button id="draft-source-remove">Remove source</button>
    <p>Up to 8 sources and 256000 UTF-8 text bytes in one request.</p></div>
  <section><h2>Model source</h2><label for="draft-model">KerML source</label>
    <textarea id="draft-model" spellcheck="false"></textarea>
    <div><button id="draft-analyze">Analyze draft</button><button id="draft-stop" disabled>Stop analysis</button></div>
    <p id="draft-status" role="status">Ready to analyze.</p></section>
  <section><h2>Draft observation</h2><p>No validated language model is created. Editing or stopping clears this observation.</p><pre id="draft-result">No current observation.</pre></section>
  <details><summary>Per-source/project diagnostics</summary><pre id="draft-source-errors">No current observation.</pre></details>
  <details><summary>Original definition sources · read only</summary><label for="draft-original-select">Original source</label>
    <select id="draft-original-select"></select><p id="draft-original-identity"></p>
    <textarea id="draft-original" aria-label="Original definition source" readonly spellcheck="false"></textarea></details>`;

const texts=[ecore,expressions,kerml];
const sources=manifest.sources.map((s,index)=>({id:{uri:s.original_uri,sha256:s.sha256},kind:index===0?'ecore':'xtext',text:texts[index],dependencies:[]}));
sources[1].dependencies=[sources[0].id];sources[2].dependencies=[sources[0].id,sources[1].id];
sources.push({id:{uri:'probe-behavior.rcore',sha256:'5eaff959a081947c82b71b13afd07e0547e2acb92cbc3bf98efba24511760c8c'},kind:'rcore_behavior',text:'rcore 1; package emptyRules version "1";',dependencies:[sources[0].id]});
const original={bundle:{version:1,sources,namespaces:[]},ecore:sources[0].id,xtext:sources[2].id,rcore_behavior:sources[3].id,namespace:'https://www.omg.org/spec/SysML/20250201',materialized_types:[]};
const starter=()=>createPreparedDraftProject(original,{uri:'memory://intersect/native-minimal-package/package.kerml',text:'package P {}'});
let project=starter(),version=0,epoch=0,client=null,controller=null;
function clearObservation(message='Source changed. Analyze to rebuild the draft.') {
  epoch+=1;controller?.abort();controller=null;client?.dispose();client=null;
  $('draft-source-errors').textContent='No current observation.';
  $('draft-result').textContent='No current observation.';
  $('draft-status').textContent=message;$('draft-stop').disabled=true;$('draft-analyze').disabled=false;
}
function showOriginal() {
  const source=project.original.bundle.sources.find(s=>s.id.uri===$('draft-original-select').value);
  if(!source)return;
  project.presentation.activeSource=source.id.uri;
  $('draft-original').value=source.text;
  $('draft-original-identity').textContent=`${source.id.uri} · SHA256 ${source.id.sha256} · ${new TextEncoder().encode(source.text).length} bytes`;
}
function install(value) {
  if(isPreparedPhysicalProject(value)){installPhysical(value);return;}
  // Strict validation and cloning precede any replacement or worker cancellation.
  const next=createPreparedDraftProject(value.original,value.model,value.presentation);
  clearObservation('Ready to analyze.');project=next;version+=1;
  $('draft-mode').value='single';$('draft-project-controls').hidden=true;$('draft-scope').innerHTML=legacyScope;
  $('draft-model').value=project.model.text;
  $('draft-original-select').replaceChildren(...project.original.bundle.sources.map(source=>{
    const option=document.createElement('option');option.value=source.id.uri;option.textContent=source.id.uri;return option;
  }));
  $('draft-original-select').value=project.original.bundle.sources.some(s=>s.id.uri===project.presentation.activeSource)?project.presentation.activeSource:project.original.ecore.uri;
  const presentation=project.presentation.activeSource;showOriginal();project.presentation.activeSource=presentation;
}
$('draft-original-select').onchange=showOriginal;
$('draft-model').oninput=()=>{if(physicalMode()){physicalEdit();return;}clearObservation();project.model.text=$('draft-model').value;project.presentation.activeSource=project.model.uri;version+=1;};
$('draft-stop').onclick=()=>clearObservation('Analysis stopped. Analyze to start a fresh worker.');
$('draft-new').onclick=()=>{install(physicalMode()?createPreparedPhysicalProject(original,[starter().model]):starter());$('draft-file-status').textContent='New package draft.';};
$('draft-analyze').onclick=async()=>{
  clearObservation('Analyzing with the native engine…');
  const generation=epoch,documentVersion=version;
  const multi=physicalMode();
  const source=structuredClone(multi?project.sources:project.model),inputs=structuredClone(project.original);
  const abort=new AbortController();controller=abort;
  const worker=new LanguageClient(()=>{},message=>{
    if(generation===epoch)clearObservation(`Worker unavailable: ${message}`);
  });client=worker;
  $('draft-analyze').disabled=true;$('draft-stop').disabled=false;
  try {
    await worker.request('initialize');
    const result=await worker.request(multi?'intersect/prepareKerMLPhysicalProject':'intersect/prepareKerMLDraft',{original:inputs,...(multi?{sources:source}:{source}),version:documentVersion},{signal:abort.signal});
    if(epoch!==generation||version!==documentVersion||client!==worker)return;
    if(multi){
      if(result?.kind!=='prepared_physical_project'||result.version!==documentVersion||result.language_validated!==false||result.publication_permitted!==false||JSON.stringify(result.sources?.map(row=>row.uri))!==JSON.stringify(source.map(row=>row.uri)))throw new Error('Physical project observation does not match current sources.');
    }else{
    if(result?.uri!==source.uri||result.version!==documentVersion||result.language_validated!==false||result.publication_permitted!==false)throw new Error('Draft observation does not match the current source.');
    }
    $('draft-result').textContent=JSON.stringify(result,null,2);
    if(multi){showPhysicalDiagnostics(result);$('draft-status').textContent=result.status==='available'?'KerML construction available - unlinked, unvalidated.':'KerML construction has diagnostics - see the native diagnostics.';}
    else $('draft-status').textContent=result.status==='available'?'KerML construction available · unlinked, unvalidated.':'KerML construction has diagnostics · see native diagnostics.';
  } catch(error) {
    if(epoch===generation){$('draft-result').textContent='No current observation.';$('draft-status').textContent=`Draft unavailable: ${error.message}`;worker.dispose();}
  } finally {
    if(epoch===generation){controller=null;$('draft-analyze').disabled=false;$('draft-stop').disabled=true;}
  }
};
$('draft-save').onclick=()=>{
  try {
    const text=physicalMode()?encodePreparedDraftSourceProject(project):encodePreparedDraftProject(project);
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='draft.intersect.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('draft-file-status').textContent='Saved exact sources and recipe. Reopening rebuilds the observation.';
  }catch(error){$('draft-file-status').textContent=`Could not save: ${error.message}`;}
};
let openEpoch;
$('draft-open').onclick=()=>{openEpoch=epoch;$('draft-file').click();};
$('draft-file').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  const before=openEpoch??epoch;
  try {
    if(file.size>2000000)throw new Error('Project exceeds the 2 MB limit.');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
    const value=decodePreparedDraftSourceProject(text);
    if(epoch!==before)throw new Error('Source changed while opening. Open the project again.');
    install(value);$('draft-file-status').textContent='Draft project opened. Analyze to rebuild from its original sources.';
  }catch(error){$('draft-file-status').textContent=`Could not open: ${error.message}`;}
};
window.addEventListener('pagehide',()=>client?.dispose());

function physicalMode() { return isPreparedPhysicalProject(project); }
function physicalSource() {
  return project.sources.find(source => source.uri === $('draft-source-select').value) ?? project.sources[0];
}
function showPhysicalSource() {
  const source = physicalSource();
  $('draft-model').value = source.text; $('draft-source-uri').value = source.uri;
  project.presentation.activeSource = source.uri;
}
function installPhysical(value) {
  const next = createPreparedPhysicalProject(value.original, value.sources, value.presentation);
  clearObservation('Ready to analyze the physical project.'); project = next; version += 1;
  $('draft-mode').value = 'project'; $('draft-project-controls').hidden = false;
  $('draft-scope').textContent = 'Unvalidated KerML project. The native frozen-engine load parses and constructs every source into one model and reports parse diagnostics. Linking, standard libraries, language validation, semantic queries and publication are not provided by this mode.';
  $('draft-source-select').replaceChildren(...project.sources.map(source => {
    const option = document.createElement('option'); option.value = source.uri; option.textContent = source.uri; return option;
  }));
  $('draft-source-select').value = project.sources.some(source => source.uri === project.presentation.activeSource)
    ? project.presentation.activeSource : project.sources[0].uri;
  $('draft-original-select').replaceChildren(...project.original.bundle.sources.map(source => {
    const option = document.createElement('option'); option.value = source.id.uri; option.textContent = source.id.uri; return option;
  }));
  $('draft-original-select').value = project.original.bundle.sources.some(source => source.id.uri === project.presentation.activeSource)
    ? project.presentation.activeSource : project.original.ecore.uri;
  const active = project.presentation.activeSource; showOriginal(); showPhysicalSource(); project.presentation.activeSource = active;
}
function physicalEdit() {
  clearObservation(); physicalSource().text = $('draft-model').value;
  project.presentation.activeSource = physicalSource().uri; version += 1;
}
function showPhysicalDiagnostics(result) {
  const diagnostics = result.preview?.diagnostics ?? [];
  const groups = new Map(project.sources.map(source => [source.uri, []]));
  const general = [];
  for (const diagnostic of diagnostics) (groups.get(diagnostic.resource) ?? general).push(diagnostic);
  $('draft-source-errors').textContent = JSON.stringify({sources: [...groups].map(([uri, diagnostics]) => ({uri, diagnostics})),
    project_or_unmapped: general}, null, 2);
}
const legacyScope = $('draft-scope').innerHTML;
$('draft-mode').onchange = () => {
  try {
    if ($('draft-mode').value === 'project') {
      if (!physicalMode()) install(createPreparedPhysicalProject(project.original, [project.model]));
    } else if (physicalMode()) install(createPreparedDraftProject(project.original, physicalSource()));
  } catch (error) { $('draft-file-status').textContent = error.message; $('draft-mode').value = physicalMode() ? 'project' : 'single'; }
};
$('draft-source-select').onchange = showPhysicalSource;
$('draft-source-uri').onchange = () => {
  try {
    const current = physicalSource(), uri = $('draft-source-uri').value;
    const sources = project.sources.map(source => source === current ? {...source, uri} : source);
    install(createPreparedPhysicalProject(project.original, sources, {activeSource: uri}));
  } catch (error) { $('draft-file-status').textContent = error.message; $('draft-source-uri').value = physicalSource().uri; }
};
$('draft-source-add').onclick = () => {
  try {
    let index = 1;
    while (project.sources.some(source => source.uri === `memory://intersect/physical-project/source-${index}.kerml`)) index += 1;
    const source = {uri: `memory://intersect/physical-project/source-${index}.kerml`, text: 'package NewPackage {}'};
    install(createPreparedPhysicalProject(project.original, [...project.sources, source], {activeSource: source.uri}));
  } catch (error) { $('draft-file-status').textContent = error.message; }
};
$('draft-source-remove').onclick = () => {
  try {
    const selected = physicalSource();
    install(createPreparedPhysicalProject(project.original, project.sources.filter(source => source !== selected)));
  } catch (error) { $('draft-file-status').textContent = error.message; }
};

install(project);
