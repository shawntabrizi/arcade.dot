import { useCallback, useEffect, useMemo, useState } from "react";
import { Gamepad2, Trophy, History, ChevronLeft, User, Copy, Check } from "lucide-react";
import { getTruApi, isInsideContainerSync } from "@parity/product-sdk-host";
import { ActiveGame, ACTIVE_GAME_TITLE } from "./games/active";
import type { ScoreEntry, ScoreOrdering } from "./scoreboard/api";
import type { AccountDetails } from "./scoreboard/gateway";
import { Leaderboard, shortAddress } from "./scoreboard/Leaderboard";
import { contractScoreboard, isContractDeployed } from "./scoreboard/reads";
import { Scoreboard, pickBetter } from "./scoreboard/scoreboard";
import { createSdkGateway } from "./scoreboard/sdk-gateway";
import { createFakeGateway } from "./scoreboard/fake-gateway";
import { getGcsAddress } from "./scoreboard/gcs";
import { derivationPath, faucetUrl, formatBalance } from "./account";
import arcadeConfig from "../arcade.config.json";

// ⚠ TEST-ONLY seam (SPEC §8.3 Playwright flows). When VITE_ARCADE_FAKE_GATEWAY
// is set, the composition root swaps the real product-sdk ChainGateway for the
// in-browser fake (fake-gateway.ts), driven per-test via window.__ARCADE_FAKE__.
// The fake is referenced only on the FAKE_GATEWAY branch below; with the flag
// unset, Vite tree-shakes it out of a normal build, which never imports a chain.
const FAKE_GATEWAY = import.meta.env.VITE_ARCADE_FAKE_GATEWAY === "1";

// Every arcade game links back to the discovery dashboard (imposed by the shell,
// so every game gets it for free). Opens in-host via the validated cross-dApp
// pattern (target=_blank to the .dot.li URL, §7.5). Override with VITE_ARCADE_URL.
const ARCADE_URL = import.meta.env.VITE_ARCADE_URL || "https://arcade.dot.li";

// ── Template configuration (SPEC §6.5 / §8.3 / §10.4) ───────────────────────
// arcade.config.json is the single source of truth (SPEC §6.5). `requiresAccount`
// here is the SAME flag the deploy pipeline writes to the on-chain listing, so
// the in-game launch gate and the dashboard badge never disagree. Set it to true
// for multiplayer / on-chain-state games that cannot be played as a guest:
// sign-in is then required at launch instead of at game over (SPEC §8.3).
// requiresAccount: from config in a real build; from the per-test fake config
// (window.__ARCADE_FAKE__) under the test flag so test 4 can toggle the launch
// gate without a rebuild.
const REQUIRES_ACCOUNT = FAKE_GATEWAY
  ? globalThis.window?.__ARCADE_FAKE__?.config.requiresAccount === true
  : arcadeConfig.requiresAccount === true;

// Score ordering (SPEC §4.2): 0 = higher is better, 1 = lower is better. The
// single source is arcade.config.json's contract.scoreOrdering; the in-game
// Leaderboard sorts by it so lower-is-better genres (aim trainer, solitaire by
// moves) rank correctly. Under the test flag it comes from the per-test fake
// config so e2e can drive the sort without a rebuild. Defaults to 0 (higher).
const SCORE_ORDERING: ScoreOrdering = FAKE_GATEWAY
  ? (globalThis.window?.__ARCADE_FAKE__?.config.ordering ?? 0)
  : ((arcadeConfig.contract?.scoreOrdering as ScoreOrdering) ?? 0);

// Optional unit suffix for displayed scores (e.g. "guesses" for Wordle). Purely
// cosmetic for the Last/Best line; the on-chain value is always the raw number.
const SCORE_UNIT = FAKE_GATEWAY ? "" : (arcadeConfig.contract?.scoreUnit ?? "");
const fmtScore = (n: number) => (SCORE_UNIT ? `${n} ${SCORE_UNIT}` : `${n}`);

