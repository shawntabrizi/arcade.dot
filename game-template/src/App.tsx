import { useCallback, useEffect, useMemo, useState } from "react";
import { Gamepad2, Trophy, History, ChevronLeft } from "lucide-react";
import { ActiveGame, ACTIVE_GAME_TITLE } from "./games/active";
import type { ScoreEntry, ScoreOrdering } from "./scoreboard/api";
import { Leaderboard, shortAddress } from "./scoreboard/Leaderboard";
import { contractScoreboard, isContractDeployed } from "./scoreboard/reads";
import { Scoreboard, type GameOverOutcome } from "./scoreboard/scoreboard";
import { createSdkGateway } from "./scoreboard/sdk-gateway";
import { createFakeGateway } from "./scoreboard/fake-gateway";
import { getGcsAddress } from "./scoreboard/gcs";
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

const SCOREBOARD = contractScoreboard;
// Under the test flag the (faked) contract is always "deployed" so the
// save-score / submit flow is active without a chain.
const CONTRACT_DEPLOYED = FAKE_GATEWAY || isContractDeployed();
// Guest scores survive the session keyed per game; the GCS address is a stable
// per-game key on this origin.
const GAME_KEY = getGcsAddress() ?? "local";

type Phase = "playing" | "confirm" | "prompt" | "submitting" | "submitted" | "error";
type Tab = "play" | "scores" | "recent";

export function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("playing");
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<`0x${string}` | null>(null);
  // Drives which 100dvh panel shows on mobile; desktop ignores it (CSS shows
  // the game + boards columns side by side and hides the tab bar).
  const [tab, setTab] = useState<Tab>("play");
  // Optimistic: the player's just-played score, shown on the board immediately
  // and reconciled when the real submit lands. Only set once submitted.
  const [pendingEntry, setPendingEntry] = useState<ScoreEntry | null>(null);

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

  // The game calls this exactly once per match (SPEC §10.4 — Snake's own
  // `ended` guard enforces it), so a single onGameEnd drives at most one submit.
  const onGameEnd = useCallback(
    async (score: number) => {
      setLastScore(score);
      setError(null);
      if (!CONTRACT_DEPLOYED) {
        setPhase("playing");
        return;
      }
      try {
        const outcome: GameOverOutcome = await scoreboard.onGameEnd(score);
        switch (outcome.kind) {
          case "confirm": // signed-in, new best → ask before signing
            setPhase("confirm");
            break;
          case "prompt": // guest, worth keeping → "sign in to save your score"
            setPhase("prompt");
            break;
          case "ignored":
            setPhase("playing");
            break;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    },
    [showOptimistic, scoreboard],
  );

  // SPEC §8.3: the conversion moment — connect host wallet → ensureAccountMapped
  // → submitScore the held score. One flow, inherited by every template game.
  const saveScore = useCallback(async () => {
    setPhase("submitting");
    setError(null);
    try {
      await scoreboard.saveHeldScore();
      if (lastScore !== null) showOptimistic(lastScore);
      setPhase("submitted");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [scoreboard, lastScore, showOptimistic]);

  // Dismiss the prompt / banner and return to play (Snake replays in place).
  const onRestart = useCallback(() => {
    setPhase("playing");
  }, []);

  // The session status line (three honest SPEC §8.1/§8.3 states). Kept in one
  // place so it can sit in the Play panel header on every viewport.
  const statusLine = signedIn ? (
    <p className="text-sm text-secondary m-0" data-session="signed-in">
      Signed in as{" "}
      <code className="text-primary" title={session.account!.h160}>
        {shortAddress(session.account!.h160)}
      </code>{" "}
      — you&rsquo;ll be asked before saving a new best.
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

  // Game-over sheet content (save / sign-in / submitted / error). Rendered as a
  // bottom sheet over the game on mobile, an inline card on desktop.
  const sheet = (() => {
    if (phase === "confirm") {
      return (
        <div className="sheet">
          <p className="text-base font-semibold text-primary m-0 mb-3">
            New best! Save your score?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveScore}
              className="bg-action-primary text-primary-inverted font-medium text-sm px-4 py-2 rounded-small hover:bg-action-primary-hover transition-colors cursor-pointer"
            >
              Save score
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="bg-action-secondary text-primary font-medium text-sm px-4 py-2 rounded-small hover:bg-action-secondary-hover transition-colors cursor-pointer"
            >
              No thanks
            </button>
          </div>
        </div>
      );
    }
    if (phase === "prompt") {
      return (
        <div className="sheet">
          <p className="text-base font-semibold text-primary m-0 mb-3">
            Sign in to save your score
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveScore}
              className="bg-action-primary text-primary-inverted font-medium text-sm px-4 py-2 rounded-small hover:bg-action-primary-hover transition-colors cursor-pointer"
            >
              Sign in &amp; save
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="bg-action-secondary text-primary font-medium text-sm px-4 py-2 rounded-small hover:bg-action-secondary-hover transition-colors cursor-pointer"
            >
              Keep playing as guest
            </button>
          </div>
        </div>
      );
    }
    if (phase === "submitted") {
      return (
        <div className="sheet">
          <p className="text-sm text-secondary m-0">
            {player && (
              <>
                Saved as{" "}
                <code className="text-primary" title={player}>
                  {shortAddress(player)}
                </code>
                .{" "}
              </>
            )}
            <button
              type="button"
              onClick={onRestart}
              className="bg-action-secondary text-primary font-medium text-sm px-3 py-1.5 rounded-small hover:bg-action-secondary-hover transition-colors cursor-pointer"
            >
              Play again
            </button>
          </p>
        </div>
      );
    }
    if (phase === "error" && error) {
      return (
        <div className="sheet">
          <p className="text-sm text-error m-0 mb-3 break-words">Couldn&rsquo;t save: {error}</p>
          <button
            type="button"
            onClick={onRestart}
            className="bg-action-secondary text-primary font-medium text-sm px-4 py-2 rounded-small hover:bg-action-secondary-hover transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="app-shell text-primary">
      {/* Back to the arcade — imposed by the shell on every game, every viewport. */}
      <a
        className="arcade-back inline-flex items-center gap-1 rounded-full bg-surface-container text-secondary hover:text-primary px-3 py-1.5 text-[13px] font-medium no-underline transition-colors"
        href={ARCADE_URL}
        target="_blank"
        rel="noopener"
      >
        <ChevronLeft className="w-4 h-4" />
        Arcade
      </a>
      <div className="panel-area">
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
                {lastScore !== null && (
                  <p className="text-sm text-secondary m-0">
                    Last score: <strong className="text-primary">{lastScore}</strong>
                    {phase === "submitting" && " · saving…"}
                    {phase === "submitted" && " · saved"}
                    {!CONTRACT_DEPLOYED && " · contract not deployed"}
                  </p>
                )}
                {sheet}
              </>
            )}
          </div>
        </section>

        {/* ── Boards panel (Scores + Recent). One Leaderboard instance; the
            active mobile tab toggles which card shows, desktop shows both. ── */}
        <section
          className={`panel panel-boards board-mode-${tab === "recent" ? "recent" : "scores"}`}
          hidden={tab === "play"}
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
      </nav>
    </div>
  );
}
