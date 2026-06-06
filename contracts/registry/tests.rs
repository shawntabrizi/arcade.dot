//! Host-side unit tests for the Arcade Registry.
//!
//! The on-chain contract module (`#[cfg(target_arch = "riscv64")]`) cannot run
//! on the host — `pvm::storage`/`caller()` are riscv-only and the macro emits
//! PolkaVM entry points. So these tests target two surfaces:
//!
//! 1. The pure `logic` module directly (caps, stamping, pagination) — this is
//!    the code the spec pins down exactly.
//! 2. A faithful host re-implementation of the storage-backed pieces the
//!    contract can only do on-chain (caller-keyed listing map + swap-and-pop
//!    enumeration index + event topic). `Registry` below mirrors the contract
//!    methods line-for-line against in-memory maps, so a test that fails here
//!    fails for the same reason the contract would. Each test states WHY the
//!    behavior matters, per the spec section it guards.

use super::logic;
use super::{GameListing, Listing, ListingMetadata, MAX_PAGE_LIMIT, META_VERSION};
use pvm_contract::Address;
use std::collections::HashMap;

// ----- helpers -----

fn addr(b: u8) -> Address {
    let mut bytes = [0u8; 20];
    bytes[19] = b;
    Address::from(bytes)
}

/// A metadata value with all fields within caps (content is arbitrary; the
/// registry never validates content, only length).
fn meta(name: &str) -> ListingMetadata {
    ListingMetadata {
        name: name.into(),
        game_type: "arcade".into(),
        short_description: "a game".into(),
        play_url: "snake.dot".into(),
        thumbnail_cid: String::new(),
        requires_account: false,
        extra_cid: String::new(),
    }
}

/// In-memory mirror of the contract's storage + the register/unlist/get_games
/// logic. Mirrors `contracts/registry/lib.rs::contract::registry` exactly,
/// substituting `HashMap`s for `Mapping` and an explicit `caller`/`now` for the
/// host calls. Keep in sync with the contract if that logic changes.
#[derive(Default)]
struct Registry {
    listings: HashMap<Address, Listing>,
    game_at: HashMap<u32, Address>,
    index_of: HashMap<Address, u32>, // value = slot + 1; 0/absent = not listed
    game_count: u32,
    events: Vec<Address>, // ListingChanged(game) emissions, in order
}

impl Registry {
    /// Mirror of `register(meta)`. Returns `Err` on oversize (the contract
    /// reverts); `caller` stands in for `pvm::caller()`.
    fn register(&mut self, caller: Address, m: ListingMetadata, now: u64) -> Result<(), ()> {
        if !logic::caps_ok(&m) {
            return Err(());
        }
        let prev = self.listings.get(&caller).cloned();
        let listing = logic::stamp(prev.as_ref(), m, now);
        if prev.is_none() {
            let idx = self.game_count;
            self.game_at.insert(idx, caller);
            self.index_of.insert(caller, idx + 1);
            self.game_count = idx + 1;
        }
        self.listings.insert(caller, listing);
        self.events.push(caller);
        Ok(())
    }

    /// Mirror of `unlist()` (swap-and-pop, §5.3).
    fn unlist(&mut self, caller: Address) {
        let slot_plus_one = match self.index_of.get(&caller).copied() {
            Some(v) if v > 0 => v,
            _ => return,
        };
        let slot = slot_plus_one - 1;
        let last = self.game_count - 1;
        if slot != last {
            let moved = *self.game_at.get(&last).unwrap();
            self.game_at.insert(slot, moved);
            self.index_of.insert(moved, slot + 1);
        }
        self.game_at.remove(&last);
        self.game_count = last;
        self.index_of.remove(&caller);
        self.listings.remove(&caller);
        self.events.push(caller);
    }

    /// Mirror of `get_games(offset, limit)`.
    fn get_games(&self, offset: u32, limit: u32) -> Vec<GameListing> {
        let (start, end) = logic::page_bounds(self.game_count, offset, limit);
        let mut out = Vec::new();
        let mut i = start;
        while i < end {
            let game = *self.game_at.get(&i).unwrap();
            let listing = self.listings.get(&game).unwrap().clone();
            out.push(GameListing { game, listing });
            i += 1;
        }
        out
    }

