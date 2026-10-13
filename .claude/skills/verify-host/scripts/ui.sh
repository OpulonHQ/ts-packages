#!/usr/bin/env bash
# Drives the admin SPA in headless Chrome: ui.sh <journey.mjs> [key=value ...]
# A journey exports `default async ({ page, base, shot, args, check })`; see journeys/sign-in.mjs.
# playwright-core lives in a cache dir outside the repo and drives the system google-chrome.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
deps="${XDG_CACHE_HOME:-$HOME/.cache}/verify-host"
[ -d "$deps/node_modules/playwright-core" ] || { mkdir -p "$deps" && echo "{}" >| "$deps/package.json" && pnpm add --dir "$deps" playwright-core@1.59.1 >/dev/null; }
export VERIFY_PW="$deps/node_modules/playwright-core/index.mjs"
export VERIFY_BASE="http://127.0.0.1:$(cd "$root/fixtures/host" && wtdev port)"
export EVIDENCE_DIR="${EVIDENCE_DIR:-$root/.verify/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$EVIDENCE_DIR"
exec node "$here/ui.mjs" "$(realpath "$1")" "${@:2}"
