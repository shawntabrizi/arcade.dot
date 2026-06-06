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
- [ ] 9. Template agent instructions (`CLAUDE.md`/`AGENTS.md` per §10.4).
- [ ] 10. Playwright: guest plays Snake → game over → save-score prompt
      appears; sign-in path submits (host mocked via test SDK).

## Phase 4 — Dashboard (SPEC §7)

- [ ] 11. Dashboard skeleton: registry enumeration, `arcadeVersion()`
      conformance gate, home page (featured / most played / new / grid with
      gameType chips), game cards (§7.2); unit tests for sorting/gating logic.
- [ ] 12. Game detail page (§7.3): stats, paginated leaderboard with
      scoreFormat rendering, recent plays, Play button (§7.5 behavior).
- [ ] 13. Live activity rail + read strategy (§7.4): bounded per-block refresh,
      session caching, graceful degradation; unit tests for merge/bounds.
- [ ] 14. DotNS reverse name resolution + identicon/truncation fallback (§8.2).
- [ ] 15. Playwright: home renders listed games (chain mocked), filter chips,
      detail page leaderboard, Play link resolution in/out of host.

## Phase 5 — Content + rehearsal (SPEC §2.2)

- [ ] 16. Build 2–3 real games via the single-prompt flow; deploy + register
      on Paseo (the flow itself is the test — §10.1).
- [ ] 17. Dress rehearsal: fresh end-to-end run (prompt → listed game →
      visible on dashboard); fix what breaks; record results here.

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
