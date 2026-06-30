// Featured hero (SPEC §7.1 "Featured"): the single most-recently-active game,
// presented as a large image-forward capsule — a Steam-style feature rendered
// in the Polkadot-calm surface language (no borders; tonal surface + a soft
// hover lift). It links to the detail "store page" exactly like a card; the Play
// action lives there, so the whole hero is one clickable surface with no nested
// anchors. Reuses the shared name-resolution + thumbnail logic.

import { bucketGameType, relativeTime } from "../logic";
import { gameHref } from "../router";
import { Thumbnail } from "./Thumbnail";
import { useNow } from "./useNow";
import { useTopPlayer } from "./useTopPlayer";
import type { Game } from "../types";

export function FeaturedHero({ game }: { game: Game }) {
  const { listing, stats } = game;
  const chip = bucketGameType(listing.gameType);
  const topPlayer = useTopPlayer(game);
  const now = useNow();

  return (
    <a className="feature" href={gameHref(listing.address)}>
      <div className="feature__media">
        <Thumbnail address={listing.address} cid={listing.thumbnailCid} alt={listing.name} />
        {listing.requiresAccount && (
          <span className="badge badge--account" title="Requires a signed-in account to play">
            account
          </span>
        )}
      </div>
      <div className="feature__body">
        <div className="feature__titlerow">
          <h3 className="feature__name" title={listing.name}>
            {listing.name || "Untitled game"}
          </h3>
          <span className="chip">{chip}</span>
        </div>
        {listing.shortDescription && <p className="feature__desc">{listing.shortDescription}</p>}
        <div className="feature__stats">
          <span className="stat">
            <strong>{stats.playCount.toLocaleString()}</strong> plays
          </span>
          <span className="stat">
            <strong>{stats.uniquePlayers.toLocaleString()}</strong> players
          </span>
          <span className="stat stat--muted">{relativeTime(stats.lastPlayedAt, now)}</span>
        </div>
        <div className="feature__foot">
          {topPlayer ? (
            <span className="feature__top">
              <span className="feature__top-label">top</span>
              <span className="feature__top-name" title={topPlayer}>
                {topPlayer}
              </span>
            </span>
          ) : (
            <span className="feature__top-label">no scores yet</span>
          )}
          <span className="feature__cta">View →</span>
        </div>
      </div>
    </a>
  );
}
