import {test,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';

test('Mercurio themes and contextual language guides follow the selected source',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:30000});
  await expect(page.locator('.topbar > label:has(#example)')).toHaveCount(0);
  await expect(page.locator('#example')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'Switch color theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Switch color theme'}).click();
  await page.locator('#explorer-files-0').click();
  await expect(page.getByRole('treeitem',{name:/catalog.library/})).toBeVisible();
  await page.getByRole('treeitem',{name:/\.rcore/}).first().click();
  await expect(page.getByRole('complementary',{name:'Rcore language guide'})).toBeVisible();
  await page.getByRole('button',{name:'Collapse Rcore guide'}).click();
  await expect(page.locator('#rcore-guide')).toBeHidden();
  await page.getByRole('button',{name:'Rcore guide',exact:true}).click();
  await expect(page.locator('#rcore-guide')).toBeVisible();
  await page.getByRole('treeitem',{name:/\.xtext/}).click();
  await expect(page.locator('#xtext-guide')).toBeVisible();
  await expect(page.locator('#rcore-guide')).toBeHidden();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.ide-file-menu > summary')).toBeInViewport();
  await expect(page.locator('#theme')).toBeInViewport();
  await page.screenshot({path:'../target/toolkit-review/mobile.png'});
});

test('right-click creates a project file and downloads a complete native runner',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:30000});
  await page.locator('#explorer-files-0').click();
  await page.getByRole('treeitem',{name:/catalog.library/}).click();
  await expect(page.locator('#explorer-files-1')).toHaveAttribute('aria-selected','true');
  await page.locator('#test-containment .explorer-files').click({button:'right'});
  await page.getByRole('menuitem',{name:'New File…'}).click();
  const dialog=page.getByRole('dialog',{name:'New file'});
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name',{exact:true}).fill('extra.library');
  await dialog.getByRole('button',{name:'Create file'}).click();
  await expect(page.locator('#test-containment').getByRole('treeitem',{name:/extra.library/})).toBeVisible();
  await page.evaluate(()=>window.workbench.windows.documents.find(doc=>doc.name==='extra.library').model.setValue('library Extra { }'));
  await expect(page.locator('#model-tree')).toContainText('Extra');
  await expect(page.locator('.window-content .monaco-editor:visible').first()).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.locator('.ide-file-menu > summary').click();
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download ready-to-run ZIP'}).click();
  const download=await downloading;
  const bytes=await readFile(await download.path());
  const files=unzipSync(bytes);
  expect(strFromU8(files['model.pack'].slice(0,8))).toBe('IXLPACK\0');
  expect(strFromU8(files['Cargo.toml'])).toContain('intersect-model = "=0.1.0-alpha.1"');
  expect(strFromU8(files['Cargo.lock'])).not.toContain('git+');
  expect(files['src/main.rs']).toBeDefined();
  expect(files['src/lib.rs']).toBeDefined();
  expect(files['language/definitions/bundle.json']).toBeDefined();
  expect(JSON.parse(strFromU8(files['sources.json'])).some(source=>source.uri.endsWith('extra.library'))).toBe(true);
  const output='../target/runner-export';await mkdir(output,{recursive:true});
  await writeFile(`${output}/download.zip`,bytes);
  for(const [path,content] of Object.entries(files)){
    await mkdir(`${output}/extracted/${path.split('/').slice(0,-1).join('/')}`,{recursive:true});
    await writeFile(`${output}/extracted/${path}`,content);
  }
  await page.screenshot({path:'test-results/mercurio-toolkit-desktop.png'});
});

test('runnable download refuses invalid models and uncompiled definition edits',async({page})=>{
  await page.goto('/');await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:30000});
  await page.evaluate(()=>window.workbench.modelModels.catalog.setValue('not a valid model'));
  await expect(page.locator('#export')).toBeDisabled();
  await page.locator('.ide-file-menu > summary').click();await page.locator('#export-runner').click();
  await expect(page.locator('#project-status')).toContainText('fix model diagnostics');
  await page.evaluate(()=>window.workbench.definitionModels.rcore.setValue(window.workbench.definitionModels.rcore.getValue()+'\n// changed'));
  await page.locator('.ide-file-menu > summary').click();await page.locator('#export-runner').click();
  await expect(page.locator('#project-status')).toContainText('Compile your definition edits');
});
