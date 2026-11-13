import {test,expect} from '@playwright/test';
// Development-only direct transport entry; production uses the built UI tests.
test('worker source mode rejects model authority and retains no active package',async({page})=>{
  await page.goto('/prepared-draft.html');
  const result=await page.evaluate(async()=>{
    const {LanguageClient}=await import('/src/client.js');
    const client=new LanguageClient(()=>{},()=>{});
    try{
      await client.request('initialize');
      let invalid=false;try{await client.request('intersect/prepareKerMLDraft',{package:{}});}catch{invalid=true;}
      const inspect=await client.request('intersect/inspect');
      const rejected=[];
      for(const method of ['intersect/query','intersect/evaluateFunctionRcore','intersect/packageExport','intersect/compileBundle']){
        try{await client.request(method);rejected.push(false);}catch(error){rejected.push(/^Prepared drafts cannot/.test(error.message));}
      }
      return {invalid,package:inspect.package,evaluation:inspect.evaluation,mode:inspect.mode,rejected};
    }finally{client.dispose();}
  });
  expect(result).toEqual({invalid:true,package:null,evaluation:null,mode:'prepared-draft',rejected:[true,true,true,true]});
});
