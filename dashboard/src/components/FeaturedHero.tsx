// Featured hero (SPEC §7.1 "Featured"): the single most-recently-active game,
// presented as a large image-forward capsule — a Steam-style feature panel.
// The game's signature colour (derived from its address, same family as its
// generated key art) tints an ambient glow behind the capsule so each featured
// game colours the shelf differently. It links to the detail "store page"
// exactly like a card; the Play action lives there, so the whole hero is one
// clickable surface with no nested anchors. Reuses the shared name-resolution
// + thumbnail logic.

import type { CSSProperties } from "react";
import { bucketGameType, relativeTime } from "../logic";
import { ambientColor } from "../placeholder";
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
  // Per-game ambient tint, consumed by the CSS glow/panel gradient.
  const ambient = { "--ambient": ambientColor(listing.address) } as CSSProperties;

  return (
    <a className="feature" href={gameHref(listing.address)} style={ambient}>
      <div className="feature__media">
        <Thumbnail
          address={listing.address}
          cid={listing.thumbnailCid}
          alt={listing.name}
          name={listing.name}
        />
        {listing.requiresAccount && (
          <span className="badge badge--account" title="Requires a signed-in account to play">
            account
          </span>
        )}
      </div>
      <div className="feature__body">
        <h3 className="feature__name" title={listing.name}>
          {listing.name || "Untitled game"}
        </h3>
        <div className="feature__tags">
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
