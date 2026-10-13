import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table demo.tick (
    id integer generated always as identity primary key,
    actor text not null,
    confirmed boolean not null default false,
    at timestamptz not null default now()
  )`
})
