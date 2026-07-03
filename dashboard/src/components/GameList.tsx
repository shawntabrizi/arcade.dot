// Left-hand game list (Steam Library "spine"): the browse spine for the whole
// arcade. Text-only rows (the game image lives only in the featured hero). It
// both SORTS (most played / recent / newest / name) and FILTERS — by gameType
// category chips and a name search. Filter narrows the set, then sort reorders
// it. Each row links to that game's detail page (#/game/<address>).

import { useMemo, useState } from "react";
import {
  filterByChip,
  presentChips,
  relativeTime,
  sortByLastPlayed,
  sortByPlayCount,
  sortByRegisteredAt,
  type GameTypeChip,
} from "../logic";
import { gameHref } from "../router";
import { useNow } from "./useNow";
import type { Game } from "../types";

type Sort = "played" | "recent" | "new" | "name";

const SORTS: { key: Sort; label: string }[] = [
  { key: "played", label: "Most played" },
  { key: "recent", label: "Recently played" },
  { key: "new", label: "Newest" },
  { key: "name", label: "Name (A–Z)" },
];

function sortGames(games: Game[], sort: Sort): Game[] {
  switch (sort) {
    case "played":
      return sortByPlayCount(games);
    case "recent":
      return sortByLastPlayed(games);
    case "new":
      return sortByRegisteredAt(games);
    case "name":
      return [...games].sort((a, b) =>
        a.listing.name.localeCompare(b.listing.name, undefined, { sensitivity: "base" }),
      );
  }
}

// The trailing stat on each row, matched to the active sort so the order reads
// correctly (sorting by plays but showing "3d ago" would be confusing).
function secondary(game: Game, sort: Sort, now: number): string {
  switch (sort) {
    case "recent":
      return game.stats.lastPlayedAt ? relativeTime(game.stats.lastPlayedAt, now) : "—";
    case "new":
      return relativeTime(game.listing.registeredAt, now);
    case "played":
    case "name":
      return `${game.stats.playCount.toLocaleString()} plays`;
  }
}

export function GameList({ games }: { games: Game[] }) {
  const [sort, setSort] = useState<Sort>("played");
  const [chip, setChip] = useState<GameTypeChip | null>(null);
  const [query, setQuery] = useState("");
  const now = useNow();

  // Category chips reflect the buckets present across ALL games (stable while
  // filtering); only worth showing once more than one category exists.
  const chips = useMemo(() => presentChips(games), [games]);
  // Filter (category → name search) then sort the surviving set.
  const shown = useMemo(() => {
    const byChip = filterByChip(games, chip);
    const q = query.trim().toLowerCase();
    const byText = q
      ? byChip.filter((g) => g.listing.name.toLowerCase().includes(q))
      : byChip;
    return sortGames(byText, sort);
  }, [games, chip, query, sort]);

  return (
    <aside className="gamelist" aria-label="All games">
      <div className="gamelist__head">
        <h2 className="section__title">Games</h2>
        <select
          className="gamelist__sort"
          aria-label="Sort games by"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {games.length > 1 && (
        <input
          className="gamelist__search"
          type="search"
          placeholder="Search games"
          aria-label="Search games by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {chips.length > 1 && (
        <div className="gamelist__chips" role="group" aria-label="Filter by category">
          <button
            type="button"
            className={`gamelist__chip${chip === null ? " gamelist__chip--active" : ""}`}
            aria-pressed={chip === null}
            onClick={() => setChip(null)}
          >
            all
          </button>
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              className={`gamelist__chip${chip === c ? " gamelist__chip--active" : ""}`}
              aria-pressed={chip === c}
              onClick={() => setChip(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="muted gamelist__empty">No games match.</p>
      ) : (
        <ul className="gamelist__list">
          {shown.map((g) => (
            <li key={g.listing.address}>
              <a className="gamelist__row" href={gameHref(g.listing.address)}>
                <span className="gamelist__name" title={g.listing.name}>
                  {g.listing.name || "Untitled game"}
                </span>
                <span className="gamelist__stat">{secondary(g, sort, now)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