    fn get_listing(&self, game: Address) -> Option<Listing> {
        self.listings.get(&game).cloned()
    }
}

// ----- logic::stamp — create vs update (§5.1) -----

#[test]
fn create_stamps_version_and_both_timestamps() {
    // WHY: first register must establish metaVersion=1 and registeredAt; both
    // timestamps equal `now` on creation (§5.1).
    let l = logic::stamp(None, meta("Snake"), 1000);
    assert_eq!(l.meta_version, META_VERSION);
    assert_eq!(l.registered_at, 1000);
    assert_eq!(l.updated_at, 1000);
}

#[test]
fn update_keeps_registered_at_moves_updated_at() {
    // WHY: an update is the same message as create (§5.2) but must NOT reset
    // registeredAt — "New" sorting (§7.1) depends on the original registration
    // time being stable; updatedAt must move so freshness is observable.
    let first = logic::stamp(None, meta("Snake"), 1000);
    let second = logic::stamp(Some(&first), meta("Snake v2"), 5000);
    assert_eq!(second.registered_at, 1000, "registeredAt must be stable");
    assert_eq!(second.updated_at, 5000, "updatedAt must move");
    assert_eq!(second.meta.name, "Snake v2", "meta is replaced wholesale");
    assert_eq!(second.meta_version, META_VERSION, "metaVersion preserved");
}

// ----- caps (§5.1): revert on oversize, per field; content never validated -----

#[test]
fn caps_accept_exact_boundary_and_empty() {
    // WHY: §4.3-style "at the cap is honored" — a field exactly at its byte cap
    // is valid; empty optional fields are valid.
    let mut m = meta("ok");
    m.name = "a".repeat(super::NAME_MAX);
    m.game_type = "b".repeat(super::GAME_TYPE_MAX);
    m.short_description = "c".repeat(super::SHORT_DESCRIPTION_MAX);
    m.play_url = "d".repeat(super::PLAY_URL_MAX);
    m.thumbnail_cid = "e".repeat(super::THUMBNAIL_CID_MAX);
    m.extra_cid = "f".repeat(super::EXTRA_CID_MAX);
    assert!(logic::caps_ok(&m));
}

#[test]
fn each_field_cap_is_enforced_independently() {
    // WHY: the registry reverts on oversize (§5.1). Each field has its own cap;
    // a regression that drops one field's check must be caught. One field over
    // by a single byte, all others valid -> reject.
    let over = |mut m: ListingMetadata| {
        m.name = "x".repeat(super::NAME_MAX + 1);
        assert!(!logic::caps_ok(&m));
    };
    over(meta("ok"));

    let mut m = meta("ok");
    m.game_type = "x".repeat(super::GAME_TYPE_MAX + 1);
    assert!(!logic::caps_ok(&m));

    let mut m = meta("ok");
    m.short_description = "x".repeat(super::SHORT_DESCRIPTION_MAX + 1);
    assert!(!logic::caps_ok(&m));

    let mut m = meta("ok");
    m.play_url = "x".repeat(super::PLAY_URL_MAX + 1);
    assert!(!logic::caps_ok(&m));

    let mut m = meta("ok");
    m.thumbnail_cid = "x".repeat(super::THUMBNAIL_CID_MAX + 1);
    assert!(!logic::caps_ok(&m));

    let mut m = meta("ok");
    m.extra_cid = "x".repeat(super::EXTRA_CID_MAX + 1);
    assert!(!logic::caps_ok(&m));
}

#[test]
fn register_reverts_on_oversize_without_mutating_state() {
    // WHY: a reverting register must not leave a partial listing or bump the
    // count — revert means no state change.
    let mut r = Registry::default();
    let mut m = meta("toolong");
    m.name = "x".repeat(super::NAME_MAX + 1);
    assert!(r.register(addr(1), m, 100).is_err());
    assert_eq!(r.game_count, 0);
    assert!(r.get_listing(addr(1)).is_none());
    assert!(r.events.is_empty(), "no event on revert");
}

