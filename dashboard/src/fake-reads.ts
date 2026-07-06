// A deterministic, in-memory ArcadeReads fake. This is THE injection seam the
// unit tests and the Playwright e2e (item 15) use instead of a real RPC: pass a
// fixture set of games + per-game entries, get back an ArcadeReads that the UI
// and pure logic consume identically to the chain impl. No network, no codecs.

import type { ArcadeReads } from "./arcade-reads";
import { isConformant, shortAddress, SUPPORTED_ARCADE_VERSION } from "./logic";
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
  // What this game's contract would answer for arcadeVersion() (SPEC §4.1).
  // The fake applies the §7.4 conformance gate against this exactly as the real
  // chain-reads.listGames does, so a non-conformant/ghost listing in the
  // fixtures is filtered out of the directory just like on-chain. Absent → the
  // supported version (conformant) so existing fixtures are unaffected.
  arcadeVersion?: number | null;
}

// A fake DotnsReverseResolver.nameOf (SPEC §8.2): given a player H160, returns
// the reverse name. Models the real contract's fail-closed semantics — return
// "" for "no name" — and MAY throw to model a revert/RPC error. The default
// (built from the fixtures' `names` maps) returns "" for unknown addresses.
export type FakeReverseResolver = (player: Address) => Promise<string> | string;

function fixtureResolver(fixtures: FakeGame[]): FakeReverseResolver {
  return (player) => {
    for (const f of fixtures) {
      const n = f.names?.[player.toLowerCase()];
      if (n) return n;
    }
    return ""; // fail-closed: no reverse name
  };
}

export function createFakeReads(
  fixtures: FakeGame[],
  reverseResolver: FakeReverseResolver = fixtureResolver(fixtures),
): ArcadeReads {
  const byAddr = new Map<string, FakeGame>(
    fixtures.map((f) => [f.game.listing.address.toLowerCase(), f]),
  );
  const find = (a: Address) => byAddr.get(a.toLowerCase());
  // SPEC §7.4 conformance gate, applied exactly as chain-reads does: a fixture
  // is conformant iff its arcadeVersion (default = supported) passes isConformant.
  const conformant = (f: FakeGame | undefined): f is FakeGame =>
    f !== undefined &&
    isConformant(
      f.arcadeVersion === undefined ? SUPPORTED_ARCADE_VERSION : f.arcadeVersion,
    );
  const findConformant = (a: Address) => {
    const f = find(a);
    return conformant(f) ? f : undefined;
  };
  // Session name cache (SPEC §8.2): a second lookup for the same address never
  // re-invokes the resolver — mirrors chain-reads' nameCache.
  const nameCache = new Map<string, string>();

  return {
    async listGames() {
      // Only conformant listings reach the directory (SPEC §7.4).
      return fixtures.filter(conformant).map((f) => f.game);
    },
    async refreshGames(addresses) {
      // Mirror the chain impl: return cached game objects for the given subset,
      // omitting any not in the fixture set or gone non-conformant. O(addresses).
      return addresses
        .map((a) => findConformant(a)?.game)
        .filter((g): g is Game => g !== undefined);
    },
    async getGame(address) {
      // Deep-link lookup returns null for a non-conformant listing (§7.4).
      return findConformant(address)?.game ?? null;
    },
    async getScoreConfig(address) {
      return find(address)?.config ?? { scoreFormat: 0, scoreUnit: "" };
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
      const key = player.toLowerCase();
      const cached = nameCache.get(key);
      if (cached !== undefined) return cached;
      const fallback = shortAddress(player);
      let resolved: string;
      try {
        // Empty (fail-closed) → fall back to the truncated address (§8.2).
        const name = await reverseResolver(player);
        resolved = name && name.length > 0 ? name : fallback;
      } catch {
        // Revert / RPC error → fall back to the truncated address (§8.2).
        resolved = fallback;
      }
      nameCache.set(key, resolved);
      return resolved;
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
// A ghost listing: registered in the registry but its contract is not a
// conforming GCS game (arcadeVersion() does not answer 1 — here null, modeling a
// reverted/EOA call). The §7.4 conformance gate MUST hide it from the dashboard.
// Test fixture only — exercises requirement 1 of the item-15 e2e.
const A_GHOST = "0x9999999999999999999999999999999999999999" as Address;
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
    config: { scoreFormat: 0, scoreUnit: "" },
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
    config: { scoreFormat: 1, scoreUnit: "" },
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
    config: { scoreFormat: 2, scoreUnit: "laps" },
    leaderboard: [{ player: P1, score: 42n, at: NOW - 5000 }],
    recent: [],
  },
  {
    // Ghost / non-conformant listing (see A_GHOST). arcadeVersion === null →
    // fails the §7.4 gate → never rendered. Test fixture only.
    game: {
      listing: {
        address: A_GHOST,
        name: "Ghost (non-conformant)",
        gameType: "arcade",
        shortDescription: "Junk listing whose contract is not a GCS game.",
        playUrl: "ghost.dot",
        thumbnailCid: "",
        requiresAccount: false,
        extraCid: "",
        metaVersion: 1,
        registeredAt: NOW - 86400 * 5,
        updatedAt: NOW - 86400 * 5,
      },
      stats: { playCount: 999999, uniquePlayers: 1, lastPlayedAt: NOW - 10 },
    },
    config: { scoreFormat: 0, scoreUnit: "" },
    leaderboard: [],
    recent: [],
    arcadeVersion: null,
  },
];
