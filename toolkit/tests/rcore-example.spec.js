import {test,expect} from '@playwright/test';

for (const example of ['library','rcore']) {
  test(`${example} starter Python walkthrough executes through the generated model API`, async ({page}) => {
    test.setTimeout(120000);
    await page.goto(`/?example=${example}`);
    await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
    await page.getByRole('tab',{name:'Test',exact:true}).click();
    await page.getByRole('tab',{name:'script.py',exact:true}).click();
    await page.locator('#python-enable').click();
    await expect(page.locator('#python-run')).toBeEnabled({timeout:30000});
    await page.locator('#python-run').click();
    await expect(page.locator('#python-status')).toContainText(/Committed|rolled back/,{timeout:60000});
    expect(await page.locator('#python-status').textContent(), await page.locator('#python-error').textContent()).toContain('Committed');
    await expect(page.locator('#python-error')).toBeEmpty();
    await expect(page.locator('#python-output')).toContainText(example === 'library' ? 'Enum default after unset:' : 'AB A -> B');
  });
}

test('starter scenarios expose graph closure, defaults and domain validation', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/?example=rcore');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:60000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#model-samples > summary').click();
  await page.locator('[data-model-sample="graph"]').click();
  await expect(page.locator('#element-count')).toHaveText('11 elements');
  await page.getByRole('tab', {name:'Test',exact:true}).click();
  await page.locator('#dock-tab-rcore').click();
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A → B → D → C', {timeout:60000});
  await page.locator('#rcore-seed').fill('D');
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('D');
  await page.getByRole('tab', {name:'Define',exact:true}).click();
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#compile-status')).toContainText('Language compiled', {timeout:60000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#model-samples > summary').click();
  await page.locator('[data-model-sample="circulation"]').click();
  await expect(page.locator('#element-count')).toHaveText('9 elements');
  const evaluated = await page.evaluate(async () => (await window.workbench.inspect()).evaluation);
  expect(evaluated.diagnostics).toEqual([]);
  const catalog = evaluated.model.elements.find(e => e.values.name === 'Catalog');
  const dune = evaluated.model.elements.find(e => e.values.name === 'dune');
  const earthsea = evaluated.model.elements.find(e => e.values.name === 'earthsea');
  expect(evaluated.derived[catalog.id].copyCount).toEqual({ kind: 'int64', value: '3' });
  expect(evaluated.derived[dune.id].available).toBe(false);
  expect(evaluated.derived[earthsea.id].available).toBe(true);
  expect(dune.values.condition.kind).toBe('enum');
  expect(dune.values.condition.literal.path).toEqual([5,0]);
  expect(dune.values.condition.literal.source).toEqual(dune.values.condition.enumeration.source);
  expect(dune.values.edition).toBe(1);
  expect(dune.values.library).toBe(catalog.id);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#model-samples > summary').click();
  await page.locator('[data-model-sample="invalid"]').click();
  await expect(page.locator('#diagnostic-list')).toContainText('A book copy cannot have more than one active loan.');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#model-samples > summary').click();
  await page.locator('[data-model-sample="default"]').click();
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect.poll(() => page.evaluate(async () => (await window.workbench.inspect()).evaluation.diagnostics)).toEqual([]);
});

