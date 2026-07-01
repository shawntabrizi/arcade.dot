import type { ScoreOrdering } from "./api";
import type { AccountDetails, ChainGateway, GuestStore, SessionInfo } from "./gateway";

// Namespaced per game so two template games on the same origin don't collide.
const GUEST_KEY_PREFIX = "arcade:guest-best:";

export interface ScoreboardConfig {
  // Stable key for this game's guest-store entry (e.g. the .dot domain or the
  // GCS contract address). Keeps guest bests separated per game on one origin.
  gameKey: string;
  // SPEC §5.1 / §8.3: when true, the game gates sign-in at launch instead of at
  // game over. The template surfaces this; the dashboard badges it.
  requiresAccount?: boolean;
}

// Result of feeding a finished match into the scoreboard. The UI reads this to
// decide what to show: a sign-in nudge (guest, worth keeping), a confirmed
// submit (signed-in), or nothing (not worth keeping / no contract).
export type GameOverOutcome =
  | { kind: "confirm"; score: number } // signed-in, worth keeping → "Save your score?"
  | { kind: "prompt"; score: number } // guest, worth keeping → "sign in to save"
  | { kind: "ignored"; score: number }; // not worth keeping (no prompt, no write)

// SPEC §4.2 score ordering: 0 = higher is better, 1 = lower is better.
// "Worth keeping" = improves the locally-known best, OR there is no known best.
// This is what gates the save-score nudge (SPEC §8.3) so we never pester a
// guest about a score that wouldn't change their standing.
export function isWorthKeeping(
  score: number,
  knownBest: number | null,
  ordering: ScoreOrdering,
): boolean {
  if (knownBest === null) return true;
  return ordering === 1 ? score < knownBest : score > knownBest;
}

// The better of two scores under the ordering (SPEC §4.2); null means "none yet".
// Used to keep a running session best (App display + the monotonic held best).
export function pickBetter(
  a: number | null,
  b: number | null,
  ordering: ScoreOrdering,
): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return isWorthKeeping(b, a, ordering) ? b : a;
}

function guestKey(gameKey: string): string {
  return `${GUEST_KEY_PREFIX}${gameKey}`;
}

