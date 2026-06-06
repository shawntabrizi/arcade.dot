# Polkadot Arcade — Specification

> Status: v1 — authoritative specification for implementation by an AI agent.
> Where this spec and the existing prototype code disagree, the spec wins (§2.1).

## 1. Overview & Goals

The Polkadot Arcade is a permissionless, Steam-like game library for the
Polkadot ecosystem: a discovery dashboard where any developer can list a
dashboard-compatible game and have its activity tracked on-chain, and where
players can find, launch, and play games from within the Polkadot host
environment.

### 1.1 Purpose: a catalyst for activity

The Arcade exists to generate activity on both sides of the ecosystem:

- **Player activity** — fun games that are trivially easy to access: open
  the dashboard, see what's popular, tap Play. No installs, no manual
  wallet setup, no friction between curiosity and playing.
- **Developer activity** — games that are trivially easy to build and
  launch. Using the game template, creating a game can be as simple as
  prompting an AI agent to build a JS game and hook it to the template's
  simple contract API (`onGameEnd(score)` — one callback). Deploy, register,
  and the game is discoverable by the whole community.

These two feed each other: easy building fills the library; a full library
attracts players; visible player activity (play counts, leaderboards,
recent-plays feeds — all on-chain) tells developers their game is being
played and signals to everyone where the fun is. The dashboard's job is to
make that loop visible and self-reinforcing.

### 1.2 The development spectrum

The template is the floor, not the ceiling:

- **Template games** — pure JS/canvas games dropped into the game template;
  the contract, identity, and registration plumbing come for free. The
  AI-agent-promptable path.
- **Fully custom dApp games** — custom smart contracts, custom frontends,
  on-chain state machines, multiplayer logic. Anything that implements the
  Game Contract Standard (§4) and registers (§5) gets the same listing,
  stats, and discovery as a template game.

The standards are deliberately small so that the simplest game and the most
ambitious one meet the dashboard through the same interface.

### 1.3 Near-term goal: the conference showcase

A working demo at a conference in ~10 days (§2) showing what the Polkadot
stack makes possible: games built in minutes, listed permissionlessly,
played instantly inside the Polkadot host, with live on-chain activity on
the dashboard. The demo is the pitch — "this was built on the stack you're
looking at, and you could add a game to it today."

### 1.4 Long-term vision: bootstrapping gaming on Polkadot

The Arcade seeds the long-term story for how gaming is done on Polkadot.
The Game Contract Standard and Registry are the durable artifacts: open
standards that let anyone build a game and have it discovered by the larger
community, independent of this particular dashboard. Possible futures —
developer support programs, pipelines for creators to get paid by players —
are explicitly far out and not designed for here. What matters now:

1. people can **build** things easily,
2. people can **access** them easily,
3. activity flows through and is **visible**,
4. the loop generates **feedback and excitement**.

### 1.5 Non-goals (v1)

- Player profiles, social features, friends, reviews — identity and social
  belong to other parts of the Polkadot stack (DotNS, host environment).
- Cross-game scoring or rankings — scores are only meaningful per game.
- Monetization, payments, developer payouts.
- Curation, moderation, or verification tiers — the registry is a neutral,
  permissionless directory.
- Backend services — no indexer, no API server, no database. The dashboard
  is a static dApp reading contracts directly.

## 2. Conference MVP (10-Day Cut)

> Deadline: conference on ~2026-06-16. This section defines the minimum
> feature set to demo, drawn from the full spec below. Requirements
> throughout this document are tagged **[MVP]** (must ship for the
> conference) or **[Post-MVP]** (full vision, build later). An
> implementing agent should build all [MVP] requirements first.

### 2.1 What ships

| Deliverable | Spec |
|---|---|
| Arcade Registry contract, deployed to Paseo Asset Hub | §5 |
| Game Contract Standard (GCS) v1 reference contract (rewrite, not extension, of the prototype leaderboard) | §4 |
| Game template reworked: host-wallet identity, guest mode + save-score prompt, pipeline scripts, agent instructions | §8, §10 |
| Dashboard: discovery home, game detail pages, live activity, DotNS names | §7 |
| 2–3 real games deployed and registered (at least one built via the single-prompt flow, as the dress rehearsal) | §10.1 |

Existing prototype code may be reused where it happens to match this spec,
but the spec is authoritative — nothing is kept for being already written.

### 2.2 Build order (10 days)

1. **Days 1–2 — contracts.** Registry + reference GCS contract; deploy to
   Paseo. Everything else depends on their ABIs. In parallel, **validate
   the two integration risks** (§2.3).
2. **Days 3–5 — template rework.** product-sdk signer integration, guest
   mode, `arcade.config.json`, the template-provided pipeline scripts
   (§10.3), agent instructions. Exit: the single-prompt flow produces a
   listed game.
3. **Days 4–7 — dashboard** (overlapping). Home, detail page, name
   resolution, live updates.
