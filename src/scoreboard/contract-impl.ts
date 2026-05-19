import type { ScoreboardAPI, ScoreEntry } from "./api";
import { getCdm, isContractInstalled } from "./cdm";
import { ensureBurnerReady } from "./bootstrap";
import { getBurnerH160, getBurnerSigner, getBurnerSs58 } from "./signer";
import { getLeaderboardAddress, isArcadeInstalled, recordScore as arcadeRecordScore } from "./arcade";

const CONTRACT_NAME = "@example/leaderboard-playground";

function isContractDeployed(): boolean {
  return isContractInstalled(CONTRACT_NAME);
}

interface LeaderboardContract {
  submitScore: { tx: (score: bigint) => Promise<unknown> };
  getBest: {
    query: (player: `0x${string}`) => Promise<{ success: boolean; value: bigint }>;
  };
  getPlayerCount: {
    query: () => Promise<{ success: boolean; value: number }>;
  };
  getEntryAt: {
    query: (
      index: number,
    ) => Promise<{
      success: boolean;
      value: { player: `0x${string}`; score: bigint };
    }>;
  };
}

function contract(): LeaderboardContract {
  // The generated CDM type for this contract isn't available until after
  // `cdm install` has written .cdm/cdm.d.ts, so we cast to a local interface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getCdm() as any).getContract(CONTRACT_NAME) as LeaderboardContract;
}

async function ensureReady(): Promise<void> {
  const c = getCdm();
  await ensureBurnerReady(c.client, c.inkSdk, {
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
    await contract().submitScore.tx(BigInt(score));
    // Pull-style sync to the Arcade so totals + recent feed reflect this submit.
    // Best-effort: if the Arcade isn't installed (forks that haven't run the
    // arcade deploy), fall through silently — the per-game leaderboard still works.
    const gameAddr = getLeaderboardAddress();
    if (isArcadeInstalled() && gameAddr) {
      await arcadeRecordScore(gameAddr);
    }
  },

  async getTopScores(limit = 10) {
    if (!isContractDeployed()) return [];
    const c = contract();
    const countRes = await c.getPlayerCount.query();
    const count = countRes.success ? countRes.value : 0;
    if (count === 0) return [];
    const entries: ScoreEntry[] = [];
    for (let i = 0; i < count; i++) {
      const r = await c.getEntryAt.query(i);
      if (!r.success) continue;
      entries.push({
        player: r.value.player,
        score: Number(r.value.score),
        timestamp: 0,
      });
    }
    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, limit);
  },

  async getPlayerBest(player) {
    if (!isContractDeployed()) return null;
    const r = await contract().getBest.query(player);
    if (!r.success) return null;
    const v = Number(r.value);
    return v === 0 ? null : v;
  },
};

export const isLeaderboardContractDeployed = isContractDeployed;
export { getBurnerH160, getBurnerSs58 };
