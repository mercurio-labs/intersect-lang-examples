import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=(uri,text)=>({id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind:'xtext',text,dependencies:[]});
const inputs=(sources,entry)=>({version:1,bundle:{version:1,sources,namespaces:[]},grammar:entry.id});
const ecore='import "http://www.eclipse.org/emf/2002/Ecore" as ecore';
const grammar=body=>`grammar diag.Model\ngenerate model "urn:diag:model"\n${ecore}\n${body}`;
async function boot(page){
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 await page.addInitScript(()=>{const Base=window.Worker;window.Worker=class extends Base{
  constructor(url,options){super(url,options);this.isLanguage=String(url).includes('language.worker');this.requests=new Map();if(this.isLanguage)window.diagnosticWorker=this;}
  postMessage(message,...rest){if(this.isLanguage){this.requests.set(message.id,message.method);if(window.contextNextInference&&['intersect/compileInferred','intersect/prepareInferred'].includes(message.method)){window.contextNextInference=false;message=structuredClone(message);message.params.inference.version=99;}}return super.postMessage(message,...rest);}
  set onmessage(handler){super.onmessage=event=>{if(['intersect/compileInferred','intersect/prepareInferred'].includes(this.requests.get(event.data.id))&&event.data.result?.ok===false){window.lastNativeDiagnostic=structuredClone(event.data.result);if(window.legacyNextDiagnostic){window.legacyNextDiagnostic=false;const data=structuredClone(event.data);delete data.result.diagnostic_origins;event=new MessageEvent('message',{data});}if(window.holdNextDiagnostic){window.holdNextDiagnostic=false;window.releaseDiagnostic=()=>handler(event);return;}}handler(event);};}
 };});
 await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
}
async function request(page,method,params={}){return page.evaluate(({method,params})=>new Promise((resolve,reject)=>{const worker=window.diagnosticWorker,id=`diagnostic:${window.diagnosticId=(window.diagnosticId||0)+1}`;const listener=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',listener);data.error?reject(new Error(data.error.message)):resolve(data.result);};const timer=setTimeout(()=>reject(new Error('Diagnostic worker timeout')),20000);worker.addEventListener('message',listener);worker.postMessage({jsonrpc:'2.0',id,method,params});}),{method,params});}
const inspect=page=>request(page,'intersect/inspect');
async function menu(page){if(!await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();}
async function closeMenu(page){if(await page.locator('.ide-file-menu').evaluate(e=>e.open))await page.locator('.ide-file-menu > summary').click();}
async function starter(page){await menu(page);await page.locator('#new-inferred-project').click();await expect(page.locator('#project-status')).toContainText('New inferred language',{timeout:60000});await closeMenu(page);const pending=page.waitForEvent('download');await menu(page);await page.locator('#save-project').click();const saved=JSON.parse((await readFile(await(await pending).path())).toString('utf8'));await closeMenu(page);return saved;}
async function open(page,base,input){const value=structuredClone(base);value.definitionInference={inputs:input,drafts:[]};value.definitions.xtext=input.bundle.sources.find(s=>s.id.uri===input.grammar.uri&&s.id.sha256===input.grammar.sha256).text;await page.locator('#project-file').setInputFiles({name:'diagnostic.intersect.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await expect(page.locator('#project-status')).toContainText('Project opened');await expect(page.locator('#compile')).toBeEnabled();await page.locator('[data-definition="xtext"]').click();}
async function fail(page){await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed');await expect(page.locator('#compile')).toBeEnabled();}
async function edit(page,text){await page.locator('.definition-guide-editor .view-lines').click({position:{x:20,y:12}});await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(text);}
const markers=page=>page.locator('.definition-guide-editor .squiggly-error');

test('actual worker retains parent, fragment, executable and generated ownership without replacing the active package',async({page})=>{
 await boot(page);await starter(page);const before=await inspect(page);
 const bad=source('memory:shared.xtext','grammar broken ???'),good=source(bad.id.uri,grammar("Model: name=ID; terminal ID: ('a'..'z')+;"));
 const parent=source('memory:parent.xtext',`grammar diag.Parent\ngenerate parent "urn:diag:parent"\n${ecore}\nRoot: Shared; fragment Shared*: value=ID; terminal ID: ('a'..'z')+;`);
 const child=source('memory:child.xtext',`grammar diag.Child with diag.Parent\ngenerate child "urn:diag:child"\n${ecore}\nModel: value=INT Shared; terminal INT returns ecore::EInt: ('0'..'9')+;`);child.dependencies=[parent.id];
 const executable=source('memory:executable.xtext',grammar("Model: name=ID; terminal ID: ('a'..'z')+; terminal EMPTY: '';"));
 const cycle=source('memory:cycle.xtext',grammar('Model: {Model} A; A: {A} B; B: {B} A;'));
 for(const [input,expected]of [[inputs([good,bad],bad),bad.id],[inputs([parent,child],child),parent.id],[inputs([executable],executable),executable.id]]){
  const result=await request(page,'intersect/compileInferred',{inference:input,diagnostic_origins:[{kind:'source',source:good.id}]});assert.equal(result.ok,false);assert.equal(result.diagnostic_origins[0].kind,'source');assert.deepEqual(result.diagnostic_origins[0].source,expected);if(input.grammar.uri===executable.id.uri){const span=result.diagnostic_origins[0].span;assert.deepEqual(span.source,executable.id);assert.ok(executable.text.slice(span.start,span.end).includes('terminal EMPTY'));}assert.deepEqual(await inspect(page),before);
 }
 const result=await request(page,'intersect/compileInferred',{inference:inputs([cycle],cycle)});assert.equal(result.diagnostic_origins[0].kind,'generated');assert.ok(result.diagnostic_origins[0].originals.length);assert.deepEqual(await inspect(page),before);
});

test('UI selects the exact failed revision, preserves legacy ambiguity and treats request context explicitly',async({page})=>{
 await boot(page);const base=await starter(page),before=await inspect(page),good=source('memory:shared.xtext',grammar("Model: name=ID; terminal ID: ('a'..'z')+;")),bad=source(good.id.uri,'grammar bad revision ???');await open(page,base,inputs([good,bad],bad));await page.getByLabel('Inference source file',{exact:true}).selectOption('0');await fail(page);
 await expect(page.locator('#diagnostic-list')).toContainText(bad.id.sha256.slice(0,12));await expect(markers(page)).toHaveCount(0);await page.locator('#dock-tab-problems').click();await page.locator('#diagnostic-list button').first().click();await expect(page.getByLabel('Inference source file',{exact:true})).toHaveValue('1');await expect(markers(page)).not.toHaveCount(0);await page.getByLabel('Inference source file',{exact:true}).selectOption('0');await expect(markers(page)).toHaveCount(0);assert.deepEqual((await inspect(page)).package,before.package);
 await page.evaluate(()=>{window.legacyNextDiagnostic=true;});await fail(page);await expect(page.locator('#diagnostic-list')).toContainText('multiple retained revisions');await page.locator('#diagnostic-list button').first().click();await expect(page.locator('#compile-status')).toHaveText('Choose a source revision');await expect(page.getByLabel('Inference source file',{exact:true})).toHaveValue('0');await expect(markers(page)).toHaveCount(0);
 await page.evaluate(()=>{window.contextNextInference=true;});await fail(page);await expect(page.locator('#diagnostic-list')).toContainText('Request context');await page.locator('#diagnostic-list button').first().click();await expect(page.locator('#compile-detail')).toContainText('not an authored culprit');await expect(page.getByLabel('Inference source file',{exact:true})).toHaveValue('0');await expect(markers(page)).toHaveCount(0);assert.deepEqual((await inspect(page)).package,before.package);
});

test('UI exposes generated correspondences and discards a held failure after newer source edits',async({page})=>{
 await boot(page);const base=await starter(page),before=await inspect(page),cycle=source('memory:cycle.xtext',grammar('Model: {Model} A; A: {A} B; B: {B} A;'));await open(page,base,inputs([cycle],cycle));await fail(page);await page.locator('#dock-tab-problems').click();const origin=await page.evaluate(()=>window.lastNativeDiagnostic.diagnostic_origins[0]);await expect(page.locator('#diagnostic-list')).toContainText('Generated source');await expect(page.locator('#diagnostic-list button')).toHaveCount(1+origin.originals.length);await page.locator('#diagnostic-list button').first().click();await expect(page.locator('#compile-detail')).toContainText('Every native correspondence');await page.locator('#diagnostic-list button').nth(1).click();await expect(markers(page)).not.toHaveCount(0);
 const bad=source('memory:stale.xtext','grammar stale ???');await open(page,base,inputs([bad],bad));await page.evaluate(()=>{window.holdNextDiagnostic=true;});await page.locator('#compile').click();await expect.poll(()=>page.evaluate(()=>typeof window.releaseDiagnostic==='function')).toBe(true);await edit(page,'grammar newer draft ???');await page.evaluate(()=>window.releaseDiagnostic());await expect(page.locator('#compile')).toBeEnabled();await expect(page.locator('#diagnostic-count')).toHaveText('0');await expect(markers(page)).toHaveCount(0);await expect(page.locator('.definition-guide-editor .view-lines')).toContainText('newer draft');assert.deepEqual((await inspect(page)).package,before.package);
});

test('UI routes inherited fragment ownership to the exact parent revision rather than the legacy child URI',async({page})=>{
 await boot(page);const base=await starter(page),before=await inspect(page);
 const parent=source('memory:fragment-parent.xtext',`grammar diag.Parent\ngenerate parent "urn:diag:parent"\n${ecore}\nRoot: Shared; fragment Shared*: value=ID; terminal ID: ('a'..'z')+;`),other=source(parent.id.uri,parent.text+'\n// retained earlier revision');
 const child=source('memory:fragment-child.xtext',`grammar diag.Child with diag.Parent\ngenerate child "urn:diag:child"\n${ecore}\nModel: value=INT Shared; terminal INT returns ecore::EInt: ('0'..'9')+;`);child.dependencies=[parent.id];
 await open(page,base,inputs([other,parent,child],child));await fail(page);
 const raw=await page.evaluate(()=>window.lastNativeDiagnostic);assert.equal(raw.diagnostics[0].source,child.id.uri);assert.deepEqual(raw.diagnostic_origins[0].source,parent.id);await expect(markers(page)).toHaveCount(0);
 await page.getByLabel('Inference source file',{exact:true}).selectOption('0');await expect(markers(page)).toHaveCount(0);await page.locator('#dock-tab-problems').click();await page.locator('#diagnostic-list button').first().click();await expect(page.getByLabel('Inference source file',{exact:true})).toHaveValue('1');await expect(markers(page)).not.toHaveCount(0);assert.deepEqual((await inspect(page)).package,before.package);
});


test('parameter specialization routes narrow AST scopes to exact UTF8 CRLF and inherited revisions',async({page},testInfo)=>{
 await boot(page);const base=await starter(page),active=await inspect(page);
 const plan=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/parameter-origins/cases.json',import.meta.url),'utf8'));
 const before=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/parameter-origins/before.json',import.meta.url),'utf8'));
 const expected=JSON.parse(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/parameter-origins/expectations.json',import.meta.url),'utf8')).scopes;
 for(const c of plan.cases){
  const previous=before.find(row=>row.id===c.id),authored=c.sources.find(s=>s.id===c.expected_source),span={source:{uri:authored.uri,sha256:authored.sha256},start:expected[c.id].start,end:expected[c.id].end};
  const beforeCall=await inspect(page);const result=await request(page,'intersect/compileInferred',{inference:previous.inference});assert.equal(result.ok,false);assert.deepEqual(result.diagnostics,previous.result.diagnostics);assert.deepEqual(result.diagnostic_origins[0].originals,[span]);assert.deepEqual(await inspect(page),beforeCall);
  await open(page,base,previous.inference);await page.getByLabel('Inference source file',{exact:true}).selectOption('0');await fail(page);await page.locator('#dock-tab-problems').click();await expect(page.locator('#diagnostic-list')).toContainText(authored.sha256.slice(0,12));
  await page.locator('#diagnostic-list button').nth(1).click();await expect(page.getByLabel('Inference source file',{exact:true})).toHaveValue(String(c.sources.findIndex(s=>s.id===c.expected_source)));await expect(markers(page)).not.toHaveCount(0);
  assert.deepEqual((await inspect(page)).package,active.package);
 }
 await page.screenshot({path:testInfo.outputPath('parameter-origin-parent.png')});
});
