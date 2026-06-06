import { beforeEach, describe, expect, it } from "vitest";
import type { ScoreEntry, ScoreOrdering } from "../../src/scoreboard/api";
import type { ChainGateway, GuestStore } from "../../src/scoreboard/gateway";
import {
  Scoreboard,
  isWorthKeeping,
  readGuestBest,
  writeGuestBest,
} from "../../src/scoreboard/scoreboard";

// ── Fakes (the narrow seam; NEVER the real product-sdk) ─────────────────────

class FakeStore implements GuestStore {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

interface FakeGatewayState {
  connectCalls: number;
  mappedCalls: number;
  submits: number[];
}

function fakeGateway(opts: {
  ordering?: ScoreOrdering;
  // Pre-connected player (signed in from the start), or null for guest.
  player?: `0x${string}` | null;
  // On-chain best for getBest(player); per-address map.
  bests?: Record<string, number | null>;
  // If true, connect() flips to this player.
  connectsTo?: `0x${string}`;
}) {
  const state: FakeGatewayState = { connectCalls: 0, mappedCalls: 0, submits: [] };
  let player = opts.player ?? null;
  const bests = opts.bests ?? {};
  const gateway: ChainGateway = {
    async scoreOrdering() {
      return opts.ordering ?? 0;
    },
    currentPlayer() {
      return player;
    },
    async connect() {
      state.connectCalls++;
      player = opts.connectsTo ?? ("0x00000000000000000000000000000000000000aa" as `0x${string}`);
      return player;
    },
    async ensureMapped() {
      state.mappedCalls++;
    },
    async submitScore(score: number) {
      state.submits.push(score);
    },
    async getLeaderboard(): Promise<ScoreEntry[]> {
      return [];
    },
    async getRecent(): Promise<ScoreEntry[]> {
      return [];
    },
    async getBest(p) {
      return bests[p.toLowerCase()] ?? null;
    },
  };
  return { gateway, state };
}

const GAME_KEY = "0xdeadbeef";

describe("isWorthKeeping (SPEC §4.2 scoreOrdering)", () => {
  it("any score is worth keeping when there is no known best", () => {
    expect(isWorthKeeping(1, null, 0)).toBe(true);
    expect(isWorthKeeping(999, null, 1)).toBe(true);
  });

  it("higher-is-better (0): only strictly higher beats the best", () => {
    expect(isWorthKeeping(11, 10, 0)).toBe(true);
    expect(isWorthKeeping(10, 10, 0)).toBe(false); // ties are not improvements
    expect(isWorthKeeping(9, 10, 0)).toBe(false);
  });

  it("lower-is-better (1): only strictly lower beats the best", () => {
    expect(isWorthKeeping(9, 10, 1)).toBe(true);
    expect(isWorthKeeping(10, 10, 1)).toBe(false);
    expect(isWorthKeeping(11, 10, 1)).toBe(false);
  });
});

describe("guest score holding / restore (SPEC §8.3)", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it("persists and restores a guest best across reads", () => {
    expect(readGuestBest(store, GAME_KEY)).toBeNull();
    writeGuestBest(store, GAME_KEY, 42);
    expect(readGuestBest(store, GAME_KEY)).toBe(42);
  });

  it("keys per game so two games on one origin don't collide", () => {
    writeGuestBest(store, "gameA", 5);
    writeGuestBest(store, "gameB", 7);
    expect(readGuestBest(store, "gameA")).toBe(5);
    expect(readGuestBest(store, "gameB")).toBe(7);
  });

  it("a guest's worth-keeping score is held in the store after game over", async () => {
    const { gateway } = fakeGateway({ ordering: 0 });
    const sb = new Scoreboard(gateway, store, { gameKey: GAME_KEY });
    await sb.onGameEnd(30);
    expect(readGuestBest(store, GAME_KEY)).toBe(30);
    expect(sb.heldScore()).toBe(30);
  });
});

