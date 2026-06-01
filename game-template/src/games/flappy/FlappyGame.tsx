import { useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "../types";
import "./flappy.css";

const WIDTH = 360;
const HEIGHT = 540;
const GRAVITY = 0.45;
const JUMP_VELOCITY = -7.5;
const PIPE_GAP = 150;
const PIPE_WIDTH = 60;
const PIPE_SPEED = 2.2;
const PIPE_SPACING = 220;
const BIRD_RADIUS = 14;
const BIRD_X = 90;
const GROUND_HEIGHT = 40;

interface Pipe {
  x: number;
  gapY: number;
  passed: boolean;
}

type Phase = "ready" | "playing" | "dead";

export function FlappyGame({ onGameEnd }: GameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const stateRef = useRef({
    birdY: HEIGHT / 2,
    birdV: 0,
    pipes: [] as Pipe[],
    score: 0,
    phase: "ready" as Phase,
    nextPipeIn: PIPE_SPACING,
    ended: false,
  });

  useEffect(() => {
    stateRef.current.phase = phase;
  }, [phase]);

  function reset() {
    stateRef.current = {
      birdY: HEIGHT / 2,
      birdV: 0,
      pipes: [],
      score: 0,
      phase: "ready",
      nextPipeIn: PIPE_SPACING,
      ended: false,
    };
    setScore(0);
    setPhase("ready");
  }

  function flap() {
    const s = stateRef.current;
    if (s.phase === "dead") return;
    if (s.phase === "ready") {
      s.phase = "playing";
      setPhase("playing");
    }
    s.birdV = JUMP_VELOCITY;
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
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
      onGameEnd(s.score);
    }

    const loop = () => {
      const s = stateRef.current;

      if (s.phase === "playing") {
        s.birdV += GRAVITY;
        s.birdY += s.birdV;

        s.nextPipeIn -= PIPE_SPEED;
        if (s.nextPipeIn <= 0) {
          const margin = 60;
          const gapY = margin + Math.random() * (HEIGHT - GROUND_HEIGHT - PIPE_GAP - 2 * margin);
          s.pipes.push({ x: WIDTH, gapY, passed: false });
          s.nextPipeIn = PIPE_SPACING;
        }

        for (const p of s.pipes) {
          p.x -= PIPE_SPEED;
          if (!p.passed && p.x + PIPE_WIDTH < BIRD_X - BIRD_RADIUS) {
            p.passed = true;
            s.score += 1;
            setScore(s.score);
          }
        }
        s.pipes = s.pipes.filter((p) => p.x + PIPE_WIDTH > 0);

        const groundY = HEIGHT - GROUND_HEIGHT;
        if (s.birdY + BIRD_RADIUS >= groundY || s.birdY - BIRD_RADIUS <= 0) {
          die(s);
        } else {
          for (const p of s.pipes) {
            const inX = BIRD_X + BIRD_RADIUS > p.x && BIRD_X - BIRD_RADIUS < p.x + PIPE_WIDTH;
            const inGap = s.birdY - BIRD_RADIUS > p.gapY && s.birdY + BIRD_RADIUS < p.gapY + PIPE_GAP;
            if (inX && !inGap) {
              die(s);
              break;
            }
          }
        }
      }

      draw(ctx, s);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [onGameEnd]);

  return (
    <div className="flappy-wrap">
      <div className="flappy-hud">
        <span className="flappy-score">{score}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="flappy-canvas"
        onMouseDown={(e) => {
          e.preventDefault();
          flap();
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          flap();
        }}
      />
      <div className="flappy-overlay">
        {phase === "ready" && <p>Tap or press space to start</p>}
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
  s: { birdY: number; birdV: number; pipes: Pipe[] },
) {
  ctx.fillStyle = "#70c5ce";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "#5a9c2c";
  for (const p of s.pipes) {
    ctx.fillRect(p.x, 0, PIPE_WIDTH, p.gapY);
    ctx.fillRect(p.x, p.gapY + PIPE_GAP, PIPE_WIDTH, HEIGHT - GROUND_HEIGHT - (p.gapY + PIPE_GAP));
    ctx.fillStyle = "#3d6b1e";
    ctx.fillRect(p.x - 3, p.gapY - 14, PIPE_WIDTH + 6, 14);
    ctx.fillRect(p.x - 3, p.gapY + PIPE_GAP, PIPE_WIDTH + 6, 14);
    ctx.fillStyle = "#5a9c2c";
  }

  ctx.fillStyle = "#ded895";
  ctx.fillRect(0, HEIGHT - GROUND_HEIGHT, WIDTH, GROUND_HEIGHT);
  ctx.fillStyle = "#b9b56f";
  ctx.fillRect(0, HEIGHT - GROUND_HEIGHT, WIDTH, 4);

  const tilt = Math.max(-0.5, Math.min(1.2, s.birdV / 10));
  ctx.save();
  ctx.translate(BIRD_X, s.birdY);
  ctx.rotate(tilt);
  ctx.fillStyle = "#f7d51d";
  ctx.beginPath();
  ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8932a";
  ctx.fillRect(BIRD_RADIUS - 2, -3, 8, 4);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(4, -4, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(5, -4, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