test('Rcore definitions compile into the editable language and execute current model behavior',async({page})=>{
  test.setTimeout(180000);
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.locator('#example').selectOption('rcore',{force:true});
  await expect(page.locator('#definition-file')).toHaveText('specialization.rcore');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect(page.locator('#element-count')).toHaveText('8 elements');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#dock-tab-rcore').click();
  await expect(page.locator('#rcore-binding')).toContainText('allGenerals');
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A → B → C',{timeout:60000});
  await expect(page.locator('#rcore-read-status')).toContainText('10 semantic read records');
  await expect(page.locator('#rcore-reads')).toContainText('incoming_end');
  await page.locator('#rcore-observe').uncheck();
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A → B → C');
  await expect(page.locator('#rcore-read-status')).toHaveText('Observation disabled.');
  await page.locator('#rcore-observe').check();
  await page.evaluate(()=>window.workbench.modelModels.loans.setValue('model Relations { specialization AB A to B; specialization BD B to D; }'));
  await expect(page.locator('#model-status')).toContainText('valid');
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A → B → D',{timeout:60000});
  await page.getByRole('tab',{name:'Define',exact:true}).click();
  await page.evaluate(()=>{
    const m=window.workbench.definitionModels;
    m.rcore.setValue(m.rcore.getValue().replace('class Type { attr name: String [1,1]; op allGenerals() -> Type [0,*]; }','class Type { attr name: String [1,1]; attr rank: Int32 [0,1]; op allGenerals() -> Type [0,*]; }'));
    m.xtext.setValue(m.xtext.getValue().replace("'type' name=ID ';'","'type' name=ID ('rank' rank=INT)? ';'"));
    window.workbench.modelModels.catalog.setValue('model Types { type A rank 7; type B; type C; type D; }');
  });
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect.poll(()=>page.evaluate(async()=>{
    const r=await window.workbench.inspect(); return r.evaluation.model.elements.find(e=>e.values.name==='A')?.values.rank;
  })).toBe(7);
  await page.evaluate(()=>window.workbench.definitionModels.rcore.setValue(window.workbench.definitionModels.rcore.getValue().replace('closure([node], |t| directGenerals(t))','OrderedSet([node])')));
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#dock-tab-rcore').click();
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A',{timeout:60000});
  await expect(page.locator('#rcore-read-status')).toContainText('0 semantic read records · 1 validated model context');
  const revision=await page.evaluate(async()=>(await window.workbench.inspect()).revision);
  await page.getByRole('tab',{name:'Define',exact:true}).click();
  await page.evaluate(()=>window.workbench.definitionModels.rcore.setValue(window.workbench.definitionModels.rcore.getValue().replace('op allGenerals() -> Type [0,*];','op allGenerals() -> Type [0,*] unordered;')));
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Definition compilation failed');
  await expect(page.locator('#diagnostic-list')).toContainText('Operation result type');
  expect(await page.evaluate(async()=>(await window.workbench.inspect()).revision)).toBe(revision);
  await page.evaluate(()=>window.workbench.definitionModels.rcore.setValue(window.workbench.definitionModels.rcore.getValue().replace('op allGenerals() -> Type [0,*] unordered;','op allGenerals() -> Type [0,*];')));
  await page.evaluate(()=>window.workbench.definitionModels.rcore.setValue(window.workbench.definitionModels.rcore.getValue().replace('ref general: Type','ref general: Missing')));
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Definition compilation failed');
  await expect(page.locator('#diagnostic-list')).toContainText('Unknown structural type Missing');
  expect(await page.evaluate(async()=>(await window.workbench.inspect()).revision)).toBe(revision);
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect(page.locator('#element-count')).toHaveText('6 elements');
  await expect(page.locator('[data-definition="rcore"]')).toBeVisible();
});


