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

// The host faucet URL prefilled with an address. Per the host funding model the
// faucet takes the account's SS58 (not its H160). Opened in-host via navigateTo
// (faucet.dot is itself a host app), with a new-tab web fallback.
export function faucetUrl(ss58: string): string {
  return `https://faucet.dot.li/?address=${encodeURIComponent(ss58)}`;
}

// Human-readable product-account derivation path (display only). The host
// derives the product account from the user's root account (kept private by the
// host) as soft junctions: product / <identifier> / <index>.
export function derivationPath(identifier: string, index: number): string {
  return `product / ${identifier} / ${index}`;
}
