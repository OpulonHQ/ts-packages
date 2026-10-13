import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table core.cache_purge (
    id uuid primary key default gen_random_uuid(),
    tags text[] not null check (cardinality(tags) > 0),
    attempts integer not null default 0 check (attempts between 0 and 3),
    next_attempt_at timestamptz not null default now(),
    reason text check (reason in ('refused', 'failed', 'timeout', 'interrupted')),
    error text,
    created_at timestamptz not null default now()
  )`
  yield* sql`create index cache_purge_next_attempt_at on core.cache_purge (next_attempt_at)`
  yield* sql`create index cache_purge_created_at on core.cache_purge (created_at)`
})
