import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

async function waitForExample(page, example, version) {
  const profile=version===null?'intersect.workbench.v1':`intersect.xtext.native.v${version}`;
  await expect.poll(()=>page.evaluate(async()=>{
    if(!window.workbench || document.querySelector('#compile')?.disabled) return null;
    const state=await window.workbench.inspect();
    return {example:document.querySelector('#example').value,profile:state.package?.grammar?.profile,diagnostics:state.evaluation?.diagnostics,busy:document.querySelector('#compile').disabled};
  }),{timeout:60000}).toEqual({example,profile,diagnostics:[],busy:false});
}

function expectAuthoredTypeIdentities(inspected, namespace) {
  expect(inspected.package.schema.uri).toBe(namespace);
  for (const element of inspected.evaluation.model.elements) {
    const declaration = inspected.package.schema.declarations[element.class];
    expect(declaration.namespace).toBe(namespace);
    const source = inspected.package.compilation.bundle.sources.find(source =>
      source.id.uri === declaration.source.uri && source.id.sha256 === declaration.source.sha256);
    expect(source.kind).toBe('rcore');
    expect(element.type_identity).toBe(`${declaration.source.uri}@${declaration.source.sha256}#${declaration.path.join('/')}`);
  }
}

test('bounded KerML Boolean syntax compiles, rejects bad definitions and returns to Library', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 60000 });
  await page.locator('.ide-file-menu > summary').click();
  await page.locator('.ide-test-cases > summary').click();
  await page.locator('[data-load-example="xtext-kerml"]').click();await waitForExample(page,'xtext-kerml',1);
  await expect(page.locator('#definition-file')).toHaveText('mini-kerml.xtext');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 60000 });
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('.structure-class')).toHaveCount(2);
  const inspected = await page.evaluate(() => window.workbench.request('intersect/inspect'));
  expect(inspected.evaluation.diagnostics).toEqual([]);
  const types = inspected.evaluation.model.elements.filter(e => e.class === 'Type');
  expect(types.map(e => [e.values.name, e.values.isAbstract, e.values.isStandard])).toEqual([
    ['Vehicle', true, true], ['Wheel', false, true], ['Scalar', false, true], ['Component', false, true]
  ]);
  await page.evaluate(async () => { const wb=window.workbench; const snapshot=wb.project.snapshot(); if(snapshot.compilerProfile!=='intersect.xtext.native.v1') throw new Error('Missing compiler profile'); if(snapshot.profile!=='xtext-kerml') throw new Error('Missing profile'); wb.project.load(snapshot); await wb.compile(); });
  await expect(page.locator('#example')).toHaveValue('xtext-kerml');
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('.structure-class')).toHaveCount(2);
  await page.screenshot({path:'test-results/xtext-boolean-example.png',fullPage:true});
  await page.evaluate(() => { const model = window.workbench.definitionModels.xtext; model.setValue(model.getValue().replace('isAbstract?=', 'name?=')); });
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('failed', { timeout: 60000 });
  const rejected = await page.evaluate(() => window.workbench.request('intersect/inspect'));
  expect(rejected.evaluation.model).toEqual(inspected.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 60000 });
  const library = await page.evaluate(() => window.workbench.request('intersect/inspect'));
  expect(library.evaluation.diagnostics).toEqual([]);
  expect(library.package.grammar.profile).toBe('intersect.workbench.v1');
  expect(library.evaluation.model.elements.some(e => e.class === 'BookCopy')).toBe(true);
});


test('bounded KerML dispatch constructs subtypes, replays its project and rejects mixed delegation', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-dispatch');await waitForExample(page,'xtext-dispatch',1);
  await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:60000});
  await expect(page.locator('#example')).toHaveValue('xtext-dispatch');
  await expect(page.locator('#element-count')).toHaveText('5 elements', { timeout: 60000 });
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class')).toHaveCount(4);
  const inspected = await page.evaluate(() => window.workbench.request('intersect/inspect'));
  expect(inspected.evaluation.diagnostics).toEqual([]);
  expect(inspected.evaluation.model.elements.map(e => e.class)).toEqual(['Model','Type','Feature','Model','Feature']);
  expect(inspected.evaluation.model.elements.map(e => e.values.name)).toEqual(['Demo','Vehicle','wheel','Additional','material']);
  expectAuthoredTypeIdentities(inspected, 'urn:intersect:xtext:mini-kerml:dispatch:1');
  await page.evaluate(async () => { const wb=window.workbench; const snapshot=wb.project.snapshot(); if(snapshot.compilerProfile!=='intersect.xtext.native.v1') throw new Error('Missing compiler profile'); if(snapshot.profile!=='xtext-dispatch') throw new Error('Missing dispatch profile'); wb.project.load(snapshot); await wb.compile(); });
  await expect(page.locator('#example')).toHaveValue('xtext-dispatch');
  const replayed = await page.evaluate(() => window.workbench.request('intersect/inspect'));
  expect(replayed.evaluation.model).toEqual(inspected.evaluation.model);
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/, {timeout:60000});
  await page.getByRole('button', {name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-dispatch-example.png',fullPage:true});
  await page.evaluate(() => { const model=window.workbench.definitionModels.xtext; model.setValue(model.getValue().replace('Type | Feature', "'prefix' Type | Feature")); });
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('failed', {timeout:60000});
  const rejected = await page.evaluate(() => window.workbench.request('intersect/inspect'));
  expect(rejected.evaluation.model).toEqual(inspected.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();
  await page.locator('.ide-test-cases > summary').click();
  await page.locator('[data-load-example="xtext-kerml"]').click();
  await expect(page.locator('#element-count')).toHaveText('6 elements', {timeout:60000});
  await expect(page.locator('.structure-class')).toHaveCount(2);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);
  await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:60000});
  const library = await page.evaluate(() => window.workbench.request('intersect/inspect'));
  expect(library.evaluation.diagnostics).toEqual([]);
  expect(library.evaluation.model.elements.some(e => e.class === 'BookCopy')).toBe(true);
});


