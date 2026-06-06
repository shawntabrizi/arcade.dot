import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The pure pipeline core (SPEC §6.5 / §10.3). No chain, no SDK — the chain
// wiring (scripts/lib/chain.mjs and the deploy/register/verify scripts) is the
// thin seam these never import, mirroring the scoreboard layer's ChainGateway.
import { parseConfig, validateConfig } from "../../scripts/lib/config.mjs";
import { buildListingMetadata, playUrlFor, META_CAPS } from "../../scripts/lib/listing.mjs";
import { mergeState, readState, updateState, STATE_VERSION } from "../../scripts/lib/pipeline-state.mjs";

const goodConfig = {
  name: "Snake",
  gameType: "arcade",
  shortDescription: "Classic Snake.",
  requiresAccount: false,
  thumbnail: "assets/thumbnail.png",
  domain: "arcade-snake",
  contract: { scoreOrdering: 0, scoreFormat: 0, scoreUnit: "" },
};

describe("config validation (SPEC §5.1 / §6.5)", () => {
  it("accepts the shipped Snake config with no errors", () => {
    const { errors, warnings } = validateConfig(goodConfig);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("rejects a missing required field — the pipeline must not half-run (§10.4)", () => {
    const { errors } = validateConfig({ ...goodConfig, name: "" });
    expect(errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("enforces the §5.1 name byte cap so the registry never reverts mid-deploy", () => {
    const { errors } = validateConfig({ ...goodConfig, name: "x".repeat(65) });
    expect(errors.some((e) => e.includes("name") && e.includes("64"))).toBe(true);
  });

  it("counts UTF-8 bytes, not characters, against the cap (multibyte names)", () => {
    // 33 emoji × 4 bytes = 132 bytes > 32-byte gameType cap, but only 33 chars.
    const { errors } = validateConfig({ ...goodConfig, gameType: "😀".repeat(33) });
    expect(errors.some((e) => e.includes("game") || e.includes("gameType"))).toBe(true);
  });

  it("warns (does not error) on an unknown gameType — registry takes free tags (§5.4)", () => {
    const { errors, warnings } = validateConfig({ ...goodConfig, gameType: "roguelike" });
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("roguelike"))).toBe(true);
  });

  it("rejects an invalid .dot domain label (the playUrl source, §10.3 step 2)", () => {
    expect(validateConfig({ ...goodConfig, domain: "-bad" }).errors.length).toBeGreaterThan(0);
    expect(validateConfig({ ...goodConfig, domain: "BAD" }).errors.length).toBeGreaterThan(0);
    expect(validateConfig({ ...goodConfig, domain: "ok-1" }).errors).toEqual([]);
  });

  it("rejects out-of-range contract score params (§4.2)", () => {
    expect(validateConfig({ ...goodConfig, contract: { scoreOrdering: 2, scoreFormat: 0, scoreUnit: "" } }).errors.length).toBeGreaterThan(0);
    expect(validateConfig({ ...goodConfig, contract: { scoreOrdering: 0, scoreFormat: 9, scoreUnit: "" } }).errors.length).toBeGreaterThan(0);
  });

  it("parseConfig throws one actionable error aggregating every problem", () => {
    const raw = JSON.stringify({ ...goodConfig, name: "", domain: "-x" });
    expect(() => parseConfig(raw)).toThrow(/invalid/i);
  });

  it("parseConfig surfaces malformed JSON distinctly", () => {
    expect(() => parseConfig("{ not json")).toThrow(/not valid JSON/i);
  });
});

describe("ListingMetadata assembly (SPEC §4.4 / §5.1)", () => {
  it("derives playUrl as https://<domain>.dot.li (amended §7.5/§6.2)", () => {
    expect(playUrlFor("arcade-snake")).toBe("https://arcade-snake.dot.li");
  });

  it("maps config fields to the snake_case ABI tuple with empty extra_cid (v1)", () => {
    const meta = buildListingMetadata(goodConfig, "bafyTHUMB");
    expect(meta).toEqual({
      name: "Snake",
      game_type: "arcade",
      short_description: "Classic Snake.",
      play_url: "https://arcade-snake.dot.li",
      thumbnail_cid: "bafyTHUMB",
      requires_account: false,
      extra_cid: "",
    });
  });

  it("allows an empty thumbnail CID (§5.1: thumbnailCid may be empty)", () => {
    expect(buildListingMetadata(goodConfig).thumbnail_cid).toBe("");
    expect(buildListingMetadata(goodConfig, "").thumbnail_cid).toBe("");
  });

  it("carries requiresAccount through to the on-chain flag (§7.2 badge / §8.3 gate)", () => {
    expect(buildListingMetadata({ ...goodConfig, requiresAccount: true }).requires_account).toBe(true);
  });

  it("throws if an assembled field would exceed its byte cap — the registry would revert (§5.1)", () => {
    const longCid = "Q".repeat(META_CAPS.thumbnail_cid + 1);
    expect(() => buildListingMetadata(goodConfig, longCid)).toThrow(/byte caps/);
  });
});

describe("pipeline state round-trip (.arcade-pipeline.json)", () => {
  it("mergeState stamps the version and overlays the patch", () => {
    const s = mergeState({ thumbnailCid: "old" }, { thumbnailCid: "new", gatewayUrl: "u" });
    expect(s).toEqual({ version: STATE_VERSION, thumbnailCid: "new", gatewayUrl: "u" });
  });

  it("readState returns {} when the file is absent", () => {
    const p = join(mkdtempSync(join(tmpdir(), "arcade-")), "state.json");
    expect(readState(p)).toEqual({});
  });

  it("updateState writes, then readState reads it back identically", () => {
    const p = join(mkdtempSync(join(tmpdir(), "arcade-")), ".arcade-pipeline.json");
    const written = updateState(p, { thumbnailCid: "bafyXYZ" });
    expect(written.thumbnailCid).toBe("bafyXYZ");
    expect(readState(p)).toEqual(written);
    // A second update merges rather than clobbers.
    const merged = updateState(p, { thumbnailGatewayUrl: "https://gw/bafyXYZ" });
    expect(merged.thumbnailCid).toBe("bafyXYZ");
    expect(merged.thumbnailGatewayUrl).toBe("https://gw/bafyXYZ");
    // File ends with a trailing newline (clean diffs).
    expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
  });

  it("readState tolerates a corrupt file (returns {} rather than throwing)", () => {
    const p = join(mkdtempSync(join(tmpdir(), "arcade-")), "bad.json");
    updateState(p, { ok: true });
    // overwrite with garbage
    writeFileSync(p, "{ broken");
    expect(readState(p)).toEqual({});
  });
});

describe("shipped arcade.config.json is valid", () => {
  it("the real file parses and validates clean", () => {
    const raw = readFileSync(new URL("../../arcade.config.json", import.meta.url), "utf8");
    const { config, warnings } = parseConfig(raw);
    expect(config.name).toBe("Snake");
    expect(warnings).toEqual([]);
  });
});
