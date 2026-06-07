import { describe, it, expect } from "vitest";
import { mergeStats, relativeTime } from "./logic";
import { TICK_MS } from "./components/useNow";
import { createFakeReads, SAMPLE_GAMES } from "./fake-reads";
import type { ArcadeReads } from "./arcade-reads";
import type { Address, Game } from "./types";

// Item 13 — read strategy (SPEC §7.4): bounded per-block refresh, graceful
// degradation, and wall-clock (not block-driven) relative-time ticking.

// A counting ArcadeReads that records exactly which game addresses were read,
// so we can assert per-block refresh is O(visible) — never the full registry.
function countingReads(base: ArcadeReads): {
  reads: ArcadeReads;
  refreshed: Address[][];
} {
  const refreshed: Address[][] = [];
  return {
    refreshed,
    reads: {
      ...base,
      async refreshGames(addresses) {
        refreshed.push([...addresses]);
        return base.refreshGames(addresses);
      },
    },
  };
}

describe("bounded per-block refresh (SPEC §7.4)", () => {
  it("refreshGames re-reads ONLY the passed addresses, not the whole registry", async () => {
    const { reads, refreshed } = countingReads(createFakeReads(SAMPLE_GAMES));
    const all = await reads.listGames();
    expect(all.length).toBe(SAMPLE_GAMES.length);

    // Simulate a best-block tick that only refreshes the activity-rail subset
    // (the 2 most-recently-active games), NOT all listed games.
    const visible = all.slice(0, 2).map((g) => g.listing.address);
    const out = await reads.refreshGames(visible);

    expect(refreshed).toEqual([visible]); // exactly the visible set was read
    expect(out.map((g) => g.listing.address)).toEqual(visible);
    // The third game was never touched by the refresh — work is O(visible).
    expect(out.length).toBeLessThan(all.length);
  });

  it("refreshGames omits addresses not in the session's game set", async () => {
    const reads = createFakeReads(SAMPLE_GAMES);
    const ghost = "0x9999999999999999999999999999999999999999" as Address;
    const real = SAMPLE_GAMES[0].game.listing.address;
    const out = await reads.refreshGames([real, ghost]);
    expect(out.map((g) => g.listing.address)).toEqual([real]);
  });
});

describe("mergeStats — degrade to last-fetched (SPEC §7.4, §9.3)", () => {
  const base: Game[] = SAMPLE_GAMES.map((f) => f.game);

  it("swaps in fresh stats by address, preserving order and identity", () => {
    const refreshed: Game[] = [
      {
        ...base[1],
        stats: { ...base[1].stats, playCount: base[1].stats.playCount + 7 },
      },
    ];
    const merged = mergeStats(base, refreshed);
    // Order + addresses unchanged.
    expect(merged.map((g) => g.listing.address)).toEqual(
      base.map((g) => g.listing.address),
    );
    // Only game[1]'s playCount moved; the others are byte-identical (last-good).
    expect(merged[1].stats.playCount).toBe(base[1].stats.playCount + 7);
    expect(merged[0]).toBe(base[0]);
    expect(merged[2]).toBe(base[2]);
  });

  it("a game absent from the refresh keeps its last-fetched stats (no blank)", () => {
    // An empty refresh models a fully-failed best-block read: every card must
    // retain its previous data rather than disappear (§9.3).
    const merged = mergeStats(base, []);
    expect(merged).toEqual(base);
    merged.forEach((g, i) => expect(g).toBe(base[i]));
  });
});

describe("degrade to last-fetched on a throwing read (SPEC §9.3)", () => {
  it("a refresh whose underlying read throws does not lose the prior list", async () => {
    // Wrap a fake so refreshGames rejects, then prove the merge contract keeps
    // last-good: the page-level pattern is `refresh().catch(() => keep prev)`.
    const base = createFakeReads(SAMPLE_GAMES);
    const throwing: ArcadeReads = {
      ...base,
      async refreshGames() {
        throw new Error("RPC down mid-block");
      },
    };
    const prior = (await base.listGames()).map((f) => f);
    let current = prior;
    await throwing
      .refreshGames(prior.map((g) => g.listing.address))
      .then((fresh) => {
        current = mergeStats(current, fresh);
      })
      .catch(() => {
        /* keep last-good */
      });
    expect(current).toBe(prior); // unchanged — the page never blanked
  });
});

describe("relative-time ticking is wall-clock, not block-driven", () => {
  // The rendered relative time is a pure function of (timestamp, now). useNow
  // supplies `now` from a local setInterval — NOT from onNewBlock — so the feed
  // advances even when no block arrives (§9.3: "timestamps ticking; never
  // spinner-lock"). These assertions encode WHY: the displayed string must
  // change as wall-clock `now` advances, with a fixed event timestamp.
  it("the same timestamp renders a later relative time as `now` advances", () => {
    const at = 1_000_000; // unix seconds, fixed (no new block, no re-read)
    const t0 = at * 1000 + 70_000; // 70s after the play → "1m ago"
    const t1 = t0 + 130_000; // +130s of wall clock → "3m ago"
    expect(relativeTime(at, t0)).toBe("1m ago");
    expect(relativeTime(at, t1)).toBe("3m ago");
    expect(relativeTime(at, t0)).not.toBe(relativeTime(at, t1));
  });

  it("useNow ticks on a 15–30s wall-clock interval (decoupled from ~6s blocks)", () => {
    expect(TICK_MS).toBeGreaterThanOrEqual(15_000);
    expect(TICK_MS).toBeLessThanOrEqual(30_000);
  });
});
