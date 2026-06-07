// Game detail page (SPEC §7.3), keyed by contract address. Hero (thumbnail,
// name, type, short description, requiresAccount badge, Play button per §7.5),
// stats, leaderboard (separate component), recent plays (separate component),
// footer (contract address → explorer, registered/updated dates).

import { useEffect, useState } from "react";
import { useReads } from "../reads-context";
import { bucketGameType, relativeTime, toLaunchUrl } from "../logic";
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

  return (
    <article className="detail">
      <a className="link detail__back" href={homeHref()}>
        ← Arcade
      </a>

      <header className="hero">
        <div className="hero__thumb">
          <Thumbnail address={listing.address} cid={listing.thumbnailCid} alt={listing.name} />
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
            // SPEC §7.5: plain anchor, target=_blank rel=noopener. Same-frame
            // nav and window.open are sandbox-blocked — MUST NOT be used.
            <a className="btn btn--play" href={launchUrl} target="_blank" rel="noopener">
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
