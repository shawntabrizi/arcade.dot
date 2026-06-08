import { useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "../types";
import "./flappy-bird.css";

// Internal play-field resolution. The canvas is drawn at this fixed resolution
// and CSS-scaled to fill 100% of the shell-provided surface (the shell owns the
// 2:3 portrait frame, radius and shadow — we only fill it). 360x540 matches the
// shell's portrait aspect so nothing distorts.
const WIDTH = 360;
const HEIGHT = 540;

// Physics (units are field-pixels per ms / per ms^2, scaled by dt).
const GRAVITY = 0.0016; // px / ms^2
const FLAP_V = -0.55; // px / ms (instantaneous upward velocity on flap)
const MAX_FALL_V = 0.85; // terminal downward velocity
const BIRD_X = 110;
const BIRD_R = 14;

// Pipes.
const PIPE_W = 56;
const GAP_H = 150; // vertical gap the bird flies through
const PIPE_SPEED = 0.16; // px / ms
const PIPE_SPACING = 220; // horizontal distance between pipe pairs
const PIPE_MARGIN = 60; // min distance of a gap from top/bottom

type Phase = "ready" | "playing" | "dead";

interface Pipe {
  x: number;
  gapY: number; // center of the gap
  passed: boolean;
}

function randomGapY(): number {
  const min = PIPE_MARGIN + GAP_H / 2;
  const max = HEIGHT - PIPE_MARGIN - GAP_H / 2;
  return min + Math.random() * (max - min);
}

function initialState() {
  return {
    birdY: HEIGHT / 2,
    vel: 0,
    pipes: [] as Pipe[],
    spawnAcc: 0,
    score: 0,
    phase: "ready" as Phase,
    last: 0,
    ended: false,
  };
}

export function FlappyBird({ onGameEnd }: GameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const stateRef = useRef(initialState());

  function reset() {
    stateRef.current = initialState();
    setScore(0);
    setPhase("ready");
  }

  // A flap also starts the game from the "ready" phase.
  function flap() {
    const s = stateRef.current;
    if (s.phase === "dead") return;
    if (s.phase === "ready") {
      s.phase = "playing";
      setPhase("playing");
      // Seed the first pipe a little ahead so the player isn't ambushed.
      s.pipes = [{ x: WIDTH + 40, gapY: randomGapY(), passed: false }];
      s.spawnAcc = 0;
    }
    s.vel = FLAP_V;
  }

  // Keyboard: Space (and Up arrow) flaps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;

    function die(s: typeof stateRef.current) {
      if (s.ended) return;
      s.ended = true;
      s.phase = "dead";
      setPhase("dead");
      // score is already a non-negative integer (pipes passed).
      onGameEnd(Math.max(0, Math.round(s.score)));
    }

    function update(s: typeof stateRef.current, dt: number) {
      // Bird physics.
      s.vel = Math.min(MAX_FALL_V, s.vel + GRAVITY * dt);
      s.birdY += s.vel * dt;

      // Floor / ceiling collision.
      if (s.birdY + BIRD_R >= HEIGHT || s.birdY - BIRD_R <= 0) {
        s.birdY = Math.max(BIRD_R, Math.min(HEIGHT - BIRD_R, s.birdY));
        die(s);
        return;
      }

      // Move pipes; spawn new ones on spacing cadence.
      s.spawnAcc += PIPE_SPEED * dt;
      if (s.spawnAcc >= PIPE_SPACING) {
        s.spawnAcc -= PIPE_SPACING;
        s.pipes.push({ x: WIDTH + PIPE_W, gapY: randomGapY(), passed: false });
      }
      for (const p of s.pipes) {
        p.x -= PIPE_SPEED * dt;
      }
      // Drop pipes fully off-screen.
      s.pipes = s.pipes.filter((p) => p.x + PIPE_W > -10);

      // Scoring + collision.
      for (const p of s.pipes) {
        if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
          p.passed = true;
          s.score += 1;
          setScore(s.score);
        }
        // Collision: bird overlaps the pipe's x-band but is outside the gap.
        const inXBand =
          BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W;
        if (inXBand) {
          const gapTop = p.gapY - GAP_H / 2;
          const gapBottom = p.gapY + GAP_H / 2;
          if (s.birdY - BIRD_R < gapTop || s.birdY + BIRD_R > gapBottom) {
            die(s);
            return;
          }
        }
      }
    }

    const loop = (now: number) => {
      const s = stateRef.current;
      if (s.last === 0) s.last = now;
      // Clamp dt so a backgrounded tab doesn't teleport the bird through pipes.
      const dt = Math.min(48, now - s.last);
      s.last = now;

      if (s.phase === "playing") update(s, dt);
      draw(ctx, s);
      raf = requestAnimationFrame(loop);
    };

    // TEST-ONLY: deterministic game-over hook, mirrors SnakeGame's pattern.
    // Exposed only under VITE_ARCADE_FAKE_GATEWAY so it is absent from a normal
    // build. window.__flappyForceGameOver(score) fires onGameEnd once.
    let detachHook: (() => void) | undefined;
    if (import.meta.env.VITE_ARCADE_FAKE_GATEWAY === "1") {
      const force = (forced: number) => {
        const s = stateRef.current;
        s.score = forced;
        setScore(forced);
        die(s);
      };
      (
        window as unknown as { __flappyForceGameOver?: (n: number) => void }
      ).__flappyForceGameOver = force;
      detachHook = () => {
        delete (window as unknown as { __flappyForceGameOver?: (n: number) => void })
          .__flappyForceGameOver;
      };
    }

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      detachHook?.();
    };
  }, [onGameEnd]);

  return (
    <div className="flappy-wrap">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="flappy-canvas"
        onPointerDown={(e) => {
          e.preventDefault();
          flap();
        }}
      />
      <div className="flappy-hud">
        <span className="flappy-score">{score}</span>
      </div>
      <div className="flappy-overlay">
        {phase === "ready" && <p>Tap or press Space to flap</p>}
        {phase === "dead" && (
          <button type="button" onClick={reset} className="flappy-retry">
            Play again
          </button>
        )}
      </div>
    </div>
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  s: { birdY: number; vel: number; pipes: Pipe[] },
) {
  // Sky.
  ctx.fillStyle = "#4ec0ca";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Pipes.
  for (const p of s.pipes) {
    const gapTop = p.gapY - GAP_H / 2;
    const gapBottom = p.gapY + GAP_H / 2;
    ctx.fillStyle = "#5ea417";
    ctx.fillRect(p.x, 0, PIPE_W, gapTop);
    ctx.fillRect(p.x, gapBottom, PIPE_W, HEIGHT - gapBottom);
    // Lighter rim caps.
    ctx.fillStyle = "#74c12e";
    ctx.fillRect(p.x - 3, gapTop - 18, PIPE_W + 6, 18);
    ctx.fillRect(p.x - 3, gapBottom, PIPE_W + 6, 18);
  }

  // Ground strip.
  ctx.fillStyle = "#ded895";
  ctx.fillRect(0, HEIGHT - 8, WIDTH, 8);

  // Bird — tilt with velocity.
  ctx.save();
  ctx.translate(BIRD_X, s.birdY);
  const tilt = Math.max(-0.5, Math.min(1.0, s.vel * 1.2));
  ctx.rotate(tilt);
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
  ctx.fill();
  // Eye + beak.
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(5, -5, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(7, -5, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff8c1a";
  ctx.beginPath();
  ctx.moveTo(BIRD_R - 2, -2);
  ctx.lineTo(BIRD_R + 8, 0);
  ctx.lineTo(BIRD_R - 2, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