test('typed fragment example preserves callers and linked references through project replay', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-fragments');await waitForExample(page,'xtext-fragments',1);
  await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:60000});
  await expect(page.locator('#example')).toHaveValue('xtext-fragments');
  await expect(page.locator('#definition-file')).toHaveText('mini-kerml.xtext');
  await page.evaluate(() => window.workbench.compile());
  await expect(page.locator('#element-count')).toHaveText('6 elements', {timeout:60000});
  await expect(page.locator('.structure-class')).toHaveCount(4);
  const inspected = await page.evaluate(() => window.workbench.request('intersect/inspect'));
  expect(inspected.evaluation.diagnostics).toEqual([]);
  const elements = inspected.evaluation.model.elements;
  expect(elements.map(e => [e.class,e.values.name])).toEqual([
    ['Model','Demo'],['Type','Vehicle'],['Feature','wheel'],['Model','Additional'],['Type','Axle'],['Feature','axle'],
  ]);
  expectAuthoredTypeIdentities(inspected, 'urn:intersect:xtext:mini-kerml:fragments:1');
  expect(elements[2].values.target).toBe(elements[1].id);
  expect(elements[5].values.target).toBe(elements[4].id);
  expect(inspected.evaluation.references.map(r=>r.target)).toEqual([elements[1].id,elements[4].id]);
  await page.evaluate(async () => { const wb=window.workbench; const snapshot=wb.project.snapshot(); if(snapshot.compilerProfile!=='intersect.xtext.native.v1') throw new Error('Missing compiler profile'); if(snapshot.profile!=='xtext-fragments') throw new Error('Missing fragment profile'); wb.project.load(snapshot); await wb.compile(); });
  const replay = await page.evaluate(() => window.workbench.request('intersect/inspect'));
  expect(replay.evaluation.model).toEqual(inspected.evaluation.model);
  await expect(page.locator('#example')).toHaveValue('xtext-fragments');
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/,{timeout:60000});
  await page.getByRole('button',{name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-fragments-example.png',fullPage:true});
  await page.evaluate(() => { const m=window.workbench.definitionModels.xtext; m.setValue(m.getValue().replace('name=ID;', "'named' name=ID?;").replace("'type' Identification ';'", "'type' Identification name=ID ';'")); });
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
  const rejected=await page.evaluate(()=>window.workbench.request('intersect/inspect'));
  expect(rejected.evaluation.model).toEqual(inspected.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  const library=await page.evaluate(()=>window.workbench.request('intersect/inspect'));
  expect(library.evaluation.model.elements.some(e=>e.class==='BookCopy')).toBe(true);
});


test('native project compiler selection is independent from presentation and worker ZIP export retains it', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-fragments');await waitForExample(page,'xtext-fragments',1);
  await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  const result=await page.evaluate(async()=>{
    const wb=window.workbench; const before=await wb.inspect(); const snapshot=wb.project.snapshot();
    snapshot.profile='default'; wb.project.load(snapshot); await wb.compile();
    const replay=await wb.inspect();
    const distribution=await wb.request('intersect/packageExport',{revision:replay.interfaceRevision,metadata:{package_id:'xtext.fragments',release:'1',display_name:'Fragments',description:''}});
    delete snapshot.compilerProfile;
    let rejection;
    try { wb.project.load(snapshot); } catch (error) { rejection=error.message; }
    return {before,replay,distribution,rejection};
  });
  expect(result.replay.evaluation.model).toEqual(result.before.evaluation.model);
  expect(result.distribution.manifest.runtime.profile).toBe('intersect.xtext.native.v1');
  expect(result.distribution.package.sources).toEqual(result.before.package.sources);
  expect(result.rejection).toContain('Unsupported Xtext compiler profile');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
});


test('punctuation example preserves operator values and exact project replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-punctuation');await waitForExample(page,'xtext-punctuation',1);
  await expect(page.locator('#example')).toHaveValue('xtext-punctuation');
  await expect(page.locator('#element-count')).toHaveText('7 elements',{timeout:60000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class')).toHaveCount(4);
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.evaluation.model.elements.map(e=>[e.class,e.values.name])).toEqual([
    ['Model','Demo'],['Import','Parts'],['Import','Units'],['Specialization','Wheel'],['Specialization','front'],['Model','Additional'],['Import','Local']
  ]);
  expect(before.evaluation.model.elements[1].values.recursive).toBe(true);
  expect(before.evaluation.model.elements[2].values.all).toBe(true);
  expect(before.evaluation.model.elements[4].values.redefinition).toBe(true);
  const replay=await page.evaluate(async()=>{
    const wb=window.workbench,snapshot=wb.project.snapshot();
    if(snapshot.profile!=='xtext-punctuation'||snapshot.compilerProfile!=='intersect.xtext.native.v1') throw new Error('Missing native punctuation profile');
    wb.project.load(snapshot);await wb.compile();return wb.inspect();
  });
  expect(replay.package.sources).toEqual(before.package.sources);
  expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/,{timeout:60000});
  await page.getByRole('button',{name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-punctuation-example.png',fullPage:true});
  await page.evaluate(()=>{const m=window.workbench.definitionModels.xtext;m.setValue(m.getValue().replace("'::'","'/*'"));});
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
  const rejected=await page.evaluate(()=>window.workbench.inspect());
  expect(rejected.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);
  await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).package.grammar.profile).toBe('intersect.workbench.v1');
});