test('Rcore Xtext construction reports bad links and accepts a changed grammar',async({page})=>{
  test.setTimeout(180000);
  await page.goto('/?example=rcore');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  const initial=await page.evaluate(async()=>(await window.workbench.inspect()).evaluation);
  expect(initial.diagnostics).toEqual([]);
  expect(initial.model.elements).toHaveLength(8);
  const endpoints=initial.model.elements.filter(e=>e.values.specific).map(e=>[e.values.specific,e.values.general]);
  expect(endpoints).toEqual([['file:///models/catalog.library#1','file:///models/catalog.library#2'],['file:///models/catalog.library#2','file:///models/catalog.library#3']]);
  // Keep the actual Monaco document URIs; changing the example does not rename them.
  await page.evaluate(()=>window.workbench.modelModels.loans.setValue('model Relations { specialization bad A to Missing; }'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
  await page.evaluate(()=>window.workbench.modelModels.loans.setValue('model Relations { specialization AB A to B; specialization BD B to D; }'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
  await page.getByRole('tab',{name:'Define',exact:true}).click();
  await page.evaluate(()=>window.workbench.definitionModels.xtext.setValue(window.workbench.definitionModels.xtext.getValue().replace("'type' name=ID","'classifier' name=ID")));
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBeGreaterThan(0);
  await page.evaluate(()=>window.workbench.modelModels.catalog.setValue('model Types { classifier A; classifier B; classifier C; classifier D; }'));
  await expect.poll(()=>page.evaluate(async()=>(await window.workbench.inspect()).evaluation.diagnostics.length)).toBe(0);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#dock-tab-rcore').click();
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A → B → D',{timeout:60000});
});


test('Toolkit Rcore diagram and project retain original sources and layout',async({page})=>{
  test.setTimeout(180000);
  await page.goto('/?example=rcore');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect(page.locator('.structure-class')).toHaveCount(3);
  await expect(page.locator('.structure-class[data-class="Type"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Add class',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Auto-layout',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Copy diagram',exact:true})).toBeEnabled();
  await page.locator('[data-definition="rcore"]').click();
  await page.getByRole('button',{name:'Rcore source',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Definition source',exact:true})).toBeVisible();
  const saved=await page.evaluate(()=>{
    const w=window.workbench;
    const layout=w.structure.getLayout(); layout.positions.Type={x:400,y:200};w.structure.setLayout(layout);
    return w.project.snapshot();
  });
  expect(saved.definitions.rcore).toContain('op allGenerals');
  await page.evaluate(()=>{window.workbench.definitionModels.rcore.setValue('');window.workbench.project.load(window.workbench.project.snapshot());});
  await page.evaluate(value=>window.workbench.project.load(value),saved);
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  expect(await page.evaluate(()=>window.workbench.project.snapshot())).toEqual(saved);
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#dock-tab-rcore').click();
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A → B → C',{timeout:60000});
});


test('Toolkit uses Rcore source and diagrams without an XML authoring surface', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect(page.locator('[data-definition="rcore"]')).toBeVisible();
  await expect(page.locator('[data-definition="ecore"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Ecore source',exact:true})).toHaveCount(0);
  await expect(page.locator('#open-ecore')).toHaveCount(0);
  await expect(page.locator('#save-ecore')).toHaveCount(0);
  const initial = await page.evaluate(()=>window.workbench.inspect());
  expect(initial.package.schema.classes.BookCopy.features.edition.default).toBe(1);
  const revision = initial.revision;
  await page.getByRole('button',{name:'Rcore source',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Definition source',exact:true})).toBeVisible();
  await page.evaluate(()=>{
    const m=window.workbench.definitionModels.rcore;
    m.setValue(m.getValue().replace('attr edition: Int32 [0,1] default 1;', 'attr edition: Int32 [0,1] default 1; attr rating: Int32 [0,1] default 7;'));
  });
  await page.getByRole('button',{name:'Class diagram',exact:true}).click();
  await expect(page.locator('.structure-class[data-class="BookCopy"]')).toContainText('rating');
  expect((await page.evaluate(()=>window.workbench.inspect())).revision).toBe(revision);
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  expect((await page.evaluate(()=>window.workbench.inspect())).package.schema.classes.BookCopy.features.rating.default).toBe(7);
  const current = (await page.evaluate(()=>window.workbench.inspect())).revision;
  await page.evaluate(()=>window.workbench.definitionModels.rcore.setValue(''));
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Definition compilation failed');
  expect((await page.evaluate(()=>window.workbench.inspect())).revision).toBe(current);
  await expect(page.getByRole('button',{name:'Copy diagram',exact:true})).toBeDisabled();
});

test('qualified Library enum defaults compile and reject invalid literals in WASM', async ({page}) => {
  await page.goto('/?example=library');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  expect(await page.evaluate(()=>window.workbench.definitionModels.rcore.getValue())).toContain('default BookCondition.GOOD;');
  await page.evaluate(()=>{
    const model=window.workbench.definitionModels.rcore;
    model.setValue(model.getValue().replace('default BookCondition.GOOD;', 'default BookCondition.WORN;'));
  });
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  const current=await page.evaluate(()=>window.workbench.inspect());
  expect(current.package.schema.classes.BookCopy.features.condition.default.literal.path).toEqual([5,1]);
  await page.evaluate(()=>{
    const model=window.workbench.definitionModels.rcore;
    model.setValue(model.getValue().replace('default BookCondition.WORN;', 'default BookCondition.MISSING;'));
  });
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Definition compilation failed');
  await expect(page.locator('#diagnostic-list')).toContainText('Unknown enum default literal');
  expect((await page.evaluate(()=>window.workbench.inspect())).revision).toBe(current.revision);
});

test('KerML Test editors follow the selected starter and retain edits across Define and Test', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.locator('#example').selectOption('rcore',{force:true});
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.getByRole('tab',{name:'types.demo',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'relations.demo',exact:true})).toBeVisible();
  await expect(page.locator('#model-file')).toHaveText('types.demo');
  await expect(page.locator('#model-tree .instance-name')).toContainText(['types.demo']);
  expect(await page.evaluate(()=>window.workbench.modelModels.catalog.getValue())).toContain('type A;');
  expect(await page.evaluate(()=>window.workbench.python.model.getValue())).not.toContain('BookCopy');
  const edited=await page.evaluate(()=>{
    const model=window.workbench.modelModels.catalog;
    model.setValue(model.getValue()+'\n// preserved test edit\n');
    return model.getValue();
  });
  await page.getByRole('tab',{name:'Define',exact:true}).click();
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  expect(await page.evaluate(()=>window.workbench.modelModels.catalog.getValue())).toBe(edited);
  const saved=await page.evaluate(()=>window.workbench.project.snapshot());
  await page.locator('#example').selectOption('library',{force:true});
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.getByRole('tab',{name:'catalog.library',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.workbench.python.model.getValue())).toContain('BookCopy');
  await page.evaluate(saved=>window.workbench.project.load(saved),saved);
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await expect(page.getByRole('tab',{name:'types.demo',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.workbench.modelModels.catalog.getValue())).toBe(edited);
});

test('Rcore file commands preserve exact authored source and project authority', async ({page}) => {
  const {readFile} = await import('node:fs/promises');
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect(page.locator('.structure-class[data-class="Library"]')).toBeVisible();
  const source = '// café structure\r\nrcore 1;package demo version "1";metamodel "urn:demo" prefix d {class Item {attr name:String [0,1] default "draft";}}\r\n';
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#open-rcore').click();
  await (await chooser).setFiles({name:'demo.rcore',mimeType:'text/plain',buffer:Buffer.from(source)});
  await expect(page.locator('#project-status')).toContainText('Rcore opened');
  await expect(page.locator('.structure-class[data-class="Item"]')).toBeVisible();
  const saved = await page.evaluate(()=>window.workbench.project.snapshot());
  expect(saved.definitions.rcore).toBe(source); expect(saved.structureSource).toBe('rcore');
  const download = page.waitForEvent('download');
  await page.locator('.ide-file-menu > summary').click(); await page.locator('#save-rcore').click();
  expect((await readFile(await (await download).path())).toString('utf8')).toBe(source);
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  expect((await page.evaluate(()=>window.workbench.inspect())).package.schema.classes.Item.features.name.default).toBe('draft');
});

test('legacy Ecore projects reject without changing the active project', async ({page}) => {
  const {readFile} = await import('node:fs/promises');
  const source = await readFile(new URL('../.runtime/intersect-text/fixtures/library/library.ecore',import.meta.url),'utf8');
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  const current = await page.evaluate(()=>window.workbench.project.snapshot());
  const active = await page.evaluate(()=>window.workbench.inspect());
  const saved = structuredClone(current);
  saved.structureSource = 'ecore'; saved.definitions.rcore = ''; saved.definitions.ecore = source;
  await expect(page.evaluate(value=>window.workbench.project.load(value),saved)).rejects.toThrow('Unsupported structure source');
  expect(await page.evaluate(()=>window.workbench.project.snapshot())).toEqual(current);
  expect(await page.evaluate(()=>window.workbench.inspect())).toEqual(active);
  await expect(page.locator('[data-definition="ecore"]')).toHaveCount(0);
});


test('combined Rcore behavior edits execute and survive exact file/project round trips', async ({page}) => {
  await page.goto('/?example=rcore');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect(page.locator('[data-definition="rcore_behavior"]')).toBeHidden();
  const original = await page.evaluate(()=>window.workbench.definitionModels.rcore.getValue());
  expect(original).toContain('behavior {');
  expect(original).toContain('fn directGenerals');
  await page.evaluate(()=>{
    const m=window.workbench.definitionModels.rcore;
    m.setValue(m.getValue().replace('closure([node], |t| directGenerals(t))','OrderedSet([node])'));
  });
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const saved = await page.evaluate(()=>window.workbench.project.snapshot());
  expect(saved.definitions.rcore_behavior).toBe('');
  await page.evaluate(value=>window.workbench.project.load(value),saved);
  await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  await page.locator('#dock-tab-rcore').click();
  await page.locator('#rcore-run').click();
  await expect(page.locator('#rcore-result')).toHaveText('A');
  expect((await page.evaluate(()=>window.workbench.project.snapshot())).definitions.rcore).toBe(saved.definitions.rcore);
});
