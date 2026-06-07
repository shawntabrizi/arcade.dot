// Home / discovery page (SPEC §7.1): Featured row, Most Played, New, the
// all-games grid with gameType filter chips, and the live-activity rail.
// All sorting/bucketing is pure logic (logic.ts); this component just fetches
// the conformant game list once and arranges it.

import { useEffect, useMemo, useState } from "react";
import { useReads } from "../reads-context";
import {
  filterByChip,
  presentChips,
  sortByLastPlayed,
  sortByPlayCount,
  sortByRegisteredAt,
  type GameTypeChip,
} from "../logic";
import { GameCard } from "../components/GameCard";
import { ActivityRail } from "../components/ActivityRail";
import type { Game } from "../types";

type Load = { state: "loading" } | { state: "ok"; games: Game[] } | { state: "error"; error: string };

export function Home({ blockKey }: { blockKey: number }) {
  const reads = useReads();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [chip, setChip] = useState<GameTypeChip | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const games = await reads.listGames();
        if (!cancelled) setLoad({ state: "ok", games });
      } catch (err) {
        // Only surface an error on first load; later refreshes keep last good.
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
  }, [reads, blockKey]);

  const games = load.state === "ok" ? load.games : [];
  const featured = useMemo(() => sortByLastPlayed(games).slice(0, 4), [games]);
  const mostPlayed = useMemo(() => sortByPlayCount(games).slice(0, 8), [games]);
  const newest = useMemo(() => sortByRegisteredAt(games).slice(0, 8), [games]);
  const chips = useMemo(() => presentChips(games), [games]);
  const filtered = useMemo(() => filterByChip(games, chip), [games, chip]);

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
    return <p className="muted page__status">No conforming games registered yet.</p>;
  }

  return (
    <div className="home">
      <div className="home__main">
        <section className="row">
          <h2 className="section__title">Featured</h2>
          <div className="grid grid--featured">
            {featured.map((g) => (
              <GameCard key={g.listing.address} game={g} featured />
            ))}
          </div>
        </section>

        <section className="row">
          <h2 className="section__title">Most played</h2>
          <div className="grid">
            {mostPlayed.map((g) => (
              <GameCard key={g.listing.address} game={g} />
            ))}
          </div>
        </section>

        <section className="row">
          <h2 className="section__title">New</h2>
          <div className="grid">
            {newest.map((g) => (
              <GameCard key={g.listing.address} game={g} />
            ))}
          </div>
        </section>

        <section className="row">
          <h2 className="section__title">All games</h2>
          <div className="chips" role="tablist" aria-label="Filter by game type">
            <button
              className={`chip chip--filter${chip === null ? " chip--active" : ""}`}
              onClick={() => setChip(null)}
            >
              all
            </button>
            {chips.map((c) => (
              <button
                key={c}
                className={`chip chip--filter${chip === c ? " chip--active" : ""}`}
                onClick={() => setChip(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="grid">
            {filtered.map((g) => (
              <GameCard key={g.listing.address} game={g} />
            ))}
          </div>
          {filtered.length === 0 && <p className="muted">No games in this category.</p>}
        </section>
      </div>

      <ActivityRail games={games} refreshKey={blockKey} />
    </div>
  );
}