test('qualified-name datatypes link exact names across resources and preserve project replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-datatypes');await waitForExample(page,'xtext-datatypes',1);
  await expect(page.locator('#example')).toHaveValue('xtext-datatypes');
  await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class')).toHaveCount(4);
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.evaluation.model.elements.map(e=>[e.class,e.values.name])).toEqual([
    ['Model','Demo'],['Type','Parts::Wheel'],['Feature','front'],['Feature','distance'],['Model','Library'],['Type','Units::Length']
  ]);
  expect(before.evaluation.model.elements[2].values.target).toBe(before.evaluation.model.elements[1].id);
  expect(before.evaluation.model.elements[3].values.target).toBe(before.evaluation.model.elements[5].id);
  const replay=await page.evaluate(async()=>{
    const wb=window.workbench,snapshot=wb.project.snapshot();
    if(snapshot.profile!=='xtext-datatypes'||snapshot.compilerProfile!=='intersect.xtext.native.v1') throw new Error('Missing native datatype profile');
    wb.project.load(snapshot);await wb.compile();return wb.inspect();
  });
  expect(replay.package.sources).toEqual(before.package.sources);
  expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/,{timeout:60000});
  await page.getByRole('button',{name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-datatype-example.png',fullPage:true});
  await page.evaluate(()=>{const m=window.workbench.definitionModels.xtext;m.setValue(m.getValue().replace('returns ecore::EString','returns ecore::EInt'));});
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);
  await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).package.grammar.profile).toBe('intersect.workbench.v1');
});

test('leading simple actions select concrete classes, initialize and retain project replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-actions');await waitForExample(page,'xtext-actions',1);
  await expect(page.locator('#example')).toHaveValue('xtext-actions');
  await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class')).toHaveCount(4);
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.evaluation.model.elements.map(e=>[e.class,e.values.name])).toEqual([
    ['Model','Demo'],['Type','Vehicle'],['Type','Wheel'],['Feature','wheel'],['Model','Library'],['Type','Spare']
  ]);
  expect(before.evaluation.model.elements[1].values.origin).toBe('authored');
  expect(before.evaluation.model.elements[2].values.origin).toBe('constructor');
  expect(before.evaluation.model.elements[3].values.target).toBe(before.evaluation.model.elements[2].id);
  for(const index of [1,2,5]) expect(before.evaluation.model.elements[index].initialization.object).toBe(before.evaluation.model.elements[index].id);
  const replay=await page.evaluate(async()=>{
    const wb=window.workbench,snapshot=wb.project.snapshot();
    if(snapshot.profile!=='xtext-actions'||snapshot.compilerProfile!=='intersect.xtext.native.v1') throw new Error('Missing native action profile');
    wb.project.load(snapshot);await wb.compile();return wb.inspect();
  });
  expect(replay.package.sources).toEqual(before.package.sources);
  expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/,{timeout:60000});
  await page.getByRole('button',{name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-actions-example.png',fullPage:true});
  await page.evaluate(()=>{const m=window.workbench.definitionModels.xtext;m.setValue(m.getValue().replace('{k::Type}','{k::Element}'));});
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);
  await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).package.grammar.profile).toBe('intersect.workbench.v1');
});

test('native terminal example preserves raw names, references and project replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-terminals');await waitForExample(page,'xtext-terminals',1);
  await expect(page.locator('#example')).toHaveValue('xtext-terminals');
  await expect(page.locator('#element-count')).toHaveText('5 elements',{timeout:60000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class')).toHaveCount(4);
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.evaluation.model.elements.map(e=>[e.class,e.values.name])).toEqual([['Model','Demo'],['Type','@Wheel'],['Feature','wheel'],['Model','Library'],['Type','@Spare']]);
  expect(before.evaluation.model.elements[2].values.target).toBe(before.evaluation.model.elements[1].id);
  const replay=await page.evaluate(async()=>{
    const wb=window.workbench,snapshot=wb.project.snapshot();
    if(snapshot.profile!=='xtext-terminals'||snapshot.compilerProfile!=='intersect.xtext.native.v1') throw new Error('Missing native terminal profile');
    wb.project.load(snapshot);await wb.compile();return wb.inspect();
  });
  expect(replay.package.sources).toEqual(before.package.sources);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/,{timeout:60000});
  await page.getByRole('button',{name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-terminals-example.png',fullPage:true});
  await page.evaluate(()=>{const m=window.workbench.definitionModels.xtext;m.setValue(m.getValue()+'\nterminal OTHER: "@" "x";');});
  await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).package.grammar.profile).toBe('intersect.workbench.v1');
});

test('explicit lexical example retains significant comments and exact pinned terminal source', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-lexical');await waitForExample(page,'xtext-lexical',1);
  await expect(page.locator('#example')).toHaveValue('xtext-lexical');
  await expect(page.locator('#element-count')).toHaveText('5 elements',{timeout:60000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class')).toHaveCount(4);
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.evaluation.model.elements.map(e=>[e.class,e.values.name])).toEqual([['Model','Demo'],['Type',"'Wheel assembly'"],['Feature','wheel'],['Model','Library'],['Type','Spare']]);
  expect(before.evaluation.model.elements[2].values.target).toBe(before.evaluation.model.elements[1].id);
  const replay=await page.evaluate(async()=>{
    const wb=window.workbench,snapshot=wb.project.snapshot();
    if(snapshot.profile!=='xtext-lexical'||snapshot.compilerProfile!=='intersect.xtext.native.v1') throw new Error('Missing explicit lexical profile');
    wb.project.load(snapshot);await wb.compile();return wb.inspect();
  });
  expect(replay.package.sources).toEqual(before.package.sources);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/,{timeout:60000});
  await page.getByRole('button',{name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-lexical-example.png',fullPage:true});
  await page.evaluate(()=>{const m=window.workbench.definitionModels.xtext;m.setValue(m.getValue().replace('hidden(WS)','hidden(MISSING)'));});
  await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).package.grammar.profile).toBe('intersect.workbench.v1');
});

