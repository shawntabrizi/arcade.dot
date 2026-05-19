import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  entropyToMiniSecret,
  generateMnemonic,
  mnemonicToEntropy,
  ss58Address,
} from "@polkadot-labs/hdkd-helpers";
import { ss58ToEthereum } from "@polkadot-api/sdk-ink";
import { getPolkadotSigner } from "polkadot-api/signer";
import type { PolkadotSigner } from "polkadot-api";

const MNEMONIC_KEY = "leaderboard-playground:burner-mnemonic";

interface Burner {
  signer: PolkadotSigner;
  ss58: string;
  // The H160 the leaderboard contract sees as `caller()` for this signer.
  h160: `0x${string}`;
}

let cached: Burner | null = null;

function ensureMnemonic(): string {
  const existing = localStorage.getItem(MNEMONIC_KEY);
  if (existing) return existing;
  const fresh = generateMnemonic(128);
  localStorage.setItem(MNEMONIC_KEY, fresh);
  return fresh;
}

function build(): Burner {
  const mnemonic = ensureMnemonic();
  const entropy = mnemonicToEntropy(mnemonic);
  const miniSecret = entropyToMiniSecret(entropy);
  const derive = sr25519CreateDerive(miniSecret);
  const keypair = derive("");
  const signer = getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign);
  const ss58 = ss58Address(keypair.publicKey);
  const h160 = ss58ToEthereum(ss58).asHex();
  return { signer, ss58, h160 };
}

function burner(): Burner {
  if (!cached) cached = build();
  return cached;
}

export function getBurnerSigner(): PolkadotSigner {
  return burner().signer;
}

export function getBurnerSs58(): string {
  return burner().ss58;
}

export function getBurnerH160(): `0x${string}` {
  return burner().h160;
}
