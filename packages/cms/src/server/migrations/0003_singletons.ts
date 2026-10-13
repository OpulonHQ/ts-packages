import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// Collections, site settings and menus (TSPACK-33) are further document kinds: items carry their
// collection in `key`; the site settings and each menu are singletons, one row per key.
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create unique index document_singleton on cms.document (kind, key)
    where kind in ('settings', 'menu')`
  yield* sql`create index document_kind_key on cms.document (kind, key, updated_at desc)`
})
