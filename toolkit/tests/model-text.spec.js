import {test,expect} from '@playwright/test';
test.setTimeout(90000);
async function open(page){await page.goto('/model-text.html');await expect(page.getByRole('status')).toHaveText('Model and source agree.',{timeout:60000});}
async function save(page,object,feature,value){await page.getByRole('combobox',{name:'Selected object',exact:true}).selectOption({label:object});await page.getByRole('combobox',{name:'Feature',exact:true}).selectOption(feature);await page.getByLabel('Value (JSON)').fill(JSON.stringify(value));await page.getByRole('button',{name:'Save feature',exact:true}).click();await expect(page.getByRole('button',{name:'Save feature',exact:true})).toBeEnabled();await expect(page.getByRole('alert')).toBeHidden();}

test('generic state-machine language renames references and publishes a nested model transaction',async({page})=>{
 await open(page);const source=page.getByLabel('example.test source');const original=await source.inputValue();
 await save(page,'State start','name','begin');expect(await page.evaluate(()=>window.modelText.state.sources[0].text.includes('\r\n'))).toBe(true);expect(await source.inputValue()).toBe(original.replaceAll('start','begin'));
 const root=await page.evaluate(()=>window.modelText.state.evaluation.model.elements.find(e=>e.class==='Machine').id);
 await page.getByText('Batch model transaction',{exact:true}).click();
 await page.getByLabel('Transaction (JSON)').fill(JSON.stringify({creates:[{id:'region',class:'Region',resource:'example.test'},{id:'nested',class:'State',resource:'example.test'}],changes:[['region','name','R'],['nested','name','nested'],['region','states',['nested']],[root,'regions',['region']]]}));
 await page.getByRole('button',{name:'Apply transaction',exact:true}).click();await expect(page.getByRole('button',{name:'Save feature',exact:true})).toBeEnabled();await expect(page.getByRole('alert')).toBeHidden();
 expect(await source.inputValue()).toContain('region R');expect(await source.inputValue()).toContain('// retained');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect.poll(()=>source.inputValue()).toBe(original.replaceAll('start','begin'));
});
test('recursive expression actions preserve surrounding syntax and generate verified canonical output',async({page})=>{
 await open(page);await page.getByRole('combobox',{name:'Example',exact:true}).selectOption('expressions');await expect(page.getByRole('status')).toHaveText('Model and source agree.');
 await save(page,'Number 2','value',20);
 expect(await page.getByLabel('example.test source').inputValue()).toBe('calc 01 /* left */ + (20 + 3) // final\n');
 await page.getByRole('button',{name:'Generate verified text'}).click();await expect(page.locator('#generated')).toContainText('20');await expect(page.getByRole('alert')).toBeHidden();
});
test('datatype edits preserve local hidden scopes and unassigned authored tokens',async({page})=>{
 await open(page);await page.getByRole('combobox',{name:'Example',exact:true}).selectOption('records');await expect(page.getByRole('status')).toHaveText('Model and source agree.');
 await save(page,'Document Sample','path','Gamma::Delta');
 expect(await page.getByLabel('example.test source').inputValue()).toBe('doc [Sample:x]!!! path Gamma::Delta slow 2147483647');
 await page.screenshot({path:test.info().outputPath('records-preservation.png'),fullPage:true});
});

test('installed native converter handles editing generation and exact history through WASM',async({page})=>{
 await open(page);await page.getByRole('combobox',{name:'Example',exact:true}).selectOption('paint');await expect(page.getByRole('status')).toHaveText('Model and source agree.');
 const original=await page.getByLabel('example.test source').inputValue();
 const value=await page.evaluate(()=>{const v=structuredClone(window.modelText.state.evaluation.model.elements[0].values.color);v.value={red:171,green:205,blue:239};return v;});
 await save(page,'Paint P','color',value);expect(await page.getByLabel('example.test source').inputValue()).toBe(original.replace('#123abc','#ABCDEF'));
 await page.getByRole('button',{name:'Generate verified text'}).click();await expect(page.locator('#generated')).toContainText('#ABCDEF');await expect(page.getByRole('alert')).toBeHidden();
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>page.getByLabel('example.test source').inputValue()).toBe(original);
 expect(await page.evaluate(()=>window.modelText.state.sources[0].text.endsWith('\r\n'))).toBe(true);
});

