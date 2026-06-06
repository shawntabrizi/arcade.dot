// Game Contract Standard (GCS) v1 reference implementation — SCAFFOLD ONLY.
//
// TODO(SPEC §4): implement the full GCS v1 reference contract. This is a later
// task (BUILD_PLAN.md item 3). It must implement, per SPEC §4:
//   - Module A / Activity (§4.1): arcadeVersion()->1, playCount, uniquePlayers,
//     lastPlayedAt.
//   - Module B / Leaderboard (§4.2): scoreOrdering, scoreFormat, scoreUnit,
//     getBest, leaderboardSize, getLeaderboard, getRecent, and submitScore
//     (non-improving never reverts; counters always move; u128::MAX sentinel
//     rule; top-100 sorted insert/update/evict; tie-break `at` asc then
//     insertion order; 20-slot recent ring; ScoreSubmitted event).
//   - Listing management (§4.4): updateListing(meta) gated `caller() == owner`,
//     with the registry address taken as a constructor argument and a
//     cross-contract `register(meta)` into the Arcade Registry (§5.2).
//
// Modeled on the prototype toolchain (ink! on PolkaVM via `pvm_contract`,
// Solidity-compatible ABI via pallet_revive); see
// `game-template/contracts/leaderboard/lib.rs` and the Arcade Registry at
// `contracts/registry/lib.rs`. The on-chain module is gated to the PolkaVM
// target so the workspace remains host-`cargo test`-able (see the registry's
// note); a host test surface arrives with the real implementation.
#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]

// See the registry's note: `alloc` is linkable on every target.
extern crate alloc;

/// Standard version implemented (SPEC §4.1). The dashboard's conformance gate
/// (§7.4) reads `arcadeVersion()` and skips anything that is not `1`.
pub const ARCADE_VERSION: u32 = 1;

#[cfg(target_arch = "riscv64")]
mod contract {
    use super::ARCADE_VERSION;
    use pvm_contract as pvm;

    #[pvm::contract(cdm = "@arcade/gcs-reference")]
    mod gcs_reference {
        use super::*;

        #[pvm::constructor]
        pub fn new() -> Result<(), Error> {
            Ok(())
        }

        /// SPEC §4.1. The only message implemented in this scaffold; the rest of
        /// §4 is the TODO at the top of this file.
        #[pvm::method]
        pub fn arcade_version() -> u32 {
            ARCADE_VERSION
        }
    }
}
