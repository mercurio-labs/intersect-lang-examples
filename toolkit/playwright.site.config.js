import {defineConfig} from '@playwright/test';
const live = process.env.INTERSECT_SITE_URL;
const prefix = process.env.INTERSECT_SITE_BASE || '/';
if (!/^\/[A-Za-z0-9._/-]*$/.test(prefix) || !prefix.endsWith('/')) throw new Error('Invalid site base');
export default defineConfig({
  testDir:'./tests', testMatch:'examples-site.spec.js', workers:1, timeout:60000,
  use:{baseURL:live ? new URL(live).origin : 'http://127.0.0.1:4184',screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:live ? undefined : {command:`python -B ../tools/serve_site.py --port 4184 --directory ../dist --base ${prefix}`,url:`http://127.0.0.1:4184${prefix}`,reuseExistingServer:false},
});
