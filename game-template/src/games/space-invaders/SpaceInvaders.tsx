import { useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "../types";
import "./space-invaders.css";

// Space Invaders — modeled on Snake's shape (canvas rendering, keyboard input,
// higher-is-better points), plus on-screen touch buttons so it's playable on
// mobile. Like every template game it renders ONLY gameplay into the
// shell-provided surface (fills 100% of its parent), imports nothing from
// scoreboard/ or App, and calls onGameEnd(integer >= 0) EXACTLY ONCE per match
// (guarded by s.ended). Score = points for aliens destroyed.
//
// Internal coordinates use a fixed logical canvas (matches the template's game
// column, 360x540); the canvas element is stretched to fill the surface by CSS.
const WIDTH = 360;
const HEIGHT = 540;

const PLAYER_W = 34;
const PLAYER_H = 16;
const PLAYER_Y = HEIGHT - 40;
const PLAYER_SPEED = 4; // px per frame at 60fps

const ALIEN_COLS = 6;
const ALIEN_ROWS = 4;
const ALIEN_W = 26;
const ALIEN_H = 18;
const ALIEN_GAP_X = 16;
const ALIEN_GAP_Y = 14;
const ALIEN_LEFT = 24;
const ALIEN_TOP = 60;
const ALIEN_STEP_DOWN = 16; // px dropped when the formation hits an edge

const BULLET_W = 3;
const BULLET_H = 10;
const BULLET_SPEED = 7;
const SHOOT_COOLDOWN_MS = 320;

const BOMB_W = 3;
const BOMB_H = 10;
const BOMB_SPEED = 3;
const BOMB_CHANCE_PER_SEC = 0.9; // expected bombs dropped per second across fleet

const POINTS_PER_ALIEN = 10;

type Phase = "ready" | "playing" | "dead";

interface Rect {
  x: number;
  y: number;
}

interface Alien extends Rect {
  alive: boolean;
}

function makeAliens(): Alien[] {
  const aliens: Alien[] = [];
  for (let r = 0; r < ALIEN_ROWS; r++) {
    for (let c = 0; c < ALIEN_COLS; c++) {
      aliens.push({
        x: ALIEN_LEFT + c * (ALIEN_W + ALIEN_GAP_X),
        y: ALIEN_TOP + r * (ALIEN_H + ALIEN_GAP_Y),
        alive: true,
      });
    }
  }
  return aliens;
}

function initialState() {
  return {
    playerX: WIDTH / 2 - PLAYER_W / 2,
    moveDir: 0, // -1 left, 0 idle, 1 right (set by held input)
    bullets: [] as Rect[],
    bombs: [] as Rect[],
    aliens: makeAliens(),
    alienDir: 1 as 1 | -1,
    alienSpeed: 0.4, // px per frame; rises as aliens die
    score: 0,
    phase: "ready" as Phase,
    lastShotAt: 0,
    last: 0,
    ended: false,
    wantShoot: false,
  };
}

export function SpaceInvaders({ onGameEnd }: GameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  // On-screen controls are for touch devices only. Detect a coarse pointer
  // (phone/tablet) up front, and also reveal on the first real touch in case
  // the media query is unavailable. A fine pointer (mouse) keeps them hidden so
  // desktop/keyboard play never shows buttons over the play area.
  const [isTouch, setIsTouch] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(pointer: coarse)").matches;
  });
  const stateRef = useRef(initialState());

  // Reveal controls on the first touch (covers devices a media query misses).
  useEffect(() => {
    if (isTouch) return;
    const onTouch = () => setIsTouch(true);
    window.addEventListener("touchstart", onTouch, { passive: true });
    return () => window.removeEventListener("touchstart", onTouch);
  }, [isTouch]);

  function reset() {
    stateRef.current = initialState();
    setScore(0);
    setPhase("ready");
  }

  // Begin play on the first meaningful input.
  function startIfReady() {
    const s = stateRef.current;
    if (s.phase === "ready") {
      s.phase = "playing";
      setPhase("playing");
    }
  }

  function setMove(dir: number) {
    const s = stateRef.current;
    if (s.phase === "dead") return;
    s.moveDir = dir;
    if (dir !== 0) startIfReady();
  }

  function shoot() {
    const s = stateRef.current;
    if (s.phase === "dead") return;
    startIfReady();
    s.wantShoot = true;
  }

  // Keyboard: arrows to move, space to fire.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          e.preventDefault();
          setMove(-1);
          break;
        case "ArrowRight":
        case "KeyD":
          e.preventDefault();
          setMove(1);
          break;
        case "Space":
        case "ArrowUp":
        case "KeyW":
          e.preventDefault();
          shoot();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (
        (e.code === "ArrowLeft" || e.code === "KeyA") && s.moveDir === -1
      ) {
        s.moveDir = 0;
      } else if (
        (e.code === "ArrowRight" || e.code === "KeyD") && s.moveDir === 1
      ) {
        s.moveDir = 0;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
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
      onGameEnd(Math.max(0, Math.round(s.score)));
    }

    function rectsOverlap(a: Rect, aw: number, ah: number, b: Rect, bw: number, bh: number) {
      return a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y;
    }

    function update(s: typeof stateRef.current, dt: number) {
      // Player movement.
      s.playerX += s.moveDir * PLAYER_SPEED;
      if (s.playerX < 0) s.playerX = 0;
      if (s.playerX > WIDTH - PLAYER_W) s.playerX = WIDTH - PLAYER_W;

      // Shooting (rate-limited, one bullet on screen feels classic but we allow
      // a few). Use a cooldown so holding space doesn't spray.
      if (s.wantShoot) {
        s.wantShoot = false;
        const now = performance.now();
        if (now - s.lastShotAt >= SHOOT_COOLDOWN_MS) {
          s.lastShotAt = now;
          s.bullets.push({ x: s.playerX + PLAYER_W / 2 - BULLET_W / 2, y: PLAYER_Y - BULLET_H });
        }
      }

      // Bullets move up.
      for (const b of s.bullets) b.y -= BULLET_SPEED;
      s.bullets = s.bullets.filter((b) => b.y + BULLET_H > 0);

      // Bombs move down.
      for (const b of s.bombs) b.y += BOMB_SPEED;
      s.bombs = s.bombs.filter((b) => b.y < HEIGHT);

      // Alien formation movement: shift horizontally; on edge, drop + reverse.
      const living = s.aliens.filter((a) => a.alive);
      if (living.length === 0) {
        // Cleared the wave — survive and score stands. End the match as a win.
        die(s);
        return;
      }
      const minX = Math.min(...living.map((a) => a.x));
      const maxX = Math.max(...living.map((a) => a.x + ALIEN_W));
      const dx = s.alienDir * s.alienSpeed * (dt / (1000 / 60));
      if ((maxX + dx >= WIDTH && s.alienDir === 1) || (minX + dx <= 0 && s.alienDir === -1)) {
        s.alienDir = (s.alienDir === 1 ? -1 : 1) as 1 | -1;
        for (const a of s.aliens) a.y += ALIEN_STEP_DOWN;
      } else {
        for (const a of s.aliens) if (a.alive) a.x += dx;
      }

      // Aliens drop bombs at random (only from the lowest alien in each column
      // to feel fair). Probability scaled by dt.
      const dropProb = BOMB_CHANCE_PER_SEC * (dt / 1000);
      if (Math.random() < dropProb) {
        const shooter = living[Math.floor(Math.random() * living.length)];
        s.bombs.push({ x: shooter.x + ALIEN_W / 2 - BOMB_W / 2, y: shooter.y + ALIEN_H });
      }

      // Bullet vs alien collisions.
      for (const b of s.bullets) {
        for (const a of s.aliens) {
          if (a.alive && rectsOverlap(b, BULLET_W, BULLET_H, a, ALIEN_W, ALIEN_H)) {
            a.alive = false;
            b.y = -100; // mark bullet for removal next frame
            s.score += POINTS_PER_ALIEN;
            setScore(s.score);
            // Fewer aliens => faster fleet.
            s.alienSpeed = 0.4 + (ALIEN_COLS * ALIEN_ROWS - living.length + 1) * 0.06;
            break;
          }
        }
      }
      s.bullets = s.bullets.filter((b) => b.y + BULLET_H > 0);

      // Lose conditions: a bomb hits the ship, an alien reaches the player row.
      const player: Rect = { x: s.playerX, y: PLAYER_Y };
      for (const bomb of s.bombs) {
        if (rectsOverlap(bomb, BOMB_W, BOMB_H, player, PLAYER_W, PLAYER_H)) {
          die(s);
          return;
        }
      }
      for (const a of s.aliens) {
        if (a.alive && a.y + ALIEN_H >= PLAYER_Y) {
          die(s);
          return;
        }
      }
    }

    const loop = (now: number) => {
      const s = stateRef.current;
      if (s.last === 0) s.last = now;
      let dt = now - s.last;
      s.last = now;
      if (dt > 50) dt = 50; // clamp after tab-away so physics doesn't jump

      if (s.phase === "playing") {
        update(s, dt);
      }

      draw(ctx, s);
      raf = requestAnimationFrame(loop);
    };

    // ⚠ TEST-ONLY hook mirroring SnakeGame: deterministic game-over for e2e.
    // Exposed only when VITE_ARCADE_FAKE_GATEWAY is set, absent from real builds.
    let detachHook: (() => void) | undefined;
    if (import.meta.env.VITE_ARCADE_FAKE_GATEWAY === "1") {
      const force = (forced: number) => {
        const s = stateRef.current;
        s.score = forced;
        setScore(forced);
        die(s);
      };
      (window as unknown as { __invadersForceGameOver?: (n: number) => void })
        .__invadersForceGameOver = force;
      detachHook = () => {
        delete (window as unknown as { __invadersForceGameOver?: (n: number) => void })
          .__invadersForceGameOver;
      };
    }

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      detachHook?.();
    };
  }, [onGameEnd]);

  return (
    <div className="si-wrap">
      <div className="si-hud">
        <span className="si-score">{score}</span>
      </div>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="si-canvas" />

      {/* On-screen touch controls — touch devices only (keyboard play never
          shows them). Movement keys sit in the bottom-LEFT corner and fire in
          the bottom-RIGHT corner so the ship's lane (bottom-center) and falling
          bombs stay fully visible. Pointer events drive the same setMove/shoot
          the keyboard does. */}
      {isTouch && phase === "playing" && (
        <>
          <div className="si-controls si-controls-left">
            <button
              type="button"
              className="si-btn si-left"
              aria-label="Move left"
              onPointerDown={(e) => {
                e.preventDefault();
                setMove(-1);
              }}
              onPointerUp={() => setMove(0)}
              onPointerLeave={() => {
                if (stateRef.current.moveDir === -1) setMove(0);
              }}
            >
              ◀
            </button>
            <button
              type="button"
              className="si-btn si-right"
              aria-label="Move right"
              onPointerDown={(e) => {
                e.preventDefault();
                setMove(1);
              }}
              onPointerUp={() => setMove(0)}
              onPointerLeave={() => {
                if (stateRef.current.moveDir === 1) setMove(0);
              }}
            >
              ▶
            </button>
          </div>
          <div className="si-controls si-controls-right">
            <button
              type="button"
              className="si-btn si-fire"
              aria-label="Fire"
              onPointerDown={(e) => {
                e.preventDefault();
                shoot();
              }}
            >
              ▲
            </button>
          </div>
        </>
      )}

      <div className="si-overlay">
        {phase === "ready" && (
          <button type="button" onClick={startIfReady} className="si-action">
            <span className="si-title">Space Invaders</span>
            <span className="si-sub">Arrows / buttons to move · Space / ▲ to fire</span>
            <span className="si-start">Tap to start</span>
          </button>
        )}
        {phase === "dead" && (
          <button type="button" onClick={reset} className="si-retry">
            Play again
          </button>
        )}
      </div>
    </div>
  );
}

