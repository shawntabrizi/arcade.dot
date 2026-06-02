import { useEffect, useMemo, useState } from "react";
import type { ScoreboardAPI, ScoreEntry } from "./api";
import { isArcadeInstalled, resolveDisplayNames } from "./arcade";

interface Props {
  api: ScoreboardAPI;
  refreshKey: number;
  highlightPlayer?: `0x${string}`;
  limit?: number;
  /** Optimistic just-played entry, merged in before the real fetch lands. */
  pendingEntry?: ScoreEntry | null;
}

export function shortAddress(addr: string): string {
  if (!addr.startsWith("0x") || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Merge an optimistic entry into fetched scores: upsert by player keeping the
// higher score (the contract stores the personal best), then re-sort + trim.
function withPending(
  scores: ScoreEntry[],
  pending: ScoreEntry | null | undefined,
  limit: number,
): ScoreEntry[] {
  if (!pending) return scores;
  const byPlayer = new Map(scores.map((e) => [e.player.toLowerCase(), e]));
  const existing = byPlayer.get(pending.player.toLowerCase());
  if (!existing || pending.score > existing.score) {
    byPlayer.set(pending.player.toLowerCase(), pending);
  }
  return [...byPlayer.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function Leaderboard({
  api,
  refreshKey,
  highlightPlayer,
  limit = 10,
  pendingEntry,
}: Props) {
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [names, setNames] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const s = await api.getTopScores(limit);
      if (cancelled) return;
      setScores(s);
      setLoading(false);
      if (isArcadeInstalled() && s.length > 0) {
        const resolved = await resolveDisplayNames(s.map((e) => e.player));
        if (cancelled) return;
        const next = new Map<string, string | null>();
        resolved.forEach((v, k) => next.set(k.toLowerCase(), v));
        setNames(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, refreshKey, limit]);

  const displayed = useMemo(
    () => withPending(scores, pendingEntry, limit),
    [scores, pendingEntry, limit],
  );

  return (
    <div className="leaderboard">
      <h2>Top {limit}</h2>
      {loading && displayed.length === 0 ? (
        <p className="leaderboard-empty">Loading…</p>
      ) : displayed.length === 0 ? (
        <p className="leaderboard-empty">No scores yet. Be the first.</p>
      ) : (
        <ol className="leaderboard-list">
          {displayed.map((entry, i) => {
            const isYou =
              highlightPlayer !== undefined &&
              entry.player.toLowerCase() === highlightPlayer.toLowerCase();
            const name = names.get(entry.player.toLowerCase()) || null;
            return (
              <li key={`${entry.player}-${i}`} className={isYou ? "is-you" : ""}>
                <span className="rank">#{i + 1}</span>
                <span className="player" title={entry.player}>
                  {name ?? shortAddress(entry.player)}
                </span>
                <span className="score">{entry.score}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
