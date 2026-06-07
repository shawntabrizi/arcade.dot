import { describe, it, expect } from "vitest";
import { createFakeReads, SAMPLE_GAMES } from "./fake-reads";
import type { Address } from "./types";

// Exercises the injection seam itself so item 15's e2e can rely on it behaving
// like the chain impl (same ArcadeReads contract).
describe("fake reads seam", () => {
  const reads = createFakeReads(SAMPLE_GAMES);

  it("lists only conformant fixture games (§7.4 gate hides the ghost)", async () => {
    const conformantCount = SAMPLE_GAMES.filter(
      (f) => f.arcadeVersion === undefined,
    ).length;
    const listed = await reads.listGames();
    expect(listed.length).toBe(conformantCount);
    // The non-conformant ghost (arcadeVersion === null) is filtered out.
    expect(listed.length).toBeLessThan(SAMPLE_GAMES.length);
    expect(
      listed.some((g) => g.listing.name.startsWith("Ghost")),
    ).toBe(false);
  });
  it("getGame is address-case-insensitive; unknown → null", async () => {
    const addr = SAMPLE_GAMES[0].game.listing.address;
    expect((await reads.getGame(addr.toUpperCase() as Address))?.listing.name).toBe(
      SAMPLE_GAMES[0].game.listing.name,
    );
    expect(await reads.getGame("0x0000000000000000000000000000000000000000")).toBeNull();
  });
  it("paginates leaderboard / recent via offset+limit", async () => {
    const addr = SAMPLE_GAMES[0].game.listing.address;
    const page = await reads.getLeaderboard(addr, 0, 1);
    expect(page).toHaveLength(1);
    expect(await reads.getLeaderboard(addr, 99, 10)).toHaveLength(0);
  });
  it("resolveName uses the fixture name map, else truncates", async () => {
    const named = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
    expect(await reads.resolveName(named)).toBe("alice.dot");
    const unnamed = "0x9999999999999999999999999999999999999999" as Address;
    expect(await reads.resolveName(unnamed)).toBe("0x9999…9999");
  });
});
