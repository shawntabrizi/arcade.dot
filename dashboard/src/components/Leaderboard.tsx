// Leaderboard component (SPEC §7.3). Paginated getLeaderboard (page size 25),
// scores rendered per scoreFormat/scoreUnit, players name-resolved (§8.2).
// MUST stay a separate component from activity rendering (SPEC §4.5) so a
// board-less game in GCS v2 is a conditional, not a rewrite.

import { useEffect, useState } from "react";
import { useReads } from "../reads-context";
import { formatScore, shortAddress } from "../logic";
import { useResolvedNames } from "./useResolvedNames";
import type { Address, ScoreConfig, ScoreEntry } from "../types";

const PAGE_SIZE = 25;

export function Leaderboard({
  address,
  config,
  refreshKey,
}: {
  address: Address;
  config: ScoreConfig;
  // Bump to force a re-read (e.g. on a new best block from the detail page).
  refreshKey?: number;
}) {
  const reads = useReads();
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Fetch one extra to detect whether a next page exists.
      const rows = await reads.getLeaderboard(address, page * PAGE_SIZE, PAGE_SIZE + 1);
      if (cancelled) return;
      setAtEnd(rows.length <= PAGE_SIZE);
      setEntries(rows.slice(0, PAGE_SIZE));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reads, address, page, refreshKey]);

  const names = useResolvedNames(entries.map((e) => e.player));

  return (
    <section className="board" aria-label="Leaderboard">
      <h2 className="section__title">Leaderboard</h2>
      {loading && entries.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="muted">No scores yet — be the first to play.</p>
      ) : (
        <ol className="board__list">
          {entries.map((e, i) => {
            const rank = page * PAGE_SIZE + i + 1;
            return (
              <li key={`${e.player}-${e.at}-${i}`} className="board__row">
                <span className="board__rank">#{rank}</span>
                <span className="board__player" title={e.player}>
                  {names.get(e.player) ?? shortAddress(e.player)}
                </span>
                <span className="board__score">{formatScore(e.score, config)}</span>
              </li>
            );
          })}
        </ol>
      )}
      {(page > 0 || !atEnd) && (
        <div className="board__pager">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Prev
          </button>
          <span className="muted">page {page + 1}</span>
          <button disabled={atEnd} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}
