# CLAUDE.md — agent instructions for the Polkadot Arcade game template

You are an AI agent using this template to build and ship **any** single-player
game to the Polkadot Arcade. The canonical prompt is:

> *"Build &lt;X&gt; as a new game in this template and deploy it to the arcade."*

You are **not** editing Snake. Snake is one of two reference games; you write a
**new** game component and point the template at it. Chain, identity, signing,
and styling are **imposed by the template** — you write only the gameplay
component and `arcade.config.json`.

This file tells you exactly how to succeed unaided. `AGENTS.md` points here —
this is the single source of agent guidance. Read it top to bottom before you
start; the steps and the failure modes are not optional.

---

## 0. The shape of the job

You do three things, in this order:

1. **Build the game** as a new React component behind one seam, then point the
   active-game re-export at it (§1).
2. **Fill `arcade.config.json`** — the single source of truth for everything
   the arcade displays and the contract is constructed with (§2), using the
   score-semantics decision table (§2.1).
3. **Run the deploy pipeline** in exact order (§3), handling the failure modes
   (§4) honestly.

You do **not** touch the scoreboard/identity layer, the shell/styling, or the
pipeline library (§6). The whole design exists so a new game is one component
plus one config file.

---

## 1. The one seam: the game component

A game is a React component implementing `GameComponentProps`
(`src/games/types.ts`):

```ts
export interface GameComponentProps {
  onGameEnd: (score: number) => void;
}
```

Rules — all load-bearing:

1. The component **renders only gameplay** into the shell-provided surface. Its
   root element fills its parent (`width: 100%; height: 100%`); the shell owns
   the responsive 2:3 portrait frame, the radius, the shadow, and the
   mobile/desktop layout (see §2.2). The component runs its own logic and knows
   **nothing** about chains, accounts, storage, or the player.
2. It calls **`onGameEnd(score)` exactly once per match.** `score` is a
   **non-negative integer** (`u128` on-chain — `Math.round` / `Math.max(0, …)`
   before calling). One call drives at most one on-chain `submitScore`; a second
   call is a second submission (a real transaction). Gate the callback behind a
   "has-ended" flag — see `SnakeGame.tsx`'s `s.ended` guard or `AimTrainer.tsx`'s
   `endedRef` for the pattern.
3. It **MUST NOT** import from `src/scoreboard/`, from `App`, or from any shell
   file. Score persistence, identity, and layout are someone else's problem.
4. **Guest-first, zero chain during play.** The component never connects a
   wallet, reads, or writes the chain. A guest plays freely; the template
   handles the sign-in nudge at game over. Don't add login or storage.
5. **No external network dependencies — bundle EVERYTHING.** The app must make
   zero requests to external domains. Do NOT hotlink fonts (Google Fonts/CDNs),
   scripts, images, or any asset from an external URL — inside the Polkadot
   host that triggers an "Allow access to web domains?" prompt and breaks the
   self-contained guarantee (and offline play). Bundle assets by `import`ing
   them so Vite emits them locally; use packaged fonts (Inter is already
   bundled via `@fontsource/inter` in `src/main.tsx`) and npm libraries, never a
   `<link>`/`<script>`/`url(https://…)` to a remote host. If your game needs a
   font/image/sound, add it to the repo and import it.

To wire your game in:

- Put it under `src/games/<your-game>/<YourGame>.tsx` (+ a CSS file for your
  gameplay if you need one).
- Point the **one swap point** at it: edit `src/games/active.ts` to re-export
  your component as `ActiveGame` and set `ACTIVE_GAME_TITLE`:

  ```ts
  export { YourGame as ActiveGame } from "./your-game/YourGame";
  export const ACTIVE_GAME_TITLE = "Your Game";
  ```

  `App.tsx` imports `ActiveGame` from there and renders it inside the
  `.game-surface` wrapper. **You do not edit `App.tsx`** for a game swap — that
  is the entire point of `active.ts`. Do not rewire the scoreboard plumbing.

### The two reference games — copy the one whose shape matches

- **`src/games/snake/SnakeGame.tsx`** — **keyboard + swipe**, **canvas**
  rendering, **higher-is-better** score (points). A single `onGameEnd(s.score)`
  inside a `die()` guarded by `s.ended`.
- **`src/games/aim-trainer/AimTrainer.tsx`** — **tap (DOM/pointer)** input,
  **DOM** rendering, **lower-is-better** score = reaction time in
  **milliseconds** (duration). `onGameEnd(avgMs)` once, guarded by `endedRef`.
  Use this as the model for any pointer/DOM or lower-is-better game.

`docs/modding.md` → "Build a new game" has a fuller recipe and the common
pitfalls. Follow it; don't reinvent it.

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

### 2.1 Score-semantics decision table

`scoreOrdering` and `scoreFormat` are **immutable for the contract's life**, so
pick them from the game's genre before you deploy. Match your game to the
closest row:

