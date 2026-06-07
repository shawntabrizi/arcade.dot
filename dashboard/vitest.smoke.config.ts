import { defineConfig } from "vitest/config";

// Live smoke test — hits a real RPC. Separate from the hermetic unit suite
// (vitest.config.ts) so it never gates offline/CI unit runs. Run explicitly:
// `npm run test:smoke`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/smoke/**/*.smoke.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
