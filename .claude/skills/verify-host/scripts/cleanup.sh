#!/usr/bin/env bash
# Stops this worktree's fixture host, drops the verify database and the local R2/cache state.
# Evidence under .verify/ stays.
set -euo pipefail
source "$(dirname "$0")/env.sh"
(cd "$root/fixtures/host" && wtdev stop)
psql "$admin_url" -qc "drop database if exists $db with (force)"
rm -rf "$root/fixtures/host/.wrangler/verify" "$root/.verify/session.json"
echo "cleanup: done; evidence kept in $root/.verify/"
