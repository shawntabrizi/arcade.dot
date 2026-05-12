# Modding guide

This template is built so you can change the game or the leaderboard backend independently. Both swaps are small, mechanical changes — this guide walks through each one.

## How the pieces fit together

Three folders, three responsibilities:

- **`src/games/`** — Whatever game you ship. Renders itself, runs its own logic, calls a single callback when a match ends. Knows nothing about storage, players, or the chain.
- **`src/scoreboard/`** — The leaderboard layer. Defines an interface (`ScoreboardAPI`), provides two implementations (`contractScoreboard` is the default, `localScoreboard` is an offline alternative), and renders the leaderboard UI. Knows nothing about which game produced the scores.
- **`src/App.tsx`** — The only file that wires a specific game to a specific scoreboard implementation. Everything that connects the two layers happens here.

The smart contract sits behind the scoreboard layer:

- **`contracts/leaderboard/lib.rs`** — A PVM contract on Paseo Asset Hub. Stores `best[name] = score` and an enumerable index of names. The `contractScoreboard` in TypeScript talks to it via `@dotdm/cdm`.

That's the whole architecture. Two interfaces (`GameComponentProps`, `ScoreboardAPI`) define the seams; everything else is implementation behind one of them.

---

## Swap the game

Replace Flappy Bird with anything that produces a numeric score — 2048, Snake, a clicker, a reaction-time test. Anything that ends with a single number is a fit.

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
   - import { FlappyGame } from "./games/flappy/FlappyGame";
   + import { ClickerGame } from "./games/clicker/ClickerGame";

   - <FlappyGame onGameEnd={onGameEnd} />
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

The shipped default is `contractScoreboard` — scores written to a PVM contract on Paseo Asset Hub, signed by `//Alice`. Two interesting alternatives:

- **`localScoreboard`** — already in the repo. Drops back to `localStorage`. Useful for offline dev, demos, and showing the architecture without deploying.
- **A custom backend** — anything implementing `ScoreboardAPI`. Examples below.

### The contract

A backend is anything that satisfies `ScoreboardAPI` (defined in `src/scoreboard/api.ts`):

```ts
export interface ScoreboardAPI {
  submitScore(player: string, score: number): Promise<void>;
  getTopScores(limit?: number): Promise<ScoreEntry[]>;
  getPlayerBest(player: string): Promise<number | null>;
}
```

The `Leaderboard` component, the player input, and the game all stay exactly the same. The only file that knows which backend is in use is `src/App.tsx`.

### Recipe — drop back to localStorage

For offline dev, presentations, or testing UI changes without funding accounts:

```diff
- import { contractScoreboard, isLeaderboardContractDeployed } from "./scoreboard/contract-impl";
- const SCOREBOARD = contractScoreboard;
- const CONTRACT_DEPLOYED = isLeaderboardContractDeployed();
+ import { localScoreboard } from "./scoreboard/local-impl";
+ const SCOREBOARD = localScoreboard;
+ const CONTRACT_DEPLOYED = true; // localStorage is always "deployed"
```

The game and `Leaderboard` keep working unchanged.

### Recipe — replace `//Alice` with a real signer

By default, every score submission is signed by `//Alice`. That's fine for demos but obviously wrong for production. To swap in real authentication:

1. Pick a signer source. Common options:
   - **Polkadot extension / mobile app** via `@polkadot-apps/signer`'s `SignerManager`
   - **A user-supplied secret URI** typed into the UI on first run (per-browser identity)
   - **Session keys** from the playground.dot Polkadot mobile app sign-in flow

2. Edit `src/scoreboard/contract-impl.ts`. Replace `getDevSigner()` with a function that returns the user's `PolkadotSigner`:

   ```ts
   import { signerManager } from "./your-signer-setup";

   function getActiveSigner() {
     const account = signerManager.getState().selectedAccount;
     if (!account) throw new Error("Not connected — please sign in first.");
     return account.getSigner();
   }
   ```

   Pass it to `createCdm` via `defaultSigner`.

3. Optionally, switch the contract to use `caller()` as the identity (instead of the display-name string) — see the "Caller-based identity" quest in `quests.json`.

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

The contract lives in `contracts/leaderboard/lib.rs`. After changes:

```bash
dot deploy --contracts
```

This rebuilds and redeploys the contract, then rewrites `cdm.json` with the new address and ABI. The frontend re-reads it on next dev server restart.

### Common contract changes

- **Add a `caller()` field** to `Entry` so the leaderboard shows who submitted each score (in addition to the display name).
- **Add anti-spam:** rate-limit per caller (e.g. one submission per N blocks), or require a small fee.
- **Add a `game_id`** so multiple games share the same contract — the API change to `ScoreboardAPI.submitScore` is straightforward, and `Leaderboard.tsx` only needs to know how to filter by game.

---

## Doing both at once

Swapping the game and the backend at the same time is fine — they're independent surfaces. The order doesn't matter. If you change `App.tsx` once for each swap, you're done.
