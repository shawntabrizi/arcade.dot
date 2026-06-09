import type { ScoreboardAPI, ScoreEntry } from "./api";
import { gcsQuery, isGcsDeployed, READ_ORIGIN } from "./gcs";

// uint128 max — the lower-is-better "no record" sentinel returned by getBest.
const MAX_U128 = 2n ** 128n - 1n;

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
    // "No record" sentinels: 0 for higher-is-better, uint128::MAX for
    // lower-is-better (the contract seeds the best to MAX so any real score
    // beats it). Either means the player has no best yet — return null, NOT
    // the raw sentinel (which rendered as "3.4e38 guesses").
    if (best === 0n || best === MAX_U128) return null;
    return Number(best);
  },
};

export const isContractDeployed = isGcsDeployed;
