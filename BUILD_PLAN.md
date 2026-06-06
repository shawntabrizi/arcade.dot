# Build Plan — Polkadot Arcade (from SPEC.md, MVP cut §2)

Loop protocol: each iteration, take the **first unchecked item**, implement it
per the referenced SPEC.md sections, get its tests green, commit, check it off
(edit this file in the same commit). Never start an item with an earlier item
unchecked unless it's blocked — if blocked, note why here and move on.

Test gates: contracts → `cargo test`; template/dashboard logic → unit tests
(vitest); UI flows → Playwright. A checked item means its tests pass.

## Phase 1 — Contracts (SPEC §4, §5)

- [ ] 1. Contracts workspace: `contracts/registry` + `contracts/gcs-reference`
      (ink! on PolkaVM via `pvm_contract`, modeled on the prototype's toolchain),
      both compiling clean.
- [ ] 2. Arcade Registry per §5, with unit tests: caller-keyed register/update,
      unlist, length-cap reverts, enumeration + pagination edges (§4.3),
      `ListingChanged` event, `metaVersion`/timestamps stamping.
- [ ] 3. GCS v1 reference contract per §4, with unit tests: submitScore
      semantics (non-improving never reverts, counters always move), both
      score orderings, u128::MAX sentinel rule, top-100 insert/update/evict,
      tie-breaking (`at` asc, then insertion order), 20-slot recent ring,
      pagination edges, `ScoreSubmitted` event, `updateListing` owner gate +
      cross-contract `register` (registry address as constructor arg).
- [ ] 4. Deploy both to Paseo Asset Hub (paseo-next-v2); record addresses in
      `cdm.json`; verify reads back (§10.3 step 8 style).

## Phase 2 — Integration risk spikes (SPEC §2.3) — run early, results recorded here

- [ ] 5. Validate in-host dApp→dApp `.dot` navigation; record outcome + chosen
      fallback in this file under "Spike results".
- [ ] 6. Validate host-wallet signing round-trip from a game
      (SignerManager → ensureAccountMapped → submitScore) on paseo-next-v2.

## Phase 3 — Game template (SPEC §8, §10)

- [ ] 7. Rework identity: remove burner/faucet machinery; product-sdk
      SignerManager; guest mode (zero chain) + game-over "sign in to save your
      score" flow (§8.3); unit tests for the scoreboard layer.
- [ ] 8. `arcade.config.json` + pipeline scripts (§10.3 steps 5/7/8): thumbnail
      upload → CID, `updateListing` registration, verify script — all
      non-interactive, exiting non-zero with actionable messages.
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

(filled in by items 5–6)
