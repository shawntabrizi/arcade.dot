import { useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "../types";
import "./snake.css";

// Board is sized to match the template's game column (360x540).
const CELL = 20;
const COLS = 18; // 360 / 20
const ROWS = 27; // 540 / 20
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;

// Step cadence: starts gentle, speeds up a little as the snake grows.
const BASE_STEP_MS = 130;
const MIN_STEP_MS = 70;
const SPEEDUP_PER_FOOD = 4;

interface Cell {
  x: number;
  y: number;
}

type Phase = "ready" | "playing" | "dead";

const START: Cell[] = [
  { x: 5, y: 13 },
  { x: 4, y: 13 },
  { x: 3, y: 13 },
];

function randomFood(snake: Cell[]): Cell {
  // Small board, so rejection sampling is fine.
  while (true) {
    const c = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
    };
    if (!snake.some((s) => s.x === c.x && s.y === c.y)) return c;
  }
}

function initialState() {
  const snake = START.map((c) => ({ ...c }));
  return {
    snake,
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    food: randomFood(snake),
    score: 0,
    phase: "ready" as Phase,
    acc: 0,
    last: 0,
    ended: false,
  };
}

export function SnakeGame({ onGameEnd }: GameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const stateRef = useRef(initialState());

  function reset() {
    stateRef.current = initialState();
    setScore(0);
    setPhase("ready");
  }

  // Queue a turn. Ignore 180° reversals (would instantly self-collide), and
  // start the game on the first directional input.
  function turn(x: number, y: number) {
    const s = stateRef.current;
    if (s.phase === "dead") return;
    if (s.dir.x === -x && s.dir.y === -y) return;
    s.nextDir = { x, y };
    if (s.phase === "ready") {
      s.phase = "playing";
      setPhase("playing");
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.code) {
        case "ArrowUp":
        case "KeyW":
          e.preventDefault();
          turn(0, -1);
          break;
        case "ArrowDown":
        case "KeyS":
          e.preventDefault();
          turn(0, 1);
          break;
        case "ArrowLeft":
        case "KeyA":
          e.preventDefault();
          turn(-1, 0);
          break;
        case "ArrowRight":
        case "KeyD":
          e.preventDefault();
          turn(1, 0);
          break;
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

    function step(s: typeof stateRef.current) {
      s.dir = s.nextDir;
      const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };

      // Walls.
      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
        die(s);
        return;
      }
      // Self — the tail cell is free to enter when we're not growing.
      const willEat = head.x === s.food.x && head.y === s.food.y;
      const body = willEat ? s.snake : s.snake.slice(0, -1);
      if (body.some((c) => c.x === head.x && c.y === head.y)) {
        die(s);
        return;
      }

      s.snake.unshift(head);
      if (willEat) {
        s.score += 1;
        setScore(s.score);
        s.food = randomFood(s.snake);
      } else {
        s.snake.pop();
      }
    }

    const loop = (now: number) => {
      const s = stateRef.current;
      if (s.last === 0) s.last = now;
      const dt = now - s.last;
      s.last = now;

      if (s.phase === "playing") {
        const stepMs = Math.max(MIN_STEP_MS, BASE_STEP_MS - s.score * SPEEDUP_PER_FOOD);
        s.acc += dt;
        while (s.acc >= stepMs && s.phase === "playing") {
          s.acc -= stepMs;
          step(s);
        }
      }

      draw(ctx, s);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [onGameEnd]);

  // Touch: swipe to set direction (and start).
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="snake-wrap">
      <div className="snake-hud">
        <span className="snake-score">{score}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="snake-canvas"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchRef.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touchRef.current;
          if (!start) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
          if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0);
          else turn(0, dy > 0 ? 1 : -1);
          touchRef.current = null;
        }}
      />
      <div className="snake-overlay">
        {phase === "ready" && <p>Arrow keys / WASD to start</p>}
        {phase === "dead" && (
          <button type="button" onClick={reset} className="snake-retry">
            Play again
          </button>
        )}
      </div>
    </div>
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  s: { snake: Cell[]; food: Cell },
) {
  // Board.
  ctx.fillStyle = "#10141f";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL);
    ctx.lineTo(WIDTH, y * CELL);
    ctx.stroke();
  }

  // Food.
  ctx.fillStyle = "#ff5470";
  ctx.beginPath();
  ctx.arc(
    s.food.x * CELL + CELL / 2,
    s.food.y * CELL + CELL / 2,
    CELL / 2 - 2,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Snake — head brighter than body.
  s.snake.forEach((c, i) => {
    ctx.fillStyle = i === 0 ? "#7CFC9B" : "#36b56a";
    const pad = i === 0 ? 1 : 2;
    roundRect(ctx, c.x * CELL + pad, c.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 5);
    ctx.fill();
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
