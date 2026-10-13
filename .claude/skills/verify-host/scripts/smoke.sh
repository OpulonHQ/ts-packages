#!/usr/bin/env bash
# Runs scripts/smoke.ts (the deploy smoke) against the local fixture host. Local workerd never
# fires crons by itself, so this triggers the */5 handler through /__scheduled every 5 s while
# the smoke waits for its queued email to be swept. Output is tee'd to the evidence dir.
set -euo pipefail
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
port="$(cd "$root/fixtures/host" && wtdev port)"
base="http://127.0.0.1:$port"
admin_url="${DATABASE_URL_TEST:-postgres://postgres:postgres@127.0.0.1:54317/postgres}"
out="${EVIDENCE_DIR:-$root/.verify/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$out"

( while sleep 5; do curl -s -o /dev/null "$base/__scheduled?cron=*/5+*+*+*+*" || true; done ) &
ticker=$!
trap 'kill $ticker 2>/dev/null' EXIT

cd "$root"
SMOKE_URL="$base" DATABASE_URL_DIRECT="${admin_url%/*}/${VERIFY_DB:-tspack_verify}" \
  SMOKE_CRON_WAIT_MS=60000 node scripts/smoke.ts 2>&1 | tee "$out/smoke.log"
echo "evidence: $out/smoke.log"
