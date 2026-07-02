// Game thumbnail (SPEC §6.4). Tries the Bulletin/IPFS gateways in order; on an
// empty CID or a fetch/decode failure, falls back to the deterministic
// address-derived key art (which sets the game's name in type when provided)
// so an image failure NEVER breaks a card.

import { useState } from "react";
import { thumbnailGateways } from "../chain-reads";
import { placeholderDataUri } from "../placeholder";
import type { Address } from "../types";

// Build the ordered list of candidate src URLs: each gateway for a non-empty
// CID, then the deterministic placeholder as the final fallback.
function candidates(address: Address, cid: string, name: string): string[] {
  const list: string[] = [];
  const c = cid.trim();
  if (c) {
    for (const gw of thumbnailGateways()) {
      list.push(`${gw.replace(/\/$/, "")}/${c}`);
    }
  }
  list.push(placeholderDataUri(address, name));
  return list;
}

export function Thumbnail({
  address,
  cid,
  alt,
  name = "",
  className,
}: {
  address: Address;
  cid: string;
  alt: string;
  // Display name rendered into the generated key art when the real thumbnail
  // is missing; defaults to art-only (gradient, no title).
  name?: string;
  className?: string;
}) {
  const srcs = candidates(address, cid, name);
  const [idx, setIdx] = useState(0);
  return (
    <img
      className={className}
      src={srcs[idx]}
      alt={alt}
      loading="lazy"
      // Advance to the next candidate on error; the last is always the inline
      // placeholder data URI, which cannot fail.
      onError={() => setIdx((i) => Math.min(i + 1, srcs.length - 1))}
    />
  );
}