// Guest mode = zero chain interaction (SPEC §8.3). The held best survives the
// session via the GuestStore (localStorage in production). Stored as the best
// seen so far, not a log — the template's in-game board reads the contract;
// this only powers the "worth keeping" decision and score restoration.
export function readGuestBest(store: GuestStore, gameKey: string): number | null {
  const raw = store.getItem(guestKey(gameKey));
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function writeGuestBest(store: GuestStore, gameKey: string, score: number): void {
  store.setItem(guestKey(gameKey), String(score));
}

export function clearGuestBest(store: GuestStore, gameKey: string): void {
  store.removeItem(guestKey(gameKey));
}

// Orchestrates SPEC §8 identity policy over the narrow ChainGateway seam.
// Holds no React state; the App composes it and reacts to outcomes.
//
// Submit-once + ask-before-signing: the game calls onGameEnd(score) exactly
// once per match (SPEC §10.4). onGameEnd NEVER signs — it only decides what to
// show. Both signed-in ("confirm") and guest ("prompt") defer the actual
// signing to an explicit saveHeldScore() the UI calls when the player opts in,
// so we never trigger a phone approval the player didn't ask for.
export class Scoreboard {
  private readonly gateway: ChainGateway;
  private readonly store: GuestStore;
  private readonly gameKey: string;
  readonly requiresAccount: boolean;

  // The guest's most recent worth-keeping score, awaiting a sign-in decision.
  // Distinct from the persisted guest best: this is the one we'd submit.
  private held: number | null = null;

  constructor(gateway: ChainGateway, store: GuestStore, config: ScoreboardConfig) {
    this.gateway = gateway;
    this.store = store;
    this.gameKey = config.gameKey;
    this.requiresAccount = config.requiresAccount ?? false;
  }

  isSignedIn(): boolean {
    return this.gateway.currentPlayer() !== null;
  }

  // PROMPT-FREE on-load login-status read (SPEC §8.1/§8.3). Passthrough so the
  // UI never reaches into the gateway. The UI maps the returned SessionInfo to
  // the three states (SIGNED IN / IN-HOST GUEST / STANDALONE GUEST).
  detectSession(): SessionInfo {
    return this.gateway.detectSession();
  }

  // Subscribe to passive session changes (host connects/disconnects). Returns
  // an unsubscribe; the callback should re-read detectSession().
  subscribeSession(cb: () => void): () => void {
    return this.gateway.subscribeSession(cb);
  }

  // The connected player's H160, or null in guest mode. Passthrough so the UI
  // never reaches into the gateway.
  currentPlayer(): `0x${string}` | null {
    return this.gateway.currentPlayer();
  }

  // SPEC §8.3: requiresAccount games gate sign-in at launch. Returns true when
  // the game must ask for sign-in before play begins.
  gatesAtLaunch(): boolean {
    return this.requiresAccount && !this.isSignedIn();
  }

  // The locally-known best for the active identity: the signed-in player's
  // on-chain best, or the guest's held/persisted best. Used to decide whether a
  // new score is worth keeping without a chain round-trip on the guest path.
  private async knownBest(): Promise<number | null> {
    const player = this.gateway.currentPlayer();
    if (player !== null) return this.gateway.getBest(player);
    return readGuestBest(this.store, this.gameKey);
  }

  // Public read of the active identity's already-recorded best (on-chain for a
  // signed-in player, persisted locally for a guest). The UI seeds the displayed
  // "Best" from this so it reflects the player's true record — including scores
  // from earlier sessions in the contract history — not just this session.
  async currentBest(): Promise<number | null> {
    return this.knownBest();
  }

  // Connect a host wallet account (SPEC §8.1). Returns the player's H160.
  async signIn(): Promise<`0x${string}`> {
    return this.gateway.connect();
  }

  // Account-tab reads/writes (SPEC §8.1). Passthroughs so the UI never reaches
  // into the gateway. accountDetails() returns null when nobody is signed in.
  async accountDetails(): Promise<AccountDetails | null> {
    return this.gateway.accountDetails();
  }

  async mapAccount(): Promise<void> {
    return this.gateway.mapAccount();
  }

  // Single entry point for a finished match (one call per onGameEnd). NEVER
  // signs — only decides what to show; signing happens later in saveHeldScore.
  //   - not worth keeping → "ignored" (no prompt, no chain touch, no signing).
  //   - signed in + worth keeping → hold, return "confirm" ("Save your score?").
  //   - guest + worth keeping → persist locally, hold, return "prompt".
  // Gating on worth-keeping (a personal best) — even when signed in — means we
  // never ask the player to sign for a score that wouldn't change the board.
  async onGameEnd(score: number): Promise<GameOverOutcome> {
    const ordering = await this.gateway.scoreOrdering();
    const saved = await this.knownBest();
    // The best we'd actually submit: the better of what's already saved (the
    // signed-in player's on-chain best, or the guest's persisted best) and any
    // best we're already holding from earlier rounds this session. Comparing the
    // new score against THIS — not just `saved` — keeps `held` monotonic: a
    // player who replays and scores worse-but-still-better-than-saved can never
    // lower the held best they'd submit (the score they came back to submit).
    const effectiveBest =
      this.held === null ? saved : pickBetter(saved, this.held, ordering);
    if (!isWorthKeeping(score, effectiveBest, ordering)) {
      return { kind: "ignored", score };
    }

    // The score beats the effective best → it is the new session best to submit.
    this.held = score;
    if (this.isSignedIn()) {
      // Ask before signing: no phone approval until the player taps Save.
      return { kind: "confirm", score };
    }
    // Guest, worth keeping: persist so it survives the session, hold for submit.
    writeGuestBest(this.store, this.gameKey, score);
    return { kind: "prompt", score };
  }

  // Called when the player opts in — a signed-in player tapping "Save your
  // score?" (confirm), or a guest accepting the "sign in to save" nudge
  // (SPEC §8.3). Connects if needed → ensureAccountMapped → submitScore the held
  // score. Idempotent against the held value; clears the guest hold on success.
  async saveHeldScore(): Promise<void> {
    if (this.held === null) return;
    const score = this.held;
    if (!this.isSignedIn()) {
      await this.gateway.connect();
    }
    await this.submit(score);
    this.held = null;
    clearGuestBest(this.store, this.gameKey);
  }

  // The single submit funnel. submitScore maps-if-needed and submits in one
  // batched approval (see ChainGateway.submitScore) — one phone pull, not two.
  private async submit(score: number): Promise<void> {
    await this.gateway.submitScore(score);
  }

  heldScore(): number | null {
    return this.held;
  }
}
