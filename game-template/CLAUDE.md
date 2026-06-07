# CLAUDE.md — agent instructions for the Polkadot Arcade game template

You are an AI agent editing this template to build and ship one game to the
Polkadot Arcade. The canonical prompt is:

> *"Edit the game template for the &lt;X&gt; game and deploy it to the arcade."*

This file tells you exactly how to succeed unaided. `AGENTS.md` points here —
this is the single source of agent guidance. Read it top to bottom before you
start; the steps and the failure modes are not optional.

---

## 0. The shape of the job

You do three things, in this order:

1. **Write the game** as a React component behind one seam (§1).
2. **Fill `arcade.config.json`** — the single source of truth for everything
   the arcade displays and the contract is constructed with (§2).
3. **Run the deploy pipeline** in exact order (§3), handling the failure modes
   (§4) honestly.

You do **not** touch the scoreboard/identity layer or the pipeline library
(§6). The whole design exists so a new game is one component plus one config
file.

---

## 1. The one seam: the game component

A game is a React component implementing `GameComponentProps`
(`src/games/types.ts`):

```ts
export interface GameComponentProps {
  onGameEnd: (score: number) => void;
}
```

Rules — all three are load-bearing:

1. The component renders its own UI (canvas, DOM, anything) and runs its own
   logic. It knows **nothing** about chains, accounts, storage, or the player.
2. It calls **`onGameEnd(score)` exactly once per match.** `score` is a
   non-negative integer (`u128` on-chain — round before calling). One call
   drives at most one on-chain `submitScore`; a second call is a second
   submission (a real transaction). Gate the callback behind a "has-ended"
   flag — see `SnakeGame.tsx`'s `s.ended` guard for the pattern.
3. It MUST NOT import from `src/scoreboard/`. Score persistence is someone
   else's problem.

To swap in your game:

- Put it under `src/games/<your-game>/<YourGame>.tsx`.
- In `src/App.tsx` change the one import and the one JSX usage of `SnakeGame`.
  That is the **only** edit `App.tsx` needs for a game swap. Do not rewire the
  scoreboard plumbing around it.

The shipped `SnakeGame` is the reference: canvas + keyboard, a single
`onGameEnd(s.score)` call inside a `die()` guarded by `s.ended`.

`docs/modding.md` → "Swap the game" has a fuller recipe and the common
pitfalls (double `onGameEnd`, firing from `useEffect` cleanup, fractional
scores). Follow it; don't reinvent it.

---

## 2. `arcade.config.json` — the single source of truth

Every value the arcade shows, and every contract-constructor argument, comes
from this file (SPEC §6.5). **No value is ever typed twice; you never touch a
CID or a contract address by hand.** Fill it completely before deploying.

```json
{
  "name": "Snake",
  "gameType": "arcade",
  "shortDescription": "Classic Snake. Eat, grow, don't bite your tail. …",
  "requiresAccount": false,
  "thumbnail": "assets/thumbnail.png",
  "domain": "arcade-snake",
  "contract": { "scoreOrdering": 0, "scoreFormat": 0, "scoreUnit": "" }
}
```

| Field | Meaning & constraints |
|---|---|
| `name` | Display name. **≤ 64 bytes** (SPEC §5.1). |
| `gameType` | One free-string tag. **≤ 32 bytes.** Recommended vocabulary: `arcade`, `puzzle`, `racing`, `strategy`, `shooter`, `card`, `idle`, `other` (SPEC §5.4). Unknown tags are allowed but the dashboard buckets them under "other" — the pipeline warns. |
| `shortDescription` | One-line pitch. **≤ 256 bytes.** |
| `requiresAccount` | `true` only for games that **cannot** be played as a guest (multiplayer, on-chain state machines). When `true`, the template gates sign-in **at launch**, before play; when `false` (the default), guests play freely and are nudged to sign in only at game over (SPEC §8.3). This same flag is written to the on-chain listing, so the in-game gate and the dashboard badge always agree. Most template games are `false`. |
| `thumbnail` | Path to a 16:9 image (recommended 640×360, WebP/PNG/JPEG, **≤ 256 KiB**, SPEC §6.4). If absent, generate one (`npm run arcade:gen-thumbnail` or your own art). The pipeline uploads it to Bulletin and records the CID for you. |
| `domain` | The `.dot` label used to publish the frontend (step 6). Lowercase letters/digits/hyphens, no leading/trailing hyphen. `playUrl` is derived as `https://<domain>.dot.li`. **Pick a domain not already taken** (see §4). |
| `contract.scoreOrdering` | **Immutable for the contract's life.** `0` = higher is better, `1` = lower is better. This decides leaderboard sort AND what counts as a personal best — pick correctly for the game (Snake: `0`; a speedrun timer: `1`). For `1`, "no score yet" reads as `u128::MAX` so it never ranks; `submitScore(u128::MAX)` is treated as non-improving. |
| `contract.scoreFormat` | How the dashboard renders a score. `0` = points (integer). `1` = duration in **milliseconds**, rendered `m:ss.mmm` (use this for timers; the score the game submits must be ms). `2` = custom unit (then set `scoreUnit`). |
| `contract.scoreUnit` | Label shown when `scoreFormat == 2` (e.g. `"laps"`). Empty string otherwise. (SPEC §4.2.) |

