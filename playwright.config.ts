import { defineConfig, devices } from "@playwright/test";

import { e2eSetupToken } from "./e2e/fixtures";

const e2ePort = Number.parseInt(process.env.E2E_PORT ?? "4173", 10);
if (!Number.isInteger(e2ePort) || e2ePort < 1 || e2ePort > 65_535) {
  throw new Error("E2E_PORT must be an integer between 1 and 65535");
}

const baseURL = `http://127.0.0.1:${e2ePort}`;
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);

export default defineConfig({
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  retries: process.env.CI ? 1 : 0,
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run start:e2e",
    env: {
      ...inheritedEnvironment,
      E2E_PORT: String(e2ePort),
      E2E_SETUP_TOKEN: e2eSetupToken,
    },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/api/health`,
  },
  workers: 1,
});
