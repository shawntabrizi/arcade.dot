# CLAUDE.md

Guidance for AI coding assistants working in this repo.

## Project shape

This is a Polkadot Playground starter template. A single-player game with an **on-chain leaderboard**, designed so the **game** and the **scoreboard backend** are independent — either can be swapped without touching the other.

Three layers, three folders:

- `src/games/` — game components. Each implements `GameComponentProps` (`src/games/types.ts`) and calls `onGameEnd(score)` exactly once per match. Must not import from `src/scoreboard/`.
- `src/scoreboard/` — leaderboard layer. `api.ts` defines `ScoreboardAPI`; `contract-impl.ts` is the default (PVM contract on Paseo Asset Hub); `local-impl.ts` is a localStorage fallback for offline dev; `Leaderboard.tsx` is the backend-agnostic UI.
- `src/App.tsx` — the only file that wires a specific game to a specific backend. All composition lives here.

The smart contract source is at `contracts/leaderboard/lib.rs`. It stores `best[name] = score` plus an enumerable index. Frontend talks to it via `@dotdm/cdm`.

The two interfaces — `GameComponentProps` and `ScoreboardAPI` — are the seams. Anything implementing one is a drop-in.

## Identity model

Every transaction is signed by `//Alice` (a hardcoded dev signer). The contract uses the **display name** as the identity, not `caller()`. This is a deliberate starter trade-off:

- Zero auth UX → runs out of the box.
- Multiple players are differentiated by display name.
- Anyone can submit any name (no anti-spoofing).

Replacing `//Alice` with a real signer is a documented mod. Adding caller-based identity is a documented quest. Don't change either silently — both are user-facing trade-offs.

## When the user wants to swap something

Read [`docs/modding.md`](docs/modding.md) and follow it. It covers:

- The contract for game components (`GameComponentProps`)
- The contract for backends (`ScoreboardAPI`)
- Step-by-step recipes for swapping the game, switching to localStorage, replacing the dev signer, and adding Bulletin-backed history
- Common pitfalls (e.g. calling `onGameEnd` more than once)

Don't reinvent the recipes here — the doc is the source of truth for users *and* agents.

## Conventions worth respecting

- Don't import `src/scoreboard/` from inside a game. The whole point of the architecture is that games are storage-agnostic.
- Don't read or write `localStorage` for score data from inside a game.
- Keep `submitScore` resolving only after the write is durable. The UI refreshes the leaderboard on resolve.
- The default backend is the contract. Don't switch the default to `localScoreboard` without asking — the on-chain story is the architectural point of this template.
- Don't bypass the contract by writing scores directly to localStorage when the contract is unavailable. The current behavior (banner + disabled submission) is intentional — it surfaces the deploy step rather than papering over it.

## Files that follow the playground registry convention

- `template.json` — registry metadata (`kind: "starter-template"`)
- `quests.json` — mod ideas surfaced on the App Detail Page
- `setup.sh` — runs after `dot mod` clones the repo

## Contract changes

Contract source: `contracts/leaderboard/lib.rs`. After any contract change:

```bash
dot deploy --contracts
```

This rebuilds and redeploys the contract, then rewrites `cdm.json` with the new address and ABI. Restart `npm run dev` to pick up the change.

`cdm` is still in the loop structurally — `dot --contracts` wraps `cdm build` + `cdm deploy` + `cdm install`, and the frontend uses `@dotdm/cdm` at runtime. We just don't surface `cdm` commands in user docs.
