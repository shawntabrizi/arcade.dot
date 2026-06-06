//! Host-side unit tests for the GCS v1 reference contract.
//!
//! Same testability split as the registry's tests: the on-chain contract module
//! (`#[cfg(target_arch = "riscv64")]`) cannot run on the host, so these tests
//! target two surfaces:
//!
//! 1. The pure `logic` module directly (score improvement + sentinel rules,
//!    top-100 sorted insert/update/evict + tie-break, recent-ring slot math,
//!    pagination) — the code the spec pins down exactly.
//! 2. A faithful host re-implementation (`Game` below) of the storage-backed
//!    `submit_score` / `get_*` pieces the contract can only do on-chain. It
//!    mirrors `contracts/gcs-reference/lib.rs::contract` method-for-method
//!    against in-memory maps, so a test that fails here fails for the same
//!    reason the contract would. Keep it in sync with the contract.
//!
//! Each test states WHY the behavior matters, per the §4 clause it guards.

use super::logic::{self, BoardEntry};
use super::{
    Entry, ListingMetadata, ARCADE_VERSION, BOARD_CAP, MAX_PAGE_LIMIT, ORDERING_HIGHER_IS_BETTER,
    ORDERING_LOWER_IS_BETTER, RECENT_RING_SIZE,
};
use pvm_contract::Address;
use std::collections::HashMap;

// ----- helpers -----

fn addr(b: u8) -> Address {
    let mut bytes = [0u8; 20];
    bytes[19] = b;
    Address::from(bytes)
}

/// In-memory mirror of the contract's storage + the submit_score/read logic.
/// Substitutes `HashMap`s for `Mapping` and an explicit `caller`/`now` for the
/// host calls. Mirrors `lib.rs::contract` exactly; keep in sync.
struct Game {
    score_ordering: u8,
    // Module A counters
    play_count: u64,
    unique_players: u32,
    last_played_at: u64,
    has_played: HashMap<Address, bool>,
    // best map
    best: HashMap<Address, u128>,
    // sorted board + tie-break sequence
    board: Vec<BoardEntry>,
    board_seq: u64,
    // recent ring
    recent: HashMap<u32, Entry>,
    recent_total: u32,
    // emitted ScoreSubmitted events: (player, score, is_pb)
    events: Vec<(Address, u128, bool)>,
}

impl Game {
    fn new(score_ordering: u8) -> Self {
        Game {
            score_ordering,
            play_count: 0,
            unique_players: 0,
            last_played_at: 0,
            has_played: HashMap::new(),
            best: HashMap::new(),
            board: Vec::new(),
            board_seq: 0,
            recent: HashMap::new(),
            recent_total: 0,
            events: Vec::new(),
        }
    }

    /// Mirror of `submit_score(score)` called by `caller` at time `now`.
    fn submit_score(&mut self, caller: Address, score: u128, now: u64) {
        // always: counters
        self.play_count = self.play_count.saturating_add(1);
        self.last_played_at = now;
        if !self.has_played.get(&caller).copied().unwrap_or(false) {
            self.has_played.insert(caller, true);
            self.unique_players += 1;
        }
        // always: recent ring
        let slot = logic::recent_write_slot(self.recent_total, RECENT_RING_SIZE);
        self.recent.insert(
            slot,
            Entry {
                player: caller,
                score,
                at: now,
            },
        );
        self.recent_total += 1;
        // conditional: personal best
        let prev_best = match self.best.get(&caller).copied() {
            Some(v) => v,
            None => logic::default_best(self.score_ordering),
        };
        let is_pb = logic::is_improvement(self.score_ordering, prev_best, score);
        if is_pb {
            self.best.insert(caller, score);
            let next_seq = self.board_seq;
            let already = self.board.iter().any(|e| e.player == caller);
            let board = std::mem::take(&mut self.board);
            self.board = logic::board_apply_best(
                board,
                self.score_ordering,
                caller,
                score,
                now,
                next_seq,
                BOARD_CAP as usize,
            );
            if !already {
                self.board_seq += 1;
            }
        }
        self.events.push((caller, score, is_pb));
    }