`scoreOrdering`/`scoreFormat`/`scoreUnit` are passed to the GCS contract's
constructor at deploy time and are then fixed forever — get them right before
step 4. `requiresAccount` must also match how your game actually behaves.

---

## 3. The deploy pipeline — exact order, real commands

Run from the template root. **Either** run each step explicitly:

```bash
npm run arcade:deploy-contract        # step 4: build + deploy the GCS contract → cdm.json
npm run arcade:upload-thumbnail       # step 5: upload thumbnail to Bulletin → CID
npm run build                         # step 6a: build the frontend
playground deploy --signer phone --domain <domain> --buildDir dist --playground
                                      # step 6b: publish frontend → Bulletin + .dot name
npm run arcade:register               # step 7: call updateListing (name/type/desc/playUrl/CID)
npm run arcade:verify                 # step 8: read listing + arcadeVersion() back; print dashboard URL
```

**Or** run the whole thing with one command:

```bash
npm run arcade:ship
```

`arcade:ship` runs steps 4, 5, 7, 8 in order and **prints the exact step-6
`playground deploy` command** for you to run yourself (it cannot — see below).
It stops and exits non-zero at the first failure: no silent partial ship.

Notes on individual steps:

- **Step 4 (`arcade:deploy-contract`)** builds the GCS reference contract
  (`contracts/leaderboard/lib.rs`) and deploys it with the
  `scoreOrdering`/`scoreFormat`/`scoreUnit` from config and the registry
  address from `cdm.json` as constructor args, then records the deployed
  address + ABI in `cdm.json`. This replaces `playground contract deploy`,
  which has no constructor-argument support. Signer: the `ARCADE_SURI` env var,
  **default `//Alice`** on the testnet. **The account that deploys here must be
  the same account that signs step 7** — it becomes the contract `owner`, and
  `updateListing` is gated on `caller() == owner` (SPEC §4.4). If you set
  `ARCADE_SURI` for step 4, use the same value for step 7.
- **Step 5 (`arcade:upload-thumbnail`)** uploads `config.thumbnail` to the
  Bulletin Chain and records the CID. No CID is ever hand-entered.
- **Step 6 (`playground deploy`)** is the **one step you run yourself**, not
  via npm: it signs with the developer's **playground session** (the
  QR-logged phone, or `--signer dev` for a dev key) which the non-interactive
  scripts must not impersonate. `--domain` MUST equal `config.domain` or the
  registered `playUrl` (`https://<domain>.dot.li`) will 404. Build first
  (`npm run build`) so `dist/` exists.
- **Step 7 (`arcade:register`)** reads `arcade.config.json` + `cdm.json` and
  calls the deployed contract's `updateListing`, which makes the cross-contract
  `registry.register(meta)` call (SPEC §4.4 / §5.2). `playUrl` is derived from
  `domain`; `thumbnailCid` from step 5.
- **Step 8 (`arcade:verify`)** reads the registry listing and the contract's
  `arcadeVersion()` back and prints the dashboard URL. If verify fails, the
  game is not correctly listed — fix and re-run; do not report success.

---

## 4. Common failure modes — and the fix (do NOT work around)

- **No playground session / not logged in.** Step 6 (and any signing the CLI
  does) fails for lack of a session. **Tell the user to run `playground init`**
  (QR scan with the Polkadot mobile app — SPEC §10.2). This is the one human
  step; it installs the toolchain, logs in, funds + maps the account, and
  grants Bulletin allowances. **Never try to work around a missing session**
  (no burner keys, no faucet, no `//Alice`-as-the-user). Just surface it.
- **Domain already taken** (step 6 `playground deploy` rejects `--domain`, or
  the `.dot` name is owned by someone else). **Change `config.domain`** to a
  free label and re-run from step 6 (and step 7, since `playUrl` changed).
- **Oversize metadata** (the register/verify step reverts on a length cap). The
  on-chain byte caps (SPEC §5.1): `name` ≤ 64, `gameType` ≤ 32,
  `shortDescription` ≤ 256, `thumbnailCid`/`extraCid` ≤ 128, `playUrl` ≤ 256.
  The config validator catches `name`/`gameType`/`shortDescription` before any
  chain work — shorten the offending field and re-run.
