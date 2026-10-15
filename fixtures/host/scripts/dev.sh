#!/usr/bin/env bash
# The fixture host Worker locally in workerd (wrangler dev) against the CONTRIBUTING Postgres 17.
# Start with `wtdev` from fixtures/host (port from $PORT, memory cap). Needs `pnpm build` first:
# wrangler bundles the packages from dist and serves the admin SPA from public/admin.
set -euo pipefail

: "${PORT:?run through wtdev, or set PORT}"
source "$(dirname "$0")/../../../.claude/skills/verify-host/scripts/env.sh"
host="$root/fixtures/host"

[ -f "$host/public/admin/index.html" ] || { echo "verify-host: run pnpm build first" >&2; exit 1; }
[ -f "$host/public/site/index.html" ] || { echo "verify-host: run pnpm build first" >&2; exit 1; }
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
  --var "OPULON_BUILD_ID:$(grep -o 'build-id" content="[^"]*"' public/admin/index.html | cut -d'"' -f3)" \
  --var "USERS_BASE_URL:$base" \
  --var "USERS_AUTH_SECRET:verify-host-local-secret-0123456789abcdef"
