import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled');
  await page.getByRole('tab', { name: 'Test', exact: true }).click();
});

test('published instances form a resource/containment tree with selectable properties and reference navigation', async ({ page }) => {
  const tree = page.getByRole('tree', { name: 'Model containment tree' });
  const sidebar = await page.locator('#test-containment').boundingBox();
  const editors = await page.locator('#usage-page').boundingBox();
  expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(editors.x);
  expect(sidebar.y).toBe(editors.y);
  await expect(page.locator('#test-properties [role="tree"]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Output', exact: true }).click();
  await expect(tree).toBeVisible();
  await page.getByRole('button', { name: 'Hide bottom panel' }).click();
  await expect(tree).toBeVisible();
  const catalog = tree.getByRole('treeitem', { name: 'Catalog · Library', exact: true });
  const circulation = tree.getByRole('treeitem', { name: 'Circulation · Library', exact: true });
  await expect(catalog.getByRole('treeitem')).toHaveCount(3);
  await expect(circulation.getByRole('treeitem')).toHaveCount(1);
  await expect(tree.getByRole('treeitem', { name: 'dune · BookCopy', exact: true })).toHaveCount(1);
  await expect(catalog).toHaveAttribute('aria-level', '2');
  await catalog.locator(':scope > .instance-row').click();
  await expect(page.locator('#test-properties')).toBeVisible();
  await expect(page.locator('.ide-dock')).not.toHaveClass(/is-open/);
  await catalog.press('ArrowLeft');
  await expect(catalog).toHaveAttribute('aria-expanded', 'false');
  await expect(tree.getByRole('treeitem', { name: 'dune · BookCopy', exact: true })).toBeHidden();
  await circulation.press('ArrowRight');
  const loan = tree.getByRole('treeitem', { name: 'first · Loan', exact: true });
  await loan.locator(':scope > .instance-row').click();
  const properties = page.getByRole('region', { name: 'Instance properties' });
  await expect(properties).toContainText('first');
  await properties.getByRole('button', { name: 'dune · BookCopy', exact: true }).click();
  await expect(catalog).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('treeitem', { name: 'dune · BookCopy', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(properties).toContainText('Dune');
  await expect(properties).toContainText('available · derived');
  const divider = page.getByRole('separator', { name: 'Resize model containment and editors' });
  await divider.press('Shift+ArrowRight');
  expect((await page.locator('#test-containment').boundingBox()).width).toBeCloseTo(sidebar.width + 30, 0);
  await divider.press('End');
  expect((await page.locator('#usage-page').boundingBox()).width).toBeGreaterThanOrEqual(260);
  await divider.press('Enter');
  await page.screenshot({ path: 'test-results/usage-containment-tree.png' });
});

test('tree state survives evaluation and inherited containment differs from ordinary references', async ({ page }) => {
  const compiled = await page.evaluate(async () => {
    const wb = window.workbench;
    const ecore = `<ecore:EPackage xmlns:ecore="http://www.eclipse.org/emf/2002/Ecore" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="tree" nsURI="urn:tree" nsPrefix="tree">
      <eClassifiers xsi:type="ecore:EClass" name="Base" abstract="true"><eStructuralFeatures xsi:type="ecore:EReference" name="children" eType="#//Node" upperBound="-1" containment="true"/></eClassifiers>
      <eClassifiers xsi:type="ecore:EClass" name="Node" eSuperTypes="#//Base"><eStructuralFeatures xsi:type="ecore:EAttribute" name="name" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/><eStructuralFeatures xsi:type="ecore:EReference" name="link" eType="#//Node"/></eClassifiers>
    </ecore:EPackage>`;
    const migration = await wb.request('intersect/migrateEcore', {uri:'memory:tree.ecore',text:ecore,target_uri:'memory:tree.rcore'});
    if (!migration.ok) throw new Error(JSON.stringify(migration));
    wb.definitionModels.rcore.setValue(migration.report.converted.text);
    wb.definitionModels.rcore_behavior.setValue(''); wb.setDefinitionMode('structure'); return wb.compile();
  });
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
  await expect(page.locator('#model-tree')).toContainText('No constructed elements');
  await page.getByRole('tab', { name: 'script.py', exact: true }).click();
  await page.locator('#python-enable').click();
  await expect(page.locator('#python-status')).toContainText('Python ready', { timeout: 30000 });
  await page.evaluate(() => window.workbench.python.model.setValue('from intersect_api import Node\nparent = Node(name="root")\nchild = Node(name="child")\nparent.children = [child]\nchild.link = parent\n'));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  const tree = page.getByRole('tree', { name: 'Model containment tree' });
  const root = tree.getByRole('treeitem', { name: 'root · Node', exact: true });
  await expect(root.getByRole('treeitem', { name: 'child · Node', exact: true })).toHaveCount(1);
  await expect(tree.locator('[data-element-id]')).toHaveCount(2);
  await root.locator(':scope > .instance-row').click(); await root.press('ArrowLeft');
  await page.evaluate(() => window.workbench.python.model.setValue('from intersect_api import Node\nNode.find("root").name = "renamed"\n'));
  await page.locator('#python-run').click();
  await expect(page.locator('#python-status')).toContainText('Committed', { timeout: 60000 });
  const renamed = tree.getByRole('treeitem', { name: 'renamed · Node', exact: true });
  await expect(renamed).toHaveAttribute('aria-expanded', 'false');
  await expect(renamed).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Instance properties' })).toContainText('renamed');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.querySelector('#app').scrollWidth <= innerWidth)).toBe(true);
});
