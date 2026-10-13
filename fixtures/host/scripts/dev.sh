#!/usr/bin/env bash
# The fixture host Worker locally in workerd (wrangler dev) against the CONTRIBUTING Postgres 17.
# Start with `wtdev` from fixtures/host (port from $PORT, memory cap). Needs `pnpm build` first:
# wrangler bundles the packages from dist and serves the admin SPA from public/admin.
set -euo pipefail

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
host="$root/fixtures/host"
admin_url="${DATABASE_URL_TEST:-postgres://postgres:postgres@127.0.0.1:54317/postgres}"
db="${VERIFY_DB:-tspack_verify}"
db_url="${admin_url%/*}/$db"
port="${PORT:?run through wtdev, or set PORT}"
origin="http://127.0.0.1:$port"

[ -f "$host/public/admin/index.html" ] || { echo "verify-host: run pnpm build first" >&2; exit 1; }
[ -f "$root/packages/core/dist/cli.mjs" ] || { echo "verify-host: run pnpm build first" >&2; exit 1; }

psql "$admin_url" -tAc "select 1 from pg_database where datname = '$db'" | grep -q 1 ||
  psql "$admin_url" -qc "create database $db"

cd "$host"
DATABASE_URL_DIRECT="$db_url" node node_modules/@opulonjs/core/dist/cli.mjs migrate --server server/opulon.ts

export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$db_url"
exec pnpm dlx wrangler@4.150.0 dev \
  --port "$port" --ip 127.0.0.1 \
  --persist-to .wrangler/verify \
  --test-scheduled \
  --var "OPULON_BUILD_ID:$(git rev-parse HEAD)" \
  --var "USERS_BASE_URL:$origin" \
  --var "USERS_AUTH_SECRET:verify-host-local-secret-0123456789abcdef"
