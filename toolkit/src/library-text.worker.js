import {loadRuntime} from './runtime.js';
const runtime=loadRuntime();let context=null;
self.onmessage=async ({data})=>{
  try {
    const invoke=await runtime;
    const result=invoke({...data.request,context:data.request.context??context});
    if(result.context)context=result.context;
    self.postMessage({id:data.id,result});
  }catch(error){
    try{context=(await runtime)({method:`${data.request.method.split('/')[0]}/inspect`}).context;}catch{/* first load can fail */}
    self.postMessage({id:data.id,error:error.message});
  }
};
