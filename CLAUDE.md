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

The contract is keyed by `pvm::caller()` — the H160 the runtime maps the substrate signer to. Each browser holds its own **burner wallet** (sr25519 mnemonic in localStorage, see `src/scoreboard/signer.ts`), which is what signs `submit_score`. So each browser shows up as a distinct H160 on the leaderboard.

A fresh burner has no balance and isn't registered with `pallet_revive`, so on first submit `src/scoreboard/bootstrap.ts` runs a one-time setup using `//Alice` as a faucet:

1. `//Alice` calls `Balances.transfer_keep_alive` to fund the burner.
2. The burner calls `Revive.map_account()` to register itself as a caller.
3. The burner can now sign `submit_score(score)` on its own.

Trade-offs in this setup:

- Zero player-side auth UX (no extension, no manual faucet) — runs out of the box.
- `//Alice` is still in the codebase, but only as the shared faucet. Real submissions are signed by the player's own burner.
- A future PR adds a singleton "Arcade" registry contract that aggregates scores across games — see `docs/modding.md`.

Don't reintroduce display-name identity, `//Alice` as the submission signer, or anonymous spoofable IDs without surfacing the trade-off.

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
