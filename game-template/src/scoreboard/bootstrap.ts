import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  parseSuri,
} from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner } from "polkadot-api/signer";
import type { PolkadotClient, PolkadotSigner } from "polkadot-api";
import type { InkSdk } from "@polkadot-api/sdk-ink";
import { submitInBlock } from "./tx";

// Plancks transferred from the faucet to each fresh burner. Has to cover the
// burner's Revive.map_account fee plus enough submit_score txs to be useful.
// Native token decimals on Asset Hub Paseo are 10; this is ~1 PAS.
const FUND_PLANCKS = 10_000_000_000n;

const READY_KEY = "leaderboard-playground:burner-ready";

function faucetSigner(): PolkadotSigner {
  const suri = import.meta.env.VITE_FAUCET_SURI ?? "//Alice";
  const { phrase, paths } = parseSuri(suri);
  const mnemonic = phrase ?? DEV_PHRASE;
  const entropy = mnemonicToEntropy(mnemonic);
  const miniSecret = entropyToMiniSecret(entropy);
  const derive = sr25519CreateDerive(miniSecret);
  const kp = derive(paths ?? "");
  return getPolkadotSigner(kp.publicKey, "Sr25519", kp.sign);
}

interface Burner {
  signer: PolkadotSigner;
  ss58: string;
}

let inFlight: Promise<void> | null = null;

export function ensureBurnerReady(
  client: PolkadotClient,
  inkSdk: InkSdk,
  burner: Burner,
): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run(client, inkSdk, burner).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(
  client: PolkadotClient,
  inkSdk: InkSdk,
  burner: Burner,
): Promise<void> {
  if (localStorage.getItem(READY_KEY) === burner.ss58) return;

  if (await inkSdk.addressIsMapped(burner.ss58)) {
    localStorage.setItem(READY_KEY, burner.ss58);
    return;
  }

  // Untyped because we don't ship the Paseo Asset Hub descriptors as a
  // direct dependency. Both extrinsics are stable on AH-Paseo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = client.getUnsafeApi() as any;

  // Resolve at best-block inclusion rather than finalization (see tx.ts).
  // map_account depends on the funds landing first, so these stay sequential.
  await submitInBlock(
    api.tx.Balances.transfer_keep_alive({
      dest: { type: "Id", value: burner.ss58 },
      value: FUND_PLANCKS,
    }),
    faucetSigner(),
  );

  await submitInBlock(api.tx.Revive.map_account(), burner.signer);

  localStorage.setItem(READY_KEY, burner.ss58);
}
