import type { ScoreEntry, ScoreOrdering } from "./api";

// The narrow chain/SDK boundary the scoreboard logic depends on. The real
// implementation (sdk-gateway.ts) wires product-sdk's SignerManager +
// ensureAccountMapped + submitAndWatch and @polkadot-api/sdk-ink reads against
// the GCS reference contract. Unit tests inject a fake — they MUST NOT import
// the real product-sdk. This is the single seam between policy (scoreboard.ts)
// and the chain.
export interface ChainGateway {
  // Immutable contract metadata (SPEC §4.2). Cached for the session by the impl.
  scoreOrdering(): Promise<ScoreOrdering>;

  // The signed-in player's H160, or null when no host account is connected
  // (guest mode). Synchronous read of cached connection state.
  currentPlayer(): `0x${string}` | null;

  // Connect a host wallet account via SignerManager (SPEC §8.1: the host
  // wallet account, NOT a product account). Resolves to the player's H160.
  // Rejects if the host is unavailable or the user declines.
  connect(): Promise<`0x${string}`>;

  // ensureAccountMapped for the connected player (idempotent pallet_revive
  // mapping). Safe to call before every submit; short-circuits when mapped.
  ensureMapped(): Promise<void>;

  // submitScore(score) on the GCS contract from the connected player, resolving
  // at best-block inclusion (SPEC §4.2 / §8.1).
  submitScore(score: number): Promise<void>;

  // GCS reads for the in-game scoreboard (SPEC §4.2).
  getLeaderboard(offset: number, limit: number): Promise<ScoreEntry[]>;
  getRecent(offset: number, limit: number): Promise<ScoreEntry[]>;
  getBest(player: `0x${string}`): Promise<number | null>;
}

// Where a guest's held score survives the session (SPEC §8.3:
// "the score is held locally … may be kept in host/local storage").
// `globalThis.localStorage` satisfies this; tests pass an in-memory fake.
export interface GuestStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
