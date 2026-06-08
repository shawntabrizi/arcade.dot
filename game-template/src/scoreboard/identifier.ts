// Pure product-identifier resolution — no host-api-wrapper import, so this is
// unit-testable in node without touching the host transport.
//
// dot.li's host (packages/shared/dotns-url.ts + container.ts) accepts a product
// identifier only when it `isProductIdentifier(id)` (ends ".dot", or is
// "localhost"/"localhost:PORT") OR equals "<deployed-label>.dot". Inside the
// deployed sandbox `window.location.host` is "<label>.app.dot.li" — which ends
// in ".dot.li", NOT ".dot" — so passing the raw host is rejected with
// DomainNotValid and the host returns no account. In dev the host IS the label
// ("localhost:5174"), so the raw host is correct there. Hence: use the raw host
// only when it's itself a valid identifier; otherwise fall back to the
// configured "<domain>.dot".

// Mirrors dotli isProductIdentifier + isDevPreviewLabel.
export function isHostUsableAsIdentifier(host: string): boolean {
  const n = host.trim().toLowerCase();
  return (
    n.endsWith(".dot") ||
    n === "localhost" ||
    n.startsWith("localhost:") ||
    n.endsWith(".webcontainer-api.io")
  );
}

// Pick the identifier to pass to getProductAccount/getProductAccountSigner.
// host: window.location.host (may be ""). configuredDotId: "<domain>.dot" from
// arcade.config.json. Returns the host verbatim in dev/.dot contexts, else the
// configured "<domain>.dot" (the value the deployed host validates against).
export function resolveProductIdentifier(host: string, configuredDotId?: string): string {
  if (host && isHostUsableAsIdentifier(host)) return host;
  if (configuredDotId) return configuredDotId;
  return host || "arcade-game.dot";
}