    /// Mirror of `get_best(player)`.
    fn get_best(&self, player: Address) -> u128 {
        match self.best.get(&player).copied() {
            Some(v) => v,
            None => logic::default_best(self.score_ordering),
        }
    }

    fn leaderboard_size(&self) -> u32 {
        self.board.len() as u32
    }

    /// Mirror of `get_leaderboard(offset, limit)`.
    fn get_leaderboard(&self, offset: u32, limit: u32) -> Vec<Entry> {
        let count = self.board.len() as u32;
        let (start, end) = logic::page_bounds(count, offset, limit);
        (start..end).map(|i| self.board[i as usize].to_entry()).collect()
    }

    /// Mirror of `get_recent(offset, limit)`.
    fn get_recent(&self, offset: u32, limit: u32) -> Vec<Entry> {
        let total = self.recent_total;
        let count = logic::recent_len(total, RECENT_RING_SIZE);
        let (start, end) = logic::page_bounds(count, offset, limit);
        (start..end)
            .map(|i| {
                let slot = logic::recent_slot_for_index(total, RECENT_RING_SIZE, i);
                self.recent.get(&slot).cloned().unwrap()
            })
            .collect()
    }
}

// ===================== Module A: Activity (§4.1) =====================

#[test]
fn arcade_version_is_one() {
    // WHY: §4.1/§7.4 — the conformance gate keys on arcadeVersion()==1; this
    // document defines version 1. A change here silently de-lists every game.
    assert_eq!(ARCADE_VERSION, 1);
}

#[test]
fn counters_always_move_even_on_non_improving_score() {
    // WHY: §4.2 — "every play counts". A non-improving (or first) score still
    // increments playCount, moves lastPlayedAt, and a first-ever play by a
    // caller bumps uniquePlayers. submitScore MUST NOT revert.
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(1), 100, 10); // first play, PB
    g.submit_score(addr(1), 50, 20); // non-improving (lower in higher-is-better)
    g.submit_score(addr(1), 100, 30); // equal to best, non-improving
    assert_eq!(g.play_count, 3, "playCount increments on every submit");
    assert_eq!(g.last_played_at, 30, "lastPlayedAt always moves");
    assert_eq!(g.unique_players, 1, "same caller does not re-bump uniques");
}

#[test]
fn unique_players_counts_distinct_callers_once() {
    // WHY: §4.1 — uniquePlayers is the count of *distinct* players ever, bumped
    // on a caller's first-ever play only (independent of whether it's a PB).
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(1), 10, 1);
    g.submit_score(addr(2), 5, 2); // distinct, non-top score still counts
    g.submit_score(addr(1), 20, 3); // repeat caller, no new unique
    g.submit_score(addr(3), 7, 4);
    assert_eq!(g.unique_players, 3);
    assert_eq!(g.play_count, 4);
}

#[test]
fn last_played_at_zero_before_any_play() {
    // WHY: §4.1 — lastPlayedAt() is 0 if never played (the contract initializes
    // it to 0 in the constructor).
    let g = Game::new(ORDERING_HIGHER_IS_BETTER);
    assert_eq!(g.last_played_at, 0);
    assert_eq!(g.play_count, 0);
    assert_eq!(g.unique_players, 0);
}

// =============== Module B: score semantics + sentinel (§4.2) ===============

#[test]
fn higher_is_better_sentinel_and_improvement() {
    // WHY: §4.2 — for higher-is-better, "no score" is 0, and a strict increase
    // is an improvement; equal-or-lower is not.
    assert_eq!(logic::default_best(ORDERING_HIGHER_IS_BETTER), 0);
    assert!(logic::is_improvement(ORDERING_HIGHER_IS_BETTER, 0, 1));
    assert!(logic::is_improvement(ORDERING_HIGHER_IS_BETTER, 10, 11));
    assert!(!logic::is_improvement(ORDERING_HIGHER_IS_BETTER, 10, 10), "equal is not better");
    assert!(!logic::is_improvement(ORDERING_HIGHER_IS_BETTER, 10, 9));
}

