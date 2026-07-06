# Leaderboard Playground

A Polkadot Playground starter template for shipping **any** single-player game with an **on-chain leaderboard**. You write only the gameplay component and one config file; chain, identity, signing, and styling are imposed by the template. The **game** and the **scoreboard backend** stay independent — swap either without touching the other.

Ships with **two reference games** — Snake (keyboard+swipe / canvas / higher-is-better) and an Aim Trainer (tap / DOM / lower-is-better, ms) — and a PVM smart contract on Paseo Asset Hub as the leaderboard backend. Snake is the active game; point [`src/games/active.ts`](src/games/active.ts) at any component to swap.

## What you need

- Node.js (>= 20) and npm or pnpm
- The [`dot` CLI](https://github.com/paritytech/playground-cli) — installs and manages the rest of the toolchain (Rust nightly, `cdm`, `ipfs`, `gh`) and pairs with the Polkadot mobile app for signing

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | bash
```

`dot init` runs at the end of that installer — scan the QR with the Polkadot mobile app, let it install Rust + cdm + IPFS, and it'll fund + map your account on Paseo Asset Hub for you.

## First-run flow

```bash
# Frontend deps
npm install

# Build + deploy the GCS game contract to Paseo Asset Hub.
# Writes the new address + ABI into cdm.json.
npm run arcade:deploy-contract

# Dev server
npm run dev
```

Open <http://localhost:5173>. The game starts immediately as a **guest** — no account, no funding, zero chain interaction. When a guest sets a score worth keeping, game over prompts *"Sign in to save your score"* (host wallet, SPEC §8.3). The leaderboard reads the contract back live.

If you start `npm run dev` before deploying, the page renders with a banner explaining how to deploy. Score saving is disabled until the contract is in `cdm.json`.

## Testing

```bash
npm test        # unit tests (vitest): the scoreboard policy + pipeline validation
npm run test:e2e  # Playwright: the guest → save-score → sign-in flows (chain faked)
```

The Playwright tests fake the chain at the `ChainGateway` seam — they never touch
a network or spend testnet PAS. The full real round-trip
(`SignerManager` → `ensureAccountMapped` → `submitScore`) is validated inside a
Triangle host, not here.

## Deploy & register (the arcade pipeline)

The full pipeline — deploy contract, upload thumbnail, publish frontend, register
the listing, verify — is documented for agents in [`CLAUDE.md`](CLAUDE.md) §3.
The human runs one command first:

```bash
playground init   # QR scan with the Polkadot mobile app — see "What you need"
```

Then either run the steps individually or one-shot:

```bash
npm run arcade:ship
```

`arcade:ship` runs the contract deploy, thumbnail upload, listing registration,
and verify, and prints the exact `playground deploy …` command for publishing the
frontend (that one step signs with your playground session, so you run it
yourself). It stops non-zero at the first failure — no silent partial deploy.
`arcade.config.json` is the single source of truth: name, type, description,
`requiresAccount`, thumbnail path, `.dot` domain, and the contract's
score-ordering/format/unit (see [`CLAUDE.md`](CLAUDE.md) §2).

## Architecture

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│ src/games/snake/            │     │ src/scoreboard/             │
│   SnakeGame.tsx             │     │   api.ts          (interface)│
│                             │     │   reads.ts        (default)  │
│ Knows nothing about chain,  │     │   local-impl.ts   (offline)  │
│ storage, or the player.     │     │   Leaderboard.tsx (UI)       │
│ Calls onGameEnd(score) once.│     │                             │
└──────────────┬──────────────┘     │ Knows nothing about WHICH    │
               │                    │ game. Just numeric scores.  │
               │                    └──────────────┬──────────────┘
               │ onGameEnd(score)                  │ submitScore / getTopScores
               ▼                                   ▼
                  ┌─────────────────────────────────────┐
                  │ src/App.tsx                         │
                  │   The only file that knows about    │
                  │   both. Wires one specific game to  │
                  │   one specific scoreboard impl.     │
                  └─────────────────────────────────────┘

contracts/gcs-reference/lib.rs
  GCS v1 reference contract (SPEC §4.6) — keyed by caller (H160); personal
  bests, a top-100 leaderboard, a 20-slot recent ring, and activity stats.
```

The seam is `GameComponentProps` (in [`src/games/types.ts`](src/games/types.ts)) on one side and `ScoreboardAPI` (in [`src/scoreboard/api.ts`](src/scoreboard/api.ts)) on the other. Anything implementing one of those is a drop-in.

## Identity model (read this)

A player is their **host wallet account** — the Polkadot account from the host environment, exposed to the game via product-sdk's `SignerManager` (SPEC §8.1). The burner-wallet + `//Alice` faucet machinery is **removed entirely**.

The flow lives in the scoreboard layer (`src/scoreboard/`):

- **Guest mode (default) = zero chain interaction.** No account, no funding, no mapping. The game runs; a score worth keeping is held in `localStorage` so it survives the session.
- **At game over**, a guest who beat their locally-known best is prompted *"Sign in to save your score"*. Accepting runs, once: `SignerManager.connect("host")` → `ensureAccountMapped` (idempotent `pallet_revive` mapping) → `submitScore` at best-block.
- **Signed-in players** submit directly at game over (every play counts; a non-improving `submitScore` never reverts — SPEC §4.2).
- **`requiresAccount`** games (set in `arcade.config.json`) gate sign-in at launch instead of at game over.

The single chain seam is `ChainGateway` ([`src/scoreboard/gateway.ts`](src/scoreboard/gateway.ts)); the real product-sdk wiring is isolated in [`src/scoreboard/sdk-gateway.ts`](src/scoreboard/sdk-gateway.ts). Player display names are the dashboard's job (DotNS reverse resolution, SPEC §8.2); in-game the board shows truncated H160 addresses.

## Build a new game

A game is a React component that calls `onGameEnd(score)` exactly once (a non-negative integer) when the match ends, and renders only its gameplay into the shell-provided portrait surface. Drop in any single-player game that produces a number — Flappy Bird, 2048, a clicker, an aim trainer, Wordle.

**Styling is imposed.** The shell provides the responsive 2:3 portrait game surface, the mobile/desktop layout, the bottom tab bar, and the game-over save sheet. Your component fills 100% of the surface and styles only its own gameplay — don't restyle the shell, tokens, or `App.css`.

**One swap point.** Point [`src/games/active.ts`](src/games/active.ts) at your component (`ActiveGame` + `ACTIVE_GAME_TITLE`); `App.tsx` needs no edit. The template ships two reference games to copy — `snake/SnakeGame` (canvas/keyboard/higher) and `aim-trainer/AimTrainer` (DOM/tap/lower).

See [`docs/modding.md`](docs/modding.md) → "Build a new game" for the full recipe, the score-semantics table, and the shell-surface contract.

## Swap the backend

The default read backend is the on-chain GCS contract (`src/scoreboard/reads.ts`); writes go through the `ChainGateway` seam, signed by the host wallet. Two alternatives are interesting:

- **localStorage** (`src/scoreboard/local-impl.ts`) — still shipped. Useful for offline dev or tutorials where you want to demo the architecture without deploying.
- **Bulletin-augmented** — keep the contract for the index, write full match history to Bulletin Chain.

See [`docs/modding.md`](docs/modding.md) → "Swap the backend" for both.

## Layout

```
contracts/
└── gcs-reference/
    ├── Cargo.toml
    └── lib.rs                    # the PVM smart contract
src/
├── App.tsx                       # composition — wires game + scoreboard
├── App.css
├── main.tsx
├── games/
│   ├── types.ts                  # GameComponentProps — the game contract
│   ├── active.ts                 # the one swap point (re-exports ActiveGame)
│   ├── snake/
│   │   ├── SnakeGame.tsx         # reference: canvas/keyboard/higher (active)
│   │   └── snake.css
│   └── aim-trainer/
│       ├── AimTrainer.tsx        # reference: DOM/tap/lower (ms)
│       └── aim-trainer.css
└── scoreboard/
    ├── api.ts                    # ScoreboardAPI — the backend contract
    ├── gateway.ts                # ChainGateway — the one chain seam
    ├── scoreboard.ts            # guest / sign-in policy (SPEC §8)
    ├── reads.ts                  # GCS contract reads (default)
    ├── sdk-gateway.ts           # real product-sdk wiring
    ├── local-impl.ts             # localStorage fallback
    └── Leaderboard.tsx           # UI — backend-agnostic
Cargo.toml                        # Rust workspace
rust-toolchain.toml               # nightly + rust-src
cdm.json                          # chain endpoints + contract registry
```

Convention files for the playground registry: [`template.json`](template.json), [`quests.json`](quests.json), [`setup.sh`](setup.sh).

## Mod ideas

See [`quests.json`](quests.json) for the full list. Highlights:

- **Build a new game** — anything producing a single integer score plugs in via `src/games/active.ts`.
- **Bulletin replay history** — store full match history off-chain, content-addressed; contract holds the index.
- **Custom read backend** — anything implementing `ScoreboardAPI` is a drop-in for the in-game board.

## Why this shape

A common failure mode for "starter" templates is to ship a complete demo where the game logic, the chain logic, and the UI are tangled. This template makes the seams explicit:

- The game produces a number.
- The scoreboard stores numbers.
- `App.tsx` is the only file that knows about both.

Mod the game without learning Polkadot. Mod the backend without touching the game. Both at once if you want — but the surfaces are independent.
