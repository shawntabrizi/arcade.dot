#!/usr/bin/env bash
# Playground starter setup — runs after `dot mod` clones the repo.
set -euo pipefail

echo "[setup] Arcade Dashboard"

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

cat <<'EOF'

[setup] Done.

To run the dashboard:
  npm run dev

The dashboard reads @example/arcade-playground on Paseo Asset Hub by default
(see cdm.json). No deploy is needed — the Arcade is a shared singleton.

To publish to Polkadot Playground:
  dot deploy --playground
EOF