| Genre | `scoreOrdering` | `scoreFormat` | `scoreUnit` | Why |
|---|---|---|---|---|
| Flappy Bird (points) | `0` | `0` | `""` | more points = better |
| 2048 (points) | `0` | `0` | `""` | higher tile sum = better |
| Clicker (count) | `0` | `0` | `""` | more clicks = better |
| Solitaire by moves | `1` | `2` | `"moves"` | fewer moves = better; custom unit |
| Aim trainer (reaction) | `1` | `1` | `""` | lower ms = better; duration render |
| Wordle by guesses | `1` | `2` | `"guesses"` | fewer guesses = better; custom unit |

Rules of thumb: **higher-is-better → `scoreOrdering: 0`; faster/fewer → `1`.**
Use `scoreFormat: 1` only when the submitted number is **milliseconds** (it
renders `m:ss.mmm`). Use `scoreFormat: 2` + a `scoreUnit` for any other
non-points unit (moves, guesses, laps); use `0` for plain points and leave
`scoreUnit` empty. The in-game leaderboard already sorts by `scoreOrdering`
(higher genres descending, lower genres ascending) — you don't sort anything.

### 2.2 Styling is imposed — don't restyle the shell

The look is **structural**, not yours to change. The template provides the
**2:3 portrait game surface**, the **mobile/desktop layout**, the **bottom tab
bar** (Play · Scores · Recent · Account), the **game-over Last/Best + submit
affordance**, and the **Account tab** (product-account derivation, address,
balance, mapping status, and faucet). Your game component fills 100% of the
surface and styles **only its own gameplay inside it**.

- **Do not** edit `src/App.css`, `src/tokens.css`, `tailwind.config.js`, the
  shell in `src/App.tsx`, the tab bar, or the save sheet.
- **Do not** re-create the portrait frame, radius, shadow, or any
  viewport/`dvh` sizing in your game CSS — the shell's `.game-surface` owns it.
  Your root just fills its parent.
- Swap the game **only** via `src/games/active.ts` (§1). Any game dropped into
  the surface inherits the frame and the mobile/desktop layout and cannot fight
  it — Snake (canvas) and AimTrainer (DOM/tap) both prove this with no per-game
  layout code.

### 2.3 Supported game shapes

This template ships **one** number per match to a single-player leaderboard.
Supported: a self-contained session that **ends with one integer score**
(points, a count, a duration in ms, a move/guess count). Snake and AimTrainer
bracket the range (canvas/keyboard/higher ↔ DOM/tap/lower).

**Not supported** (don't attempt within this template): multiplayer / realtime
versus, persistent cross-session state or save games, multi-statistic scoring
(more than one number per match), or anything that needs chain state during
play. Those need contract/SPEC changes outside the game seam.

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

### 4.0 Game-component failure modes (check these first)

- **Game won't render / blank surface.** The component's root must fill its
  parent (`width: 100%; height: 100%`) — the shell sizes `.game-surface`, not
  the game. Don't set a fixed pixel size or your own `dvh`/`aspect-ratio`; that
  fights the shell. Verify the boot test (`npm run test:boot`) still renders
  `#root` non-empty.
- **`onGameEnd` never fires** → the game is unbeatable / the leaderboard never
  updates. Make sure every terminal path (death, win, time-up, last target)
  calls `onGameEnd` once. Don't fire it from `useEffect` cleanup (cleanups run
  on unmount and prop changes — a double-fire).
- **`onGameEnd` fires more than once** → duplicate `submitScore` transactions.
  Guard with a "has-ended" flag (`s.ended` / `endedRef`) checked at the top of
  your end function.
- **Non-integer or negative score** → the on-chain `u128` write is malformed.
  `Math.round` and `Math.max(0, …)` before calling `onGameEnd`. A timer game
  submits **whole milliseconds**.
- **Game renders outside the surface** (overlapping the header/tabs, ignoring
  the frame). You styled layout instead of gameplay — remove any frame/size CSS
  and let your root fill `.game-surface` (§2.2).
- **Wrong leaderboard order in-game** → `scoreOrdering` in `arcade.config.json`
  doesn't match the genre (§2.1). The board sorts by it; fix the config, don't
  sort in the game.

### 4.1 Pipeline / deploy failure modes

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
  `identifier.ts`, `Leaderboard.tsx`. This implements SPEC §8 identity once for
  every template game — guest mode, the game-over "sign in to save your score"
  nudge, account mapping, `submitScore`. Do not reintroduce burner keys, a
  faucet, `//Alice`-as-a-player-signer, or any display-name identity (all
  removed per SPEC §8; names come from the dashboard's DotNS resolution, §8.2).
- **The shell & styling** — `src/App.tsx` (the composition root: panels, tab
  bar, save sheet, `.game-surface` wrapper), `src/App.css`, `src/tokens.css`,
  and `tailwind.config.js`. These impose the mobile/desktop layout and the
  portrait game surface for every game (§2.2). You change the **active game**
  through `src/games/active.ts` only; you do not edit `App.tsx` for a swap, and
  you never restyle the shell or the tokens.
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
