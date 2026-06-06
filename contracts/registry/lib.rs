// Arcade Registry — a permissionless, singleton directory of arcade-compatible
// game contracts (SPEC §5). It holds no scores, no players, no stats, no owner,
// and no admin: the only authorization is `caller()` — a listing's key is the
// address that registers it (§5.2), so listing a contract requires controlling
// it. Create and update are the same message; last write from the contract
// wins. Modeled on the prototype contracts in
// `game-template/contracts/{leaderboard,arcade}` (ink! on PolkaVM via
// `pvm_contract`, Solidity-compatible ABI via pallet_revive).
//
// Testability note: the on-chain contract module compiles only for the PolkaVM
// target (`pvm::storage`/`caller()`/the generated `deploy`+`call` entry points
// are riscv-only). The pure decision logic the spec pins down — byte-cap
// validation (§5.1), pagination clamping (§4.3), and the create-vs-update
// timestamp stamping (§5.1) — lives in the target-independent `logic` module
// so it is unit-testable on the host with `cargo test`. The contract methods
// are thin wrappers that bind that logic to storage, `caller()`, and `now()`.
#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]

// The `SolAbi`/`Encode`/`Decode` derives reference `alloc::` paths, so `alloc`
// must be linkable on every target — including the host test build, where it
// re-exports std's allocator (no duplicate lang items as long as the host build
// does not also `-Zbuild-std` its own copy of `alloc`; see `.cargo/config.toml`).
extern crate alloc;

use alloc::string::String;
use pvm_contract as pvm;

/// Byte caps for `ListingMetadata` fields (§5.1). The registry reverts on
/// oversize but does NOT validate content — names are not unique, URLs are not
/// checked. Trust derives from §5.2, not from validation.
pub const NAME_MAX: usize = 64;
pub const GAME_TYPE_MAX: usize = 32;
pub const SHORT_DESCRIPTION_MAX: usize = 256;
pub const PLAY_URL_MAX: usize = 256;
pub const THUMBNAIL_CID_MAX: usize = 128;
pub const EXTRA_CID_MAX: usize = 128;

/// The `metaVersion` this registry stamps onto every listing (§5.1, §5.5).
pub const META_VERSION: u32 = 1;

/// Pagination limit cap (§4.3). The convention permits a cap of the contract's
/// choosing so long as it is >= 50; we cap at exactly the minimum.
pub const MAX_PAGE_LIMIT: u32 = 50;

/// Self-describing metadata a game contract forwards verbatim to `register`
/// (§5.1). Field order is the ABI tuple order; do not reorder.
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

/// A stored listing: the caller-supplied metadata plus registry-stamped fields
/// (§5.1). `meta_version` and `registered_at` are set once on first register;
/// `updated_at` moves on every register.
#[derive(pvm::SolAbi, pvm::Encode, pvm::Decode, Clone)]
pub struct Listing {
    pub meta: ListingMetadata,
    pub meta_version: u32,
    pub registered_at: u64,
    pub updated_at: u64,
}

/// One row of `getGames` enumeration. SPEC §5.3 specifies the read returns
/// `Vec<(H160, Listing)>`; there is no `SolAbi` impl for bare Rust tuples in
/// the prototype's toolchain, so — matching the prototype's struct-return
/// idiom (`Entry`, `GameInfo`) — we return a derived `SolAbi` struct. A named
/// struct encodes as a Solidity tuple, so `GameListing[]` is ABI-identical to
/// `(address, Listing)[]`.
#[derive(pvm::SolAbi, pvm::Encode, pvm::Decode, Clone)]
pub struct GameListing {
    pub game: pvm::Address,
    pub listing: Listing,
}

/// Pure decision logic, independent of storage/`caller()`/`now()` so it can be
/// unit-tested on the host. Everything here is what the spec pins down exactly.
pub mod logic {
    use super::*;

