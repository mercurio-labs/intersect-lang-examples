import './library-text.css';
import machineModel from '../.runtime/intersect-text/fixtures/xtext/model-to-text/machine.rcore?raw';
import machineGrammar from '../.runtime/intersect-text/fixtures/xtext/model-to-text/machine.xtext?raw';
import expressionModel from '../.runtime/intersect-text/fixtures/xtext/model-to-text/expressions.rcore?raw';
import expressionGrammar from '../.runtime/intersect-text/fixtures/xtext/model-to-text/expressions.xtext?raw';
import recordModel from '../.runtime/intersect-text/fixtures/xtext/model-to-text/records.rcore?raw';
import recordGrammar from '../.runtime/intersect-text/fixtures/xtext/model-to-text/records.xtext?raw';
import paintModel from '../.runtime/intersect-text/fixtures/xtext/model-to-text/paint.rcore?raw';
import paintGrammar from '../.runtime/intersect-text/fixtures/xtext/model-to-text/paint.xtext?raw';
import modifierModel from '../.runtime/intersect-text/fixtures/xtext/model-to-text/modifiers.rcore?raw';
import modifierGrammar from '../.runtime/intersect-text/fixtures/xtext/model-to-text/modifiers.xtext?raw';
import common from '../.runtime/intersect-text/fixtures/definition-conformance/upstream/xtext/org/eclipse/xtext/common/Terminals.xtext?raw';

