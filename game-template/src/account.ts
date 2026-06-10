// Pure helpers for the Account tab (SPEC §8.1 identity). No host/chain imports
// so they're unit-testable in isolation; the host/chain reads live behind the
// ChainGateway seam (scoreboard/gateway.ts → sdk-gateway.ts).

// Format a planck (smallest-unit) balance for display, e.g. 12_345_678_901n at
// 10 decimals → "1.2346". Trims to `maxFrac` fractional digits and strips
// trailing zeros; whole-number balances show no decimal point.
export function formatBalance(planck: bigint, decimals: number, maxFrac = 4): string {
  if (decimals <= 0) return planck.toString();
  const base = 10n ** BigInt(decimals);
  const whole = planck / base;
  const frac = planck % base;
  if (frac === 0n) return whole.toString();
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFrac)
    .replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

// Faucet link, prefilled with the account's SS58. The host faucet (faucet.dot,
// which would fund THIS exact chain) isn't deployed yet, so point at the public
// Polkadot testnet faucet as a stopgap. Query params per
// paritytech/polkadot-testnet-faucet (client/README): network + parachain +
// address. Our games run on "Paseo Asset Hub Next" — parachain 1500 in the
// faucet's Paseo list (added in faucet PR #512), NOT 1000 (the standard Asset
// Hub, a different chain whose drips our accounts would never see). It's an
// external site (not a .dot app), so the UI opens it with a normal
// target=_blank link, not navigateTo.
export const FAUCET_PARACHAIN_ID = 1500;
export function faucetUrl(ss58: string): string {
  const q = new URLSearchParams({
    network: "paseo",
    parachain: String(FAUCET_PARACHAIN_ID),
    address: ss58,
  });
  return `https://faucet.polkadot.io/?${q.toString()}`;
}

// SURI-style product-account derivation path (display only). The host derives
// the product account from the user's seed via three sr25519 SOFT junctions —
// product / <dotNS id> / <index> — so single slashes ("/", soft), NOT "//"
// (hard). Soft derivation is composable on the public key, which is how the host
// derives the address without the seed. See product-sdk keys/product-account.ts
// (HDKD.publicSoft) and the Polkadot wiki on derivation paths.
export function derivationPath(identifier: string, index: number): string {
  return `<seed>/product/${identifier}/${index}`;
}
