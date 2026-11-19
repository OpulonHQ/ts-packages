import { requirePermission } from '@opulonjs/core'
import { listDefaultPerPage } from '@opulonjs/core/api'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { CmsInvalid, type Collection, ItemPage, type ItemQuery, titleFieldOf } from '../api.ts'

export const listItems = Effect.fn('Items.list')(
  function* ({
    collection,
    definition,
    locales,
    query,
  }: {
    readonly collection: string
    readonly definition: Collection
    readonly locales: ReadonlyArray<string>
    readonly query: ItemQuery
  }) {
    yield* requirePermission('cms.collections.view')
    const sql = yield* SqlClient
    const locale = locales[0]!
    if (query.availableIn !== undefined && !locales.includes(query.availableIn))
      return yield* new CmsInvalid({ message: `"${query.availableIn}" is not a content locale.` })
    const availableIn = (code: string) =>
      sql`coalesce((draft -> 'locales' -> ${code} ->> 'available')::boolean, ${sql.literal(definition.routed ? 'false' : 'true')})`
    const each = locales.map((code) => sql`case when ${availableIn(code)} then ${code}::text end`)
    const available = sql`array_remove(array[${sql.csv(each)}], null)`

    const field = titleFieldOf(definition)
    const value =
      field === undefined
        ? sql`null::jsonb`
        : definition.fields[field]?.localized
          ? sql`draft -> 'data' -> ${field} -> shown`
          : sql`draft -> 'data' -> ${field}`
    const title = sql`coalesce(nullif(case when jsonb_typeof(${value}) = 'string' then ${value} #>> '{}' end, ''),
      nullif(draft -> 'locales' -> shown -> 'seo' ->> 'title', ''), nullif(own_path, ''), 'Untitled')`
    // `publicPath` in SQL: search and sort see the path the list shows.
    const path = sql`case when own_path = '' or shown = ${locale} then own_path
      when own_path = '/' then '/' || shown else '/' || shown || own_path end`
    const perPage = query.perPage ?? listDefaultPerPage
    const page = query.page ?? 1
    const search = query.search?.trim()
    const ids =
      query.ids === undefined ? undefined : [...new Set(query.ids.toLowerCase().split(','))]
    const filters = []
    for (const filter of query.filter ?? []) {
      const at = filter.indexOf(':')
      const name = filter.slice(0, at)
      if (!definition.filters?.includes(name))
        return yield* new CmsInvalid({ message: `The list cannot be filtered by "${name}".` })
      const stored = definition.fields[name]?.localized
        ? sql`draft -> 'data' -> ${name} -> ${locale}`
        : sql`draft -> 'data' -> ${name}`
      filters.push(sql`${stored} @> to_jsonb(${filter.slice(at + 1)}::text)`)
    }
    const direction = query.direction === 'asc' ? sql`asc` : sql`desc`
    const column = {
      title: sql`lower(title)`,
      path: sql`lower(path)`,
      status: sql`status`,
      updatedAt: sql`updated_at`,
    }[query.sort ?? 'updatedAt']
    const order = sql`${column} ${direction}, id ${direction}`
    if (query.availableIn !== undefined) filters.push(availableIn(query.availableIn))
    const result = yield* sql`with documents as not materialized (
      select *, ${available} as locales from cms.document
      where kind = 'item' and key = ${collection}
        ${ids ? sql`and id = any(string_to_array(${ids.join(',')}, ',')::uuid[])` : sql``}
        and ${sql.and(filters)}
    ), shown as not materialized (
      select *, coalesce(draft -> 'locales' -> shown ->> 'path', '') as own_path from (
        select *, case when ${locale}::text = any(locales) or cardinality(locales) = 0
          then ${locale}::text else locales[1] end as shown
        from documents) d
    ), summaries as not materialized (
      select id, key as collection, ${title} as title, ${path} as path, locales,
        case when published is null then 'draft' when draft = published then 'published' else 'changed' end as status,
        updated_at, published_at, version
      from shown
    ), filtered as not materialized (
      select * from summaries ${search ? sql`where strpos(lower(title), lower(${search})) > 0 or strpos(lower(path), lower(${search})) > 0` : sql``}
    ), paged as (
      select * from filtered order by ${order} limit ${perPage} offset ${(page - 1) * perPage}
    ) select (select count(*)::float8 from filtered) as total,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'collection', collection, 'title', title, 'path', path,
        'locales', to_jsonb(locales), 'status', status,
        'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'publishedAt', to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'version', version
      ) order by ${order}) from paged), '[]'::jsonb) as rows`
    return yield* Schema.decodeUnknownEffect(ItemPage)(result[0])
  },
  Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
)
