const $=id=>document.getElementById(id);
const worker=new Worker(new URL('stopwatch-worker.js',import.meta.url),{type:'module'});
let sample,result,entries=[],index=0,animation,timer;
function stop(){clearTimeout(animation);animation=undefined;$('play').textContent='Play replay';}
function render(){
  const entry=entries[index];if(!entry)return;
  const observation=entry.observation;
  $('position').value=index;
  $('elapsed').textContent=`${observation.elapsed_ms} ms`;
  $('clock').textContent=`simulation: ${entry.time} ms`;
  $('event').textContent=`${entry.label} · ${observation.state}`;
  for(const node of $('machine').children)node.classList.toggle('active',node.dataset.state===observation.state);
  for(const [i,node]of [...$('events').children].entries())node.style.color=i===index?'#68e0bd':'';
}
function clear(){stop();result=undefined;entries=[];$('download').disabled=$('play').disabled=$('step').disabled=$('position').disabled=true;}
function run(){
  clear();$('run').disabled=true;$('status').textContent='Parsing commands, binding Rcore and running the scheduler…';
  timer=setTimeout(()=>{worker.terminate();$('status').textContent='Run timed out. Reload the page to restart.';},30000);
  worker.postMessage({text:$('script').value});
}
worker.onmessage=({data})=>{
  clearTimeout(timer);$('run').disabled=false;
  if(data.type==='ready'){
    sample=data.sources.text;$('script').value=sample;$('rcore').textContent=data.sources.rcore;$('reset').disabled=false;run();return;
  }
  if(data.type==='error'){$('status').textContent=data.message;return;}
  result=data.value;entries=result.trace.entries.filter(e=>e.observation);index=0;
  $('machine').replaceChildren(...result.machine.states.map(state=>{const node=document.createElement('span');node.className='state';node.dataset.state=state;node.textContent=state;return node;}));
  $('transitions').replaceChildren(...result.machine.transitions.map(t=>{const li=document.createElement('li');li.textContent=`${t.from} — ${t.command} → ${t.to}`;return li;}));
  $('events').replaceChildren(...entries.map((entry,i)=>{const li=document.createElement('li');li.textContent=`${entry.time} ms: ${entry.label} · ${entry.observation.state} · elapsed ${entry.observation.elapsed_ms} ms`;li.onclick=()=>{stop();index=i;render();};return li;}));
  $('position').max=entries.length-1;$('position').value=0;
  $('download').disabled=$('play').disabled=$('step').disabled=$('position').disabled=false;
  $('status').textContent=`${result.reason}: ${result.summary.state}, elapsed ${result.summary.elapsed_ms} ms at simulation time ${result.summary.time_ms} ms. Replay shows recorded observations.`;
  render();
};
worker.onerror=()=>{$('status').textContent='Runtime failed. Reload to restart.';clearTimeout(timer);};
$('run').onclick=run;
$('reset').onclick=()=>{$('script').value=sample;run();};
$('step').onclick=()=>{stop();index=Math.min(index+1,entries.length-1);render();};
$('position').oninput=()=>{stop();index=Number($('position').value);render();};
$('play').onclick=()=>{
  if(animation){stop();return;}if(index===entries.length-1)index=0;
  $('play').textContent='Pause';
  const next=()=>{render();if(index===entries.length-1){stop();return;}index++;animation=setTimeout(next,450);};next();
};
$('script').oninput=()=>{$('status').textContent='Commands changed. Run again to refresh the recorded trace.';clear();};
$('download').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(result.trace,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='stopwatch.trace.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('pagehide',()=>{worker.terminate();clearTimeout(timer);stop();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
