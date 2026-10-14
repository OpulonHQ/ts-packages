import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create index document_item_list on cms.document (key, updated_at desc, id desc)
    where kind = 'item'`
})