const SCOREBOARD = contractScoreboard;
// Under the test flag the (faked) contract is always "deployed" so the
// save-score / submit flow is active without a chain.
const CONTRACT_DEPLOYED = FAKE_GATEWAY || isContractDeployed();
// Guest scores survive the session keyed per game; the GCS address is a stable
// per-game key on this origin.
const GAME_KEY = getGcsAddress() ?? "local";

// The save lifecycle. The Last/Best line + submit affordance are driven by
// `submittable` (is there a session best worth saving?), so the game-over UI
// persists across replays instead of vanishing after a non-best round; `phase`
// only tracks the actual save round-trip.
type Phase = "idle" | "submitting" | "submitted" | "error";
type Tab = "play" | "scores" | "recent" | "account";

// Open a .dot host app URL (the Arcade back link). Inside the host this MUST go
// through navigateTo — the desktop webview denies window.open/target=_blank for
// in-host app navigation, so a plain anchor does nothing; standalone web falls
// back to a new tab. (External sites like the faucet are different: a normal
// target=_blank link is fine — the host opens those in the system browser.)
function openHostUrl(url: string): void {
  if (isInsideContainerSync()) {
    void getTruApi().then((t) => {
      t?.navigateTo({ tag: "v1", value: url });
    });
  } else {
    window.open(url, "_blank", "noopener");
  }
}

