// Handwritten UI transport. Native inference owns candidates and contracts.
export function createInferredProviderControls({host,enabled,draft,setDraft,clear,prepare,request,stamp,changed}) {
  const box=document.createElement('details');box.className='inferred-provider-controls';
  box.innerHTML='<summary>Native providers</summary><p data-active>No active provider context.</p><p>Select an original behavior source and authored computed members. Compile to check the selected provider.</p><button type="button" data-enable>Enable provider project</button><button type="button" data-discover>Discover authored settings</button><button type="button" data-clear>Clear provider selections</button><label>Behavior source <select aria-label="Provider behavior source"></select></label><div data-members></div><details><summary>Selection draft</summary><label>Native selector JSON <textarea aria-label="Native provider selection draft" rows="8"></textarea></label></details><p role="status"></p>';
  host.append(box);
  const status=box.querySelector('[role=status]'),text=box.querySelector('textarea'),behavior=box.querySelector('select'),members=box.querySelector('[data-members]');
  let generation=0,selection=null,candidates=[],ownerStamp=null;
  const key=c=>JSON.stringify([c.source,c.namespace,c.class,c.feature,c.provider]);
  function write(value){setDraft(JSON.stringify(value,null,2));refresh(true);ownerStamp=stamp();}
  function parse(){const value=JSON.parse(draft());if(value?.version!==1||!Array.isArray(value.computed_settings))throw new Error('Select or repair the native provider draft.');return value;}
  function clearPresentation(){behavior.replaceChildren();members.replaceChildren();candidates=[];selection=null;ownerStamp=null;}
  function refresh(keep=false){if(!keep)clearPresentation();const value=draft();text.value=value??'';box.querySelector('[data-enable]').hidden=value!==null;box.querySelector('[data-clear]').disabled=value===null;if(value===null){behavior.replaceChildren();members.replaceChildren();selection=null;candidates=[];}else{try{selection=parse();}catch{selection=null;}}}
  text.oninput=()=>{generation++;setDraft(text.value);clearPresentation();status.textContent='Selection draft changed. Compile to check it.';};
  box.querySelector('[data-enable]').onclick=()=>{write({version:1,behavior:null,computed_settings:[]});status.textContent='Add original behavior sources with Manage sources, then discover settings.';};
  box.querySelector('[data-clear]').onclick=()=>{generation++;clear();refresh();changed();status.textContent='Provider draft cleared. The last successful language remains available for recovery.';};
  behavior.onchange=()=>{try{if(ownerStamp!==stamp())throw new Error('Sources or selections changed. Discover current settings again.');const current=parse(),source=JSON.parse(behavior.value);write({...current,behavior:source});}catch(error){status.textContent=error.message;}};
  box.querySelector('[data-discover]').onclick=async()=>{
    const token=++generation;status.textContent='Reading original source candidates...';
    try{
      if(draft()===null)write({version:1,behavior:null,computed_settings:[]});
      const before=stamp(),input=await prepare();
      if(token!==generation||before!==stamp())throw new Error('Sources changed during discovery. Retry with current drafts.');
      const result=await request('intersect/inferredProviderCandidates',{inference:input});
      if(token!==generation||before!==stamp())throw new Error('Sources changed during discovery. Retry with current drafts.');
      if(!result.ok)throw new Error((result.diagnostics||[]).map(d=>d.message).join(' ')||'Native candidate discovery failed.');
      selection=parse();candidates=result.candidates;behavior.replaceChildren();
      const empty=document.createElement('option');empty.value='null';empty.textContent='Choose original behavior source';behavior.append(empty);
      for(const source of input.bundle.sources.filter(s=>s.kind==='rcore_behavior'||s.kind==='rcore')){const option=document.createElement('option');option.value=JSON.stringify(source.id);option.textContent=source.id.uri;behavior.append(option);}
      behavior.value=JSON.stringify(selection.behavior??null);members.replaceChildren();
      for(const candidate of candidates){
        const row=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=`${candidate.namespace} / ${candidate.class}.${candidate.feature}`;row.append(title);
        const selected=selection.computed_settings.find(c=>key(c)===key(candidate));
        for(const operation of candidate.operations){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!!selected?.operations.includes(operation);check.setAttribute('aria-label',`${candidate.class}.${candidate.feature} ${operation}`);label.append(check,document.createTextNode(operation));row.append(label);
          check.onchange=()=>{if(ownerStamp!==stamp()){check.checked=!check.checked;status.textContent='Sources or selections changed. Discover current settings again.';return;}const current=parse(),previous=current.computed_settings.find(c=>key(c)===key(candidate)),operations=new Set(previous?.operations||[]);if(check.checked)operations.add(operation);else operations.delete(operation);current.computed_settings=current.computed_settings.filter(c=>key(c)!==key(candidate));if(operations.size)current.computed_settings.push({...candidate,operations:[...operations]});write(current);};
        }members.append(row);
      }
      ownerStamp=stamp();
      status.textContent=`${candidates.length} authored setting candidates. Structural discovery does not qualify a provider.${result.unsupported?.length?` ${result.unsupported.length} unsupported members.`:''}`;
    }catch(error){if(token===generation)status.textContent=error.message;}
  };
  return {refresh,showActive(context){const providers=[...new Set((context?.computed_settings||[]).map(c=>`${c.provider.name}@${c.provider.version}`))];box.querySelector('[data-active]').textContent=context?`Active provider context: ${providers.join(', ')||'native catalog'}${context.behavior?` | ${context.behavior.uri} @ ${context.behavior.sha256.slice(0,12)}`:''}`:'No active provider context.';},setActive(value){host.hidden=!value;if(!value){generation++;box.open=false;clearPresentation();}refresh();},close(){generation++;box.open=false;clearPresentation();},isEnabled:enabled};
}