4. **Days 8–9 — content + dress rehearsal.** Build 2–3 games via the
   prompt flow; fix what the rehearsal breaks.
5. **Day 10 — buffer.** It will be needed.

### 2.3 Integration risks — validate in week 1

1. **In-host dApp→dApp navigation** (§7.5): does navigating to a `.dot`
   URL from an embedded dApp open the target app in-host? Fallback: new
   tab via the `dot.li` gateway.
2. **Host-wallet signing from a game** (§8.1): full
   `SignerManager` → `ensureAccountMapped` → `submitScore` round-trip
   inside a real Triangle host on paseo-next-v2.

### 2.4 Explicitly cut from the conference build

Everything tagged [Post-MVP], and in particular: search, trending windows,
`extraCid` rendering, GCS v2 modularity (the seam is reserved, §4.5),
developer mode / test accounts, and any moderation or curation. If time
runs short, the live-activity rail (§7.1, item 5) degrades before anything
else does — cards and detail pages are the demo's spine.

## 3. System Architecture

Three components we build, three ecosystem services we consume. ("Triangle
host" below = the Polkadot host environment apps — mobile, desktop, web —
that embed dApps and provide wallet, signing, and navigation; dApps talk to
it via product-sdk.)

```
                        ┌──────────────────────────────┐
                        │   Triangle host (mobile/web)  │
                        │  wallet · signing · dApp nav  │
                        └───────┬──────────────┬───────┘
                                │ embeds       │ embeds
                  ┌─────────────▼───┐      ┌───▼─────────────┐
                  │    Dashboard    │      │   Game dApps    │
                  │  (read-only,    │      │ (template-based │
                  │   no account)   │      │   or custom)    │
                  └──┬────┬────┬───┘      └───┬─────────┬───┘
              reads  │    │    │       writes │         │ registers via
         ┌───────────▼┐   │   ┌▼─────────────▼┐        │ updateListing
         │   DotNS    │   │   │ Game contracts │◄───────┘
         │ (reverse   │   │   │   (GCS, §4)    │
         │  names)    │   │   └───────┬────────┘
         └────────────┘   │           │ register(meta) [caller = game]
                          │   ┌───────▼────────┐
                          │   │ Arcade Registry │
                          │   │   (§5)          │
                          │   └────────────────┘
                          │ fetches images by CID
                   ┌──────▼─────────┐
                   │ Bulletin/IPFS  │
                   └────────────────┘
```

All contracts live on Paseo Asset Hub (paseo-next-v2, §10.5).

**We build:** the Arcade Registry (§5), the GCS reference contract (§4.6)
inside the game template (§10), and the Dashboard (§7).

**We consume:** Triangle hosts + product-sdk (identity, signing, chain
routing — §8), DotNS (player names §8.2, game frontends' `.dot` addresses
§6.2), Bulletin Chain (image and frontend storage, §6.4).

### 3.1 The three data flows

1. **Launch (developer → chain):** agent edits template → playground CLI
   deploys game contract → frontend to Bulletin + `.dot` name → game
   contract calls `registry.register(meta)`. One prompt end-to-end (§10).
2. **Play (player → chain):** player opens game from dashboard (in-host
   navigation) → plays as guest or signed-in → on game over,
   `submitScore` from the host wallet account → contract updates stats,
   leaderboard, recent ring; emits `ScoreSubmitted`.
3. **Discover (chain → player):** dashboard paginates the registry once,
   gates each game on `arcadeVersion()`, reads Module A stats for cards
   and Module B boards for detail pages at best block, resolves names via
   DotNS, fetches thumbnails by CID. No backend anywhere in the loop.

### 3.2 Trust boundaries

- The **registry** trusts only `caller()` — listings are self-sovereign
  (§5.2).
- The **dashboard** trusts no listing until the game contract itself
  answers `arcadeVersion()` correctly (§7.4) — conformance is proven by
  the contract, not asserted by metadata.
- **Scores** are trusted as paid-for claims, not verified truths (§4.7,
  §9).

## 4. Game Contract Standard

The Game Contract Standard (GCS) is the interface a smart contract MUST
implement to be arcade-compatible — analogous to an ERC. A game contract is
the **sole source of truth for its game's stats**. The dashboard reads any
conforming contract generically, with no game-specific code.

Contracts are written in ink! on PolkaVM (`pvm_contract`) and expose a
Solidity-compatible ABI via `pallet_revive`. Players are identified by H160
addresses. All timestamps are **Unix seconds** as read from the chain
(verified on paseo-next-v2; an earlier draft said milliseconds —
the chain reports seconds). Score *durations* (§4.2 `scoreFormat == 1`)
remain milliseconds; they are game-measured, not chain-derived.
Scores are `u128`.

The standard is organized as two modules. **In version 1 both are
required.** The split exists so that a future version can make the
Leaderboard module opt-in for games without meaningful scores (§4.5), and
so implementations keep the two concerns separable from day one.

### 4.1 Module A: Activity [MVP]

