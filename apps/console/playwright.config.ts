import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end against a running API (seeded, DEV_TOKENS=on) and the built console (`vite preview`).
 * CI starts both; locally, start them and run `pnpm e2e`. E2E_CHROMIUM points at a browser binary
 * when the installed Playwright browsers do not match this Playwright version.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../build/e2e-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    ...(process.env.E2E_CHROMIUM ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } }, testIgnore: /responsive/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /responsive/ },
  ],
});
