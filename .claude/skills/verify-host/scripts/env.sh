# Sourced by the verify-host helpers and fixtures/host/scripts/dev.sh: one place for the
# worktree's port, origin and database, so two worktrees never share a verify database.
root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
port="${PORT:-$(cd "$root/fixtures/host" && wtdev port)}"
base="http://127.0.0.1:$port"
admin_url="${DATABASE_URL_TEST:-postgres://postgres:postgres@127.0.0.1:54317/postgres}"
db="${VERIFY_DB:-tspack_verify_$(basename "$root" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' _ | cut -c1-40)}"
db_url="${admin_url%/*}/$db"
