import './library-text.css';
const app=document.querySelector('#library-app');
app.innerHTML=`<header><div><a href="./">Intersect Toolkit</a><h1>Library <span>model ↔ text</span></h1><p>Edit the model. Keep your source.</p></div><button id="reset">Reset example</button></header>
<div class="status-line"><p id="status" role="status">Loading the local Rust/WASM runtime…</p><div><button id="undo" disabled>Undo</button><button id="redo" disabled>Redo</button></div></div><p id="error" role="alert" hidden></p>
<section><div class="section-heading"><h2>Authored source</h2><div><button id="apply-text" disabled>Apply text</button><button id="discard" disabled>Discard text edits</button></div></div><div id="sources" class="sources"></div></section>
<section class="workspace"><div><h2>Model</h2><label>Selected object<select id="object"></select></label><table><thead><tr><th>Class</th><th>Name</th><th>State</th></tr></thead><tbody id="objects"></tbody></table></div>
<div class="editors"><h2>Edit selected object</h2><form id="rename-form"><label>Name<input id="name" required></label><button>Rename</button></form><form id="title-form"><label>Title<input id="title"></label><button>Save title</button></form><form id="edition-form"><label>Edition<input id="edition" type="number" min="0"></label><button>Save edition</button></form>
<form id="copy-form"><label>Loan copy<select id="copy"></select></label><button>Change copy</button></form><form id="member-form"><label>Loan member<select id="member"></select></label><button>Change member</button></form>
<div class="actions"><button id="move-up">Move up</button><button id="move-down">Move down</button><button id="delete">Delete object</button></div>
<h2>Add a Loan</h2><form id="add-form"><label>Loan name<input id="loan-name" value="second" required></label><label>Book copy<select id="new-copy"></select></label><label>Member<select id="new-member"></select></label><button>Add Loan</button></form></div></section>
<footer>Runs locally through the shared Rust model and text services. Single-token fields and leaf declarations are supported. Deletion retains comments; movement carries internal comments and leaves surrounding comments in place. History is in memory.</footer>`;
const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./library-text.worker.js',import.meta.url),{type:'module'});
let number=0,epoch=0,state=null,selected=null,busy=false,dirty=false;const pending=new Map();
function request(request){return new Promise((resolve,reject)=>{const id=++number;pending.set(id,{resolve,reject});worker.postMessage({id,request});});}
worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);data.error?task.reject(new Error(data.error)):task.resolve(data.result);};
worker.onerror=event=>{for(const task of pending.values())task.reject(new Error(event.message));pending.clear();fail(new Error('Runtime worker failed. Reload this page to restart it.'));};
function fail(error){$('error').textContent=error.message;$('error').hidden=false;}
function status(text){$('status').textContent=text;}
function display(value){return value?.kind==='int64'?value.value:value??0;}
function elements(){return state?.evaluation.model.elements??[];}
function object(){return elements().find(e=>e.id===selected);}
function option(select,items,value){select.replaceChildren(...items.map(e=>{const o=document.createElement('option');o.value=e.id;o.textContent=e.values.name??e.class;return o;}));if(items.some(e=>e.id===value))select.value=value;}
function controls(){
  for(const button of app.querySelectorAll('button'))button.disabled=busy||!state;
  $('reset').disabled=busy;
  $('apply-text').disabled=busy||!dirty;$('discard').disabled=busy||!dirty;
  for(const button of app.querySelectorAll('.editors button'))button.disabled=busy||dirty||!object();
  $('undo').disabled=busy||dirty||!state?.undo;$('redo').disabled=busy||dirty||!state?.redo;
  const e=object();$('delete').disabled=busy||dirty||!e||e.class==='Library';
  const collection=elements().flatMap(owner=>Object.values(owner.values).filter(Array.isArray)).find(v=>v.includes(selected));
  $('move-up').disabled=busy||dirty||!collection||collection.indexOf(selected)<=0;
  $('move-down').disabled=busy||dirty||!collection||collection.indexOf(selected)>=collection.length-1;
}
function selectedFields(){
  const e=object();if(!e)return;
  $('name').value=e.values.name??'';$('title').value=e.values.title??'';$('edition').value=e.values.edition??1;
  $('title-form').hidden=$('edition-form').hidden=e.class!=='BookCopy';
  $('copy-form').hidden=$('member-form').hidden=e.class!=='Loan';
  option($('copy'),elements().filter(e=>e.class==='BookCopy'),e.values.copy);
  option($('member'),elements().filter(e=>e.class==='Member'),e.values.member);controls();
}
function accept(next,message){
  state=next;dirty=false;
  if(!elements().some(e=>e.id===selected))selected=elements().find(e=>e.class==='Loan')?.id??elements()[0]?.id;
  $('sources').replaceChildren(...next.sources.map(source=>{const label=document.createElement('label');label.textContent=source.uri;const textarea=document.createElement('textarea');textarea.setAttribute('aria-label',`${source.uri} source`);textarea.dataset.uri=source.uri;textarea.value=source.text;textarea.spellcheck=false;textarea.addEventListener('input',()=>{epoch++;dirty=true;status('Text changed. Apply it to update the model; model actions are paused.');controls();request({method:'library/invalidate'}).catch(fail);});label.append(textarea);return label;}));
  option($('object'),elements(),selected);
  $('objects').replaceChildren(...elements().map(e=>{const row=document.createElement('tr');row.dataset.id=e.id;const derived=next.evaluation.derived[e.id]??{};for(const value of [e.class,e.values.name??'',e.class==='BookCopy'?(derived.available?'available':'on loan'):e.class==='Library'?`${display(derived.copyCount)} copies`:'']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}row.addEventListener('click',()=>{selected=e.id;$('object').value=selected;selectedFields();});return row;}));
  const available=elements().find(e=>e.class==='BookCopy'&&next.evaluation.derived[e.id]?.available);
  option($('new-copy'),elements().filter(e=>e.class==='BookCopy'),available?.id);option($('new-member'),elements().filter(e=>e.class==='Member'));
  selectedFields();status(message??'Model and source agree.');$('error').hidden=true;controls();
}
async function change(action){
  if(busy||dirty)return;const start=epoch;busy=true;controls();$('error').hidden=true;
  try{const proposal=await request({method:'library/prepare',action});if(start!==epoch)return;
    const result=await request({method:'library/commit',token:proposal.token});if(start!==epoch)return;
    accept(result,'Changes applied to model and source.');
  }catch(error){if(start===epoch)fail(error);}finally{busy=false;controls();}
}
async function load(reset=false,discard=false){const start=++epoch;busy=true;controls();try{
  const sources=[...app.querySelectorAll('textarea')].map(t=>({uri:t.dataset.uri,text:t.value}));
  const result=await request({method:reset?'library/start':discard?'library/discard':'library/load',...(reset||discard?{}:{sources})});
  if(start===epoch)accept(result);
}catch(error){if(start===epoch){dirty=true;fail(error);status('Text was not accepted. The last accepted model is retained.');}}finally{busy=false;controls();}}
$('object').onchange=()=>{selected=$('object').value;selectedFields();};
for(const [form,feature,input,convert] of [['rename-form','name','name',v=>v],['title-form','title','title',v=>v],['edition-form','edition','edition',Number],['copy-form','copy','copy',v=>v],['member-form','member','member',v=>v]])$(form).onsubmit=event=>{event.preventDefault();change({kind:'set',id:selected,feature,value:convert($(input).value)});};
$('add-form').onsubmit=event=>{event.preventDefault();change({kind:'add_loan',name:$('loan-name').value,copy:$('new-copy').value,member:$('new-member').value});};
$('delete').onclick=()=>change({kind:'delete',id:selected});
for(const [button,delta]of [['move-up',-1],['move-down',1]])$(button).onclick=()=>{const values=elements().flatMap(owner=>Object.values(owner.values).filter(Array.isArray)).find(v=>v.includes(selected));if(values)change({kind:'move',id:selected,position:values.indexOf(selected)+delta});};
$('undo').onclick=()=>change({kind:'undo'});$('redo').onclick=()=>change({kind:'redo'});
$('reset').onclick=()=>load(true);$('apply-text').onclick=()=>load();$('discard').onclick=()=>load(false,true);
// Transport-only inspection hook for acceptance. Rust owns all proposals/state.
window.libraryText={request,get state(){return state;},get epoch(){return epoch;}};
load(true);
