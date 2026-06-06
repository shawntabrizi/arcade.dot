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

## Identity model (SPEC §8)

A player is their **host wallet account** — the Polkadot account from the host
environment, exposed via product-sdk's `SignerManager` (host provider, NOT
per-app product accounts). The burner-wallet + `//Alice` faucet machinery has
been **removed entirely** (SPEC §8.1).

The flow lives in the scoreboard layer:

- **Guest mode (default) = zero chain interaction.** No account, no funding, no
  mapping. The game runs; a score worth keeping is held in `localStorage`
  (`src/scoreboard/scoreboard.ts`) so it survives the session.
- **At game over**, a guest who beat their locally-known best is prompted:
  *"Sign in to save your score"*. Accepting runs, once:
  `SignerManager.connect("host")` → `ensureAccountMapped` (product-sdk-tx,
  idempotent `pallet_revive` mapping) → `submitScore` via `submitAndWatch` at
  best-block.
- **Signed-in players** submit directly at game over (every play counts; a
  non-improving `submitScore` never reverts — SPEC §4.2).
- **`requiresAccount`** (a template config switch in `App.tsx`) gates sign-in at
  launch instead of at game over (SPEC §8.3).

The single chain seam is `ChainGateway` (`src/scoreboard/gateway.ts`). The real
product-sdk wiring is isolated in `src/scoreboard/sdk-gateway.ts`; unit tests
inject a fake gateway and never import the SDK. The pure policy
(`scoreboard.ts`) is what the tests target.

Display names are NOT the template's concern — the dashboard resolves DotNS
reverse names (SPEC §8.2). In-game the board shows truncated H160 addresses.

Don't reintroduce burner keys, a faucet, `//Alice` as a signer, or display-name
identity — all removed per SPEC §8.

> ⚠ The full SignerManager → ensureAccountMapped → submitScore round-trip must
> be validated inside a real Triangle host on paseo-next-v2 (BUILD_PLAN item 6).
> `sdk-gateway.ts` is assembled to the §8.1 contract but unverified in-host.

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
- Writes resolve at **best-block inclusion**, not finalization, for latency (`submitAndWatch(..., { waitFor: "best-block" })` in `src/scoreboard/sdk-gateway.ts`). This trades finality durability for speed — fine for a game; the tx still finalizes. Reads use a best-block ink SDK (`inkSdkBest` in `gcs.ts`) so they stay coherent with just-included writes. Don't read at finalized while writing at best-block (you'll get stale reads / `AccountUnmapped`).
- The leaderboard updates optimistically on submit and reconciles on refresh. `ensureAccountMapped` runs as part of the submit funnel (idempotent — short-circuits when already mapped). Keep it off the perceived latency path.
- The default read backend is the GCS contract (`reads.ts`). `localScoreboard`/`createLocalGateway` (`local-impl.ts`) is the play-fully-offline fallback — don't make it the default without asking; the on-chain story is the architectural point.
- The one game contract the template talks to is `@arcade/gcs-reference` (SPEC §4.6). The old leaderboard/arcade contracts and the fire-and-forget `record_score` are gone.

## Files that follow the playground registry convention

- `template.json` — registry metadata (`kind: "starter-template"`)
- `quests.json` — mod ideas surfaced on the App Detail Page
- `setup.sh` — runs after `dot mod` clones the repo

## Contract

The template ships the canonical GCS v1 reference contract (SPEC §4.6); the dev
deploys it unmodified. Its ABI is identical for every conforming game, so the
frontend reads `cdm.json` for the deployed address + ABI of
`@arcade/gcs-reference` and talks to it via `@polkadot-api/sdk-ink` at runtime
(`src/scoreboard/gcs.ts`). The deploy/registration pipeline that writes
`cdm.json` is BUILD_PLAN item 8.
