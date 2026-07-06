// SPEC §10.3 step 8: read back the registry listing for this game + the game's
// arcadeVersion(), confirm they match what we registered, print the listing and
// a dashboard URL. Exits non-zero with an actionable message on any mismatch
// (SPEC §10.4 — no silent partial success).

import { readFileSync } from "node:fs";

import { createClient } from "polkadot-api";
import { getWsProvider } from "@polkadot-api/ws-provider";
import { createInkSdk } from "@polkadot-api/sdk-ink";

import {
  ASSET_HUB_WS,
  CDM_PATH,
  CONFIG_PATH,
  STATE_PATH,
  cdmTargetKey,
  emitSummary,
  jstr,
  suriSigner,
} from "./lib/chain.mjs";
import { loadConfig } from "./lib/config.mjs";
import { buildListingMetadata } from "./lib/listing.mjs";
import { readState } from "./lib/pipeline-state.mjs";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Placeholder dashboard URL: the dashboard (Phase 4) keys games by contract
// address. Until it has a public origin, surface a deterministic placeholder.
const DASHBOARD_BASE = process.env.ARCADE_DASHBOARD_URL || "https://arcade.dot.li";

async function main() {
  const summary = { step: "verify-listing", ok: false, checks: {} };

  const { config } = loadConfig(CONFIG_PATH);

  const cdm = readJson(CDM_PATH);
  const key = cdmTargetKey(cdm);
  const gcsEntry = cdm.contracts?.[key]?.["@arcade/gcs-reference"];
  const registryAddr = cdm.targets?.[key]?.registry;
  if (!gcsEntry?.address || !gcsEntry?.abi) {
    throw new Error("cdm.json has no deployed @arcade/gcs-reference. Run the deploy + register steps first.");
  }
  if (!registryAddr) {
    throw new Error("cdm.json target has no registry address to read the listing back from.");
  }
  const game = gcsEntry.address;

  // The registry is a deployed singleton the template never builds; its ABI
  // ships as data in cdm.json (like the dashboard's) so verify works on a
  // standalone clone with no contracts build output around.
  const registryAbi = cdm.contracts?.[key]?.["@arcade/registry"]?.abi;
  if (!registryAbi) {
    throw new Error("cdm.json is missing the @arcade/registry ABI entry.");
  }
  const expected = buildListingMetadata(config, readState(STATE_PATH).thumbnailCid ?? "");

  const origin = suriSigner().ss58;
  const client = createClient(getWsProvider([ASSET_HUB_WS]));
  try {
    await client.getChainSpecData();
    const inkSdk = createInkSdk(client, { atBest: true });
    const gcs = inkSdk.getContract({ abi: gcsEntry.abi }, game);
    const registry = inkSdk.getContract({ abi: registryAbi }, registryAddr);

    const query = async (contract, method, data = {}) => {
      const r = await contract.query(method, { origin, data });
      if (!r.success) throw new Error(`${method} query failed: ${jstr(r.value)}`);
      return r.value.response;
    };

    // 8a: conformance — arcadeVersion() must be 1 (SPEC §7.4 gate).
    const av = Number(await query(gcs, "arcadeVersion"));
    summary.checks.arcadeVersion = { value: av, pass: av === 1 };

    // 8b: the registry listing for this game.
    const listing = await query(registry, "getListing", { game });
    const isSome = listing?.isSome === true || listing?.success === true;
    const lv = listing?.value ?? listing;
    const m = lv?.meta ?? {};
    summary.checks.listingPresent = { pass: isSome };

    const fieldMatches = {
      name: m.name === expected.name,
      game_type: m.game_type === expected.game_type,
      short_description: m.short_description === expected.short_description,
      play_url: m.play_url === expected.play_url,
      thumbnail_cid: m.thumbnail_cid === expected.thumbnail_cid,
      requires_account: m.requires_account === expected.requires_account,
      extra_cid: m.extra_cid === expected.extra_cid,
    };
    const mismatches = Object.entries(fieldMatches)
      .filter(([, ok]) => !ok)
      .map(([f]) => `${f} (on-chain "${m[f]}" != expected "${expected[f]}")`);
    summary.checks.metaMatches = { pass: mismatches.length === 0, mismatches };

    summary.listing = {
      meta: m,
      metaVersion: lv?.meta_version != null ? Number(lv.meta_version) : null,
      registeredAt: lv?.registered_at != null ? Number(lv.registered_at) : null,
      updatedAt: lv?.updated_at != null ? Number(lv.updated_at) : null,
    };
    summary.playUrl = expected.play_url;
    summary.dashboardUrl = `${DASHBOARD_BASE}/game/${game}`;

    const allPass = Object.values(summary.checks).every((c) => c.pass === true);
    summary.ok = allPass;

    // Human-readable echo (the JSON block follows via emitSummary).
    console.log(`Listing for ${config.name} (${game}):`);
    console.log(`  arcadeVersion: ${av}  playUrl: ${expected.play_url}  thumbnailCid: ${expected.thumbnail_cid || "(none)"}`);
    console.log(`  dashboard: ${summary.dashboardUrl}`);
    if (!allPass) {
      const reasons = [];
      if (!summary.checks.arcadeVersion.pass) reasons.push(`arcadeVersion is ${av}, not 1 — the dashboard will skip this game (SPEC §7.4).`);
      if (!summary.checks.listingPresent.pass) reasons.push("registry.getListing returned None — did register-listing run and succeed?");
      if (!summary.checks.metaMatches.pass) reasons.push(`listing metadata differs from arcade.config.json: ${mismatches.join("; ")}.`);
      console.error(`✖ Verification FAILED:\n  - ${reasons.join("\n  - ")}`);
    }
  } finally {
    client.destroy();
  }

  emitSummary(summary);
}

main().catch((e) => {
  emitSummary({ step: "verify-listing", ok: false, error: e instanceof Error ? e.message : String(e) });
});