Universal discovery and health stats — what makes a game visible, sortable,
and rankable on the dashboard. Every conforming contract, in every future
version, implements this module.

| Message | Returns | Semantics |
|---|---|---|
| `arcadeVersion()` | `u32` | Standard version implemented. This document defines version `1`. The dashboard MUST check this first and skip contracts returning any version it does not support (for this document: any value other than `1`), or whose call fails. |
| `playCount()` | `u64` | Total number of plays ever recorded. Monotonic. |
| `uniquePlayers()` | `u32` | Number of distinct players that have ever played. |
| `lastPlayedAt()` | `u64` | Timestamp of the most recent play; `0` if never played. |

Module A also includes listing management (§4.4).

In version 1, Module A's counters are updated by Module B's `submitScore` —
there is no standalone activity write. A score-less `recordPlay()` is
[Post-MVP] (arrives in version 2 alongside optional Module B).

### 4.2 Module B: Leaderboard [MVP]

Score semantics, the leaderboard, and the recent-plays ring.

**Reads:**

| Message | Returns | Semantics |
|---|---|---|
| `scoreOrdering()` | `u8` | `0` = higher is better, `1` = lower is better. Constant for the contract's lifetime. |
| `scoreFormat()` | `u8` | `0` = points (render as integer), `1` = duration in milliseconds (render as `m:ss.mmm`), `2` = custom unit. |
| `scoreUnit()` | `String` | Unit label when `scoreFormat() == 2` (e.g. `"laps"`); empty string otherwise. |
| `getBest(player: H160)` | `u128` | The player's personal best; `0` (or max for lower-is-better — see semantics below) if none. |
| `leaderboardSize()` | `u32` | Number of entries currently on the leaderboard (≤ cap). |
| `getLeaderboard(offset: u32, limit: u32)` | `Vec<Entry>` | Sorted best-first. `Entry = { player: H160, score: u128, at: u64 }`. Pagination per 4.3. |
| `getRecent(offset: u32, limit: u32)` | `Vec<Entry>` | Most recent submissions, newest-first, from a bounded ring. Includes non-best submissions. |

**Write:**

| Message | Semantics |
|---|---|
| `submitScore(score: u128)` | Records a play by `caller()`. Always: increments `playCount`, updates `lastPlayedAt`, appends to the recent ring. If `score` beats the caller's personal best (per `scoreOrdering`): updates `getBest`, inserts/updates the caller's leaderboard entry. MUST NOT revert on a non-improving score — every play counts. |

`submitScore` is the **only** standardized write in version 1.

**Event:**

```
ScoreSubmitted(player: H160, score: u128, isPersonalBest: bool)
```

Emitted on every successful `submitScore`. This is the standard realtime
signal: the dashboard MAY subscribe to it instead of (or in addition to)
polling reads. No other events are standardized in version 1.

**Leaderboard semantics:**

- **One board per contract.** Multiple boards (difficulties, seasons) are
  [Post-MVP] via a future standard version.
- **Bounded sorted top-N.** The contract maintains the leaderboard sorted
  on-chain, capped at **100 entries**. Insertion cost falls on the
  score-submitting write — paid by the player — so reads stay O(limit)
  regardless of player count. This is deliberate: the dashboard has no
  indexer, so reads must never require enumerating all players.
- **One entry per player** (their personal best). A new personal best
  updates the player's entry (score and `at` — the timestamp the best was
  achieved) and re-sorts.
- **Tie-breaking:** equal scores are ordered by `at` ascending (earlier
  achievement ranks higher); equal `at` by insertion order.
- **Eviction:** when full, a qualifying new entry evicts the worst entry.
  Evicted players' `getBest` is still tracked (the best-score map is
  unbounded; only the *sorted board* is capped).
- **Lower-is-better sentinel:** for `scoreOrdering() == 1`, `getBest` returns
  `u128::MAX` for players with no submission, so "no score" never ranks.
  Consequently `u128::MAX` is not a valid score: `submitScore(u128::MAX)`
  MUST be treated as non-improving (still counts as a play).
- **Recent ring:** a fixed-size ring buffer of the last **20** submissions
  (all plays, not just bests), powering activity feeds.

### 4.3 Pagination convention [MVP]

All paginated reads take `(offset, limit)`: `offset` is the 0-based index
of the first item; the result is items `[offset, offset+limit)`, fewer
(possibly zero) past the end — reads MUST NOT revert on out-of-range
offsets. Contracts MAY cap `limit` at a maximum of their choosing, but the
cap MUST be ≥ 50; requests at or below the cap are honored exactly.

### 4.4 Listing management [MVP]

To be listed, the game contract registers **itself** with the Arcade
Registry via a cross-contract call (see §5.2). The contract MUST expose
some message that triggers `registry.register(meta)` — by convention:

```
updateListing(meta: ListingMetadata)   // gated however the dev chooses
```

