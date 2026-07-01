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

// Everything the Account tab shows about the connected PRODUCT account (SPEC
// §8.1). The host derives this per-app account from the user's root account
// (which the host keeps private — NOT exposed here), so this is the only
// identity an app can read. Balances are native-token planck on Asset Hub.
export interface AccountDetails {
  identifier: string; // the .dot product identifier, e.g. "arcade-snake.dot"
  derivationIndex: number; // soft-derivation index (0 for the app's default account)
  ss58: string; // the product account's SS58 (used by the faucet + balance reads)
  h160: `0x${string}`; // the H160 the GCS contract sees as caller()
  free: bigint; // spendable balance (planck)
  reserved: bigint; // reserved balance (planck) — e.g. storage deposits
  mapped: boolean; // pallet_revive mapping status (unmapped → can't save scores)
  decimals: number; // native token decimals (for formatting)
  symbol: string; // native token symbol (e.g. "PAS")
}

export interface ChainGateway {
  // Immutable contract metadata (SPEC §4.2). Cached for the session by the impl.
  scoreOrdering(): Promise<ScoreOrdering>;

  // Account-tab read: the connected product account + balance + mapping status,
  // or null when nobody is signed in (the host only exposes the account once the
  // user is connected). One round-trip the Account tab calls on open/refresh.
  accountDetails(): Promise<AccountDetails | null>;

  // Map the connected product account in pallet_revive (map_account) on its own,
  // so a player can pre-map (reserving the storage deposit) without playing.
  // No-op if already mapped. submitScore still maps-if-needed in its batch.
  mapAccount(): Promise<void>;

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

  // submitScore(score) on the GCS contract from the connected player, resolving
  // at best-block inclusion (SPEC §4.2 / §8.1). Maps the account (pallet_revive
  // map_account) and submits in ONE batch_all extrinsic when the account isn't
  // mapped yet — a single host approval, not two (the player only pulls out
  // their phone once). When already mapped it's a plain submit.
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
