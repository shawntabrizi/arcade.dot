#![no_main]
#![no_std]

use pvm::storage::Mapping;
use pvm_contract as pvm;

/// Per-player personal best, keyed by the caller's H160 address, plus
/// enumeration so the frontend can paginate without iterating storage.
/// First-time submissions append to `player_at`; subsequent submissions
/// only update `best` if the new score is higher.
#[pvm::storage]
struct Storage {
    best: Mapping<pvm::Address, u128>,
    player_at: Mapping<u32, pvm::Address>,
    is_known: Mapping<pvm::Address, bool>,
    player_count: u32,
}

#[derive(pvm::SolAbi)]
pub struct Entry {
    pub player: pvm::Address,
    pub score: u128,
}

#[pvm::contract(cdm = "@example/leaderboard-playground")]
mod leaderboard {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::player_count().set(&0);
        Ok(())
    }

    #[pvm::method]
    pub fn submit_score(score: u128) {
        let player = pvm::caller();
        let prev = Storage::best().get(&player).unwrap_or(0);
        if score > prev {
            Storage::best().insert(&player, &score);
        }
        if !Storage::is_known().get(&player).unwrap_or(false) {
            let idx = Storage::player_count().get().unwrap_or(0);
            Storage::player_at().insert(&idx, &player);
            Storage::is_known().insert(&player, &true);
            Storage::player_count().set(&(idx + 1));
        }
    }

    #[pvm::method]
    pub fn get_best(player: pvm::Address) -> u128 {
        Storage::best().get(&player).unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_player_count() -> u32 {
        Storage::player_count().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_entry_at(index: u32) -> Entry {
        let player = Storage::player_at().get(&index).unwrap_or_default();
        let score = Storage::best().get(&player).unwrap_or(0);
        Entry { player, score }
    }
}