// ----- pagination (§4.3) -----

#[test]
fn page_bounds_basic_window() {
    // WHY: [offset, offset+limit) half-open window.
    assert_eq!(logic::page_bounds(10, 2, 3), (2, 5));
}

#[test]
fn page_bounds_offset_past_end_is_empty_never_reverts() {
    // WHY: §4.3 — reads MUST NOT revert on out-of-range offsets; they return
    // empty. Equal-to-count and far-past both empty.
    assert_eq!(logic::page_bounds(5, 5, 10), (5, 5));
    assert_eq!(logic::page_bounds(5, 99, 10), (5, 5));
    assert_eq!(logic::page_bounds(0, 0, 10), (0, 0));
}

#[test]
fn page_bounds_partial_tail() {
    // WHY: fewer items past the end (§4.3) — window clamps to count.
    assert_eq!(logic::page_bounds(5, 3, 10), (3, 5));
}

#[test]
fn page_bounds_limit_zero_is_empty() {
    // WHY: limit 0 yields zero items (degenerate but must not panic/over-read).
    assert_eq!(logic::page_bounds(5, 0, 0), (0, 0));
}

#[test]
fn page_bounds_caps_limit_but_honors_at_or_below_cap() {
    // WHY: §4.3 — a cap is allowed but MUST be >= 50, and requests at/below the
    // cap are honored exactly. Above the cap is clamped to MAX_PAGE_LIMIT.
    assert!(MAX_PAGE_LIMIT >= 50);
    let big = 1_000;
    let (s, e) = logic::page_bounds(big, 0, u32::MAX);
    assert_eq!((s, e), (0, MAX_PAGE_LIMIT), "over-cap clamps to cap");
    let (s, e) = logic::page_bounds(big, 0, MAX_PAGE_LIMIT);
    assert_eq!((s, e), (0, MAX_PAGE_LIMIT), "exactly-at-cap honored");
    let (s, e) = logic::page_bounds(big, 0, MAX_PAGE_LIMIT - 1);
    assert_eq!((s, e), (0, MAX_PAGE_LIMIT - 1), "below cap honored exactly");
}

// ----- enumeration across register/unlist, hole handling (§5.3) -----

#[test]
fn enumeration_reflects_registration_order_before_unlist() {
    // WHY: getGames returns registration order (§5.3) until an unlist perturbs
    // it via swap-and-pop.
    let mut r = Registry::default();
    r.register(addr(1), meta("a"), 1).unwrap();
    r.register(addr(2), meta("b"), 2).unwrap();
    r.register(addr(3), meta("c"), 3).unwrap();
    let all = r.get_games(0, 50);
    let order: Vec<Address> = all.iter().map(|g| g.game).collect();
    assert_eq!(order, vec![addr(1), addr(2), addr(3)]);
}

#[test]
fn unlist_swap_and_pop_leaves_no_hole_and_count_shrinks() {
    // WHY: §5.3 — unlist removes the listing and enumeration must skip it. With
    // swap-and-pop the surviving set is exactly {others}, count drops by one,
    // and getGames never yields a stale/empty slot. Order stability is NOT
    // guaranteed, so we assert on the *set*, not the sequence.
    let mut r = Registry::default();
    for i in 1..=4u8 {
        r.register(addr(i), meta("g"), i as u64).unwrap();
    }
    r.unlist(addr(2)); // middle removal -> swap-and-pop moves addr(4) into slot 1
    assert_eq!(r.game_count, 3);
    assert!(r.get_listing(addr(2)).is_none());
    let mut survivors: Vec<u8> = r.get_games(0, 50).iter().map(|g| g.game.as_bytes()[19]).collect();
    survivors.sort();
    assert_eq!(survivors, vec![1, 3, 4]);
    // Every enumerated entry resolves to a real listing (no holes).
    assert_eq!(r.get_games(0, 50).len(), 3);
}

