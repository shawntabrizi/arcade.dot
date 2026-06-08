import { useEffect, useMemo, useState } from "react";
import type { ScoreboardAPI, ScoreEntry, ScoreOrdering } from "./api";

interface Props {
  api: ScoreboardAPI;
  refreshKey: number;
  highlightPlayer?: `0x${string}`;
  limit?: number;
  /** Optimistic just-played entry, merged in before the real fetch lands. */
  pendingEntry?: ScoreEntry | null;
  /**
   * SPEC §4.2 score ordering: 0 = higher is better (default), 1 = lower is
   * better. Drives the top-list sort and what counts as a personal best for
   * the optimistic upsert, so lower-is-better genres rank correctly in-game.
   */
  ordering?: ScoreOrdering;
}

// A is "better than" B under the given ordering. Higher-is-better (0) ranks the
// larger score first; lower-is-better (1) ranks the smaller score first.
function isBetter(a: number, b: number, ordering: ScoreOrdering): boolean {
  return ordering === 1 ? a < b : a > b;
}

export function shortAddress(addr: string): string {
  if (!addr.startsWith("0x") || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Top list: upsert the optimistic entry by player keeping the BETTER score
// under the ordering (the contract stores the personal best), then re-sort +
// trim. Sort descending for higher-is-better (0), ascending for lower (1).
export function withPendingTop(
  scores: ScoreEntry[],
  pending: ScoreEntry | null | undefined,
  limit: number,
  ordering: ScoreOrdering = 0,
): ScoreEntry[] {
  const byPlayer = new Map(scores.map((e) => [e.player.toLowerCase(), e]));
  if (pending) {
    const existing = byPlayer.get(pending.player.toLowerCase());
    if (!existing || isBetter(pending.score, existing.score, ordering)) {
      byPlayer.set(pending.player.toLowerCase(), pending);
    }
  }
  return [...byPlayer.values()]
    .sort((a, b) => (ordering === 1 ? a.score - b.score : b.score - a.score))
    .slice(0, limit);
}

// Recent list: prepend the optimistic play unless the freshest fetched entry is
// already it (same player + score), so it doesn't show twice once the real
// submission lands.
function withPendingRecent(
  recent: ScoreEntry[],
  pending: ScoreEntry | null | undefined,
  limit: number,
): ScoreEntry[] {
  if (!pending) return recent;
  const head = recent[0];
  const alreadyShown =
    head && head.player.toLowerCase() === pending.player.toLowerCase() && head.score === pending.score;
  return alreadyShown ? recent : [pending, ...recent].slice(0, limit);
}

export function Leaderboard({
  api,
  refreshKey,
  highlightPlayer,
  limit = 10,
  pendingEntry,
  ordering = 0,
}: Props) {
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [recent, setRecent] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [top, recentScores] = await Promise.all([
        api.getTopScores(limit),
        api.getRecentScores(limit),
      ]);
      if (cancelled) return;
      setScores(top);
      setRecent(recentScores);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, refreshKey, limit]);

  const topDisplayed = useMemo(
    () => withPendingTop(scores, pendingEntry, limit, ordering),
    [scores, pendingEntry, limit, ordering],
  );
  const recentDisplayed = useMemo(
    () => withPendingRecent(recent, pendingEntry, limit),
    [recent, pendingEntry, limit],
  );
  // SPEC §8.2: the template has no name infrastructure of its own — the
  // dashboard resolves DotNS names. In-game we show truncated addresses.
  const label = (addr: string) => shortAddress(addr);

  // One `.leaderboard` container (preserves the `.leaderboard .is-you` test
  // hook + count across both lists), with each list in its own titled card.
  // The app shows the whole thing on the right column (desktop) or splits the
  // two cards across the Scores / Recent tabs via CSS (mobile).
  return (
    <div className="leaderboard flex flex-col gap-4">
      <section className="board-card top-card bg-surface-container rounded-container p-5 shadow-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary m-0 mb-3">
          Top {limit}
        </h2>
        {loading && topDisplayed.length === 0 ? (
          <p className="leaderboard-empty text-tertiary text-sm m-0">Loading…</p>
        ) : topDisplayed.length === 0 ? (
          <p className="leaderboard-empty text-tertiary text-sm m-0">
            No scores yet. Be the first.
          </p>
        ) : (
          <ol className="leaderboard-list">
            {topDisplayed.map((entry, i) => {
              const isYou =
                highlightPlayer !== undefined &&
                entry.player.toLowerCase() === highlightPlayer.toLowerCase();
              return (
                <li key={`${entry.player}-${i}`} className={isYou ? "is-you" : ""}>
                  <span className="rank">#{i + 1}</span>
                  <span className="player" title={entry.player}>
                    {label(entry.player)}
                  </span>
                  <span className="score">{entry.score}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="board-card recent-card bg-surface-container rounded-container p-5 shadow-1">
        <h2 className="recent-heading text-sm font-semibold uppercase tracking-wide text-secondary m-0 mb-3">
          Recent plays
        </h2>
        {loading && recentDisplayed.length === 0 ? (
          <p className="leaderboard-empty text-tertiary text-sm m-0">Loading…</p>
        ) : recentDisplayed.length === 0 ? (
          <p className="leaderboard-empty text-tertiary text-sm m-0">No plays yet.</p>
        ) : (
          <ul className="leaderboard-list recent-list">
            {recentDisplayed.map((entry, i) => {
              const isYou =
                highlightPlayer !== undefined &&
                entry.player.toLowerCase() === highlightPlayer.toLowerCase();
              return (
                <li
                  key={`r-${entry.timestamp}-${entry.player}-${i}`}
                  className={isYou ? "is-you" : ""}
                >
                  <span className="player" title={entry.player}>
                    {label(entry.player)}
                  </span>
                  <span className="score">{entry.score}</span>
                  <span className="when">{relativeTime(entry.timestamp)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