test('predictive lexical example preserves overlapping tokens and the versioned compiler profile', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-prediction');await waitForExample(page,'xtext-prediction',2);
  await expect(page.locator('#example')).toHaveValue('xtext-prediction');
  await expect(page.locator('#element-count')).toHaveText('5 elements',{timeout:60000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('.structure-class')).toHaveCount(4);
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.evaluation.model.elements[1].values.count).toBe(12);
  expect(before.evaluation.model.elements[1].values.magnitude).toBe('1e3');
  expect(before.evaluation.model.elements.map(e=>[e.class,e.values.name])).toEqual([['Model','Demo'],['Type',"'Wheel assembly'"],['Feature','wheel'],['Model','Library'],['Type','Spare']]);
  expect(before.evaluation.model.elements[2].values.target).toBe(before.evaluation.model.elements[1].id);
  const replay=await page.evaluate(async()=>{
    const wb=window.workbench,snapshot=wb.project.snapshot();
    if(snapshot.profile!=='xtext-prediction'||snapshot.compilerProfile!=='intersect.xtext.native.v2') throw new Error('Missing predictive lexical profile');
    wb.project.load(snapshot);await wb.compile();return wb.inspect();
  });
  expect(replay.package.sources).toEqual(before.package.sources);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/,{timeout:60000});
  await page.getByRole('button',{name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-prediction-example.png',fullPage:true});
  await page.evaluate(()=>{const m=window.workbench.definitionModels.xtext;m.setValue(m.getValue().replace('hidden(WS, ML_NOTE, SL_NOTE)','hidden(MISSING)'));});
  await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).package.grammar.profile).toBe('intersect.workbench.v1');
});

test('inherited grammar example retains parent sources through projects and archive export', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-inheritance');await waitForExample(page,'xtext-inheritance',2);
  await expect(page.locator('#example')).toHaveValue('xtext-inheritance');
  await expect(page.locator('#element-count')).toHaveText('4 elements',{timeout:60000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#export-package')).toBeEnabled();
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.evaluation.model.elements.map(e=>[e.class,e.values.name])).toEqual([['Model','p'],['Type','Wheel'],['Model','library'],['Type','Spare']]);
  const replay=await page.evaluate(async()=>{
    const wb=window.workbench,snapshot=wb.project.snapshot();
    if(snapshot.definitionBundle.bundle.sources.length!==4) throw new Error('Parent source missing from project');
    wb.project.load(snapshot);await wb.compile();
    const state=await wb.inspect();
    const archive=await wb.request('intersect/packageExport',{revision:state.interfaceRevision,metadata:{package_id:'example.inherited',release:'1',display_name:'Inherited',description:''}});
    return {state,archive,snapshot:wb.project.snapshot()};
  });
  expect(replay.state.evaluation.model).toEqual(before.evaluation.model);
  expect(replay.state.package.compilation).toEqual(before.package.compilation);
  expect(replay.archive.manifest.format_version).toBe(2);
  expect(JSON.parse(replay.archive.files[replay.archive.manifest.definitions.bundle]).bundle.sources).toEqual(before.package.compilation.bundle.sources);
  expect(replay.snapshot.definitionBundle.bundle.sources.find(s=>s.id.uri==='base.xtext').text).toContain('grammar example.Base hidden(WS)');
  await page.locator('.ide-file-menu > summary').click();
  await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.inherited');
  await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;
  const files=unzipSync(await readFile(await download.path()));
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  expect(manifest.format_version).toBe(2);
  const retained=JSON.parse(strFromU8(files[manifest.definitions.bundle]));
  expect(retained.bundle.sources).toEqual(before.package.compilation.bundle.sources);
  expect(strFromU8(files['README.txt'])).toContain('format 2');
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/,{timeout:60000});
  await page.getByRole('button',{name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-inheritance-example.png',fullPage:true});
  await page.evaluate(()=>{const m=window.workbench.definitionModels.xtext;m.setValue(m.getValue().replace('with example.Base','with example.Missing'));});
  await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  expect(await page.evaluate(()=>window.workbench.project.snapshot().definitionBundle)).toBeUndefined();
});

test('contextual parser overrides preserve inherited callers, shadowed sources and project replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-overrides');await waitForExample(page,'xtext-overrides',3);
  await expect(page.locator('#element-count')).toHaveText('4 elements',{timeout:60000});
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await expect(page.locator('#export-package')).toBeEnabled();
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.package.grammar.profile).toBe('intersect.xtext.native.v3');
  expect(before.evaluation.model.elements.map(e=>[e.class,e.values.name])).toEqual([['Model','p'],['Type','Wheel'],['Model','library'],['Type','Spare']]);
  expect(before.package.grammar.declaration_sources.Model.source.uri).toBe('base.xtext');
  expect(before.package.grammar.declaration_sources.Member.source.uri).toBe('model.xtext');
  expect(before.package.grammar.shadowed_declarations.Member[0].source.uri).toBe('base.xtext');
  const replay=await page.evaluate(async()=>{
    const wb=window.workbench,snapshot=wb.project.snapshot();
    wb.project.load(snapshot);await wb.compile();
    const state=await wb.inspect();
    const archive=await wb.request('intersect/packageExport',{revision:state.interfaceRevision,metadata:{package_id:'example.overrides',release:'1',display_name:'Overrides',description:''}});
    return {state,archive,snapshot:wb.project.snapshot()};
  });
  expect(replay.snapshot.compilerProfile).toBe('intersect.xtext.native.v3');
  expect(replay.state.package).toEqual(before.package);
  expect(replay.state.evaluation.model).toEqual(before.evaluation.model);
  expect(replay.archive.manifest.runtime.profile).toBe('intersect.xtext.native.v3');
  expect(JSON.parse(replay.archive.files[replay.archive.manifest.definitions.bundle]).bundle.sources).toEqual(before.package.compilation.bundle.sources);
  await expect(page.locator('.structure-message')).not.toHaveClass(/structure-error/,{timeout:60000});
  await page.getByRole('button',{name:'Fit diagram to view',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-overrides-example.png',fullPage:true});
  await page.evaluate(()=>{const m=window.workbench.definitionModels.xtext;m.setValue(m.getValue().replace('@Override\nMember','@Override\nMissing'));});
  await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  expect(await page.evaluate(()=>window.workbench.project.snapshot().definitionBundle)).toBeUndefined();
});

