// The narrow chain-boundary interface the UI consumes. The real implementation
// (chain-reads.ts) talks to PAPI + sdk-ink; tests and the Playwright e2e inject
// a fake that satisfies this same interface (SPEC §7 — the dashboard is purely a
// read surface, so this is the ONLY seam between UI and chain).
//
// Everything here returns already-normalized domain types (types.ts): numbers
// for u32/u64, bigint for u128. Conformance gating, sorting, merging and
// formatting all live in logic.ts and operate on these results — this interface
// is dumb I/O only.

import type {
  Address,
  Game,
  Listing,
  ScoreConfig,
  ScoreEntry,
} from "./types";

export interface ArcadeReads {
  // Enumerate the registry once (SPEC §5.3, §7.4), apply the arcadeVersion()
  // conformance gate (SPEC §7.4), batch each game's Module A stats (§7.4), and
  // return only conformant, listed games. Implementations decide pagination and
  // caching; the UI just awaits the filtered list.
  listGames(): Promise<Game[]>;

  // Single listing lookup (SPEC §5.3 getListing) for a detail-page deep link
  // where the home list hasn't loaded. Null if absent or non-conformant.
  getGame(address: Address): Promise<Game | null>;

  // Immutable score config (SPEC §4.2), cached per session by the impl.
  getScoreConfig(address: Address): Promise<ScoreConfig>;

  // SPEC §4.2 getLeaderboard(offset, limit), sorted best-first.
  getLeaderboard(
    address: Address,
    offset: number,
    limit: number,
  ): Promise<ScoreEntry[]>;

  // SPEC §4.2 getRecent(offset, limit), newest-first ring.
  getRecent(
    address: Address,
    offset: number,
    limit: number,
  ): Promise<ScoreEntry[]>;

  // SPEC §8.2 name resolution seam. For item 11/12 this returns a truncated
  // address; item 14 wires DotNS reverse resolution + identicon. Kept on the
  // reads interface so the UI never imports a name source directly.
  resolveName(player: Address): Promise<string>;

  // SPEC §7.4 refresh signal: subscribe to new best blocks. The callback fires
  // with the head block number; returns an unsubscribe fn. Fakes may no-op.
  onNewBlock(cb: (blockNumber: number) => void): () => void;
}

// Re-exported for fakes/tests so they can build domain objects without reaching
// into the impl.
export type { Game, Listing, ScoreConfig, ScoreEntry, Address };
