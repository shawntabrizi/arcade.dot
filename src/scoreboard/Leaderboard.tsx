import { useEffect, useState } from "react";
import type { ScoreboardAPI, ScoreEntry } from "./api";
import { isArcadeInstalled, resolveDisplayNames } from "./arcade";

interface Props {
  api: ScoreboardAPI;
  refreshKey: number;
  highlightPlayer?: `0x${string}`;
  limit?: number;
}

export function shortAddress(addr: string): string {
  if (!addr.startsWith("0x") || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function Leaderboard({ api, refreshKey, highlightPlayer, limit = 10 }: Props) {
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

  return (
    <div className="leaderboard">
      <h2>Top {limit}</h2>
      {loading ? (
        <p className="leaderboard-empty">Loading…</p>
      ) : scores.length === 0 ? (
        <p className="leaderboard-empty">No scores yet. Be the first.</p>
      ) : (
        <ol className="leaderboard-list">
          {scores.map((entry, i) => {
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
