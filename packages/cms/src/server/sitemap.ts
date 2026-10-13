import { type Contribution, ContentLocales, defineExtensionPoint } from '@opulonjs/core'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { type Alternate, CmsNotFound, publicPath } from '../api.ts'
import { cacheTags } from './cache.ts'
import { sitemapXml } from './sitemap-xml.ts'

/** One URL of a sitemap. */
export interface SitemapEntry {
  /** The public path (locale-prefixed, see `publicPath` in `@opulonjs/cms/api`). */
  readonly path: string
  /** ISO date-time of the last change. */
  readonly lastmod?: string
  /** The same content in every locale (this one included), for hreflang; `x-default` is added
   *  from the default locale's. */
  readonly alternates?: ReadonlyArray<Alternate>
}

/** A child sitemap: its key names the file (`<apiPrefix>/cms/sitemaps/<key>.xml`). */
export interface SitemapSource {
  /** Inside the contributing module's prefix, e.g. `shop.products`. */
  readonly key: string
  /** Every URL; only public, indexable content. Runs with the request's SqlClient. */
  readonly list: Effect.Effect<ReadonlyArray<SitemapEntry>, unknown, SqlClient>
}

/** cms's sitemap extension point; modules contribute through `sitemapSource`. */
export const SitemapSources = defineExtensionPoint<SitemapSource>('cms', 'sitemapSource')

/**
 * Declares a child sitemap. List the result in the module's `contributes` (the module must
 * depend on cms). Its answers carry the `cms:routes` Cache-Tag; a module whose URLs change
 * purges it with `CachePurge`, or waits for the cached sitemap to expire (one hour).
 */
export const sitemapSource = (source: SitemapSource): Contribution<SitemapSource> =>
  SitemapSources.contribute(source)

/**
 * cms's own sources: published pages (`cms.pages`) and the items of one routed collection
 * (`cms.items.<collection>`), one URL per published locale whose SEO is not `noindex`.
 */
export const documentsSource = (key: string, kind: 'page' | 'item', collection?: string) =>
  sitemapSource({
    key,
    list: Effect.gen(function* () {
      const sql = yield* SqlClient
      const locales = yield* ContentLocales
      const rows = yield* sql<{ id: string; published_at: Date; locale: string; path: string }>`
        select d.id, d.published_at, p.locale, p.path
        from cms.document d join cms.path p on p.document_id = d.id
        where d.kind = ${kind} ${collection === undefined ? sql`` : sql`and d.key = ${collection}`}
          and d.published is not null
          and coalesce((d.published->'locales'->p.locale->'seo'->>'noindex')::boolean, false) = false
        order by d.published_at, d.id`
      const byDocument = Map.groupBy(rows, (r) => r.id)
      return [...byDocument.values()].flatMap((paths) => {
        const alternates = locales.flatMap((locale) => {
          const own = paths.find((p) => p.locale === locale)
          return own ? [{ locale, path: publicPath(locales, locale, own.path) }] : []
        })
        return alternates.map((a) => ({
          path: a.path,
          lastmod: paths[0]!.published_at.toISOString(),
          alternates,
        }))
      })
    }),
  })

/** URLs per child file (the sitemaps protocol's limit). */
export { maxUrls } from './sitemap-xml.ts'

const latest = (entries: ReadonlyArray<SitemapEntry>) =>
  entries.reduce<string | undefined>(
    (max, e) =>
      e.lastmod !== undefined && (max === undefined || e.lastmod > max) ? e.lastmod : max,
    undefined,
  )

/** The sitemap index and its children for the composed sources (TSPACK-11 decision 14). */
export const makeSitemaps = Effect.gen(function* () {
  const sources = yield* SitemapSources.collect
  const sql = yield* SqlClient
  const locales = yield* ContentLocales
  const tags = [cacheTags.all, cacheTags.routes]

  const files = (origin: string, source: SitemapSource) =>
    source.list.pipe(
      Effect.provideService(SqlClient, sql),
      Effect.orDie,
      Effect.flatMap((entries) => sitemapXml(origin, locales).files(source.key, entries)),
    )

  return {
    /** `children` is the path the child files are served under (ends with `/`). */
    index: (origin: string, children: string) =>
      Effect.gen(function* () {
        const xml = sitemapXml(origin, locales)
        const all = (yield* Effect.forEach(sources, (source) => files(origin, source))).flat()
        const body =
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          all
            .map(
              (f) =>
                `<sitemap><loc>${xml.url(`${children}${f.name}`)}</loc>${xml.lastmod(latest(f.entries))}</sitemap>`,
            )
            .join('') +
          '</sitemapindex>\n'
        return { body, tags }
      }),

    file: (origin: string, name: string) =>
      Effect.gen(function* () {
        for (const source of sources) {
          if (!name.startsWith(source.key)) continue
          const file = (yield* files(origin, source)).find((f) => f.name === name)
          if (!file) continue
          const body = sitemapXml(origin, locales).body(file.entries)
          return { body, tags }
        }
        return yield* new CmsNotFound({ id: name })
      }),
  }
})
