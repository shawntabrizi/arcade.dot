# Modding guide

This template is built so you can change the game or the leaderboard backend independently. Both swaps are small, mechanical changes — this guide walks through each one.

## How the pieces fit together

Three folders, three responsibilities:

- **`src/games/`** — Whatever game you ship. Renders itself, runs its own logic, calls a single callback when a match ends. Knows nothing about storage, players, or the chain.
- **`src/scoreboard/`** — The leaderboard layer. Defines an interface (`ScoreboardAPI`), provides two implementations (`contractScoreboard` is the default, `localScoreboard` is an offline alternative), and renders the leaderboard UI. Knows nothing about which game produced the scores.
- **`src/App.tsx`** — The composition root: it wires the active game to the scoreboard and imposes the shell (the portrait game surface, the mobile/desktop layout, the bottom tab bar, the save sheet). You do **not** edit it to swap games — that happens in `src/games/active.ts` (one re-export line).

The smart contract sits behind the scoreboard layer:

- **`contracts/gcs-reference/lib.rs`** — the GCS v1 reference contract (SPEC §4.6) on Paseo Asset Hub: personal bests keyed by `caller()` (H160), a top-100 leaderboard, a 20-slot recent ring, and activity stats. The TypeScript reads it via `@polkadot-api/sdk-ink` (`src/scoreboard/gcs.ts` / `reads.ts`); writes go through the `ChainGateway` seam (`gateway.ts` → `sdk-gateway.ts`).

That's the whole architecture. Two interfaces (`GameComponentProps`, `ScoreboardAPI`) define the seams; everything else is implementation behind one of them.

---

## Build a new game

Build any single-player game that produces a numeric score — Flappy Bird, 2048, a clicker, an aim trainer, Wordle. Anything that ends with a single integer is a fit. You write a new component and point the template at it; you do not edit Snake.

### The contract

A game in this template is a React component that satisfies `GameComponentProps` (defined in `src/games/types.ts`):

```ts
export interface GameComponentProps {
  onGameEnd: (score: number) => void;
}
```

Rules for a game component:

1. It **renders only gameplay** into the shell-provided surface (see "The shell surface" below). Its root fills 100% of its parent; the shell owns the frame and layout.
2. It calls `onGameEnd(score)` **exactly once** when the match ends, with a **non-negative integer**.
3. It does not import from `src/scoreboard/`, from `App`, or from the shell. Score persistence, identity, and layout are somebody else's problem.

### The shell surface (styling is imposed)

The shell provides a responsive **2:3 portrait surface** (`.game-surface` in `src/App.css`), plus the mobile/desktop layout, the bottom tab bar, and the game-over save sheet. Your component fills 100% of the surface and styles **only its own gameplay**:

```css
.your-game-root {
  width: 100%;
  height: 100%;
}
```

Do **not** edit `src/App.css`, `src/tokens.css`, `tailwind.config.js`, or the shell in `src/App.tsx`, and do **not** re-create the frame / radius / shadow / `dvh` sizing in your game CSS — the surface owns all of it. Any game drops into the surface and inherits the layout (Snake uses a canvas; AimTrainer uses tapped DOM targets — neither has layout code of its own).

### The two reference games

Copy whichever shape matches your game:

- **`src/games/snake/SnakeGame.tsx`** — keyboard + swipe input, **canvas** rendering, **higher-is-better** points. `onGameEnd(s.score)` once, guarded by `s.ended`.
- **`src/games/aim-trainer/AimTrainer.tsx`** — **tap (DOM/pointer)** input, DOM rendering, **lower-is-better** = reaction time in **milliseconds**. `onGameEnd(avgMs)` once, guarded by `endedRef`.

### The recipe

