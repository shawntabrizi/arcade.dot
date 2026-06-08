// LIVE READ SMOKE — host-free. Reads the deployed GCS contract over the real
// papi / sdk-ink stack (the same versions the app bundles) against Paseo Asset
// Hub. Confirms the read path works independent of any host — and that the
// `ReviveApi_trace_call` "Incompatible runtime entry" noise does NOT break
// reads. Exits non-zero on a failed/throwing read. Run: `npm run smoke:read`.
import { createClient } from "polkadot-api";
import { getWsProvider } from "@polkadot-api/ws-provider";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cdmPath = fileURLToPath(new URL("../cdm.json", import.meta.url));
const cdm = JSON.parse(readFileSync(cdmPath, "utf8"));
const target = Object.keys(cdm.contracts)[0];
const gcs = cdm.contracts[target]?.["@arcade/gcs-reference"];
const endpoint = cdm.targets[target]?.["asset-hub"];
// A pallet_revive-mapped origin (Alice) — an unmapped origin reverts dry-runs
// with AccountUnmapped. Reads are dry-runs; nothing is signed or paid.
const ORIGIN = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

if (!gcs?.address || !gcs?.abi || !endpoint) {
  console.error("smoke:read FAIL — cdm.json missing gcs-reference address/abi or endpoint");
  process.exit(1);
}

const client = createClient(getWsProvider(endpoint));
const ink = createInkSdk(client, { atBest: true });
const contract = ink.getContract({ abi: gcs.abi }, gcs.address);

async function q(method, data = {}) {
  const r = await contract.query(method, { origin: ORIGIN, data });
  if (!r.success) throw new Error(`${method} reverted: ${JSON.stringify(r.value)}`);
  return r.value.response;
}

try {
  const version = await q("arcadeVersion");
  const playCount = await q("playCount");
  const board = await q("getLeaderboard", { offset: 0, limit: 5 });
  console.log(`gcs ${gcs.address} @ ${endpoint}`);
  console.log(`arcadeVersion=${version} playCount=${playCount} leaderboardRows=${board.length}`);
  if (Number(version) !== 1) {
    console.error(`smoke:read FAIL — arcadeVersion ${version} != 1`);
    process.exit(1);
  }
  console.log("smoke:read PASS — live reads work over papi/sdk-ink");
  process.exit(0);
} catch (e) {
  console.error("smoke:read FAIL —", String(e).slice(0, 300));
  process.exit(1);
}
