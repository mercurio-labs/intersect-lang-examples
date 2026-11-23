import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:1500";

export default defineConfig({
  testDir: "./web",
  testMatch: "*.spec.mjs",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL,
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview -- --port 1500",
    url: baseURL,
    reuseExistingServer: false,
  },
});