    /// Whether every field of `meta` is within its §5.1 byte cap. `register`
    /// MUST revert when this is false. Caps only — content is never validated.
    pub fn caps_ok(meta: &ListingMetadata) -> bool {
        meta.name.len() <= NAME_MAX
            && meta.game_type.len() <= GAME_TYPE_MAX
            && meta.short_description.len() <= SHORT_DESCRIPTION_MAX
            && meta.play_url.len() <= PLAY_URL_MAX
            && meta.thumbnail_cid.len() <= THUMBNAIL_CID_MAX
            && meta.extra_cid.len() <= EXTRA_CID_MAX
    }

    /// Build the `Listing` to store for a `register` call, given any previously
    /// stored listing for the same caller and the current timestamp (§5.1):
    ///
    /// - First register (`prev` is `None`): stamp `meta_version = META_VERSION`,
    ///   `registered_at = now`, `updated_at = now`.
    /// - Update (`prev` is `Some`): preserve `registered_at` and the original
    ///   `meta_version`; replace `meta`; move `updated_at` to `now`.
    pub fn stamp(prev: Option<&Listing>, meta: ListingMetadata, now: u64) -> Listing {
        match prev {
            None => Listing {
                meta,
                meta_version: META_VERSION,
                registered_at: now,
                updated_at: now,
            },
            Some(existing) => Listing {
                meta,
                meta_version: existing.meta_version,
                registered_at: existing.registered_at,
                updated_at: now,
            },
        }
    }

    /// Clamp a paginated request to the half-open window actually served
    /// (§4.3). Returns `(start, end)` indices into the `[0, count)` range such
    /// that the served slice is `[start, end)`:
    ///
    /// - `offset` is 0-based; `offset >= count` yields an empty window (never
    ///   reverts).
    /// - `limit` is capped at `MAX_PAGE_LIMIT`; requests at or below the cap
    ///   are honored exactly. `limit == 0` yields an empty window.
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
        // `offset < count` so `count - offset` is the items remaining; the
        // window size is the lesser of that and the capped limit.
        let remaining = count - offset;
        let take = if capped > remaining { remaining } else { capped };
        (offset, offset + take)
    }
}

/// On-chain contract. Compiled only for the PolkaVM target: `pvm::storage`,
/// `caller()`, and the macro-generated `deploy`/`call` entry points exist only
/// there. The host `cargo test` build excludes this module and exercises
/// `logic` directly.
#[cfg(target_arch = "riscv64")]
mod contract {
    use super::logic;
    use super::{GameListing, Listing, ListingMetadata};
    // NOTE: the `#[pvm::contract]` macro injects `use alloc::vec::Vec;` itself,
    // so do not re-import Vec here.
    use pvm::storage::Mapping;
    use pvm::HostFn as _;
    use pvm_contract as pvm;

    /// Canonical Solidity signature of §5.6's `ListingChanged(game: H160)`
    /// event. Its keccak256 is the indexed-event topic; we hash it at runtime
    /// via the host so there is no magic constant to drift
    /// (keccak256 = 0x294e909971e56fb0e171c5ef8443d2d9ebcdbcdfbc7e087ecac3181b64cd1b97).
    const LISTING_CHANGED_SIG: &[u8] = b"ListingChanged(address)";

    #[pvm::storage]
    struct Storage {
        // Active listings keyed by the registering contract's address (§5.2).
        listings: Mapping<pvm::Address, Listing>,
        // Registration-order enumeration index. `game_at[i]` is the i-th active
        // listing's address; `index_of[addr] = i + 1` (0 means "not listed", so
        // we can distinguish slot 0 from absence). `unlist` swap-and-pops, which
        // is permitted — order stability across unlisting is NOT guaranteed
        // (§5.3).
        game_at: Mapping<u32, pvm::Address>,
        index_of: Mapping<pvm::Address, u32>,
        game_count: u32,
    }

    #[pvm::contract(cdm = "@arcade/registry")]
    mod registry {
        use super::*;

        #[pvm::constructor]
        pub fn new() -> Result<(), Error> {
            Storage::game_count().set(&0);
            Ok(())
        }

