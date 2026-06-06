// `player` is the H160 the GCS contract sees as `caller()` — a 20-byte hex
// string `0x…`. The dashboard resolves these to DotNS names (SPEC §8.2);
// in-game the template shows them truncated.
export interface ScoreEntry {
  player: `0x${string}`;
  // u128 on-chain; numbers here are fine for the score ranges template games
  // produce. Held as a JS number for the local guest path and the UI.
  score: number;
  // Unix seconds (SPEC §4). 0 when unknown (e.g. a freshly-played local score
  // before it lands on-chain).
  timestamp: number;
}

// SPEC §4.2: 0 = higher is better, 1 = lower is better.
export type ScoreOrdering = 0 | 1;

// Read surface the in-game scoreboard UI consumes. These map directly onto the
// GCS reads (SPEC §4.2): getLeaderboard, getRecent, getBest.
export interface ScoreboardAPI {
  getTopScores(limit?: number): Promise<ScoreEntry[]>;
  // Most-recent submissions (newest first), including non-best plays — powers
  // the live activity feed.
  getRecentScores(limit?: number): Promise<ScoreEntry[]>;
  getPlayerBest(player: `0x${string}`): Promise<number | null>;
}
