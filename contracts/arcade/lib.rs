#![no_main]
#![no_std]

use alloc::string::String;
use pvm::storage::Mapping;
use pvm_contract as pvm;

// Type-safe reference to a leaderboard-shape contract:
//   function getBest(address player) view returns (uint128)
// Any per-game contract whose ABI matches this is callable through
// leaderboard::reference(addr).get_best(player).
pvm::abi_import!("leaderboard", "leaderboard_abi.json");

const RING_SIZE: u32 = 50;

/// Per-game metadata captured at registration plus a freshly-bumped activity
/// timestamp on every `record_score`. Used by the dashboard to sort games.
#[derive(pvm::SolAbi, pvm::Encode, pvm::Decode, Clone)]
pub struct GameInfo {
    pub name: String,
    pub image_uri: String,
    pub registered_at: u64,
    pub last_activity: u64,
}

/// One entry in the recent-activity ring buffer. The dashboard reads
/// `recent_total` and walks backwards through `recent_at` modulo RING_SIZE.
#[derive(pvm::SolAbi, pvm::Encode, pvm::Decode, Clone)]
pub struct RecentScore {
    pub game: pvm::Address,
    pub player: pvm::Address,
    pub score: u128,
    pub timestamp: u64,
}

#[pvm::storage]
struct Storage {
    // Game registry
    games: Mapping<pvm::Address, GameInfo>,
    game_at: Mapping<u32, pvm::Address>,
    game_count: u32,

    // Display names (caller-claimed, first-come-first-served)
    display_names: Mapping<pvm::Address, String>,
    name_owners: Mapping<String, pvm::Address>,

    // Cross-game scoring
    total_points: Mapping<pvm::Address, u128>,
    per_game_best: Mapping<(pvm::Address, pvm::Address), u128>,
    is_known_player: Mapping<pvm::Address, bool>,
    player_at: Mapping<u32, pvm::Address>,
    player_count: u32,

    // Recent activity ring buffer (RING_SIZE entries by slot, monotonic total)
    recent_at: Mapping<u32, RecentScore>,
    recent_total: u32,
}

#[pvm::contract(cdm = "@example/arcade-playground")]
mod arcade {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::game_count().set(&0);
        Storage::player_count().set(&0);
        Storage::recent_total().set(&0);
        Ok(())
    }

    /// Add a game contract to the registry. No-op if already registered;
    /// names are not unique across games (multiple games may share a label).
    #[pvm::method]
    pub fn register_game(contract: pvm::Address, name: String, image_uri: String) {
        if Storage::games().get(&contract).is_some() {
            return;
        }
        let now = block_timestamp();
        Storage::games().insert(
            &contract,
            &GameInfo {
                name,
                image_uri,
                registered_at: now,
                last_activity: now,
            },
        );
        let idx = Storage::game_count().get().unwrap_or(0);
        Storage::game_at().insert(&idx, &contract);
        Storage::game_count().set(&(idx + 1));
    }

    /// Claim a display name for the caller. Releases any previous name owned
    /// by the caller. Reverts if a different account already owns the name.
    #[pvm::method]
    pub fn set_display_name(name: String) {
        let caller = pvm::caller();
        if let Some(prev) = Storage::display_names().get(&caller) {
            if let Some(owner) = Storage::name_owners().get(&prev) {
                if owner == caller {
                    Storage::name_owners().remove(&prev);
                }
            }
        }
        if let Some(owner) = Storage::name_owners().get(&name) {
            if owner != caller {
                panic!("name taken");
            }
        }
        Storage::display_names().insert(&caller, &name);
        Storage::name_owners().insert(&name, &caller);
    }

    /// Pull-style score sync. Reads `game.getBest(caller())` cross-contract and
    /// accrues the delta against the caller's total. No-op if the game isn't
    /// registered, the game contract returns 0 or errors, or there's no improvement.
    #[pvm::method]
    pub fn record_score(game: pvm::Address) {
        let player = pvm::caller();
        let mut info = match Storage::games().get(&game) {
            Some(g) => g,
            None => return,
        };
        let best = leaderboard::reference(game).get_best(player).unwrap_or(0);
        let prev = Storage::per_game_best().get(&(game, player)).unwrap_or(0);
        if best <= prev {
            return;
        }
        let delta = best - prev;
        Storage::per_game_best().insert(&(game, player), &best);
        let total = Storage::total_points().get(&player).unwrap_or(0);
        Storage::total_points().insert(&player, &total.saturating_add(delta));

        let now = block_timestamp();
        info.last_activity = now;
        Storage::games().insert(&game, &info);

        if !Storage::is_known_player().get(&player).unwrap_or(false) {
            let pidx = Storage::player_count().get().unwrap_or(0);
            Storage::player_at().insert(&pidx, &player);
            Storage::is_known_player().insert(&player, &true);
            Storage::player_count().set(&(pidx + 1));
        }

        let total_recent = Storage::recent_total().get().unwrap_or(0);
        let slot = total_recent % RING_SIZE;
        Storage::recent_at().insert(
            &slot,
            &RecentScore {
                game,
                player,
                score: best,
                timestamp: now,
            },
        );
        Storage::recent_total().set(&(total_recent + 1));
    }

    // ---- queries ----

    #[pvm::method]
    pub fn get_game_count() -> u32 {
        Storage::game_count().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_game_at(index: u32) -> pvm::Address {
        Storage::game_at().get(&index).unwrap_or_default()
    }

    #[pvm::method]
    pub fn get_game_info(game: pvm::Address) -> GameInfo {
        Storage::games().get(&game).unwrap_or(GameInfo {
            name: String::new(),
            image_uri: String::new(),
            registered_at: 0,
            last_activity: 0,
        })
    }

    #[pvm::method]
    pub fn get_display_name(player: pvm::Address) -> String {
        Storage::display_names().get(&player).unwrap_or_default()
    }

    #[pvm::method]
    pub fn get_total_points(player: pvm::Address) -> u128 {
        Storage::total_points().get(&player).unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_per_game_best(game: pvm::Address, player: pvm::Address) -> u128 {
        Storage::per_game_best().get(&(game, player)).unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_player_count() -> u32 {
        Storage::player_count().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_player_at(index: u32) -> pvm::Address {
        Storage::player_at().get(&index).unwrap_or_default()
    }

    #[pvm::method]
    pub fn get_recent_total() -> u32 {
        Storage::recent_total().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_recent_at(slot: u32) -> RecentScore {
        Storage::recent_at().get(&slot).unwrap_or(RecentScore {
            game: pvm::Address::default(),
            player: pvm::Address::default(),
            score: 0,
            timestamp: 0,
        })
    }

    #[pvm::method]
    pub fn get_ring_size() -> u32 {
        RING_SIZE
    }
}

fn block_timestamp() -> u64 {
    // pallet_revive writes the u256 block timestamp little-endian, so the
    // low 64 bits (which is the entire seconds value for any realistic time)
    // live at the start of the buffer.
    let mut buf = [0u8; 32];
    pvm::api::now(&mut buf);
    u64::from_le_bytes(buf[0..8].try_into().unwrap_or([0u8; 8]))
}