test('cumulative KerML showcase replays projects and downloaded language ZIP with all supported mechanisms', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-showcase');await waitForExample(page,'xtext-showcase',3);
  await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  await expect(page.locator('#model-scenario')).toHaveCount(0);
  await expect(page.locator('#model-samples')).toBeHidden();
  await expect(page.locator('#example option')).toHaveCount(6);
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.package.grammar.rules.Identification.fragment).toBe(true);
  expect(before.package.grammar.shadowed_declarations.Type[0].source.uri).toBe('base.xtext');
  expect(before.evaluation.model.elements.filter(e=>e.class==='Type').map(e=>[e.values.name,e.values.isAbstract,e.values.count,e.values.magnitude])).toEqual([["Vehicles::'Wheel assembly'",true,12,'1e3'],['Library::Spare',false,3,'12E-3']]);
  const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
  expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.kerml.showcase');await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
  const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
  const manifest=JSON.parse(files['manifest.json']);expect(manifest.runtime.profile).toBe('intersect.xtext.native.v3');
  expect(JSON.parse(files[manifest.definitions.bundle]).bundle.sources).toEqual(before.package.compilation.bundle.sources);
  const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
  expect(imported.package).toEqual(before.package);expect(imported.evaluation.diagnostics).toEqual([]);expect(imported.evaluation.model).toEqual(before.evaluation.model);
  await page.getByRole('tab',{name:'Test',exact:true}).click();await expect(page.locator('#model-tree')).toContainText('Wheel assembly');
  await page.screenshot({path:'test-results/kerml-xtext-showcase.png',fullPage:true});
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
  expect((await page.evaluate(()=>window.workbench.inspect())).package.grammar.profile).toBe('intersect.workbench.v1');
});

test('inferred KerML datatypes preserve exact project and downloaded archive replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-inference');await waitForExample(page,'xtext-inference',4);
  await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  await expect(page.locator('#model-scenario')).toHaveCount(0);
  await expect(page.locator('#model-samples')).toBeHidden();
  await expect(page.locator('#example option')).toHaveCount(6);
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);
  expect(before.package.grammar.rules.Identification.fragment).toBe(true);
  expect(before.package.grammar.shadowed_declarations.Type[0].source.uri).toBe('base.xtext');
  expect(before.evaluation.model.elements.filter(e=>e.class==='Type').map(e=>[e.values.name,e.values.isAbstract,e.values.count,e.values.magnitude])).toEqual([["Vehicles::'Wheel assembly'",true,12,'1e3'],['Library::Spare',false,3,'12E-3']]);
  expect(before.package.grammar.rules.QualifiedName.inferred_return).toBe(true);
  expect(before.evaluation.model.elements.find(e=>e.class==='Type').values.operator).toBe('if');
  const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
  expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.kerml.inference');await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
  const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
  const manifest=JSON.parse(files['manifest.json']);expect(manifest.runtime.profile).toBe('intersect.xtext.native.v4');
  expect(JSON.parse(files[manifest.definitions.bundle]).bundle.sources).toEqual(before.package.compilation.bundle.sources);
  const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
  expect(imported.package).toEqual(before.package);expect(imported.evaluation.diagnostics).toEqual([]);expect(imported.evaluation.model).toEqual(before.evaluation.model);
  await page.getByRole('tab',{name:'Test',exact:true}).click();await expect(page.locator('#model-tree')).toContainText('Wheel assembly');
  await page.screenshot({path:'test-results/kerml-inferred-datatypes.png',fullPage:true});
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
  expect((await page.evaluate(()=>window.workbench.inspect())).package.grammar.profile).toBe('intersect.workbench.v1');
});