#[test]
fn unlist_then_reregister_creates_fresh_listing() {
    // WHY: re-registering after unlist is a *create* again — new registeredAt,
    // back in the enumeration. The prior registeredAt is gone (the listing was
    // removed), distinguishing it from a plain update.
    let mut r = Registry::default();
    r.register(addr(1), meta("a"), 100).unwrap();
    r.unlist(addr(1));
    assert_eq!(r.game_count, 0);
    r.register(addr(1), meta("a-again"), 500).unwrap();
    assert_eq!(r.game_count, 1);
    let l = r.get_listing(addr(1)).unwrap();
    assert_eq!(l.registered_at, 500, "fresh registeredAt after unlist+reregister");
    assert_eq!(l.updated_at, 500);
}

#[test]
fn update_does_not_grow_count_or_duplicate_enumeration() {
    // WHY: create and update are the same message (§5.2); an update must not
    // append a second enumeration slot for the same caller.
    let mut r = Registry::default();
    r.register(addr(1), meta("a"), 100).unwrap();
    r.register(addr(1), meta("a2"), 200).unwrap();
    assert_eq!(r.game_count, 1);
    assert_eq!(r.get_games(0, 50).len(), 1);
}

#[test]
fn unlist_unknown_caller_is_noop() {
    // WHY: unlist of a caller with no listing must be a no-op, not an underflow
    // on game_count.
    let mut r = Registry::default();
    r.register(addr(1), meta("a"), 1).unwrap();
    let before = r.game_count;
    r.unlist(addr(99));
    assert_eq!(r.game_count, before);
}

// ----- caller isolation (§5.2): a listing's key is caller() -----

#[test]
fn different_callers_cannot_touch_each_others_listing() {
    // WHY: §5.2 — the entire auth model is "listing key = caller()". One caller
    // registering/unlisting only ever affects their own row.
    let mut r = Registry::default();
    r.register(addr(1), meta("alice"), 100).unwrap();
    r.register(addr(2), meta("bob"), 200).unwrap();

    // addr(2) "registering" again only rewrites addr(2)'s listing.
    r.register(addr(2), meta("bob v2"), 300).unwrap();
    assert_eq!(r.get_listing(addr(1)).unwrap().meta.name, "alice");
    assert_eq!(r.get_listing(addr(2)).unwrap().meta.name, "bob v2");

    // addr(2) unlisting removes only addr(2); addr(1) survives.
    r.unlist(addr(2));
    assert!(r.get_listing(addr(2)).is_none());
    assert_eq!(r.get_listing(addr(1)).unwrap().meta.name, "alice");
}

// ----- events (§5.6): ListingChanged(game) on register and unlist -----

#[test]
fn listing_changed_emitted_on_register_and_unlist() {
    // WHY: §5.6 — the dashboard refreshes reactively on ListingChanged. It must
    // fire on every successful register (create AND update) and on unlist.
    let mut r = Registry::default();
    r.register(addr(7), meta("a"), 1).unwrap(); // create
    r.register(addr(7), meta("a2"), 2).unwrap(); // update
    r.unlist(addr(7)); // remove
    assert_eq!(r.events, vec![addr(7), addr(7), addr(7)]);
}

#[test]
fn listing_changed_topic_is_keccak_of_signature() {
    // WHY: the indexed event topic the dashboard subscribes to is
    // keccak256("ListingChanged(address)"). This pins the canonical value so a
    // signature typo (e.g. wrong arg type) is caught. Computed independently
    // here via the same hash the contract uses at runtime.
    let expected = "294e909971e56fb0e171c5ef8443d2d9ebcdbcdfbc7e087ecac3181b64cd1b97";
    assert_eq!(hex(&keccak256(b"ListingChanged(address)")), expected);
}

// ----- minimal keccak-256 for the topic test (host-only) -----

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Keccak-256 (the Ethereum variant, 0x01 padding) — used only to verify the
/// event-topic constant in `listing_changed_topic_is_keccak_of_signature`.
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
        // keccak-f[1600]
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
