import { useCallback, useMemo, useState } from "react";
import { SnakeGame } from "./games/snake/SnakeGame";
import type { ScoreEntry } from "./scoreboard/api";
import { Leaderboard, shortAddress } from "./scoreboard/Leaderboard";
import { contractScoreboard, isContractDeployed } from "./scoreboard/reads";
import { Scoreboard, type GameOverOutcome } from "./scoreboard/scoreboard";
import { createSdkGateway } from "./scoreboard/sdk-gateway";
import { getGcsAddress } from "./scoreboard/gcs";
import arcadeConfig from "../arcade.config.json";

// ── Template configuration (SPEC §6.5 / §8.3 / §10.4) ───────────────────────
// arcade.config.json is the single source of truth (SPEC §6.5). `requiresAccount`
// here is the SAME flag the deploy pipeline writes to the on-chain listing, so
// the in-game launch gate and the dashboard badge never disagree. Set it to true
// for multiplayer / on-chain-state games that cannot be played as a guest:
// sign-in is then required at launch instead of at game over (SPEC §8.3).
const REQUIRES_ACCOUNT = arcadeConfig.requiresAccount === true;

const SCOREBOARD = contractScoreboard;
const CONTRACT_DEPLOYED = isContractDeployed();
// Guest scores survive the session keyed per game; the GCS address is a stable
// per-game key on this origin.
const GAME_KEY = getGcsAddress() ?? "local";

type Phase = "playing" | "prompt" | "submitting" | "submitted" | "error";

export function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("playing");
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<`0x${string}` | null>(null);
  // Optimistic: the player's just-played score, shown on the board immediately
  // and reconciled when the real submit lands. Only set once submitted.
  const [pendingEntry, setPendingEntry] = useState<ScoreEntry | null>(null);

  // One Scoreboard for the session, over the real product-sdk gateway. The
  // gateway is the only thing that touches the chain (SPEC §8.1).
  const scoreboard = useMemo(
    () =>
      new Scoreboard(createSdkGateway(), globalThis.localStorage, {
        gameKey: GAME_KEY,
        requiresAccount: REQUIRES_ACCOUNT,
      }),
    [],
  );

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
          case "submitted": // signed-in: submitted directly, no prompt
            showOptimistic(score);
            setPhase("submitted");
            setRefreshKey((k) => k + 1);
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

  return (
    <div className="page">
      <header className="page-header">
        <h1>Arcade Game Template</h1>
        <p className="tagline">
          Play as a guest — sign in only to save a score worth keeping.
        </p>
      </header>

      {!CONTRACT_DEPLOYED && (
        <div className="banner banner-warn">
          <strong>Game contract not deployed.</strong> Scores can&rsquo;t be saved on-chain yet.
          Run the deploy pipeline (see <code>README.md</code>), then restart the dev server.
        </div>
      )}

      {gated ? (
        <div className="layout">
          <section className="game-col">
            <div className="save-prompt">
              <p>This game requires an account</p>
              <button type="button" onClick={signInAtLaunch}>
                Sign in with your host wallet
              </button>
              {error && <p className="submit-error">Couldn&rsquo;t sign in: {error}</p>}
            </div>
          </section>
        </div>
      ) : (
        <div className="layout">
        <section className="game-col">
          <SnakeGame onGameEnd={onGameEnd} />
          {lastScore !== null && (
            <p className="last-score">
              Last score: <strong>{lastScore}</strong>
              {phase === "submitting" && " · saving…"}
              {phase === "submitted" && " · saved"}
              {!CONTRACT_DEPLOYED && " · contract not deployed"}
            </p>
          )}

          {phase === "prompt" && (
            <div className="save-prompt">
              <p>Sign in to save your score</p>
              <button type="button" onClick={saveScore}>
                Sign in &amp; save
              </button>
              <button type="button" className="ghost" onClick={onRestart}>
                Keep playing as guest
              </button>
            </div>
          )}

          {phase === "submitted" && (
            <p className="last-score">
              {player && (
                <>
                  Saved as <code title={player}>{shortAddress(player)}</code>.{" "}
                </>
              )}
              <button type="button" className="ghost" onClick={onRestart}>
                Play again
              </button>
            </p>
          )}

          {phase === "error" && error && (
            <p className="submit-error">
              Couldn&rsquo;t save: {error}{" "}
              <button type="button" className="ghost" onClick={onRestart}>
                Dismiss
              </button>
            </p>
          )}
        </section>

        <section className="board-col">
          <Leaderboard
            api={SCOREBOARD}
            refreshKey={refreshKey}
            highlightPlayer={player ?? undefined}
            pendingEntry={pendingEntry}
          />
        </section>
      </div>
      )}

      <footer className="page-footer">
        <p>
          Polkadot Arcade game template. See <code>README.md</code> to deploy and register your
          game, and <code>docs/modding.md</code> to swap the game.
        </p>
      </footer>
    </div>
  );
}
