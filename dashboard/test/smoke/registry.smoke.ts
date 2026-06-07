// LIVE smoke test — hits Paseo Asset Hub over a real websocket. Excluded from
// the hermetic `npm test` (network + slow); run with `npm run test:smoke`.
//
// Why this exists: the unit + e2e suites use fake reads, so they all stay green
// even when the REAL chain path is broken. A live-chain bug (the dashboard's
// read origin was unmapped on pallet_revive → every read reverted with
// AccountUnmapped → "No conforming games") shipped undetected until someone
// opened the app. This test exercises the actual createChainReads() path —
// real READ_ORIGIN, real ABIs, real endpoint from cdm.json — so that class of
// regression fails CI instead of the demo.
import { afterAll, describe, expect, it } from "vitest";
import { createChainReads, closeChainReads } from "../../src/chain-reads";

// The live demo game registered on paseo-next-v2 (BUILD_PLAN item 8).
const SNAKE = "0x5d38af8b84c06d26113d94b596ccca99f2078acc";

describe("live registry smoke (paseo-next-v2)", () => {
  afterAll(() => closeChainReads());

  it("reads conformant games from the live registry", async () => {
    const reads = createChainReads();
    const games = await reads.listGames();

    // The core regression guard: an unmapped/wrong origin makes every read
    // revert, so listGames() comes back empty. A non-empty result means the
    // read origin works AND the conformance gate (arcadeVersion()==1) passed.
    expect(games.length).toBeGreaterThan(0);

    // Concrete anchor: the deployed Snake listing must be discoverable.
    const snake = games.find(
      (g) => g.listing.address.toLowerCase() === SNAKE.toLowerCase(),
    );
    expect(snake, "Snake listing not found in live registry").toBeDefined();
    expect(snake!.listing.name).toBe("Snake");
    expect(snake!.listing.playUrl).toContain("arcade-snake");

    // NOTE: resolveName() is intentionally NOT exercised here. On paseo-next-v2
    // the DotNS reverse resolver (0xa691…) is not found by sdk-ink, which emits
    // a background (floating) "Contract not found" rejection that no local
    // try/catch can trap. resolveName() still returns the truncated-address
    // fallback (verified in unit tests), so the dashboard is correct, but this
    // live test must not assert on a known-absent contract. See BUILD_PLAN
    // "DotNS resolver" note.
  }, 60_000);
});
