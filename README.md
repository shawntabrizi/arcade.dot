# Polkadot Arcade

Monorepo for the **Polkadot Arcade** — a single-player game template with an on-chain leaderboard, plus a cross-game dashboard that aggregates scores across every game built from it.

Two independent apps live side by side:

| Folder | What it is | Run it |
| --- | --- | --- |
| [`game-template/`](game-template/) | The publishable starter template — Snake + a swappable scoreboard backed by a PVM leaderboard contract on Paseo Asset Hub. `dot mod`-able and registry-publishable on its own. | `cd game-template && npm install && npm run dev` |
| [`dashboard/`](dashboard/) | Read-only dashboard for the Arcade — top players, latest scores, and active games across the whole arcade. | `cd dashboard && npm install && npm run dev` |

Each folder is self-contained with its own `package.json`, build, and docs — there is no shared workspace tooling. See each folder's `README.md` for details.

## How the two fit together

The **Arcade** is a singleton registry contract on Paseo Asset Hub (source: [`game-template/contracts/arcade/`](game-template/contracts/arcade/)).

1. A game built from `game-template/` deploys its own leaderboard contract and is **registered** with the Arcade via `arcade.registerGame(addr, name, image_uri)`.
2. When a player submits a score, the game calls `arcade.recordScore(gameAddr)`; the Arcade pulls `getBest(player)` cross-contract and accrues the delta to the player's total.
3. The **dashboard** reads only the deployed Arcade contract (via its own `dashboard/cdm.json`) to render the cross-game views.

The dashboard depends on the deployed Arcade by address/ABI only — it never touches contract source, so the two apps build and deploy independently.

## Publishing the game template

`game-template/` stays a complete, standalone Polkadot Playground starter template (`template.json`, `quests.json`, `setup.sh`, its own contracts). To publish it to the Playground registry that [playground-app](https://github.com/shawntabrizi/playground-app) browses:

```bash
cd game-template
dot deploy --playground
```

Nothing in the monorepo layout affects that flow.