#[test]
fn lower_is_better_sentinel_and_improvement() {
    // WHY: §4.2 — for lower-is-better, "no score" is u128::MAX (so no-score
    // never ranks), and a strict decrease is an improvement.
    assert_eq!(logic::default_best(ORDERING_LOWER_IS_BETTER), u128::MAX);
    assert!(logic::is_improvement(ORDERING_LOWER_IS_BETTER, u128::MAX, 100), "first real score beats sentinel");
    assert!(logic::is_improvement(ORDERING_LOWER_IS_BETTER, 100, 99));
    assert!(!logic::is_improvement(ORDERING_LOWER_IS_BETTER, 100, 100), "equal is not better");
    assert!(!logic::is_improvement(ORDERING_LOWER_IS_BETTER, 100, 101));
}

#[test]
fn u128_max_is_never_an_improvement_in_lower_is_better() {
    // WHY: §4.2 sentinel rule — u128::MAX is reserved as "no score", so
    // submitScore(u128::MAX) MUST be treated as non-improving even from the
    // sentinel default (otherwise "no score" would rank).
    assert!(!logic::is_improvement(ORDERING_LOWER_IS_BETTER, u128::MAX, u128::MAX));
    assert!(!logic::is_improvement(ORDERING_LOWER_IS_BETTER, 50, u128::MAX));
    // It still counts as a play, and getBest stays the sentinel.
    let mut g = Game::new(ORDERING_LOWER_IS_BETTER);
    g.submit_score(addr(1), u128::MAX, 1);
    assert_eq!(g.play_count, 1, "still a play");
    assert_eq!(g.get_best(addr(1)), u128::MAX, "best unchanged (sentinel)");
    assert_eq!(g.leaderboard_size(), 0, "u128::MAX never ranks");
    assert_eq!(g.events, vec![(addr(1), u128::MAX, false)], "not a PB");
}

#[test]
fn u128_max_is_a_valid_score_in_higher_is_better() {
    // WHY: the sentinel rule is specific to lower-is-better. In higher-is-better
    // the sentinel is 0, so u128::MAX is a perfectly valid (maximal) score and
    // IS an improvement.
    assert!(logic::is_improvement(ORDERING_HIGHER_IS_BETTER, 0, u128::MAX));
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(1), u128::MAX, 1);
    assert_eq!(g.get_best(addr(1)), u128::MAX);
    assert_eq!(g.leaderboard_size(), 1);
}

#[test]
fn get_best_returns_sentinel_for_unseen_player() {
    // WHY: §4.2 — getBest of a player with no submission returns the ordering's
    // sentinel, not a panic or a stored zero.
    let g_hi = Game::new(ORDERING_HIGHER_IS_BETTER);
    assert_eq!(g_hi.get_best(addr(42)), 0);
    let g_lo = Game::new(ORDERING_LOWER_IS_BETTER);
    assert_eq!(g_lo.get_best(addr(42)), u128::MAX);
}

#[test]
fn get_best_updates_only_on_strict_improvement() {
    // WHY: §4.2 — getBest tracks the personal best; a non-improving submit must
    // not regress or change it.
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(1), 50, 1);
    assert_eq!(g.get_best(addr(1)), 50);
    g.submit_score(addr(1), 30, 2); // worse
    assert_eq!(g.get_best(addr(1)), 50, "best not regressed");
    g.submit_score(addr(1), 80, 3); // better
    assert_eq!(g.get_best(addr(1)), 80);
}

// =================== leaderboard board mechanics (§4.2) ===================

fn players(entries: &[Entry]) -> Vec<u8> {
    entries.iter().map(|e| e.player.as_bytes()[19]).collect()
}

#[test]
fn board_sorts_best_first_both_orderings() {
    // WHY: §4.2 — getLeaderboard is sorted best-first. "Best" depends on
    // scoreOrdering: highest first for higher-is-better, lowest first for
    // lower-is-better.
    let mut hi = Game::new(ORDERING_HIGHER_IS_BETTER);
    hi.submit_score(addr(1), 10, 1);
    hi.submit_score(addr(2), 30, 2);
    hi.submit_score(addr(3), 20, 3);
    assert_eq!(players(&hi.get_leaderboard(0, 50)), vec![2, 3, 1]);

    let mut lo = Game::new(ORDERING_LOWER_IS_BETTER);
    lo.submit_score(addr(1), 10, 1);
    lo.submit_score(addr(2), 30, 2);
    lo.submit_score(addr(3), 20, 3);
    assert_eq!(players(&lo.get_leaderboard(0, 50)), vec![1, 3, 2]);
}

