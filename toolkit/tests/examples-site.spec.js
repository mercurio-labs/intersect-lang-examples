import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
const prefix=process.env.INTERSECT_SITE_BASE || (process.env.INTERSECT_SITE_URL ? new URL(process.env.INTERSECT_SITE_URL).pathname : '');
const site=path=>prefix.replace(/\/$/,'')+path;
test('gallery pairs each code walkthrough with its runnable tool',async({page})=>{
  await page.goto(site('/'));
  await expect(page.locator('.example-card')).toHaveCount(5);
  await expect(page.locator('.example-card').first()).toHaveAttribute('href','toolkit/');
  for(const slug of ['petri','catalog','library','stopwatch']){
    await page.goto(site(`/examples/${slug}/`));
    await expect(page.locator('.example-intro a[href*="_lifecycle.rs"]')).toHaveAttribute('href',new RegExp(`${slug}_lifecycle.rs$`));
    await expect(page.getByRole('link',{name:'Try the solution'})).toBeVisible();
    await expect(page.locator('#metamodel-code')).toContainText('rcore 1;');
    await expect(page.locator('#parser-code')).toContainText('grammar ');
    await expect(page.locator('#solution iframe')).toHaveAttribute('src',/\.html$/);
    const manifest=await (await page.request.get(site(`/examples/${slug}/source-manifest.json`))).json();
    for(const id of ['metamodel-code','parser-code']){
      const code=page.locator(`#${id}`), filename=await code.getAttribute('data-source');
      const response=await page.request.get(site(`/examples/${slug}/sources/${filename}`));
      const bytes=await response.body();
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.find(s=>s.filename===filename).sha256);
      expect(await code.textContent()).toBe(bytes.toString('utf8').replace(/\r\n/g,'\n'));
    }
  }
});

test('Library solution runs inside its definition page',async({page})=>{
  await page.goto(site('/examples/library/'));
  await page.locator('#solution').scrollIntoViewIfNeeded();
  const solution=page.frameLocator('iframe');
  await expect(solution.locator('#status')).toHaveText('Model and source agree.',{timeout:30000});
  await solution.locator('#object').selectOption({label:'earthsea'});
  await solution.locator('#title').fill('Gallery edition');
  await solution.getByRole('button',{name:'Save title'}).click();
  await expect(solution.getByLabel('catalog.library source')).toHaveValue(/Gallery edition/);
});
test('Stopwatch commands use the Rcore state machine and Run timing',async({page})=>{
  await page.goto(site('/stopwatch.html'));
  await expect(page.locator('#status')).toContainText('elapsed 2750 ms at simulation time 3250 ms',{timeout:30000});
  await expect(page.locator('#machine .active')).toHaveText('idle');
  await page.locator('#position').fill(await page.locator('#position').getAttribute('max'));
  await page.locator('#position').dispatchEvent('input');
  await expect(page.locator('#elapsed')).toHaveText('2750 ms');
  await expect(page.locator('#machine .active')).toHaveText('stopped');
  await expect(page.locator('#transitions')).toContainText('idle — start → running');
  await page.locator('#script').fill('stopwatch Test { start wait 125ms stop }');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toContainText('elapsed 125 ms at simulation time 125 ms');
});
test('assembled Petri and Catalog tools execute the actual WASM modules',async({page})=>{
  await page.goto(site('/petri.html'));
  await expect(page.locator('#run')).toBeEnabled({timeout:30000});
  await page.locator('#run').click();
  await expect(page.locator('#summary')).toContainText('cups: 2');
  await page.goto(site('/catalog.html'));
  await expect(page.locator('#status')).toContainText('9 resolved',{timeout:30000});
  await page.locator('#objects button').first().click();
  await expect(page.locator('#objects .selected')).toHaveCount(1);
});
test('assembled Toolkit keeps model edits and source synchronized under its subpath',async({page})=>{
  await page.goto(site('/toolkit/library-text.html'));
  await expect(page.locator('#status')).toHaveText('Model and source agree.',{timeout:30000});
  await page.locator('#object').selectOption({label:'earthsea'});
  await page.locator('#title').fill('An edited title');
  await page.getByRole('button',{name:'Save title'}).click();
  await expect(page.locator('#status')).toHaveText('Changes applied to model and source.');
  await expect(page.getByLabel('catalog.library source')).toHaveValue(/An edited title/);
  await page.locator('#undo').click();
  await expect(page.getByLabel('catalog.library source')).not.toHaveValue(/An edited title/);
});

test('full workbench loads Monaco and compiles its starter language at the deployed path',async({page})=>{
  const failed=[];
  page.on('response',response=>{const url=new URL(response.url());if(response.status()>=400 && !url.pathname.endsWith('/favicon.ico') && url.origin===new URL(page.url()).origin)failed.push(response.url());});
  await page.goto(site('/toolkit/'));
  await expect(page).toHaveTitle('Intersect Toolkit');
  await expect(page.locator('#compile-status')).toContainText('Language compiled',{timeout:60000});
  await expect(page.locator('.structure-class[data-class="Library"]')).toBeVisible();
  await page.getByRole('button',{name:'Rcore source',exact:true}).click();
  await expect(page.locator('#definition-editor .monaco-editor')).toBeVisible();
  await expect(page.locator('#rcore-guide')).toBeVisible();
  await expect(page.locator('#compile')).toBeVisible();
  await expect(page.locator('.topbar > label:has(#example)')).toHaveCount(0);
  await page.locator('.ide-file-menu > summary').click();
  const downloading=page.waitForEvent('download');
  await page.locator('#export-runner').click();
  const files=unzipSync(await readFile(await (await downloading).path()));
  expect(strFromU8(files['model.pack'].slice(0,8))).toBe('IXLPACK\0');
  expect(files['src/main.rs']).toBeDefined();
  expect(failed).toEqual([]);
});
