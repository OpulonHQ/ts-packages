import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create index user_list_name on users."user" (lower(name), id)`
  yield* sql`create index user_list_default on users."user" ((deactivated_at is not null), lower(name), id)`
})