#[test]
fn board_one_entry_per_player_update_in_place() {
    // WHY: §4.2 — one entry per player (their personal best). A new PB updates
    // the player's existing entry (score AND at) and re-sorts; it does not add
    // a second row.
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(1), 10, 1);
    g.submit_score(addr(2), 50, 2);
    g.submit_score(addr(1), 60, 3); // addr(1) PB overtakes addr(2)
    assert_eq!(g.leaderboard_size(), 2, "still one row per player");
    let board = g.get_leaderboard(0, 50);
    assert_eq!(players(&board), vec![1, 2]);
    assert_eq!(board[0].score, 60);
    assert_eq!(board[0].at, 3, "at updated to the PB's timestamp");
}

#[test]
fn board_tiebreak_equal_score_orders_by_at_ascending() {
    // WHY: §4.2 — equal scores order by `at` ascending (earlier achievement
    // ranks higher).
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(1), 100, 50); // achieved later
    g.submit_score(addr(2), 100, 10); // achieved earlier -> ranks higher
    let board = g.get_leaderboard(0, 50);
    assert_eq!(players(&board), vec![2, 1]);
    assert_eq!(board[0].at, 10);
}

#[test]
fn board_tiebreak_equal_score_and_at_orders_by_insertion() {
    // WHY: §4.2 — equal `at` breaks by insertion order. Two players reaching the
    // same score at the same timestamp keep the order they first entered the
    // board (seq ascending), deterministically.
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(7), 100, 5); // entered board first (seq 0)
    g.submit_score(addr(3), 100, 5); // same score, same at; seq 1
    let board = g.get_leaderboard(0, 50);
    assert_eq!(players(&board), vec![7, 3], "first inserted ranks higher on full tie");
}

#[test]
fn board_pb_update_preserves_insertion_seq_for_tiebreak() {
    // WHY: §4.2 — a PB update keeps the player's original insertion order for
    // the equal-`at` tie-break (seq is preserved, not reassigned). Here both end
    // at score 100 / at 5; addr(7) entered the board first so must stay ahead
    // even though addr(3)'s qualifying PB came in a later transaction.
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(7), 40, 1); // seq 0
    g.submit_score(addr(3), 30, 2); // seq 1
    g.submit_score(addr(3), 100, 5); // PB update, seq stays 1
    g.submit_score(addr(7), 100, 5); // PB update, seq stays 0
    let board = g.get_leaderboard(0, 50);
    assert_eq!(players(&board), vec![7, 3]);
}

#[test]
fn board_caps_at_100_and_evicts_worst() {
    // WHY: §4.2 — the sorted board is capped at 100. A qualifying new entry
    // evicts the *worst* current entry when full. Evicted players keep getBest.
    assert_eq!(BOARD_CAP, 100);
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    // Fill 100 entries with scores 100..=199 (player i -> score 100+i).
    for i in 0..100u32 {
        g.submit_score(addr_u32(i), (100 + i) as u128, (i + 1) as u64);
    }
    assert_eq!(g.leaderboard_size(), 100);
    let worst_player = addr_u32(0); // score 100, the worst
    // A new player with a better-than-worst score qualifies and evicts player 0.
    g.submit_score(addr_u32(500), 250, 1000);
    assert_eq!(g.leaderboard_size(), 100, "still capped at 100");
    let board = g.get_leaderboard(0, 50);
    assert_eq!(board[0].player, addr_u32(500), "new top score ranks first");
    // Player 0 is off the board but getBest still tracks them (unbounded map).
    let on_board = (0..g.leaderboard_size())
        .flat_map(|_| g.get_leaderboard(0, 50).into_iter().chain(g.get_leaderboard(50, 50)))
        .any(|e| e.player == worst_player);
    assert!(!on_board, "worst entry evicted");
    assert_eq!(g.get_best(worst_player), 100, "evicted player keeps getBest");
}

