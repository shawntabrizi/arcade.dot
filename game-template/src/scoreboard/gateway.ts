import type { ScoreEntry, ScoreOrdering } from "./api";

// The narrow chain/SDK boundary the scoreboard logic depends on. The real
// implementation (sdk-gateway.ts) wires @novasamatech/host-api-wrapper's
// product-account provider + signer, ensureAccountMapped + submitAndWatch, and
// @polkadot-api/sdk-ink reads against the GCS reference contract. Unit tests
// inject a fake — they MUST NOT import the real host SDK. This is the single
// seam between policy (scoreboard.ts) and the chain.
// The host/login situation detected on load WITHOUT prompting (SPEC §8.1/§8.3).
// `inHost` is true when a host transport responded (running inside the Polkadot
// app or dot.li web host). `account` is the signed-in product account, or null
// when nobody is connected (a guest — whether in-host or standalone). The three
// UX states are (inHost, account):
//   account != null              → SIGNED IN
//   account == null && inHost    → IN-HOST GUEST (sign-in available now)
//   account == null && !inHost   → STANDALONE GUEST (sign-in unavailable)
export interface SessionInfo {
  inHost: boolean;
  account: { ss58: string; h160: `0x${string}` } | null;
}

export interface ChainGateway {
  // Immutable contract metadata (SPEC §4.2). Cached for the session by the impl.
  scoreOrdering(): Promise<ScoreOrdering>;

  // PROMPT-FREE login-status read for on-load UX (SPEC §8.1/§8.3). Kicks off
  // the prompt-free product-account fetch (getProductAccount returns
  // NotConnected rather than opening a login UI); it MUST NOT open a login
  // prompt. Returns the latest known session; the App re-reads when
  // subscribeSession fires after detection resolves.
  detectSession(): SessionInfo;

  // Subscribe to passive session changes (the host connects/disconnects an
  // account, e.g. after connect() resolves). Fires on change; returns an
  // unsubscribe. The callback re-reads detectSession() for the new state.
  subscribeSession(cb: () => void): () => void;

  // The signed-in player's H160, or null when no account is connected (guest
  // mode). Synchronous read of cached connection state.
  currentPlayer(): `0x${string}` | null;

  // Connect the player's per-app PRODUCT ACCOUNT via the host (SPEC §8.1),
  // opening the host login UI if needed. Resolves to the player's H160. Rejects
  // if the host is unavailable or the user declines.
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
