import type { ScoreboardAPI, ScoreEntry } from "./api";
import { getBurnerH160 } from "./signer";

const STORAGE_KEY = "leaderboard-playground:scores";
const MAX_ENTRIES = 100;

function read(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScoreEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: ScoreEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export const localScoreboard: ScoreboardAPI = {
  async submitScore(score) {
    // Keep entries in submission order (newest last); getTopScores sorts on
    // read. One log serves both "top" and "recent".
    const entries = read();
    entries.push({ player: getBurnerH160(), score, timestamp: Date.now() });
    write(entries.slice(-MAX_ENTRIES));
  },

  async getTopScores(limit = 10) {
    return read()
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },

  async getRecentScores(limit = 10) {
    return read().slice(-limit).reverse();
  },

  async getPlayerBest(player) {
    const personalBests = read()
      .filter((e) => e.player === player)
      .map((e) => e.score);
    return personalBests.length === 0 ? null : Math.max(...personalBests);
  },
};