- **Thumbnail too big** (> 256 KiB) — regenerate smaller (16:9, ~640×360).
- **`owner` mismatch on `updateListing`** (step 7 reverts). The step-7 signer
  is not the step-4 deployer. Re-run with the **same** `ARCADE_SURI` you used
  for step 4 (or redeploy with the intended account).
- **`npm install` refuses a fresh version.** The user's global npm has
  `min-release-age=3` (won't install versions published in the last 3 days —
  a supply-chain guard). For the first-party `@parity/*` SDK we track latest, a
  scoped `game-template/.npmrc` sets `min-release-age=0` to override it for this
  package only (the machine-wide setting is untouched). Keep `@parity/*` on
  **latest** (`product-sdk-signer`/`-tx`/`-host`) — we ship against the SDK the
  dot.li host runs. Don't add the override for third-party packages.
- **Contract not deployed at runtime** (dev server shows a "Game contract not
  deployed" banner). Run step 4 to populate `cdm.json`, then restart the dev
  server.

Every script exits **non-zero with an actionable message** on failure (SPEC
§10.4). If a step fails, read the message, fix the cause, re-run — never report
a deploy as done when a step was skipped or errored.

---

## 5. The interface contracts in brief (SPEC §4 / §5)

You don't implement these — the shipped GCS reference contract and the registry
do — but knowing them explains the config fields and the verify step.

**GCS v1 (the game contract — SPEC §4), what the dashboard reads generically:**

- Module A (activity): `arcadeVersion()` (must be `1` — the conformance gate),
  `playCount()`, `uniquePlayers()`, `lastPlayedAt()`.
- Module B (leaderboard): `scoreOrdering()`, `scoreFormat()`, `scoreUnit()`,
  `getBest(player)`, `getLeaderboard(offset, limit)`, `getRecent(offset, limit)`,
  and the one write `submitScore(score)` — increments play count, updates
  last-played + the 20-slot recent ring on every call, and updates the
  top-100 leaderboard only when the score is a personal best. **A non-improving
  score never reverts; every play counts.**
- `updateListing(meta)` forwards `meta` to `registry.register` (SPEC §4.4),
  gated `caller() == owner`.

**Registry (the directory — SPEC §5):** keyed by `caller()` — a listing belongs
to whoever (which contract) registered it; there is no other auth. The
`ListingMetadata` fields are exactly what `arcade.config.json` feeds, plus the
derived `playUrl` and `thumbnailCid`. The dashboard trusts a listing only after
the game contract answers `arcadeVersion()` correctly (SPEC §7.4) — that gate,
not the registry, filters junk.

---

## 6. What NOT to touch

- **The scoreboard / identity layer** (`src/scoreboard/`): `gateway.ts` (the
  `ChainGateway` seam), `scoreboard.ts` (the guest/sign-in policy), `gcs.ts`,
  `reads.ts`, `sdk-gateway.ts` (the real product-sdk wiring), `api.ts`,
  `Leaderboard.tsx`. This implements SPEC §8 identity once for every template
  game — guest mode, the game-over "sign in to save your score" nudge, account
  mapping, `submitScore`. Do not reintroduce burner keys, a faucet,
  `//Alice`-as-a-player-signer, or any display-name identity (all removed per
  SPEC §8; names come from the dashboard's DotNS resolution, §8.2).
- **The pipeline library** (`scripts/` and `scripts/lib/`). The config
  validator, listing assembly, chain helpers, and step runners are correct and
  tested — edit `arcade.config.json`, not the scripts.
- **`contracts/leaderboard/lib.rs`** — the canonical GCS v1 reference contract
  (SPEC §4.6). Deploy it unmodified; its ABI is identical for every conforming
  game, which is the point of the standard.
- The single chain seam is `ChainGateway` (`gateway.ts`). Reads/writes resolve
  at **best-block** for latency. Don't read at finalized while writing at
  best-block.

---

## 7. Playground registry convention files

- `template.json` — registry metadata (`kind: "starter-template"`).
- `quests.json` — mod ideas surfaced on the App Detail Page.
- `setup.sh` — runs after `dot mod` clones the repo.

These follow the playground tutorial-app pattern; leave them unless the user
asks otherwise.

---

## 8. Definition of done

The game is shipped when `npm run arcade:verify` (step 8) reads the listing
back from the registry and confirms `arcadeVersion() == 1`, AND you have run
the step-6 `playground deploy` so `https://<domain>.dot.li` actually serves the
game. Report the dashboard URL the verify step prints. If any step was skipped
or failed, say so — do not claim a deploy that did not happen.
