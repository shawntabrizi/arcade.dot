// Game Contract Standard (GCS) v1 reference implementation (SPEC §4).
//
// A game contract is the sole source of truth for its game's stats (§4). The
// dashboard reads any conforming contract generically. This is the canonical
// reference a game dev deploys unmodified to get full GCS v1 compliance (§4.6);
// it is a rewrite of the prototype's `leaderboard` contract, not an extension.
//
// Two modules, both required in v1 (§4):
//   - Module A / Activity (§4.1): arcadeVersion, playCount, uniquePlayers,
//     lastPlayedAt — universal discovery/health stats, updated by submitScore.
//   - Module B / Leaderboard (§4.2): scoreOrdering/scoreFormat/scoreUnit
//     (constructor-fixed constants), getBest, leaderboardSize, getLeaderboard
//     (sorted top-100), getRecent (20-slot ring), and submitScore (the only
//     write). Listing management (§4.4): updateListing forwards metadata
//     verbatim to the Arcade Registry cross-contract.
//
// Modeled on the sibling Arcade Registry (`contracts/registry/lib.rs`) and the
// prototype toolchain (ink! on PolkaVM via `pvm_contract`, Solidity-compatible
// ABI via pallet_revive). Same testability split as the registry: the pure
// decision logic the spec pins down (score improvement + sentinel rules,
// top-100 sorted insert/evict/tie-break, recent-ring slot math, pagination)
// lives in the target-independent `logic` module so it is unit-testable on the
// host with `cargo test`; the `#[cfg(target_arch = "riscv64")]` contract module
// is a thin binding of that logic to storage, `caller()`, and `now()`.
#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]

// See the registry's note: the SolAbi/Encode/Decode derives reference `alloc::`
// paths, so `alloc` must be linkable on every target including the host test
// build (where it re-exports std's allocator).
extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use pvm_contract as pvm;

/// Standard version implemented (§4.1). The dashboard's conformance gate (§7.4)
/// reads `arcadeVersion()` and skips anything that is not `1`.
pub const ARCADE_VERSION: u32 = 1;

/// `scoreOrdering()` values (§4.2). Constant for the contract's lifetime.
pub const ORDERING_HIGHER_IS_BETTER: u8 = 0;
pub const ORDERING_LOWER_IS_BETTER: u8 = 1;

/// Sorted leaderboard capacity (§4.2: "capped at 100 entries"). Insertion cost
/// falls on the score-submitting write so reads stay O(limit). The best-score
/// map is unbounded; only this sorted board is capped (evicted players keep
/// `getBest`).
pub const BOARD_CAP: u32 = 100;

/// Recent-plays ring size (§4.2: "the last 20 submissions"). All plays, not
/// just bests; powers activity feeds.
pub const RECENT_RING_SIZE: u32 = 20;

/// Pagination limit cap (§4.3). The convention permits a cap of the contract's
/// choosing so long as it is >= 50; we cap at exactly the minimum, matching the
/// registry.
pub const MAX_PAGE_LIMIT: u32 = 50;

/// A leaderboard / recent-ring entry as exposed over the ABI (§4.2:
/// `Entry = { player, score, at }`). Field order is the ABI tuple order; do not
/// reorder.
#[derive(pvm::SolAbi, pvm::Encode, pvm::Decode, Clone, PartialEq, Debug)]
pub struct Entry {
    pub player: pvm::Address,
    pub score: u128,
    pub at: u64,
}

/// Metadata a game contract forwards verbatim to the registry's `register`
/// (§4.4, §5.1). Identical shape to the registry's `ListingMetadata` — the
/// game contract is a passthrough. Field order is the ABI tuple order and MUST
/// match the registry's tuple exactly (the cross-contract selector is computed
/// from it); do not reorder.
#[derive(pvm::SolAbi, pvm::Encode, pvm::Decode, Clone)]
pub struct ListingMetadata {
    pub name: String,
    pub game_type: String,
    pub short_description: String,
    pub play_url: String,
    pub thumbnail_cid: String,
    pub requires_account: bool,
    pub extra_cid: String,
}

/// Pure decision logic, independent of storage/`caller()`/`now()` so it can be
/// unit-tested on the host. Everything the spec pins down exactly lives here;
/// the contract methods bind it to storage. The leaderboard board is modeled as
/// a plain `Vec<BoardEntry>` kept sorted best-first — simple and correct over
/// clever, as the build plan directs.
pub mod logic {
    use super::*;

