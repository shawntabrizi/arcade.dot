#!/usr/bin/env bash
# Reproduce the playground frontend-serving divergence that broke item-6
# sign-in ("product-sdk import failed: dynamically imported module 404").
#
# Thesis: `<label>.app.dot.li` serves content that LAGS / DIVERGES from what
# `playground deploy` last published. During a deploy/propagation window the
# served index.html can reference JS chunks the edge doesn't (yet) serve →
# the browser's dynamic import() 404s → sign-in throws.
#
# Usage:  ./repro.sh <label> [path/to/local/dist]
#   e.g.  ./repro.sh arcade-snake ../../game-template/dist
set -uo pipefail

LABEL="${1:-arcade-snake}"
DIST="${2:-../../game-template/dist}"
HOST="https://${LABEL}.app.dot.li"

echo "== 1. Entry JS the live edge (${HOST}) references =="
served=$(curl -s --max-time 30 "$HOST/" | grep -oE 'src="/assets/[A-Za-z0-9_.-]+\.js"' | head -1)
echo "   served: ${served:-<none>}"

echo "== 2. Entry JS in the local build that was last deployed =="
if [ -f "$DIST/index.html" ]; then
  local_entry=$(grep -oE 'src="/?assets/[A-Za-z0-9_.-]+\.js"' "$DIST/index.html" | head -1)
  echo "   local : ${local_entry:-<none>}"
else
  echo "   local : <no dist at $DIST>"
fi

echo "== 3. Does every asset the SERVED index references resolve on the same host? =="
curl -s --max-time 30 "$HOST/" \
  | grep -oE '/assets/[A-Za-z0-9_.-]+\.(js|css)' | sort -u \
  | while read -r f; do
      printf "   %s  %s\n" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$HOST$f")" "$f"
    done

echo
echo "INTERPRETATION:"
echo " - If 'served' (step1) != 'local' (step2): the edge is serving a STALE"
echo "   build, not your latest deploy → DotNS/edge cache lags publish."
echo " - If any asset in step3 is NOT 200: the served index references a chunk"
echo "   the edge can't serve → that is exactly the dynamic-import 404 that"
echo "   broke sign-in. (It is intermittent: only while a partial/old build is"
echo "   the live one.)"