#[test]
fn board_non_qualifying_score_when_full_does_not_evict() {
    // WHY: §4.2 — eviction happens only for a *qualifying* (improving + better
    // than the worst) entry. A new player whose best is worse than the current
    // worst on a full board never displaces anyone. (board_apply_best is only
    // reached on a strict PB; here the PB is real but ranks last and is
    // truncated, leaving the board membership unchanged.)
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    for i in 0..100u32 {
        g.submit_score(addr_u32(i), (100 + i) as u128, (i + 1) as u64);
    }
    let before = players_all(&g);
    g.submit_score(addr_u32(500), 1, 1000); // PB for 500, but worst of all
    assert_eq!(g.leaderboard_size(), 100);
    assert_eq!(players_all(&g), before, "membership unchanged");
    assert_eq!(g.get_best(addr_u32(500)), 1, "but their best is still tracked");
}

fn addr_u32(n: u32) -> Address {
    let mut bytes = [0u8; 20];
    bytes[16..20].copy_from_slice(&n.to_be_bytes());
    Address::from(bytes)
}

fn players_all(g: &Game) -> Vec<Address> {
    let mut out = g.get_leaderboard(0, 50);
    out.extend(g.get_leaderboard(50, 50));
    let mut ps: Vec<Address> = out.into_iter().map(|e| e.player).collect();
    ps.sort_by_key(|a| a.as_bytes().to_vec());
    ps
}

// ===================== recent ring (§4.2) =====================

#[test]
fn recent_ring_size_is_twenty() {
    // WHY: §4.2 — the recent ring is fixed at 20 slots.
    assert_eq!(RECENT_RING_SIZE, 20);
}

#[test]
fn recent_newest_first_includes_non_best_submissions() {
    // WHY: §4.2 — getRecent is newest-first and includes ALL plays, not just
    // bests (it powers activity feeds).
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(1), 100, 1); // PB
    g.submit_score(addr(1), 5, 2); // non-best, must still appear
    g.submit_score(addr(2), 50, 3);
    let recent = g.get_recent(0, 50);
    // newest first: (2,50,@3), (1,5,@2), (1,100,@1)
    assert_eq!(recent.len(), 3);
    assert_eq!((recent[0].player, recent[0].score, recent[0].at), (addr(2), 50, 3));
    assert_eq!((recent[1].player, recent[1].score, recent[1].at), (addr(1), 5, 2));
    assert_eq!((recent[2].player, recent[2].score, recent[2].at), (addr(1), 100, 1));
}

#[test]
fn recent_ring_wraps_at_twenty_keeping_last_twenty_newest_first() {
    // WHY: §4.2 — the ring is bounded at 20; after >20 submissions it holds only
    // the most recent 20, still newest-first. This guards the wrap arithmetic
    // (recent_write_slot / recent_slot_for_index / recent_len).
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    for i in 1..=25u64 {
        // distinct players so each is a PB too; score increasing.
        g.submit_score(addr((i % 200) as u8), i as u128, i);
    }
    let recent = g.get_recent(0, 50);
    assert_eq!(recent.len(), 20, "ring holds at most 20");
    // Newest is the 25th submission (at=25), then 24, ... down to 6.
    assert_eq!(recent[0].at, 25);
    assert_eq!(recent[19].at, 6);
    // Strictly descending timestamps (newest-first), no gaps.
    for w in recent.windows(2) {
        assert_eq!(w[0].at, w[1].at + 1);
    }
}

#[test]
fn recent_len_and_slot_math() {
    // WHY: pins the ring helpers directly. Before wrap, len == total; after,
    // len == size. Next write slot is total % size; newest index 0 maps to
    // (total-1) % size.
    assert_eq!(logic::recent_len(5, 20), 5);
    assert_eq!(logic::recent_len(25, 20), 20);
    assert_eq!(logic::recent_write_slot(0, 20), 0);
    assert_eq!(logic::recent_write_slot(20, 20), 0);
    assert_eq!(logic::recent_write_slot(21, 20), 1);
    assert_eq!(logic::recent_slot_for_index(21, 20, 0), 0, "newest is slot (21-1)%20");
    assert_eq!(logic::recent_slot_for_index(21, 20, 1), 19);
}

