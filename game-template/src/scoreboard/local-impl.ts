import type { ScoreboardAPI, ScoreEntry, ScoreOrdering } from "./api";
import type { ChainGateway } from "./gateway";

// Local-only fallback (SPEC §10.4 "play fully offline"): no chain, no signer,
// no account. Scores live in localStorage so the in-game board still works with
// no contract deployed and no host. A deterministic local H160 stands in for
// the player so the board can highlight "you".
const STORAGE_KEY = "arcade:local-scores";
const LOCAL_PLAYER = "0x0000000000000000000000000000000000l0ca1" as `0x${string}`;
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

function append(score: number): void {
  const entries = read();
  entries.push({ player: LOCAL_PLAYER, score, timestamp: Math.floor(Date.now() / 1000) });
  write(entries.slice(-MAX_ENTRIES));
}

export const localScoreboard: ScoreboardAPI = {
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
    const bests = read()
      .filter((e) => e.player.toLowerCase() === player.toLowerCase())
      .map((e) => e.score);
    return bests.length === 0 ? null : Math.max(...bests);
  },
};

// A ChainGateway that writes to localStorage instead of a chain — drop-in for
// the Scoreboard when playing fully offline. "Sign in" is a no-op that adopts
// the local player; submit appends to the local log.
export function createLocalGateway(ordering: ScoreOrdering = 0): ChainGateway {
  let connected = false;
  const listeners = new Set<() => void>();
  return {
    async scoreOrdering() {
      return ordering;
    },
    currentPlayer() {
      return connected ? LOCAL_PLAYER : null;
    },
    detectSession() {
      // Offline fallback: never in a host; "signed in" only after a local
      // connect() (which is a no-op adopting the deterministic local player).
      return {
        inHost: false,
        account: connected
          ? { ss58: LOCAL_PLAYER, h160: LOCAL_PLAYER }
          : null,
      };
    },
    subscribeSession(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async connect() {
      connected = true;
      for (const cb of listeners) cb();
      return LOCAL_PLAYER;
    },
    async ensureMapped() {
      /* no chain to map against */
    },
    async submitScore(score) {
      append(score);
    },
    async getLeaderboard(_offset, limit) {
      return localScoreboard.getTopScores(limit) as Promise<ScoreEntry[]>;
    },
    async getRecent(_offset, limit) {
      return localScoreboard.getRecentScores(limit) as Promise<ScoreEntry[]>;
    },
    async getBest(player) {
      return localScoreboard.getPlayerBest(player);
    },
  };
}
