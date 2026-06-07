// Recent plays for a single game's detail page (SPEC §7.3): getRecent,
// newest-first. Separate component from the leaderboard (SPEC §4.5) — this
// renders ALL plays (the recent ring), not just personal bests.

import { useEffect, useState } from "react";
import { useReads } from "../reads-context";
import { formatScore, relativeTime, shortAddress } from "../logic";
import { useResolvedNames } from "./useResolvedNames";
import type { Address, ScoreConfig, ScoreEntry } from "../types";

// The contract's recent ring holds 20 (SPEC §4.2); read the whole ring.
const RING = 20;

export function RecentPlays({
  address,
  config,
  refreshKey,
}: {
  address: Address;
  config: ScoreConfig;
  refreshKey?: number;
}) {
  const reads = useReads();
  const [entries, setEntries] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await reads.getRecent(address, 0, RING);
      if (cancelled) return;
      setEntries(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reads, address, refreshKey]);

  const names = useResolvedNames(entries.map((e) => e.player));

  return (
    <section className="recent" aria-label="Recent plays">
      <h2 className="section__title">Recent plays</h2>
      {loading && entries.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="muted">No plays yet.</p>
      ) : (
        <ul className="recent__list">
          {entries.map((e, i) => (
            <li key={`${e.player}-${e.at}-${i}`} className="recent__row">
              <span className="recent__player" title={e.player}>
                {names.get(e.player) ?? shortAddress(e.player)}
              </span>
              <span className="recent__score">{formatScore(e.score, config)}</span>
              <span className="recent__time muted">{relativeTime(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