// ===================== pagination (§4.3) =====================

#[test]
fn page_bounds_basic_window_and_partial_tail() {
    // WHY: §4.3 — half-open [offset, offset+limit); partial tail clamps to count.
    assert_eq!(logic::page_bounds(10, 2, 3), (2, 5));
    assert_eq!(logic::page_bounds(5, 3, 10), (3, 5));
}

#[test]
fn page_bounds_offset_past_end_and_zero_limit_never_revert() {
    // WHY: §4.3 — out-of-range offset returns empty (never reverts); limit 0
    // returns empty.
    assert_eq!(logic::page_bounds(5, 5, 10), (5, 5));
    assert_eq!(logic::page_bounds(5, 99, 10), (5, 5));
    assert_eq!(logic::page_bounds(0, 0, 10), (0, 0));
    assert_eq!(logic::page_bounds(5, 0, 0), (0, 0));
}

#[test]
fn page_bounds_caps_at_or_above_fifty() {
    // WHY: §4.3 — the cap MUST be >= 50; at/below the cap honored exactly, above
    // clamps to the cap.
    assert!(MAX_PAGE_LIMIT >= 50);
    assert_eq!(logic::page_bounds(1000, 0, u32::MAX), (0, MAX_PAGE_LIMIT));
    assert_eq!(logic::page_bounds(1000, 0, MAX_PAGE_LIMIT), (0, MAX_PAGE_LIMIT));
    assert_eq!(logic::page_bounds(1000, 0, MAX_PAGE_LIMIT - 1), (0, MAX_PAGE_LIMIT - 1));
}

#[test]
fn leaderboard_and_recent_paginate_without_reverting() {
    // WHY: §4.3 applies to both getLeaderboard and getRecent — paging past the
    // end yields empty, mid-range yields a window.
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    for i in 1..=5u32 {
        g.submit_score(addr(i as u8), (i * 10) as u128, i as u64);
    }
    assert_eq!(g.get_leaderboard(2, 2).len(), 2);
    assert_eq!(g.get_leaderboard(10, 5).len(), 0, "past end is empty, not a revert");
    assert_eq!(g.get_recent(2, 2).len(), 2);
    assert_eq!(g.get_recent(10, 5).len(), 0);
}

// ===================== ScoreSubmitted event (§4.2) =====================

#[test]
fn event_emitted_on_every_submit_with_correct_pb_flag() {
    // WHY: §4.2 — ScoreSubmitted fires on EVERY submitScore (the realtime
    // signal), carrying (player, score, isPersonalBest). The flag is true only
    // on a strict PB.
    let mut g = Game::new(ORDERING_HIGHER_IS_BETTER);
    g.submit_score(addr(1), 100, 1); // PB
    g.submit_score(addr(1), 50, 2); // not PB
    g.submit_score(addr(1), 150, 3); // PB
    assert_eq!(
        g.events,
        vec![(addr(1), 100, true), (addr(1), 50, false), (addr(1), 150, true)]
    );
}

#[test]
fn keccak_helper_matches_known_registry_topic() {
    // WHY: this test's keccak256 is the trust anchor for the event-topic test
    // below. Cross-check it against the registry's independently-pinned
    // ListingChanged digest (contracts/registry/tests.rs) so we know the helper
    // computes Ethereum keccak-256 correctly before relying on it.
    assert_eq!(
        hex(&keccak256(b"ListingChanged(address)")),
        "294e909971e56fb0e171c5ef8443d2d9ebcdbcdfbc7e087ecac3181b64cd1b97"
    );
}

#[test]
fn score_submitted_topic_is_keccak_of_signature() {
    // WHY: the indexed event topic0 the dashboard subscribes to is
    // keccak256("ScoreSubmitted(address,uint128,bool)"). The arg list is
    // (address indexed player, uint128 score, bool isPersonalBest) — the
    // canonical signature drops `indexed` and uses ABI type names. This pins the
    // concrete digest so any signature change (wrong arg type/order, renamed
    // event) that would silently break dashboard subscriptions fails loudly.
    // The keccak helper is validated by `keccak_helper_matches_known_registry_topic`.
    let got = hex(&keccak256(b"ScoreSubmitted(address,uint128,bool)"));
    assert_eq!(got, KNOWN_SCORE_SUBMITTED_TOPIC);
}

