import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table core.rate_limit (
    key bytea primary key,
    hits integer not null,
    expires_at timestamptz not null
  )`
  yield* sql`create index rate_limit_expires_at on core.rate_limit (expires_at)`
})
