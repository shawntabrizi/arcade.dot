import { useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "../types";
import "./aim-trainer.css";

// Reference game #2 — the "different shape" from Snake. It teaches what Snake
// can't:
//   - INPUT: DOM/pointer (tap targets), not keyboard or canvas.
//   - SCORE: LOWER IS BETTER = average reaction time in MILLISECONDS (integer).
//     (arcade.config.json would set contract.scoreOrdering=1, scoreFormat=1.)
// Like every template game it renders ONLY gameplay into the shell-provided
// surface (fills 100% of its parent), imports nothing from scoreboard/ or App,
// and calls onGameEnd(ms) EXACTLY ONCE per round (guarded by hasEnded).
const TARGETS = 5; // taps per round
const TARGET_SIZE = 64; // px, square hit area

type Phase = "ready" | "playing" | "done";

interface Pos {
  // Percentages so the target stays inside the surface at any size.
  top: number;
  left: number;
}

// Keep the target fully inside the surface: leave a margin (in %) so a target
// near the edge isn't clipped. ~18% covers TARGET_SIZE on the smallest frame.
function randomPos(): Pos {
  const margin = 18;
  return {
    top: margin + Math.random() * (100 - 2 * margin),
    left: margin + Math.random() * (100 - 2 * margin),
  };
}

export function AimTrainer({ onGameEnd }: GameComponentProps) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [hits, setHits] = useState(0);
  const [pos, setPos] = useState<Pos>(randomPos);
  // Reaction times (ms) for each tap; averaged into the final score.
  const timesRef = useRef<number[]>([]);
  // When the current target appeared, for the next reaction measurement.
  const shownAtRef = useRef(0);
  // SPEC §10.4: onGameEnd fires once per match. This flag is the guard.
  const endedRef = useRef(false);

  // Reset all per-round state for a fresh start / replay.
  function reset() {
    timesRef.current = [];
    endedRef.current = false;
    setHits(0);
    setPhase("ready");
    setPos(randomPos());
  }

  function start() {
    timesRef.current = [];
    setHits(0);
    setPos(randomPos());
    shownAtRef.current = performance.now();
    setPhase("playing");
  }

  function hitTarget() {
    if (phase !== "playing") return;
    timesRef.current.push(performance.now() - shownAtRef.current);
    const next = hits + 1;
    setHits(next);
    if (next >= TARGETS) {
      end();
    } else {
      setPos(randomPos());
      shownAtRef.current = performance.now();
    }
  }

  function end() {
    if (endedRef.current) return;
    endedRef.current = true;
    setPhase("done");
    const times = timesRef.current;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    // Lower is better; score is the average reaction time in whole ms.
    onGameEnd(Math.max(0, Math.round(avg)));
  }

  // Last measured average, for the end screen.
  const lastAvg = useRef(0);
  useEffect(() => {
    if (phase === "done" && timesRef.current.length) {
      lastAvg.current = Math.round(
        timesRef.current.reduce((a, b) => a + b, 0) / timesRef.current.length,
      );
    }
  }, [phase]);

  return (
    <div className="aim-wrap">
      {phase === "playing" && (
        <>
          <div className="aim-hud">
            {hits} / {TARGETS}
          </div>
          <button
            type="button"
            className="aim-target"
            style={{ top: `${pos.top}%`, left: `${pos.left}%`, width: TARGET_SIZE, height: TARGET_SIZE }}
            onPointerDown={hitTarget}
            aria-label="Tap the target"
          />
        </>
      )}

      {phase === "ready" && (
        <div className="aim-overlay">
          <p className="aim-title">Aim Trainer</p>
          <p className="aim-sub">Tap {TARGETS} targets as fast as you can. Lower time wins.</p>
          <button type="button" className="aim-button" onPointerDown={start}>
            Start
          </button>
        </div>
      )}

      {phase === "done" && (
        <div className="aim-overlay">
          <p className="aim-title">{lastAvg.current} ms avg</p>
          <button type="button" className="aim-button" onPointerDown={reset}>
            Play again
          </button>
        </div>
      )}
    </div>
  );
}
