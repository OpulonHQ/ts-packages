#!/usr/bin/env bash
# Read-only: is the local fixture host worth driving? Exits non-zero on the first problem.
set -uo pipefail
source "$(dirname "$0")/env.sh"
fail() { echo "doctor: FAIL $*"; exit 1; }

(cd "$root/fixtures/host" && wtdev list) | grep -q "localhost:$port" || fail "no wtdev server on $port (cd fixtures/host && wtdev)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$base/api/me") || fail "nothing answers on $base"
[ "$code" = 401 ] || fail "GET /api/me answered $code, expected 401 signed out (port owned by something else?)"
built=$(curl -s "$base/admin/" | grep -o 'build-id" content="[^"]*"' | cut -d'"' -f3)
[ -n "$built" ] || fail "/admin/ has no build-id meta (run pnpm build)"
git -C "$root" diff --quiet "$built" -- packages fixtures/host ":!fixtures/host/scripts" 2>/dev/null || echo "doctor: WARN packages or fixtures/host changed since the build at ${built:0:7} (pnpm build, then wtdev restart)"
psql "$admin_url" -tAc "select 1 from pg_database where datname='$db'" | grep -q 1 || fail "database $db missing"
echo "doctor: ok $base (build ${built:0:7}, database $db)"
