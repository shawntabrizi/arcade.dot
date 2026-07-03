import { describe, it, expect } from "vitest";
import { anonAlias, displayName } from "./logic";
import type { Address } from "./types";

// Player display abstracts the wallet address (SPEC §8.2): a resolved DotNS
// name shows as the bare username; everything else falls back to a friendly
// alias — the raw 0x address is NEVER shown.

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;

describe("displayName", () => {
  it("strips the .dot suffix from a resolved DotNS name", () => {
    expect(displayName(A, "alice.dot")).toBe("alice");
    expect(displayName(A, "Bob.DOT")).toBe("Bob"); // case-insensitive suffix
  });

  it("preserves sub-labels within a .dot name", () => {
    expect(displayName(A, "app.alice.dot")).toBe("app.alice");
  });

  it("never shows the raw address when unmapped (truncated fallback)", () => {
    const out = displayName(B, "0x2222…2222");
    expect(out).not.toContain("0x");
    expect(out).toBe(anonAlias(B));
  });

  it("never shows the raw address before resolution lands (undefined)", () => {
    expect(displayName(B, undefined)).toBe(anonAlias(B));
    expect(displayName(B, undefined)).not.toContain("0x");
  });
});

describe("anonAlias", () => {
  it("is deterministic per address and contains no hex", () => {
    expect(anonAlias(A)).toBe(anonAlias(A));
    expect(anonAlias(A)).not.toContain("0x");
    expect(anonAlias(A)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ #[0-9A-Z]{4}$/);
  });

  it("differs across distinct addresses", () => {
    expect(anonAlias(A)).not.toBe(anonAlias(B));
  });

  it("keeps the deterministic suffix distinct for nearby hash collisions", () => {
    const C = "0x0000000000000000000000000000000000000001" as Address;
    const D = "0x0000000000000000000000000000000000000089" as Address;
    expect(anonAlias(C).replace(/ #[0-9A-Z]{4}$/, "")).toBe(
      anonAlias(D).replace(/ #[0-9A-Z]{4}$/, ""),
    );
    expect(anonAlias(C)).not.toBe(anonAlias(D));
  });
});
