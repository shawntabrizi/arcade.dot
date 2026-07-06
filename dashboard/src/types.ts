// Domain types for the dashboard. These mirror the on-chain shapes (SPEC §4, §5)
// but are normalized to plain JS values (numbers for u32/u64 timestamps, bigint
// for u128 scores) so the UI and pure-logic modules never touch chain codecs.

export type Address = `0x${string}`;

// SPEC §5.1 ListingMetadata + Listing, flattened for the UI. Field names are
// camelCase here (the ABI tuple uses snake_case; the reads layer maps them).
export interface Listing {
  address: Address;
  name: string;
  gameType: string;
  shortDescription: string;
  playUrl: string;
  thumbnailCid: string;
  requiresAccount: boolean;
  extraCid: string;
  metaVersion: number;
  registeredAt: number; // unix seconds
  updatedAt: number; // unix seconds
}

// SPEC §4.1 Module A activity stats, batched per game (SPEC §7.4).
export interface GameStats {
  playCount: number;
  uniquePlayers: number;
  lastPlayedAt: number; // unix seconds; 0 = never played
}

// SPEC §4.2 immutable score config, cached for the session. Only the display
// fields: the dashboard never re-sorts (getLeaderboard returns contract-sorted
// rows), so scoreOrdering is not read.
export interface ScoreConfig {
  // 0 = points (int), 1 = duration ms (m:ss.mmm), 2 = custom unit
  scoreFormat: number;
  scoreUnit: string;
}

// SPEC §4.2 Entry { player, score, at }. Used by both leaderboard and recent ring.
export interface ScoreEntry {
  player: Address;
  score: bigint;
  at: number; // unix seconds
}

// A conformant, listed game: registry listing + Module A stats. The activity
// rail and cards consume this; the detail page additionally fetches ScoreConfig
// and paginated entries.
export interface Game {
  listing: Listing;
  stats: GameStats;
}

// One row in the merged live-activity rail (SPEC §7.1 item 5): a recent play
// tagged with the game it came from.
export interface ActivityItem {
  game: Address;
  gameName: string;
  player: Address;
  score: bigint;
  at: number; // unix seconds
  // Filled by the UI after name resolution (SPEC §8.2); absent until resolved.
  playerName?: string;
}
