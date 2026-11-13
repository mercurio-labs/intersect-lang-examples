import {test,expect} from '@playwright/test';
test.setTimeout(90000);
async function open(page){await page.goto('/library-text.html');await expect(page.getByRole('status')).toHaveText('Model and source agree.',{timeout:60000});}
async function select(page,name){await page.locator('#object').selectOption({label:name});}
async function settled(page){await expect(page.getByRole('status')).toHaveText('Changes applied to model and source.');await expect(page.getByRole('button',{name:'Rename',exact:true})).toBeEnabled();}
test('Library model edits preserve source, references and history through actual WASM',async({page})=>{
 await open(page);const catalog=page.getByLabel('catalog.library source');const loans=page.getByLabel('loans.library source');
 const before=await catalog.inputValue();
 await select(page,'earthsea');await page.getByLabel('Title',{exact:true}).fill('Earthsea illustrated');await page.getByRole('button',{name:'Save title'}).click();await settled(page);
 expect(await catalog.inputValue()).toBe(before.replace('"A Wizard of Earthsea"','"Earthsea illustrated"'));
 await page.getByRole('button',{name:'Add Loan',exact:true}).click();await settled(page);
 expect(await loans.inputValue()).toContain('loan second copy earthsea to ada;');
 await select(page,'earthsea');await page.getByLabel('Name',{exact:true}).fill('archipelago');await page.getByRole('button',{name:'Rename',exact:true}).click();await settled(page);
 expect(await loans.inputValue()).toContain('copy archipelago to ada;');
 await select(page,'second');await page.getByRole('combobox',{name:'Loan member',exact:true}).selectOption({label:'grace'});await page.getByRole('button',{name:'Change member'}).click();await settled(page);
 expect(await loans.inputValue()).toContain('copy archipelago to grace;');
 await page.getByRole('button',{name:'Move up'}).click();await settled(page);
 const moved=await loans.inputValue();expect(moved.indexOf('loan second')).toBeLessThan(moved.indexOf('loan first'));
 await select(page,'first');await page.getByRole('button',{name:'Delete object'}).click();await settled(page);
 expect(await loans.inputValue()).not.toContain('loan first');expect(await loans.inputValue()).toContain('/* loan note */');expect(await loans.inputValue()).toContain('// keep comment');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await settled(page);expect(await loans.inputValue()).toBe(moved);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await settled(page);expect(await loans.inputValue()).not.toContain('loan first');
 await page.screenshot({path:test.info().outputPath('library-text.png'),fullPage:true});
});
test('invalid source stays visible and cannot publish an old model proposal',async({page})=>{
 await open(page);const source=page.getByLabel('catalog.library source');const old=await source.inputValue();
 const token=await page.evaluate(async()=>{const s=window.libraryText.state;const book=s.evaluation.model.elements.find(e=>e.values.name==='dune');return(await window.libraryText.request({method:'library/prepare',action:{kind:'set',id:book.id,feature:'title',value:'Stale'}})).token;});
 await source.fill('invalid newer source');await page.getByRole('button',{name:'Apply text'}).click();
 await expect(page.getByRole('alert')).toBeVisible();expect(await source.inputValue()).toBe('invalid newer source');
 const result=await page.evaluate(async token=>{try{await window.libraryText.request({method:'library/commit',token});return'published';}catch(error){return error.message;}},token);
 expect(result).toContain('Stale');expect(await source.inputValue()).toBe('invalid newer source');
 await page.getByRole('button',{name:'Discard text edits'}).click();await expect(page.getByRole('status')).toHaveText('Model and source agree.');expect(await source.inputValue()).toBe(old);
});
test('typing while a model commit is pending keeps the newer editor text',async({page})=>{
 await page.addInitScript(()=>{const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(data,...args){if(window.holdLibraryCommit&&data.request?.method==='library/commit'){window.releaseLibraryCommit=()=>send.call(this,data,...args);return;}return send.call(this,data,...args);};});
 await open(page);await select(page,'earthsea');await page.evaluate(()=>{window.holdLibraryCommit=true;});
 await page.getByLabel('Title',{exact:true}).fill('Pending');await page.getByRole('button',{name:'Save title'}).click();
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseLibraryCommit)).toBe('function');
 const editor=page.getByLabel('catalog.library source');const newer=(await editor.inputValue())+'// newer\n';await editor.fill(newer);
 await page.evaluate(()=>window.libraryText.request({method:'library/inspect'}));
 await page.evaluate(()=>window.releaseLibraryCommit());await expect(page.getByRole('button',{name:'Apply text'})).toBeEnabled();
 expect(await editor.inputValue()).toBe(newer);
 const state=await page.evaluate(()=>window.libraryText.request({method:'library/inspect'}));
 expect(state.sources[0].text).not.toContain('Pending');expect(state.dirty).toBe(true);
});

test('accepted authored text refreshes the model and supports another preserving edit',async({page})=>{
 await open(page);const source=page.getByLabel('catalog.library source');
 const authored=(await source.inputValue()).replace('"Dune"','"Authored Dune"')+'// user addition\n';
 await source.fill(authored);await page.getByRole('button',{name:'Apply text'}).click();
 await expect(page.getByRole('status')).toHaveText('Model and source agree.');
 await select(page,'dune');await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Authored Dune');
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
 await page.getByLabel('Title',{exact:true}).fill('Dune revised');await page.getByRole('button',{name:'Save title'}).click();await settled(page);
 expect(await source.inputValue()).toBe(authored.replace('"Authored Dune"','"Dune revised"'));
});
