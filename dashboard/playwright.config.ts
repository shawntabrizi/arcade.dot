import { defineConfig, devices } from "@playwright/test";

// Playwright e2e for the dashboard (BUILD_PLAN item 15, SPEC §7). The chain is
// faked at the ArcadeReads seam: the dev server runs with
// VITE_ARCADE_FAKE_READS=1, which makes composition.ts use src/fake-reads.ts
// (SAMPLE_GAMES + a fixture reverse-resolver) instead of the real PAPI/sdk-ink
// chain reads. No network, no RPC, fully deterministic. Headless by default.
//
// Mirrors game-template/playwright.config.ts (same @playwright/test pin, same
// webServer-with-env pattern), on a distinct port so the two can run side by side.
const PORT = 5181;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  // The e2e specs use a .e2e.ts suffix so vitest (src/**/*.test.ts) never picks
  // them up; tell Playwright to match only that suffix.
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
    // Serve the app with the test-only fake-reads flag set so the bundle reads
    // deterministic fixtures instead of a real RPC.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_ARCADE_FAKE_READS: "1" },
  },
});
