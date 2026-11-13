// Host controls and byte transport. Rust owns resource and cache semantics.
import './resource-controls.css';
const BUNDLE = 'intersect.resource-files.v1';
export function createResourceControls(getClient, report) {
  const panel = document.createElement('details'); panel.className = 'resource-controls';
  panel.innerHTML = '<summary>Resources</summary><div class="resource-list" aria-label="Model resources"></div><div class="resource-actions"><input aria-label="New resource URI" placeholder="notes.library"><button type="button" data-action="create">New resource</button><button type="button" data-action="export">Export selected</button><button type="button" data-action="reload">Replace / reload selected</button><label><input type="checkbox" data-discard>Discard unsaved changes on unload</label><button type="button" data-action="unload">Unload selected</button><button type="button" data-action="remove">Delete selected</button><button type="button" data-action="prepareCache">Prepare library cache</button><button type="button" data-action="loadCache">Load library cache</button></div><span class="resource-status" role="status"></span><input type="file" data-files accept=".json" hidden>';
  document.querySelector('.inspector .panel-heading').after(panel);
  const list=panel.querySelector('.resource-list'), status=panel.querySelector('.resource-status'), file=panel.querySelector('[data-files]');
  let current=null,busy=false,pending=null;
  const selected=()=>[...list.querySelectorAll('input:checked')].map(input=>input.value);
  function update() {
    const selection=selected(),valid=current&&current.diagnostics.length===0;
    for(const button of panel.querySelectorAll('button')) {
      const action=button.dataset.action;
      button.disabled=busy||!current||(!['create','loadCache'].includes(action)&&selection.length===0)||(['export','prepareCache','create','remove','unload'].includes(action)&&!valid);
    }
  }
  const message=text=>{status.textContent=text;};
  async function run(action) {
    busy=true;update();
    try {await action();} catch(error) {message(error.message);report(error.message);} finally {busy=false;update();}
  }
  async function capture(action) {
    const client=getClient(),snapshot=await client.request('intersect/inspect');
    return {client,action,selected:selected(),interfaceRevision:snapshot.interfaceRevision,generation:snapshot.generation};
  }
  async function request(snapshot, extra={}) {
    if(snapshot.client!==getClient())throw new Error('Runtime restarted. Retry the resource action.');
    const {client,...params}=snapshot;
    return client.request('intersect/resources',{...params,...extra});
  }
  function download(name, bytes, type='application/json') {
    const url=URL.createObjectURL(new Blob([bytes],{type})),anchor=document.createElement('a');
    anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  panel.querySelector('.resource-actions').addEventListener('click',event=>{
    const action=event.target.closest('button')?.dataset.action;
    if(!action)return;
    run(async()=>{
      const snapshot=await capture(action);
      if(action==='reload'||action==='loadCache') {pending=snapshot;file.value='';file.click();return;}
      if(action==='export') {
        const result=await snapshot.client.request('intersect/modelExport',{format:'xmi',selected:snapshot.selected,closure:'selected'});
        download('model.resources.json',JSON.stringify({format:BUNDLE,codec:'xmi',resources:result.resources}));
        message(`Exported ${result.resources.length} selected resource(s).`);return;
      }
      if(action==='prepareCache') {
        const result=await request(snapshot);
        download('library.cache.json',new Uint8Array(result.bytes));
        message(`Prepared ${result.resources.length} resource(s), ${result.bytes.length} bytes.`);return;
      }
      await request(snapshot,action==='create'?{uri:panel.querySelector('[aria-label="New resource URI"]').value}:action==='unload'?{policy:panel.querySelector('[data-discard]').checked?'discard':'saved'}:{});
      message(action==='unload'?'Selected content unloaded. References remain unavailable until reload.':action==='remove'?'Selected resources deleted.':'Empty resource created.');
    });
  });
  file.onchange=()=>run(async()=>{
    const chosen=file.files[0],snapshot=pending;pending=null;
    if(!chosen||!snapshot)return;
    if(chosen.size>500_000)throw new Error('Resource file exceeds the 500 KB browser limit.');
    const bytes=new Uint8Array(await chosen.arrayBuffer());
    if(snapshot.action==='loadCache')await request(snapshot,{bytes:Array.from(bytes)});
    else {
      const bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(bundle.format!==BUNDLE||bundle.codec!=='xmi'||!Array.isArray(bundle.resources)||Object.keys(bundle).some(key=>!['format','codec','resources'].includes(key)))throw new Error('Choose an exported resource bundle.');
      await request(snapshot,{resources:bundle.resources});
    }
    message(snapshot.action==='loadCache'?'Prepared library loaded and validated.':'Selected resources reloaded and validated.');
  });
  list.onchange=update;
  return {
    model(result) {
      const keep=new Set(selected());current=result;list.replaceChildren();
      for(const [uri,record] of Object.entries(result.model.resources??{})) {
        const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
        input.type='checkbox';input.value=uri;input.checked=keep.has(uri);input.setAttribute('aria-label',`Select resource ${uri}`);
        text.textContent=`${uri} · ${record.load_state}`;label.append(input,text);list.append(label);
      }
      update();
    },
    reset() {current=null;pending=null;list.replaceChildren();message('');update();},
  };
}
