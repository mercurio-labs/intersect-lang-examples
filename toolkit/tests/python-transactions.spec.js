import { test, expect } from '@playwright/test';
test.setTimeout(90000);
async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'Transactions', exact: true }).click();
  await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
}
async function run(page, script) {
  await page.evaluate(script => window.workbench.python.model.setValue(script), script);
  await page.locator('#python-run').click();
}
const entries = page => page.evaluate(() => window.workbench.python.transactions.entries);

test('typed model factory exposes a read-only transaction and committed Member changes', async ({ page }) => {
  await ready(page);
  await run(page, `from intersect_api import model, Library, Member
start = model.transaction
library = model.find(Library, name="Catalog")
member = model.create(Member, name="grace")
library.members = (*library.members, member)
print("Status:", model.transaction.status)
print("Initial changes:", len(start.changes))
print("Staged changes:", len(model.transaction.changes))
print("Members:", len(model.all(Member)))
print("Validation:", model.validate())
`);
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  await expect(page.locator('#python-output')).toContainText('Status: running');
  await expect(page.locator('#python-output')).toContainText('Initial changes: 0');
  await expect(page.locator('#python-output')).toContainText('Staged changes: 2');
  await expect(page.locator('#python-output')).toContainText('Members: 2');
  const [entry] = await entries(page);
  expect(entry.report.status).toBe('committed');
  expect(entry.report.changes_complete).toBe(true);
  expect(entry.report.changes.find(c => c.kind === 'created').after.values.name).toBe('grace');
  expect(entry.report.changes.find(c => c.feature === 'members').before).toHaveLength(1);
  expect(entry.report.changes.find(c => c.feature === 'members').after).toHaveLength(2);
  await expect(page.locator('#transaction-detail')).toContainText('Committed changes');
  await page.locator('.transaction-change').first().locator('summary').click();
  await expect(page.locator('#transaction-detail')).toContainText('Before');
  await expect(page.locator('#transaction-detail')).toContainText('After');
  await page.evaluate(() => window.workbench.python.model.setValue('from intersect_api import model, Member\nmember = model.create(Member, name=42)\n'));
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.workbench.python.diagnostics))).toContain('reportArgumentType');
  await page.evaluate(() => window.workbench.python.model.setValue('from intersect_api import model\nmodel.transaction.status = "committed"\n'));
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.workbench.python.diagnostics))).toContain('reportAttributeAccessIssue');
  await page.locator('#python-run').click();
  await expect(page.locator('#python-error')).toContainText('read-only', { timeout: 60000 });
  expect((await entries(page))[0].report.status).toBe('rolled_back');
  expect((await entries(page))[1].report.status).toBe('committed');
});

test('loan audit includes derived changes; exceptions and validation show attempted changes', async ({ page }) => {
  await ready(page);
  await page.locator('#python-run').click();
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  let history = await entries(page);
  expect(history[0].report.derived_changes).toContainEqual(expect.objectContaining({ class: 'BookCopy', feature: 'available', before: true, after: false }));
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  await run(page, 'from intersect_api import model, Member\nmodel.create(Member, name="attempted")\nraise ValueError("abort this run")');
  await expect(page.locator('#python-error')).toContainText('abort this run', { timeout: 60000 });
  history = await entries(page);
  expect(history[0].report.status).toBe('rolled_back');
  expect(history[0].report.changes[0].after.values.name).toBe('attempted');
  await expect(page.locator('#transaction-detail')).toContainText('Attempted changes');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
  await run(page, 'from intersect_api import model, Loan, BookCopy, Member\nmodel.create(Loan, name="invalid", copy=model.find(BookCopy, name="dune"), member=model.find(Member, name="ada"))');
  await expect(page.locator('#python-error')).toContainText('Semantic validation', { timeout: 60000 });
  history = await entries(page);
  expect(history[0].report.status).toBe('rolled_back');
  expect(history[0].report.validation).toBe('failed');
  expect(history[0].report.diagnostics.length).toBeGreaterThan(0);
  await page.locator('.transaction-item').last().click();
  await expect(page.locator('#transaction-detail')).toContainText('Committed changes');
  await page.screenshot({ path: 'test-results/transactions-desktop.png', fullPage: true });
});

test('cancellation and publication conflicts retain audit without changing the model', async ({ page }) => {
  await ready(page);
  const before = (await page.evaluate(() => window.workbench.inspect())).evaluation.model;
  await run(page, 'from intersect_api import model, Member\nmodel.create(Member, name="cancelled")\nprint("staged")\nwhile True: pass');
  await expect(page.locator('#python-output')).toContainText('staged', { timeout: 60000 });
  await expect(page.locator('#transaction-list')).toContainText('running');
  await page.locator('#python-cancel').click();
  await expect(page.locator('#python-error')).toContainText('Cancelled');
  let history = await entries(page);
  expect(history[0].report.status).toBe('cancelled'); expect(history[0].report.changes_complete).toBe(false);
  expect(history[0].report.changes[0].after.values.name).toBe('cancelled');
  await expect(page.locator('#transaction-detail')).toContainText('Incomplete report');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before);
  await run(page, 'import time\nfrom intersect_api import model, Member\nmodel.create(Member, name="stale")\nprint("staged")\ntime.sleep(2)');
  await expect(page.locator('#python-output')).toContainText('staged', { timeout: 60000 });
  await page.evaluate(() => { const m = window.workbench.modelModels.catalog; m.setValue(m.getValue() + '\n'); });
  await expect(page.locator('#python-error')).toContainText('Stale transaction', { timeout: 15000 });
  history = await entries(page);
  expect(history[0].report.status).toBe('rolled_back');
  expect(history[0].report.reason).toContain('Stale transaction');
  await page.getByRole('tab', { name: 'Define', exact: true }).click();
  await page.locator('#compile').click();
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await expect(page.locator('#python-binding')).toContainText('STALE');
  expect((await entries(page))).toHaveLength(2);
  await page.locator('#transactions-clear').click();
  expect((await entries(page))).toHaveLength(0);
});
