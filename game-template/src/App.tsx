import { useCallback, useEffect, useState } from "react";
import { FlappyGame } from "./games/flappy/FlappyGame";
import { Leaderboard, shortAddress } from "./scoreboard/Leaderboard";
import {
  contractScoreboard,
  getBurnerH160,
  getBurnerSs58,
  isLeaderboardContractDeployed,
} from "./scoreboard/contract-impl";
import { ensureBurnerReady } from "./scoreboard/bootstrap";
import { getCdm } from "./scoreboard/cdm";
import { getBurnerSigner } from "./scoreboard/signer";
import {
  getDisplayName,
  isArcadeInstalled,
  setDisplayName as arcadeSetDisplayName,
} from "./scoreboard/arcade";

const SCOREBOARD = contractScoreboard;
const CONTRACT_DEPLOYED = isLeaderboardContractDeployed();
const ARCADE_DEPLOYED = isArcadeInstalled();
const NAME_KEY = "leaderboard-playground:display-name";

type NameState = "idle" | "saving" | "saved" | "error";

export function App() {
  const burnerH160 = getBurnerH160();
  const burnerSs58 = getBurnerSs58();
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [savedName, setSavedName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [nameState, setNameState] = useState<NameState>("idle");
  const [nameError, setNameError] = useState<string | null>(null);

  // Pick up the existing on-chain name on first load if the user has played
  // from this browser before but cleared localStorage.
  useEffect(() => {
    if (!ARCADE_DEPLOYED || savedName) return;
    let cancelled = false;
    (async () => {
      const onchain = await getDisplayName(burnerH160);
      if (cancelled || !onchain) return;
      setSavedName(onchain);
      setNameInput(onchain);
      localStorage.setItem(NAME_KEY, onchain);
    })();
    return () => {
      cancelled = true;
    };
  }, [burnerH160, savedName]);

  const saveName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === savedName) return;
    if (!ARCADE_DEPLOYED) {
      setNameError("Arcade not deployed — names can't be saved.");
      setNameState("error");
      return;
    }
    setNameState("saving");
    setNameError(null);
    try {
      const c = getCdm();
      await ensureBurnerReady(c.client, c.inkSdk, {
        signer: getBurnerSigner(),
        ss58: burnerSs58,
      });
      await arcadeSetDisplayName(trimmed);
      localStorage.setItem(NAME_KEY, trimmed);
      setSavedName(trimmed);
      setNameState("saved");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setNameError(/taken/i.test(msg) ? "Name already taken — try another." : msg);
      setNameState("error");
    }
  }, [nameInput, savedName, burnerSs58]);

  const onGameEnd = useCallback(async (score: number) => {
    setLastScore(score);
    if (!CONTRACT_DEPLOYED) return;
    setSubmitState("submitting");
    setSubmitError(null);
    try {
      await SCOREBOARD.submitScore(score);
      setRefreshKey((k) => k + 1);
      setSubmitState("idle");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitState("error");
    }
  }, []);

  const nameStatus =
    nameState === "saving"
      ? "saving…"
      : nameState === "error"
        ? nameError
        : nameState === "saved" || savedName
          ? ""
          : "Pick a name so others can see who you are.";

  return (
    <div className="page">
      <header className="page-header">
        <h1>Leaderboard Playground</h1>
        <p className="tagline">A starter template — swap the game, keep the on-chain scoreboard.</p>
      </header>

      {!CONTRACT_DEPLOYED && (
        <div className="banner banner-warn">
          <strong>Contract not deployed.</strong> Scores can&rsquo;t be saved yet. Run{" "}
          <code>dot deploy --contracts</code>, then restart the dev server. See <code>README.md</code> for the full first-run flow.
        </div>
      )}

      <div className="player-row">
        <label htmlFor="display-name">You</label>
        <input
          id="display-name"
          type="text"
          placeholder="display name (e.g. alice)"
          value={nameInput}
          onChange={(e) => {
            setNameInput(e.target.value);
            if (nameState !== "idle") setNameState("idle");
          }}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          maxLength={32}
          disabled={!ARCADE_DEPLOYED}
        />
        <code className="player-addr" title={burnerSs58}>
          {shortAddress(burnerH160)}
        </code>
        <span className="player-hint">
          {nameStatus ||
            "On first save your burner wallet is funded by the configured faucet and registered with pallet_revive — expect ~30s."}
        </span>
      </div>

      <div className="layout">
        <section className="game-col">
          <FlappyGame onGameEnd={onGameEnd} />
          {lastScore !== null && (
            <p className="last-score">
              Last score: <strong>{lastScore}</strong>
              {submitState === "submitting" && " · submitting…"}
              {!CONTRACT_DEPLOYED && " · contract not deployed"}
            </p>
          )}
          {submitError && <p className="submit-error">Submit failed: {submitError}</p>}
        </section>

        <section className="board-col">
          <Leaderboard api={SCOREBOARD} refreshKey={refreshKey} highlightPlayer={burnerH160} />
        </section>
      </div>

      <footer className="page-footer">
        <p>
          Polkadot Playground starter template. See <code>README.md</code> to deploy your contract,
          and <code>docs/modding.md</code> to swap the game or change the storage backend.
        </p>
      </footer>
    </div>
  );
}
