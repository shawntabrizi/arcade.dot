#![no_main]
#![no_std]

use alloc::string::String;
use pvm::storage::Mapping;
use pvm_contract as pvm;

/// Per-name personal best, plus enumeration so the frontend can paginate
/// without iterating storage. First-time submissions append to `name_at`;
/// subsequent submissions only update `best` if the new score is higher.
#[pvm::storage]
struct Storage {
    best: Mapping<String, u128>,
    name_at: Mapping<u32, String>,
    is_known: Mapping<String, bool>,
    name_count: u32,
}

#[derive(pvm::SolAbi)]
pub struct Entry {
    pub name: String,
    pub score: u128,
}

#[pvm::contract(cdm = "@example/leaderboard-playground")]
mod leaderboard {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::name_count().set(&0);
        Ok(())
    }

    #[pvm::method]
    pub fn submit_score(name: String, score: u128) {
        let prev = Storage::best().get(&name).unwrap_or(0);
        if score > prev {
            Storage::best().insert(&name, &score);
        }
        if !Storage::is_known().get(&name).unwrap_or(false) {
            let idx = Storage::name_count().get().unwrap_or(0);
            Storage::name_at().insert(&idx, &name);
            Storage::is_known().insert(&name, &true);
            Storage::name_count().set(&(idx + 1));
        }
    }

    #[pvm::method]
    pub fn get_best(name: String) -> u128 {
        Storage::best().get(&name).unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_name_count() -> u32 {
        Storage::name_count().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_entry_at(index: u32) -> Entry {
        let name = Storage::name_at().get(&index).unwrap_or_default();
        let score = Storage::best().get(&name).unwrap_or(0);
        Entry { name, score }
    }
}
