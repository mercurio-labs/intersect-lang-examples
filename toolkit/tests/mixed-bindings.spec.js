import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const structure = await readFile(new URL('../.runtime/intersect-text/fixtures/rcore/bindings/model.rcore', import.meta.url), 'utf8');
const behavior = await readFile(new URL('../.runtime/intersect-text/fixtures/rcore/bindings/behavior.rcore', import.meta.url), 'utf8');
const implementation = await readFile(new URL('../.runtime/intersect-text/fixtures/rcore/bindings/behavior.rhai', import.meta.url), 'utf8');
const edited = implementation.replace('read_int(arg0, "value") * 2','read_int(arg0, "value") * 3');
async function edit(page, label, text) {
  await page.getByRole('textbox',{name:label,exact:true}).focus();
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(text);
}
async function menu(page,id){await page.locator('.ide-file-menu > summary').click();await page.locator(id).click();}
async function compile(page){await page.locator('#compile').click();await expect(page.locator('#rhai-status')).toContainText('Compiled.',{timeout:30000});await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:30000});}
async function showRhai(page){await page.getByRole('tab',{name:'Define',exact:true}).click();await page.locator('[data-ecore-view="rhai"]').click();}
async function meter(page){
  await page.getByRole('tab',{name:'Test',exact:true}).click();
  if(await page.locator('#python-enable').isEnabled()) await page.locator('#python-enable').click();
  else await page.locator('#python-bind').click();
  await expect(page.locator('#python-status')).toContainText('Python ready',{timeout:30000});
  await page.locator('#python-run').click();await expect(page.locator('#python-run')).toBeEnabled({timeout:30000});
  await expect(page.locator('#python-error')).toHaveText('');
  const id=(await page.locator('#python-output').textContent()).match(/METER_ID=([^\r\n]+)/)?.[1];expect(id).toBeTruthy();await showRhai(page);return id;
}
async function invoke(page,label,args,value,backend){
  await page.locator('#rhai-function').selectOption({label});await page.locator('#rhai-arguments').fill(JSON.stringify(args));await page.locator('#rhai-run').click();
  await expect(page.locator('#rhai-status')).toContainText('Completed with '+backend,{timeout:30000});
  expect(JSON.parse(await page.locator('#rhai-result').textContent()).data.Scalar.payload.value).toBe(value);
  const identity=await page.getByLabel('Result implementation',{exact:true}).textContent();
  expect(identity).toContain('Implementation: '+backend+' · ');return identity;
}
async function open(page){await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:30000});await menu(page,'#new-rust-rhai-example');await expect(page.locator('#rhai-example')).toBeVisible();await compile(page);}
async function setBehavior(page,text){await menu(page,'#open-behavior-source');await edit(page,'Definition source',text);}

test('mixed example invokes shipped Rust and editable Rhai, retains exact last-good package on rejected declarations',async({page})=>{
  test.setTimeout(180000);await open(page);let id=await meter(page);
  const rust=await invoke(page,'twice',['21'],'42','rust');expect(rust).toContain('bindings-example-rust-v1');
  const rhai=await invoke(page,'doubled',[id],'42','rhai');expect(rhai).toContain('rhai-1.26.1/bindings-v2:');
  await edit(page,'Rhai source',edited);await compile(page);id=await meter(page);
  expect(await invoke(page,'twice',['21'],'42','rust')).toBe(rust);
  const replaced=await invoke(page,'doubled',[id],'63','rhai');expect(replaced).not.toBe(rhai);
  await page.screenshot({path:test.info().outputPath('mixed-rhai-result.png'),fullPage:true});
  for(const invalid of [behavior.replace('value + value','value + 1'),behavior+'\nfn additional(value:Int64)->Int64 { value }\n']){
    await setBehavior(page,invalid);await page.locator('#compile').click();await expect(page.locator('#compile-status')).toContainText('Compilation stopped',{timeout:30000});
    await expect(page.locator('#rhai-status')).toContainText('Rust example requires the exact compiled fixture contract');
    await showRhai(page);expect(await invoke(page,'twice',['21'],'42','rust')).toBe(rust);expect(await invoke(page,'doubled',[id],'63','rhai')).toBe(replaced);
  }
  await setBehavior(page,behavior);await showRhai(page);await edit(page,'Rhai source','fn binding_2(arg0) {');await page.locator('#compile').click();
  await expect(page.locator('#compile-status')).toContainText('Compilation stopped',{timeout:30000});await showRhai(page);
  expect(await invoke(page,'twice',['21'],'42','rust')).toBe(rust);expect(await invoke(page,'doubled',[id],'63','rhai')).toBe(replaced);
});

test('mixed example project reopens source recipes on a fresh page and rebuilds both identities',async({page})=>{
  test.setTimeout(180000);await open(page);await edit(page,'Rhai source',edited);await compile(page);let id=await meter(page);
  const rust=await invoke(page,'twice',['21'],'42','rust'),rhai=await invoke(page,'doubled',[id],'63','rhai');
  // Capture the exact editor draft independently; typed multi-line insertion may apply Monaco indentation.
  const sourceDownload=page.waitForEvent('download');await page.locator('#save-rhai').click();
  const authored=await readFile(await(await sourceDownload).path(),'utf8');
  expect(rhai.endsWith('#'+createHash('sha256').update(authored).digest('hex'))).toBe(true);
  await page.locator('.ide-file-menu > summary').click();const download=page.waitForEvent('download');await page.locator('#save-project').click();
  const path=await(await download).path(),saved=JSON.parse(await readFile(path,'utf8'));
  expect(saved.bindings.version).toBe(3);expect(saved.bindings.preset).toBe('shipped-rust-rhai-v1');
  expect(saved.bindings.source).toBe(authored);
  expect(saved.definitions.rcore.replaceAll('\r\n','\n')).toBe(structure.replaceAll('\r\n','\n'));expect(saved.definitions.rcore_behavior.replaceAll('\r\n','\n')).toBe(behavior.replaceAll('\r\n','\n'));
  expect(Object.keys(saved.bindings).sort()).toEqual(['arguments','present','preset','source','version']);
  await page.reload();await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:30000});
  await page.locator('#project-file').setInputFiles(path);await expect(page.locator('#project-status')).toContainText('Project opened');await showRhai(page);
  await expect(page.locator('#rhai-implementation')).toBeEmpty();await page.locator('#rhai-run').click();await expect(page.locator('#rhai-status')).toContainText('Compile the project first');
  const standalone=page.waitForEvent('download');await page.locator('#save-rhai').click();expect(await readFile(await(await standalone).path(),'utf8')).toBe(saved.bindings.source);
  await compile(page);id=await meter(page);expect(await invoke(page,'twice',['21'],'42','rust')).toBe(rust);expect(await invoke(page,'doubled',[id],'63','rhai')).toBe(rhai);
  const forged=structuredClone(saved);forged.bindings.implementations=[{backend:'rust-generated',contract:'invented'}];
  await page.locator('#project-file').setInputFiles({name:'forged.intersect',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(forged))});
  await expect(page.locator('#project-status')).toContainText('Unsupported Rust/Rhai example selection');
  expect(await invoke(page,'twice',['21'],'42','rust')).toBe(rust);
});
