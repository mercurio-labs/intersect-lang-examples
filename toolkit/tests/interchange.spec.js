import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
});

test('XMI download and import preserve the model, derived results and provenance', async ({ page }) => {
  const before = await page.evaluate(() => window.workbench.inspect());
  const downloading = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.getByRole('button', { name: 'Export XMI' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('intersect-model-xmi.zip');
  const bytes = await readFile(await download.path());
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(['resource-0000.xmi', 'resource-0001.xmi']);
  expect(new TextDecoder().decode(files['resource-0000.xmi'])).toContain('xmi:Extension');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#import-model').click();
  await (await chooser).setFiles({ name: 'model.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('#interchange-status')).toContainText('Imported 2 resource');
  await expect(page.locator('#model-status')).toContainText('IMPORTED MODEL');
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after.evaluation.model).toEqual(before.evaluation.model);
  expect(after.evaluation.derived).toEqual(before.evaluation.derived);
  expect(after.generation).toBe(before.generation + 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.ide-file-menu > summary').click();
  await page.screenshot({ path: 'test-results/xmi-import-mobile.png', fullPage: true });
  expect(await page.locator('.model-format-actions').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const model = window.workbench.modelModels.catalog; model.setValue(model.getValue() + '\n'); });
  await expect(page.locator('#model-status')).not.toContainText('IMPORTED MODEL');
});

test('external XMI imports; failed and stale imports leave the current model intact', async ({ page }) => {
  await page.getByRole('tab', { name: 'Queries', exact: true }).click();
  await page.getByRole('button', { name: 'Available copies', exact: true }).click();
  await page.getByRole('tab', { name: 'Queries', exact: true }).click(); await page.locator('#query-run').click();
  await expect(page.locator('#query-results')).toContainText('A Wizard of Earthsea');
  const text = '<l:Library xmlns:l="urn:intersect:example:library:1" name="Imported"><copies name="Book"/></l:Library>';
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#import-model').click();
  await (await chooser).setFiles({ name: 'external.xmi', mimeType: 'application/xml', buffer: Buffer.from(text) });
  await expect(page.locator('#interchange-status')).toContainText('Imported 1 resource');
  await expect(page.locator('#query-results')).toBeEmpty();
  await page.getByRole('tab', { name: 'Queries', exact: true }).click(); await page.locator('#query-run').click();
  await expect(page.locator('#query-count')).toHaveText('1 row');
  await expect(page.locator('#query-results')).toContainText('Book');
  await expect(page.locator('#query-results')).not.toContainText('A Wizard of Earthsea');
  await expect(page.locator('#query-results button')).toHaveCount(0);
  const before = await page.evaluate(() => window.workbench.inspect());
  expect(before.evaluation.model.elements).toHaveLength(2);
  const failure = await page.evaluate(async () => {
    const current = await window.workbench.inspect();
    const request = { format: 'xmi', interfaceRevision: current.interfaceRevision, generation: current.generation, resources: [{ uri: 'bad.xmi', bytes: Array.from(new TextEncoder().encode('<broken>')) }] };
    const errors = [];
    for (const input of [request, { ...request, generation: current.generation - 1 }]) {
      try { await window.workbench.request('intersect/modelImport', input); } catch (e) { errors.push(e.message); }
    }
    return errors;
  });
  expect(failure).toHaveLength(2);
  expect(failure[1]).toContain('changed');
  const after = await page.evaluate(() => window.workbench.inspect());
  expect(after.evaluation).toEqual(before.evaluation); expect(after.generation).toBe(before.generation);
});

test('language-invalid XMI and oversized files are rejected atomically', async ({ page }) => {
  const before = await page.evaluate(() => window.workbench.inspect());
  const error = await page.evaluate(async () => {
    const current = await window.workbench.inspect();
    const resources = (await window.workbench.request('intersect/modelExport', { format: 'xmi' })).resources;
    // Add a second Loan to the same copy: structurally valid, semantically invalid.
    let xml = new TextDecoder().decode(new Uint8Array(resources[1].bytes));
    const loan = xml.match(/<loans[\s\S]*?<\/loans>/)[0].replace(/xmi:id="[^"]+"/, 'xmi:id="extra"');
    xml = xml.replace('</m:Library>', `${loan}</m:Library>`).replace(/<xmi:Extension[\s\S]*?<\/xmi:Extension>/, '');
    // Strip provenance from both resources so this is plain external XMI.
    resources[1].bytes = Array.from(new TextEncoder().encode(xml));
    resources[0].bytes = Array.from(new TextEncoder().encode(new TextDecoder().decode(new Uint8Array(resources[0].bytes)).replace(/<xmi:Extension[\s\S]*?<\/xmi:Extension>/, '')));
    try { await window.workbench.request('intersect/modelImport', { format: 'xmi', resources, interfaceRevision: current.interfaceRevision, generation: current.generation }); }
    catch (e) { return e.message; }
  });
  expect(error).toContain('language validation');
  const after = await page.evaluate(() => window.workbench.inspect()); expect(after.evaluation).toEqual(before.evaluation);
  const chooser = page.waitForEvent('filechooser'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#import-model').click();
  await (await chooser).setFiles({ name: 'large.xmi', mimeType: 'application/xml', buffer: Buffer.alloc(500_001, 32) });
  await expect(page.locator('#interchange-status')).toContainText('limit');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation).toEqual(before.evaluation);
});

test('unchanged upstream EMF ASCII/default-namespace resources import through the real ZIP UI', async ({ page }) => {
  const ecore = `<ecore:EPackage xmlns:ecore="http://www.eclipse.org/emf/2002/Ecore" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="pack" nsURI="http://www.eclipse.org/emf/pack/person"><eClassifiers xsi:type="ecore:EClass" name="Person"><eStructuralFeatures xsi:type="ecore:EAttribute" name="name" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/><eStructuralFeatures xsi:type="ecore:EReference" name="father" eType="#//Person"/></eClassifiers></ecore:EPackage>`;
  const xtext = `grammar example.Person with org.eclipse.xtext.common.Terminals
import "http://www.eclipse.org/emf/pack/person" as p
Person returns p::Person: 'person' name=ID ('father' father=[p::Person|ID])? ';';`;
  await page.evaluate(async ({ ecore, xtext }) => {
    const w = window.workbench;
    const migration = await w.request('intersect/migrateEcore', {uri:'memory:person.ecore',text:ecore,target_uri:'memory:person.rcore'});
    if (!migration.ok) throw new Error(JSON.stringify(migration));
    w.definitionModels.rcore.setValue(migration.report.converted.text); w.definitionModels.xtext.setValue(xtext);
    w.definitionModels.rcore_behavior.setValue('rcore 1; package emptyRules version "1";');
    w.modelModels.catalog.setValue('person John;'); w.modelModels.loans.setValue('person Mary father John;');
    await w.compile();
  }, { ecore, xtext });
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const entries = {};
  for (const name of ['mary.xmi', 'john.xmi']) entries[name] = await readFile(new URL(`../.runtime/intersect-text/fixtures/compatibility/upstream/emf/${name}`, import.meta.url));
  const chooser = page.waitForEvent('filechooser'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#import-model').click();
  await (await chooser).setFiles({ name: 'upstream.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries)) });
  await expect(page.locator('#interchange-status')).toContainText('Imported 2 resource');
  const before = await page.evaluate(() => window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.evaluation.model.elements).toHaveLength(2);
  expect(before.evaluation.model.elements.find(e => e.values.name === 'Mary').values.father).toBe('john.xmi#/');
  const downloading = page.waitForEvent('download'); await page.locator('.ide-file-menu > summary').click(); await page.getByRole('button', { name: 'Export XMI' }).click();
  const download = await downloading; const bytes = await readFile(await download.path());
  const reload = page.waitForEvent('filechooser'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#import-model').click();
  await (await reload).setFiles({ name: 'saved.zip', mimeType: 'application/zip', buffer: bytes });
  await expect.poll(async () => (await page.evaluate(() => window.workbench.inspect())).generation).toBe(before.generation + 1);
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
});

test('invalid model ZIPs preserve the published model and generation', async ({ page }) => {
  const before = await page.evaluate(() => window.workbench.inspect());
  const bytes = Buffer.from('<l:Library xmlns:l="urn:intersect:example:library:1" name="L"/>');
  const duplicate = Buffer.from(zipSync({ 'a.xmi': bytes, 'b.xmi': bytes }));
  let index = 0; while ((index = duplicate.indexOf('b.xmi', index)) !== -1) { duplicate.write('a.xmi', index); index += 5; }
  for (const [buffer, message] of [[Buffer.from(zipSync({ '../escape.xmi': bytes })), 'paths'], [duplicate, 'Duplicate'], [Buffer.from(zipSync({ 'large.xmi': new Uint8Array(500_001) })), 'limits']]) {
    const chooser = page.waitForEvent('filechooser'); await page.locator('.ide-file-menu > summary').click(); await page.locator('#import-model').click();
    await (await chooser).setFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer });
    await expect(page.locator('#interchange-status')).toContainText(message);
    const after = await page.evaluate(() => window.workbench.inspect());
    expect(after.evaluation).toEqual(before.evaluation); expect(after.generation).toBe(before.generation);
  }
});


test('assignment metadata rejects malformed wires and unsupported schema use without altering the active model', async ({ page }) => {
  const before=await page.evaluate(()=>window.workbench.inspect());
  const observed=await page.evaluate(async before=>{
    const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');
    const invoke=await loadRuntime();
    const request=model=>({method:'model/export',format:'xmi',package:before.package,model});
    const baseline=invoke(request(before.evaluation.model));
    const errors=[];
    for(const state of [
      {version:2,set_features:[]}, {version:1,set_features:['name','name']},
      {version:1,set_features:['']}, {version:1,set_features:[],extra:false},
      {version:1,set_features:[]},
    ]) {
      const model=structuredClone(before.evaluation.model);
      model.elements[0].assignment_state=state;
      try { invoke(request(model));errors.push(null); } catch(error) { errors.push(error.message); }
    }
    return {baseline,errors,recovery:invoke(request(before.evaluation.model))};
  },before);
  expect(observed.errors[0]).toContain('Unsupported assignment-state version');
  expect(observed.errors[1]).toContain('Duplicate assignment-state feature');
  expect(observed.errors[2]).toContain('feature name must be nonempty');
  expect(observed.errors[3]).toContain('unknown field');
  expect(observed.errors[4]).toContain('unsettable schema support');
  expect(observed.baseline.resources.length).toBeGreaterThan(0);
  expect(observed.recovery).toEqual(observed.baseline);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});


test('unsettable text and XMI preserve explicit defaults and reject contradictory state in WASM', async ({ page }) => {
  const before=await page.evaluate(()=>window.workbench.inspect());
  const result=await page.evaluate(async ()=>{
    const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');
    const invoke=await loadRuntime();
    const ecore=`<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="p" nsURI="urn:p"><eClassifiers x:type="e:EClass" name="Item"><eStructuralFeatures x:type="e:EAttribute" name="name" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/><eStructuralFeatures x:type="e:EAttribute" name="value" unsettable="true" defaultValueLiteral="seed" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/></eClassifiers></e:EPackage>`;
    const xtext=`grammar p.Items with org.eclipse.xtext.common.Terminals
import "urn:p" as p
Item returns p::Item: 'item' name=ID ';';`;
    const input={method:'fixture/compile',ecore,xtext,rcore_behavior:'rcore 1; package emptyRules version "1";'};
    const compiled=invoke(input);
    const evaluated=invoke({method:'evaluate',package:compiled.package,sources:[{uri:'model',text:'item A;'}]});
    const errors=[];
    for (const variant of ['valid','missing','invalid']) {
      const model=structuredClone(evaluated.model);
      if(variant==='missing') delete model.elements[0].assignment_state;
      if(variant==='invalid') model.elements[0].values.value='changed';
      try {invoke({method:'model/export',format:'xmi',package:compiled.package,model});errors.push(null);}
      catch(error){errors.push(error.message);}
    }
    const textPackage=invoke({...input,xtext:xtext.replace("name=ID", "name=ID value=STRING")});
    const assigned=invoke({method:'evaluate',package:textPackage.package,sources:[{uri:'model',text:'item A "seed";'}]});
    const resources=invoke({method:'model/export',format:'xmi',package:textPackage.package,model:assigned.model}).resources;
    const reloaded=invoke({method:'model/import',format:'xmi',package:textPackage.package,resources});
    return {compiled:compiled.ok,evaluated,errors,assigned,reloaded};
  });
  expect(result.compiled).toBe(true);
  expect(result.evaluated.diagnostics).toEqual([]);
  expect(result.evaluated.model.elements[0].assignment_state).toEqual({version:1,set_features:[]});
  expect(result.evaluated.model.elements[0].values.value).toBe('seed');
  expect(result.errors[0]).toBeNull();
  expect(result.errors[1]).toContain('requires explicit assignment state');
  expect(result.errors[2]).toContain('differs from its default');
  expect(result.assigned.diagnostics).toEqual([]);
  expect(result.assigned.model.elements[0].values.value).toBe('seed');
  expect(result.assigned.model.elements[0].assignment_state).toEqual({version:1,set_features:['value']});
  expect(result.reloaded.model).toEqual(result.assigned.model);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});


test('WASM text assignment history survives containment and cross-resource reference linking', async ({ page }) => {
  const ecore=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/model.ecore',import.meta.url),'utf8');
  const xtext=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/model.xtext',import.meta.url),'utf8');
  const rcore_behavior=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/model-behavior.rcore',import.meta.url),'utf8');
  const before=await page.evaluate(()=>window.workbench.inspect());
  const result=await page.evaluate(async definitions=>{
    const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');
    const invoke=await loadRuntime();
    const compiled=invoke({method:'fixture/compile',...definitions});
    const sources=[{uri:'one',text:'root first { item a value "seed" tags "x" "y" link b; }'},{uri:'two',text:'root second { item b tags; }'}];
    const request={method:'evaluate',package:compiled.package,sources};
    const initial=invoke(request);
    const bad=invoke({...request,sources:[{uri:'bad',text:'root failed { item a value "seed" link missing; }'}]});
    return {compiled:compiled.ok,initial,bad,recovery:invoke(request)};
  },{ecore,xtext,rcore_behavior});
  expect(result.compiled).toBe(true);
  expect(result.initial.diagnostics).toEqual([]);
  const elements=Object.fromEntries(result.initial.model.elements.map(e=>[e.id,e]));
  expect(elements['one#0'].assignment_state.set_features).toEqual(['items']);
  expect(elements['one#1'].assignment_state.set_features).toEqual(['link','tags','value']);
  expect(elements['one#1'].values.link).toBe('two#1');
  expect(elements['one#1'].values.value).toBe('seed');
  expect(elements['two#1'].assignment_state.set_features).toEqual([]);
  expect(result.bad.diagnostics.length).toBeGreaterThan(0);
  expect(result.recovery).toEqual(result.initial);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});


test('WASM XMI distinguishes explicit nulls, empty collections, empty items and unassigned defaults', async ({ page }) => {
  const ecore=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/model.ecore',import.meta.url),'utf8');
  const xtext=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/model.xtext',import.meta.url),'utf8');
  const rcore_behavior=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/model-behavior.rcore',import.meta.url),'utf8');
  const before=await page.evaluate(()=>window.workbench.inspect());
  const result=await page.evaluate(async definitions=>{
    const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');
    const invoke=await loadRuntime();
    const compiled=invoke({method:'fixture/compile',...definitions});
    const parsed=invoke({method:'evaluate',package:compiled.package,sources:[{uri:'model',text:'root r { item a; item b tags ""; }'}]});
    const model=structuredClone(parsed.model);
    const a=model.elements.find(e=>e.values.name==='a');
    a.values.value=null;a.values.tags=[];a.values.link=null;
    a.assignment_state={version:1,set_features:['link','tags','value']};
    const resources=invoke({method:'model/export',format:'xmi',package:compiled.package,model}).resources;
    const reloaded=invoke({method:'model/import',format:'xmi',package:compiled.package,resources});
    return {model,reloaded,xml:resources.map(r=>new TextDecoder().decode(new Uint8Array(r.bytes))).join('')};
  },{ecore,xtext,rcore_behavior});
  expect(result.reloaded.model).toEqual(result.model);
  expect(result.xml).toContain('tags=""');
  expect(result.xml).toContain('<tags></tags>');
  expect(result.xml).toContain('<value xsi:nil="true"/>');
  expect(result.xml).toContain('<link xsi:nil="true"/>');
  expect(result.reloaded.diagnostics).toEqual([]);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});


test('WASM text and script edits preserve distinct scalar and Many inverse assignment states', async ({ page }) => {
  const before=await page.evaluate(()=>window.workbench.inspect());
  const result=await page.evaluate(async ()=>{
    const w=window.workbench;
    const rcore=w.definitionModels.rcore.getValue()
      .replace('ref copies: BookCopy [0,*]', 'ref copies: BookCopy [0,*] unsettable')
      .replace('ref library: Library [0,1]', 'ref library: Library [0,1] unsettable');
    const {loadRuntime}=await import('/src/runtime.js');const invoke=await loadRuntime();
    const compiled=invoke({method:'compile_rcore',rcore,xtext:w.definitionModels.xtext.getValue()});
    if(!compiled.ok)throw new Error(JSON.stringify(compiled.diagnostics));
    const initial=invoke({method:'evaluate',package:compiled.package,sources:[{uri:'catalog',text:w.modelModels.catalog.getValue()},{uri:'loans',text:w.modelModels.loans.getValue()}]});
    const library=initial.model.elements.find(e=>e.class==='Library'&&e.values.copies.length>0);
    const ids=[...library.values.copies];
    invoke({method:'script/begin',package:compiled.package,model:initial.model,revision:'inverse-test'});
    invoke({method:'script/set',revision:'inverse-test',id:library.id,feature:'copies',value:[]});
    const cleared=invoke({method:'script/inspect',revision:'inverse-test'});
    const committed=invoke({method:'script/commit',revision:'inverse-test'});
    const roundtrip=model=>invoke({method:'model/import',format:'xmi',package:compiled.package,resources:invoke({method:'model/export',format:'xmi',package:compiled.package,model}).resources}).model;
    return {initial,library:library.id,ids,cleared,committed,initialReloaded:roundtrip(initial.model),clearedReloaded:roundtrip(cleared.model)};
  });
  expect(result.initial.diagnostics).toEqual([]);
  const elements=Object.fromEntries(result.cleared.model.elements.map(e=>[e.id,e]));
  expect(elements[result.library].values.copies).toEqual([]);
  expect(elements[result.library].assignment_state.set_features).toContain('copies');
  for(const id of result.ids) {
    expect(result.initial.model.elements.find(e=>e.id===id).assignment_state.set_features).toContain('library');
    expect(elements[id].values.library).toBeNull();
    expect(elements[id].assignment_state.set_features).not.toContain('library');
  }
  expect(result.committed.model).toEqual(result.cleared.model);
  expect(result.initialReloaded).toEqual(result.initial.model);
  expect(result.clearedReloaded).toEqual(result.cleared.model);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});


test('WASM readonly defaults survive rejected script and text assignments', async ({page})=>{
  const before=await page.evaluate(()=>window.workbench.inspect());
  const result=await page.evaluate(async()=>{
    const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');const invoke=await loadRuntime();
    const ecore=`<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="p" nsURI="urn:p"><eClassifiers x:type="e:EClass" name="Item"><eStructuralFeatures x:type="e:EAttribute" name="value" changeable="false" unsettable="true" defaultValueLiteral="seed" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/></eClassifiers></e:EPackage>`;
    const input={method:'fixture/compile',ecore,xtext:`grammar p.Items with org.eclipse.xtext.common.Terminals
import "urn:p" as p
Item returns p::Item: 'item';`,rcore_behavior:'rcore 1; package emptyRules version "1";'};
    const compiled=invoke(input);const initial=invoke({method:'evaluate',package:compiled.package,sources:[{uri:'model',text:'item'}]});
    invoke({method:'script/begin',package:compiled.package,model:initial.model,revision:'readonly'});
    let error;try {invoke({method:'script/set',revision:'readonly',id:initial.model.elements[0].id,feature:'value',value:'changed'});}catch(e){error=e.message;}
    const after=invoke({method:'script/transaction',revision:'readonly'});
    const invalid=invoke({...input,xtext:input.xtext.replace("'item';","'item' value=STRING;")});
    return {initial,after,error,invalid};
  });
  expect(result.initial.diagnostics).toEqual([]);
  expect(result.initial.model.elements[0].values.value).toBe('seed');
  expect(result.initial.model.elements[0].assignment_state.set_features).toEqual([]);
  expect(result.error).toContain('non-changeable');
  expect(result.after.status).toBe('rolled_back');
  expect(result.after.changes).toEqual([]);
  expect(result.after.validation).toBe('passed');
  expect(result.invalid.ok).toBe(false);
  expect(JSON.stringify(result.invalid.diagnostics)).toContain('non-changeable');
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});


test('WASM readonly collection edits distinguish no-op removal from empty clear',async({page})=>{
 const before=await page.evaluate(()=>window.workbench.inspect());
 const result=await page.evaluate(async()=>{
  const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');const invoke=await loadRuntime();
  const ecore=`<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="p" nsURI="urn:p"><eClassifiers x:type="e:EClass" name="Item"><eStructuralFeatures x:type="e:EAttribute" name="items" changeable="false" unsettable="true" upperBound="-1" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/></eClassifiers></e:EPackage>`;
  const compiled=invoke({method:'fixture/compile',ecore,xtext:`grammar p.Items with org.eclipse.xtext.common.Terminals
import "urn:p" as p
Item returns p::Item: 'item';`,rcore_behavior:'rcore 1; package emptyRules version "1";'});
  const initial=invoke({method:'evaluate',package:compiled.package,sources:[{uri:'model',text:'item'}]});
  const revision='collections';invoke({method:'script/begin',package:compiled.package,model:initial.model,revision});
  const edit=(operation,value)=>invoke({method:'script/collection',revision,id:initial.model.elements[0].id,feature:'items',operation,value});
  const noChange=edit('remove','missing');const missing=invoke({method:'script/inspect',revision});
  const emptyClear=edit('clear');const cleared=invoke({method:'script/inspect',revision});
  const added=edit('add','a');const duplicate=edit('add','a');edit('add','b');edit('remove','a');
  const indexed=(operation,extra)=>invoke({method:'script/collection',revision,id:initial.model.elements[0].id,feature:'items',operation,...extra});
  indexed('insert',{index:0,value:'a'});indexed('replace',{index:1,value:'c'});indexed('move',{from:0,to:1});indexed('remove_at',{index:0});
  const committed=invoke({method:'script/commit',revision});
  invoke({method:'script/begin',package:compiled.package,model:committed.model,revision});
  let invalidIndex;try {indexed('insert',{index:-1,value:'bad'});}catch(error){invalidIndex=error.message;}
  const failed=invoke({method:'script/transaction',revision});
  return {noChange,missing,emptyClear,cleared,added,duplicate,committed,invalidIndex,failed};
 });
 expect(result.noChange).toBe(false);expect(result.emptyClear).toBe(false);
 expect(result.missing.model.elements[0].assignment_state.set_features).toEqual([]);
 expect(result.cleared.model.elements[0].assignment_state.set_features).toEqual(['items']);
 expect(result.added).toBe(true);expect(result.duplicate).toBe(false);
 expect(result.committed.model.elements[0].values.items).toEqual(['a']);
 expect(result.invalidIndex).toContain('non-negative integer');
 expect(result.failed.status).toBe('rolled_back');
 expect(result.failed.changes).toEqual([]);
 expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});


for (const volatile of [false,true]) {
test(`WASM semantic set state distinguishes ordinary defaults and explicit history (volatile=${volatile})`,async({page})=>{
 const before=await page.evaluate(()=>window.workbench.inspect());
 const result=await page.evaluate(async volatile=>{
  const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');const invoke=await loadRuntime();
  const ecore=`<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="p" nsURI="urn:p"><eClassifiers x:type="e:EClass" name="Item"><eStructuralFeatures x:type="e:EAttribute" name="ordinary" volatile="${volatile}" defaultValueLiteral="seed" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/><eStructuralFeatures x:type="e:EAttribute" name="history" volatile="${volatile}" unsettable="true" defaultValueLiteral="seed" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/></eClassifiers></e:EPackage>`;
  const compiled=invoke({method:'fixture/compile',ecore,xtext:`grammar p.Items with org.eclipse.xtext.common.Terminals
import "urn:p" as p
Item returns p::Item: 'item';`,rcore_behavior:'rcore 1; package emptyRules version "1";'});
  const initial=invoke({method:'evaluate',package:compiled.package,sources:[{uri:'model',text:'item'}]});
  const revision='is-set';const id=initial.model.elements[0].id;invoke({method:'script/begin',package:compiled.package,model:initial.model,revision});
  const query=feature=>invoke({method:'script/is_set',revision,id,feature});
  const fresh=[query('ordinary'),query('history')];
  for(const feature of ['ordinary','history'])invoke({method:'script/set',revision,id,feature,value:'seed'});
  const assigned=[query('ordinary'),query('history')];
  invoke({method:'script/set',revision,id,feature:'ordinary',value:null});const nullable=query('ordinary');
  const committed=invoke({method:'script/commit',revision});return {fresh,assigned,nullable,committed};
 },volatile);
 expect(result.fresh).toEqual([false,false]);expect(result.assigned).toEqual([false,true]);expect(result.nullable).toBe(true);
 expect(result.committed.model.elements[0].assignment_state.set_features).toEqual(['history']);
 expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});

}


test('WASM provider-aware resets restore scalar null and Many defaults',async({page})=>{
 const before=await page.evaluate(()=>window.workbench.inspect());
 const ecore=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/provider.ecore',import.meta.url),'utf8');
 const conversions=[{datatype:{source:{uri:'memory:ecore',sha256:createHash('sha256').update(ecore).digest('hex')},path:[0]},provider:{name:'example.rgb',version:'1'},serializable:true}];
 const result=await page.evaluate(async({ecore,conversions})=>{
  const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');const invoke=await loadRuntime();
  const compiled=invoke({method:'fixture/compile',ecore,conversions,xtext:`grammar p.Paint import 'urn:paint' as p Paint returns p::Paint: 'paint';`,rcore_behavior:'rcore 1; package emptyRules version "1";'});
  const initial=invoke({method:'evaluate',package:compiled.package,sources:[{uri:'model',text:'paint'}]});
  const revision='reset-provider';const id=initial.model.elements[0].id;invoke({method:'script/begin',package:compiled.package,model:initial.model,revision});
  const color=initial.model.elements[0].values.color;
  for(const [feature,value] of [['color',color],['optional',color],['colors',[color]]])invoke({method:'script/set',revision,id,feature,value});
  const assigned=['color','optional','colors'].map(feature=>invoke({method:'script/is_set',revision,id,feature}));
  for(const feature of ['color','optional','colors'])invoke({method:'script/unset',revision,id,feature});
  const reset=['color','optional','colors'].map(feature=>invoke({method:'script/is_set',revision,id,feature}));
  const committed=invoke({method:'script/commit',revision});return {initial,assigned,reset,committed};
 },{ecore,conversions});
 expect(result.initial.diagnostics).toEqual([]);expect(result.assigned).toEqual([true,true,true]);expect(result.reset).toEqual([false,false,false]);
 const restored=structuredClone(result.initial.model);
 for(const [uri,resource] of Object.entries(restored.resources)) {
  const committed=result.committed.model.resources[uri];
  expect(BigInt(committed.content_revision)).toBeGreaterThan(BigInt(resource.content_revision));
  expect(committed.source).toBeNull();
  resource.content_revision=committed.content_revision;
  resource.source=null;
 }
 expect(result.committed.model).toEqual(restored);
 expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});


test('WASM transient projection preserves runtime state and omits transient containment',async({page})=>{
 const before=await page.evaluate(()=>window.workbench.inspect());
 const ecore=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/model.ecore',import.meta.url),'utf8');
 const xtext=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/model.xtext',import.meta.url),'utf8');
 const rcore_behavior=await readFile(new URL('../.runtime/intersect-text/fixtures/ecore-unsettable/model-behavior.rcore',import.meta.url),'utf8');
 const result=await page.evaluate(async definitions=>{
  const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');const invoke=await loadRuntime();const results=[];
  for(const containment of [false,true]) {
   const ecore=containment?definitions.ecore.replace('name="items"','name="items" transient="true"'):definitions.ecore.replace('name="value"','name="value" transient="true"').replace('name="tags"','name="tags" transient="true"');
   const compiled=invoke({method:'fixture/compile',...definitions,ecore});const original=invoke({method:'evaluate',package:compiled.package,sources:[{uri:'model',text:'root r { item a value "custom" tags "x"; }'}]});
   const snapshot=JSON.stringify(original.model);const resources=invoke({method:'model/export',package:compiled.package,model:original.model,format:'xmi'}).resources;
   const reloaded=invoke({method:'model/import',package:compiled.package,resources,format:'xmi'});
   results.push({original,reloaded,unchanged:snapshot===JSON.stringify(original.model)});
  }return results;
 },{ecore,xtext,rcore_behavior});
 for(const run of result) {expect(run.unchanged).toBe(true);expect(run.original.diagnostics).toEqual([]);expect(run.reloaded.diagnostics).toEqual([]);}
 const original=result[0].original.model.elements.find(e=>e.class==='Item');const loaded=result[0].reloaded.model.elements.find(e=>e.class==='Item');
 expect(original.values.value).toBe('custom');expect(original.values.tags).toEqual(['x']);expect(loaded.values.value).toBe('seed');expect(loaded.values.tags).toEqual([]);expect(loaded.assignment_state.set_features).toEqual([]);
 expect(result[1].original.model.elements.length).toBe(2);expect(result[1].reloaded.model.elements.length).toBe(1);expect(result[1].reloaded.model.elements[0].values.items).toEqual([]);
 expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});


test('WASM computed set state follows current language providers through transaction edits', async ({page}) => {
 const before=await page.evaluate(()=>window.workbench.inspect());
 const definitions={};
 for(const [field,file] of [['ecore','library.ecore'],['xtext','library.xtext'],['rcore_behavior','library-behavior.rcore']]) definitions[field]=await readFile(new URL(`../.runtime/intersect-text/fixtures/library/${file}`,import.meta.url),'utf8');
 const result=await page.evaluate(async definitions=>{
  const {loadFixtureRuntime:loadRuntime}=await import('/tests/migration-fixtures.js');const invoke=await loadRuntime();
  const compiled=invoke({method:'fixture/compile',...definitions});
  const initial=invoke({method:'evaluate',package:compiled.package,sources:[{uri:'model',text:'library Catalog { copy dune "Dune"; copy earthsea "Earthsea"; member ada; loan first copy dune to ada; }'}]});
  const objects=initial.model.elements;
  const named=name=>objects.find(e=>e.values.name===name).id;
  const revision='computed-state';invoke({method:'script/begin',package:compiled.package,model:initial.model,revision});
  const query=(name,feature)=>invoke({method:'script/is_set',revision,id:named(name),feature});
  const fresh=[query('Catalog','copyCount'),query('dune','available'),query('earthsea','available'),query('dune','edition')];
  invoke({method:'script/set',revision,id:named('first'),feature:'copy',value:named('earthsea')});
  const edited=[query('dune','available'),query('earthsea','available')];
  const committed=invoke({method:'script/commit',revision});
  invoke({method:'script/begin',package:compiled.package,model:committed.model,revision});
  const replay=[query('dune','available'),query('earthsea','available')];
  let rejected;try{invoke({method:'script/unset',revision,id:named('dune'),feature:'available'});}catch(error){rejected=error.message;}
  const failed=invoke({method:'script/transaction',revision});
  return {initial,fresh,edited,replay,rejected,failed};
 },definitions);
 expect(result.initial.diagnostics).toEqual([]);
 expect(result.fresh).toEqual([true,false,true,false]);expect(result.edited).toEqual([true,false]);expect(result.replay).toEqual([true,false]);
 expect(result.rejected).toContain('derived');expect(result.failed.status).toBe('rolled_back');expect(result.failed.changes).toEqual([]);
 expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(before);
});

test('selected resource replacement retains the catalog and rejects invalid replacements', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const before = await window.workbench.inspect();
    const selected = [...new Set(before.evaluation.model.elements.filter(e => e.class === 'Loan').map(e => e.resource))];
    if (selected.length !== 1) throw new Error('Expected independent loans resource');
    const exported = await window.workbench.request('intersect/modelExport', { format: 'xmi', selected, closure: 'selected' });
    const retained = before.evaluation.model.elements.filter(e => !selected.includes(e.resource));
    await window.workbench.request('intersect/modelImport', { format: 'xmi', selected, resources: exported.resources, interfaceRevision: before.interfaceRevision, generation: before.generation });
    const after = await window.workbench.inspect();
    const errors = [];
    for (const resources of [
      [{ uri: selected[0], bytes: Array.from(new TextEncoder().encode('<unsupported/>')) }],
      exported.resources,
    ]) {
      const current = await window.workbench.inspect();
      try { await window.workbench.request('intersect/modelImport', { format: 'xmi', selected, resources, interfaceRevision: current.interfaceRevision, generation: resources === exported.resources ? before.generation : current.generation }); }
      catch (e) { errors.push(e.message); }
    }
    return { selected, exported: exported.resources.map(r => r.uri), retained, afterRetained: after.evaluation.model.elements.filter(e => !selected.includes(e.resource)), beforeGeneration: before.generation, afterGeneration: after.generation, errors, after, final: await window.workbench.inspect() };
  });
  expect(result.exported).toEqual(result.selected);
  expect(result.afterRetained).toEqual(result.retained);
  expect(result.afterGeneration).toBe(result.beforeGeneration + 1);
  expect(result.errors).toHaveLength(2);
  expect(result.errors[1]).toContain('changed');
  expect(result.final.evaluation).toEqual(result.after.evaluation);
  expect(result.final.generation).toBe(result.afterGeneration);
});
