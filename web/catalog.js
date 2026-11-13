const $=id=>document.getElementById(id);
const worker=new Worker(new URL('catalog-worker.js',import.meta.url),{type:'module'});
let samples, timer;
function build(){
  $('objects').replaceChildren(); $('build').disabled=true;
  $('status').textContent='Parsing and linking both resources…';
  timer=setTimeout(()=>{worker.terminate();$('status').textContent='Run stopped after 30 seconds. Reload this page to restart.';},30000);
  worker.postMessage({types:$('types').value,shop:$('shop').value});
}
worker.onmessage=({data})=>{
  clearTimeout(timer);
  if(data.type==='ready'){
    samples=data.samples; [$('types').value,$('shop').value]=samples; $('reset').disabled=false;build();return;
  }
  $('build').disabled=false;
  if(data.type==='error'){$('status').textContent=data.message;return;}
  const objects=data.value.objects, rows=new Map();
  for(const object of objects){
    const row=document.createElement('tr'); rows.set(object.id,row);
    const label=document.createElement('td');label.textContent=object.name || object.class.split('#').pop();label.title=object.id;
    const resource=document.createElement('td');resource.textContent=object.resource;
    const links=document.createElement('td');
    for(const link of object.links){
      const button=document.createElement('button');
      button.textContent=`${link.feature} → ${objects.find(o=>o.id===link.target)?.name || link.target}`;
      button.onclick=()=>{for(const r of rows.values())r.classList.remove('selected');rows.get(link.target)?.classList.add('selected');rows.get(link.target)?.scrollIntoView({block:'nearest',behavior:'smooth'});};
      links.append(button);
    }
    row.append(label,resource,links);$('objects').append(row);
  }
  $('status').textContent=`${objects.length} linked objects; ${objects.reduce((n,o)=>n+o.links.length,0)} resolved type and superclass references.`;
};
worker.onerror=()=>{$('status').textContent='Runtime failed. Reload the page to restart.';};
$('build').onclick=build;
$('reset').onclick=()=>{[$('types').value,$('shop').value]=samples;build();};
window.addEventListener('pagehide',()=>{worker.terminate();clearTimeout(timer);});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
