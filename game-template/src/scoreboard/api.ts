// `player` is the H160 the contract sees as `caller()` — a 20-byte hex
// string `0x…`. For a UI label, look it up via the Arcade's display-name
// table (added in a later PR); until then the frontend shows it truncated.
export interface ScoreEntry {
  player: `0x${string}`;
  score: number;
  timestamp: number;
}

export interface ScoreboardAPI {
  submitScore(score: number): Promise<void>;
  getTopScores(limit?: number): Promise<ScoreEntry[]>;
  // Most-recent submissions in submission order (newest first), including ones
  // that didn't beat a personal best — so the UI can show live activity.
  getRecentScores(limit?: number): Promise<ScoreEntry[]>;
  getPlayerBest(player: `0x${string}`): Promise<number | null>;
}
