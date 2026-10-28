import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests against a running local stack (`make up && make demo`, or the dev
 * servers): the web app (which proxies /api), the API and its worker, Postgres, Redis and the
 * provider stubs (apps/stubs), so plans, the realtime interviewer and scores are deterministic.
 * In an automated browser the stub interviewer skips audio and the candidate types.
 *
 *   pnpm e2e                                         every spec
 *   pnpm e2e e2e/tests/03-coding.spec.ts             one spec
 *   E2E_HEADED=1 pnpm e2e                            watch it
 *
 * Env: E2E_BASE_URL (web), E2E_API_URL (API, with /api), E2E_DEMO_PASSWORD (the demo admin's
 * password; defaults to CONV_DEMO_PASSWORD in deploy/compose/.env).
 *
 * Every spec creates its own people through the API, so specs run in parallel. The admin spec
 * edits a tier it creates and deletes, never the deployment's own tiers or settings.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: ".report", open: "never" }]],
  outputDir: ".results",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3550",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    headless: !process.env.E2E_HEADED,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
