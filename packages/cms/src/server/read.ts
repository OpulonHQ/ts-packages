import { ContentLocales } from '@opulonjs/core'
import { MediaLibrary, type ResolvedMedia } from '@opulonjs/media/server'
import { Effect, Option, Predicate, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import type { Fragment } from 'effect/sql/Statement'
import {
  type Alternate,
  CmsInvalid,
  type CmsDefinitions,
  CmsNotFound,
  type FieldGroup,
  ItemDocument,
  type Link,
  MenuDocument,
  PageDocument,
  type PublicData,
  type PublicItems,
  publicPath,
  type PublicSite,
  type ResolveResult,
  SettingsDocument,
} from '../api.ts'
import { cacheTags } from './cache.ts'
import { localizeData, uuid } from './document.ts'
import { canonicalPath, Redirects } from './redirects.ts'
import { allLinks, resolveLinks, resolveMenuItems } from './site.ts'

/** A Read API answer and its Cache-Tags. */
export interface Tagged<A> {
  readonly body: A
  readonly tags: ReadonlyArray<string>
}

const isLink = (value: unknown): value is Link =>
  Predicate.isObject(value) && 'type' in value && typeof value.type === 'string'

const decodePage = Schema.decodeUnknownSync(PageDocument)
const decodeItem = Schema.decodeUnknownSync(ItemDocument)
const decodeSettings = Schema.decodeUnknownSync(SettingsDocument)
const decodeMenu = Schema.decodeUnknownSync(MenuDocument)

const PublishedRow = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['page', 'item']),
  key: Schema.NullOr(Schema.String),
  published: Schema.Unknown,
  published_at: Schema.Date,
})
const decodePublished = Schema.decodeUnknownSync(Schema.Array(PublishedRow))

/**
 * The Read API (TSPACK-11 §11): published content only, for anyone. Every method answers with
 * the Cache-Tags its body depends on (see `cacheTags`).
 */