describe("prompt-trigger conditions (SPEC §8.3)", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it("guest + first score → prompt, no chain interaction", async () => {
    const { gateway, state } = fakeGateway({ ordering: 0 });
    const sb = new Scoreboard(gateway, store, { gameKey: GAME_KEY });
    const out = await sb.onGameEnd(10);
    expect(out).toEqual({ kind: "prompt", score: 10 });
    expect(state.connectCalls).toBe(0);
    expect(state.submits).toEqual([]);
  });

  it("guest + non-improving score → ignored, no prompt, no chain", async () => {
    const { gateway, state } = fakeGateway({ ordering: 0 });
    const sb = new Scoreboard(gateway, store, { gameKey: GAME_KEY });
    writeGuestBest(store, GAME_KEY, 50);
    const out = await sb.onGameEnd(40);
    expect(out).toEqual({ kind: "ignored", score: 40 });
    expect(state.submits).toEqual([]);
    expect(sb.heldScore()).toBeNull();
  });

  it("lower-is-better: a faster (lower) guest score prompts", async () => {
    const { gateway } = fakeGateway({ ordering: 1 });
    const sb = new Scoreboard(gateway, store, { gameKey: GAME_KEY });
    writeGuestBest(store, GAME_KEY, 100);
    expect((await sb.onGameEnd(80)).kind).toBe("prompt");
    // and a slower one does not
    const sb2 = new Scoreboard(fakeGateway({ ordering: 1 }).gateway, store, { gameKey: GAME_KEY });
    expect((await sb2.onGameEnd(120)).kind).toBe("ignored");
  });
});

describe("signed-in vs guest branching", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it("signed-in player submits directly on game over, no prompt", async () => {
    const player = "0x00000000000000000000000000000000000000bb" as `0x${string}`;
    const { gateway, state } = fakeGateway({ ordering: 0, player });
    const sb = new Scoreboard(gateway, store, { gameKey: GAME_KEY });
    const out = await sb.onGameEnd(77);
    expect(out).toEqual({ kind: "submitted", score: 77 });
    expect(state.mappedCalls).toBe(1);
    expect(state.submits).toEqual([77]);
  });

  it("signed-in player submits even a non-improving score (every play counts)", async () => {
    const player = "0x00000000000000000000000000000000000000bb" as `0x${string}`;
    const { gateway, state } = fakeGateway({
      ordering: 0,
      player,
      bests: { [player.toLowerCase()]: 500 },
    });
    const sb = new Scoreboard(gateway, store, { gameKey: GAME_KEY });
    const out = await sb.onGameEnd(10); // worse than 500
    expect(out.kind).toBe("submitted");
    expect(state.submits).toEqual([10]); // still submitted (SPEC §4.2)
  });
});

describe("submit-once semantics (SPEC §10.4)", () => {
  it("one onGameEnd (signed-in) → exactly one submitScore", async () => {
    const player = "0x00000000000000000000000000000000000000bb" as `0x${string}`;
    const { gateway, state } = fakeGateway({ ordering: 0, player });
    const sb = new Scoreboard(gateway, new FakeStore(), { gameKey: GAME_KEY });
    await sb.onGameEnd(5);
    expect(state.submits.length).toBe(1);
  });

  it("guest onGameEnd does NOT submit; saveHeldScore submits exactly once", async () => {
    const store = new FakeStore();
    const { gateway, state } = fakeGateway({ ordering: 0 });
    const sb = new Scoreboard(gateway, store, { gameKey: GAME_KEY });
    await sb.onGameEnd(60); // prompt, no submit
    expect(state.submits).toEqual([]);

    await sb.saveHeldScore(); // accept the nudge
    expect(state.connectCalls).toBe(1);
    expect(state.mappedCalls).toBe(1);
    expect(state.submits).toEqual([60]);

    // Clears the hold + guest store so a second save is a no-op.
    await sb.saveHeldScore();
    expect(state.submits).toEqual([60]);
    expect(readGuestBest(store, GAME_KEY)).toBeNull();
  });
});

describe("requiresAccount gating (SPEC §8.3)", () => {
  it("gatesAtLaunch when set and not signed in", () => {
    const { gateway } = fakeGateway({ ordering: 0 });
    const sb = new Scoreboard(gateway, new FakeStore(), {
      gameKey: GAME_KEY,
      requiresAccount: true,
    });
    expect(sb.gatesAtLaunch()).toBe(true);
  });

  it("does not gate once signed in", () => {
    const player = "0x00000000000000000000000000000000000000bb" as `0x${string}`;
    const { gateway } = fakeGateway({ ordering: 0, player });
    const sb = new Scoreboard(gateway, new FakeStore(), {
      gameKey: GAME_KEY,
      requiresAccount: true,
    });
    expect(sb.gatesAtLaunch()).toBe(false);
  });

  it("never gates when requiresAccount is unset (guest mode default)", () => {
    const { gateway } = fakeGateway({ ordering: 0 });
    const sb = new Scoreboard(gateway, new FakeStore(), { gameKey: GAME_KEY });
    expect(sb.requiresAccount).toBe(false);
    expect(sb.gatesAtLaunch()).toBe(false);
  });
});
