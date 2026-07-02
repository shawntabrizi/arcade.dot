// Home / discovery page (SPEC §7.1), arranged like a storefront: a sortable
// game list spine (left), a featured hero capsule, an all-games capsule grid,
// and the live-activity feed. Enumeration + bounded per-block refresh are pure
// logic (logic.ts); this component fetches the conformant game list once and
// arranges it.

import { useEffect, useMemo, useRef, useState } from "react";
import { useReads } from "../reads-context";
import { mergeStats, sortByLastPlayed, sortByPlayCount } from "../logic";
import { ActivityRail } from "../components/ActivityRail";
import { FeaturedHero } from "../components/FeaturedHero";
import { GameCapsule } from "../components/GameCapsule";
import { GameList } from "../components/GameList";
import type { Game } from "../types";

type Load =
  | { state: "loading" }
  | { state: "ok"; games: Game[] }
  | { state: "error"; error: string };

export function Home({ blockKey }: { blockKey: number }) {
  const reads = useReads();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // Whether the registry has been enumerated this session. The first render
  // enumerates once (listGames, §7.4); every later best-block tick refreshes
  // ONLY the visible games' stats (refreshGames) — never re-enumerates.
  const loadedOnce = useRef(false);
  // Last-good games, kept in a ref so the per-block effect can read them to
  // compute the bounded refresh set WITHOUT depending on `load` (which would
  // re-run the effect on every merge).
  const gamesRef = useRef<Game[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!loadedOnce.current) {
          // First load: enumerate the registry once and gate for conformance.
          const games = await reads.listGames();
          if (cancelled) return;
          loadedOnce.current = true;
          gamesRef.current = games;
          setLoad({ state: "ok", games });
          return;
        }
        // Bounded per-block refresh (§7.4): re-read ONLY the games we're showing
        // — O(visible), no re-enumeration.
        const addrs = gamesRef.current.map((g) => g.listing.address);
        const refreshed = await reads.refreshGames(addrs);
        if (cancelled) return;
        const merged = mergeStats(gamesRef.current, refreshed);
        gamesRef.current = merged;
        setLoad({ state: "ok", games: merged });
      } catch (err) {
        // First load failed → surface; a failed refresh keeps last-good (§9.3).
        if (!cancelled && !loadedOnce.current)
          setLoad({
            state: "error",
            error: err instanceof Error ? err.message : String(err),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reads, blockKey]);

  const games = load.state === "ok" ? load.games : [];
  // Featured = the single most-recently-active game, shown as a hero capsule.
  const featured = useMemo(() => sortByLastPlayed(games)[0] ?? null, [games]);

  if (load.state === "loading") {
    return <p className="muted page__status">Loading games…</p>;
  }
  if (load.state === "error") {
    return (
      <p className="error page__status">
        Couldn’t reach the chain: {load.error}
      </p>
    );
  }
  if (games.length === 0) {
    return (
      <p className="muted page__status">No conforming games registered yet.</p>
    );
  }

  return (
    <div className="home">
      <GameList games={games} />
      <div className="home__main">
        <section className="row">
          <h2 className="section__title">Featured &amp; recommended</h2>
          {featured && (
            <FeaturedHero key={featured.listing.address} game={featured} />
          )}
        </section>
        <section className="row">
          <h2 className="section__title">All games</h2>
          <div className="shelf">
            {sortByPlayCount(games).map((g) => (
              <GameCapsule key={g.listing.address} game={g} />
            ))}
          </div>
        </section>
        <ActivityRail games={games} refreshKey={blockKey} />
      </div>
    </div>
  );
}
