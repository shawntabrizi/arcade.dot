import { defineConfig } from "vitest/config";

// End-to-end tests run against the LIVE paseo-next-v2 deployment described in
// cdm.json — no local node. They spend real testnet PAS (a fresh burner is
// funded + mapped, then signs real submit_score / record_score txs), so they
// only run when E2E_FAUCET_SURI points at a funded account (see README).
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    environment: "node",
    // Installs the in-memory localStorage shim the burner/bootstrap code needs.
    setupFiles: ["test/e2e/setup.ts"],
    // Chain finality on Asset Hub is ~12-30s per tx; a run does several.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    // Tests share one burner identity per process; never parallelize them.
    fileParallelism: false,
  },
  define: {
    // The app reads the faucet from import.meta.env.VITE_FAUCET_SURI. Feed it
    // the funded E2E account so the real bootstrap code path runs unchanged.
    "import.meta.env.VITE_FAUCET_SURI": process.env.E2E_FAUCET_SURI
      ? JSON.stringify(process.env.E2E_FAUCET_SURI)
      : "undefined",
  },
});
