// SPEC §10.3 step 4 (the constructor-arg-bearing part the playground CLI can't
// do — see BUILD_PLAN item 4): deploy THIS game's own GCS reference contract
// instance and record its address in game-template/cdm.json.
//
// Constructor (SPEC §4.4): registry address (from cdm.json's target config) +
// scoreOrdering/scoreFormat/scoreUnit (from arcade.config.json). Deployer ==
// owner (ARCADE_SURI, default //Alice) so the same signer can later call
// updateListing (step 7). Adapted from contracts/scripts/deploy-and-verify.mjs.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "polkadot-api";
import { getWsProvider } from "@polkadot-api/ws-provider";
import { createInkSdk } from "@polkadot-api/sdk-ink";

import {
  ASSET_HUB_WS,
  CDM_PATH,
  CONFIG_PATH,
  CONTRACTS_TARGET,
  cdmTargetKey,
  emitSummary,
  ensureMapped,
  submitInBlock,
  suriSigner,
} from "./lib/chain.mjs";
import { loadConfig } from "./lib/config.mjs";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

async function main() {
  const summary = { step: "deploy-contract", ok: false };

  // Pure, fail-loud validation before any chain work.
  const { config, warnings } = loadConfig(CONFIG_PATH);
  warnings.forEach((w) => console.warn(`⚠ ${w}`));

  const cdm = readJson(CDM_PATH);
  const key = cdmTargetKey(cdm);
  const registry = cdm.targets?.[key]?.registry;
  if (!registry || !/^0x[0-9a-fA-F]{40}$/.test(registry)) {
    throw new Error(
      `cdm.json target "${key}" has no valid registry address. The Arcade Registry address ships as a dependency (SPEC §10.3); it is the constructor arg (SPEC §4.4).`,
    );
  }

  const gcsAbi = readJson(resolve(CONTRACTS_TARGET, "gcs-reference.release.abi.json"));
  const gcsCode = readFileSync(resolve(CONTRACTS_TARGET, "gcs-reference.release.polkavm"));

  const account = suriSigner();
  summary.signer = { suri: account.suri, ss58: account.ss58, h160: account.h160 };
  summary.registry = registry;
  summary.ctor = {
    score_ordering: config.contract.scoreOrdering,
    score_format: config.contract.scoreFormat,
    score_unit: config.contract.scoreUnit,
  };

  const client = createClient(getWsProvider([ASSET_HUB_WS]));
  try {
    await client.getChainSpecData();
    const inkSdk = createInkSdk(client, { atBest: true });

    summary.mapping = await ensureMapped(client, inkSdk, account);

    // sdk-ink 0.7.0 / polkadot-api 2.x: getDeployer takes raw code bytes
    // (Uint8Array); the 1.x `Binary.fromBytes` wrapper is gone.
    const deployer = inkSdk.getDeployer({ abi: gcsAbi }, new Uint8Array(gcsCode));
    const ctorData = {
      registry,
      score_ordering: config.contract.scoreOrdering,
      score_format: config.contract.scoreFormat,
      score_unit: config.contract.scoreUnit,
    };
    const dry = await deployer.dryRun("new", { origin: account.ss58, data: ctorData });
    if (!dry.success) {
      throw new Error(`gcs-reference deploy dry-run failed: ${JSON.stringify(dry.value)}`);
    }
    const address = dry.value.address;
    await submitInBlock(dry.value.deploy(), account.signer, "gcs-reference deploy");
    summary.address = address;

    // Write the deployed address + ABI back into game-template/cdm.json under
    // @arcade/gcs-reference (the name the frontend reads in gcs.ts).
    cdm.contracts[key]["@arcade/gcs-reference"] = {
      version: 0,
      address,
      abi: gcsAbi,
    };
    writeFileSync(CDM_PATH, `${JSON.stringify(cdm, null, 2)}\n`);
    summary.cdmJson = CDM_PATH;

    // Confirm it answers arcadeVersion()==1 (cheap conformance sanity).
    const gcs = inkSdk.getContract({ abi: gcsAbi }, address);
    const r = await gcs.query("arcadeVersion", { origin: account.ss58, data: {} });
    const av = r.success ? Number(r.value.response) : null;
    summary.arcadeVersion = av;
    if (av !== 1) {
      throw new Error(`Deployed contract returned arcadeVersion=${av}, expected 1.`);
    }

    summary.ok = true;
  } finally {
    client.destroy();
  }

  emitSummary(summary);
}

main().catch((e) => {
  emitSummary({ step: "deploy-contract", ok: false, error: e instanceof Error ? e.message : String(e) });
});
