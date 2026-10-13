#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$root/fixtures/host"
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$db_url"
exec pnpm dlx wrangler@4.150.0 dev \
  ../../.claude/skills/verify-host/scripts/cache-purge-worker.ts \
  --config wrangler.jsonc \
  --port "$port" --ip 127.0.0.1 \
  --persist-to .wrangler/verify --test-scheduled \
  --var "OPULON_BUILD_ID:$(sed -n 's/.*build-id" content="\([^"]*\)".*/\1/p' public/admin/index.html | head -n 1)" \
  --var "USERS_BASE_URL:$base" \
  --var "USERS_AUTH_SECRET:verify-host-local-secret-0123456789abcdef" \
  --var "VERIFY_CACHE_PURGE:${VERIFY_CACHE_PURGE:-refused}"
