// Deploy the Arcade Registry + GCS reference contracts to Paseo Asset Hub
// (paseo-next-v2) and verify them on-chain. BUILD_PLAN.md item 4.
//
// ESM. Must be run with node's module resolution rooted at game-template (which
// carries polkadot-api + @polkadot-api/sdk-ink + hdkd). The sibling
// run-deploy.sh wrapper does this. Reads built artifacts from contracts/target,
// deploys with //Alice (the deployer becomes the GCS owner), writes addresses
// into contracts/cdm.json, runs the §4/§5 verification reads/writes, and prints
// a machine-readable JSON summary between ===DEPLOY_SUMMARY_JSON=== markers.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, Binary } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider";
import { getPolkadotSigner } from "polkadot-api/signer";
import { createInkSdk, ss58ToEthereum } from "@polkadot-api/sdk-ink";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  parseSuri,
  ss58Address,
} from "@polkadot-labs/hdkd-helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSET_HUB_WS = "wss://paseo-asset-hub-next-rpc.polkadot.io";
// Anchor on the contracts dir. `CONTRACTS_DIR` env override lets this run from a
// copy placed in another package's tree (needed for node's ESM bare-specifier
// resolution); otherwise it's the parent of this script's scripts/ dir.
const CONTRACTS_DIR = process.env.CONTRACTS_DIR
  ? resolve(process.env.CONTRACTS_DIR)
  : resolve(__dirname, "..");
const TARGET = resolve(CONTRACTS_DIR, "target");
const CDM_PATH = resolve(CONTRACTS_DIR, "cdm.json");

// Stable target-hash key for cdm.json (matches the prototype's schema). Value is
// arbitrary so long as it's consistent across targets/dependencies/contracts.
const TARGET_HASH = "b7a87bf51613d89f";
const BULLETIN_GATEWAY = "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs";

