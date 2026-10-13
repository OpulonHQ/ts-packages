#!/usr/bin/env bash
# Read-only: is the local fixture host worth driving? Exits non-zero on the first problem.
set -uo pipefail
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
port="$(cd "$root/fixtures/host" && wtdev port)"
base="http://127.0.0.1:$port"
fail() { echo "doctor: FAIL $*"; exit 1; }

(cd "$root/fixtures/host" && wtdev list) | grep -q "localhost:$port" || fail "no wtdev server on $port (cd fixtures/host && wtdev)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$base/api/me") || fail "nothing answers on $base"
[ "$code" = 401 ] || fail "GET /api/me answered $code, expected 401 signed out (port owned by something else?)"
built=$(curl -s "$base/admin/" | grep -o 'build-id" content="[^"]*"' | cut -d'"' -f3)
head=$(git -C "$root" rev-parse HEAD)
[ -n "$built" ] || fail "/admin/ has no build-id meta (run pnpm build)"
[ "$built" = "$head" ] || echo "doctor: WARN admin built from $built, HEAD is $head (pnpm build, then wtdev restart)"
[ -z "$(git -C "$root" status --porcelain -- packages)" ] || echo "doctor: WARN packages/ has uncommitted changes; the Worker bundles dist, rebuild if they matter"
psql "${DATABASE_URL_TEST:-postgres://postgres:postgres@127.0.0.1:54317/postgres}" -tAc "select 1 from pg_database where datname='${VERIFY_DB:-tspack_verify}'" | grep -q 1 || fail "database ${VERIFY_DB:-tspack_verify} missing"
echo "doctor: ok $base (build ${built:0:7})"