/// keccak256("ScoreSubmitted(address,uint128,bool)"). Pinned; verified by the
/// in-test keccak (itself cross-checked against the registry's known digest).
const KNOWN_SCORE_SUBMITTED_TOPIC: &str =
    "860916283ae2e9eee2b7aa65ba521da02a25980e6ea2ac8b2d777f728aa9f19a";

// ===================== updateListing owner gate (§4.4) =====================

/// The §4.4 owner gate, mirrored as pure logic: the contract reverts unless
/// `caller() == owner`. We test the predicate the contract uses.
fn update_listing_allowed(owner: Address, caller: Address) -> bool {
    caller == owner
}

fn sample_meta() -> ListingMetadata {
    ListingMetadata {
        name: "Snake".into(),
        game_type: "arcade".into(),
        short_description: "classic".into(),
        play_url: "snake.dot".into(),
        thumbnail_cid: String::new(),
        requires_account: false,
        extra_cid: String::new(),
    }
}

#[test]
fn update_listing_gated_to_owner() {
    // WHY: §4.4 — the reference gates updateListing to caller()==owner (the
    // deployer captured in the constructor). The owner may call it; a non-owner
    // is rejected (the contract panics/reverts).
    let owner = addr(1);
    let _ = sample_meta(); // the meta is forwarded verbatim; gate is the concern here
    assert!(update_listing_allowed(owner, owner), "owner allowed");
    assert!(!update_listing_allowed(owner, addr(2)), "non-owner rejected");
}

// ----- minimal keccak-256 for the topic test (host-only) -----
// Identical to the registry's test helper (the Ethereum variant, 0x01 padding).

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn keccak256(msg: &[u8]) -> [u8; 32] {
    const RC: [u64; 24] = [
        0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
        0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
        0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
        0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
        0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
        0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
    ];
    let rotl = |x: u64, n: u32| x.rotate_left(n);
    let mut st = [0u64; 25];
    let rate = 136usize;
    let mut data = msg.to_vec();
    data.push(0x01);
    while data.len() % rate != 0 {
        data.push(0);
    }
    let n = data.len();
    data[n - 1] ^= 0x80;
    let mut off = 0;
    while off < data.len() {
        for i in 0..(rate / 8) {
            let mut w = [0u8; 8];
            w.copy_from_slice(&data[off + i * 8..off + i * 8 + 8]);
            st[i] ^= u64::from_le_bytes(w);
        }
        for rnd in 0..24 {
            let mut c = [0u64; 5];
            for x in 0..5 {
                c[x] = st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20];
            }
            let mut d = [0u64; 5];
            for x in 0..5 {
                d[x] = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
            }
            for x in 0..5 {
                for y in 0..5 {
                    st[x + 5 * y] ^= d[x];
                }
            }
            let (mut x, mut y) = (1usize, 0usize);
            let mut cur = st[1];
            for t in 0..24u32 {
                let nx = y;
                let ny = (2 * x + 3 * y) % 5;
                x = nx;
                y = ny;
                let idx = x + 5 * y;
                let tmp = st[idx];
                st[idx] = rotl(cur, ((t + 1) * (t + 2) / 2) % 64);
                cur = tmp;
            }
            for y in 0..5 {
                let mut t = [0u64; 5];
                for x in 0..5 {
                    t[x] = st[x + 5 * y];
                }
                for x in 0..5 {
                    st[x + 5 * y] = t[x] ^ ((!t[(x + 1) % 5]) & t[(x + 2) % 5]);
                }
            }
            st[0] ^= RC[rnd];
        }
        off += rate;
    }
    let mut out = [0u8; 32];
    for i in 0..4 {
        out[i * 8..i * 8 + 8].copy_from_slice(&st[i].to_le_bytes());
    }
    out
}
