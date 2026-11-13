import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests', testMatch:'examples-site.spec.js', workers:1, timeout:60000,
  use:{baseURL:'http://127.0.0.1:4184'},
  webServer:{command:'python -m http.server 4184 --bind 127.0.0.1 --directory ../dist',url:'http://127.0.0.1:4184',reuseExistingServer:false},
});
