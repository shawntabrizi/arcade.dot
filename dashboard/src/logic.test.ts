import { describe, it, expect } from "vitest";
import {
  isConformant,
  SUPPORTED_ARCADE_VERSION,
  sortByLastPlayed,
  sortByPlayCount,
  sortByRegisteredAt,
  bucketGameType,
  presentChips,
  filterByChip,
  activityGameSet,
  mergeActivity,
  mergeStats,
  formatScore,
  formatDuration,
  toLaunchUrl,
  relativeTime,
  shortAddress,
} from "./logic";
import type { Address, Game, ScoreConfig, ScoreEntry } from "./types";

// ---- fixtures -----------------------------------------------------------
function game(p: {
  addr: string;
  name?: string;
  gameType?: string;
  playCount?: number;
  lastPlayedAt?: number;
  registeredAt?: number;
}): Game {
  return {
    listing: {
      address: p.addr as Address,
      name: p.name ?? p.addr,
      gameType: p.gameType ?? "arcade",
      shortDescription: "",
      playUrl: "x.dot",
      thumbnailCid: "",
      requiresAccount: false,
      extraCid: "",
      metaVersion: 1,
      registeredAt: p.registeredAt ?? 0,
      updatedAt: 0,
    },
    stats: {
      playCount: p.playCount ?? 0,
      uniquePlayers: 0,
      lastPlayedAt: p.lastPlayedAt ?? 0,
    },
  };
}

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;

// ---- conformance gate (SPEC §7.4) ---------------------------------------
describe("conformance gate", () => {
  it("accepts exactly the supported version", () => {
    expect(isConformant(SUPPORTED_ARCADE_VERSION)).toBe(true);
    expect(isConformant(1)).toBe(true);
  });
  it("rejects a failed/absent arcadeVersion() (null)", () => {
    // null = the call reverted / EOA / non-GCS contract — the junk filter.
    expect(isConformant(null)).toBe(false);
  });
  it("rejects any unsupported version (future/garbage)", () => {
    expect(isConformant(0)).toBe(false);
    expect(isConformant(2)).toBe(false);
    expect(isConformant(999)).toBe(false);
  });
});

// ---- home sort orders (SPEC §7.1) ---------------------------------------
describe("home sort orders", () => {
  const games = [
    game({ addr: "0x01", playCount: 10, lastPlayedAt: 100, registeredAt: 5 }),
    game({ addr: "0x02", playCount: 50, lastPlayedAt: 50, registeredAt: 30 }),
    game({ addr: "0x03", playCount: 30, lastPlayedAt: 200, registeredAt: 10 }),
  ];
  it("featured = lastPlayedAt desc", () => {
    expect(sortByLastPlayed(games).map((g) => g.listing.address)).toEqual([
      "0x03",
      "0x01",
      "0x02",
    ]);
  });
  it("most played = playCount desc", () => {
    expect(sortByPlayCount(games).map((g) => g.listing.address)).toEqual([
      "0x02",
      "0x03",
      "0x01",
    ]);
  });
  it("new = registeredAt desc", () => {
    expect(sortByRegisteredAt(games).map((g) => g.listing.address)).toEqual([
      "0x02",
      "0x03",
      "0x01",
    ]);
  });
  it("does not mutate the input array", () => {
    const before = games.map((g) => g.listing.address);
    sortByPlayCount(games);
    sortByLastPlayed(games);
    sortByRegisteredAt(games);
    expect(games.map((g) => g.listing.address)).toEqual(before);
  });
});

// ---- gameType chip bucketing (SPEC §5.4) --------------------------------
describe("gameType bucketing", () => {
  it("keeps known tags (case-insensitive)", () => {
    expect(bucketGameType("arcade")).toBe("arcade");
    expect(bucketGameType("Puzzle")).toBe("puzzle");
    expect(bucketGameType("  RACING ")).toBe("racing");
  });
  it("buckets unknown tags to 'other'", () => {
    expect(bucketGameType("multiplayer")).toBe("other");
    expect(bucketGameType("roguelike")).toBe("other");
    expect(bucketGameType("")).toBe("other");
    expect(bucketGameType("   ")).toBe("other");
  });
  it("presentChips lists only buckets present, in canonical order", () => {
    const games = [
      game({ addr: "0x1", gameType: "racing" }),
      game({ addr: "0x2", gameType: "arcade" }),
      game({ addr: "0x3", gameType: "weird" }), // → other
    ];
    // canonical order: arcade, ..., racing, ..., other
    expect(presentChips(games)).toEqual(["arcade", "racing", "other"]);
  });
  it("filterByChip filters by bucket; null is no-op", () => {
    const games = [
      game({ addr: "0x1", gameType: "racing" }),
      game({ addr: "0x2", gameType: "weird" }),
    ];
    expect(filterByChip(games, null)).toHaveLength(2);
    expect(filterByChip(games, "racing").map((g) => g.listing.address)).toEqual(["0x1"]);
    // unknown tag is reachable via the "other" chip
    expect(filterByChip(games, "other").map((g) => g.listing.address)).toEqual(["0x2"]);
  });
});