test('generic resource creation deletion and history retain authored source exactly',async({page})=>{
 await open(page);const original=await page.getByLabel('example.test source').inputValue();
 await page.getByText('Batch model transaction',{exact:true}).click();
 await page.getByLabel('Transaction (JSON)').fill(JSON.stringify({creates:[{id:'root-new',class:'Machine',resource:'new.test'}],changes:[['root-new','name','New']]}));
 await page.getByRole('button',{name:'Apply transaction',exact:true}).click();await expect(page.getByLabel('new.test source')).toBeVisible();await expect(page.getByRole('alert')).toBeHidden();
 expect(await page.getByLabel('example.test source').inputValue()).toBe(original);
 await page.getByLabel('Transaction (JSON)').fill(JSON.stringify({deletes:['root-new'],remove_resources:['new.test']}));
 await page.getByRole('button',{name:'Apply transaction',exact:true}).click();await expect(page.getByLabel('new.test source')).toHaveCount(0);await expect(page.getByRole('alert')).toBeHidden();
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByLabel('new.test source')).toBeVisible();
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByLabel('new.test source')).toHaveCount(0);expect(await page.getByLabel('example.test source').inputValue()).toBe(original);
});

async function compileCustom(page,structure,grammar,text){
 await page.getByText('Language definitions',{exact:true}).click();
 await page.getByLabel('Rcore',{exact:true}).fill(structure);
 await page.getByLabel('Xtext grammar',{exact:true}).fill(grammar);
 await page.getByLabel('example.test source').fill(text);
 await page.getByRole('button',{name:'Compile language and load text',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('Model and source agree.');
 await expect(page.getByRole('alert')).toBeHidden();
}
async function transaction(page,action){
 const form=page.getByLabel('Transaction (JSON)');
 if(!await form.isVisible())await page.getByText('Batch model transaction',{exact:true}).click();
 await form.fill(JSON.stringify(action));await page.getByRole('button',{name:'Apply transaction',exact:true}).click();
 await expect(page.getByRole('button',{name:'Apply transaction',exact:true})).toBeEnabled();
 await expect(page.getByRole('alert')).toBeHidden();
}

test('runtime-only state survives preserving edits generation and history in shared WASM',async({page})=>{
 await open(page);const original='root Main; // authored cache source\n';
 await compileCustom(page,`rcore 1; package caches version "1"; metamodel "urn:general-text" prefix c {
  class Root { attr name: String [1,1]; attr cache: Int32 [0,1] transient unsettable; ref cached: Cache [0,*] containment transient; }
  class Cache { attr name: String [1,1]; }
 }`,`grammar independent.Caches with org.eclipse.xtext.common.Terminals
 import "urn:general-text" as c
 Root returns c::Root: 'root' name=ID ';';`,original);
 const root=await page.evaluate(()=>window.modelText.state.evaluation.model.elements[0].id);
 await transaction(page,{creates:[{id:'runtime',class:'Cache',resource:'example.test'}],changes:[['runtime','name','cached runtime'],[root,'cache',7],[root,'cached',['runtime']]]});
 expect(await page.getByLabel('example.test source').inputValue()).toBe(original);
 await save(page,'Root Main','name','Renamed');
 expect(await page.getByLabel('example.test source').inputValue()).toBe(original.replace('Main','Renamed'));
 expect(await page.evaluate(()=>window.modelText.state.evaluation.model.elements.find(e=>e.id==='runtime').values.name)).toBe('cached runtime');
 await page.getByRole('button',{name:'Generate verified text',exact:true}).click();await expect(page.locator('#generated')).toContainText('Renamed');
 expect(await page.locator('#generated').textContent()).not.toContain('cached runtime');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>page.getByLabel('example.test source').inputValue()).toBe(original);
 expect(await page.evaluate(()=>window.modelText.state.evaluation.model.elements.some(e=>e.id==='runtime'))).toBe(true);
});

test('moving into a significant-whitespace context retains displaced comments through WASM',async({page})=>{
 await open(page);const original='loose\n [ /* keep comment */ one ] ; // inline\n tight';
 await compileCustom(page,`rcore 1; package hiddenMove version "1"; metamodel "urn:general-text" prefix h {
 class Root { ref loose: Item [0,*] containment; ref tight: Item [0,*] containment; } class Item { attr name: String [1,1]; }
 }`,`grammar independent.HiddenMove with org.eclipse.xtext.common.Terminals
 import "urn:general-text" as h
 Root returns h::Root: {h::Root} 'loose' loose+=Loose* 'tight' tight+=Tight*;
 Loose returns h::Item: Item;
 Tight returns h::Item hidden(): Item;
 Item returns h::Item: '[' name=ID ']' ';';`,original);
 const {root,item}=await page.evaluate(()=>{const e=window.modelText.state.evaluation.model.elements;return{root:e.find(e=>e.class==='Root').id,item:e.find(e=>e.class==='Item').id};});
 await transaction(page,{changes:[[root,'loose',[]],[root,'tight',[item]]]});
 const changed=await page.getByLabel('example.test source').inputValue();
 expect(changed).toContain('[one];');expect(changed.match(/keep comment/g)).toHaveLength(1);expect(changed.match(/inline/g)).toHaveLength(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>page.getByLabel('example.test source').inputValue()).toBe(original);
});

test('empty object entries retain files and support root creation deletion and history',async({page})=>{
 await open(page);const original='// retained header\nheader v2 /* empty */\n';
 await compileCustom(page,`rcore 1; package empty version "1"; metamodel "urn:general-text" prefix e { class Root { attr name: String [1,1]; } }`,
 `grammar independent.Empty with org.eclipse.xtext.common.Terminals
 import "urn:general-text" as e
 import "http://www.eclipse.org/emf/2002/Ecore" as ecore
 Root returns e::Root: 'header' Stamp (name=ID ';')?;
 Stamp returns ecore::EString: 'v1' | 'v2';`,original);
 await expect(page.getByRole('button',{name:'Save feature',exact:true})).toBeDisabled();
 await expect(page.locator('#values')).toHaveText('No entry object.');
 await page.getByRole('button',{name:'Generate verified text',exact:true}).click();await expect(page.locator('#generated')).toContainText('header');
 await transaction(page,{creates:[{id:'new',class:'Root',resource:'example.test'}],changes:[['new','name','created']]});
 expect(await page.getByLabel('example.test source').inputValue()).toContain('header v2');
 await transaction(page,{deletes:['new']});
 await expect(page.getByRole('button',{name:'Save feature',exact:true})).toBeDisabled();
 expect(await page.getByLabel('example.test source').inputValue()).toContain('header v2');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByRole('button',{name:'Save feature',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>page.getByLabel('example.test source').inputValue()).toBe(original);
});

test('unordered language preserves authored order comments stable handles and undo through WASM',async({page})=>{
 await open(page);await page.getByRole('combobox',{name:'Example',exact:true}).selectOption('modifiers');
 await expect(page.getByRole('status')).toHaveText('Model and source agree.');
 const original=await page.getByLabel('example.test source').inputValue();
 expect(await page.evaluate(()=>window.modelText.state.sources[0].text.endsWith('\r\n'))).toBe(true);
 const root=await page.evaluate(()=>window.modelText.state.evaluation.model.elements[0].id);
 await save(page,`Modifier ${root}`,'visibility','public');
 expect(await page.getByLabel('example.test source').inputValue()).toBe(original.replace('private','public'));
 await transaction(page,{changes:[[root,'static',false]]});
 expect(await page.getByLabel('example.test source').inputValue()).toContain('/* retain */');
 expect(await page.evaluate(()=>window.modelText.state.evaluation.model.elements[0].id)).toBe(root);
 await page.getByRole('button',{name:'Generate verified text',exact:true}).click();await expect(page.locator('#generated')).toContainText('public');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect.poll(()=>page.getByLabel('example.test source').inputValue()).toBe(original.replace('private','public'));
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect.poll(()=>page.getByLabel('example.test source').inputValue()).toBe(original);
});
test('builtin ELong parser returns share lossless scalar values in the browser',async({page})=>{
 await open(page);
 await compileCustom(page,`rcore 1; package longs version "1"; metamodel "urn:general-text" prefix l { class Root { attr value: ELong [1,1]; } }`,
 `grammar independent.Longs hidden()
 import "urn:general-text" as l
 import "http://www.eclipse.org/emf/2002/Ecore" as ecore
 Root returns l::Root: value=Long;
 Long returns ecore::ELong: RAW;
 terminal RAW: .+;`,'9223372036854775807');
 const value=await page.evaluate(()=>window.modelText.state.evaluation.model.elements[0].values.value);
 await page.getByRole('button',{name:'Generate verified text',exact:true}).click();await expect(page.locator('#generated')).toContainText('9223372036854775807');
 expect(JSON.stringify(value)).toContain('9223372036854775807');
});