`meta` is the §5.1 `ListingMetadata` type — the game contract forwards it
verbatim. The standard does not prescribe the gate. The reference
implementation gates it `caller() == owner` where `owner` is the deployer
(captured in the constructor), and takes the **registry's address as a
constructor argument**, injected by the template's deploy pipeline from
configuration (§10.3) — the standard does not hardcode a registry address.
Auth for a listing is entirely the game contract's concern; the registry
has none (§5.2).

### 4.5 Future modularity (version 2, reserved) [Post-MVP]

Version 2 will make Module B opt-in for games without meaningful scores
(win/loss multiplayer, sandboxes, state-machine games):

- `capabilities() -> u32` is **reserved** — a bitmask where bit 0 =
  Leaderboard module. Version 1 contracts do not implement it; the
  dashboard infers full capability from `arcadeVersion() == 1`.
- Version 2 adds `recordPlay()` so activity-only games drive Module A's
  counters without scores.
- Version 1 contracts are forward-compatible by construction (they
  implement everything).
- The dashboard MUST keep activity rendering and leaderboard rendering as
  separable components today, so a board-less game in v2 is a conditional,
  not a rewrite.

### 4.6 Reference implementation [MVP]

The game-template ships the canonical reference implementation of GCS v1
(a rewrite of the prototype's `Leaderboard` contract — not an extension of
it). It is the path of least resistance for game devs: deploy it unmodified,
get full compliance.

### 4.7 Trust model

Scores are client-submitted and unverifiable on-chain; any caller can submit
any value. Version 1 accepts this openly (see §9). The standard's stats are
meaningful because writes cost real transaction fees — inflating
`playCount` or planting fake scores costs the attacker money and is
visible on-chain.

## 5. Arcade Registry Contract

The Arcade Registry is a singleton contract that is **only a directory**:
which game contracts exist, plus the minimal metadata needed to render and
filter a discovery grid. It holds no scores, no players, no stats — those
live in the game contracts (§4). It has no owner, no admin, and no
moderation: it is fully permissionless.

### 5.1 Listing data [MVP]

```
ListingMetadata {
  name:             String,   // ≤ 64 bytes
  gameType:         String,   // ≤ 32 bytes; one tag, see 5.4
  shortDescription: String,   // ≤ 256 bytes
  playUrl:          String,   // ≤ 256 bytes; where the game is played (§6.2)
  thumbnailCid:     String,   // ≤ 128 bytes; IPFS/Bulletin CID, may be empty
  requiresAccount:  bool,     // game cannot be played as a guest (§8.3)
  extraCid:         String,   // ≤ 128 bytes; extended metadata JSON (§6.3), may be empty
}

Listing {
  meta:         ListingMetadata,
  metaVersion:  u32,   // set by the registry, = 1 for this document
  registeredAt: u64,   // set on first register
  updatedAt:    u64,   // set on every register
}
```

The registry rejects (reverts) metadata exceeding the length caps. It does
not validate content — names are not unique, URLs are not checked. Trust
derives from §5.2, not from validation.

### 5.2 Authorization: the caller is the game [MVP]

The registry's entire auth model: **a listing's key is `caller()`**.

```
register(meta: ListingMetadata)   // create or update; listing key = caller()
unlist()                          // remove caller()'s listing
```

Registration MUST therefore be a cross-contract call *from* the game
contract (triggered by the dev via the game's `updateListing` passthrough,
§4.4). Consequences, by design:

- You can only ever write the listing keyed by your own address — there is
  no "are you allowed?" check to implement, and none to get wrong.
- Impersonation/squatting is impossible: listing a contract requires
  controlling it.
- Who may update a listing is entirely the game contract's concern (owner
  key, multisig, DAO — the registry neither knows nor cares).
- Spam costs money: being listed requires deploying a real contract and
  paying for the calls.
- Create and update are the same message; last write from the contract wins.

The registry SHOULD verify `caller()` is a contract (not an EOA) if the
runtime exposes a cheap check; if not, this is acceptable to skip — an EOA
"listing" has no GCS read surface and is filtered by the dashboard's
version check (§4.1, §7.4).

### 5.3 Enumeration [MVP]

| Message | Returns | Semantics |
|---|---|---|
| `gameCount()` | `u32` | Number of active listings. |
| `getGames(offset: u32, limit: u32)` | `Vec<(H160, Listing)>` | Listings in registration order. Pagination per §4.3. |
| `getListing(game: H160)` | `Option<Listing>` | Single lookup. |

Registration order is stable; `unlist` leaves a hole that enumeration
skips (implementation may swap-and-pop — order stability across unlisting
is NOT guaranteed and the dashboard MUST NOT rely on it).

### 5.4 Game types [MVP]

`gameType` is a free string tag, not an enum — the registry must not need
redeployment to admit a new genre. This document recommends the vocabulary:
`arcade`, `puzzle`, `racing`, `strategy`, `shooter`, `card`, `idle`,
`other`. The dashboard filters on known tags and buckets unknown tags under
"other". Multiple tags per game are [Post-MVP] (`metaVersion` 2).

