#!/bin/bash
# Deploy ALL six arcade apps (5 games + dashboard) in one `playground deploy-all`
# batch (playground-cli >= 0.33, upstream PR #301).
#
# Why the pre-build stage: the five games share ONE project (game-template) and
# their per-game identity is baked in at BUILD time (src/games/active.ts swap +
# arcade.config.json + cdm.json contract address). Parallel builds in one dir
# would race, so each game is built SEQUENTIALLY (~2s each) into its own
# dist-<domain>, the tree is restored to Snake, and deploy-all then runs with
# --no-build over the prebuilt outputs. With a single dev signer, deploy-all
# serializes the on-chain work per signer (nonce safety) — the win over the old
# per-app serial script is orchestration: one command, no watchdog, --json.
#
# Usage: ./deploy.sh [--games-only]
set -euo pipefail
cd "$(dirname "$0")"
GT=game-template
TARGET="b7a87bf51613d89f"
GAMES_ONLY="${1:-}"

# set_game <Component> <import-path> <Title> <name> <gtype> <desc> <domain> <addr> <ord> <fmt> <unit>
set_game() {
  local comp="$1" path="$2" title="$3" name="$4" gtype="$5" desc="$6" domain="$7" addr="$8" ord="$9" fmt="${10}" unit="${11}"
  perl -i -pe "s{export \\{ \\w+ as ActiveGame \\} from \"[^\"]+\";}{export { $comp as ActiveGame } from \"$path\";}" "$GT/src/games/active.ts"
  perl -i -pe "s{export const ACTIVE_GAME_TITLE = \"[^\"]+\";}{export const ACTIVE_GAME_TITLE = \"$title\";}" "$GT/src/games/active.ts"
  jq --arg name "$name" --arg gt "$gtype" --arg desc "$desc" --arg dom "$domain" --argjson ord "$ord" --argjson fmt "$fmt" --arg unit "$unit" \
    '.name=$name|.gameType=$gt|.shortDescription=$desc|.domain=$dom|.contract.scoreOrdering=$ord|.contract.scoreFormat=$fmt|.contract.scoreUnit=$unit' \
    "$GT/arcade.config.json" > "$GT/.acfg.tmp" && mv "$GT/.acfg.tmp" "$GT/arcade.config.json"
  jq --arg addr "$addr" ".contracts[\"$TARGET\"][\"@arcade/gcs-reference\"].address=\$addr" \
    "$GT/cdm.json" > "$GT/.cdm.tmp" && mv "$GT/.cdm.tmp" "$GT/cdm.json"
}

build_game() { # <domain>
  echo "── building $1"
  ( cd "$GT" && rm -rf "dist-$1" && npm run build --silent -- --outDir "dist-$1" )
}

# ── Stage 1: sequential per-game builds, each into dist-<domain> ─────────────
set_game "SnakeGame" "./snake/SnakeGame" "Snake" "Snake" "arcade" \
  "Classic Snake. Eat, grow, don't bite your tail. Each apple is a point — beat the leaderboard." \
  "arcade-snake" "0x5d38af8b84c06d26113d94b596ccca99f2078acc" 0 0 ""
build_game "arcade-snake"

set_game "FlappyBird" "./flappy-bird/FlappyBird" "Flappy Bird" "Flappy Bird" "arcade" \
  "Tap to fly. Steer through the pipes without crashing — each pipe is a point. Beat the leaderboard." \
  "arcade-flappy" "0xd276c6301da46d1e1a29cc5ec774f1f19ba0f91b" 0 0 ""
build_game "arcade-flappy"

set_game "Wordle" "./wordle/Wordle" "Wordle" "Wordle" "puzzle" \
  "Guess the hidden 5-letter word in six tries. Fewer guesses wins — climb the leaderboard." \
  "arcade-wordle" "0x41421bee36c71090a2fc0f913a86537219e018cf" 1 2 "guesses"
build_game "arcade-wordle"

set_game "Game2048" "./g2048/Game2048" "2048" "2048" "puzzle" \
  "Slide and merge tiles. Combine matching numbers to climb toward 2048 — higher merges, higher score." \
  "arcade-2048-game" "0xa618f83f722b25101a2d0c8bb94974c889c6865b" 0 0 ""
build_game "arcade-2048-game"

set_game "SpaceInvaders" "./space-invaders/SpaceInvaders" "Space Invaders" "Space Invaders" "arcade" \
  "Classic Space Invaders. Blast the descending alien fleet before it reaches you. 10 points per alien." \
  "arcade-invaders" "0x0fd7ea0a0d8417c9b262577ff3dcb69c8d0fcabe" 0 0 ""
build_game "arcade-invaders"

# Restore the template tree to the committed (Snake) state.
( cd "$GT" && git checkout -- src/games/active.ts arcade.config.json cdm.json )
echo "── template restored to Snake"

# Dashboard builds in its own dir; no config swapping needed.
MANIFEST=arcade.apps.json
if [ "$GAMES_ONLY" = "--games-only" ]; then
  jq '.apps |= map(select(.dir != "dashboard"))' arcade.apps.json > .apps.tmp.json && mv .apps.tmp.json .apps.games.json
  MANIFEST=.apps.games.json
else
  echo "── building dashboard"
  ( cd dashboard && npm run build --silent )
fi

# ── Stage 2: one batch deploy for everything ────────────────────────────────
echo "── playground deploy-all ($MANIFEST)"
playground deploy-all --manifest "$MANIFEST" --signer dev --no-build --playground --concurrency 6 --json
rm -f .apps.games.json