function draw(ctx: CanvasRenderingContext2D, s: ReturnType<typeof initialState>) {
  // Background.
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Starfield (static-ish, cheap).
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  for (let i = 0; i < 30; i++) {
    const x = (i * 53) % WIDTH;
    const y = (i * 97) % HEIGHT;
    ctx.fillRect(x, y, 1, 1);
  }

  // Aliens.
  for (const a of s.aliens) {
    if (!a.alive) continue;
    ctx.fillStyle = "#7CFC9B";
    ctx.fillRect(a.x, a.y, ALIEN_W, ALIEN_H);
    // simple "eyes" to read as invaders
    ctx.fillStyle = "#070b14";
    ctx.fillRect(a.x + 5, a.y + 6, 4, 4);
    ctx.fillRect(a.x + ALIEN_W - 9, a.y + 6, 4, 4);
  }

  // Bombs.
  ctx.fillStyle = "#ff5470";
  for (const b of s.bombs) ctx.fillRect(b.x, b.y, BOMB_W, BOMB_H);

  // Bullets.
  ctx.fillStyle = "#ffe66d";
  for (const b of s.bullets) ctx.fillRect(b.x, b.y, BULLET_W, BULLET_H);

  // Player ship (triangle-ish).
  ctx.fillStyle = "#4dd2ff";
  const px = s.playerX;
  ctx.beginPath();
  ctx.moveTo(px + PLAYER_W / 2, PLAYER_Y);
  ctx.lineTo(px, PLAYER_Y + PLAYER_H);
  ctx.lineTo(px + PLAYER_W, PLAYER_Y + PLAYER_H);
  ctx.closePath();
  ctx.fill();
}