### 5.5 Metadata upgradability [MVP]

Two complementary mechanisms:

1. **`metaVersion`** — stamped by the registry on each listing. A future
   registry version that adds fields reads old listings with defaults.
   The dashboard MUST tolerate any `metaVersion` ≥ 1, ignoring fields it
   does not understand.
2. **`extraCid`** — escape hatch for display-only metadata that should not
   require chain changes: an IPFS/Bulletin CID pointing to a versioned JSON
   document (§6.3) with screenshots, long description, links, etc. The
   dashboard renders without it; it only enriches. Anything the dashboard
   **filters or sorts on** must be an on-chain field, never in `extraCid`.

### 5.6 Events [MVP]

```
ListingChanged(game: H160)   // emitted on register and unlist
```

Lets the dashboard refresh its game list reactively instead of re-paginating
every block.

### 5.7 What the registry deliberately does NOT do

- No stats mirroring (play counts etc. are read live from game contracts —
  one source of truth, nothing to drift).
- No name/identity system (player names come from DotNS, §8.2).
- No curation, featuring, or verification tiers [Post-MVP, see §11].
- No fees or deposits beyond ordinary transaction costs [Post-MVP option].

## 6. Game Metadata

### 6.1 What lives where [MVP]

One rule decides placement: **if the dashboard filters or sorts on it, it
is an on-chain field; if it is display-only, bytes live off-chain behind a
CID.** Rationale: on-chain fields are readable, trustable, and filterable
in one paginated registry call; CID content is opaque to contracts and may
fail to fetch — acceptable for enrichment, never for core function.

| Data | Location |
|---|---|
| name, gameType, shortDescription, playUrl, requiresAccount | On-chain (registry listing, §5.1) |
| Thumbnail image | Bulletin/IPFS, CID on-chain (`thumbnailCid`) |
| Long description, screenshots, links | Bulletin/IPFS JSON, CID on-chain (`extraCid`) [Post-MVP] |
| All stats (plays, players, scores) | Game contract (§4) — never duplicated into metadata |

### 6.2 playUrl [MVP]

Where the game is played. Preferred form: a `.dot` name (the game dApp
deployed to IPFS + DotNS, opened in-host per §7.5). Plain `https://` URLs
are permitted — the registry does not validate — but `.dot` is the
ecosystem-native path and what the template produces.

### 6.3 Extended metadata document (`extraCid`) [Post-MVP]

A JSON document on Bulletin/IPFS, self-versioned so it can evolve without
chain changes:

```json
{
  "version": 1,
  "longDescription": "markdown, ≤ 8 KiB",
  "screenshots": ["<cid>", "<cid>"],
  "heroImageCid": "<cid>",
  "links": { "source": "https://...", "developer": "https://..." }
}
```

The dashboard MUST render fully without this document and MUST ignore
unknown fields and unknown versions.

### 6.4 Images [MVP]

- **Thumbnail:** 16:9, recommended 640×360, WebP/PNG/JPEG, ≤ 256 KiB.
  Stored via Bulletin Chain preimage storage (`CloudStorageClient.store`),
  referenced by CID.
