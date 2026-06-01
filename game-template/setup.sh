#!/usr/bin/env bash
# Playground starter setup — runs after `dot mod` clones the repo.
# Safe to re-run. The npm install completes in well under a minute;
# the contract deploy is a separate step (see README.md).

set -euo pipefail

echo "[setup] Leaderboard Playground"

if [ -f "package.json" ]; then
    if command -v pnpm >/dev/null 2>&1; then
        echo "[setup] pnpm detected — installing dependencies..."
        pnpm install
    elif command -v npm >/dev/null 2>&1; then
        echo "[setup] npm detected — installing dependencies..."
        npm install --no-audit --no-fund
    else
        echo "[setup] ERROR: no npm or pnpm on PATH. Install Node.js (>= 20) and try again." >&2
        exit 1
    fi
fi

echo
if ! command -v dot >/dev/null 2>&1; then
    echo "[setup] WARNING: dot CLI not found. Install it before deploying:"
    echo "  curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | bash"
fi

cat <<'EOF'

[setup] Done.

To run with the on-chain leaderboard (the default):
  dot deploy --contracts             # build + deploy the leaderboard contract
  npm run dev                        # start the dev server

To publish to Polkadot Playground:
  dot deploy --contracts --playground --moddable

To run without deploying (localStorage fallback):
  See docs/modding.md → "Swap the backend → drop back to localStorage".

To swap the game:
  See docs/modding.md → "Swap the game" and src/games/types.ts.
EOF
