// KerML draft specs: build with INTERSECT_WEB_WASM set to intersect-lang-kerml's
// intersect_kerml_web.wasm (see scripts/build-wasm.mjs); core intersect-web has no draft/kerml methods.
import {defineConfig} from '@playwright/test';
import {testServer} from './playwright-server.js';
const {baseURL,webServer}=testServer(process.env.INTERSECT_DRAFT_PRODUCTION==='1');
export default defineConfig({testDir:'./tests',testMatch:['prepared-draft.spec.js',...(process.env.INTERSECT_DRAFT_PRODUCTION==='1'?[]:['prepared-draft-worker.spec.js'])],timeout:240000,workers:1,
  use:{baseURL,viewport:{width:1280,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},webServer});
