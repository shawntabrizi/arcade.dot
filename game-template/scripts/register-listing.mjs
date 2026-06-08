// SPEC §10.3 step 7: register the listing by calling THIS game's GCS contract
// `updateListing(meta)` (which cross-contract-calls registry.register, SPEC
// §4.4). meta is assembled from arcade.config.json + the thumbnail CID recorded
// by step 5 (.arcade-pipeline.json) + playUrl = https://<domain>.dot.li. Signed
// with ARCADE_SURI — which MUST be the deployer/owner (the updateListing gate).

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
  ensureMapped,
  jstr,
  submitInBlock,
  suriSigner,
} from "./lib/chain.mjs";
import { loadConfig } from "./lib/config.mjs";
import { buildListingMetadata } from "./lib/listing.mjs";
import { readState } from "./lib/pipeline-state.mjs";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

async function main() {
  const summary = { step: "register-listing", ok: false };

  const { config, warnings } = loadConfig(CONFIG_PATH);
  warnings.forEach((w) => console.warn(`⚠ ${w}`));

  const cdm = readJson(CDM_PATH);
  const key = cdmTargetKey(cdm);
  const gcsEntry = cdm.contracts?.[key]?.["@arcade/gcs-reference"];
  if (!gcsEntry?.address || !gcsEntry?.abi) {
    throw new Error(
      "cdm.json has no deployed @arcade/gcs-reference (address + abi). Run `npm run arcade:deploy-contract` first (SPEC §10.3 step 4).",
    );
  }

  // The thumbnail CID is optional (SPEC §5.1: thumbnailCid may be empty), but
  // warn if step 5 hasn't run so the agent knows the listing will have no image.
  const state = readState(STATE_PATH);
  const thumbnailCid = typeof state.thumbnailCid === "string" ? state.thumbnailCid : "";
  if (!thumbnailCid) {
    console.warn("⚠ No thumbnailCid in .arcade-pipeline.json — registering with an empty thumbnail. Run `npm run arcade:upload-thumbnail` first to include an image.");
  }

  const meta = buildListingMetadata(config, thumbnailCid);
  summary.meta = meta;
  summary.contract = gcsEntry.address;

  const account = suriSigner();
  summary.signer = { suri: account.suri, ss58: account.ss58, h160: account.h160 };

  const client = createClient(getWsProvider([ASSET_HUB_WS]));
  try {
    await client.getChainSpecData();
    const inkSdk = createInkSdk(client, { atBest: true });
    summary.mapping = await ensureMapped(client, inkSdk, account);

    const gcs = inkSdk.getContract({ abi: gcsEntry.abi }, gcsEntry.address);
    const dry = await gcs.query("updateListing", { origin: account.ss58, data: { meta } });
    if (!dry.success) {
      throw new Error(
        `updateListing dry-run failed (is ARCADE_SURI the deployer/owner? SPEC §4.4 gates on caller==owner): ${jstr(dry.value)}`,
      );
    }
    await submitInBlock(dry.value.send(), account.signer, "updateListing");
    summary.ok = true;
  } finally {
    client.destroy();
  }

  emitSummary(summary);
}

main().catch((e) => {
  emitSummary({ step: "register-listing", ok: false, error: e instanceof Error ? e.message : String(e) });
});
