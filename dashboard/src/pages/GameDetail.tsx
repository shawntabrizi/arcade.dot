// Game detail page (SPEC §7.3), keyed by contract address — the game's "store
// page". The game's own art bleeds into a blurred, darkened backdrop behind
// the hero (Steam app-page treatment). Hero (thumbnail, name, type, short
// description, requiresAccount badge, Play button per §7.5), stats,
// leaderboard (separate component), recent plays (separate component), footer
// (contract address → explorer, registered/updated dates).

import { useEffect, useState, type CSSProperties } from "react";
import { getTruApi, isInsideContainerSync } from "@parity/product-sdk-host";
import { useReads } from "../reads-context";
import { bucketGameType, relativeTime, toLaunchUrl } from "../logic";
import { ambientColor } from "../placeholder";
import { homeHref } from "../router";
import { Thumbnail } from "../components/Thumbnail";
import { Leaderboard } from "../components/Leaderboard";
import { RecentPlays } from "../components/RecentPlays";
import { useNow } from "../components/useNow";
import type { Address, Game, ScoreConfig } from "../types";

// Block explorer for the contract address footer link (SPEC §7.3). Paseo Asset
// Hub revive/EVM explorer; address-keyed.
function explorerUrl(address: Address): string {
  return `https://assethub-paseo.subscan.io/account/${address}`;
}

function fmtDate(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type Load =
  | { state: "loading" }
  | { state: "ok"; game: Game; config: ScoreConfig }
  | { state: "error"; error: string }
  | { state: "notfound" };

export function GameDetail({ address, blockKey }: { address: Address; blockKey: number }) {
  const reads = useReads();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const game = await reads.getGame(address);
        if (cancelled) return;
        if (!game) {
          setLoad({ state: "notfound" });
          return;
        }
        const config = await reads.getScoreConfig(address);
        if (!cancelled) setLoad({ state: "ok", game, config });
      } catch (err) {
        if (!cancelled)
          setLoad((prev) =>
            prev.state === "ok"
              ? prev
              : { state: "error", error: err instanceof Error ? err.message : String(err) },
          );
      }
    })();
    return () => {
      cancelled = true;
    };
    // blockKey refreshes stats; config is immutable and re-fetch is cache-cheap.
  }, [reads, address, blockKey]);

  if (load.state === "loading") return <p className="muted page__status">Loading…</p>;
  if (load.state === "error")
    return <p className="error page__status">Couldn’t load game: {load.error}</p>;
  if (load.state === "notfound")
    return (
      <div className="page__status">
        <p className="muted">No conforming game at {address}.</p>
        <a className="link" href={homeHref()}>
          ← Back to arcade
        </a>
      </div>
    );

  const { game, config } = load;
  const { listing, stats } = game;
  const launchUrl = toLaunchUrl(listing.playUrl);
  const chip = bucketGameType(listing.gameType);

  // Inside a Triangle host (desktop/web/mobile), target=_blank/window.open and
  // same-frame nav are sandbox-blocked, so the plain anchor does nothing. Route
  // through the host API instead: handleNavigateTo opens the .dot app (desktop
  // → in-app router; web → top-frame window.open). Outside a host (plain
  // browser, e2e) isInsideContainerSync() is false → no-op, anchor behaves
  // exactly as before. preventDefault() runs synchronously, before any await,
  // so the anchor's default nav is reliably cancelled in-host.
  const onPlay = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (launchUrl && isInsideContainerSync()) {
      e.preventDefault();
      void getTruApi().then((t) => {
        // navigateTo takes a versioned envelope { tag, value }; value is the URL.
        t?.navigateTo({ tag: "v1", value: launchUrl });
      });
    }
  };

  return (
    <article
      className="detail"
      style={{ "--ambient": ambientColor(listing.address) } as CSSProperties}
    >
      {/* The game's art, blurred + darkened, bleeding behind the hero. */}
      <div className="detail__bg" aria-hidden="true">
        <Thumbnail
          address={listing.address}
          cid={listing.thumbnailCid}
          alt=""
          name={listing.name}
        />
      </div>

      <a className="link detail__back" href={homeHref()}>
        ← Arcade
      </a>

      <header className="hero">
        <div className="hero__thumb">
          <Thumbnail
            address={listing.address}
            cid={listing.thumbnailCid}
            alt={listing.name}
            name={listing.name}
          />
        </div>
        <div className="hero__info">
          <div className="hero__titlerow">
            <h1 className="hero__name">{listing.name || "Untitled game"}</h1>
            <span className="chip">{chip}</span>
            {listing.requiresAccount && (
              <span className="badge badge--account">requires account</span>
            )}
          </div>
          <p className="hero__desc">{listing.shortDescription}</p>
          {launchUrl ? (
            // SPEC §7.5: plain anchor, target=_blank rel=noopener for plain
            // browsers. onPlay intercepts only when inside a host (where
            // target=_blank is sandbox-blocked) and routes via the host API.
            <a
              className="btn btn--play"
              href={launchUrl}
              target="_blank"
              rel="noopener"
              onClick={onPlay}
            >
              ▶ Play
            </a>
          ) : (
            <span className="btn btn--play btn--disabled" aria-disabled="true">
              No playable URL
            </span>
          )}
        </div>
      </header>

      <section className="stats">
        <div className="stat-box">
          <span className="stat-box__value">{stats.playCount.toLocaleString()}</span>
          <span className="stat-box__label">plays</span>
        </div>
        <div className="stat-box">
          <span className="stat-box__value">{stats.uniquePlayers.toLocaleString()}</span>
          <span className="stat-box__label">players</span>
        </div>
        <div className="stat-box">
          <span className="stat-box__value">{relativeTime(stats.lastPlayedAt, now)}</span>
          <span className="stat-box__label">last played</span>
        </div>
      </section>

      <div className="detail__cols">
        <Leaderboard address={listing.address} config={config} refreshKey={blockKey} />
        <RecentPlays address={listing.address} config={config} refreshKey={blockKey} />
      </div>

      <footer className="detail__footer">
        <a className="link" href={explorerUrl(listing.address)} target="_blank" rel="noopener">
          <code>{listing.address}</code>
        </a>
        <span className="muted">
          registered {fmtDate(listing.registeredAt)} · updated {fmtDate(listing.updatedAt)}
        </span>
      </footer>
    </article>
  );
}
