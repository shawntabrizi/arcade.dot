// The pipeline state file (.arcade-pipeline.json): a small, machine-written
// scratchpad recording outputs produced between pipeline steps (currently the
// uploaded thumbnail CID and its gateway URL). SPEC §6.5 / §10.3: no human —
// and no script — hand-edits configs; the CID is recorded here, not poked into
// arcade.config.json or cdm.json. cdm.json holds deployed addresses; this file
// holds off-chain artifacts the registration step needs.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const STATE_VERSION = 1;

/** Merge `patch` into the existing state (pure). Stamps the version. */
export function mergeState(existing, patch) {
  const base = existing && typeof existing === "object" ? existing : {};
  return { version: STATE_VERSION, ...base, ...patch };
}

/** Read the state file; returns {} when absent or unreadable/corrupt. */
export function readState(path) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Read, merge `patch`, write back. Returns the new state. */
export function updateState(path, patch) {
  const next = mergeState(readState(path), patch);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