test('current actions retain constructed graphs through project and downloaded package replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-current');await waitForExample(page,'xtext-current',5);
  await expect(page.locator('#element-count')).toHaveText('8 elements',{timeout:60000});
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);expect(before.package.grammar.profile).toBe('intersect.xtext.native.v5');
  const elements=before.evaluation.model.elements;
  expect(elements[0].values.value).toBe(elements[4].id);
  expect(elements[2].values.operand).toEqual([elements[1].id,elements[3].id]);
  expect(elements[4].values.operand).toEqual([elements[2].id,elements[5].id]);
  expect(elements[2].values.operator).toBe('+');expect(elements[4].values.operator).toBe('-');
  const original=await page.evaluate(()=>window.workbench.modelModels.catalog.getValue());
  await page.evaluate(()=>window.workbench.modelModels.catalog.setValue('Demo = 1 +;'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model.elements.filter(e=>e.resource===elements[0].resource)).toEqual([]);
  await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
  expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.xtext.current');await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
  const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
  expect(JSON.parse(files['manifest.json']).runtime.profile).toBe('intersect.xtext.native.v5');
  const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
  expect(imported.package).toEqual(before.package);expect(imported.evaluation.model).toEqual(before.evaluation.model);expect(imported.evaluation.diagnostics).toEqual([]);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.locator('#model-tree')).toContainText('OperatorExpression');
  await page.screenshot({path:'test-results/xtext-current-actions.png',fullPage:true});
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('first-token predicates retain selected branches through project and downloaded package replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-predicates');await waitForExample(page,'xtext-predicates',6);
  await expect(page.locator('#element-count')).toHaveText('5 elements',{timeout:60000});
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);expect(before.package.grammar.profile).toBe('intersect.xtext.native.v6');
  const elements=before.evaluation.model.elements;
  expect(elements.map(e=>e.class)).toEqual(['Model','Left','Left','Model','Left']);
  expect(elements.filter(e=>e.class==='Left').map(e=>e.values.number)).toEqual([12,13,4]);
  const original=await page.evaluate(()=>window.workbench.modelModels.catalog.getValue());
  await page.evaluate(()=>window.workbench.modelModels.catalog.setValue('model { a b 2147483648; }'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model.elements.filter(e=>e.resource===elements[0].resource)).toEqual([]);
  await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
  expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.xtext.predicates');await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
  const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
  expect(JSON.parse(files['manifest.json']).runtime.profile).toBe('intersect.xtext.native.v6');
  const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
  expect(imported.package).toEqual(before.package);expect(imported.evaluation.model).toEqual(before.evaluation.model);expect(imported.evaluation.diagnostics).toEqual([]);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.locator('#model-tree')).toContainText('Left');
  await page.screenshot({path:'test-results/xtext-predicates-actions.png',fullPage:true});
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('cumulative enum rules retain literal identities through project and downloaded package replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-enums');await waitForExample(page,'xtext-enums',7);
  await expect(page.locator('#element-count')).toHaveText('6 elements',{timeout:60000});
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);expect(before.package.grammar.profile).toBe('intersect.xtext.native.v7');
  const elements=before.evaluation.model.elements;
  expect(elements.filter(e=>e.class==='Type').map(e=>e.values.visibility.literal.path)).toEqual([[4,2],[4,0]]);
  expect(elements.filter(e=>e.class==='Feature').map(e=>e.values.direction.literal.path)).toEqual([[5,2],[5,1]]);
  const original=await page.evaluate(()=>window.workbench.modelModels.catalog.getValue());
  await page.evaluate(()=>window.workbench.modelModels.catalog.setValue('package Broken { type T visibility internal; }'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model.elements.filter(e=>e.resource===elements[0].resource)).toEqual([]);
  await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
  expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.xtext.enums');await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
  const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
  expect(JSON.parse(files['manifest.json']).runtime.profile).toBe('intersect.xtext.native.v7');
  const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
  expect(imported.package).toEqual(before.package);expect(imported.evaluation.model).toEqual(before.evaluation.model);expect(imported.evaluation.diagnostics).toEqual([]);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.locator('#model-tree')).toContainText('Wheel assembly');
  for(const [name,literal] of [["Vehicles::'Wheel assembly' · Type",'VisibilityKind.public'],['Library::Spare · Type','VisibilityKind.private'],['front · Feature','FeatureDirectionKind.out'],['spare · Feature','FeatureDirectionKind.inout']]) {
    await page.getByRole('treeitem',{name,exact:true}).locator(':scope > .instance-row').click();
    await expect(page.getByRole('region',{name:'Instance properties'})).toContainText(literal);
  }
  await page.getByRole('treeitem',{name:"Vehicles::'Wheel assembly' · Type",exact:true}).locator(':scope > .instance-row').click();
  await page.screenshot({path:'test-results/xtext-enums-actions.png',fullPage:true});
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('cumulative rule converters retain Boolean semantics through project and downloaded package replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-converters');await waitForExample(page,'xtext-converters',8);
  await expect(page.locator('#element-count')).toHaveText('7 elements',{timeout:60000});
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);expect(before.package.grammar.profile).toBe('intersect.xtext.native.v8');
  const elements=before.evaluation.model.elements;
  expect(elements.filter(e=>e.class==='Type').map(e=>e.values.visibility.literal.path)).toEqual([[4,2],[4,0]]);
  expect(elements.filter(e=>e.class==='Feature').map(e=>e.values.direction.literal.path)).toEqual([[5,2],[5,1],[5,0]]);
  expect(elements.filter(e=>e.class==='Feature').map(e=>[e.values.name,e.values.isUnique,e.values.isOrdered,e.values.isEnabled])).toEqual([['front',false,true,true],['spare',false,true,false],['standard',true,false,false]]);
  const original=await page.evaluate(()=>window.workbench.modelModels.catalog.getValue());
  await page.evaluate(()=>window.workbench.modelModels.catalog.setValue('package Broken { feature F nonunique enabled maybe :> Library::Spare; }'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model.elements.filter(e=>e.resource===elements[0].resource)).toEqual([]);
  await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
  expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.xtext.converters');await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
  const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
  expect(JSON.parse(files['manifest.json']).runtime.profile).toBe('intersect.xtext.native.v8');
  const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
  expect(imported.package).toEqual(before.package);expect(imported.evaluation.model).toEqual(before.evaluation.model);expect(imported.evaluation.diagnostics).toEqual([]);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.locator('#model-tree')).toContainText('Wheel assembly');
  for(const [name,literal] of [["Vehicles::'Wheel assembly' · Type",'VisibilityKind.public'],['Library::Spare · Type','VisibilityKind.private'],['front · Feature','FeatureDirectionKind.out'],['spare · Feature','FeatureDirectionKind.inout']]) {
    await page.getByRole('treeitem',{name,exact:true}).locator(':scope > .instance-row').click();
    await expect(page.getByRole('region',{name:'Instance properties'})).toContainText(literal);
  }
  await page.getByRole('treeitem',{name:"Vehicles::'Wheel assembly' · Type",exact:true}).locator(':scope > .instance-row').click();
  for(const [name,unique,enabled] of [['front',false,true],['spare',false,false],['standard',true,false]]) {
    await page.getByRole('treeitem',{name:`${name} · Feature`,exact:true}).locator(':scope > .instance-row').click();
    for(const [field,value] of [['isUnique',unique],['isEnabled',enabled]])await expect(page.getByRole('region',{name:'Instance properties'}).getByText(field,{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText(String(value));
  }
  await page.getByRole('treeitem',{name:'front · Feature',exact:true}).locator(':scope > .instance-row').click();
  await page.screenshot({path:'test-results/xtext-converters.png',fullPage:true});
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('recursive predicates retain committed branches through project and downloaded package replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-recursive');await waitForExample(page,'xtext-recursive',9);
  await expect(page.locator('#element-count')).toHaveText('4 elements',{timeout:60000});
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);expect(before.package.grammar.profile).toBe('intersect.xtext.native.v9');
  const elements=before.evaluation.model.elements;
  expect(elements.map(e=>e.class)).toEqual(['Left','Inner','Inner','Left']);
  expect(elements.filter(e=>e.class==='Left').map(e=>e.values.number)).toEqual([12,4]);
  const original=await page.evaluate(()=>window.workbench.modelModels.catalog.getValue());
  await page.evaluate(()=>window.workbench.modelModels.catalog.setValue('a a b c'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model.elements.filter(e=>e.resource===elements[0].resource)).toEqual([]);
  await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
  expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.xtext.recursive');await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
  const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
  expect(JSON.parse(files['manifest.json']).runtime.profile).toBe('intersect.xtext.native.v9');
  const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
  expect(imported.package).toEqual(before.package);expect(imported.evaluation.model).toEqual(before.evaluation.model);expect(imported.evaluation.diagnostics).toEqual([]);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.locator('#model-tree')).toContainText('Left');
  await page.screenshot({path:'test-results/xtext-recursive-actions.png',fullPage:true});
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('real values retain IEEE semantics through project and downloaded package replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-double');await waitForExample(page,'xtext-double',10);
  await expect(page.locator('#element-count')).toHaveText('7 elements',{timeout:60000});
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);expect(before.package.grammar.profile).toBe('intersect.xtext.native.v10');
  const values=before.evaluation.model.elements.filter(e=>e.class==='LiteralRational').map(e=>e.values.value);
  expect(values.map(v=>v.bits)).toEqual(['3fe0000000000000','4093880000000000','0000000000000001','7ff0000000000000','0000000000000000']);
  const original=await page.evaluate(()=>window.workbench.modelModels.catalog.getValue());
  await page.evaluate(()=>window.workbench.modelModels.catalog.setValue('values . 5'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model.elements.length).toBe(2);
  await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
  expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.xtext.double');await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
  const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
  expect(JSON.parse(files['manifest.json']).runtime.profile).toBe('intersect.xtext.native.v10');
  const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
  expect(imported.package).toEqual(before.package);expect(imported.evaluation.model).toEqual(before.evaluation.model);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-real-values.png',fullPage:true});
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
});

