// Pure config loading + validation for arcade.config.json (SPEC §6.5, §10.3).
// No chain, no fs side effects beyond an explicit read in `loadConfig`. The
// validation is the testable core: the deploy pipeline must never half-run on
// a malformed config (SPEC §10.4 — fail loud).

import { readFileSync } from "node:fs";

// SPEC §5.1 byte caps for the on-chain ListingMetadata fields the config feeds.
export const CAPS = {
  name: 64,
  gameType: 32,
  shortDescription: 256,
  // playUrl/thumbnailCid are derived/produced downstream; their caps live in
  // listing.mjs where the values are assembled.
};

// SPEC §5.4 recommended vocabulary. Unknown tags are allowed (free string) but
// warned — the dashboard buckets them under "other".
export const KNOWN_GAME_TYPES = [
  "arcade",
  "puzzle",
  "racing",
  "strategy",
  "shooter",
  "card",
  "idle",
  "other",
];

// A .dot label: lowercase alphanumeric + hyphens, not leading/trailing hyphen.
// Matches what `playground deploy --domain` will accept; we validate early so
// the pipeline fails before any chain work rather than at publish time.
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function byteLen(s) {
  return new TextEncoder().encode(s).length;
}

/**
 * Validate a parsed arcade.config.json object. Returns { errors, warnings }.
 * `errors` non-empty ⇒ the config is unusable and the pipeline MUST stop.
 * `warnings` are advisory (e.g. unknown gameType, odd aspect handled elsewhere).
 */
export function validateConfig(cfg) {
  const errors = [];
  const warnings = [];

  if (cfg == null || typeof cfg !== "object") {
    return { errors: ["arcade.config.json must be a JSON object."], warnings };
  }

  const str = (key, cap) => {
    const v = cfg[key];
    if (typeof v !== "string" || v.length === 0) {
      errors.push(`"${key}" is required and must be a non-empty string.`);
      return;
    }
    if (cap != null && byteLen(v) > cap) {
      errors.push(`"${key}" is ${byteLen(v)} bytes; the on-chain cap is ${cap} (SPEC §5.1).`);
    }
  };

  str("name", CAPS.name);
  str("gameType", CAPS.gameType);
  str("shortDescription", CAPS.shortDescription);

  if (typeof cfg.gameType === "string" && !KNOWN_GAME_TYPES.includes(cfg.gameType)) {
    warnings.push(
      `gameType "${cfg.gameType}" is not in the recommended vocabulary (${KNOWN_GAME_TYPES.join(", ")}); the dashboard will bucket it under "other".`,
    );
  }

  if (typeof cfg.requiresAccount !== "boolean") {
    errors.push(`"requiresAccount" is required and must be a boolean.`);
  }

  if (typeof cfg.thumbnail !== "string" || cfg.thumbnail.length === 0) {
    errors.push(`"thumbnail" is required and must be a path to the thumbnail image.`);
  }

  if (typeof cfg.domain !== "string" || cfg.domain.length === 0) {
    errors.push(`"domain" is required (the .dot label used for playUrl, SPEC §10.3 step 2).`);
  } else if (!DOMAIN_RE.test(cfg.domain)) {
    errors.push(
      `"domain" ("${cfg.domain}") must be a valid .dot label: lowercase letters, digits and hyphens, no leading/trailing hyphen.`,
    );
  }

  const c = cfg.contract;
  if (c == null || typeof c !== "object") {
    errors.push(`"contract" is required (scoreOrdering, scoreFormat, scoreUnit).`);
  } else {
    if (c.scoreOrdering !== 0 && c.scoreOrdering !== 1) {
      errors.push(`"contract.scoreOrdering" must be 0 (higher better) or 1 (lower better) — SPEC §4.2.`);
    }
    if (c.scoreFormat !== 0 && c.scoreFormat !== 1 && c.scoreFormat !== 2) {
      errors.push(`"contract.scoreFormat" must be 0 (points), 1 (duration ms) or 2 (custom) — SPEC §4.2.`);
    }
    if (typeof c.scoreUnit !== "string") {
      errors.push(`"contract.scoreUnit" must be a string (empty unless scoreFormat == 2).`);
    } else if (c.scoreFormat !== 2 && c.scoreUnit !== "") {
      warnings.push(`"contract.scoreUnit" is ignored unless scoreFormat == 2; it will read as empty on-chain.`);
    } else if (c.scoreFormat === 2 && c.scoreUnit === "") {
      warnings.push(`"contract.scoreFormat" is 2 (custom) but "scoreUnit" is empty.`);
    }
  }

  return { errors, warnings };
}

/** Parse + validate; throws a single actionable error listing every problem. */
export function parseConfig(raw, sourceLabel = "arcade.config.json") {
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${sourceLabel} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { errors, warnings } = validateConfig(cfg);
  if (errors.length > 0) {
    throw new Error(`${sourceLabel} is invalid:\n  - ${errors.join("\n  - ")}`);
  }
  return { config: cfg, warnings };
}

/** Read + parse + validate from disk. */
export function loadConfig(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Could not read arcade.config.json at ${path}. The template must ship one (SPEC §6.5).`);
  }
  return parseConfig(raw, path);
}
