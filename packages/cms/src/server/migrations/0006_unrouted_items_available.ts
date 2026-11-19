import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

/** Items of unrouted collections were listed in every locale whatever `available` held: every
 *  stored locale becomes available, in draft and published alike, so a draft equal to its
 *  published document stays equal. */
export default (collections: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (collections.length === 0) return
    const sql = yield* SqlClient
    const available = (column: string) =>
      sql`jsonb_set(${sql(column)}, '{locales}', coalesce((
        select jsonb_object_agg(l.key, l.value || '{"available": true}')
        from jsonb_each(${sql(column)} -> 'locales') l), '{}'))`
    yield* sql`update cms.document
      set draft = ${available('draft')},
        published = case when published is not null then ${available('published')} end
      where kind = 'item' and key in ${sql.in(collections)}`
  })