export const makeReader = (definitions: CmsDefinitions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const media = yield* MediaLibrary
    const redirects = yield* Redirects
    const locales = yield* ContentLocales
    const defaultLocale = locales[0]!
    const pathOf = (locale: string, path: string) => publicPath(locales, locale, path)
    const withSql = Effect.provideService(SqlClient, sql)

    /**
     * Field groups' data in one locale, ready for a public site: localized fields resolved,
     * media ids to `ResolvedMedia` (null when gone), links to `ResolvedLink`. Media and links
     * of all groups (plus `extra`) are looked up together.
     */
    const publicContent = (
      locale: string,
      contents: ReadonlyArray<{ readonly group: FieldGroup; readonly data: PublicData }>,
      extra: { readonly media?: ReadonlyArray<string>; readonly links?: ReadonlyArray<Link> } = {},
    ) =>
      Effect.gen(function* () {
        const localized = contents.map(({ group, data }) => ({
          group,
          data: localizeData(group, data, locale, defaultLocale),
        }))
        const mediaIds = [...(extra.media ?? [])]
        const links = [...(extra.links ?? [])]
        for (const { group, data } of localized)
          for (const [name, field] of Object.entries(group.fields)) {
            const value = data[name]
            if (field.kind === 'media' && typeof value === 'string') mediaIds.push(value)
            if (field.kind === 'link' && isLink(value)) links.push(value)
          }
        const [resolved, linked] = yield* Effect.all(
          [
            media.resolve(mediaIds, locale),
            resolveLinks(links, locale).pipe(withSql, Effect.orDie),
          ],
          { concurrency: 'unbounded' },
        )
        const mediaOf = (id: string | null): ResolvedMedia | null =>
          id === null ? null : (resolved.get(id) ?? null)
        return {
          data: localized.map(({ group, data }) =>
            Object.fromEntries(
              Object.entries(data).map(([name, value]) => {
                const kind = group.fields[name]?.kind
                if (kind === 'media' && typeof value === 'string') return [name, mediaOf(value)]
                if (kind === 'link' && isLink(value))
                  return [name, { ...value, href: linked.href(value) }]
                return [name, value]
              }),
            ),
          ),
          media: mediaOf,
          href: linked.href,
          tags: linked.tags,
        }
      })

    const checkLocale = (requested: string | undefined) =>
      requested === undefined
        ? Effect.succeed(defaultLocale)
        : locales.includes(requested)
          ? Effect.succeed(requested)
          : Effect.fail(new CmsInvalid({ message: `"${requested}" is not a content locale.` }))

    /** Splits a decoded public path into its content locale and locale-relative path. */
    const split = (path: string) => {
      const [, first, rest] = /^\/([^/]+)(\/.*)?$/.exec(path) ?? []
      return first !== undefined && locales.includes(first)
        ? { locale: first, path: rest ?? '/', prefixed: true }
        : { locale: defaultLocale, path, prefixed: false }
    }

    const routes = [cacheTags.all, cacheTags.routes]
    const notFound = (locale: string): Tagged<ResolveResult> => ({
      body: { kind: 'not_found', locale },
      tags: routes,
    })
    // Every redirect stays on the site: one leading `/`, never `//` or `/\` (which browsers read
    // as another host), whatever a stored row holds.
    const redirect = (locale: string, to: string, status: 301 | 302): Tagged<ResolveResult> =>
      /^\/(?![/\\])/.test(to)
        ? { body: { kind: 'redirect', locale, to, status }, tags: routes }
        : notFound(locale)

    /** A published page or item at `path` in `locale`, rendered for the public site. */
    const document = (locale: string, path: string) =>
      Effect.gen(function* () {
        const [row] = decodePublished(
          yield* sql`select d.id, d.kind, d.key, d.published, d.published_at
            from cms.path p join cms.document d on d.id = p.document_id
            where p.locale = ${locale} and p.path = ${path} and d.published is not null`,
        )
        if (!row) return Option.none()
        const paths = yield* sql<{ locale: string; path: string }>`
          select locale, path from cms.path where document_id = ${row.id}`
        const alternates: Array<Alternate> = locales.flatMap((l) => {
          const own = paths.find((p) => p.locale === l)
          return own ? [{ locale: l, path: pathOf(l, own.path) }] : []
        })
        const common = (
          seo: PageDocument['locales'][string]['seo'],
          image: ResolvedMedia | null,
        ) => ({
          id: row.id,
          locale,
          path: pathOf(locale, path),
          alternates,
          seo: { ...seo, image },
          publishedAt: row.published_at.toISOString(),
        })
        if (row.kind === 'page') {
          const page = decodePage(row.published)
          const seo = page.locales[locale]!.seo
          const sections = page.sections.flatMap((s) => {
            const group = Object.hasOwn(definitions.sections, s.type)
              ? definitions.sections[s.type]
              : undefined
            // A section type the host removed is not rendered.
            return group ? [{ section: s, group }] : []
          })
          const content = yield* publicContent(
            locale,
            sections.map(({ section, group }) => ({ group, data: section.data })),
            { media: seo.image === null ? [] : [seo.image] },
          )
          return Option.some<Tagged<ResolveResult>>({
            body: {
              kind: 'page',
              ...common(seo, content.media(seo.image)),
              systemKey: row.key,
              sections: sections.map(({ section }, i) => ({
                id: section.id,
                type: section.type,
                data: content.data[i]!,
              })),
            },
            tags: [cacheTags.all, cacheTags.page(row.id), ...content.tags],
          })
        }
        const collection =
          row.key !== null && Object.hasOwn(definitions.collections, row.key)
            ? definitions.collections[row.key]
            : undefined
        if (!collection) return Option.none()
        const item = decodeItem(row.published)
        const seo = item.locales[locale]!.seo
        const content = yield* publicContent(locale, [{ group: collection, data: item.data }], {
          media: seo.image === null ? [] : [seo.image],
        })
        return Option.some<Tagged<ResolveResult>>({
          body: {
            kind: 'item',
            ...common(seo, content.media(seo.image)),
            collection: row.key!,
            data: content.data[0]!,
          },
          tags: [cacheTags.all, cacheTags.item(row.id), ...content.tags],
        })
      })

    const resolve = (raw: string) =>
      Effect.gen(function* () {
        let decoded: string
        try {
          decoded = decodeURIComponent(raw)
        } catch {
          return notFound(defaultLocale)
        }
        // Only site paths (the redirects' rules: no `//`, `\`, control characters, query or
        // fragment), so a canonical redirect below never points off the site.
        const canonical = canonicalPath(decoded)
        if (canonical === undefined) return notFound(defaultLocale)
        const { locale, path, prefixed } = split(canonical)
        // One canonical form per page: no empty or dot segments, no trailing slash, no prefix
        // for the default locale.
        if (canonical !== decoded || (prefixed && locale === defaultLocale))
          return redirect(locale, pathOf(locale, path), 301)
        const found = yield* document(locale, path)
        if (Option.isSome(found)) return found.value
        const rule = yield* redirects.lookup(locale, path)
        return Option.isSome(rule)
          ? redirect(locale, pathOf(locale, rule.value.to), rule.value.status)
          : notFound(locale)
      }).pipe(Effect.orDie)

    const site = (requested: string | undefined) =>
      Effect.gen(function* () {
        const locale = yield* checkLocale(requested)
        const rows = yield* sql<{ kind: string; key: string; published: unknown }>`
          select kind, key, published from cms.document
          where kind in ('settings', 'menu') and published is not null`.pipe(Effect.orDie)
        const settings = rows.find((r) => r.kind === 'settings')
        const menus = new Map(
          rows.filter((r) => r.kind === 'menu').map((r) => [r.key, decodeMenu(r.published).items]),
        )
        const systemLinks = Object.keys(definitions.systemPages).map((key) => ({
          type: 'system' as const,
          key,
        }))
        const content = yield* publicContent(
          locale,
          [
            {
              group: definitions.settings,
              data: settings ? decodeSettings(settings.published).data : {},
            },
          ],
          { links: [...systemLinks, ...[...menus.values()].flatMap(allLinks)] },
        )
        const body: PublicSite = {
          locale,
          locales,
          settings: content.data[0]!,
          menus: Object.fromEntries(
            Object.keys(definitions.menus).map((key) => [
              key,
              resolveMenuItems(menus.get(key) ?? [], locale, defaultLocale, content.href),
            ]),
          ),
          systemPages: Object.fromEntries(systemLinks.map((l) => [l.key, content.href(l)])),
        }
        return { body, tags: [cacheTags.all, cacheTags.site, ...content.tags] }
      })

    const collection = (
      key: string,
      query: {
        readonly locale?: string
        readonly page?: number
        readonly perPage?: number
        readonly sort?: 'newest' | 'oldest'
        readonly ref?: string
        readonly ids?: string
      },
    ) =>
      Effect.gen(function* () {
        const definition = Object.hasOwn(definitions.collections, key)
          ? definitions.collections[key]
          : undefined
        if (!definition) return yield* new CmsNotFound({ id: key })
        const locale = yield* checkLocale(query.locale)
        const page = query.page ?? 1
        const perPage = query.perPage ?? 20
        const filters: Array<Fragment> = [
          sql`d.kind = 'item'`,
          sql`d.key = ${key}`,
          sql`d.published is not null`,
        ]
        // Routed items are listed in the locales they are published in.
        if (definition.routed) filters.push(sql`p.path is not null`)
        if (query.ref !== undefined) {
          if (!uuid.test(query.ref))
            return yield* new CmsInvalid({ message: '"ref" must be an item id.' })
          const fields = Object.entries(definition.fields).filter(([, f]) => f.kind === 'reference')
          filters.push(
            fields.length === 0
              ? sql`false`
              : sql.or(
                  fields.map(
                    ([name]) => sql`d.published->'data'->${name} @> to_jsonb(${query.ref}::text)`,
                  ),
                ),
          )
        }
        if (query.ids !== undefined) {
          const ids = [...new Set(query.ids.split(',').map((id) => id.trim()))]
          if (ids.length > 100 || !ids.every((id) => uuid.test(id)))
            return yield* new CmsInvalid({ message: '"ids" must list at most 100 item ids.' })
          filters.push(sql`d.id in ${sql.in(ids)}`)
        }
        const from = sql`cms.document d
          left join cms.path p on p.document_id = d.id and p.locale = ${locale}
          where ${sql.and(filters)}`
        const order = sql.literal(query.sort === 'oldest' ? 'asc' : 'desc')
        const [count, rows] = yield* Effect.all(
          [
            sql<{ total: string }>`select count(*) as total from ${from}`,
            sql<{ id: string; published: unknown; published_at: Date; path: string | null }>`
              select d.id, d.published, d.published_at, p.path from ${from}
              order by d.published_at ${order}, d.id ${order}
              limit ${perPage} offset ${(page - 1) * perPage}`,
          ],
          { concurrency: 'unbounded' },
        ).pipe(Effect.orDie)
        const items = rows.map((r) => ({ ...r, document: decodeItem(r.published) }))
        const content = yield* publicContent(
          locale,
          items.map((i) => ({ group: definition, data: i.document.data })),
        )
        const body: PublicItems = {
          rows: items.map((item, i) => ({
            id: item.id,
            collection: key,
            path: item.path === null ? null : pathOf(locale, item.path),
            data: content.data[i]!,
            publishedAt: item.published_at.toISOString(),
          })),
          total: Number(count[0]?.total ?? 0),
          page,
          perPage,
        }
        return { body, tags: [cacheTags.all, cacheTags.collection(key), ...content.tags] }
      })

    return { resolve, site, collection }
  })
