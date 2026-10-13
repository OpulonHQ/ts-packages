import { requirePermission } from '@opulonjs/core'
import { listDefaultPerPage } from '@opulonjs/core/api'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { type Collection, ItemPage, type ItemQuery, titleFieldOf } from '../api.ts'

export const listItems = Effect.fn('Items.list')(
  function* ({
    collection,
    definition,
    locale,
    query,
  }: {
    readonly collection: string
    readonly definition: Collection
    readonly locale: string
    readonly query: ItemQuery
  }) {
    yield* requirePermission('cms.collections.view')
    const sql = yield* SqlClient
    const field = titleFieldOf(definition)
    const value =
      field === undefined
        ? sql`null::jsonb`
        : definition.fields[field]?.localized
          ? sql`draft -> 'data' -> ${field} -> ${locale}`
          : sql`draft -> 'data' -> ${field}`
    const title = sql`coalesce(nullif(case when jsonb_typeof(${value}) = 'string' then ${value} #>> '{}' end, ''),
      nullif(draft -> 'locales' -> ${locale} -> 'seo' ->> 'title', ''),
      nullif(draft -> 'locales' -> ${locale} ->> 'path', ''), 'Untitled')`
    const perPage = query.perPage ?? listDefaultPerPage
    const page = query.page ?? 1
    const search = query.search?.trim()
    const direction = query.direction === 'asc' ? sql`asc` : sql`desc`
    const column = {
      title: sql`lower(title)`,
      path: sql`lower(path)`,
      status: sql`status`,
      updatedAt: sql`updated_at`,
    }[query.sort ?? 'updatedAt']
    const order = sql`${column} ${direction}, id ${direction}`
    const result = yield* sql`with summaries as not materialized (
      select id, key as collection, ${title} as title,
        coalesce(draft -> 'locales' -> ${locale} ->> 'path', '') as path,
        case when published is null then 'draft' when draft = published then 'published' else 'changed' end as status,
        updated_at, published_at
      from cms.document where kind = 'item' and key = ${collection}
    ), filtered as not materialized (
      select * from summaries ${search ? sql`where strpos(lower(title), lower(${search})) > 0 or strpos(lower(path), lower(${search})) > 0` : sql``}
    ), paged as (
      select * from filtered order by ${order} limit ${perPage} offset ${(page - 1) * perPage}
    ) select (select count(*)::float8 from filtered) as total,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'collection', collection, 'title', title, 'path', path, 'status', status,
        'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'publishedAt', to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by ${order}) from paged), '[]'::jsonb) as rows`
    return yield* Schema.decodeUnknownEffect(ItemPage)(result[0])
  },
  Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
)
