import { test, expect } from '@playwright/test';
test('browser basedpyright uses generated virtual stubs for all four services', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { PythonLsp } = await import('/src/python-lsp.js');
    window.pythonDiagnostics = [];
    window.probe = new PythonLsp(p => window.pythonDiagnostics.push(p));
    await window.probe.initialize('class BookCopy:\n    def __init__(self, *, title: str) -> None: ...\n    @property\n    def available(self) -> bool: ...\n', 'from intersect_api import BookCopy\ncopy = BookCopy(title="Dune")\ncopy.available\nbad = BookCopy(title=42)\n');
  });
  const completion = await page.evaluate(() => window.probe.at('completion', 2, 5));
  expect(completion.items.some(x => x.label === 'available')).toBe(true);
  expect(JSON.stringify(await page.evaluate(() => window.probe.at('hover', 2, 8)))).toContain('bool');
  expect(JSON.stringify(await page.evaluate(() => window.probe.at('signatureHelp', 1, 22)))).toContain('title: str');
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.pythonDiagnostics))).toContain('reportArgumentType');
  await page.evaluate(() => window.probe.dispose());
});
