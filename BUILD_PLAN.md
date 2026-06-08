# Build Plan — Polkadot Arcade (from SPEC.md, MVP cut §2)

Loop protocol: each iteration, take the **first unchecked item**, implement it
per the referenced SPEC.md sections, get its tests green, commit, check it off
(edit this file in the same commit). Never start an item with an earlier item
unchecked unless it's blocked — if blocked, note why here and move on.

Test gates: contracts → `cargo test`; template/dashboard logic → unit tests
(vitest); UI flows → Playwright. A checked item means its tests pass.

## Phase 1 — Contracts (SPEC §4, §5)

- [x] 1. Contracts workspace: `contracts/registry` + `contracts/gcs-reference`
      (ink! on PolkaVM via `pvm_contract`, modeled on the prototype's toolchain),
      both compiling clean.
- [x] 2. Arcade Registry per §5, with unit tests: caller-keyed register/update,
      unlist, length-cap reverts, enumeration + pagination edges (§4.3),
      `ListingChanged` event, `metaVersion`/timestamps stamping.
      (18 tests green. Notes: events emitted manually via deposit_event with
      keccak topic — pvm_contract macro lacks event support, so events are NOT
      in the generated ABI JSON; dashboard must subscribe by topic hash.
      contracts/.cargo/config.toml deliberately drops the prototype's default
      riscv target so `cargo test` and `cargo pvm-contract build` coexist.)
- [x] 3. GCS v1 reference contract per §4, with unit tests: submitScore
      semantics (non-improving never reverts, counters always move), both
      score orderings, u128::MAX sentinel rule, top-100 insert/update/evict,
      tie-breaking (`at` asc, then insertion order), 20-slot recent ring,
      pagination edges, `ScoreSubmitted` event, `updateListing` owner gate +
      cross-contract `register` (registry address as constructor arg).
      (29 tests green. Notes: cross-contract register uses hand-built
      calldata — abi_import! can't encode dynamic tuples — selector derived
      from SOL_NAME in code + pinned in tests; MUST be verified end-to-end
      on-chain in item 4. ScoreSubmitted topic0
      0x860916283ae2e9eee2b7aa65ba521da02a25980e6ea2ac8b2d777f728aa9f19a.
      ABI method names camelCase; struct field names stay snake_case.)
- [x] 4. Deploy both to Paseo Asset Hub (paseo-next-v2); record addresses in
      `cdm.json`; verify reads back (§10.3 step 8 style).
      (All 11 on-chain checks pass incl. the hand-encoded cross-contract
      register and a real submitScore. Addresses in contracts/cdm.json +
      DEPLOYMENT.md; deployer/owner = //Alice. Finding: chain timestamps are
      Unix SECONDS — SPEC §4 and contract comments amended. Note:
      `playground contract deploy` is a CDM-publish pipeline without
      constructor-arg support; deployment uses contracts/scripts/
      deploy-and-verify.mjs via PAPI + sdk-ink instead.)

## Phase 2 — Integration risk spikes (SPEC §2.3) — run early, results recorded here

- [x] 5. Validate in-host dApp→dApp `.dot` navigation; record outcome + chosen
      fallback in this file under "Spike results".
      (Web host validated via spikes/nav-spike. Mobile-host check still
      pending with user — low risk, same pattern expected.)
- [ ] 6. Validate host-wallet signing round-trip from a game
      (SignerManager → ensureAccountMapped → submitScore) on paseo-next-v2.
      ⚠ BLOCKED on user: needs the mobile app against a deployed test game.
      Item 7's reworked template will be the test vehicle.

## Phase 3 — Game template (SPEC §8, §10)

- [x] 7. Rework identity: remove burner/faucet machinery; product-sdk
      SignerManager; guest mode (zero chain) + game-over "sign in to save your
      score" flow (§8.3); unit tests for the scoreboard layer.
      (16 tests + build green. Burner/arcade/faucet code deleted; pure policy
      in scoreboard.ts behind a ChainGateway seam; real SDK wiring isolated
      in sdk-gateway.ts with a ⚠ TODO for the item-6 in-host validation.
      SDK pinned to signer 0.6.0 / tx 0.2.7 — npm registry date cutoff blocks
      newer; bump later. cdm.json repointed at the new GCS contract.)
- [x] 8. `arcade.config.json` + pipeline scripts (§10.3 steps 5/7/8): thumbnail
      upload → CID, `updateListing` registration, verify script — all
      non-interactive, exiting non-zero with actionable messages.
      (35 tests + build green; proven by a LIVE run: Snake GCS instance
      0x5d38af8b84c06d26113d94b596ccca99f2078acc registered in the registry,
      thumbnail bafkreierhubxebvyr5vzzvhg3tl6su762laopokeuuuinpn32qli72quyy
      fetchable from the Bulletin gateway. Bulletin upload: bulletin-deploy
      for CID/auth helpers + own PAPI submit (its storeFile watcher is
      incompatible with papi 1.23.3). deploy-contract.mjs replaces
      `playground contract deploy` for §10.3 step 4 — no ctor-arg support
      there; signer = ARCADE_SURI env, default //Alice.)
- [x] 9. Template agent instructions (`CLAUDE.md`/`AGENTS.md` per §10.4).
      (Full runbook in CLAUDE.md; README/modding.md/quests/setup.sh purged of
      burner-model references.)
- [x] 10. Playwright: guest plays Snake → game over → save-score prompt
      appears; sign-in path submits (host mocked via test SDK).
      (5/5 e2e green. Fake gateway behind VITE_ARCADE_FAKE_GATEWAY in the
      composition root; deterministic __snakeForceGameOver test hook.)
- [ ] 10b. HARDENING (from live item-6 bug). ⚠ EARLIER DIAGNOSIS RETRACTED.
      My "stale edge serving an old build" claim was WRONG: it came from
      curling <label>.app.dot.li directly, which (per the dotli source) is a
      sandbox iframe whose Service Worker serves assets from a CID-keyed
      archive — a direct curl returns NGINX's SPA fallback HTML, NOT the app's
      assets. So the asset-hash "divergence" was an artifact of testing the
      wrong URL; spikes/serving-repro/repro.sh is invalid and should not be
      trusted. The user's "product-sdk import failed: …index-P8dkzTTl.js 404"
      is a REAL in-iframe failure, but the real cause is one of: the published
      CID's archive is incomplete (missing that chunk), a bitswap/IPFS fetch
      failing partway, or the SW 503ing before the archive loaded — none
      detectable by curl. Correct diagnosis: in-browser DevTools Network on
      <label>.dot.li, or resolve the DotNS→CID and list the archive contents.
      dotli serving architecture: host shell <label>.dot.li → DotNS→CID →
      iframe <label>.app.dot.li/?cid=… → SW fetches archive → serves chunks
      from IndexedDB (SWR cache, shows "new version" toast on CID change).
      In-repo mitigation still worth doing: make the product-sdk import STATIC
      (entry chunk) not lazy, so sign-in can't fail on a missing lazy chunk.
      A post-deploy verify must check the CID archive completeness (not curl
      the subdomain). NEEDS user decision on next step.

## Phase 4 — Dashboard (SPEC §7)

- [x] 11. Dashboard skeleton: registry enumeration, `arcadeVersion()`
      conformance gate, home page (featured / most played / new / grid with
      gameType chips), game cards (§7.2); unit tests for sorting/gating logic.
- [x] 12. Game detail page (§7.3): stats, paginated leaderboard with
      scoreFormat rendering, recent plays, Play button (§7.5 behavior).
      (40 unit tests + build green. Hash router; ArcadeReads interface is the
      sole chain seam, fake impl behind VITE_ARCADE_FAKE_READS for item 15.
      Leaderboard vs activity are separate components per §4.5. resolveName()
      stubbed to truncated address — item 14 wires DotNS.)
- [x] 13. Live activity rail + read strategy (§7.4): bounded per-block refresh,
      session caching, graceful degradation; unit tests for merge/bounds.
      (refreshGames(visible) re-reads only Module A stats for on-screen games;
      registry enumerated once/session; mergeStats keeps last-good on failure;
      relative time ticks on a 20s wall-clock independent of blocks.)
- [x] 14. DotNS reverse name resolution + identicon/truncation fallback (§8.2).
      (resolveName → DotnsReverseResolver.nameOf via sdk-ink, direct H160, no
      new dep; fail-closed → truncated address + placeholder SVG identicon;
      session-cached, progressive non-blocking swap-in.)
      ALSO FIXED here: dashboard/cdm.json had stale @example/arcade-playground
      keys (would break the real chain path; unit tests use fakes so passed
      regardless). Repointed to @arcade/registry 0x4d18…3cc2 +
      @arcade/gcs-reference, asset-hub endpoint preserved. No install hook
      clobbers it. 54 unit tests + build green.
- [x] 15. Playwright: home renders listed games (chain mocked), filter chips,
      detail page leaderboard, Play link resolution in/out of host.
      (9 e2e green via VITE_ARCADE_FAKE_READS fixtures incl. a ghost game that
      proves the conformance gate hides it; all 3 score formats, DotNS name
      vs truncated fallback, Play anchor href/target. No production-code touch.)

## Phase 5 — Content + rehearsal (SPEC §2.2)

- [ ] 16. Build 2–3 real games via the single-prompt flow; deploy + register
      on Paseo (the flow itself is the test — §10.1).
- [ ] 17. Dress rehearsal: fresh end-to-end run (prompt → listed game →
      visible on dashboard); fix what breaks; record results here.

## MVP TODO — fund the product account so scores can save (storage deposit)

⚠ BLOCKS the "play + save" loop for any FRESH game. Root cause (verified, two
investigations): each game uses its own per-app product account (host-enforced —
a deployed `.dot` must sign as its own `<label>.dot`; subdomains do NOT share an
account because signing is locked per-label). A fresh product account has ZERO
balance, and a pallet_revive contract call's STORAGE DEPOSIT is reserved from the
signer's free balance — the host sponsors FEES (AsPgas) but NOT deposits. So the
first save reverts `Revive::StorageDepositNotEnoughFunds`. (The `AccountUnmapped`
layer is already fixed; this is the next one. Batching is NOT the cause — keep the
single-signature batch.)

Funding model (per the user): product accounts are funded via a FAUCET; the app
opens the faucet with `?address=<the product account>` (faucet is itself a
product account derived `root-seed//faucet.dot//0`). On paseo-next-v2 use the
IN-HOST `faucet.dot` (NOT public faucet.polkadot.io, which funds standard Paseo —
the wrong chain).

Plan (paused, pending faucet URL/param confirmation): on sign-in, check the
product account's free balance; if too low for map + a leaderboard-entry deposit,
surface a "Get test funds" action that opens the faucet with the product
account's SS58 (`connected.ss58`), then retry. Keep the batched map+submit. Wire
in game-template/src/scoreboard/sdk-gateway.ts (+ a UI affordance in App.tsx).
Then redeploy the 5 game frontends. NOTE: this is per-account, so the bundled-
arcade-app model (all games at one origin → one shared account) would make
funding one-time — a separate architectural decision (SPEC §8.1).
TO CONFIRM with user before building: exact faucet URL (faucet.dot →
https://faucet.dot.li/?address=…?) and whether `?address=` is SS58 or H160.

## Known issues (found while playing locally)

- **Read origin must be pallet_revive-mapped** — FIXED. The dashboard's read
  origin was unmapped → every dry-run reverted `AccountUnmapped` → empty
  registry. Now uses Alice (mapped). Added `dashboard` live smoke test
  (`npm run test:smoke`) that reads the real registry so this can't silently
  regress (unit/e2e use fakes and stayed green through the bug).
- **DotNS resolver not found on paseo-next-v2** — OPEN. sdk-ink's
  `getContract` for the reverse resolver (0xa691…d2aD) emits a background
  "Contract not found" rejection on `wss://paseo-asset-hub-next-rpc.polkadot.io`;
  names always fall back to truncated addresses (spec §8.2 fail-closed, so
  functionally OK). To fix: confirm the resolver's address/network, or do the
  reverse lookup via a raw revive dry-run instead of sdk-ink (avoids the
  existence check + floating rejection). Low priority — fallback works.

## Post-MVP: full activity capture via AutoSigning

The template submits a score only on a personal best (+ a player's first
play), so on-chain activity (playCount / recent ring) under-records real
plays. Prompting every game over is too aggressive — each submit is a signed
tx (a host approval). The right fix is background submission via the host's
`AutoSigning` resource grant (request once in SignerManager `onConnect`, then
submit every play silently). BLOCKED today: `AutoSigning` returns
`NotAvailable` on Android/iOS wallets (slot renewal: paritytech/individuality
#931, open). Refs: product-sdk `examples/signer-demo/src/main.ts`,
`packages/signer/src/types.ts` (onConnect), `packages/host/src/truapi.ts`
(AllocatableResource/AllocationOutcome), `packages/terminal/README.md`
(caveat). When it lands: gate on the outcome tag — `Allocated` → background-
submit every play; else keep the personal-best prompt. See SPEC §11. Until
then, personal-best-only is intended, not a bug.

## Spike results

### Item 5 — dApp→dApp navigation (web host, 2026-06-06)

Tested via `spikes/nav-spike` (deployed: arcade-nav-spike.dot.li, headless
Chromium driving the dot.li web host). Architecture observed: `<label>.dot.li`
serves a host shell; the app runs sandboxed in an iframe at
`<label>.app.dot.li`; a host bridge iframe runs at
`host.dot.li?mode=shared-worker&network=paseo-next-v2`.

| Variant | Result |
|---|---|
| `<a target="_blank">` → `https://<label>.dot.li` | ✅ opens target app in a new page with its own host shell — **the launch pattern** |
| same-frame `<a>` / `location.href` (gateway or bare .dot) | ❌ blocked (iframe sandbox/CSP → chrome-error) |
| `window.open(...)` | ❌ popup blocked |
| `dot://` custom scheme | ❌ dead |

Dashboard Play button therefore: plain anchor, `target="_blank" rel="noopener"`,
href `https://<label>.dot.li`. Works identically in plain browser (shell
auto-boots). Mobile host: pending user check.

### Item 6 — host-wallet signing round-trip

Pending. Item 7 flagged what it must confirm: (1) `connect("host")` returns a
usable signer in-host; (2) the H160 the contract sees as `caller()` ==
sdk-ink's `ss58ToEthereum(account.address)` (NOT `SignerAccount.h160`, which
is keccak-derived and differs — template uses the former); (3) map_account +
submitScore survive the host's signed-extensions path.