// ---- bounded activity merge (SPEC §7.1 item 5, §7.4) --------------------
describe("activity merge bounds", () => {
  it("activityGameSet picks ≤ N most-recently-active, excludes never-played", () => {
    const games = [
      game({ addr: "0x1", lastPlayedAt: 0 }), // never played → excluded
      game({ addr: "0x2", lastPlayedAt: 300 }),
      game({ addr: "0x3", lastPlayedAt: 100 }),
      game({ addr: "0x4", lastPlayedAt: 200 }),
    ];
    expect(activityGameSet(games, 2)).toEqual(["0x2", "0x4"]);
    // never-played excluded even when under the limit
    expect(activityGameSet(games, 10)).toEqual(["0x2", "0x4", "0x3"]);
  });

  it("mergeActivity interleaves newest-first and caps the feed", () => {
    const perGame = new Map<Address, ScoreEntry[]>([
      [A, [{ player: A, score: 5n, at: 300 }, { player: A, score: 4n, at: 100 }]],
      [B, [{ player: B, score: 9n, at: 250 }, { player: B, score: 1n, at: 150 }]],
    ]);
    const names = new Map<Address, string>([[A, "GameA"], [B, "GameB"]]);
    const merged = mergeActivity(perGame, names, 3);
    expect(merged).toHaveLength(3);
    expect(merged.map((m) => m.at)).toEqual([300, 250, 150]);
    expect(merged[0].gameName).toBe("GameA");
    expect(merged[1].gameName).toBe("GameB");
  });

  it("mergeActivity breaks ties deterministically by game address", () => {
    const perGame = new Map<Address, ScoreEntry[]>([
      [B, [{ player: B, score: 1n, at: 100 }]],
      [A, [{ player: A, score: 1n, at: 100 }]],
    ]);
    const merged = mergeActivity(perGame, new Map(), 10);
    // equal `at` → lower address first (A before B), regardless of insertion
    expect(merged.map((m) => m.game)).toEqual([A, B]);
  });
});

// ---- bounded-refresh merge (SPEC §7.4, §9.3) ----------------------------
describe("mergeStats", () => {
  const base = [
    game({ addr: "0x1", playCount: 1 }),
    game({ addr: "0x2", playCount: 2 }),
  ];
  it("swaps fresh stats in by address; missing games keep last-good", () => {
    const fresh = [{ ...base[0], stats: { ...base[0].stats, playCount: 99 } }];
    const merged = mergeStats(base, fresh);
    expect(merged[0].stats.playCount).toBe(99);
    expect(merged[1]).toBe(base[1]); // untouched reference = last-fetched
  });
  it("matches case-insensitively on address and preserves order", () => {
    // Fresh entry carries the same address in a different case — the match must
    // still apply (chain may return checksummed/upper H160).
    const fresh = [
      {
        ...base[1],
        listing: { ...base[1].listing, address: "0X2" as Address },
        stats: { ...base[1].stats, playCount: 50 },
      },
    ];
    const merged = mergeStats(base, fresh);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(base[0]); // untouched
    expect(merged[1].stats.playCount).toBe(50); // matched despite case diff
  });
});

