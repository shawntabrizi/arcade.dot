# Contract Deployment — Paseo Asset Hub (paseo-next-v2)

BUILD_PLAN.md item 4. Machine-readable record of the deployed Arcade Registry +
GCS reference contracts and their on-chain verification.

```json
{
  "network": "wss://paseo-asset-hub-next-rpc.polkadot.io",
  "target": "paseo-next-v2",
  "signer": {
    "suri": "//Alice",
    "ss58": "5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV",
    "h160": "0x35cdb23ff7fc86e8dccd577ca309bfea9c978d20",
    "note": "//Alice is the deployer, so it is the GCS contract owner (updateListing gate)."
  },
  "contracts": {
    "@arcade/registry": "0x4d1891947e2d25eda37005b476c67fb007003cc2",
    "@arcade/gcs-reference": "0x16db2b8598303758d9c37e1dae24b76b3641bf99"
  },
  "verify": {
    "gameCountInitial": { "expected": 0, "value": 0, "pass": true },
    "arcadeVersion": { "expected": 1, "value": 1, "pass": true },
    "scoreOrdering": { "expected": 0, "value": 0, "pass": true },
    "updateListing_crossContractRegister": { "pass": true },
    "gameCountAfterUpdate": { "expected": 1, "value": 1, "pass": true },
    "getListing": {
      "isSome": true,
      "metaVersion": 1,
      "registeredAt": 1780778532,
      "updatedAt": 1780778532,
      "metaMatches": true,
      "pass": true
    },
    "submitScore": { "pass": true },
    "playCount": { "expected": 1, "value": 1, "pass": true },
    "getBest": { "expected": 42, "value": 42, "pass": true },
    "leaderboard": {
      "size": 1,
      "entry": { "player": "0x35cdb23ff7fc86e8dccd577ca309bfea9c978d20", "score": 42 },
      "pass": true
    }
  },
  "allPass": true
}
```

## Notes

- The critical test (4c/4d) passed: `gcs.updateListing(meta)` exercises the
  hand-built cross-contract calldata into the registry's `register`. End-to-end
  on-chain, the registry recorded the listing keyed by the GCS contract address,
  with `metaVersion=1`, matching metadata, and `registeredAt`/`updatedAt` set —
  confirming the hand-encoded selector + dynamic-tuple ABI body are correct. No
  contract code changes were needed.
- Each script run uploads code and instantiates with the default salt, so it
  deploys a *fresh* contract pair (new addresses) and is fully self-contained.
  The addresses above (and in `cdm.json`) are from the recorded run.
- Timestamps read back as Unix *seconds* (~1.78e9), not milliseconds as the
  contract comments state. `block_timestamp()` reads `now()`'s low 8 bytes
  little-endian; on this chain that is seconds. Not a verification failure (§4d
  only requires timestamps be set; both are >0 and equal for a first register)
  and it matches the prototype's identical idiom, so left unchanged.

## Reproduce

```bash
cd contracts && cargo pvm-contract build --release -p registry -p gcs-reference   # if artifacts stale
contracts/scripts/run-deploy.sh                                                   # deploy + verify
```

`run-deploy.sh` runs `scripts/deploy-and-verify.mjs` with node's module
resolution rooted at `game-template/` (which carries `polkadot-api`,
`@polkadot-api/sdk-ink`, and `hdkd`); it writes addresses + ABIs into
`contracts/cdm.json` and prints a JSON summary. Exit code is non-zero if any
check fails.
