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
  PVM smart contract — keyed by caller (H160), stores each player's personal best.
```

The seam is `GameComponentProps` (in [`src/games/types.ts`](src/games/types.ts)) on one side and `ScoreboardAPI` (in [`src/scoreboard/api.ts`](src/scoreboard/api.ts)) on the other. Anything implementing one of those is a drop-in.

## Identity model (read this)

The contract is keyed by `caller()` — the H160 the runtime maps the substrate signer to. Each browser holds its own **burner wallet** (sr25519 mnemonic in `localStorage`, see [`src/scoreboard/signer.ts`](src/scoreboard/signer.ts)). That burner is what signs `submit_score`, so each browser shows up as a distinct H160 on the leaderboard.

A fresh burner has no balance and isn't registered with `pallet_revive`, so on first submit [`src/scoreboard/bootstrap.ts`](src/scoreboard/bootstrap.ts) runs a one-time setup using a **faucet account**:

1. The faucet calls `Balances.transfer_keep_alive` to fund the burner.
2. The burner calls `Revive.map_account()` to register itself as a contract caller.
3. The burner signs `submit_score(score)`.

Three finalized extrinsics — expect ~30s on the first submit, then one tx per submit after.

The faucet defaults to `//Alice`, which works on a local revive dev node. On the public Paseo Asset Hub testnet, `//Alice` is drained — copy [`.env.example`](.env.example) to `.env.local` and set `VITE_FAUCET_SURI` to a funded account. The well-known `//Bob` dev key still works there today; for sustained use, paste your `~/.cdm/accounts.json` mnemonic (the same account `dot init` funded for you).

Trade-offs:

- **Pro:** zero player-side auth UX. No extension, no manual faucet, distinct identity per browser.
- **Con:** the faucet pays ~1 PAS per new player. Every browser session creates a new burner unless `localStorage` carries one over. Suitable for starter / demo / hackathon use; for production replace the burner with an extension signer (see [`docs/modding.md`](docs/modding.md)).

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
- **Swap the burner for an extension signer** — replace `src/scoreboard/signer.ts` with the Polkadot extension or mobile app, so players hold their own keys instead of a browser burner.
- **Bulletin replay history** — store full match history off-chain, content-addressed; contract holds the index.
- **Cross-game scoring** — a singleton Arcade contract aggregates scores across every game built from this template (in progress).

## Why this shape

A common failure mode for "starter" templates is to ship a complete demo where the game logic, the chain logic, and the UI are tangled. This template makes the seams explicit:

- The game produces a number.
- The scoreboard stores numbers.
- `App.tsx` is the only file that knows about both.

Mod the game without learning Polkadot. Mod the backend without touching the game. Both at once if you want — but the surfaces are independent.
