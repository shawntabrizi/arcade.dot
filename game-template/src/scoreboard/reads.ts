import type { ScoreboardAPI, ScoreEntry } from "./api";
import { gcsQuery, isGcsDeployed, READ_ORIGIN } from "./gcs";

interface RawEntry {
  player: `0x${string}`;
  score: bigint;
  at: bigint;
}

function toEntries(rows: RawEntry[] | null): ScoreEntry[] {
  if (!rows) return [];
  return rows.map((r) => ({
    player: r.player,
    score: Number(r.score),
    timestamp: Number(r.at),
  }));
}

// SPEC §4.2 reads against the GCS reference contract: getLeaderboard (sorted
// best-first), getRecent (newest-first ring), getBest (personal best).
export const contractScoreboard: ScoreboardAPI = {
  async getTopScores(limit = 10) {
    if (!isGcsDeployed()) return [];
    return toEntries(await gcsQuery<RawEntry[]>("getLeaderboard", { offset: 0, limit }, READ_ORIGIN));
  },

  async getRecentScores(limit = 10) {
    if (!isGcsDeployed()) return [];
    return toEntries(await gcsQuery<RawEntry[]>("getRecent", { offset: 0, limit }, READ_ORIGIN));
  },

  async getPlayerBest(player) {
    if (!isGcsDeployed()) return null;
    const best = await gcsQuery<bigint>("getBest", { player }, READ_ORIGIN);
    if (best === null) return null;
    const v = Number(best);
    return v === 0 ? null : v;
  },
};

export const isContractDeployed = isGcsDeployed;
