import { describe, it, expect } from "vitest";
import {
  isHostUsableAsIdentifier,
  resolveProductIdentifier,
} from "../../src/scoreboard/identifier";

// Guards Fix #2: the deployed sandbox host "<label>.app.dot.li" must NOT be
// passed verbatim (dot.li rejects it with DomainNotValid); it must fall back to
// the configured "<domain>.dot". Dev hosts (localhost:PORT) and ".dot" origins
// are valid identifiers and pass through unchanged.
describe("isHostUsableAsIdentifier (mirrors dot.li acceptance)", () => {
  it("accepts .dot, localhost, localhost:PORT, webcontainer previews", () => {
    expect(isHostUsableAsIdentifier("arcade-snake.dot")).toBe(true);
    expect(isHostUsableAsIdentifier("localhost")).toBe(true);
    expect(isHostUsableAsIdentifier("localhost:5174")).toBe(true);
    expect(isHostUsableAsIdentifier("abc--5173.local.webcontainer-api.io")).toBe(true);
  });

  it("rejects the deployed sandbox host (ends .dot.li, not .dot)", () => {
    expect(isHostUsableAsIdentifier("arcade-snake.app.dot.li")).toBe(false);
    expect(isHostUsableAsIdentifier("arcade-snake.dot.li")).toBe(false);
  });
});

describe("resolveProductIdentifier", () => {
  it("uses <domain>.dot in the deployed sandbox (the bug we hit)", () => {
    expect(
      resolveProductIdentifier("arcade-snake.app.dot.li", "arcade-snake.dot"),
    ).toBe("arcade-snake.dot");
  });

  it("uses the raw host verbatim in dev (localhost:PORT)", () => {
    expect(resolveProductIdentifier("localhost:5174", "arcade-snake.dot")).toBe(
      "localhost:5174",
    );
  });

  it("passes through a .dot origin unchanged", () => {
    expect(resolveProductIdentifier("arcade-snake.dot", "arcade-snake.dot")).toBe(
      "arcade-snake.dot",
    );
  });

  it("falls back to the configured id when there is no window host", () => {
    expect(resolveProductIdentifier("", "arcade-snake.dot")).toBe("arcade-snake.dot");
  });
});