    /// Internal board entry: the public `Entry` fields plus a monotonic
    /// insertion sequence number used only for tie-breaking (§4.2: "equal `at`
    /// by insertion order"). `seq` is assigned when a player first enters the
    /// board and never exposed over the ABI.
    #[derive(Clone, PartialEq, Debug)]
    pub struct BoardEntry {
        pub player: pvm::Address,
        pub score: u128,
        pub at: u64,
        pub seq: u64,
    }

    impl BoardEntry {
        pub fn to_entry(&self) -> Entry {
            Entry {
                player: self.player,
                score: self.score,
                at: self.at,
            }
        }
    }

    /// The `getBest` sentinel for a player with no submission (§4.2):
    /// `0` for higher-is-better, `u128::MAX` for lower-is-better (so "no score"
    /// never ranks).
    pub fn default_best(ordering: u8) -> u128 {
        if ordering == ORDERING_LOWER_IS_BETTER {
            u128::MAX
        } else {
            0
        }
    }

    /// Whether `score` strictly beats the caller's current `prev_best` under
    /// `ordering` (§4.2). `prev_best` is the stored best, or `default_best` if
    /// the player has never scored.
    ///
    /// - Higher-is-better: improvement iff `score > prev_best`.
    /// - Lower-is-better: improvement iff `score < prev_best`, AND `score` is
    ///   not the `u128::MAX` sentinel — `submitScore(u128::MAX)` MUST be treated
    ///   as non-improving (it still counts as a play), so "no score" never ranks
    ///   and the sentinel is never a valid score (§4.2 sentinel rule).
    pub fn is_improvement(ordering: u8, prev_best: u128, score: u128) -> bool {
        if ordering == ORDERING_LOWER_IS_BETTER {
            score != u128::MAX && score < prev_best
        } else {
            score > prev_best
        }
    }

    /// Total ordering key for sorting the board best-first (§4.2). Returns a
    /// tuple compared ascending, so the *front* of the sorted vec is rank 1:
    ///
    /// - primary: the score, transformed so "better" sorts first — identity for
    ///   higher-is-better (largest first via `Reverse`-style negation below),
    ///   so we instead return a key the caller sorts ascending.
    /// - secondary: `at` ascending (earlier achievement ranks higher).
    /// - tertiary: `seq` ascending (insertion order).
    ///
    /// To keep one comparator for both orderings we map the score to a
    /// "badness" value where smaller = better: for higher-is-better that is
    /// `u128::MAX - score`; for lower-is-better it is `score` itself. Sorting
    /// ascending on `(badness, at, seq)` then yields best-first.
    pub fn sort_key(ordering: u8, e: &BoardEntry) -> (u128, u64, u64) {
        let badness = if ordering == ORDERING_LOWER_IS_BETTER {
            e.score
        } else {
            u128::MAX - e.score
        };
        (badness, e.at, e.seq)
    }

    /// Apply a personal-best entry to the sorted board (§4.2). Caller has
    /// already established (via `is_improvement`) that this is a strict PB; this
    /// function maintains the bounded sorted top-N invariant:
    ///
    /// - **One entry per player**: if the player is already on the board, update
    ///   their entry in place (score AND `at`), preserving their original `seq`;
    ///   otherwise append a new entry carrying `new_seq`.
    /// - **Re-sort** best-first with the §4.2 tie-break (`at` asc, then
    ///   insertion order) via `sort_key`.
    /// - **Eviction**: if the board now exceeds `cap`, drop the worst entry
    ///   (the last after sorting). A non-improving score never reaches here, so
    ///   eviction only ever removes a strictly-worse entry than the newcomer.
    ///
    /// `board` is taken sorted and returned sorted. `new_seq` is ignored when
    /// the player already has an entry.
    pub fn board_apply_best(
        mut board: Vec<BoardEntry>,
        ordering: u8,
        player: pvm::Address,
        score: u128,
        at: u64,
        new_seq: u64,
        cap: usize,
    ) -> Vec<BoardEntry> {
        match board.iter_mut().find(|e| e.player == player) {
            Some(existing) => {
                existing.score = score;
                existing.at = at;
                // seq preserved — insertion order is stable across PB updates.
            }
            None => {
                board.push(BoardEntry {
                    player,
                    score,
                    at,
                    seq: new_seq,
                });
            }
        }
        board.sort_by_key(|e| sort_key(ordering, e));
        if board.len() > cap {
            board.truncate(cap);
        }
        board
    }

