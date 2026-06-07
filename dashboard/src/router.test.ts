import { describe, it, expect } from "vitest";
import { parseHash, gameHref, homeHref } from "./router";

describe("hash router", () => {
  it("parses home for empty / root / unknown", () => {
    expect(parseHash("")).toEqual({ name: "home" });
    expect(parseHash("#/")).toEqual({ name: "home" });
    expect(parseHash("#/garbage")).toEqual({ name: "home" });
  });
  it("parses a game route keyed by address (lowercased)", () => {
    const addr = "0x16db2b8598303758d9c37e1dae24b76b3641bf99";
    expect(parseHash(`#/game/${addr}`)).toEqual({ name: "game", address: addr });
    // uppercase input is normalized so deep-links match the cache key
    expect(parseHash(`#/game/${addr.toUpperCase()}`)).toEqual({
      name: "game",
      address: addr,
    });
  });
  it("rejects malformed addresses (falls back to home)", () => {
    expect(parseHash("#/game/0x123")).toEqual({ name: "home" });
    expect(parseHash("#/game/not-an-address")).toEqual({ name: "home" });
  });
  it("builds hrefs", () => {
    expect(homeHref()).toBe("#/");
    expect(gameHref("0xabc" as `0x${string}`)).toBe("#/game/0xabc");
  });
});
