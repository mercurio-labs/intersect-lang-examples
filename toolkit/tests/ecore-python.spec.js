import { test, expect } from '@playwright/test';

test.setTimeout(120000);
const ecore = `<ecore:EPackage xmlns:ecore="http://www.eclipse.org/emf/2002/Ecore" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="books" nsURI="urn:books" nsPrefix="books">
<eClassifiers xsi:type="ecore:EClass" name="Book"><eStructuralFeatures xsi:type="ecore:EAttribute" name="title" lowerBound="1" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/></eClassifiers>
</ecore:EPackage>`;
const fixture = `from intersect_api import Book, model
assert len(Book.all()) == 0
book = Book(title="Earthsea")
assert book.title == "Earthsea"
assert model.validate() == []
print("fixture passed")`;
async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  const compiled = await page.evaluate(async ecore => {
    const w = window.workbench;
    w.setDefinitionMode('structure');
    // This API fixture supplies its complete definition set. The Rcore starter
    // now has inline behavior, which must not leak into this unrelated schema.
    const migration = await w.request('intersect/migrateEcore', {uri:'memory:books.ecore',text:ecore,target_uri:'memory:books.rcore'});
    if (!migration.ok) throw new Error(JSON.stringify(migration));
    w.definitionModels.rcore.setValue(migration.report.converted.text);
    w.definitionModels.xtext.setValue('deliberately not a grammar');
    w.definitionModels.rcore_behavior.setValue('');
    return w.compile();
  }, ecore);
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
  expect((await page.evaluate(() => window.workbench.inspect())).package.grammar).toBeNull();
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
}
async function script(page, text) {
  await page.evaluate(text => window.workbench.python.model.setValue(text), text);
}
async function sourceTexts(page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(window.workbench.modelModels).map(([key, model]) => [key, model.getValue()])));
}

test('Ecore-only disposable fixtures repeat without changing model, generation or source text', async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => window.workbench.inspect());
  const text = await sourceTexts(page);
  await script(page, fixture);
  for (let i = 0; i < 2; i += 1) {
    await page.locator('#python-test').click();
    await expect(page.locator('#python-status')).toContainText('Tests passed', { timeout: 60000 });
    await expect(page.locator('#python-output')).toContainText('fixture passed');
    const after = await page.evaluate(() => window.workbench.inspect());
    expect(after.evaluation.model).toEqual(before.evaluation.model);
    expect(after.generation).toBe(before.generation);
    expect(await sourceTexts(page)).toEqual(text);
    const result = await page.evaluate(() => window.workbench.python.lastResult);
    expect(result.disposable).toBe(true);
    expect(result.transaction.reason).toContain('fixture discarded');
  }
  // The existing script path still publishes instances, while tests remain fresh.
  await script(page, 'from intersect_api import Book\nBook(title="Published")');
  await page.locator('#python-run').click();
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  const published = await page.evaluate(() => window.workbench.inspect());
  expect(published.evaluation.model.elements[0].values.title).toBe('Published');
  await script(page, fixture);
  await page.locator('#python-test').click();
  await expect(page.locator('#python-status')).toContainText('Tests passed', { timeout: 60000 });
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(published.evaluation.model);
  expect(await sourceTexts(page)).toEqual(text);
});

test('failed assertions, native validation, cancellation and stale revisions discard fixtures', async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => window.workbench.inspect());
  const text = await sourceTexts(page);
  for (const [program, error] of [
    ['from intersect_api import Book\nBook(title="temporary")\nassert False, "assertion rejected"', 'assertion rejected'],
    ['from intersect_api import Book\nBook(title=None)', 'Multiplicity'],
  ]) {
    await script(page, program);
    await page.locator('#python-test').click();
    await expect(page.locator('#python-error')).toContainText(error, { timeout: 60000 });
    expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  }
  await script(page, 'from intersect_api import Book\nBook(title="temporary")\nwhile True: pass');
  await page.locator('#python-test').click();
  await expect(page.locator('#python-status')).toContainText('Running tests', { timeout: 60000 });
  await page.locator('#python-cancel').click();
  await expect(page.locator('#python-error')).toContainText('Cancelled');
  expect((await page.evaluate(() => window.workbench.inspect())).evaluation.model).toEqual(before.evaluation.model);
  // A recompile invalidates bindings; the host also rejects stale completion.
  await page.evaluate(() => window.workbench.compile());
  await expect(page.locator('#python-binding')).toContainText('STALE');
  await expect(page.locator('#python-test')).toBeDisabled();
  const stale = await page.evaluate(async before => {
    try {
      await window.workbench.request('intersect/testFinish', { interfaceRevision: before.interfaceRevision, generation: before.generation, model: before.evaluation.model });
      return 'accepted';
    } catch (error) { return error.message; }
  }, before);
  expect(stale).toContain('Stale test');
  expect(await sourceTexts(page)).toEqual(text);
});

test('a disposable transaction cannot be submitted through the script publication endpoint', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const w = window.workbench, snapshot = await w.request('intersect/transactionBegin', { disposable: true });
    try {
      await w.request('intersect/scriptCommit', { transactionId: snapshot.transaction.context.id, interfaceRevision: snapshot.interfaceRevision, generation: snapshot.generation, model: snapshot.evaluation.model });
      return 'accepted';
    } catch (error) {
      await w.request('intersect/transactionFinish', { id: snapshot.transaction.context.id, transaction: snapshot.transaction, status: 'rolled_back', reason: 'Negative control', changes_complete: true });
      return error.message;
    }
  });
  expect(result).toContain('cannot be published');
});
