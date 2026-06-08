import { describe, expect, it } from "vitest";
import type { ScoreEntry } from "../../src/scoreboard/api";
import { withPendingTop } from "../../src/scoreboard/Leaderboard";

// The in-game Top list must respect scoreOrdering (SPEC §4.2): higher-is-better
// genres (Snake, points) rank the LARGEST score first; lower-is-better genres
// (aim trainer = reaction ms, solitaire = moves) rank the SMALLEST first. A
// hardcoded descending sort silently inverts every lower-is-better board, which
// is why this is tested at the seam rather than left to a visual check.
const entry = (player: string, score: number): ScoreEntry => ({
  player: player as `0x${string}`,
  score,
  timestamp: 0,
});

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";

describe("Leaderboard top-list ordering (withPendingTop)", () => {
  const unsorted = [entry(A, 30), entry(B, 10), entry(C, 20)];

  it("ordering === 0 (higher is better): ranks the largest score first", () => {
    const ranked = withPendingTop(unsorted, null, 10, 0);
    expect(ranked.map((e) => e.score)).toEqual([30, 20, 10]);
  });

  it("ordering === 1 (lower is better): ranks the smallest score first", () => {
    const ranked = withPendingTop(unsorted, null, 10, 1);
    expect(ranked.map((e) => e.score)).toEqual([10, 20, 30]);
  });

  it("ordering === 1: optimistic upsert keeps the LOWER (better) personal best", () => {
    // Player A already on the board at 30; a freshly-played 12 is an improvement
    // under lower-is-better and must replace it (not be discarded as "smaller").
    const ranked = withPendingTop([entry(A, 30), entry(B, 25)], entry(A, 12), 10, 1);
    const a = ranked.find((e) => e.player === A);
    expect(a?.score).toBe(12);
    expect(ranked.map((e) => e.score)).toEqual([12, 25]);
  });

  it("ordering === 0: optimistic upsert keeps the HIGHER (better) personal best", () => {
    // A worse (lower) new score under higher-is-better must NOT displace the best.
    const ranked = withPendingTop([entry(A, 30), entry(B, 25)], entry(A, 12), 10, 0);
    const a = ranked.find((e) => e.player === A);
    expect(a?.score).toBe(30);
    expect(ranked.map((e) => e.score)).toEqual([30, 25]);
  });
});
