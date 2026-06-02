import { afterAll, describe, expect, it } from "vitest";
import { contractScoreboard } from "../../src/scoreboard/contract-impl";
import { getBurnerH160 } from "../../src/scoreboard/signer";
import { getCdm } from "../../src/scoreboard/cdm";
import { getTotalPoints } from "../../src/scoreboard/arcade";

// These tests hit the live paseo-next-v2 contracts in cdm.json and spend real
// testnet PAS. They run only when a funded faucet account is provided:
//
//   E2E_FAUCET_SURI="<12/24-word mnemonic, optionally //path>" npm run test:e2e
//
// Without it we skip rather than fail — the leaderboard layer can't submit
// without a faucet to fund the fresh burner. ~1 PAS + fees per run.
const FAUCET = process.env.E2E_FAUCET_SURI;

// Arbitrary non-zero score. A fresh burner has no prior best, so after a single
// submit the on-chain best must equal exactly this.
const SCORE = 4321;

describe("leaderboard E2E (paseo-next-v2)", () => {
  afterAll(() => {
    // Release the WebSocket so vitest can exit.
    try {
      getCdm().client.destroy();
    } catch {
      /* never connected */
    }
  });

  it.runIf(FAUCET)(
    "submits a score that the leaderboard contract reflects on-chain",
    async () => {
      const player = getBurnerH160();

      // Fresh burner => no prior personal best.
      expect(await contractScoreboard.getPlayerBest(player)).toBeNull();

      // The real app path: fund + map the burner, submit_score, then the
      // arcade record_score sync — all as live txs.
      await contractScoreboard.submitScore(SCORE);

      // Leaderboard round-trip: the contract now reports our exact score.
      expect(await contractScoreboard.getPlayerBest(player)).toBe(SCORE);

      // Arcade aggregation only happens once the game is registered with the
      // Arcade (a one-time deployer step); record_score is otherwise a no-op.
      // Assert consistency without flaking on registration state.
      const total = await getTotalPoints(player);
      if (total > 0n) {
        expect(total).toBe(BigInt(SCORE));
      } else {
        console.warn(
          "[e2e] arcade total is 0 — leaderboard not registered with the Arcade; " +
            "record_score no-opped (run arcade.registerGame to enable aggregation).",
        );
      }
    },
  );

  // Read-only: queries don't sign, so this needs no faucet and costs nothing.
  // Proves cdm.json + ABI + the live WebSocket round-trip actually work.
  // Uses a fixed sentinel address (never a real player) rather than the burner,
  // which the write test above mutates when both run in the same process.
  it("connects to the live leaderboard contract", async () => {
    if (!FAUCET) {
      console.warn(
        "[e2e] write test skipped: set E2E_FAUCET_SURI to a funded paseo account to run it.",
      );
    }
    const NEVER_PLAYED = "0x000000000000000000000000000000000000dead" as const;
    expect(await contractScoreboard.getPlayerBest(NEVER_PLAYED)).toBeNull();
  });
});
