import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

/** Items of unrouted collections were listed in every locale whatever `available` held: every
 *  stored locale becomes available, in draft, published and revisions alike, so a draft equal to
 *  its published document stays equal and a restored revision stays listed. */
export default (collections: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (collections.length === 0) return
    const sql = yield* SqlClient
    const available = (column: string) =>
      sql`jsonb_set(${sql(column)}, '{locales}', coalesce((
        select jsonb_object_agg(l.key, l.value || '{"available": true}')
        from jsonb_each(${sql(column)} -> 'locales') l), '{}'))`
    const items = sql`select id from cms.document where kind = 'item' and key in ${sql.in(collections)}`
    yield* sql`update cms.document
      set draft = ${available('draft')},
        published = case when published is not null then ${available('published')} end
      where id in (${items})`
    yield* sql`update cms.revision set document = ${available('document')}
      where document_id in (${items})`
  })