    /// Clamp a paginated request to the half-open window actually served
    /// (§4.3), identical to the registry's `page_bounds`. Returns `(start, end)`
    /// indices such that the served slice is `[start, end)`:
    ///
    /// - `offset` is 0-based; `offset >= count` yields an empty window (never
    ///   reverts).
    /// - `limit` is capped at `MAX_PAGE_LIMIT`; requests at or below the cap are
    ///   honored exactly. `limit == 0` yields an empty window.
    /// - `end` never exceeds `count`, so a partial tail returns fewer items.
    pub fn page_bounds(count: u32, offset: u32, limit: u32) -> (u32, u32) {
        if offset >= count {
            return (count, count);
        }
        let capped = if limit > MAX_PAGE_LIMIT {
            MAX_PAGE_LIMIT
        } else {
            limit
        };
        let remaining = count - offset;
        let take = if capped > remaining { remaining } else { capped };
        (offset, offset + take)
    }

    /// The ring slot the next submission writes to (§4.2). The ring holds the
    /// last `RECENT_RING_SIZE` submissions; `total` is the monotonic count of
    /// all submissions ever, so the next write slot is `total % size`.
    pub fn recent_write_slot(total: u32, size: u32) -> u32 {
        total % size
    }

    /// The number of entries currently live in the ring given `total`
    /// submissions ever: `min(total, size)`.
    pub fn recent_len(total: u32, size: u32) -> u32 {
        if total < size {
            total
        } else {
            size
        }
    }

    /// Map a 0-based newest-first index `i` (0 = most recent) to the physical
    /// ring slot, given `total` submissions ever (§4.2: "newest-first"). The
    /// most recent submission lives at `(total - 1) % size`; walking back
    /// subtracts `i`. Caller guarantees `i < recent_len(total, size)`.
    pub fn recent_slot_for_index(total: u32, size: u32, i: u32) -> u32 {
        // total >= 1 and i < min(total, size), so (total - 1 - i) does not wrap.
        (total - 1 - i) % size
    }
}

/// On-chain contract. Compiled only for the PolkaVM target (`pvm::storage`,
/// `caller()`, `call_evm`, the macro-generated `deploy`/`call` entry points
/// exist only there). The host `cargo test` build excludes this module and
/// exercises `logic` directly.
#[cfg(target_arch = "riscv64")]
mod contract {
    use super::logic::{self, BoardEntry};
    use super::{
        Entry, ListingMetadata, ARCADE_VERSION, BOARD_CAP, RECENT_RING_SIZE,
    };
    // NOTE: the `#[pvm::contract]` macro injects `use alloc::vec::Vec;` itself,
    // so do not re-import Vec here.
    use pvm::storage::Mapping;
    use pvm::HostFn as _;
    use pvm_contract as pvm;

    /// Canonical Solidity signature of §4.2's
    /// `ScoreSubmitted(player, score, isPersonalBest)` event. `player` is the
    /// only indexed argument (so the dashboard can filter by player); `score`
    /// and `isPersonalBest` are non-indexed data. Its keccak256 is the event's
    /// topic0; we hash it at runtime via the host so there is no magic constant
    /// to drift. The unit test `score_submitted_topic_is_keccak_of_signature`
    /// pins the value (keccak256 =
    /// 0x860916283ae2e9eee2b7aa65ba521da02a25980e6ea2ac8b2d777f728aa9f19a;
    /// computed independently in the test).
    const SCORE_SUBMITTED_SIG: &[u8] = b"ScoreSubmitted(address,uint128,bool)";

    /// Persisted form of a leaderboard entry: the public fields plus the
    /// internal tie-break sequence (§4.2). Stored in an indexed map; projected
    /// to `Entry` on read.
    #[derive(pvm::SolAbi, pvm::Encode, pvm::Decode, Clone)]
    struct StoredBoardEntry {
        player: pvm::Address,
        score: u128,
        at: u64,
        seq: u64,
    }

    #[pvm::storage]
    struct Storage {
        // ---- Module B config (constructor-fixed constants, §4.2) ----
        registry: pvm::Address,
        owner: pvm::Address,
        score_ordering: u8,
        score_format: u8,
        score_unit: alloc::string::String,

        // ---- Module A counters (§4.1) ----
        play_count: u64,
        unique_players: u32,
        last_played_at: u64,
        has_played: Mapping<pvm::Address, bool>,