1. **Create the game file.** Put it under `src/games/<your-game>/<YourGame>.tsx` (plus a CSS file for your gameplay if you need one). A skeleton:

   ```tsx
   import { useRef, useState } from "react";
   import type { GameComponentProps } from "../types";

   export function ClickerGame({ onGameEnd }: GameComponentProps) {
     const [clicks, setClicks] = useState(0);
     const ended = useRef(false);

     function finish() {
       if (ended.current) return; // exactly-once guard
       ended.current = true;
       onGameEnd(clicks); // already a non-negative integer
     }

     return (
       <div style={{ width: "100%", height: "100%" }}>
         <p>Clicks: {clicks}</p>
         <button onClick={() => setClicks((c) => c + 1)}>Click me</button>
         <button onClick={finish}>Finish</button>
       </div>
     );
   }
   ```

2. **Point the swap point at it.** Edit `src/games/active.ts` (one re-export line):

   ```diff
   - export { SnakeGame as ActiveGame } from "./snake/SnakeGame";
   - export const ACTIVE_GAME_TITLE = "Snake";
   + export { ClickerGame as ActiveGame } from "./clicker/ClickerGame";
   + export const ACTIVE_GAME_TITLE = "Clicker";
   ```

That's the whole swap. `App.tsx` renders `ActiveGame` inside `.game-surface`; the leaderboard, player input, and storage layer are unchanged. **You never edit `App.tsx` for a game swap.**

### Score semantics — pick before you deploy

`scoreOrdering` and `scoreFormat` in `arcade.config.json` are immutable for the contract's life, so set them from the genre. The in-game leaderboard already sorts by `scoreOrdering` — you never sort in the game.

| Genre | `scoreOrdering` | `scoreFormat` | `scoreUnit` |
|---|---|---|---|
| Flappy Bird (points) | `0` | `0` | `""` |
| 2048 (points) | `0` | `0` | `""` |
| Clicker (count) | `0` | `0` | `""` |
| Solitaire by moves | `1` | `2` | `"moves"` |
| Aim trainer (reaction ms) | `1` | `1` | `""` |
| Wordle by guesses | `1` | `2` | `"guesses"` |

Higher-is-better → `scoreOrdering: 0`; faster/fewer → `1`. Use `scoreFormat: 1` only when the number is milliseconds; `2` + a `scoreUnit` for other units; `0` for plain points.

### Supported game shapes

One **integer per match** to a single-player leaderboard — points, a count, a duration in ms, a move/guess count. **Not supported**: multiplayer/realtime versus, persistent cross-session state or saves, or multi-statistic scoring (more than one number per match). Those need contract/SPEC changes outside the game seam.

### Common pitfalls

- **Calling `onGameEnd` more than once.** The leaderboard records every call as a score submission — and on the on-chain backend, every call is a transaction. Gate the callback behind a "has-ended" flag.
- **Calling `onGameEnd` from inside `useEffect` cleanup.** Cleanups run on unmount and on prop changes — easy way to fire end-of-game twice.
- **Submitting fractional or negative scores.** The contract stores scores as `u128`. `Math.round` and `Math.max(0, …)` before calling `onGameEnd`.
- **Re-creating the frame / sizing in your game CSS.** The shell surface owns it; your root just fills its parent (`width/height: 100%`).

---

## Swap the backend

The shipped default reads scores from the GCS contract on Paseo Asset Hub (`contractScoreboard` in `src/scoreboard/reads.ts`); writes go through the `ChainGateway` seam, signed by the **host wallet** (SPEC §8.1 — no burner, no faucet). Two interesting alternatives:

- **`localScoreboard`** — already in the repo (`src/scoreboard/local-impl.ts`). Drops back to `localStorage`. Useful for offline dev, demos, and showing the architecture without deploying.
- **A custom read backend** — anything implementing `ScoreboardAPI`. Examples below.

### The contracts

There are two seams here. The **read** surface the in-game board consumes is `ScoreboardAPI` (defined in `src/scoreboard/api.ts`):

```ts
export interface ScoreboardAPI {
  getTopScores(limit?: number): Promise<ScoreEntry[]>;
  getRecentScores(limit?: number): Promise<ScoreEntry[]>;
  getPlayerBest(player: `0x${string}`): Promise<number | null>;
}
```

