# Modding guide

This template is built so you can change the game or the leaderboard backend independently. Both swaps are small, mechanical changes — this guide walks through each one.

## How the pieces fit together

Three folders, three responsibilities:

- **`src/games/`** — Whatever game you ship. Renders itself, runs its own logic, calls a single callback when a match ends. Knows nothing about storage, players, or the chain.
- **`src/scoreboard/`** — The leaderboard layer. Defines an interface (`ScoreboardAPI`), provides two implementations (`contractScoreboard` is the default, `localScoreboard` is an offline alternative), and renders the leaderboard UI. Knows nothing about which game produced the scores.
- **`src/App.tsx`** — The only file that wires a specific game to a specific scoreboard implementation. Everything that connects the two layers happens here.

The smart contract sits behind the scoreboard layer:

- **`contracts/leaderboard/lib.rs`** — the GCS v1 reference contract (SPEC §4.6) on Paseo Asset Hub: personal bests keyed by `caller()` (H160), a top-100 leaderboard, a 20-slot recent ring, and activity stats. The TypeScript reads it via `@polkadot-api/sdk-ink` (`src/scoreboard/gcs.ts` / `reads.ts`); writes go through the `ChainGateway` seam (`gateway.ts` → `sdk-gateway.ts`).

That's the whole architecture. Two interfaces (`GameComponentProps`, `ScoreboardAPI`) define the seams; everything else is implementation behind one of them.

---

## Swap the game

Replace Snake with anything that produces a numeric score — 2048, Flappy Bird, a clicker, a reaction-time test. Anything that ends with a single number is a fit.

### The contract

A game in this template is a React component that satisfies `GameComponentProps` (defined in `src/games/types.ts`):

```ts
export interface GameComponentProps {
  onGameEnd: (score: number) => void;
}
```

Three rules for a game component:

1. It renders its own UI (canvas, DOM, whatever — your call).
2. It calls `onGameEnd(score)` **exactly once** when the match ends.
3. It does not import from `src/scoreboard/`. Score persistence is somebody else's problem.

### The recipe

1. **Create the game file.** Put it under `src/games/<your-game>/<YourGame>.tsx`. A skeleton:

   ```tsx
   import { useState } from "react";
   import type { GameComponentProps } from "../types";

   export function ClickerGame({ onGameEnd }: GameComponentProps) {
     const [clicks, setClicks] = useState(0);
     const [done, setDone] = useState(false);

     return (
       <div>
         <p>Clicks: {clicks}</p>
         {!done && (
           <button
             onClick={() => setClicks((c) => c + 1)}
             onDoubleClick={() => {
               setDone(true);
               onGameEnd(clicks);
             }}
           >
             Click me (double-click to finish)
           </button>
         )}
       </div>
     );
   }
   ```

2. **Wire it up.** In `src/App.tsx`, change one import and one JSX line:

   ```diff
   - import { SnakeGame } from "./games/snake/SnakeGame";
   + import { ClickerGame } from "./games/clicker/ClickerGame";

   - <SnakeGame onGameEnd={onGameEnd} />
   + <ClickerGame onGameEnd={onGameEnd} />
   ```

That's the whole swap. The leaderboard, player input, and storage layer are unchanged.

### Common pitfalls

- **Calling `onGameEnd` more than once.** The leaderboard records every call as a score submission — and on the on-chain backend, every call is a transaction. Gate the callback behind a "has-ended" flag.
- **Calling `onGameEnd` from inside `useEffect` cleanup.** Cleanups run on unmount and on prop changes — easy way to fire end-of-game twice.
- **Submitting fractional scores.** The contract stores scores as `u128`. Round to integers in the game before calling `onGameEnd`, or convert in `App.tsx` before submission.

### Game ideas that fit cleanly

- **2048** — score = sum of merged tiles
- **Snake** — score = food eaten
- **Clicker** — score = clicks in a fixed time window
- **Memory match** — score = `1000 - moves` (lower moves = higher score)
- **Reaction time** — score = `max(0, 1000 - ms)`

Anything that ends with a single number is a fit.

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

The contract lives in `contracts/leaderboard/lib.rs` — the GCS v1 reference implementation (SPEC §4.6). The template is designed to **deploy it unmodified**: its ABI is identical for every conforming game, which is what lets the dashboard read any game generically. If you change it, you risk breaking that conformance — keep `arcadeVersion()` returning `1` and the §4 read/write surface intact. After changes:

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
