# Leaderboard Playground

A Polkadot Playground starter template. A single-player game with an **on-chain leaderboard** — designed so the **game** and the **scoreboard backend** stay independent. Swap either one without touching the other.

Ships with Flappy Bird as the game and a PVM smart contract on Paseo Asset Hub as the leaderboard backend.

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

# Build + deploy the leaderboard contract to Paseo Asset Hub.
# Writes the new address into cdm.json.
dot deploy --contracts

# Dev server
npm run dev
```

Open <http://localhost:5173>. The game starts immediately. Scores are saved to your deployed contract; the leaderboard reads them back live.

If you start `npm run dev` before deploying, the page renders with a banner explaining how to deploy. Submissions are disabled until the contract is in `cdm.json`.

## Publish to Playground

Once the game works locally, publish the contract and frontend to Polkadot Playground in one shot:

```bash
dot deploy --contracts --playground --moddable
```

Same `--contracts` flag as the dev flow plus two more:

- `--playground` — register the deploy in the Playground registry so the app shows in your "my apps" list. The publish is signed by your account so the contract records you as the owner.
- `--moddable` — record this repo's URL in the Bulletin metadata so others can clone and mod the source with `dot mod`. Reads your existing `origin` and fails fast if it's missing, private, or not GitHub.

The CLI also uploads `dist/` to Bulletin Chain and registers a `.dot` domain via DotNS. Interactive prompts cover `--signer` (`phone` to sign with your account, `dev` for shared keys), `--domain` (DotNS label), and `--buildDir` (default `dist/`).

## Architecture

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│ src/games/flappy/           │     │ src/scoreboard/             │
│   FlappyGame.tsx            │     │   api.ts          (interface)│
│                             │     │   contract-impl.ts (default) │
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

contracts/leaderboard/lib.rs
  PVM smart contract — append-only enumeration + per-name personal best.
```

The seam is `GameComponentProps` (in [`src/games/types.ts`](src/games/types.ts)) on one side and `ScoreboardAPI` (in [`src/scoreboard/api.ts`](src/scoreboard/api.ts)) on the other. Anything implementing one of those is a drop-in.

## Identity model (read this)

This template uses a **shared dev signer** (`//Alice`) for every transaction, with the **display name** as the leaderboard identity. The contract stores best score per name, not per caller:

- **Pro:** zero auth UX, runs out of the box, multiple players differentiated by name.
- **Con:** anyone can submit any name. No anti-spoofing. Fine for a starter / hackathon demo, not for production.

Replacing `//Alice` with a real signer (extension, Polkadot Mobile, session key) is a documented mod — see [`docs/modding.md`](docs/modding.md). Adding caller-based identity to the contract is a documented quest in [`quests.json`](quests.json).

## Swap the game

A game is a React component that calls `onGameEnd(score)` exactly once when the match ends. Drop in any single-player game that produces a number — 2048, Snake, a clicker, a reaction-time test.

See [`docs/modding.md`](docs/modding.md) → "Swap the game" for the recipe.

## Swap the backend

The default backend is the on-chain contract. Two alternatives are interesting:

- **localStorage** (`src/scoreboard/local-impl.ts`) — still shipped. Useful for offline dev or tutorials where you want to demo the architecture without deploying.
- **Bulletin-augmented** — keep the contract for the index, write full match history to Bulletin Chain.

See [`docs/modding.md`](docs/modding.md) → "Swap the backend" for both.

## Layout

```
contracts/
└── leaderboard/
    ├── Cargo.toml
    └── lib.rs                    # the PVM smart contract
src/
├── App.tsx                       # composition — wires game + scoreboard
├── App.css
├── main.tsx
├── games/
│   ├── types.ts                  # GameComponentProps — the game contract
│   └── flappy/
│       ├── FlappyGame.tsx        # the shipped game
│       └── flappy.css
└── scoreboard/
    ├── api.ts                    # ScoreboardAPI — the backend contract
    ├── contract-impl.ts          # on-chain implementation (default)
    ├── local-impl.ts             # localStorage fallback
    └── Leaderboard.tsx           # UI — backend-agnostic
Cargo.toml                        # Rust workspace
rust-toolchain.toml               # nightly + rust-src
cdm.json                          # chain endpoints + contract registry
```

Convention files for the playground registry: [`template.json`](template.json), [`quests.json`](quests.json), [`setup.sh`](setup.sh).

## Mod ideas

See [`quests.json`](quests.json) for the full list. Highlights:

- **Swap the game** — anything producing a numeric score plugs in.
- **Caller-based identity** — change the contract to use `caller()` (the Revive H160 of the signer) instead of a display-name string. Requires a real signer.
- **Bulletin replay history** — store full match history off-chain, content-addressed; contract holds the index.
- **Cross-game scoring** — add `game_id` to the contract; multiple games share one leaderboard.

## Why this shape

A common failure mode for "starter" templates is to ship a complete demo where the game logic, the chain logic, and the UI are tangled. This template makes the seams explicit:

- The game produces a number.
- The scoreboard stores numbers.
- `App.tsx` is the only file that knows about both.

Mod the game without learning Polkadot. Mod the backend without touching the game. Both at once if you want — but the surfaces are independent.
