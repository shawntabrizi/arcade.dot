// Live activity rail (SPEC §7.1 item 5): a merged feed of recent plays across
// games, built from a BOUNDED merge — getRecent from at most the 10
// most-recently-active games (logic.activityGameSet / mergeActivity). Separate
// component from the leaderboard (SPEC §4.5). Item 13 finalizes per-block
// refresh + graceful degradation; this implements the bounded-merge fetch and
// renders it, refreshing when its `refreshKey` changes.

import { useEffect, useState } from "react";
import { useReads } from "../reads-context";
import {
  ACTIVITY_FEED_LIMIT,
  activityGameSet,
  mergeActivity,
  relativeTime,
  shortAddress,
} from "../logic";
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Bounded set: ≤10 most-recently-active games (SPEC §7.1/§7.4).
      const set = activityGameSet(games);
      const nameByAddr = new Map<Address, string>(
        games.map((g) => [g.listing.address, g.listing.name]),
      );
      const perGame = new Map<Address, ScoreEntry[]>();
      // Read each game's recent ring; one failure doesn't sink the rail.
      await Promise.all(
        set.map(async (addr) => {
          const rows = await reads.getRecent(addr, 0, ACTIVITY_FEED_LIMIT);
          perGame.set(addr, rows);
        }),
      );
      if (cancelled) return;
      // Resolve player names for the merged feed.
      const merged = mergeActivity(perGame, nameByAddr);
      const playerNames = await Promise.all(
        merged.map((m) => reads.resolveName(m.player)),
      );
      if (cancelled) return;
      setItems(merged.map((m, i) => ({ ...m, playerName: playerNames[i] })));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          {items.map((it, i) => (
            <li key={`${it.game}-${it.player}-${it.at}-${i}`} className="rail__row">
              <span className="rail__player" title={it.player}>
                {it.playerName ?? shortAddress(it.player)}
              </span>
              <a className="rail__game" href={gameHref(it.game)}>
                {it.gameName || shortAddress(it.game)}
              </a>
              <span className="rail__time muted">{relativeTime(it.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