        /// Create or update the caller's listing (§5.2). Stamps
        /// `meta_version`/`registered_at` on first register and `updated_at`
        /// always (§5.1). Reverts if any field exceeds its §5.1 byte cap
        /// (revert via `panic!`, matching the prototype's revert idiom — the
        /// macro-generated `Error` enum carries no variants). Emits
        /// `ListingChanged(caller)` (§5.6).
        #[pvm::method]
        pub fn register(meta: ListingMetadata) {
            if !logic::caps_ok(&meta) {
                panic!("MetadataTooLarge");
            }
            let game = pvm::caller();
            let prev = Storage::listings().get(&game);
            let listing = logic::stamp(prev.as_ref(), meta, block_timestamp());

            if prev.is_none() {
                let idx = Storage::game_count().get().unwrap_or(0);
                Storage::game_at().insert(&idx, &game);
                Storage::index_of().insert(&game, &(idx + 1));
                Storage::game_count().set(&(idx + 1));
            }
            Storage::listings().insert(&game, &listing);

            emit_listing_changed(game);
        }

        /// Remove the caller's listing (§5.2). No-op if the caller has none.
        /// Uses swap-and-pop on the enumeration index (§5.3). Emits
        /// `ListingChanged(caller)` (§5.6).
        #[pvm::method]
        pub fn unlist() {
            let game = pvm::caller();
            let slot_plus_one = match Storage::index_of().get(&game) {
                Some(v) if v > 0 => v,
                _ => return,
            };
            let slot = slot_plus_one - 1;
            let count = Storage::game_count().get().unwrap_or(0);
            let last = count - 1;

            // Swap the last entry into the freed slot, then shrink by one.
            if slot != last {
                let moved = Storage::game_at().get(&last).unwrap_or_default();
                Storage::game_at().insert(&slot, &moved);
                Storage::index_of().insert(&moved, &(slot + 1));
            }
            Storage::game_at().remove(&last);
            Storage::game_count().set(&last);

            Storage::index_of().remove(&game);
            Storage::listings().remove(&game);

            emit_listing_changed(game);
        }

        // ---- enumeration (§5.3) ----

        #[pvm::method]
        pub fn game_count() -> u32 {
            Storage::game_count().get().unwrap_or(0)
        }

        /// Listings in registration order (modulo prior swap-and-pops, §5.3),
        /// paginated per §4.3. Never reverts on out-of-range offsets.
        #[pvm::method]
        pub fn get_games(offset: u32, limit: u32) -> Vec<GameListing> {
            let count = Storage::game_count().get().unwrap_or(0);
            let (start, end) = logic::page_bounds(count, offset, limit);
            let mut out = Vec::new();
            let mut i = start;
            while i < end {
                let game = Storage::game_at().get(&i).unwrap_or_default();
                if let Some(listing) = Storage::listings().get(&game) {
                    out.push(GameListing { game, listing });
                }
                i += 1;
            }
            out
        }

        /// Single lookup (§5.3). `Option<Listing>` — `None` if not listed.
        #[pvm::method]
        pub fn get_listing(game: pvm::Address) -> Option<Listing> {
            Storage::listings().get(&game)
        }
    }

    /// Emit `ListingChanged(game)` (§5.6). The address is an indexed topic, so
    /// it is left-padded to 32 bytes and carried as a topic, with empty data —
    /// the standard Solidity event encoding the dashboard can subscribe to.
    fn emit_listing_changed(game: pvm::Address) {
        let mut sig_topic = [0u8; 32];
        pvm::api::hash_keccak_256(LISTING_CHANGED_SIG, &mut sig_topic);
        let mut addr_topic = [0u8; 32];
        addr_topic[12..32].copy_from_slice(game.as_bytes());
        let topics = [sig_topic, addr_topic];
        pvm::api::deposit_event(&topics, &[]);
    }

    /// Current block timestamp in Unix milliseconds (§4 / SPEC: "Unix
    /// milliseconds from the chain's timestamp"). pallet_revive writes the u256
    /// timestamp little-endian, so the value lives in the low 8 bytes — same
    /// idiom as the prototype contracts.
    fn block_timestamp() -> u64 {
        let mut buf = [0u8; 32];
        pvm::api::now(&mut buf);
        u64::from_le_bytes(buf[0..8].try_into().unwrap_or([0u8; 8]))
    }
}

#[cfg(test)]
mod tests;
