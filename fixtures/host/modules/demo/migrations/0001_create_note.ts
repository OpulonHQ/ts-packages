import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table demo.note (id integer generated always as identity primary key, body text not null)`
  yield* sql`insert into demo.note (body) values ('hello from demo')`
})
