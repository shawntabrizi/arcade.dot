// Thin chain seam shared by the deploy/register/verify scripts. Holds the
// PAPI + sdk-ink + hdkd wiring (adapted from contracts/scripts/
// deploy-and-verify.mjs, the working PAPI deploy pattern). Pure logic lives in
// config.mjs / listing.mjs / pipeline-state.mjs and is unit-tested without this
// module. Nothing here is imported by the unit tests.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getPolkadotSigner } from "polkadot-api/signer";
import { ss58ToEthereum } from "@polkadot-api/sdk-ink";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  parseSuri,
  ss58Address,
} from "@polkadot-labs/hdkd-helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo layout: game-template/scripts/lib/chain.mjs → game-template/ is two up.
export const TEMPLATE_DIR = resolve(__dirname, "..", "..");
export const CONTRACTS_DIR = resolve(TEMPLATE_DIR, "..", "contracts");
export const CONFIG_PATH = resolve(TEMPLATE_DIR, "arcade.config.json");
export const CDM_PATH = resolve(TEMPLATE_DIR, "cdm.json");
export const STATE_PATH = resolve(TEMPLATE_DIR, ".arcade-pipeline.json");
export const CONTRACTS_TARGET = resolve(CONTRACTS_DIR, "target");

// SPEC §10.5: paseo-next-v2.
export const ASSET_HUB_WS = "wss://paseo-asset-hub-next-rpc.polkadot.io";
export const BULLETIN_WS = "wss://paseo-bulletin-next-rpc.polkadot.io";
export const BULLETIN_GATEWAY = "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/";

// The deployer/owner SURI. SPEC §10.3: steps 4–7 sign with the SAME account
// (deployer == owner for the updateListing gate). ARCADE_SURI overrides the
// //Alice default used end-to-end against the testnet.
export function arcadeSuri() {
  return process.env.ARCADE_SURI && process.env.ARCADE_SURI.length > 0
    ? process.env.ARCADE_SURI
    : "//Alice";
}

/** Build a signer from a SURI (sr25519). Returns { suri, signer, ss58, h160 }. */
export function suriSigner(suri = arcadeSuri()) {
  const { phrase, paths } = parseSuri(suri);
  const entropy = mnemonicToEntropy(phrase ?? DEV_PHRASE);
  const miniSecret = entropyToMiniSecret(entropy);
  const kp = sr25519CreateDerive(miniSecret)(paths ?? "");
  const ss58 = ss58Address(kp.publicKey);
  const signer = getPolkadotSigner(kp.publicKey, "Sr25519", kp.sign);
  return { suri, signer, ss58, h160: ss58ToEthereum(ss58).asHex() };
}

export const jstr = (v) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

/**
 * Submit a PAPI tx and resolve at best-block inclusion (matches the template's
 * sdk-gateway / the contracts deploy script). Rejects on revert or error.
 */
export function submitInBlock(tx, signer, label) {
  return new Promise((res, rej) => {
    let settled = false;
    let sub;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      queueMicrotask(() => sub?.unsubscribe());
      fn();
    };
    sub = tx.signSubmitAndWatch(signer).subscribe({
      next: (event) => {
        const included =
          (event.type === "txBestBlocksState" && event.found === true) ||
          event.type === "finalized";
        if (!included) return;
        if (event.ok === false) {
          finish(() => rej(new Error(`${label} reverted: ${jstr(event.dispatchError)}`)));
        } else {
          finish(() => res({ txHash: event.txHash }));
        }
      },
      error: (err) => finish(() => rej(err)),
    });
  });
}

/** Idempotent pallet_revive mapping for the signer's SS58 (SPEC §8.1). */
export async function ensureMapped(client, inkSdk, account) {
  if (await inkSdk.addressIsMapped(account.ss58)) return "already-mapped";
  const api = client.getUnsafeApi();
  await submitInBlock(api.tx.Revive.map_account(), account.signer, "map_account");
  return "mapped-now";
}

/** Read the single target-hash key present in a cdm.json object. */
export function cdmTargetKey(cdm) {
  const keys = Object.keys(cdm?.contracts ?? {});
  if (keys.length === 0) throw new Error("cdm.json has no contracts target key.");
  return keys[0];
}

/** Print a machine-readable JSON block and set the exit code. */
export function emitSummary(summary) {
  console.log("===ARCADE_PIPELINE_JSON===");
  console.log(jstr(summary));
  console.log("===END_SUMMARY===");
  process.exitCode = summary.ok === true ? 0 : 1;
}
