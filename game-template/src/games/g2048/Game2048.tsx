import { useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "../types";
import "./g2048.css";

// 2048 — classic 4×4 slide/merge puzzle. Higher-is-better points: score is the
// sum of all merge values (the standard 2048 score). Input is arrow keys AND
// swipe (touchstart/touchend, dominant axis) — reusing Snake's swipe pattern.
// DOM tiles, not canvas. Like every template game it renders ONLY gameplay into
// the shell-provided surface (fills 100% of its parent), imports nothing from
// scoreboard/ or App, and calls onGameEnd(score) EXACTLY ONCE per match.

const SIZE = 4;

type Grid = number[][]; // 0 = empty cell

type Dir = "up" | "down" | "left" | "right";

function emptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
}

function cloneGrid(g: Grid): Grid {
  return g.map((row) => row.slice());
}

function emptyCells(g: Grid): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (g[r][c] === 0) cells.push([r, c]);
  return cells;
}

// Spawn a new tile (90% → 2, 10% → 4) in a random empty cell. Mutates g.
function spawn(g: Grid) {
  const cells = emptyCells(g);
  if (cells.length === 0) return;
  const [r, c] = cells[Math.floor(Math.random() * cells.length)];
  g[r][c] = Math.random() < 0.9 ? 2 : 4;
}

// Slide + merge a single row to the left. Returns the new row and the points
// gained from merges this row. Used for all four directions by transforming.
function collapseRow(row: number[]): { row: number[]; gained: number } {
  const tiles = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      const merged = tiles[i] * 2;
      out.push(merged);
      gained += merged;
      i++; // skip the merged-away tile
    } else {
      out.push(tiles[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  return { row: out, gained };
}

function rotateCW(g: Grid): Grid {
  const out = emptyGrid();
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) out[c][SIZE - 1 - r] = g[r][c];
  return out;
}

function rotateCCW(g: Grid): Grid {
  const out = emptyGrid();
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) out[SIZE - 1 - c][r] = g[r][c];
  return out;
}

// Apply a move in the given direction. Normalize to a leftward collapse by
// rotating, collapse each row, then rotate back. Returns the new grid, points
// gained, and whether anything actually moved.
function move(g: Grid, dir: Dir): { grid: Grid; gained: number; moved: boolean } {
  let work = cloneGrid(g);
  if (dir === "up") work = rotateCCW(work);
  else if (dir === "down") work = rotateCW(work);
  else if (dir === "right") work = work.map((row) => row.slice().reverse());

  let gained = 0;
  const collapsed = work.map((row) => {
    const res = collapseRow(row);
    gained += res.gained;
    return res.row;
  });

  let result = collapsed;
  if (dir === "up") result = rotateCW(collapsed);
  else if (dir === "down") result = rotateCCW(collapsed);
  else if (dir === "right") result = collapsed.map((row) => row.slice().reverse());

  const moved = JSON.stringify(result) !== JSON.stringify(g);
  return { grid: result, gained, moved };
}

function hasMoves(g: Grid): boolean {
  if (emptyCells(g).length > 0) return true;
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      if (c + 1 < SIZE && g[r][c] === g[r][c + 1]) return true;
      if (r + 1 < SIZE && g[r][c] === g[r + 1][c]) return true;
    }
  return false;
}

function freshGrid(): Grid {
  const g = emptyGrid();
  spawn(g);
  spawn(g);
  return g;
}

export function Game2048({ onGameEnd }: GameComponentProps) {
  const [grid, setGrid] = useState<Grid>(freshGrid);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  // SPEC §10.4 / CLAUDE.md §1: onGameEnd fires once per match. This is the guard.
  const endedRef = useRef(false);
  // Latest values for the keydown/touch handlers without re-binding listeners.
  const gridRef = useRef(grid);
  const scoreRef = useRef(score);
  gridRef.current = grid;
  scoreRef.current = score;

  function reset() {
    endedRef.current = false;
    setGrid(freshGrid());
    setScore(0);
    setOver(false);
  }

  function finish(finalScore: number) {
    if (endedRef.current) return;
    endedRef.current = true;
    setOver(true);
    onGameEnd(Math.max(0, Math.round(finalScore)));
  }

  function doMove(dir: Dir) {
    if (endedRef.current) return;
    const { grid: next, gained, moved } = move(gridRef.current, dir);
    if (!moved) return;
    spawn(next);
    const newScore = scoreRef.current + gained;
    setGrid(next);
    setScore(newScore);
    if (!hasMoves(next)) finish(newScore);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      let dir: Dir | null = null;
      switch (e.code) {
        case "ArrowUp":
        case "KeyW":
          dir = "up";
          break;
        case "ArrowDown":
        case "KeyS":
          dir = "down";
          break;
        case "ArrowLeft":
        case "KeyA":
          dir = "left";
          break;
        case "ArrowRight":
        case "KeyD":
          dir = "right";
          break;
      }
      if (dir) {
        e.preventDefault();
        doMove(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // doMove reads latest state via refs, so bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Touch: swipe to move (dominant axis), same pattern as Snake.
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="g2048-wrap">
      <div className="g2048-hud">
        <span className="g2048-score">{score}</span>
      </div>
      <div
        className="g2048-board"
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
          touchRef.current = null;
          if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
          if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? "right" : "left");
          else doMove(dy > 0 ? "down" : "up");
        }}
      >
        {grid.map((row, r) =>
          row.map((v, c) => (
            <div key={`${r}-${c}`} className="g2048-cell">
              {v > 0 && (
                <div className={`g2048-tile g2048-tile-${v <= 2048 ? v : "super"}`}>
                  {v}
                </div>
              )}
            </div>
          )),
        )}
      </div>
      <div className="g2048-overlay">
        {over && (
          <div className="g2048-gameover">
            <p className="g2048-gameover-title">Game over</p>
            <button type="button" onClick={reset} className="g2048-retry">
              Play again
            </button>
          </div>
        )}
      </div>
      {/* TEST-ONLY deterministic game-over hook, mirroring SnakeGame: present
          only when VITE_ARCADE_FAKE_GATEWAY is set, absent from normal builds. */}
      <FakeGatewayHook
        onForce={(s) => {
          setScore(s);
          finish(s);
        }}
      />
    </div>
  );
}

// Exposes window.__game2048ForceGameOver(score) only under the fake gateway so
// the dev/e2e harness can end a match deterministically (CLAUDE.md §1 pattern).
function FakeGatewayHook({ onForce }: { onForce: (score: number) => void }) {
  useEffect(() => {
    if (import.meta.env.VITE_ARCADE_FAKE_GATEWAY !== "1") return;
    const w = window as unknown as { __game2048ForceGameOver?: (n: number) => void };
    w.__game2048ForceGameOver = onForce;
    return () => {
      delete w.__game2048ForceGameOver;
    };
  }, [onForce]);
  return null;
}