- **Fetching:** inside a host, via the host's preimage lookup; outside,
  via public IPFS gateways (`fetchBytes(cid)` handles both). The dashboard
  shows a deterministic placeholder (derived from the game's address) when
  `thumbnailCid` is empty or the fetch fails — image failure must never
  break a card.

### 6.5 Automation requirement [MVP]

Metadata is not hand-assembled. The game template's deploy pipeline (§10)
reads a single config file (name, type, description, thumbnail path),
uploads the thumbnail automatically, and submits the complete listing as
part of deployment. A developer — or an AI agent acting on a single prompt —
never touches CIDs by hand.

## 7. Dashboard Web App

A **stateless, read-only** static dApp: no backend, no indexer, no database,
and — uniquely among the components — **no writes and no account**. It reads
the Arcade Registry for the grid and each game contract (via the GCS, §4)
for stats and leaderboards, using PAPI + `@polkadot-api/sdk-ink` against
Paseo Asset Hub. It runs inside a Triangle host, and degrades gracefully to
a plain browser via public RPC (it never needs a signer).

### 7.1 Home page (discovery) [MVP]

Steam-style discovery surfaces, top to bottom:

1. **Featured row** — large hero cards; the most recently active games
   (sorted by `lastPlayedAt` desc). "Featured" is earned by activity, not
   curated — consistent with the permissionless registry.
2. **Most Played** — sorted by `playCount` desc, all-time. (All-time is the
   only honest ranking computable without history; trending-over-a-window
   requires event history and is [Post-MVP].)
3. **New** — sorted by `registeredAt` desc.
4. **All games** — full grid, paginated, with `gameType` filter chips
   (known vocabulary per §5.4; unknown tags bucket under "other").
5. **Live activity rail** — a merged feed of recent plays across games
   (player, score, game, relative time), built from a **bounded** merge:
   `getRecent` from at most the 10 most-recently-active games. Updated per
   §7.4.

Search is [Post-MVP].

### 7.2 Game cards [MVP]

Each card: thumbnail (`thumbnailCid`, placeholder if empty), name,
`gameType` chip, play count, last-played as relative time ("active 2m ago"),
top player (rank-1 entry, name-resolved per §8.2), and a `requiresAccount`
badge where set.

### 7.3 Game detail page [MVP]

Route per game (keyed by contract address):

- Hero: thumbnail/hero image, name, type, short description,
  `requiresAccount` badge, **Play** button (§7.5).
- Stats: play count, unique players, last played.
- Leaderboard: paginated `getLeaderboard` (page size 25), scores rendered
  per `scoreFormat`/`scoreUnit`, players name-resolved per §8.2.
- Recent plays: `getRecent`, newest-first.
- Footer: contract address (linked to explorer), registered/updated dates.
- [Post-MVP] screenshots/long description from `extraCid` (§6.3).

Activity rendering and leaderboard rendering MUST be separate components
(required by §4.5 for future board-less games).

### 7.4 Read strategy [MVP]

- **Conformance gate:** before showing any game, the dashboard checks
  `arcadeVersion()`; contracts that fail the call or return an unknown
  version are skipped silently. This — not registry-side validation — is
  what filters junk listings.
- **Best-block reads** (`atBest`) so fresh plays appear within a block.
- **Refresh:** subscribe to new best blocks; on each block, refresh only
  what's visible (current page / open game), with results cached and
  reused across surfaces. Event subscriptions (`ScoreSubmitted`,
  `ListingChanged`) MAY replace block-polling where available
  [MVP-optional].
- **Bounded reads per block:** home-page refresh reads at most the games
  visible on screen plus the activity-rail set (≤ ~20 game contracts);
  never enumerate the full registry more than once per session (plus on
  `ListingChanged`).
- **Stat reads batched per game:** `playCount`, `uniquePlayers`,
  `lastPlayedAt` fetched together; immutable values (`scoreOrdering`,
  `scoreFormat`, `scoreUnit`) cached for the session; listing metadata
  cached until a `ListingChanged` event (or session end).
- **ABIs and addresses:** the dashboard ships with the canonical ABIs
  produced by building the registry and reference GCS contracts — the GCS
  ABI is identical for every conforming game, which is the point of the
  standard. The registry's deployed address is the dashboard's single
  configured address (recorded at deploy time via `cdm.json`, §10.3/§10.5).

### 7.5 Launching games [MVP]

The Play button opens the game's `playUrl` — ideally a `.dot` name — **as a
new dApp within the host environment**, not an external browser tab.

- The host-api does not currently expose an explicit "open dApp" call;
  hosts intercept navigation to `.dot`/dApp URLs and open them in-host. The
  dashboard therefore renders Play as standard navigation to `playUrl`, and
  MUST adopt the host's app-launch API if/when one ships.
- ⚠ **Integration risk — validate in week 1:** confirm with a real Triangle
  host that navigating from one embedded dApp to a `.dot` URL opens the
  target dApp. If it does not, the conference fallback is opening the game
  in a new tab/window.
- Outside a host (plain browser), Play opens `playUrl` directly; for a
  `.dot` name, the dashboard rewrites it to its public gateway form
  (`https://<label>.dot.li`).

### 7.6 Visual direction [MVP]

Steam/itch.io-inspired library feel: dark, image-forward grid; the games'
thumbnails carry the visual weight. Follows the Polkadot design system
(surfaces over borders, restraint over decoration). Must be presentable on
a large conference screen and on mobile (the host environment is
mobile-first).

## 8. Identity & Player Experience

### 8.1 Player identity [MVP]

A player is their **host wallet account** — the Polkadot account from the
mobile app / host environment, exposed to games via product-sdk's
`SignerManager`. Games MUST submit scores from this account, not from
per-app product accounts or browser-local burner keys, because:

- the same human is the same H160 across every game — leaderboards,
  activity feeds, and (future) profiles can unify a player;
- DotNS reverse resolution attaches the player's name to their entries
  (§8.2), which per-app derived accounts would never get.

(Privacy tradeoff, stated openly: all of a player's game activity is
linkable on-chain. Per-game pseudonymity via product accounts is a
[Post-MVP] option a future standard version could admit.)

On-chain, players are H160. Submission uses `ensureAccountMapped` (one-time
`pallet_revive` mapping) + `submitAndWatch` at best-block, both from
product-sdk. **The prototype's burner-wallet + faucet machinery is removed
entirely.**

### 8.2 Player display names [MVP]

No name infrastructure of our own — names come from downstream:

1. **DotNS reverse resolution** — `DotnsReverseResolver.nameOf(h160)`
   (deployed on Paseo Asset Hub at
   `0xa691F7ed662685a0D8aDF711A90D8302E5cfd2aD`; fail-closed: returns `""`
   if the address no longer owns the name).
2. **Fallback** — deterministic identicon + truncated address
   (`0x1a82…8e48`).

Resolutions are cached per session. Caveat, stated honestly: a name appears
only if the player registered their `.dot` name with the same account they
play with — true by construction when both flow through the host wallet.

### 8.3 Guest play and the sign-in nudge [MVP]

Anyone can jump in and play — most games are pure JS with the contract
only for scores:

- **Guest mode = zero chain interaction.** No account, no funding, no
  mapping. The game runs; the score is held locally (and may be kept in
  host/local storage so it survives the session).
- **At game over**, a guest who set a score worth keeping is prompted:
  *"Sign in to save your score"* — one flow, implemented by the template's
  scoreboard layer: connect via `SignerManager` → `ensureAccountMapped`
  for the **player's** account (idempotent; distinct from the developer's
  mapping in §10.2) → `submitScore` with the held score. This is the
  conversion moment from visitor to ecosystem participant; the template
  implements it once and every template game inherits it.
