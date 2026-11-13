import { test, expect } from '@playwright/test';

test('alpha landing and both editors use only the served artifact', async ({ page, context, baseURL }) => {
  const external = [], errors = [];
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('One model. Editable text.');
  await page.screenshot({ path: test.info().outputPath('alpha-landing.png'), fullPage: true });
  for (const name of ['Open Library editor', 'Open model/text editor']) {
    await page.goto('/');
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Model and source agree.', { timeout: 60000 });
  }
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('retained authored sources reconstruct a Library model in a fresh browser context', async ({ page, browser, baseURL }) => {
  await page.goto('/library-text.html');
  await expect(page.getByRole('status')).toHaveText('Model and source agree.', { timeout: 60000 });
  const editor = page.getByLabel('catalog.library source');
  await editor.fill((await editor.inputValue()).replace('"Dune"', '"Retained Dune"') + '// retained source\n');
  await page.getByRole('button', { name: 'Apply text', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Model and source agree.');
  const retained = await page.evaluate(() => structuredClone(window.libraryText.state));
  const fresh = await browser.newContext({ baseURL });
  try {
    const reopened = await fresh.newPage();
    await reopened.goto('/library-text.html');
    await expect(reopened.getByRole('status')).toHaveText('Model and source agree.', { timeout: 60000 });
    const rebuilt = await reopened.evaluate(sources => window.libraryText.request({ method: 'library/load', sources }), retained.sources);
    expect(rebuilt.sources).toEqual(retained.sources);
    expect(rebuilt.evaluation.model).toEqual(retained.evaluation.model);
    expect(rebuilt.evaluation.derived).toEqual(retained.evaluation.derived);
    expect(rebuilt.undo).toBe(false);
  } finally { await fresh.close(); }
});