// ---- score formatter (SPEC §4.2, all 3 formats) -------------------------
describe("score formatter", () => {
  const points: ScoreConfig = { scoreOrdering: 0, scoreFormat: 0, scoreUnit: "" };
  const ms: ScoreConfig = { scoreOrdering: 1, scoreFormat: 1, scoreUnit: "" };
  const unit: ScoreConfig = { scoreOrdering: 0, scoreFormat: 2, scoreUnit: "laps" };

  it("format 0 = integer points", () => {
    expect(formatScore(0n, points)).toBe("0");
    expect(formatScore(9001n, points)).toBe("9001");
  });

  it("format 1 = duration m:ss.mmm", () => {
    expect(formatScore(83456n, ms)).toBe("1:23.456");
    expect(formatScore(0n, ms)).toBe("0:00.000");
    expect(formatScore(605000n, ms)).toBe("10:05.000"); // > 1 minute, padded
    expect(formatScore(5n, ms)).toBe("0:00.005"); // sub-10ms padding
    expect(formatScore(59999n, ms)).toBe("0:59.999"); // just under a minute
    expect(formatScore(60000n, ms)).toBe("1:00.000"); // exactly a minute
    expect(formatScore(5400000n, ms)).toBe("90:00.000"); // unbounded minutes
  });

  it("format 2 = value + unit; empty unit falls back to bare value", () => {
    expect(formatScore(42n, unit)).toBe("42 laps");
    expect(formatScore(42n, { ...unit, scoreUnit: "" })).toBe("42");
    expect(formatScore(42n, { ...unit, scoreUnit: "  " })).toBe("42");
  });

  it("u128::MAX sentinel renders as a dash, never a giant number", () => {
    const MAX = (1n << 128n) - 1n;
    expect(formatScore(MAX, points)).toBe("—");
    expect(formatScore(MAX, ms)).toBe("—");
    expect(formatScore(MAX, unit)).toBe("—");
  });

  it("formatDuration clamps negatives", () => {
    expect(formatDuration(-5n)).toBe("0:00.000");
  });
});

// ---- playUrl → paseo.li (SPEC §7.5) -------------------------------------
describe("toLaunchUrl", () => {
  it("derives https://<label>.paseo.li from a bare .dot name", () => {
    expect(toLaunchUrl("arcade-snake.dot")).toBe("https://arcade-snake.paseo.li");
    expect(toLaunchUrl("snake.dot")).toBe("https://snake.paseo.li");
  });
  it("derives from a bare label", () => {
    expect(toLaunchUrl("snake")).toBe("https://snake.paseo.li");
  });
  it("heals a legacy dot.li URL to the paseo.li viewer (migration)", () => {
    expect(toLaunchUrl("https://time-trial.dot.li")).toBe("https://time-trial.paseo.li/");
    // Path/query are preserved when healing the host.
    expect(toLaunchUrl("https://snake.dot.li/play?x=1")).toBe("https://snake.paseo.li/play?x=1");
  });
  it("passes through a current paseo.li / other https URL unchanged", () => {
    expect(toLaunchUrl("https://time-trial.paseo.li")).toBe("https://time-trial.paseo.li/");
    expect(toLaunchUrl("https://example.com/play")).toBe("https://example.com/play");
  });
  it("preserves nested labels in a .dot name", () => {
    expect(toLaunchUrl("app.snake.dot")).toBe("https://app.snake.paseo.li");
  });
  it("rejects empty / whitespace / unlaunchable schemes", () => {
    expect(toLaunchUrl("")).toBeNull();
    expect(toLaunchUrl("   ")).toBeNull();
    expect(toLaunchUrl("dot://snake")).toBeNull();
    expect(toLaunchUrl("has space")).toBeNull();
  });
});

// ---- relative time (SPEC §7.2) ------------------------------------------
describe("relativeTime", () => {
  const NOW = 1_000_000; // unix seconds
  const nowMs = NOW * 1000;
  it("handles never / future", () => {
    expect(relativeTime(0, nowMs)).toBe("never");
    expect(relativeTime(NOW + 50, nowMs)).toBe("just now");
  });
  it("scales seconds → minutes → hours → days → months → years", () => {
    expect(relativeTime(NOW - 5, nowMs)).toBe("5s ago");
    expect(relativeTime(NOW - 120, nowMs)).toBe("2m ago");
    expect(relativeTime(NOW - 7200, nowMs)).toBe("2h ago");
    expect(relativeTime(NOW - 86400 * 3, nowMs)).toBe("3d ago");
    expect(relativeTime(NOW - 2592000 * 2, nowMs)).toBe("2mo ago");
    expect(relativeTime(NOW - 31536000 * 2, nowMs)).toBe("2y ago");
  });
});

// ---- address shortening (SPEC §8.2 fallback) ----------------------------
describe("shortAddress", () => {
  it("truncates 0x… addresses", () => {
    expect(shortAddress("0x1a82000000000000000000000000000000008e48")).toBe("0x1a82…8e48");
  });
  it("leaves non-addresses alone", () => {
    expect(shortAddress("alice")).toBe("alice");
  });
});