        // ---- best-score map (unbounded; §4.2) ----
        best: Mapping<pvm::Address, u128>,
        // Whether `best[player]` has been set at least once. Distinguishes a
        // never-scored player (return the sentinel) from one whose stored best
        // legitimately equals the sentinel default.
        best_set: Mapping<pvm::Address, bool>,

        // ---- sorted top-100 board (§4.2), stored as an indexed vec ----
        // `board_at[i]` is the i-th entry in best-first order; `board_size` is
        // the live count (<= BOARD_CAP). Rewritten wholesale on each PB.
        board_at: Mapping<u32, StoredBoardEntry>,
        board_size: u32,
        // Monotonic counter assigning each player's first-on-board `seq`.
        board_seq: u64,

        // ---- recent-plays ring (§4.2) ----
        recent_at: Mapping<u32, Entry>,
        recent_total: u32,
    }

    #[pvm::contract(cdm = "@arcade/gcs-reference")]
    mod gcs_reference {
        use super::*;

        /// Constructor (§4.4): the registry address is injected by the deploy
        /// pipeline; `owner` is captured as the deployer (`caller()`) for the
        /// `updateListing` gate; the score semantics are fixed for the
        /// contract's lifetime (§4.2).
        #[pvm::constructor]
        pub fn new(
            registry: pvm::Address,
            score_ordering: u8,
            score_format: u8,
            score_unit: alloc::string::String,
        ) -> Result<(), Error> {
            Storage::registry().set(&registry);
            Storage::owner().set(&pvm::caller());
            Storage::score_ordering().set(&score_ordering);
            Storage::score_format().set(&score_format);
            Storage::score_unit().set(&score_unit);

            Storage::play_count().set(&0);
            Storage::unique_players().set(&0);
            Storage::last_played_at().set(&0);
            Storage::board_size().set(&0);
            Storage::board_seq().set(&0);
            Storage::recent_total().set(&0);
            Ok(())
        }

        // ===================== Module A: Activity (§4.1) =====================

        #[pvm::method]
        pub fn arcade_version() -> u32 {
            ARCADE_VERSION
        }

        #[pvm::method]
        pub fn play_count() -> u64 {
            Storage::play_count().get().unwrap_or(0)
        }

        #[pvm::method]
        pub fn unique_players() -> u32 {
            Storage::unique_players().get().unwrap_or(0)
        }

        #[pvm::method]
        pub fn last_played_at() -> u64 {
            Storage::last_played_at().get().unwrap_or(0)
        }

        // =================== Module B: Leaderboard (§4.2) ===================

        #[pvm::method]
        pub fn score_ordering() -> u8 {
            Storage::score_ordering().get().unwrap_or(0)
        }

        #[pvm::method]
        pub fn score_format() -> u8 {
            Storage::score_format().get().unwrap_or(0)
        }

        #[pvm::method]
        pub fn score_unit() -> alloc::string::String {
            Storage::score_unit().get().unwrap_or_default()
        }

        /// The player's personal best, or the ordering's sentinel if they have
        /// never scored (§4.2): `0` for higher-is-better, `u128::MAX` for
        /// lower-is-better.
        #[pvm::method]
        pub fn get_best(player: pvm::Address) -> u128 {
            match Storage::best().get(&player) {
                Some(v) => v,
                None => logic::default_best(Storage::score_ordering().get().unwrap_or(0)),
            }
        }

        #[pvm::method]
        pub fn leaderboard_size() -> u32 {
            Storage::board_size().get().unwrap_or(0)
        }

        /// Sorted best-first, paginated per §4.3. Never reverts on out-of-range
        /// offsets.
        #[pvm::method]
        pub fn get_leaderboard(offset: u32, limit: u32) -> Vec<Entry> {
            let count = Storage::board_size().get().unwrap_or(0);
            let (start, end) = logic::page_bounds(count, offset, limit);
            let mut out = Vec::new();
            let mut i = start;
            while i < end {
                if let Some(e) = Storage::board_at().get(&i) {
                    out.push(Entry {
                        player: e.player,
                        score: e.score,
                        at: e.at,
                    });
                }
                i += 1;
            }
            out
        }

