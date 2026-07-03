// Live activity rail (SPEC §7.1 item 5): a merged feed of recent plays across
// games, built from a bounded merge — getRecent from at most the 10
// most-recently-active games (logic.activityGameSet / mergeActivity). Separate
// component from the leaderboard (SPEC §4.5).

import { useEffect, useState } from "react";
import { useReads } from "../reads-context";
import {
  ACTIVITY_FEED_LIMIT,
  activityGameSet,
  displayName,
  mergeActivity,
  relativeTime,
  shortAddress,
} from "../logic";
import { useNow } from "./useNow";
import { gameHref } from "../router";
import type { ActivityItem, Address, Game, ScoreEntry } from "../types";

export function ActivityRail({
  games,
  refreshKey,
}: {
  games: Game[];
  refreshKey?: number;
}) {
  const reads = useReads();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Wall-clock tick so relative times advance independent of block refresh
  // (§9.3: the rail keeps showing last-good rows with timestamps ticking).
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Bounded set: ≤10 most-recently-active games (SPEC §7.1/§7.4).
      const set = activityGameSet(games);
      const nameByAddr = new Map<Address, string>(
        games.map((g) => [g.listing.address, g.listing.name]),
      );
      const perGame = new Map<Address, ScoreEntry[]>();
      // Read each game's recent ring; one game's failed read degrades to an
      // empty slice for that game only (§9.3), never sinking the whole rail.
      await Promise.all(
        set.map(async (addr) => {
          try {
            perGame.set(
              addr,
              await reads.getRecent(addr, 0, ACTIVITY_FEED_LIMIT),
            );
          } catch {
            perGame.set(addr, []);
          }
        }),
      );
      if (cancelled) return;

      const merged = mergeActivity(perGame, nameByAddr);
      const playerNames = await Promise.all(
        merged.map(async (m) => {
          try {
            return displayName(m.player, await reads.resolveName(m.player));
          } catch {
            return displayName(m.player);
          }
        }),
      );
      if (cancelled) return;

      setItems((prev) => {
        // If this refresh yielded nothing but we already have last-good rows,
        // keep them (§9.3: never blank a populated rail on a stalled refresh).
        if (merged.length === 0 && prev.length > 0) return prev;
        return merged.map((m, i) => ({ ...m, playerName: playerNames[i] }));
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [reads, games, refreshKey]);

  return (
    <aside className="rail" aria-label="Live activity">
      <h2 className="section__title">Live activity</h2>
      {!loaded ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">No recent plays yet.</p>
      ) : (
        <ul className="rail__list">
          {items.map((it, i) => {
            const player = it.playerName ?? displayName(it.player);
            return (
              <li
                key={`${it.game}-${it.player}-${it.at}-${i}`}
                className="rail__row"
              >
                <span className="rail__player" title={player}>
                  {player}
                </span>
                <a className="rail__game" href={gameHref(it.game)}>
                  {it.gameName || shortAddress(it.game)}
                </a>
                <span className="rail__time muted">
                  {relativeTime(it.at, now)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
