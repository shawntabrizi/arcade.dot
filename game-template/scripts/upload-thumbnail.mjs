// SPEC §10.3 step 5: upload the configured thumbnail to the Bulletin Chain,
// get its CID, and record it in .arcade-pipeline.json (NOT hand-edited into a
// config — SPEC §6.5). Validates §6.4: ≤ 256 KiB (hard), 16:9-ish (warn only).
//
// Bulletin mechanism: bulletin-deploy's `storeFile` (the same TransactionStorage
// store the playground CLI uses) over our own paseo-next-v2 client, with
// authorization granted via bulletin-deploy's `ensureAuthorized` (on this
// testnet //Alice is the authorizer; ARCADE_SURI is authorized to store). CID
// is content-addressed (raw codec + SHA2-256, V1) and fetchable at the gateway.

import { readFileSync } from "node:fs";

import { createClient, Binary } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider";
import { createCID } from "bulletin-deploy/deploy";
import { ensureAuthorized } from "bulletin-deploy";

import {
  BULLETIN_GATEWAY,
  BULLETIN_WS,
  CONFIG_PATH,
  STATE_PATH,
  emitSummary,
  submitInBlock,
  suriSigner,
} from "./lib/chain.mjs";
import { loadConfig } from "./lib/config.mjs";
import { updateState } from "./lib/pipeline-state.mjs";
import { resolve, dirname } from "node:path";

const MAX_BYTES = 256 * 1024; // SPEC §6.4
const ASPECT_TARGET = 16 / 9;
const ASPECT_TOLERANCE = 0.15; // ±15% counts as "16:9-ish"
const BULLETIN_HEARTBEAT_MS = 300_000; // long store can exceed PAPI's 40s default

// Parse intrinsic dimensions from a PNG/JPEG/WebP header. Returns null if the
// format isn't recognized (we then skip the aspect check, never fail on it).
function imageSize(buf) {
  // PNG: 8-byte sig, then IHDR with width/height as big-endian u32 at 16/20.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: scan SOFn markers.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + len;
    }
  }
  // WebP (VP8X): 'RIFF'....'WEBP', VP8X has 24-bit width-1/height-1 at 0x18.
  if (
    buf.length >= 30 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP" &&
    buf.toString("ascii", 12, 16) === "VP8X"
  ) {
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width: w, height: h };
  }
  return null;
}

async function main() {
  const summary = { step: "upload-thumbnail", ok: false };

  const { config, warnings } = loadConfig(CONFIG_PATH);
  warnings.forEach((w) => console.warn(`⚠ ${w}`));

  const thumbPath = resolve(dirname(CONFIG_PATH), config.thumbnail);
  let bytes;
  try {
    bytes = readFileSync(thumbPath);
  } catch {
    throw new Error(
      `Thumbnail not found at ${thumbPath} (arcade.config.json "thumbnail": "${config.thumbnail}"). Generate one (SPEC §6.4, 16:9 ~640×360) before uploading.`,
    );
  }

  summary.thumbnail = { path: thumbPath, bytes: bytes.length };
  if (bytes.length > MAX_BYTES) {
    throw new Error(
      `Thumbnail is ${(bytes.length / 1024).toFixed(1)} KiB; the §6.4 cap is 256 KiB. Re-export smaller.`,
    );
  }

  const size = imageSize(bytes);
  if (size) {
    summary.thumbnail.width = size.width;
    summary.thumbnail.height = size.height;
    const aspect = size.width / size.height;
    if (Math.abs(aspect - ASPECT_TARGET) / ASPECT_TARGET > ASPECT_TOLERANCE) {
      console.warn(
        `⚠ Thumbnail is ${size.width}×${size.height} (aspect ${aspect.toFixed(2)}); SPEC §6.4 recommends 16:9 (~1.78). Uploading anyway.`,
      );
    }
  } else {
    console.warn("⚠ Could not read thumbnail dimensions; skipping the 16:9 check (SPEC §6.4 warns, never fails, on aspect).");
  }

  const account = suriSigner();
  summary.signer = { suri: account.suri, ss58: account.ss58 };

  // Content-addressed CID: raw codec (0x55) + SHA2-256, V1 — the config the
  // chain stores under via store_with_cid_config (matches bulletin-deploy /
  // playground CLI). createCID is reused from bulletin-deploy so our CID and
  // the chain's agree; the store tx is built + submitted with game-template's
  // own PAPI client (bulletin-deploy 0.8.3's bundled tx watcher is incompatible
  // with this polkadot-api version's dispatch decoding — submitInBlock is the
  // proven path here, same as the deploy step).
  const cid = createCID(new Uint8Array(bytes)).toString();
  summary.cid = cid;

  const client = createClient(
    getWsProvider([BULLETIN_WS], { heartbeatTimeout: BULLETIN_HEARTBEAT_MS }),
  );
  try {
    await client.getChainSpecData();
    const unsafeApi = client.getUnsafeApi();

    // Authorize the storing account (on this testnet //Alice grants it).
    await ensureAuthorized(unsafeApi, account.ss58, `ARCADE_SURI (${account.suri})`);

    const tx = unsafeApi.tx.TransactionStorage.store_with_cid_config({
      cid: { codec: 85n, hashing: { type: "Sha2_256", value: undefined } },
      data: Binary.fromBytes(new Uint8Array(bytes)),
    });
    await submitInBlock(tx, account.signer, "TransactionStorage.store");
    summary.gatewayUrl = `${BULLETIN_GATEWAY}${cid}`;

    updateState(STATE_PATH, {
      thumbnailCid: cid,
      thumbnailGatewayUrl: summary.gatewayUrl,
      thumbnailBytes: bytes.length,
    });
    summary.stateFile = STATE_PATH;
    summary.ok = true;
  } finally {
    client.destroy();
  }

  emitSummary(summary);
}

main().catch((e) => {
  emitSummary({ step: "upload-thumbnail", ok: false, error: e instanceof Error ? e.message : String(e) });
});