const examples={
 modifiers:{model:modifierModel,grammar:modifierGrammar,text:'private /* retain */ static final\r\n'},
 paint:{model:paintModel,grammar:paintGrammar,text:'paint P #123abc; // keep original spelling\r\n',conversions:[{fragment:'#//RGB',provider:{name:'example.rgb',version:'1'},serializable:true}]},
 machine:{model:machineModel,grammar:machineGrammar,text:"// Keep authored layout. 😀\r\nmachine M {\r\n  state start label 'Start'; // retained\r\n  edge step start -> end;\r\n  state end final;\r\n}\r\n"},
 expressions:{model:expressionModel,grammar:expressionGrammar,text:'calc 01 /* left */ + (2 + 3) // final\n'},
 records:{model:recordModel,grammar:recordGrammar,text:'doc [Sample:x]!!! path Alpha::Beta slow 2147483647'},
};
const app=document.querySelector('#model-text-app');
app.innerHTML=`<header><div><a href="./">Intersect Toolkit</a><h1>Xtext <span>model ↔ text</span></h1><p>Generate and preserve text from your language definitions.</p></div><label>Example<select id="example"><option value="machine">State machine</option><option value="expressions">Expressions</option><option value="records">Records and datatypes</option><option value="paint">Custom RGB converter</option><option value="modifiers">Unordered modifiers</option></select></label></header>
<div class="status-line"><p id="status" role="status">Preparing language…</p><div><button id="undo" disabled>Undo</button><button id="redo" disabled>Redo</button></div></div><p id="error" role="alert" hidden></p>
<section><details><summary>Language definitions</summary><label>Namespace<input id="namespace" value="urn:general-text"></label><div class="sources"><label>Rcore<textarea id="structure" spellcheck="false"></textarea></label><label>Xtext grammar<textarea id="grammar" spellcheck="false"></textarea></label></div><label>Native conversion bindings (JSON)<textarea id="conversions" spellcheck="false">[]</textarea></label><p>The example bundle includes pinned common.Terminals. Use the API with a complete compilation bundle for additional dependencies.</p></details><button id="compile">Compile language and load text</button></section>
<section><div class="section-heading"><h2>Authored source</h2><div><button id="apply-text" disabled>Apply text</button><button id="discard" disabled>Discard text edits</button></div></div><div id="sources"></div></section>
<section class="workspace"><div><h2>Model</h2><label>Selected object<select id="object"></select></label><pre id="values" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></div><div><h2>Edit a feature</h2><form id="edit"><label>Feature<select id="feature"></select></label><label>Value (JSON)<input id="value"></label><button id="save">Save feature</button></form><details><summary>Batch model transaction</summary><p>Create objects, change features or delete subtrees in one verified transaction. Reference values are model IDs shown on the left.</p><label>Transaction (JSON)<textarea id="transaction" spellcheck="false">{"changes":[],"creates":[],"deletes":[]}</textarea></label><button id="batch">Apply transaction</button></details></div></section>
<section><div class="section-heading"><h2>Canonical generation</h2><button id="generate">Generate verified text</button></div><pre id="generated" style="white-space:pre-wrap"></pre></section>
<footer>Parsing, model edits, grammar inversion, source preservation and verification run in shared Rust/WASM services. Unsupported definitions and unrepresentable models report errors. Work is retained in this browser session.</footer>`;
const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./library-text.worker.js',import.meta.url),{type:'module'});
let serial=0,epoch=0,state=null,busy=false,dirty=false,definitionsDirty=false,renderedSources=[];const pending=new Map();
function request(request){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,request});});}
worker.onmessage=({data})=>{const task=pending.get(data.id);if(task){pending.delete(data.id);data.error?task.reject(new Error(data.error)):task.resolve(data.result);}};
worker.onerror=event=>{for(const task of pending.values())task.reject(new Error(event.message));pending.clear();fail(new Error('Runtime worker failed. Reload to restart.'));};
function fail(error){$('error').textContent=error.message;$('error').hidden=false;}
function status(message){$('status').textContent=message;}
function controls(){
 $('compile').disabled=busy;$('example').disabled=busy;
 for(const name of ['object','feature','value','transaction'])$(name).disabled=busy||dirty||!state;
 for(const name of ['save','batch','generate'])$(name).disabled=busy||dirty||!state;
 for(const name of ['save','object','feature','value'])$(name).disabled ||= !state?.evaluation.model.elements.length;
 $('apply-text').disabled=busy||!dirty||definitionsDirty||!state;$('discard').disabled=busy||!dirty||definitionsDirty||!state;
 $('undo').disabled=busy||dirty||!state?.undo;$('redo').disabled=busy||dirty||!state?.redo;
}
function changed(definitions=false){epoch++;dirty=true;definitionsDirty ||= definitions;controls();status(definitionsDirty?'Definitions changed. Compile to start a new session.':'Text changed. Apply it to update the model.');if(state)request({method:'modelText/invalidate'}).catch(fail);}
function sources(){return [...$('sources').querySelectorAll('textarea')].map(t=>{const original=renderedSources.find(s=>s.uri===t.dataset.uri);return original&&original.text.replace(/\r\n?/g,'\n')===t.value?{...original}:{uri:t.dataset.uri,text:t.value};});}
function renderSources(values){renderedSources=values.map(s=>({...s}));$('sources').replaceChildren(...values.map(source=>{const label=document.createElement('label');label.textContent=source.uri;const input=document.createElement('textarea');input.dataset.uri=source.uri;input.setAttribute('aria-label',`${source.uri} source`);input.value=source.text;input.spellcheck=false;input.oninput=()=>changed();label.append(input);return label;}));}
function current(){return state?.evaluation.model.elements.find(e=>e.id===$('object').value);}
function fields(){const e=current();if(!e){$('values').textContent='No entry object.';$('feature').replaceChildren();$('value').value='';return;}$('values').textContent=JSON.stringify({id:e.id,class:e.class,values:e.values},null,2);const old=$('feature').value;$('feature').replaceChildren(...Object.keys(e.values).map(name=>{const o=document.createElement('option');o.value=name;o.textContent=name;return o;}));if(Object.hasOwn(e.values,old))$('feature').value=old;field();}
function field(){const e=current();$('value').value=JSON.stringify(e?.values[$('feature').value]??null);}
function accept(next,message='Model and source agree.'){
 state=next;dirty=false;definitionsDirty=false;const old=$('object').value;
 $('object').replaceChildren(...next.evaluation.model.elements.map(e=>{const o=document.createElement('option');o.value=e.id;o.textContent=`${e.class} ${e.values.name??e.values.value??e.id}`;return o;}));
 if(next.evaluation.model.elements.some(e=>e.id===old))$('object').value=old;
 renderSources(next.sources);fields();status(message);$('error').hidden=true;controls();
}
async function definition(uri,kind,text,dependencies=[]){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return{id:{uri,sha256:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')},kind,text,dependencies};}
async function compilation(){
 const model=await definition('memory:general.rcore','rcore',$('structure').value);
 const terminals=await definition('classpath:/org/eclipse/xtext/common/Terminals.xtext','xtext',common,[model.id]);
 const grammar=await definition('memory:general.xtext','xtext',$('grammar').value,[model.id,terminals.id]);
 return{materialized_types:[],ecore:model.id,namespace:$('namespace').value,xtext:grammar.id,rcore_behavior:model.id,bundle:{version:1,sources:[model,grammar,terminals],namespaces:[]}};
}
async function load(compile=false,discard=false){const start=++epoch;busy=true;status(compile?'Compiling language…':discard?'Restoring accepted text…':'Applying text…');controls();$('error').hidden=true;try{
 const authored=sources();const inputs=compile?await compilation():null;
 const result=await request({method:compile?'modelText/start':discard?'modelText/discard':'modelText/load',...(compile?{compilation:inputs,conversion_bindings:JSON.parse($('conversions').value)}:{}),...(discard?{}:{sources:authored})});if(start===epoch)accept(result);
 }catch(error){if(start===epoch){dirty=true;fail(error);status('Text was not accepted. The last accepted model is retained.');}}finally{busy=false;controls();}}
async function change(action){if(busy||dirty)return;const start=epoch;busy=true;controls();$('error').hidden=true;try{
 const prepared=await request({method:'modelText/prepare',action});if(start!==epoch)return;
 const result=await request({method:'modelText/commit',token:prepared.token});if(start===epoch)accept(result,'Changes applied to model and source.');
 }catch(error){if(start===epoch)fail(error);}finally{busy=false;controls();}}
$('object').onchange=fields;$('feature').onchange=field;
$('edit').onsubmit=event=>{event.preventDefault();try{change({kind:'transaction',changes:[[$('object').value,$('feature').value,JSON.parse($('value').value)]]});}catch(error){fail(error);}};
$('batch').onclick=()=>{try{change({kind:'transaction',...JSON.parse($('transaction').value)});}catch(error){fail(error);}};
$('undo').onclick=()=>change({kind:'undo'});$('redo').onclick=()=>change({kind:'redo'});
$('compile').onclick=()=>load(true);$('apply-text').onclick=()=>load();$('discard').onclick=()=>load(false,true);
for(const name of ['structure','grammar','namespace','conversions'])$(name).oninput=()=>changed(true);
$('generate').onclick=async()=>{const start=epoch;busy=true;controls();try{const result=await request({method:'modelText/serialize'});if(start===epoch)$('generated').textContent=result.sources.map(s=>`${s.uri}:\n${s.text}`).join('\n\n');}catch(error){if(start===epoch)fail(error);}finally{busy=false;controls();}};
function example(){const value=examples[$('example').value];$('conversions').value=JSON.stringify(value.conversions??[],null,2);$('structure').value=value.model;$('grammar').value=value.grammar;$('namespace').value='urn:general-text';renderSources([{uri:'example.test',text:value.text}]);$('generated').textContent='';load(true);}
$('example').onchange=example;
window.modelText={request,get state(){return state;}};
example();
