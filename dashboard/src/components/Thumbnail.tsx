// Game thumbnail (SPEC §6.4). Tries the Bulletin/IPFS gateways in order; on an
// empty CID or a fetch/decode failure, falls back to the deterministic
// address-derived placeholder so an image failure NEVER breaks a card.

import { useState } from "react";
import { thumbnailGateways } from "../chain-reads";
import { placeholderDataUri } from "../placeholder";
import type { Address } from "../types";

// Build the ordered list of candidate src URLs: each gateway for a non-empty
// CID, then the deterministic placeholder as the final fallback.
function candidates(address: Address, cid: string): string[] {
  const list: string[] = [];
  const c = cid.trim();
  if (c) {
    for (const gw of thumbnailGateways()) {
      list.push(`${gw.replace(/\/$/, "")}/${c}`);
    }
  }
  list.push(placeholderDataUri(address));
  return list;
}

export function Thumbnail({
  address,
  cid,
  alt,
  className,
}: {
  address: Address;
  cid: string;
  alt: string;
  className?: string;
}) {
  const srcs = candidates(address, cid);
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