function aliceSigner() {
  const { phrase, paths } = parseSuri("//Alice");
  const entropy = mnemonicToEntropy(phrase ?? DEV_PHRASE);
  const miniSecret = entropyToMiniSecret(entropy);
  const kp = sr25519CreateDerive(miniSecret)(paths ?? "");
  const ss58 = ss58Address(kp.publicKey);
  const signer = getPolkadotSigner(kp.publicKey, "Sr25519", kp.sign);
  return { signer, ss58, h160: ss58ToEthereum(ss58).asHex() };
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const jstr = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

// Resolve at best-block inclusion (same strategy as game-template tx.ts).
function submitInBlock(tx, signer, label) {
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

async function ensureMapped(client, inkSdk, account) {
  if (await inkSdk.addressIsMapped(account.ss58)) return "already-mapped";
  const api = client.getUnsafeApi();
  await submitInBlock(api.tx.Revive.map_account(), account.signer, "map_account");
  return "mapped-now";
}

async function deploy(inkSdk, abi, code, ctorData, origin, signer, label) {
  const deployer = inkSdk.getDeployer({ abi }, Binary.fromBytes(new Uint8Array(code)));
  const dry = await deployer.dryRun("new", { origin, data: ctorData });
  if (!dry.success) throw new Error(`${label} deploy dry-run failed: ${jstr(dry.value)}`);
  const address = dry.value.address;
  await submitInBlock(dry.value.deploy(), signer, `${label} deploy`);
  return address;
}

async function main() {
  const alice = aliceSigner();
  const summary = {
    network: ASSET_HUB_WS,
    signer: { suri: "//Alice", ss58: alice.ss58, h160: alice.h160 },
    deploy: {},
    verify: {},
  };

  const client = createClient(getWsProvider([ASSET_HUB_WS]));
  await client.getChainSpecData();
  const inkSdk = createInkSdk(client, { atBest: true });

  try {
    const registryAbi = readJson(resolve(TARGET, "registry.release.abi.json"));
    const gcsAbi = readJson(resolve(TARGET, "gcs-reference.release.abi.json"));
    const registryCode = readFileSync(resolve(TARGET, "registry.release.polkavm"));
    const gcsCode = readFileSync(resolve(TARGET, "gcs-reference.release.polkavm"));

    summary.mapping = await ensureMapped(client, inkSdk, alice);

    // step 1: registry (no ctor args)
    const registryAddr = await deploy(
      inkSdk, registryAbi, registryCode, {}, alice.ss58, alice.signer, "registry",
    );
    summary.deploy.registry = registryAddr;

    // step 2: gcs-reference (registry, ordering=0, format=0, unit="")
    const gcsAddr = await deploy(
      inkSdk, gcsAbi, gcsCode,
      { registry: registryAddr, score_ordering: 0, score_format: 0, score_unit: "" },
      alice.ss58, alice.signer, "gcs-reference",
    );
    summary.deploy.gcsReference = gcsAddr;

    // step 3: write cdm.json
    const cdm = {
      targets: {
        [TARGET_HASH]: {
          "asset-hub": ASSET_HUB_WS,
          bulletin: BULLETIN_GATEWAY,
          registry: registryAddr,
        },
      },
      dependencies: {
        [TARGET_HASH]: {
          "@arcade/registry": "latest",
          "@arcade/gcs-reference": "latest",
        },
      },
      contracts: {
        [TARGET_HASH]: {
          "@arcade/registry": { version: 0, address: registryAddr, abi: registryAbi },
          "@arcade/gcs-reference": { version: 0, address: gcsAddr, abi: gcsAbi },
        },
      },
    };
    writeFileSync(CDM_PATH, `${JSON.stringify(cdm, null, 2)}\n`);
    summary.cdmJson = CDM_PATH;

    // step 4: verify
    const registry = inkSdk.getContract({ abi: registryAbi }, registryAddr);
    const gcs = inkSdk.getContract({ abi: gcsAbi }, gcsAddr);
    const origin = alice.ss58;
    const query = async (contract, method, data = {}) => {
      const r = await contract.query(method, { origin, data });
      if (!r.success) throw new Error(`${method} query failed: ${jstr(r.value)}`);
      return r.value.response;
    };

    // 4a
    const gc0 = await query(registry, "gameCount");
    summary.verify.gameCountInitial = { value: Number(gc0), pass: Number(gc0) === 0 };

    // 4b
    const av = await query(gcs, "arcadeVersion");
    const so = await query(gcs, "scoreOrdering");
    summary.verify.arcadeVersion = { value: Number(av), pass: Number(av) === 1 };
    summary.verify.scoreOrdering = { value: Number(so), pass: Number(so) === 0 };

    // 4c: updateListing — THE cross-contract register test
    const meta = {
      name: "GCS Reference Test",
      game_type: "arcade",
      short_description: "On-chain verification of the GCS reference contract.",
      play_url: "test.dot",
      thumbnail_cid: "",
      requires_account: false,
      extra_cid: "",
    };
    const dryUpdate = await gcs.query("updateListing", { origin, data: { meta } });
    if (!dryUpdate.success) {
      summary.verify.updateListing = { pass: false, error: jstr(dryUpdate.value) };
      throw new Error(`updateListing dry-run FAILED: ${jstr(dryUpdate.value)}`);
    }
    await submitInBlock(dryUpdate.value.send(), alice.signer, "updateListing");
    summary.verify.updateListing = { pass: true };

    // 4d: gameCount==1, getListing matches
    const gc1 = await query(registry, "gameCount");
    const listing = await query(registry, "getListing", { game: gcsAddr });
    const opt = listing && typeof listing === "object" ? listing : {};
    const isSome = opt.isSome === true || opt.success === true;
    const lv = opt.value ?? opt;
    const m = lv?.meta ?? {};
    const metaMatches =
      m.name === meta.name &&
      m.game_type === meta.game_type &&
      m.short_description === meta.short_description &&
      m.play_url === meta.play_url &&
      m.thumbnail_cid === meta.thumbnail_cid &&
      m.requires_account === meta.requires_account &&
      m.extra_cid === meta.extra_cid;
    summary.verify.gameCountAfterUpdate = { value: Number(gc1), pass: Number(gc1) === 1 };
    summary.verify.getListing = {
      isSome,
      metaVersion: lv?.meta_version != null ? Number(lv.meta_version) : null,
      registeredAt: lv?.registered_at != null ? Number(lv.registered_at) : null,
      updatedAt: lv?.updated_at != null ? Number(lv.updated_at) : null,
      metaMatches,
      pass:
        isSome &&
        metaMatches &&
        Number(lv?.meta_version) === 1 &&
        Number(lv?.registered_at) > 0 &&
        Number(lv?.updated_at) > 0,
      raw: lv,
    };

    // 4e: submitScore(42); playCount==1, getBest(alice)==42, leaderboard entry
    const dryScore = await gcs.query("submitScore", { origin, data: { score: 42n } });
    if (!dryScore.success) {
      summary.verify.submitScore = { pass: false, error: jstr(dryScore.value) };
      throw new Error(`submitScore dry-run failed: ${jstr(dryScore.value)}`);
    }
    await submitInBlock(dryScore.value.send(), alice.signer, "submitScore");

    const pc = await query(gcs, "playCount");
    const best = await query(gcs, "getBest", { player: alice.h160 });
    const board = await query(gcs, "getLeaderboard", { offset: 0, limit: 10 });
    const boardArr = Array.isArray(board) ? board : [];
    const boardEntry = boardArr[0] ?? {};
    summary.verify.submitScore = { pass: true };
    summary.verify.playCount = { value: Number(pc), pass: Number(pc) === 1 };
    summary.verify.getBest = { value: Number(best), pass: Number(best) === 42 };
    summary.verify.leaderboard = {
      size: boardArr.length,
      entry: {
        player: boardEntry.player,
        score: boardEntry.score != null ? Number(boardEntry.score) : null,
        at: boardEntry.at != null ? Number(boardEntry.at) : null,
      },
      pass:
        boardArr.length === 1 &&
        String(boardEntry.player).toLowerCase() === alice.h160.toLowerCase() &&
        Number(boardEntry.score) === 42,
    };

    summary.allPass = Object.values(summary.verify).every((v) => v.pass === true);
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
    summary.allPass = false;
  } finally {
    client.destroy();
  }

  console.log("===DEPLOY_SUMMARY_JSON===");
  console.log(jstr(summary));
  console.log("===END_SUMMARY===");
  process.exitCode = summary.allPass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
