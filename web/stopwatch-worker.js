import init,{stopwatch_sources,run_stopwatch} from './pkg/examples_web.js';
try {
  await init();self.postMessage({type:'ready',sources:JSON.parse(stopwatch_sources())});
  self.onmessage=({data})=>{
    try{self.postMessage({type:'result',value:JSON.parse(run_stopwatch(data.text))});}
    catch(error){self.postMessage({type:'error',message:String(error.message||error)});}
  };
}catch(error){self.postMessage({type:'error',message:String(error)});}
