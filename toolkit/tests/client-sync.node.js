import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LanguageClient } from '../src/client.js';

function fixture(t) {
  const previous = globalThis.Worker;
  class Worker {
    messages = [];
    terminated = false;
    postMessage(value) { if (this.fail) throw new Error('transport failed'); this.messages.push(structuredClone(value)); }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = Worker;
  const failures = [];
  const client = new LanguageClient(() => {}, message => failures.push(message));
  t.after(() => { client.dispose(); globalThis.Worker = previous; });
  return { client, worker: client.worker, failures };
}
const change = (uri, version, text) => ({textDocument:{uri,version},contentChanges:[{text}]});

test('a full editor burst sends its complete newest source once', async t => {
  const {client, worker} = fixture(t);
  const text = 'library Branch { member grace; }';
  for (let index = 1; index <= text.length; index++) client.notify('textDocument/didChange', change('file:///branch.library', index+1, text.slice(0,index)));
  assert.equal(worker.messages.length, 0);
  await Promise.resolve();
  assert.deepEqual(worker.messages, [{jsonrpc:'2.0',method:'textDocument/didChange',params:change('file:///branch.library',33,text)}]);
});

test('requests flush exact input first and preserve increasing version authority', async t => {
  const {client, worker} = fixture(t);
  const input = change('file:///branch.library', 5, 'complete source');
  client.notify('textDocument/didChange', input);
  input.contentChanges[0].text = 'caller mutation';
  client.notify('textDocument/didChange', change('file:///branch.library',4,'older source'));
  client.notify('textDocument/didChange', change('file:///branch.library',5,'equal version replacement'));
  const result = client.request('intersect/inspect');
  assert.deepEqual(worker.messages.map(message => message.method), ['textDocument/didChange','intersect/inspect']);
  assert.deepEqual(worker.messages[0].params, change('file:///branch.library',5,'complete source'));
  worker.onmessage({data:{id:worker.messages[1].id,result:{revision:7}}});
  assert.deepEqual(await result, {revision:7});
  await Promise.resolve();
  assert.equal(worker.messages.length, 2);
});

test('other documents, notifications and ranged updates preserve transport order', async t => {
  const {client, worker} = fixture(t);
  client.notify('textDocument/didChange', change('file:///a',1,'a'));
  client.notify('textDocument/didChange', change('file:///b',1,'b'));
  client.notify('textDocument/didClose', {textDocument:{uri:'file:///a'}});
  const ranged = {textDocument:{uri:'file:///b',version:2},contentChanges:[{range:{start:{line:0,character:0},end:{line:0,character:1}},text:'c'}]};
  client.notify('textDocument/didChange',ranged);
  assert.deepEqual(worker.messages.map(message => [message.method,message.params.textDocument.uri]), [['textDocument/didChange','file:///a'],['textDocument/didChange','file:///b'],['textDocument/didClose','file:///a'],['textDocument/didChange','file:///b']]);
  assert.deepEqual(worker.messages[3].params,ranged);
  await Promise.resolve();
  assert.equal(worker.messages.length,4);
});

test('disposal drops deferred input and asynchronous transport failure stops the client', async t => {
  const {client, worker, failures} = fixture(t);
  client.notify('textDocument/didChange',change('file:///a',1,'a'));
  client.dispose();
  await Promise.resolve();
  assert.equal(worker.messages.length,0);
  assert.equal(client.pendingDocumentChange,null);
  assert.equal(worker.terminated,true);
  assert.deepEqual(failures,[]);
  const failed = new LanguageClient(() => {}, message => failures.push(message));
  failed.worker.fail=true;
  failed.notify('textDocument/didChange',change('file:///b',1,'b'));
  await Promise.resolve();
  assert.equal(failed.disposed,true);
  assert.equal(failed.pendingDocumentChange,null);
  assert.deepEqual(failures,['transport failed']);
  await assert.rejects(failed.request('intersect/inspect'),/Language worker stopped/);
});
