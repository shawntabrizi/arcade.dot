import { defineConfig, devices } from "@playwright/test";

// BOOT SMOKE — host-free. Serves the REAL built bundle via `vite preview`
// (NO VITE_ARCADE_FAKE_GATEWAY), so it exercises the real product-sdk gateway
// exactly as the deployed app does, minus the host. Catches boot-time crashes
// (blank #root) that the fake-gateway e2e (playwright.config.ts) can't see.
// Run: `npm run test:boot` (builds first). Separate config so it never mixes
// with the fake-driven e2e suite.
const PORT = 5192;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./test/boot",
  testMatch: "**/*.smoke.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE_URL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Real build, no fake flag. `preview` serves ./dist — `test:boot` builds first.
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