test('recursive arguments retain caller ownership through project and downloaded package replay', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=xtext-arguments');await waitForExample(page,'xtext-arguments',11);
  await expect(page.locator('#element-count')).toHaveText('22 elements',{timeout:60000});
  const before=await page.evaluate(()=>window.workbench.inspect());
  expect(before.evaluation.diagnostics).toEqual([]);expect(before.package.grammar.profile).toBe('intersect.xtext.native.v11');
  const elements=before.evaluation.model.elements;
  expect(elements.filter(e=>e.class==='ParameterMembership')).toHaveLength(4);
  const target=elements.find(e=>e.values.name==='target');
  expect(elements.find(e=>e.class==='Redefinition').values.redefinedFeature).toBe(target.id);
  const original=await page.evaluate(()=>window.workbench.modelModels.catalog.getValue());
  await page.evaluate(()=>window.workbench.modelModels.catalog.setValue('model call f(atom a,)'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model.elements.length).toBe(8);
  await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
  expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
  expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
  await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
  await page.getByLabel('Package ID',{exact:false}).fill('example.xtext.arguments');await page.getByLabel('Release',{exact:false}).fill('1');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
  const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
  expect(JSON.parse(files['manifest.json']).runtime.profile).toBe('intersect.xtext.native.v11');
  const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
  expect(imported.package).toEqual(before.package);expect(imported.evaluation.model).toEqual(before.evaluation.model);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.screenshot({path:'test-results/xtext-recursive-arguments.png',fullPage:true});
  await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
});

