import { defineConfig } from '@playwright/test';
// Point this at an independently extracted artifact served by an ordinary HTTP
// server. No Vite development server, build step, or runtime checkout is used.
if (!process.env.INTERSECT_ALPHA_URL) throw new Error('Set INTERSECT_ALPHA_URL to the served extracted alpha artifact');
export default defineConfig({
  testDir: './tests',
  testMatch: ['library-text.spec.js', 'model-text.spec.js', 'alpha.spec.js'],
  workers: 1,
  retries: 0,
  timeout: 90000,
  reporter: [['list'], ['json', { outputFile: 'test-results/alpha-results.json' }]],
  use: {
    baseURL: process.env.INTERSECT_ALPHA_URL,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
