// A store-shelf capsule card (Steam-style): image-forward, name + quiet meta
// line below. Used by the home page's "All games" grid; the whole card is one
// clickable surface linking to the game's detail page.

import { bucketGameType } from "../logic";
import { gameHref } from "../router";
import { Thumbnail } from "./Thumbnail";
import type { Game } from "../types";

export function GameCapsule({ game }: { game: Game }) {
  const { listing, stats } = game;
  return (
    <a className="capsule" href={gameHref(listing.address)}>
      <div className="capsule__media">
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
      <div className="capsule__body">
        <span className="capsule__name" title={listing.name}>
          {listing.name || "Untitled game"}
        </span>
        <span className="capsule__meta">
          {stats.playCount.toLocaleString()} plays · {bucketGameType(listing.gameType)}
        </span>
      </div>
    </a>
  );
}
