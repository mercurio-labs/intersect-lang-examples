import { defineConfig } from '@playwright/test';
import { testServer } from './playwright-server.js';
const { baseURL, webServer } = testServer(true);
export default defineConfig({
  testDir: './tests', testMatch: ['resource-lifecycle.spec.js', 'model-text.spec.js', 'library-text.spec.js', 'imported-assignment.spec.js', 'scalar-comparison-pending.spec.js', 'durable-document.spec.js', 'durable-provider.spec.js', 'numeric-resource-pending.spec.js', 'reference-domain-pending.spec.js', 'string-transport.spec.js', 'input-string-transport.spec.js', 'json-resource-pending.spec.js', 'hidden-scope.spec.js', 'terminal-cardinality.spec.js', 'grouped-negation.spec.js', 'mixed-bindings.spec.js', 'contextual-first-rule.spec.js', 'until-operands.spec.js', 'literal-negation.spec.js', 'terminal-negation.spec.js', 'inferred-recovery.spec.js', 'inference-provider-project.spec.js', 'converted-query.spec.js', 'inference-parameters.spec.js', 'inference-diagnostics.spec.js', 'inference-graph.spec.js', 'inference-authoring.spec.js', 'inference-worker.spec.js', 'semantic-bindings.spec.js', 'production.spec.js', 'upstream-production.spec.js'], timeout: 45000, workers: 1,
  // One CI retry absorbs runner timing stalls; Playwright still reports the test as flaky.
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer,
});
