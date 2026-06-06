// SPEC §10.3: the full pipeline glue the CLI doesn't provide. Runs, in order:
//   arcade:deploy-contract  (step 4)
//   arcade:upload-thumbnail (step 5)
//   [manual] playground deploy ... (step 6 — frontend → Bulletin + .dot name)
//   arcade:register         (step 7)
//   arcade:verify           (step 8)
// Step 6 (frontend publish) stays a documented manual/agent step: it needs the
// developer's playground session (QR-logged phone or dev signer) which this
// non-interactive script must not impersonate. We print the EXACT command,
// with the --domain from arcade.config.json, then continue to register/verify.
//
// Every sub-step exits non-zero on failure (SPEC §10.4); this runner stops at
// the first failure and exits non-zero too — no silent partial ship.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { CONFIG_PATH } from "./lib/chain.mjs";
import { loadConfig } from "./lib/config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(scriptFile, label) {
  console.log(`\n── ${label} ───────────────────────────────────────────────`);
  const r = spawnSync(process.execPath, [resolve(__dirname, scriptFile)], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`\n✖ ${label} failed (exit ${r.status}). Pipeline aborted — fix the above and re-run.`);
    process.exit(r.status || 1);
  }
}

const { config } = loadConfig(CONFIG_PATH);

run("deploy-contract.mjs", "Step 4 — deploy game contract");
run("upload-thumbnail.mjs", "Step 5 — upload thumbnail to Bulletin");

console.log(`
── Step 6 — publish the frontend (MANUAL, needs your playground session) ──────
Build the app and publish it to Bulletin + a .dot name. This step signs with
your playground session (from \`playground init\`), so run it yourself:

    npm run build
    playground deploy --signer phone --domain ${config.domain} --buildDir dist --playground

(Use \`--signer dev\` instead of \`--signer phone\` if you deploy with a dev key.)
The registered playUrl is https://${config.domain}.dot.li — make sure --domain
matches arcade.config.json "domain" or the Play button will 404.

Press Enter has no effect here; this runner now continues to registration. If
you have not published the frontend yet, the listing will point at a domain
that is not live until you do.
──────────────────────────────────────────────────────────────────────────────
`);

run("register-listing.mjs", "Step 7 — register the listing");
run("verify-listing.mjs", "Step 8 — verify");

console.log("\n✔ Pipeline complete. The game is listed (pending the manual frontend publish in step 6 if you skipped it).");
