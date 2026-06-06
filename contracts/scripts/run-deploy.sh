#!/usr/bin/env bash
# Run the contract deploy+verify script (deploy-and-verify.mjs) with node's
# module resolution rooted at game-template (which carries polkadot-api,
# @polkadot-api/sdk-ink, and hdkd). Node anchors ESM bare-specifier resolution
# at the importing file's location, so we run a copy from inside game-template
# and point CONTRACTS_DIR back at this contracts dir.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$CONTRACTS_DIR/.." && pwd)"
GAME_TEMPLATE="$REPO_DIR/game-template"

RUNNER="$GAME_TEMPLATE/.deploy-runner.mjs"
cp "$SCRIPT_DIR/deploy-and-verify.mjs" "$RUNNER"
trap 'rm -f "$RUNNER"' EXIT

cd "$GAME_TEMPLATE"
CONTRACTS_DIR="$CONTRACTS_DIR" node "$RUNNER"
