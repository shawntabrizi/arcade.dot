import { useEffect, useState } from "react";
import {
  type GameInfo,
  type PlayerPoints,
  type RecentScore,
  getGames,
  getRecent,
  getTopPlayers,
} from "./arcade";

function shortAddr(a: string): string {
  if (!a.startsWith("0x") || a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

type Loadable<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error"; error: string };

export function App() {
  const [players, setPlayers] = useState<Loadable<PlayerPoints[]>>({ state: "loading" });
  const [recent, setRecent] = useState<Loadable<RecentScore[]>>({ state: "loading" });
  const [games, setGames] = useState<Loadable<GameInfo[]>>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    const run = async <T,>(
      fn: () => Promise<T>,
      set: (v: Loadable<T>) => void,
    ) => {
      try {
        const data = await fn();
        if (!cancelled) set({ state: "ok", data });
      } catch (err) {
        if (!cancelled)
          set({ state: "error", error: err instanceof Error ? err.message : String(err) });
      }
    };
    run(() => getTopPlayers(10), setPlayers);
    run(() => getRecent(20), setRecent);
    run(() => getGames(), setGames);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Arcade</h1>
        <p className="tagline">
          Cross-game leaderboard for every game built from the Polkadot Leaderboard Playground.
        </p>
      </header>

      <div className="grid">
        <section className="card">
          <h2>Top players</h2>
          {players.state === "loading" && <p className="empty">Loading…</p>}
          {players.state === "error" && <p className="error">{players.error}</p>}
          {players.state === "ok" && players.data.length === 0 && (
            <p className="empty">No players yet.</p>
          )}
          {players.state === "ok" && players.data.length > 0 && (
            <ol className="list">
              {players.data.map((p, i) => (
                <li key={p.address}>
                  <span className="rank">#{i + 1}</span>
                  <span className="player" title={p.address}>
                    {p.displayName ?? shortAddr(p.address)}
                  </span>
                  <span className="score">{p.totalPoints.toString()}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card">
          <h2>Latest scores</h2>
          {recent.state === "loading" && <p className="empty">Loading…</p>}
          {recent.state === "error" && <p className="error">{recent.error}</p>}
          {recent.state === "ok" && recent.data.length === 0 && (
            <p className="empty">No submissions yet.</p>
          )}
          {recent.state === "ok" && recent.data.length > 0 && (
            <ul className="list recent">
              {recent.data.map((r, i) => (
                <li key={`${r.timestamp}-${i}`}>
                  <span className="player" title={r.player}>
                    {r.displayName ?? shortAddr(r.player)}
                  </span>
                  <span className="score">{r.score.toString()}</span>
                  <span className="meta">
                    <code title={r.game}>{shortAddr(r.game)}</code> · {relativeTime(r.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Active games</h2>
          {games.state === "loading" && <p className="empty">Loading…</p>}
          {games.state === "error" && <p className="error">{games.error}</p>}
          {games.state === "ok" && games.data.length === 0 && (
            <p className="empty">No games registered.</p>
          )}
          {games.state === "ok" && games.data.length > 0 && (
            <ul className="list games">
              {games.data
                .slice()
                .sort((a, b) => b.lastActivity - a.lastActivity)
                .map((g) => (
                  <li key={g.address}>
                    <span className="player">{g.name || "(unnamed)"}</span>
                    <code className="meta" title={g.address}>
                      {shortAddr(g.address)}
                    </code>
                    <span className="meta">last play {relativeTime(g.lastActivity)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="page-footer">
        <p>
          Reads <code>@example/arcade-playground</code> on Paseo Asset Hub. Any game that registers
          with the Arcade and calls <code>recordScore</code> after each submit will show up here —
          see the starter template for a working example.
        </p>
      </footer>
    </div>
  );
}
