import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
test('gallery pairs each code walkthrough with its runnable tool',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.example-card')).toHaveCount(4);
  for(const slug of ['petri','catalog','library','stopwatch']){
    await page.goto(`/examples/${slug}/`);
    await expect(page.locator('.example-intro a[href*="_lifecycle.rs"]')).toHaveAttribute('href',new RegExp(`${slug}_lifecycle.rs$`));
    await expect(page.getByRole('link',{name:'Try the solution'})).toBeVisible();
    await expect(page.locator('#metamodel-code')).toContainText('rcore 1;');
    await expect(page.locator('#parser-code')).toContainText('grammar ');
    await expect(page.locator('#solution iframe')).toHaveAttribute('src',/\.html$/);
    const manifest=await (await page.request.get(`/examples/${slug}/source-manifest.json`)).json();
    for(const id of ['metamodel-code','parser-code']){
      const code=page.locator(`#${id}`), filename=await code.getAttribute('data-source');
      const response=await page.request.get(`/examples/${slug}/sources/${filename}`);
      const bytes=await response.body();
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.find(s=>s.filename===filename).sha256);
      expect(await code.textContent()).toBe(bytes.toString('utf8').replace(/\r\n/g,'\n'));
    }
  }
});

test('Library solution runs inside its definition page',async({page})=>{
  await page.goto('/examples/library/');
  await page.locator('#solution').scrollIntoViewIfNeeded();
  const solution=page.frameLocator('iframe');
  await expect(solution.locator('#status')).toHaveText('Model and source agree.',{timeout:30000});
  await solution.locator('#object').selectOption({label:'earthsea'});
  await solution.locator('#title').fill('Gallery edition');
  await solution.getByRole('button',{name:'Save title'}).click();
  await expect(solution.getByLabel('catalog.library source')).toHaveValue(/Gallery edition/);
});
test('Stopwatch commands use the Rcore state machine and Run timing',async({page})=>{
  await page.goto('/stopwatch.html');
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
  await page.goto('/petri.html');
  await expect(page.locator('#run')).toBeEnabled({timeout:30000});
  await page.locator('#run').click();
  await expect(page.locator('#summary')).toContainText('cups: 2');
  await page.goto('/catalog.html');
  await expect(page.locator('#status')).toContainText('9 resolved',{timeout:30000});
  await page.locator('#objects button').first().click();
  await expect(page.locator('#objects .selected')).toHaveCount(1);
});
test('assembled Toolkit keeps model edits and source synchronized under its subpath',async({page})=>{
  await page.goto('/toolkit/library-text.html');
  await expect(page.locator('#status')).toHaveText('Model and source agree.',{timeout:30000});
  await page.locator('#object').selectOption({label:'earthsea'});
  await page.locator('#title').fill('An edited title');
  await page.getByRole('button',{name:'Save title'}).click();
  await expect(page.locator('#status')).toHaveText('Changes applied to model and source.');
  await expect(page.getByLabel('catalog.library source')).toHaveValue(/An edited title/);
  await page.locator('#undo').click();
  await expect(page.getByLabel('catalog.library source')).not.toHaveValue(/An edited title/);
});
