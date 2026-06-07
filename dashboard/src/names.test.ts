import { describe, it, expect, vi } from "vitest";
import { createFakeReads, SAMPLE_GAMES } from "./fake-reads";
import { shortAddress } from "./logic";
import type { FakeReverseResolver } from "./fake-reads";
import type { Address } from "./types";

// Item 14 — DotNS reverse name resolution + identicon/truncation fallback
// (SPEC §8.2). The chain impl calls DotnsReverseResolver.nameOf(h160); these
// tests inject a FAKE reverse-resolver (no real RPC/DotNS) and assert the
// resolve/fallback/cache contract the UI depends on.

const NAMED = "0x1111111111111111111111111111111111111111" as Address;
const EMPTY = "0x2222222222222222222222222222222222222222" as Address;
const REVERT = "0x3333333333333333333333333333333333333333" as Address;

describe("resolveName via DotNS reverse resolver (SPEC §8.2)", () => {
  it("returns the DotNS name on a hit", async () => {
    const resolver: FakeReverseResolver = (p) =>
      p.toLowerCase() === NAMED.toLowerCase() ? "alice.dot" : "";
    const reads = createFakeReads(SAMPLE_GAMES, resolver);
    expect(await reads.resolveName(NAMED)).toBe("alice.dot");
  });

  it("falls back to the truncated address on an empty (fail-closed) result", async () => {
    // nameOf returns "" when the address no longer owns the name (§8.2).
    const reads = createFakeReads(SAMPLE_GAMES, () => "");
    expect(await reads.resolveName(EMPTY)).toBe(shortAddress(EMPTY));
  });

  it("falls back to the truncated address on a revert / RPC error", async () => {
    const reads = createFakeReads(SAMPLE_GAMES, (p) => {
      if (p.toLowerCase() === REVERT.toLowerCase()) throw new Error("execution reverted");
      return "";
    });
    expect(await reads.resolveName(REVERT)).toBe(shortAddress(REVERT));
  });

  it("caches per session — a second lookup never re-invokes the resolver", async () => {
    const resolver = vi.fn<FakeReverseResolver>(() => "alice.dot");
    const reads = createFakeReads(SAMPLE_GAMES, resolver);
    expect(await reads.resolveName(NAMED)).toBe("alice.dot");
    expect(await reads.resolveName(NAMED)).toBe("alice.dot");
    expect(resolver).toHaveBeenCalledTimes(1); // hit served from cache
  });

  it("caches the fallback too — a revert is not retried every render", async () => {
    const resolver = vi.fn<FakeReverseResolver>(() => {
      throw new Error("reverted");
    });
    const reads = createFakeReads(SAMPLE_GAMES, resolver);
    const first = await reads.resolveName(REVERT);
    const second = await reads.resolveName(REVERT);
    expect(first).toBe(shortAddress(REVERT));
    expect(second).toBe(first);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
