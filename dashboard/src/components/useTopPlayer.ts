// Resolve the rank-1 player's display name for the featured hero. Reads
// getLeaderboard(0,1) then resolveName() (SPEC §7.2 + §8.2). Empty board → null.

import { useEffect, useState } from "react";
import { useReads } from "../reads-context";
import { displayName } from "../logic";
import type { Game } from "../types";

export function useTopPlayer(game: Game): string | null {
  const reads = useReads();
  const [name, setName] = useState<string | null>(null);
  const address = game.listing.address;
  // Re-resolve when playCount changes (a new play may have changed rank 1).
  const playCount = game.stats.playCount;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const top = await reads.getLeaderboard(address, 0, 1);
      if (cancelled) return;
      if (top.length === 0) {
        setName(null);
        return;
      }
      const n = await reads.resolveName(top[0].player);
      if (!cancelled) setName(displayName(top[0].player, n));
    })();
    return () => {
      cancelled = true;
    };
  }, [reads, address, playCount]);
  return name;
}