// One labelled, copyable address row (used for both the SS58 and H160). The
// address gets its OWN full-width line and is shown IN FULL — it wraps only when
// it genuinely doesn't fit (break-all), instead of being pre-truncated. The
// label + Copy button share the row above, so the copy button never steals the
// address's horizontal space.
function AddressRow({
  label,
  full,
  copyKey,
  copied,
  onCopy,
}: {
  label: string;
  full: string;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-secondary m-0">{label}</p>
        <button
          type="button"
          onClick={() => onCopy(copyKey, full)}
          aria-label={`Copy ${label}`}
          className="shrink-0 inline-flex items-center gap-1 bg-surface-nested text-secondary hover:text-primary rounded-small px-2 py-1 text-xs transition-colors cursor-pointer"
        >
          {copied === copyKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied === copyKey ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="text-sm text-primary break-all leading-snug">{full}</code>
    </div>
  );
}

export function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);
  // The best score this session (for display), and whether that best is worth
  // submitting (better than what's already saved for this identity).
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [submittable, setSubmittable] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<`0x${string}` | null>(null);
  // Drives which 100dvh panel shows on mobile; desktop ignores it (CSS shows
  // the game + boards columns side by side and hides the tab bar).
  const [tab, setTab] = useState<Tab>("play");
  // Optimistic: the player's just-played score, shown on the board immediately
  // and reconciled when the real submit lands. Only set once submitted.
  const [pendingEntry, setPendingEntry] = useState<ScoreEntry | null>(null);
  // Account tab (SPEC §8.1): the connected product account + balance + mapping,
  // loaded on demand when the tab is open and signed in.
  const [account, setAccount] = useState<AccountDetails | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [mapping, setMapping] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // One Scoreboard for the session, over the real product-sdk gateway. The
  // gateway is the only thing that touches the chain (SPEC §8.1).
  const scoreboard = useMemo(
    () =>
      new Scoreboard(
        FAKE_GATEWAY
          ? createFakeGateway()
          : // dot.li exposes only a per-app PRODUCT ACCOUNT (derived from the
            // user's root session + the app's .dot identifier); raw wallet
            // accounts come back empty. dotNsIdentifier MUST equal the deployed
            // domain (arcade.config.json `domain`) or the host rejects the
            // account request. (SPEC §8.1 — revised after the item-6 in-host test.)
            createSdkGateway({ dotNsIdentifier: `${arcadeConfig.domain}.dot` }),
        globalThis.localStorage,
        {
          gameKey: GAME_KEY,
          requiresAccount: REQUIRES_ACCOUNT,
        },
      ),
    [],
  );

  // SPEC §8.1/§8.3: detect the login status on load WITHOUT prompting (only
  // getState() + the sync in-host heuristic), and keep it current via the
  // gateway's passive subscription. This drives the three honest UX states:
  //   account != null           → SIGNED IN (auto-submit at game over)
  //   account == null && inHost  → IN-HOST GUEST (offer sign-in now)
  //   account == null && !inHost → STANDALONE GUEST (no sign-in; guest only)
  const [session, setSession] = useState(() => scoreboard.detectSession());
  useEffect(() => {
    const refresh = () => {
      const next = scoreboard.detectSession();
      setSession(next);
      if (next.account) setPlayer(next.account.h160);
    };
    refresh(); // re-read after mount in case state changed before subscribing
    return scoreboard.subscribeSession(refresh);
  }, [scoreboard]);
  const signedIn = session.account !== null;

  // SPEC §8.3: requiresAccount games gate sign-in at LAUNCH (before play),
  // not at game over. Guest-mode games never gate. `gated` clears once a host
  // wallet account is connected.
  const [gated, setGated] = useState(() => CONTRACT_DEPLOYED && scoreboard.gatesAtLaunch());

  const signInAtLaunch = useCallback(async () => {
    setError(null);
    try {
      const me = await scoreboard.signIn();
      setPlayer(me);
      setGated(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [scoreboard]);

  // IN-HOST GUEST → SIGNED IN, on explicit user action (the ONE place a host
  // prompt may fire, SPEC §8.1). Available NOW, not only at game over. On
  // success the session subscription transitions the UI to SIGNED IN; we also
  // set state here for immediacy.
  const signInNow = useCallback(async () => {
    setError(null);
    try {
      const me = await scoreboard.signIn();
      setPlayer(me);
      setSession(scoreboard.detectSession());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [scoreboard]);

  // Place the just-played score on the board for whoever is signed in.
  const showOptimistic = useCallback(
    (score: number) => {
      const p = scoreboard.currentPlayer();
      if (p) {
        setPlayer(p);
        setPendingEntry({ player: p, score, timestamp: Math.floor(Date.now() / 1000) });
      }
    },
    [scoreboard],
  );

  // The game calls this once per match (SPEC §10.4). It updates the local Last
  // and Best scores and asks the scoreboard whether the running best is worth
  // submitting — it NEVER signs. The player submits their best when they choose,
  // after playing as many rounds as they like (the held best stays the best of
  // the session; see scoreboard.onGameEnd).
  const onGameEnd = useCallback(
    async (score: number) => {
      setLastScore(score);
      setBestScore((prev) => pickBetter(prev, score, SCORE_ORDERING));
      setError(null);
      if (phase === "error" || phase === "submitted") setPhase("idle");
      if (!CONTRACT_DEPLOYED) return;
      try {
        await scoreboard.onGameEnd(score);
        setSubmittable(scoreboard.heldScore() !== null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    },
    [scoreboard, phase],
  );

  // SPEC §8.3: the conversion moment — connect host wallet → ensureAccountMapped
  // → submitScore the held BEST score. One flow, inherited by every template
  // game. Triggered explicitly by the player tapping "Submit best score".
  const saveScore = useCallback(async () => {
    const submitted = scoreboard.heldScore();
    setPhase("submitting");
    setError(null);
    try {
      await scoreboard.saveHeldScore();
      if (submitted !== null) showOptimistic(submitted);
      setSubmittable(false);
      setPhase("submitted");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [scoreboard, showOptimistic]);

  // Account tab: fetch the product account + balance + mapping (SPEC §8.1).
  const loadAccount = useCallback(async () => {
    setAccountLoading(true);
    setAccountError(null);
    try {
      setAccount(await scoreboard.accountDetails());
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : String(err));
    } finally {
      setAccountLoading(false);
    }
  }, [scoreboard]);

  // Load (and refresh) account details whenever signed in. We do NOT gate on
  // tab === "account": the Account panel is a tab on mobile but is ALWAYS visible
  // on desktop (no tab bar), where `tab` stays "play" — so a tab gate would never
  // load it on desktop and the panel showed "Couldn't load your account". Loading
  // on sign-in covers both viewports; refreshKey re-runs it after a score submit
  // so the balance/mapping stay live.
  useEffect(() => {
    if (signedIn) void loadAccount();
  }, [signedIn, refreshKey, loadAccount]);

  // Seed the displayed "Best" from the player's ALREADY-RECORDED best (on-chain
  // for a signed-in player, persisted locally for a guest), so it reflects their
  // true record — including higher scores from earlier sessions in the contract
  // history — not just this session's play. Combined with session scores via
  // pickBetter; re-runs on sign-in and after a submit (refreshKey).
  useEffect(() => {
    if (!CONTRACT_DEPLOYED) return;
    let cancelled = false;
    void scoreboard
      .currentBest()
      .then((b) => {
        if (!cancelled && b !== null) {
          setBestScore((prev) => pickBetter(prev, b, SCORE_ORDERING));
        }
      })
      .catch(() => {
        /* best is a display convenience — never block the game on it */
      });
    return () => {
      cancelled = true;
    };
  }, [scoreboard, signedIn, refreshKey]);

  // Map the product account on its own (pallet_revive), then refresh the tab.
  const mapNow = useCallback(async () => {
    setMapping(true);
    setAccountError(null);
    try {
      await scoreboard.mapAccount();
      await loadAccount();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : String(err));
    } finally {
      setMapping(false);
    }
  }, [scoreboard, loadAccount]);

  const copy = useCallback((label: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    });
  }, []);

  // The session status line (three honest SPEC §8.1/§8.3 states). Kept in one
  // place so it can sit in the Play panel header on every viewport.
  const statusLine = signedIn ? (
    <p className="text-sm text-secondary m-0" data-session="signed-in">
      Signed in as{" "}
      <code className="text-primary" title={session.account!.h160}>
        {shortAddress(session.account!.h160)}
      </code>{" "}
      — submit your best score whenever you&rsquo;re ready.
    </p>
  ) : session.inHost ? (
    <p className="text-sm text-secondary m-0" data-session="in-host-guest">
      You&rsquo;re in the Polkadot app — sign in to keep your scores.{" "}
      <button
        type="button"
        onClick={signInNow}
        className="text-link hover:text-link-hover underline bg-transparent border-0 p-0 m-0 font-inherit cursor-pointer"
      >
        Sign in
      </button>
      {error && <span className="text-error"> Couldn&rsquo;t sign in: {error}</span>}
    </p>
  ) : (
    <p className="text-sm text-secondary m-0" data-session="standalone-guest">
      Guest mode — open this game in the Polkadot app to save scores.
    </p>
  );

  // Persistent game-over affordance: track Last + Best across replays and let
  // the player submit their BEST when they're ready (SPEC §8.3). Unlike a
  // transient nudge, this stays available after a worse round, so "play a few
  // times, then submit your best" works. Driven by `submittable` + the save
  // `phase`, not by the most recent round's outcome.
  const submitArea = (() => {
    if (phase === "submitting") {
      return <p className="text-sm text-secondary m-0">Saving your best…</p>;
    }
    if (phase === "submitted") {
      return (
        <p className="text-sm text-success m-0">
          Best saved
          {player && (
            <>
              {" "}
              as{" "}
              <code className="text-primary" title={player}>
                {shortAddress(player)}
              </code>
            </>
          )}
          . Keep playing to beat it.
        </p>
      );
    }
    if (phase === "error" && error) {
      return (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-error m-0 break-words">Couldn&rsquo;t save: {error}</p>
          <button
            type="button"
            onClick={saveScore}
            className="bg-action-secondary text-primary font-medium text-sm px-4 py-2 rounded-small hover:bg-action-secondary-hover transition-colors cursor-pointer"
          >
            Try again
          </button>
        </div>
      );
    }
    if (!submittable) return null;
    if (signedIn) {
      return (
        <button
          type="button"
          onClick={saveScore}
          className="bg-action-primary text-primary-inverted font-medium text-sm px-4 py-2 rounded-small hover:bg-action-primary-hover transition-colors cursor-pointer"
        >
          Submit best score
        </button>
      );
    }
    if (session.inHost) {
      return (
        <button
          type="button"
          onClick={saveScore}
          className="bg-action-primary text-primary-inverted font-medium text-sm px-4 py-2 rounded-small hover:bg-action-primary-hover transition-colors cursor-pointer"
        >
          Sign in &amp; submit best
        </button>
      );
    }
    return (
      <p className="text-sm text-secondary m-0">
        Open this game in the Polkadot app to save your best.
      </p>
    );
  })();

  return (
    <div className="app-shell text-primary">
      {/* Back to the arcade — imposed by the shell on every game, every viewport.
          Inside the host, target=_blank/window.open are sandbox-blocked, so the
          plain anchor does nothing; intercept and route through navigateTo (the
          same fix as the dashboard Play button). Outside a host the anchor's
          default new-tab behaviour stands. */}
      <a
        className="arcade-back inline-flex items-center gap-1 rounded-full bg-surface-container text-secondary hover:text-primary px-3 py-1.5 text-[13px] font-medium no-underline transition-colors"
        href={ARCADE_URL}
        target="_blank"
        rel="noopener"
        onClick={(e) => {
          if (isInsideContainerSync()) {
            e.preventDefault();
            openHostUrl(ARCADE_URL);
          }
        }}
      >
        <ChevronLeft className="w-4 h-4" />
        Arcade
      </a>
      {/* data-righttab drives the DESKTOP right column: the game is always shown
          on the left and the right column is a tabbed card (Scoreboard default /
          Account) — so Account no longer stacks below the boards and off-screen.
          On mobile this attribute is unused; the bottom tab bar toggles panels. */}
      <div className="panel-area" data-righttab={tab === "account" ? "account" : "boards"}>
        {/* ── Play panel ──────────────────────────────────────────────── */}
        <section
          className="panel panel-play"
          hidden={tab !== "play"}
          aria-label="Play"
        >
          <div className="flex flex-col items-center gap-3 w-full max-w-[420px]">
            <header className="text-center w-full">
              <h1 className="text-2xl font-semibold tracking-tight text-primary m-0 mb-1">
                {ACTIVE_GAME_TITLE}
              </h1>
              {statusLine}
            </header>

            {!CONTRACT_DEPLOYED && (
              <div className="bg-status-warning text-primary-inverted rounded-nested px-4 py-3 text-sm w-full">
                <strong>Game contract not deployed.</strong> Scores can&rsquo;t be saved on-chain
                yet. Run the deploy pipeline (see <code>README.md</code>), then restart the dev
                server.
              </div>
            )}

            {gated ? (
              <div className="sheet">
                <p className="text-base font-semibold text-primary m-0 mb-3">
                  This game requires an account
                </p>
                <button
                  type="button"
                  onClick={signInAtLaunch}
                  className="bg-action-primary text-primary-inverted font-medium text-sm px-4 py-2 rounded-small hover:bg-action-primary-hover transition-colors cursor-pointer"
                >
                  Sign in with your host wallet
                </button>
                {error && (
                  <p className="text-sm text-error m-0 mt-2 break-words">
                    Couldn&rsquo;t sign in: {error}
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* Shell-owned game surface: the responsive 2:3 portrait frame
                    every game inherits. The active game fills 100% of it and
                    cannot fight the layout (App.css `.game-surface`). */}
                <div className="game-surface">
                  <ActiveGame onGameEnd={onGameEnd} />
                </div>
                {(lastScore !== null || bestScore !== null) && (
                  <div className="flex flex-col items-center gap-3 w-full">
                    <p className="text-sm text-secondary m-0">
                      {lastScore !== null && (
                        <>
                          Last: <strong className="text-primary">{fmtScore(lastScore)}</strong>
                        </>
                      )}
                      {lastScore !== null && bestScore !== null && " · "}
                      {bestScore !== null && (
                        <>
                          Best: <strong className="text-primary">{fmtScore(bestScore)}</strong>
                        </>
                      )}
                      {!CONTRACT_DEPLOYED && " · contract not deployed"}
                    </p>
                    {CONTRACT_DEPLOYED && submitArea}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Right column wrapper. On mobile it's `display: contents` (transparent —
            the boards/account stay full-screen panels toggled by the bottom bar).
            On desktop it's a flex column so the tab strip + the active panel stack
            top-aligned in one grid cell (no row-spanning gap). */}
        <div className="right-col">
        {/* ── Desktop-only right-column tab strip (Scoreboard / Account). Hidden
            on mobile (the bottom tab bar handles switching there). Reuses `tab`:
            "Account" → account; anything else → the boards (default). ── */}
        <div className="desktop-tabs" role="tablist" aria-label="Right panel">
          <button
            type="button"
            className="desktop-tab"
            role="tab"
            aria-selected={tab !== "account"}
            onClick={() => setTab("scores")}
          >
            <Trophy size={16} aria-hidden />
            Scoreboard
          </button>
          <button
            type="button"
            className="desktop-tab"
            role="tab"
            aria-selected={tab === "account"}
            onClick={() => setTab("account")}
          >
            <User size={16} aria-hidden />
            Account
          </button>
        </div>

        {/* ── Boards panel (Scores + Recent). One Leaderboard instance; the
            active mobile tab toggles which card shows, desktop shows both. ── */}
        <section
          className={`panel panel-boards board-mode-${tab === "recent" ? "recent" : "scores"}`}
          hidden={tab === "play" || tab === "account"}
          aria-label="Scores"
        >
          <div className="w-full max-w-[420px] mx-auto p-4">
            <Leaderboard
              api={SCOREBOARD}
              refreshKey={refreshKey}
              highlightPlayer={player ?? undefined}
              pendingEntry={pendingEntry}
              ordering={SCORE_ORDERING}
            />
          </div>
        </section>

        {/* ── Account panel (mobile: its own tab; desktop: under the boards). The
            host only exposes the per-app PRODUCT account — the user's root
            account stays private (SPEC §8.1). ─────────────────────────────── */}
        <section className="panel panel-account" hidden={tab !== "account"} aria-label="Account">
          <div className="w-full max-w-[420px] mx-auto p-4 flex flex-col gap-4">
            <header className="text-center">
              <h2 className="text-lg font-semibold text-primary m-0">Your Product Account</h2>
              <p className="text-sm text-secondary m-0 mt-1">
                The per-app account this game uses for you — its addresses and balance are all part
                of it.
              </p>
            </header>

            {!signedIn ? (
              session.inHost ? (
                <div className="sheet">
                  <p className="text-base font-semibold text-primary m-0 mb-3">
                    Sign in to view your account
                  </p>
                  <button
                    type="button"
                    onClick={signInNow}
                    className="bg-action-primary text-primary-inverted font-medium text-sm px-4 py-2 rounded-small hover:bg-action-primary-hover transition-colors cursor-pointer"
                  >
                    Sign in
                  </button>
                  {error && (
                    <p className="text-sm text-error m-0 mt-2 break-words">
                      Couldn&rsquo;t sign in: {error}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-secondary m-0">
                  Open this game in the Polkadot app to see your account.
                </p>
              )
            ) : accountLoading && !account ? (
              <p className="text-sm text-secondary m-0">Loading your account…</p>
            ) : account ? (
              // ONE card for the whole product account, with divider-separated
              // subsections (derivation → its addresses → its balance) so it's
              // unmistakable that the addresses and balance all belong to this
              // single host-derived account (SPEC §8.1).
              <div className="bg-surface-container rounded-container p-4 flex flex-col gap-4">
                {/* How it's derived */}
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-secondary m-0">
                    Derived for you by the Polkadot host as:
                  </p>
                  <code className="text-xs text-primary bg-surface-nested rounded-small px-2 py-1 break-all">
                    {derivationPath(account.identifier, account.derivationIndex)}
                  </code>
                  <dl className="text-sm m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-secondary">App</dt>
                    <dd className="text-primary m-0">{account.identifier}</dd>
                    <dt className="text-secondary">Index</dt>
                    <dd className="text-primary m-0">{account.derivationIndex}</dd>
                  </dl>
                  <p className="text-xs text-tertiary m-0">
                    Soft derivation (single <code>/</code>) from your seed, which stays private to
                    the host.{" "}
                    <a
                      href="https://wiki.polkadot.com/learn/learn-account-advanced/#derivation-paths"
                      target="_blank"
                      rel="noopener"
                      className="text-link hover:text-link-hover underline"
                    >
                      What&rsquo;s a derivation path?
                    </a>
                  </p>
                </div>

                <div className="border-t border-divider" />

                {/* Its addresses — same account in two formats: SS58 is the
                    Polkadot account; the H160 is its Ethereum-compatible "in-game
                    ID" the contract sees you by. */}
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-tertiary m-0">
                    Product Account Addresses
                  </p>
                  <AddressRow
                    label="Your account (SS58)"
                    full={account.ss58}
                    copyKey="ss58"
                    copied={copied}
                    onCopy={copy}
                  />
                  <AddressRow
                    label="In-game ID (H160)"
                    full={account.h160}
                    copyKey="h160"
                    copied={copied}
                    onCopy={copy}
                  />
                  <p className="text-xs text-tertiary m-0">
                    Same account — your in-game ID is its Ethereum-compatible form.
                  </p>
                </div>

                <div className="border-t border-divider" />

                {/* Its balance & status */}
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-tertiary m-0">
                    Product Account Balance &amp; Status
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-secondary">Balance</span>
                    <span className="text-sm font-semibold text-primary">
                      {formatBalance(account.free, account.decimals)} {account.symbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-secondary">Mapping</span>
                    {account.mapped ? (
                      <span className="text-sm text-success">Mapped — ready to save scores</span>
                    ) : (
                      <span className="text-sm text-warning">Not mapped</span>
                    )}
                  </div>
                  {!account.mapped && (
                    <button
                      type="button"
                      onClick={mapNow}
                      disabled={mapping}
                      className="bg-action-secondary text-primary font-medium text-sm px-4 py-2 rounded-small hover:bg-action-secondary-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {mapping ? "Mapping…" : "Map account to save scores"}
                    </button>
                  )}
                  {/* External site (the public Polkadot faucet) — a normal
                      target=_blank link, which the host opens in the system
                      browser. NOT navigateTo (that's for in-host .dot apps). */}
                  <a
                    href={faucetUrl(account.ss58)}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center justify-center bg-action-primary text-primary-inverted font-medium text-sm px-4 py-2 rounded-small hover:bg-action-primary-hover transition-colors cursor-pointer no-underline"
                  >
                    Get test funds
                  </a>
                  <p className="text-xs text-tertiary m-0">
                    Funds the SS58 above. Saving a score reserves a small storage deposit from this
                    account — top it up here if saving fails.
                  </p>
                  {accountError && (
                    <p className="text-sm text-error m-0 break-words">{accountError}</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-error m-0 break-words">
                {accountError ?? "Couldn't load your account."}
              </p>
            )}
          </div>
        </section>
        </div>
      </div>

      {/* ── Bottom tab bar (mobile only; hidden on desktop via CSS) ──────── */}
      <nav className="tab-bar" aria-label="Sections">
        <button
          type="button"
          className="tab-item"
          aria-selected={tab === "play"}
          onClick={() => setTab("play")}
        >
          <Gamepad2 size={22} aria-hidden />
          Play
        </button>
        <button
          type="button"
          className="tab-item"
          aria-selected={tab === "scores"}
          onClick={() => setTab("scores")}
        >
          <Trophy size={22} aria-hidden />
          Scores
        </button>
        <button
          type="button"
          className="tab-item"
          aria-selected={tab === "recent"}
          onClick={() => setTab("recent")}
        >
          <History size={22} aria-hidden />
          Recent
        </button>
        <button
          type="button"
          className="tab-item"
          aria-selected={tab === "account"}
          onClick={() => setTab("account")}
        >
          <User size={22} aria-hidden />
          Account
        </button>
      </nav>
    </div>
  );
}
