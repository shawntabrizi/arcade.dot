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

function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Top list: upsert the optimistic entry by player keeping the higher score
// (the contract stores the personal best), then re-sort + trim.
function withPendingTop(
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
}: Props) {
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [recent, setRecent] = useState<ScoreEntry[]>([]);
  const [names, setNames] = useState<Map<string, string | null>>(new Map());
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
      if (isArcadeInstalled()) {
        const players = [...top, ...recentScores].map((e) => e.player);
        if (players.length > 0) {
          const resolved = await resolveDisplayNames(players);
          if (cancelled) return;
          const next = new Map<string, string | null>();
          resolved.forEach((v, k) => next.set(k.toLowerCase(), v));
          setNames(next);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, refreshKey, limit]);

  const topDisplayed = useMemo(
    () => withPendingTop(scores, pendingEntry, limit),
    [scores, pendingEntry, limit],
  );
  const recentDisplayed = useMemo(
    () => withPendingRecent(recent, pendingEntry, limit),
    [recent, pendingEntry, limit],
  );
  const label = (addr: string) => names.get(addr.toLowerCase()) || shortAddress(addr);

  return (
    <div className="leaderboard">
      <h2>Top {limit}</h2>
      {loading && topDisplayed.length === 0 ? (
        <p className="leaderboard-empty">Loading…</p>
      ) : topDisplayed.length === 0 ? (
        <p className="leaderboard-empty">No scores yet. Be the first.</p>
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

      <h2 className="recent-heading">Recent plays</h2>
      {loading && recentDisplayed.length === 0 ? (
        <p className="leaderboard-empty">Loading…</p>
      ) : recentDisplayed.length === 0 ? (
        <p className="leaderboard-empty">No plays yet.</p>
      ) : (
        <ul className="leaderboard-list recent-list">
          {recentDisplayed.map((entry, i) => {
            const isYou =
              highlightPlayer !== undefined &&
              entry.player.toLowerCase() === highlightPlayer.toLowerCase();
            return (
              <li key={`r-${entry.timestamp}-${entry.player}-${i}`} className={isYou ? "is-you" : ""}>
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
    </div>
  );
}