        /// Most recent submissions, newest-first, from the 20-slot ring (§4.2).
        /// Includes non-best submissions. Paginated per §4.3 over the live ring
        /// length.
        #[pvm::method]
        pub fn get_recent(offset: u32, limit: u32) -> Vec<Entry> {
            let total = Storage::recent_total().get().unwrap_or(0);
            let count = logic::recent_len(total, RECENT_RING_SIZE);
            let (start, end) = logic::page_bounds(count, offset, limit);
            let mut out = Vec::new();
            let mut i = start;
            while i < end {
                let slot = logic::recent_slot_for_index(total, RECENT_RING_SIZE, i);
                if let Some(e) = Storage::recent_at().get(&slot) {
                    out.push(e);
                }
                i += 1;
            }
            out
        }

        /// Record a play by `caller()` (§4.2). MUST NOT revert on a non-improving
        /// score — every play counts. Always: increments `playCount`, updates
        /// `lastPlayedAt`, appends to the recent ring, and bumps `uniquePlayers`
        /// on the caller's first-ever play. On a strict personal best (per
        /// `scoreOrdering`; `u128::MAX` is never an improvement in
        /// lower-is-better — §4.2 sentinel rule): updates the best map and the
        /// sorted top-100 board. Emits `ScoreSubmitted` on every call.
        #[pvm::method]
        pub fn submit_score(score: u128) {
            let player = pvm::caller();
            let now = block_timestamp();
            let ordering = Storage::score_ordering().get().unwrap_or(0);

            // --- always: counters ---
            let plays = Storage::play_count().get().unwrap_or(0);
            Storage::play_count().set(&plays.saturating_add(1));
            Storage::last_played_at().set(&now);

            if !Storage::has_played().get(&player).unwrap_or(false) {
                Storage::has_played().insert(&player, &true);
                let uniques = Storage::unique_players().get().unwrap_or(0);
                Storage::unique_players().set(&(uniques + 1));
            }

            // --- always: recent ring (all plays, not just bests) ---
            let total = Storage::recent_total().get().unwrap_or(0);
            let slot = logic::recent_write_slot(total, RECENT_RING_SIZE);
            Storage::recent_at().insert(
                &slot,
                &Entry {
                    player,
                    score,
                    at: now,
                },
            );
            Storage::recent_total().set(&(total + 1));

            // --- conditional: personal best ---
            let prev_best = match Storage::best().get(&player) {
                Some(v) => v,
                None => logic::default_best(ordering),
            };
            let is_pb = logic::is_improvement(ordering, prev_best, score);
            if is_pb {
                Storage::best().insert(&player, &score);
                Storage::best_set().insert(&player, &true);
                apply_best_to_board(ordering, player, score, now);
            }

            emit_score_submitted(player, score, is_pb);
        }

        // ===================== Listing management (§4.4) ====================

        /// Forward `meta` verbatim to the Arcade Registry's `register` via a
        /// cross-contract call (§4.4, §5.2), gated `caller() == owner`. The
        /// registry keys the listing by *this contract's* address (the caller
        /// of `register` is this contract), so the game lists itself. Reverts if
        /// the caller is not the owner, or if the registry call reverts.
        #[pvm::method]
        pub fn update_listing(meta: ListingMetadata) {
            if pvm::caller() != Storage::owner().get().unwrap_or_default() {
                panic!("NotOwner");
            }
            let registry = Storage::registry().get().unwrap_or_default();
            register_with_registry(registry, &meta);
        }
    }

    /// Rewrite the sorted board after a confirmed personal best (§4.2). Reads
    /// the current board into a `Vec`, applies the §4.2 insert/update/evict +
    /// tie-break rules via `logic::board_apply_best`, then writes it back. O(N)
    /// in the board size (<= BOARD_CAP = 100) — paid by the submitting player,
    /// as the spec intends.
    fn apply_best_to_board(ordering: u8, player: pvm::Address, score: u128, at: u64) {
        let size = Storage::board_size().get().unwrap_or(0);
        let mut board: Vec<BoardEntry> = Vec::new();
        let mut i = 0u32;
        while i < size {
            if let Some(e) = Storage::board_at().get(&i) {
                board.push(BoardEntry {
                    player: e.player,
                    score: e.score,
                    at: e.at,
                    seq: e.seq,
                });
            }
            i += 1;
        }

        // Assign the next insertion sequence; only consumed if this is a new
        // (not already-present) player, but bumping unconditionally keeps `seq`
        // strictly monotonic and is harmless.
        let next_seq = Storage::board_seq().get().unwrap_or(0);
        let already_present = board.iter().any(|e| e.player == player);

        let updated = logic::board_apply_best(
            board,
            ordering,
            player,
            score,
            at,
            next_seq,
            BOARD_CAP as usize,
        );
        if !already_present {
            Storage::board_seq().set(&(next_seq + 1));
        }

        // Write back the new sorted board. The board only ever grows toward the
        // cap or stays the same size (a PB by an on-board player), so writing
        // `0..new_len` and removing any tail beyond it covers eviction too.
        let new_len = updated.len() as u32;
        let mut j = 0u32;
        for e in &updated {
            Storage::board_at().insert(
                &j,
                &StoredBoardEntry {
                    player: e.player,
                    score: e.score,
                    at: e.at,
                    seq: e.seq,
                },
            );
            j += 1;
        }
        // Clear any now-unused tail slots (only possible if the board shrank,
        // which it never does here, but keep the invariant tight).
        let mut k = new_len;
        while k < size {
            Storage::board_at().remove(&k);
            k += 1;
        }
        Storage::board_size().set(&new_len);
    }

