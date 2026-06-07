#!/usr/bin/env bash
# ⚠️ INVALID — DO NOT USE. Retained only as a record of a wrong approach.
#
# This script curled `<label>.app.dot.li` directly and compared asset hashes.
# That is fundamentally misleading: per the dotli source, `<label>.app.dot.li`
# is a SANDBOX IFRAME whose Service Worker serves the app's assets from an
# in-memory archive keyed to a `?cid=` URL param. A direct curl (no host shell,
# no ?cid, no SW archive loaded) returns NGINX's SPA fallback HTML or a 503 —
# never the dApp's real assets. The "stale build / hash divergence" this script
# reported was an artifact of testing the wrong origin.
#
# CORRECT way to diagnose a deployed dApp's asset serving:
#   1. Open https://<label>.dot.li in a browser (the HOST SHELL).
#   2. DevTools → Network: watch the iframe at <label>.app.dot.li/?cid=… and
#      look for 503s or 404s on JS chunks served by the Service Worker.
#   3. Or resolve the DotNS name → CID and inspect the published archive's file
#      listing to confirm every chunk (e.g. the product-sdk chunk) is present.
#
# Real cause of the item-6 "dynamically imported module 404": likely an
# incomplete published archive, a bitswap/IPFS fetch failing partway, or the SW
# 503ing before the archive finished loading. See BUILD_PLAN.md item 10b.
echo "This repro is invalid; see the comment block and BUILD_PLAN.md item 10b." >&2
exit 2