The **write/identity** surface is `ChainGateway` (`src/scoreboard/gateway.ts`) — `connect()`, `ensureMapped()`, `submitScore(score)`, plus the reads. The guest / sign-in policy in `scoreboard.ts` drives it; the real product-sdk wiring lives in `sdk-gateway.ts`. Writes take no player argument — identity comes from the connected host wallet account.

The `Leaderboard` component, the game, and the policy layer all stay the same when you swap a read backend. The only file that wires a specific game to a specific board is `src/App.tsx`.

### Recipe — drop back to localStorage

For offline dev, presentations, or testing UI changes without funding accounts:

```diff
- import { contractScoreboard, isContractDeployed } from "./scoreboard/reads";
- const SCOREBOARD = contractScoreboard;
- const CONTRACT_DEPLOYED = isContractDeployed();
+ import { localScoreboard } from "./scoreboard/local-impl";
+ const SCOREBOARD = localScoreboard;
+ const CONTRACT_DEPLOYED = true; // localStorage is always "deployed"
```

The game and `Leaderboard` keep working unchanged. (Note: this swaps only the *read* board; the save flow still goes through `ChainGateway`.)

### Note — identity is the host wallet (don't reintroduce burners)

Players sign with their **host wallet account** via product-sdk's `SignerManager` (SPEC §8.1). The old per-browser burner-wallet + `//Alice` faucet model is **removed** — do not bring it back. The single chain seam is `ChainGateway` (`src/scoreboard/gateway.ts`); the real wiring (connect → `ensureAccountMapped` → `submitScore` at best-block) lives in `src/scoreboard/sdk-gateway.ts`. To target a different signer source, change `sdk-gateway.ts` behind the `ChainGateway` seam — nothing above it needs to know.

### Recipe — Bulletin-backed match history

Use the contract for the hot index (player → best score) and Bulletin for the full match history (every round, replay data, etc.):

1. After `submitScore`, upload the match history JSON to Bulletin and capture the returned CID.
2. Pair the CID with the score in your contract write, or store it in a separate mapping keyed by `(player, timestamp)`.
3. Extend `ScoreEntry` to include `cid?: string` so leaderboard rows can link to a replay view.

### Things to keep stable

- **The `ScoreEntry` shape.** `Leaderboard.tsx` reads `{ player, score, timestamp }`. Internal contract types can be whatever — but the value `getTopScores` resolves to should still match this shape.
- **`submitScore` is `async` and resolves only after the score is durably stored.** The UI refreshes the leaderboard when the promise resolves; resolving early causes the UI to flash an empty board before the score appears.
- **`getTopScores` returns sorted results, highest first.** The UI assumes this — don't push the sort responsibility into `Leaderboard.tsx`.

---

## Modifying the contract

The contract lives in `contracts/gcs-reference/lib.rs` — the GCS v1 reference implementation (SPEC §4.6). The template is designed to **deploy it unmodified**: its ABI is identical for every conforming game, which is what lets the dashboard read any game generically. If you change it, you risk breaking that conformance — keep `arcadeVersion()` returning `1` and the §4 read/write surface intact. After changes:

```bash
npm run arcade:deploy-contract
```

This rebuilds and redeploys the contract (with the score-ordering/format/unit from `arcade.config.json` and the registry address from `cdm.json` as constructor args), then rewrites `cdm.json` with the new address and ABI. The frontend re-reads it on next dev server restart.

### Common contract changes

- **Add anti-spam:** rate-limit per caller (e.g. one submission per N blocks), or require a small fee — but keep `submitScore` non-reverting on non-improving scores (SPEC §4.2).
- **Adjust the registration gate.** `updateListing` is gated `caller() == owner`; swap in a multisig or DAO check if you want shared control of the listing.

---

## Doing both at once

Swapping the game and the backend at the same time is fine — they're independent surfaces. The order doesn't matter. If you change `App.tsx` once for each swap, you're done.
