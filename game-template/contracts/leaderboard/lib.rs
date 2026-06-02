#![no_main]
#![no_std]

use pvm::storage::Mapping;
use pvm_contract as pvm;

/// How many recent submissions the ring buffer retains. The UI shows the last
/// ~10; the extra headroom keeps a few more around for any consumer.
const RING_SIZE: u32 = 20;

/// Per-player personal best, keyed by the caller's H160 address, plus
/// enumeration so the frontend can paginate without iterating storage.
/// First-time submissions append to `player_at`; subsequent submissions
/// only update `best` if the new score is higher.
///
/// A separate ring buffer (`recent_at`/`recent_total`) records *every*
/// submission — including ones that don't beat a personal best — so the UI can
/// show that the game is active, not just who's on top.
#[pvm::storage]
struct Storage {
    best: Mapping<pvm::Address, u128>,
    player_at: Mapping<u32, pvm::Address>,
    is_known: Mapping<pvm::Address, bool>,
    player_count: u32,

    recent_at: Mapping<u32, RecentScore>,
    recent_total: u32,
}

#[derive(pvm::SolAbi)]
pub struct Entry {
    pub player: pvm::Address,
    pub score: u128,
}

/// One submission in the recent-activity ring. The frontend reads
/// `recent_total` and walks backwards through `recent_at` modulo the ring size.
#[derive(pvm::SolAbi, pvm::Encode, pvm::Decode, Clone)]
pub struct RecentScore {
    pub player: pvm::Address,
    pub score: u128,
    pub timestamp: u64,
}

#[pvm::contract(cdm = "@example/leaderboard-playground")]
mod leaderboard {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::player_count().set(&0);
        Storage::recent_total().set(&0);
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

        // Record every submission so the UI can surface live activity, even
        // when the score doesn't beat the player's best.
        let total = Storage::recent_total().get().unwrap_or(0);
        let slot = total % RING_SIZE;
        Storage::recent_at().insert(
            &slot,
            &RecentScore {
                player,
                score,
                timestamp: block_timestamp(),
            },
        );
        Storage::recent_total().set(&(total + 1));
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

    /// Total submissions ever recorded (monotonic). `total % size` is the next
    /// write slot; the most recent entry is at `(total - 1) % size`.
    #[pvm::method]
    pub fn get_recent_total() -> u32 {
        Storage::recent_total().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_recent_at(slot: u32) -> RecentScore {
        Storage::recent_at().get(&slot).unwrap_or(RecentScore {
            player: Default::default(),
            score: 0,
            timestamp: 0,
        })
    }

    #[pvm::method]
    pub fn get_recent_size() -> u32 {
        RING_SIZE
    }
}

/// Current block timestamp in seconds. pallet_revive writes the u256 timestamp
/// little-endian, so the seconds value lives in the low 8 bytes.
fn block_timestamp() -> u64 {
    let mut buf = [0u8; 32];
    pvm::api::now(&mut buf);
    u64::from_le_bytes(buf[0..8].try_into().unwrap_or([0u8; 8]))
}
