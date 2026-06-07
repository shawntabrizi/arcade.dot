// A discovery card (SPEC §7.2): thumbnail, name, gameType chip, play count,
// last-played relative time, top player (rank-1, name-resolved), requiresAccount
// badge. Links to the detail page (keyed by contract address).

import { useEffect, useState } from "react";
import { useReads } from "../reads-context";
import { bucketGameType, relativeTime } from "../logic";
import { gameHref } from "../router";
import { Thumbnail } from "./Thumbnail";
import { useNow } from "./useNow";
import type { Game } from "../types";

// Resolve the rank-1 player's display name for the card. Reads getLeaderboard(0,1)
// then resolveName() (SPEC §7.2 + §8.2). Empty board → null.
function useTopPlayer(game: Game): string | null {
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
      if (!cancelled) setName(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [reads, address, playCount]);
  return name;
}

export function GameCard({ game, featured = false }: { game: Game; featured?: boolean }) {
  const { listing, stats } = game;
  const topPlayer = useTopPlayer(game);
  const chip = bucketGameType(listing.gameType);
  const now = useNow();

  return (
    <a className={`card${featured ? " card--featured" : ""}`} href={gameHref(listing.address)}>
      <div className="card__thumb">
        <Thumbnail address={listing.address} cid={listing.thumbnailCid} alt={listing.name} />
        {listing.requiresAccount && (
          <span className="badge badge--account" title="Requires a signed-in account to play">
            account
          </span>
        )}
      </div>
      <div className="card__body">
        <div className="card__titlerow">
          <h3 className="card__name" title={listing.name}>
            {listing.name || "Untitled game"}
          </h3>
          <span className="chip">{chip}</span>
        </div>
        <div className="card__stats">
          <span className="stat">
            <strong>{stats.playCount.toLocaleString()}</strong> plays
          </span>
          <span className="stat stat--muted">{relativeTime(stats.lastPlayedAt, now)}</span>
        </div>
        <div className="card__top">
          {topPlayer ? (
            <>
              <span className="card__top-label">top</span>
              <span className="card__top-name" title={topPlayer}>
                {topPlayer}
              </span>
            </>
          ) : (
            <span className="card__top-label">no scores yet</span>
          )}
        </div>
      </div>
    </a>
  );
}