- **`requiresAccount` games** (multiplayer, on-chain state machines) are
  badged on the dashboard (§7.2) and gate at launch: the game asks for
  sign-in before play begins rather than at game over.

### 8.4 The dashboard has no identity [MVP]

The dashboard itself never connects a wallet, never signs, never writes
(§7). Sign-in exists only inside games, at the moment a score needs
saving. Browsing, discovering, and watching live activity require nothing.

## 9. Non-Functional Requirements & Trust Model

### 9.1 Trust model, stated honestly [MVP]

- **Scores are client-submitted and unverifiable.** Anyone can call
  `submitScore(u128::MAX)`. v1 accepts this: the defense is economic
  (every write costs fees), social (cheating is visible on-chain and
  pointless on a testnet arcade), and architectural (one game's fake
  scores corrupt only that game's board — there is no cross-game score).
  Verified-score tiers (commit-reveal, server-attested, ZK) are [Post-MVP].
- **Listings are self-sovereign, not curated.** The registry hosts whatever
  a contract says about itself — names, descriptions, and images are
  unmoderated. The conformance gate (§7.4) filters non-games; it does not
  filter bad taste. Client-side curation (blocklists, featured lists) is a
  dashboard concern and [Post-MVP].
- **Stats are spam-resistant by cost.** `playCount`/`uniquePlayers` can be
  inflated only by paying per transaction from distinct funded accounts —
  exactly the property requested of discovery stats.

### 9.2 Scalability envelope [MVP]

Stated capacity, without indexer or backend:

- Designed to stay smooth to **~100 listed games** and **hundreds of
  players per game**. Bounded reads (§7.4) keep per-block work constant:
  the full registry is enumerated once per session; per-block refresh
  touches ≤ ~20 contracts.
- The bounded structures (top-100 board, 20-slot recent ring) make every
  read O(limit) regardless of total players — the contracts, not the
  dashboard, carry the scaling burden.
- Beyond that envelope (thousands of games, trending windows, search), an
  event-history indexer becomes necessary; `ScoreSubmitted` and
  `ListingChanged` exist precisely so one can be added without touching
  contracts [Post-MVP].

### 9.3 Performance & availability [MVP]

- Dashboard first contentful paint MUST NOT wait on chain reads — render
  the shell, stream cards in as reads land; cached listing metadata
  renders instantly on revisit.
- Best-block reads make fresh plays visible within one block (~6s);
  score submission UX targets in-block confirmation, not finality.
- The dashboard is a static bundle; its only runtime dependencies are a
  public RPC endpoint and the Bulletin/IPFS gateway. Image or gateway
  failure degrades to placeholders (§6.4), never to broken pages.

### 9.4 What can go wrong on stage (and the answer)

| Failure | Mitigation |
|---|---|
| RPC endpoint down | Configurable endpoint list, ordered fallback |
| Gateway slow → blank thumbnails | Deterministic placeholders; session-cached images |
| A junk listing appears mid-demo | Conformance gate hides non-games; junk *games* are a talking point — "permissionless means permissionless" |
| Live-activity rail stalls | Degrade to last-fetched state with relative timestamps; never spinner-lock (§2.4: the rail is first to cut) |

## 10. Developer Journey

### 10.1 The single-prompt requirement [MVP]

The canonical developer experience is one prompt to an AI agent:

> *"Edit the game template for the snake game and deploy it to the arcade."*

From that, the agent handles everything: writing/editing the JS game,
generating a thumbnail, deploying the contract, publishing the frontend,
and registering the listing. This is not aspirational — it is the
**tested path**: the game template MUST ship agent instructions
(`CLAUDE.md` / `AGENTS.md`, following the playground tutorial-app pattern)
that make this flow work, and the flow MUST be exercised end-to-end before
the conference.

The human does ideally nothing — except one-time setup (§10.2), which the
template documents up front so users know exactly what is needed and can
do it while the agent works.

### 10.2 The one human step: playground login [MVP]

Tooling is the **playground CLI** (`playground` / `pg`):

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | bash
playground init    # QR scan with the Polkadot mobile app
```

`playground init` is the entirety of human involvement: it installs the
toolchain (Rust, cargo-pvm-contract, Kubo IPFS), logs in via QR + mobile
app, funds the account (testnet), maps it for `pallet_revive`, and grants
Bulletin storage allowances. The template README MUST present this as the
single prerequisite, with the QR step explained. Agent instructions MUST
detect a missing session and tell the user to run `playground init` —
never attempt to work around it.

### 10.3 The automated pipeline [MVP]

Every step below MUST be runnable non-interactively (agent-driven, no
prompts). The template provides the glue scripts the CLI doesn't:

| # | Step | Tooling | Status |
|---|---|---|---|
| 1 | Write/edit the game (JS, implements `onGameEnd(score)`) | AI agent | exists (template seam) |
| 2 | Fill `arcade.config.json` — name, gameType, shortDescription, requiresAccount, thumbnail path, `domain` (the `.dot` label used in step 6, from which `playUrl` derives) | AI agent | **template provides** |
| 3 | Generate thumbnail if absent (agent-made art, 16:9 per §6.4) | AI agent | agent capability |
| 4 | Build + deploy the game contract (GCS reference impl) | `playground contract deploy` (address recorded in `cdm.json`) | exists |
| 5 | Upload thumbnail to Bulletin → CID | **template script** (over bulletin/cloud-storage tooling; CLI has no standalone upload command) | **template provides** |
| 6 | Build + publish frontend → Bulletin/IPFS + automatic `.dot` name | `playground deploy --signer <dev\|phone> --domain <name> --buildDir dist --playground` | exists (incl. DotNS commit-reveal) |
| 7 | Register the listing: call the game contract's `updateListing` with name, type, description, `playUrl = <domain>.dot`, `thumbnailCid` | **template script** (reads `arcade.config.json` + `cdm.json`) | **template provides** |
| 8 | Verify: read back the registry listing and `arcadeVersion()`; print the dashboard URL | **template script** | **template provides** |

`arcade.config.json` is the single source of truth (§6.5); steps 5–8 read
from it and from `cdm.json` — no value is ever typed twice, and no human
touches a CID or address by hand.

Signing: steps 4–7 sign with the developer's playground session account
(from `playground init`, §10.2) — the same account that deploys the
contract in step 4 and is therefore its `owner` for the `updateListing`
gate in step 7. The Arcade Registry's deployed address ships as a
dependency in the template's `cdm.json`, which is how step 4's constructor
argument (§4.4) and step 8's verification read are configured.

### 10.4 Template requirements [MVP]

- **One seam for game code:** a game is a component implementing
  `onGameEnd(score: number)`, called exactly once per match; no chain
  knowledge inside the game (carried over from the prototype — its best
  idea).
- **Scoreboard layer** implements §8: host-wallet sign-in, guest mode with
  the game-over save-score prompt, account mapping, `submitScore`.
- **Reference GCS contract** (§4.6) included and deployed unmodified by
  step 4.
- **Agent instructions** (`CLAUDE.md`/`AGENTS.md`): the seam, the config
  file, the pipeline commands in order, common failure modes (no session →
  run `playground init`; domain taken → pick another), and the §4/§5
  interface contracts.
- **Failure honesty:** every script exits non-zero with an actionable
  message; an agent must never see a silent partial deploy.

### 10.5 Network [MVP]

Everything targets the playground CLI's live environment:
**paseo-next-v2** — Paseo Asset Hub
(`wss://paseo-asset-hub-next-rpc.polkadot.io`) for contracts and DotNS,
Paseo Bulletin for storage, gateway `https://gateway.polkadot.io/ipfs/`.

## 11. Future Work (Out of Scope)

Collected [Post-MVP] threads, roughly ordered by expected demand:

**Standard (GCS v2)** — `capabilities()` bitmask with optional Module B;
`recordPlay()` for score-less/activity-only games; multiple boards per
game (difficulties, seasons); multiple `gameType` tags; product-account
pseudonymity as an opt-in identity mode.

**Discovery** — search; trending over time windows (requires indexing
`ScoreSubmitted` history); `extraCid` rendering (screenshots, long
descriptions, links); client-side curation: featured lists, blocklists,
verification badges.

**Trust** — verified-score tiers (commit-reveal, server-attested, ZK
proofs of play); rate-limiting or deposits if testnet economics prove
insufficient.

**Infrastructure** — an event-history indexer once the §9.2 envelope is
exceeded (contracts already emit what it needs); developer mode / test
accounts for local iteration.

**Ecosystem (far out, deliberately undesigned)** — player profiles and
social features (downstream of DotNS and the host stack); creator
monetization and developer-support pipelines; mainnet deployment
economics.

None of these require breaking changes to the v1 contracts: the version
field (§4.1), reserved capability mechanism (§4.5), metadata versioning
(§5.5), and standardized events were placed so that v2 is an addition,
not a migration.
