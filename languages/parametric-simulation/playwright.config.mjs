import { defineConfig } from "@playwright/test";
const url = "http://127.0.0.1:1503";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.mjs",
  use: { baseURL: url, viewport: { width: 1360, height: 900 } },
  webServer: { command: "npm run preview -- --port 1503", url },
});