for (const [example,count] of [['xtext-library-advanced',6],['xtext-expressions-advanced',9]]) {
  test(`advanced ${example} preserves model values through project and package replay`,async({page})=>{
    test.setTimeout(180000);
    await page.goto('/?example='+example);await waitForExample(page,example,27);
    await expect(page.locator('#element-count')).toHaveText(`${count} elements`,{timeout:60000});
    await expect.poll(()=>page.evaluate(async()=>{
      const state=await window.workbench.inspect();
      return {profile:state.package?.grammar?.profile,diagnostics:state.evaluation?.diagnostics};
    }),{timeout:60000}).toEqual({profile:'intersect.xtext.native.v27',diagnostics:[]});
    const before=await page.evaluate(()=>window.workbench.inspect());
    expect(before.evaluation.diagnostics).toEqual([]);
    expect(before.package.grammar.profile).toBe('intersect.xtext.native.v27');
    if(example==='xtext-library-advanced') {
      expect(before.evaluation.references).toHaveLength(2);
      expect(before.evaluation.model.elements.find(e=>e.values.name==='spare').values.title).toBe('untitled');
    } else {
      expect(before.evaluation.model.elements.filter(e=>e.class==='OperatorExpression').map(e=>e.values.operator)).toEqual(['+','-','all']);
    }
    const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
    expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
    const original=await page.evaluate(()=>window.workbench.modelModels.catalog.getValue());
    await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),example==='xtext-library-advanced'?'library Catalog { copy bad : ; }':'Demo = (1 +);');
    await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
    await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
    await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
    await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
    await page.getByLabel('Package ID',{exact:false}).fill('example.'+example);await page.getByLabel('Release',{exact:false}).fill('1');
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
    const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
    const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
    expect(JSON.parse(files['manifest.json']).runtime.profile).toBe('intersect.xtext.native.v27');
    const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
    expect(imported.package).toEqual(before.package);expect(imported.evaluation.model).toEqual(before.evaluation.model);
    await page.getByRole('tab',{name:'Test',exact:true}).click();await page.screenshot({path:`test-results/${example}.png`,fullPage:true});
    await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
  });
}

for (const [example,count] of [['xtext-library-composed',6],['xtext-expressions-composed',17]]) {
  test(`composed ${example} preserves model values through project and package replay`,async({page})=>{
    test.setTimeout(180000);
    await page.goto('/?example='+example);await waitForExample(page,example,52);
    // Library's starter and composed template both have six elements. Wait for
    // the selected language activation before inspecting its model snapshot.
    await expect.poll(()=>page.evaluate(async()=>{
      const state=await window.workbench.inspect();
      return {profile:state.package?.grammar?.profile,diagnostics:state.evaluation?.diagnostics};
    }),{timeout:60000}).toEqual({profile:'intersect.xtext.native.v52',diagnostics:[]});
    await expect(page.locator('#element-count')).toHaveText(`${count} elements`,{timeout:60000});
    const before=await page.evaluate(()=>window.workbench.inspect());
    expect(before.evaluation.diagnostics).toEqual([]);
    expect(before.package.grammar.profile).toBe('intersect.xtext.native.v52');
    if(example==='xtext-library-composed') {
      expect(before.evaluation.references).toHaveLength(2);
      expect(before.evaluation.model.elements.find(e=>e.values.name==='dune_1').values.title).toBe('Dune\nVolume 1');
      expect(before.evaluation.model.elements.find(e=>e.values.name==='spare_2').values.title).toBe('untitled');
    } else {
      expect(before.evaluation.model.elements.filter(e=>e.class==='OperatorExpression').map(e=>e.values.operator)).toEqual(['+','-','all','+','all','+']);
    }
    const replay=await page.evaluate(async()=>{const wb=window.workbench,snapshot=wb.project.snapshot();wb.project.load(snapshot);await wb.compile();return wb.inspect();});
    expect(replay.package).toEqual(before.package);expect(replay.evaluation.model).toEqual(before.evaluation.model);
    const original=await page.evaluate(()=>window.workbench.modelModels.catalog.getValue());
    await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),example==='xtext-library-composed'?'library Catalog { copy bad : ; }':'Demo = (1 +);');
    await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
    await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
    await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
    if(example==='xtext-library-composed') {
      await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text.replace('\\n','\\q')),original);
      await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
      await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),original);
      await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
      expect((await page.evaluate(()=>window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
    }
    await page.locator('.ide-file-menu > summary').click();await page.getByRole('button',{name:'Export language ZIP'}).click();
    await page.getByLabel('Package ID',{exact:false}).fill('example.'+example);await page.getByLabel('Release',{exact:false}).fill('1');
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
    const download=await downloading;const bytes=unzipSync(await readFile(await download.path()));
    const files=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,strFromU8(value)]));
    expect(JSON.parse(files['manifest.json']).runtime.profile).toBe('intersect.xtext.native.v52');
    const imported=await page.evaluate(async files=>{const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();const result=runtime({method:'package/import',files});if(!result.package)throw new Error('Archive import returned no package');return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};},files);
    expect(imported.package).toEqual(before.package);expect(imported.evaluation.model).toEqual(before.evaluation.model);
    await page.getByRole('tab',{name:'Test',exact:true}).click();await page.screenshot({path:`test-results/${example}.png`,fullPage:true});
    await page.locator('#example').selectOption('library');await waitForExample(page,'library',null);await expect(page.locator('#element-count')).toHaveText('6 elements');
  });
}
