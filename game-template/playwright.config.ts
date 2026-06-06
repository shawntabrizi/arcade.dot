import { defineConfig, devices } from "@playwright/test";

// Playwright e2e for the §8.3 guest / save-score / sign-in flows. The chain is
// faked at the ChainGateway seam: the dev server runs with
// VITE_ARCADE_FAKE_GATEWAY=1, which makes App.tsx use src/scoreboard/
// fake-gateway.ts (driven per-test via window.__ARCADE_FAKE__) instead of the
// real product-sdk. No network, no testnet PAS. Headless by default.
const PORT = 5180;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  // The e2e specs use a .e2e.ts suffix so vitest (test/unit/**/*.test.ts) never
  // picks them up; tell Playwright to match that suffix.
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Serve the app with the test-only fake-gateway flag set.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_ARCADE_FAKE_GATEWAY: "1" },
  },
});
