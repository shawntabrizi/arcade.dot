// A deterministic, in-memory ArcadeReads fake. This is THE injection seam the
// unit tests and the Playwright e2e (item 15) use instead of a real RPC: pass a
// fixture set of games + per-game entries, get back an ArcadeReads that the UI
// and pure logic consume identically to the chain impl. No network, no codecs.

import type { ArcadeReads } from "./arcade-reads";
import { shortAddress } from "./logic";
import type {
  Address,
  Game,
  ScoreConfig,
  ScoreEntry,
} from "./types";

export interface FakeGame {
  game: Game;
  config: ScoreConfig;
  leaderboard: ScoreEntry[]; // best-first
  recent: ScoreEntry[]; // newest-first
  // Optional reverse-name map (item 14 will exercise this); absent → truncated.
  names?: Record<string, string>;
}

export function createFakeReads(fixtures: FakeGame[]): ArcadeReads {
  const byAddr = new Map<string, FakeGame>(
    fixtures.map((f) => [f.game.listing.address.toLowerCase(), f]),
  );
  const find = (a: Address) => byAddr.get(a.toLowerCase());

  return {
    async listGames() {
      return fixtures.map((f) => f.game);
    },
    async getGame(address) {
      return find(address)?.game ?? null;
    },
    async getScoreConfig(address) {
      return find(address)?.config ?? { scoreOrdering: 0, scoreFormat: 0, scoreUnit: "" };
    },
    async getLeaderboard(address, offset, limit) {
      const f = find(address);
      if (!f) return [];
      return f.leaderboard.slice(offset, offset + limit);
    },
    async getRecent(address, offset, limit) {
      const f = find(address);
      if (!f) return [];
      return f.recent.slice(offset, offset + limit);
    },
    async resolveName(player) {
      for (const f of fixtures) {
        const n = f.names?.[player.toLowerCase()];
        if (n) return n;
      }
      return shortAddress(player);
    },
    onNewBlock() {
      // Fakes don't tick; the e2e can drive refreshes by reloading or by a
      // dedicated test hook if needed. No-op unsubscribe.
      return () => {};
    },
  };
}

// ---- Sample fixtures used by the e2e bundle (VITE_ARCADE_FAKE_READS=1) -----
// Three games spanning the three score formats and a requiresAccount game, with
// distinct play counts / registration times / activity so all three home sort
// orders and the chip filter are visibly exercised.

const A1 = "0x1111111111111111111111111111111111111111" as Address;
const A2 = "0x2222222222222222222222222222222222222222" as Address;
const A3 = "0x3333333333333333333333333333333333333333" as Address;
const P1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const P2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const P3 = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;

const NOW = Math.floor(Date.UTC(2026, 5, 1) / 1000);

export const SAMPLE_GAMES: FakeGame[] = [
  {
    game: {
      listing: {
        address: A1,
        name: "Snake",
        gameType: "arcade",
        shortDescription: "Classic snake. Eat, grow, don't bite yourself.",
        playUrl: "arcade-snake.dot",
        thumbnailCid: "",
        requiresAccount: false,
        extraCid: "",
        metaVersion: 1,
        registeredAt: NOW - 86400 * 10,
        updatedAt: NOW - 86400 * 2,
      },
      stats: { playCount: 1280, uniquePlayers: 342, lastPlayedAt: NOW - 60 },
    },
    config: { scoreOrdering: 0, scoreFormat: 0, scoreUnit: "" },
    leaderboard: [
      { player: P1, score: 9001n, at: NOW - 3600 },
      { player: P2, score: 880n, at: NOW - 7200 },
    ],
    recent: [
      { player: P3, score: 120n, at: NOW - 60 },
      { player: P1, score: 9001n, at: NOW - 3600 },
    ],
    names: { [P1.toLowerCase()]: "alice.dot" },
  },
  {
    game: {
      listing: {
        address: A2,
        name: "Time Trial",
        gameType: "racing",
        shortDescription: "Fastest lap wins. Lower is better.",
        playUrl: "https://time-trial.dot.li",
        thumbnailCid: "",
        requiresAccount: false,
        extraCid: "",
        metaVersion: 1,
        registeredAt: NOW - 86400 * 3,
        updatedAt: NOW - 86400 * 3,
      },
      stats: { playCount: 540, uniquePlayers: 90, lastPlayedAt: NOW - 600 },
    },
    config: { scoreOrdering: 1, scoreFormat: 1, scoreUnit: "" },
    leaderboard: [
      { player: P2, score: 83456n, at: NOW - 1200 }, // 1:23.456
      { player: P3, score: 605000n, at: NOW - 2400 }, // 10:05.000
    ],
    recent: [{ player: P2, score: 83456n, at: NOW - 600 }],
  },
  {
    game: {
      listing: {
        address: A3,
        name: "Lap Battle",
        gameType: "multiplayer", // unknown tag → buckets to "other"
        shortDescription: "Head-to-head laps. Sign in to play.",
        playUrl: "lap-battle.dot",
        thumbnailCid: "",
        requiresAccount: true,
        extraCid: "",
        metaVersion: 1,
        registeredAt: NOW - 86400 * 1,
        updatedAt: NOW - 86400 * 1,
      },
      stats: { playCount: 30, uniquePlayers: 12, lastPlayedAt: 0 },
    },
    config: { scoreOrdering: 0, scoreFormat: 2, scoreUnit: "laps" },
    leaderboard: [{ player: P1, score: 42n, at: NOW - 5000 }],
    recent: [],
  },
];
