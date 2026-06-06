// Pure assembly of the §5.1 ListingMetadata from arcade.config.json + the
// thumbnail CID. This is the value the game contract's `updateListing` forwards
// verbatim to the registry (SPEC §4.4 / §10.3 step 7). No chain, no I/O — the
// testable core for byte caps and playUrl derivation.

// SPEC §5.1 byte caps for every ListingMetadata string field.
export const META_CAPS = {
  name: 64,
  game_type: 32,
  short_description: 256,
  play_url: 256,
  thumbnail_cid: 128,
  extra_cid: 128,
};

function byteLen(s) {
  return new TextEncoder().encode(s).length;
}

/**
 * Derive the playUrl from the .dot domain label. SPEC §10.3 step 7 says
 * `playUrl = <domain>.dot`; amended SPEC §7.5/§6.2 launch via the dot.li
 * gateway means the registered, dashboard-launchable URL is
 * `https://<domain>.dot.li`. We store the launchable https form so the
 * dashboard's plain-anchor Play button (§7.5 spike) works verbatim.
 */
export function playUrlFor(domain) {
  if (typeof domain !== "string" || domain.length === 0) {
    throw new Error("Cannot derive playUrl: domain is missing.");
  }
  return `https://${domain}.dot.li`;
}

/**
 * Build the ListingMetadata tuple (snake_case keys — the on-chain ABI field
 * names, see contracts/target/*.abi.json). `thumbnailCid` may be empty (SPEC
 * §5.1: thumbnailCid may be empty; image failure must never break a card §6.4).
 * Throws if any field exceeds its byte cap — the registry would revert (§5.1),
 * so we fail loud here before any chain work (§10.4).
 */
export function buildListingMetadata(config, thumbnailCid = "") {
  const meta = {
    name: config.name,
    game_type: config.gameType,
    short_description: config.shortDescription,
    play_url: playUrlFor(config.domain),
    thumbnail_cid: thumbnailCid ?? "",
    requires_account: config.requiresAccount === true,
    extra_cid: "", // SPEC §6.3 extraCid is [Post-MVP]; always empty in v1.
  };

  const tooLong = [];
  for (const [field, cap] of Object.entries(META_CAPS)) {
    const v = meta[field];
    if (typeof v === "string" && byteLen(v) > cap) {
      tooLong.push(`${field} is ${byteLen(v)} bytes, cap ${cap}`);
    }
  }
  if (tooLong.length > 0) {
    throw new Error(`ListingMetadata exceeds §5.1 byte caps:\n  - ${tooLong.join("\n  - ")}`);
  }

  return meta;
}