    /// Emit `ScoreSubmitted(player, score, isPersonalBest)` (§4.2). `player` is
    /// indexed (left-padded to 32 bytes as topic1); `score` (u128) and
    /// `isPersonalBest` (bool) are the non-indexed data, each a 32-byte
    /// big-endian word in declaration order — the standard Solidity event
    /// encoding the dashboard can subscribe to.
    fn emit_score_submitted(player: pvm::Address, score: u128, is_personal_best: bool) {
        let mut sig_topic = [0u8; 32];
        pvm::api::hash_keccak_256(SCORE_SUBMITTED_SIG, &mut sig_topic);
        let mut player_topic = [0u8; 32];
        player_topic[12..32].copy_from_slice(player.as_bytes());
        let topics = [sig_topic, player_topic];

        let mut data = [0u8; 64];
        data[16..32].copy_from_slice(&score.to_be_bytes());
        data[63] = if is_personal_best { 1 } else { 0 };

        pvm::api::deposit_event(&topics, &data);
    }

    /// Cross-contract call into the Arcade Registry's
    /// `register(meta: ListingMetadata)` (§5.2). The registry's `register` takes
    /// a single dynamic tuple argument; the `abi_import!` macro cannot encode a
    /// top-level dynamic-tuple parameter (it panics at expansion), so we build
    /// the calldata by hand: selector ++ head-offset(0x20) ++ the tuple's ABI
    /// encoding. `ListingMetadata` derives `SolAbi`, whose `abi_encode` produces
    /// exactly the dynamic-tuple body the registry decodes. The selector is
    /// keccak256("register((string,string,string,string,string,bool,string))"),
    /// computed from `ListingMetadata::SOL_NAME` so it cannot drift from the
    /// type. Reverts (propagates) if the registry call fails.
    fn register_with_registry(registry: pvm::Address, meta: &ListingMetadata) {
        use pvm::SolAbi as _;

        let selector =
            pvm::compute_selector("register", &[<ListingMetadata as pvm::SolAbi>::SOL_NAME]);

        let mut calldata: Vec<u8> = Vec::new();
        calldata.extend_from_slice(&selector);
        // Single dynamic-tuple argument: head is a 32-byte offset to the tail.
        // With one argument the head is one word, so the tail begins at 0x20.
        let mut offset_word = [0u8; 32];
        offset_word[31] = 0x20;
        calldata.extend_from_slice(&offset_word);
        // Tail: the tuple's ABI encoding (inner head + dynamic-field tails).
        meta.abi_encode(&mut calldata);

        let result = <pvm::api as pvm::HostFn>::call_evm(
            pvm::CallFlags::ALLOW_REENTRY,
            registry.as_fixed_bytes(),
            u64::MAX,
            &[0u8; 32],
            &calldata,
            None,
        );
        if result.is_err() {
            panic!("RegistryCallFailed");
        }
    }

    /// Current block timestamp in Unix milliseconds (§4). pallet_revive writes
    /// the u256 timestamp little-endian, so the value lives in the low 8 bytes —
    /// same idiom as the registry and prototype contracts.
    fn block_timestamp() -> u64 {
        let mut buf = [0u8; 32];
        pvm::api::now(&mut buf);
        u64::from_le_bytes(buf[0..8].try_into().unwrap_or([0u8; 8]))
    }
}

#[cfg(test)]
mod tests;
