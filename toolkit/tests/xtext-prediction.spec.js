// Actual editor/project consumers of the unchanged native prediction fixtures.
import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync, strFromU8} from 'fflate';

const cases = [
  ['projected',53,'model.xtext','left','right',0],
  ['nary',54,'nary.xtext','branch7','branch2',0],
  ['filtered',55,'filtered.xtext','right','right',2],
  ['discovery',56,'discovery.xtext','left','right',0],
];
async function inspect(page) {return page.evaluate(()=>window.workbench.inspect());}
async function complete(page, expected) {
  await expect.poll(async()=>{
    const state=await inspect(page);
    return {profile:state.package?.grammar?.profile,diagnostics:state.evaluation?.diagnostics,model:state.evaluation?.model};
  },{timeout:60000}).toEqual(expected);
}
for(const [name,version,fixture,catalogOperator,loansOperator,trailing] of cases) {
  test(`prediction adoption xtext-${name} preserves exact models and project/package lifecycle`,async({page})=>{
    test.setTimeout(240000);page.setDefaultTimeout(15000);
    const profile=`intersect.xtext.native.v${version}`;
    await page.goto('/?example=xtext-'+name);
    await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
    await expect(page.locator('#element-count')).toHaveText('2 elements');
    const before=await inspect(page);
    expect(before.package.grammar.profile).toBe(profile);
    expect(before.evaluation.diagnostics).toEqual([]);
    const snapshot=await page.evaluate(()=>window.workbench.project.snapshot());
    expect(snapshot.profile).toBe('xtext-'+name);
    expect(snapshot.compilerProfile).toBe(profile);
    expect(snapshot.definitions.xtext).toBe(await readFile(new URL('../.runtime/intersect-text/fixtures/xtext/projected-prediction/'+fixture,import.meta.url),'utf8'));
    const grammar=before.package.compilation.bundle.sources.find(s=>s.kind==='xtext');
    expect(grammar.text).toBe(snapshot.definitions.xtext);
    expect(grammar.id.sha256).toBe(createHash('sha256').update(grammar.text).digest('hex'));
    const roots=before.evaluation.model.elements;
    expect(roots).toHaveLength(2);
    for(const [i,key,operator] of [[0,'catalog',catalogOperator],[1,'loans',loansOperator]]) {
      const root=roots[i], text=snapshot.models[key], uri=`file:///models/${key}.library`;
      expect(root.id).toBe(uri+'#0');expect(root.resource).toBe(uri);
      expect([root.start,root.end]).toEqual([0,text.length-trailing]);
      expect(root.values).toEqual({operator,operand:[]});
      const declaration=before.package.schema.declarations[root.class];
      expect(declaration.path).toEqual([3]);
      expect(declaration.namespace).toBe('urn:intersect:xtext:current-actions:1');
      const source=before.package.compilation.bundle.sources.find(s=>s.id.uri===declaration.source.uri&&s.id.sha256===declaration.source.sha256);
      expect(source.kind).toBe('rcore');expect(source.text).toBe(snapshot.definitions.rcore);
      expect(source.id.sha256).toBe(createHash('sha256').update(source.text).digest('hex'));
      expect(root.type_identity).toBe(`${source.id.uri}@${source.id.sha256}#3`);
    }
    const expected={profile,diagnostics:[],model:before.evaluation.model};
    await page.locator('.ide-file-menu > summary').click();
    const saving=page.waitForEvent('download');await page.locator('#save-project').click();
    const saved=await saving, bytes=await readFile(await saved.path());
    expect(JSON.parse(bytes.toString('utf8'))).toEqual(snapshot);
    await page.locator('.ide-file-menu > summary').click();

    // Duplicate token languages must fail without replacing the active package.
    const alias=version===54?'branch2':version===55?'left':'right';
    await page.evaluate(({alias,target})=>{const wb=window.workbench;wb.definitionModels.xtext.setValue(wb.definitionModels.xtext.getValue().replace(`operator='${alias}'`,`operator='${target}'`));}, {alias,target:catalogOperator});
    await page.locator('#compile').click();
    await expect(page.locator('#compile-status')).toContainText('failed',{timeout:60000});
    const rejected=await inspect(page);
    expect(rejected.package).toEqual(before.package);expect(rejected.evaluation.model).toEqual(before.evaluation.model);

    // A valid grammar edit changes accepted text and the actual stored value.
    await page.evaluate(({grammar,old})=>window.workbench.definitionModels.xtext.setValue(grammar.replace(`operator='${old}'`,"operator='changed'")),{grammar:snapshot.definitions.xtext,old:catalogOperator});
    await page.locator('#compile').click();
    await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
    await expect.poll(async()=>(await inspect(page)).evaluation.diagnostics.length).toBeGreaterThan(0);
    await page.evaluate(({models,old})=>{for(const key of ['catalog','loans'])window.workbench.modelModels[key].setValue(models[key].replaceAll(old,'changed'));},{models:snapshot.models,old:catalogOperator});
    await expect.poll(async()=>(await inspect(page)).evaluation.model.elements.map(e=>e.values.operator)).toEqual(['changed',loansOperator===catalogOperator?'changed':loansOperator]);
    expect((await inspect(page)).evaluation.diagnostics).toEqual([]);

    // The actual downloaded project, rather than a reconstructed test object.
    await page.locator('#project-file').setInputFiles({name:'prediction.intersect.json',mimeType:'application/json',buffer:bytes});
    await page.locator('#compile').click();await complete(page,expected);
    expect(await page.evaluate(()=>window.workbench.project.snapshot())).toEqual(snapshot);
    await page.locator('.ide-info > summary').click();await page.locator('#restart').click();await page.locator('.ide-info > summary').click();
    await expect(page.locator('#compile')).toBeEnabled({timeout:60000});await complete(page,expected);
    expect(await page.evaluate(()=>window.workbench.project.snapshot())).toEqual(snapshot);
    await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text+' ?'),snapshot.models.catalog);
    await expect.poll(async()=>(await inspect(page)).evaluation.diagnostics.length).toBeGreaterThan(0);
    await page.evaluate(text=>window.workbench.modelModels.catalog.setValue(text),snapshot.models.catalog);await complete(page,expected);

    await page.locator('.ide-file-menu > summary').click();await page.locator('#export-package').click();
    await page.getByLabel('Package ID',{exact:false}).fill('example.prediction.'+name);await page.getByLabel('Release',{exact:false}).fill('1');
    const exporting=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();
    const archive=await exporting, zipped=unzipSync(await readFile(await archive.path()));
    const files=Object.fromEntries(Object.entries(zipped).map(([key,value])=>[key,strFromU8(value)]));
    const manifest=JSON.parse(files['manifest.json']);expect(manifest.runtime.profile).toBe(profile);
    expect(JSON.parse(files['definitions/bundle.json'])).toEqual(before.package.compilation);
    for(const [path,digest] of Object.entries(manifest.files)) {
      expect(createHash('sha256').update(zipped[path]).digest('hex')).toBe(digest.sha256);
      expect(zipped[path].length).toBe(digest.bytes);
    }
    const imported=await page.evaluate(async files=>{
      const {loadRuntime}=await import('/src/runtime.js');const runtime=await loadRuntime();
      const result=runtime({method:'package/import',files});if(!result.package)throw new Error(JSON.stringify(result));
      return {package:result.package,evaluation:runtime({method:'evaluate',package:result.package,sources:Object.values(window.workbench.modelModels).map(m=>({uri:m.uri.toString(),text:m.getValue()}))})};
    },files);
    expect(imported.package).toEqual(before.package);expect(imported.evaluation.diagnostics).toEqual([]);expect(imported.evaluation.model).toEqual(before.evaluation.model);
    await page.getByRole('tab',{name:'Test',exact:true}).click();await page.screenshot({path:`test-results/xtext-${name}-adoption.png`,fullPage:true});
    await page.locator('#example').selectOption('library');await expect(page.locator('#element-count')).toHaveText('6 elements');
  });
}
