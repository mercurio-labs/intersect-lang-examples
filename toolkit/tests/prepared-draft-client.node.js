import test from 'node:test';
import assert from 'node:assert/strict';
import {LanguageClient} from '../src/client.js';

test('draft watchdog and host abort are isolated from ordinary and callable requests',async()=>{
  const original={Worker:globalThis.Worker,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const timers=new Map();let next=0;
  class Worker {
    constructor(){this.messages=[];this.terminated=false;}
    postMessage(value){this.messages.push(value);}
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=Worker;
  globalThis.setTimeout=(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  try {
    const client=new LanguageClient(()=>{},()=>{}),signal=new AbortController();
    const request=client.request('intersect/prepareKerMLDraft',{}, {signal:signal.signal});
    assert.equal([...timers.values()][0].ms,120000);
    signal.abort();await assert.rejects(request,/Draft analysis stopped/);
    assert.equal(client.worker.terminated,true);assert.equal(timers.size,0);
    const ordinary=new LanguageClient(()=>{},()=>{});
    const pending=ordinary.request('intersect/inspect');
    const timer=[...timers.values()][0];assert.equal(timer.ms,15000);
    timer.fn();await assert.rejects(pending,/time budget/);assert.equal(ordinary.worker.terminated,true);
    const callable=new LanguageClient(()=>{},()=>{}),cancel=new AbortController();
    const evaluation=callable.request('intersect/evaluateFunctionRcore',{}, {signal:cancel.signal});
    assert.equal([...timers.values()][0].ms,15000);
    cancel.abort();assert.equal(callable.worker.terminated,false);
    assert.equal(callable.worker.messages.at(-1).method,'$/cancelRequest');
    assert.equal([...timers.values()][0].ms,5000);
    callable.worker.onmessage({data:{id:1,result:{cancelled:true}}});
    assert.deepEqual(await evaluation,{cancelled:true});assert.equal(timers.size,0);callable.dispose();
    const timeout=new LanguageClient(()=>{},()=>{});
    const draftTimeout=timeout.request('intersect/prepareKerMLDraft');
    [...timers.values()][0].fn();await assert.rejects(draftTimeout,/time budget/);
    assert.equal(timeout.worker.terminated,true);assert.equal(timers.size,0);
  }finally{Object.assign(globalThis,original);}
});
