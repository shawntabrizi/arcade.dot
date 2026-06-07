// Resolve a set of player addresses to display names via the reads seam
// (SPEC §8.2). Returns an address→name map that fills in as resolutions land;
// unresolved addresses are simply absent (the caller falls back to the address).
// Resolutions are cached inside the reads impl, so repeated calls are cheap.

import { useEffect, useState } from "react";
import { useReads } from "../reads-context";
import type { Address } from "../types";

export function useResolvedNames(players: Address[]): Map<Address, string> {
  const reads = useReads();
  const [names, setNames] = useState<Map<Address, string>>(new Map());
  // Stable key so the effect only re-runs when the actual set changes.
  const key = players.map((p) => p.toLowerCase()).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(
        players.map(async (p) => [p, await reads.resolveName(p)] as const),
      );
      if (cancelled) return;
      setNames(new Map(resolved));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reads, key]);
  return names;
}
