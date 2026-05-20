# Arcade Dashboard

Read-only dashboard for the **Polkadot Arcade** — a singleton on-chain registry that aggregates scores across every game built from the [Leaderboard Playground](https://github.com/shawntabrizi/leaderboard-playground) template.

Three live views, all driven by the Arcade contract on Paseo Asset Hub:

- **Top players** — sum of personal bests across every registered game.
- **Latest scores** — most recent 20 submissions across the whole arcade.
- **Active games** — every game registered, sorted by last activity.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The dashboard talks to the deployed `@example/arcade-playground` contract via `@dotdm/cdm`. No signer needed — every page is a query.

## How games show up here

A game shows up on the dashboard once two things happen:

1. Its leaderboard contract is **registered** with the Arcade via `arcade.registerGame(addr, name, image_uri)`. This is a one-time call by anyone — typically done after `dot deploy --contracts` of a new game.
2. After a player submits a score, the game's frontend calls **`arcade.recordScore(gameAddr)`**. The Arcade then pulls `getBest(player)` cross-contract from the game and accrues the delta to the player's total.

The Leaderboard Playground starter template wires this in by default — see `src/scoreboard/contract-impl.ts` over there.

## Layout

```
src/
├── App.tsx       composition + the three sections
├── App.css       styling
├── arcade.ts     read-only Arcade client (CDM + name cache)
└── main.tsx      entry point
cdm.json          Arcade contract address + ABI (auto-populated by `cdm install`)
```

The leaderboard ABI is intentionally not bundled here — the Arcade is the only contract the dashboard reads from. Per-game drill-down (querying a registered game's full top-N) is a planned addition; it'll fetch the game ABI from the per-game registration metadata at runtime.

## Publish to Playground

```bash
dot deploy --playground
```
