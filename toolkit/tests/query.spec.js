import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await page.getByRole('tab', { name: 'Queries', exact: true }).click();
});
test('query examples execute real Rust/WASM derivations and navigation', async ({ page }) => {
  await page.getByRole('button', { name: 'Available copies', exact: true }).click();
  await page.locator('#query-run').click();
  await expect(page.locator('#query-count')).toHaveText('1 row');
  await expect(page.locator('#query-results')).toContainText('A Wizard of Earthsea');
  await expect(page.locator('#query-results')).not.toContainText('Dune');
  await page.getByRole('button', { name: 'Loans and borrowers', exact: true }).click();
  await page.locator('#query-run').click();
  await expect(page.locator('#query-results')).toContainText('Dune');
  await expect(page.locator('#query-results')).toContainText('ada');
  await page.getByRole('button', { name: 'Libraries with available copies', exact: true }).click();
  await page.locator('#query-limit').fill('1');
  await page.locator('#query-run').click();
  await expect(page.locator('#query-results')).toContainText('Catalog');
  await expect(page.locator('#query-results')).not.toContainText('Circulation');
  await page.locator('#query-results button').click();
  await expect(page.locator('#model-file')).toHaveText('catalog.library');
  await page.getByRole('tab', { name: 'Queries', exact: true }).click();
  await page.locator('.query-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/query-desktop.png', fullPage: true });
});
test('queries track edits, reject stale contexts, and recover after restart', async ({ page }) => {
  await page.getByRole('button', { name: 'Available copies', exact: true }).click();
  await page.locator('#query-run').click();
  await expect(page.locator('#query-count')).toHaveText('1 row');
  const state = await page.evaluate(() => window.workbench.inspect());
  const query = JSON.parse(await page.locator('#query-plan').inputValue());
  await page.evaluate(() => window.workbench.modelModels.loans.setValue('library Circulation {}'));
  await expect(page.locator('#query-status')).toContainText('Model changed');
  await expect(page.locator('#query-results')).toBeEmpty();
  const error = await page.evaluate(async ({ query, state }) => {
    try { await window.workbench.request('intersect/query', { query, interfaceRevision: state.interfaceRevision, generation: state.generation }); return null; } catch (e) { return e.message; }
  }, { query, state });
  expect(error).toContain('Stale query');
  await page.locator('#query-run').click();
  await expect(page.locator('#query-count')).toHaveText('2 rows');
  await page.locator('.ide-info > summary').click(); await page.locator('#restart').click(); await page.locator('.ide-info > summary').click();
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('button', { name: 'Available copies', exact: true }).click();
  await page.locator('#query-run').click();
  await expect(page.locator('#query-count')).toHaveText('2 rows');
});
test('invalid queries fail explicitly and parameter plans are editable', async ({ page }) => {
  await page.getByRole('button', { name: 'Available copies', exact: true }).click();
  await page.locator('#query-columns').fill('name, absent');
  await page.locator('#query-run').click();
  await expect(page.locator('#query-status')).toContainText('Unknown feature');
  await expect(page.locator('#query-results')).toBeEmpty();
  await page.getByRole('button', { name: 'Loans and borrowers', exact: true }).click();
  await page.locator('.query-advanced summary').click();
  const plan = JSON.parse(await page.locator('#query-plan').inputValue());
  plan.filter = { op: 'compare', left: { op: 'field', path: 'member.name' }, comparison: 'eq', right: { op: 'parameter', name: 'member' } };
  await page.locator('#query-plan').fill(JSON.stringify(plan));
  await page.locator('#query-run-plan').click();
  await expect(page.locator('#query-status')).toContainText('Missing query parameter member');
  await page.locator('#query-parameters').fill('{"member":"ada"}');
  await page.locator('#query-run-plan').click();
  await expect(page.locator('#query-results')).toContainText('Dune');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/query-mobile.png', fullPage: true });
});

test('exact signed 64-bit query values preserve limits and parameters across native and WASM', async ({ page }) => {
  const before = await page.evaluate(() => window.workbench.inspect());
  await page.getByRole('button', { name: 'Libraries with available copies', exact: true }).click();
  await page.locator('#query-field').fill('copyCount');
  await page.locator('#query-value').fill('9007199254740993');
  expect(JSON.parse(await page.locator('#query-plan').inputValue()).filter.right.value)
    .toEqual({ kind: 'int64', value: '9007199254740993' });
  await page.locator('#query-run').click();
  await expect(page.locator('#query-results')).toContainText('No matching elements');
  const result = await page.evaluate(async () => {
    const { loadFixtureRuntime: loadRuntime } = await import('/tests/migration-fixtures.js');
    const invoke = await loadRuntime();
    const ecore = `<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="exact" nsURI="urn:exact-query"><eClassifiers x:type="e:EClass" name="Item"><eStructuralFeatures x:type="e:EAttribute" name="value" lowerBound="1" eType="e:EDataType http://www.eclipse.org/emf/2002/Ecore#//ELong"/></eClassifiers></e:EPackage>`;
    const compiled = invoke({ method: 'fixture/compile', mode: 'structure', ecore });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const empty = invoke({ method: 'evaluate', package: compiled.package, sources: [] });
    const revision = 'exact-query';
    invoke({ method: 'script/begin', revision, package: compiled.package, model: empty.model });
    for (const value of ['9223372036854775807', '-9223372036854775808', '9007199254740993', '2']) {
      invoke({ method: 'script/create', revision, class: 'Item', values: { value: { kind: 'int64', value } } });
    }
    const model = invoke({ method: 'script/inspect', revision }).model;
    const query = {
      schema_uri: compiled.package.schema.uri, schema_revision: compiled.package.schema.revision,
      from: 'Item', filter: null, select: [{ name: 'value', expression: { op: 'field', path: 'value' } }],
      order_by: [{ expression: { op: 'field', path: 'value' }, descending: false }], limit: 50,
    };
    const request = { method: 'query/execute', package: compiled.package, model, query, parameters: {} };
    const filtered = structuredClone(request);
    filtered.query.filter = { op: 'compare', left: { op: 'field', path: 'value' }, comparison: 'ge', right: { op: 'parameter', name: 'minimum' } };
    filtered.parameters.minimum = { kind: 'int64', value: '9007199254740993' };
    const small = structuredClone(request);
    small.query.filter = { op: 'compare', left: { op: 'field', path: 'value' }, comparison: 'eq', right: { op: 'literal', value: 2 } };
    return [request, filtered, small].map(request => ({ request, result: invoke(request) }));
  });
  for (const item of result) {
    const executable = process.env.INTERSECT_TEST_NATIVE_ORACLE;
    const native = JSON.parse(execFileSync(executable || 'cargo', executable ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], {
      cwd: new URL('../.runtime/intersect-text/', import.meta.url), input: JSON.stringify(item.request), encoding: 'utf8', timeout: 90000,
    }));
    expect(item.result).toEqual(native);
  }
  expect(result[0].result.rows.map(row => row[0])).toEqual([
    { kind: 'int64', value: '-9223372036854775808' }, { kind: 'int64', value: '2' },
    { kind: 'int64', value: '9007199254740993' }, { kind: 'int64', value: '9223372036854775807' },
  ]);
  expect(result[1].result.rows.map(row => row[0].value)).toEqual(['9007199254740993', '9223372036854775807']);
  expect(result[2].result.rows).toEqual([[{ kind: 'int64', value: '2' }]]);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(before);
});
