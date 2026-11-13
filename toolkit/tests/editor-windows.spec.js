import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
});

async function create(page, type, name) {
  await page.getByRole('button', { name: 'New window' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Window type').selectOption(type);
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create window' }).click();
  await expect(dialog).toBeHidden();
  return page.getByRole('tabpanel', { name, exact: true });
}

test('model, Python and query windows retain independent state across tabs, splits and project reload', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const baseline = await page.evaluate(() => window.workbench.project.snapshot());
  await create(page, 'model', 'branch.library');
  await page.evaluate(() => window.workbench.windows.documents.find(d => d.name === 'branch.library').model.setValue('library Branch { member grace; }'));
  await expect(page.locator('#model-tree')).toContainText('grace');
  const script = await create(page, 'python', 'checks.py');
  await page.evaluate(() => window.workbench.windows.documents.find(d => d.name === 'checks.py').model.setValue('# independent script\nassert 2 + 2 == 4\n'));
  await expect(script.getByRole('button', { name: 'Enable Python' })).toBeVisible();
  const query = await create(page, 'query', 'available.query');
  await query.getByRole('button', { name: 'Available copies', exact: true }).click();
  await query.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(query.locator('.query-results')).toContainText('A Wizard of Earthsea');
  await page.getByRole('button', { name: 'Side-by-side' }).click();
  await expect(page.locator('.editor-group:visible')).toHaveCount(2);
  await page.getByRole('button', { name: 'Side-by-side' }).click();
  await expect(page.locator('.editor-group:visible')).toHaveCount(1);
  await page.getByRole('tab', { name: 'checks.py', exact: true }).click();
  await expect(script).toBeVisible();
  await page.getByRole('button', { name: 'Side-by-side' }).click();
  await expect(page.locator('.editor-group:visible')).toHaveCount(2);
  await page.getByRole('button', { name: 'Move to other group' }).click();
  await expect(script).toBeVisible();
  const saved = await page.evaluate(() => window.workbench.project.snapshot());
  await page.evaluate(value => window.workbench.project.load(value), baseline);
  await expect(page.locator('#model-tree')).not.toContainText('grace');
  await page.evaluate(value => window.workbench.project.load(value), saved);
  expect(await page.evaluate(() => window.workbench.project.snapshot())).toEqual(saved);
  // Opening a project restores drafts. Activate those exact definitions before
  // querying the recreated windows, as the project-open message instructs.
  const compiled = await page.evaluate(() => window.workbench.compile());
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await expect(page.locator('#model-tree')).toContainText('grace');
  await page.getByRole('tab', { name: 'available.query', exact: true }).click();
  await query.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(query.locator('.query-results')).toContainText('A Wizard of Earthsea');
  await expect(page.locator('#model-tree')).toContainText('grace');
  expect(errors).toEqual([]);
});

test('additional Python window executes its own script and retains API binding through split changes', async ({ page }) => {
  test.setTimeout(90000);
  const script = await create(page, 'python', 'checks.py');
  await page.evaluate(() => window.workbench.windows.documents.find(d => d.name === 'checks.py').model.setValue('from intersect_api import Library, model\nassert model.find(Library, name="Catalog") is not None\nprint("independent script passed")\n'));
  await script.getByRole('button', { name: 'Enable Python' }).click();
  await expect(script.getByRole('button', { name: 'Run script', exact: true })).toBeEnabled({ timeout: 30000 });
  await script.getByRole('button', { name: 'Run script', exact: true }).click();
  await expect(script.getByRole('status')).toContainText('Committed', { timeout: 60000 });
  await page.getByRole('tab', { name: 'Output', exact: true }).click();
  await expect(page.locator('#dock-output')).toContainText('independent script passed');
  await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await expect(page.locator('#python-enable')).toBeEnabled();
  await expect(page.locator('#dock-output')).not.toContainText('independent script passed');
  await page.getByRole('tab', { name: 'checks.py', exact: true }).click();
  await expect(page.locator('#dock-output')).toContainText('independent script passed');
  await expect(script.getByRole('button', { name: 'Run script', exact: true })).toBeEnabled();
});

test('new window validation, atomic import and narrow layout', async ({ page }) => {
  await page.getByRole('button', { name: 'New window' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('catalog.library');
  await dialog.getByRole('button', { name: 'Create window' }).click();
  await expect(dialog.getByRole('status')).toContainText('already exists');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const before = await page.evaluate(() => window.workbench.project.snapshot());
  const error = await page.evaluate(() => {
    const bad = window.workbench.project.snapshot(); bad.definitions.ecore = '<overwritten'; bad.windows.documents[0].source = 'mixed\r\nend\n';
    try { window.workbench.project.load(bad); } catch (error) { return error.message; }
  });
  expect(error).toContain('Mixed');
  expect(await page.evaluate(() => window.workbench.project.snapshot())).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page, 'query', 'mobile.query');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/windows-mobile.png' });
});
