import { describe, it, expect } from "vitest";
import { placeholderDataUri } from "./placeholder";

describe("placeholder thumbnail (SPEC §6.4)", () => {
  const a1 = "0x1111111111111111111111111111111111111111";
  const a2 = "0x2222222222222222222222222222222222222222";

  it("is deterministic for a given address", () => {
    expect(placeholderDataUri(a1)).toBe(placeholderDataUri(a1));
  });
  it("differs between addresses", () => {
    expect(placeholderDataUri(a1)).not.toBe(placeholderDataUri(a2));
  });
  it("is a self-contained svg data URI (cannot fail to load)", () => {
    const uri = placeholderDataUri(a1);
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(uri)).toContain("<svg");
  });
  it("is case-insensitive on the address", () => {
    expect(placeholderDataUri(a1.toUpperCase())).toBe(placeholderDataUri(a1));
  });
});
