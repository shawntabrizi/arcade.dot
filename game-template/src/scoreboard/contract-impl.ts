import type { ScoreboardAPI, ScoreEntry } from "./api";
import { contractQuery, contractSendInBlock, getCdm, inkSdkBest, isContractInstalled } from "./cdm";
import { ensureBurnerReady } from "./bootstrap";
import { getBurnerH160, getBurnerSigner, getBurnerSs58 } from "./signer";
import { getLeaderboardAddress, isArcadeInstalled, recordScore as arcadeRecordScore } from "./arcade";

const CONTRACT_NAME = "@example/leaderboard-playground";

function isContractDeployed(): boolean {
  return isContractInstalled(CONTRACT_NAME);
}

async function ensureReady(): Promise<void> {
  // Best-block ink sdk so the fresh burner's just-included map_account is
  // visible to the dry-run that immediately follows.
  await ensureBurnerReady(getCdm().client, inkSdkBest(), {
    signer: getBurnerSigner(),
    ss58: getBurnerSs58(),
  });
}

export const contractScoreboard: ScoreboardAPI = {
  async submitScore(score) {
    if (!isContractDeployed()) {
      throw new Error(
        `Contract ${CONTRACT_NAME} is not in cdm.json. Run \`dot deploy --contracts\` first.`,
      );
    }
    await ensureReady();
    // Submit at best-block inclusion (see tx.ts) rather than via cdm's
    // finalization-bound `.tx`. This is the one write the UI waits on.
    await contractSendInBlock(
      CONTRACT_NAME,
      "submitScore",
      { score: BigInt(score) },
      getBurnerSs58(),
      getBurnerSigner(),
    );
    // Pull-style sync to the Arcade so totals + recent feed reflect this submit.
    // Fire-and-forget: the per-game leaderboard already reflects the score, so
    // we don't make the player wait on a second tx. Best-effort — silently skip
    // if the Arcade isn't installed (forks that haven't run the arcade deploy).
    const gameAddr = getLeaderboardAddress();
    if (isArcadeInstalled() && gameAddr) {
      void arcadeRecordScore(gameAddr).catch((err) => {
        console.warn("[arcade] record_score failed (non-fatal):", err);
      });
    }
  },

  async getTopScores(limit = 10) {
    if (!isContractDeployed()) return [];
    const origin = getBurnerSs58();
    const count = (await contractQuery<number>(CONTRACT_NAME, "getPlayerCount", {}, origin)) ?? 0;
    if (count === 0) return [];
    const entries: ScoreEntry[] = [];
    for (let i = 0; i < count; i++) {
      const entry = await contractQuery<{ player: `0x${string}`; score: bigint }>(
        CONTRACT_NAME,
        "getEntryAt",
        { index: i },
        origin,
      );
      if (!entry) continue;
      entries.push({ player: entry.player, score: Number(entry.score), timestamp: 0 });
    }
    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, limit);
  },

  async getRecentScores(limit = 10) {
    if (!isContractDeployed()) return [];
    const origin = getBurnerSs58();
    const total = (await contractQuery<number>(CONTRACT_NAME, "getRecentTotal", {}, origin)) ?? 0;
    if (total === 0) return [];
    const ringSize = (await contractQuery<number>(CONTRACT_NAME, "getRecentSize", {}, origin)) ?? 0;
    if (ringSize === 0) return [];
    const n = Math.min(total, ringSize, limit);
    // Walk backwards from the most-recently-written slot.
    const slots = Array.from({ length: n }, (_, i) => (total - 1 - i + ringSize) % ringSize);
    const rows = await Promise.all(
      slots.map((slot) =>
        contractQuery<{ player: `0x${string}`; score: bigint; timestamp: bigint }>(
          CONTRACT_NAME,
          "getRecentAt",
          { slot },
          origin,
        ),
      ),
    );
    return rows
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => ({ player: r.player, score: Number(r.score), timestamp: Number(r.timestamp) }));
  },

  async getPlayerBest(player) {
    if (!isContractDeployed()) return null;
    const best = await contractQuery<bigint>(CONTRACT_NAME, "getBest", { player }, getBurnerSs58());
    if (best === null) return null;
    const v = Number(best);
    return v === 0 ? null : v;
  },
};

export const isLeaderboardContractDeployed = isContractDeployed;
export { getBurnerH160, getBurnerSs58 };
