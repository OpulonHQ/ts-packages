#!/usr/bin/env bash
# Stops this worktree's fixture host, drops the verify database and the local R2/cache state.
# Evidence under .verify/ stays.
set -euo pipefail
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
admin_url="${DATABASE_URL_TEST:-postgres://postgres:postgres@127.0.0.1:54317/postgres}"
(cd "$root/fixtures/host" && wtdev stop)
psql "$admin_url" -qc "drop database if exists ${VERIFY_DB:-tspack_verify} with (force)"
rm -rf "$root/fixtures/host/.wrangler/verify"
echo "cleanup: done; evidence kept in $root/.verify/"
