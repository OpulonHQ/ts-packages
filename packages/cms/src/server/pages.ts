import {
  Audit,
  Background,
  ContentLocales,
  CurrentActor,
  requirePermission,
  withTransaction,
} from '@opulonjs/core'
import { Context, Effect, Layer, Schema } from 'effect'
import type { Forbidden } from 'effect/http-api/HttpApiError'
import { SqlClient } from 'effect/sql/SqlClient'
import {
  CmsConflict,
  type CmsDefinitions,
  type CmsInvalid,
  CmsNotFound,
  labelText,
  type Page,
  PageDocument,
  type PagePreview,
  type PageSummary,
} from '../api.ts'
import { checkRequired, emptyLocale, localizeSection, normalizeDocument, uuid } from './document.ts'

/**
 * Purges edge-cached public responses by Cache-Tag after a publish family write commits. The
 * default does nothing; the Read API slice adds the Cloudflare purger, and a host (or a test)
 * may provide its own in `infra`: `Layer.succeed(CachePurge, { purge })`.
 */
export const CachePurge = Context.Reference<{
  readonly purge: (tags: ReadonlyArray<string>) => Effect.Effect<void>
}>('@opulonjs/cms/CachePurge', { defaultValue: () => ({ purge: () => Effect.void }) })

/** Cache-Tags of one page's public responses. */
export const pageTags = (id: string) => [`cms:page:${id}`]

const Row = Schema.Struct({
  id: Schema.String,
  key: Schema.NullOr(Schema.String),
  draft: PageDocument,
  published: Schema.NullOr(PageDocument),
  in_sync: Schema.Boolean,
  published_at: Schema.NullOr(Schema.Date),
  published_revision_id: Schema.NullOr(Schema.String),
  updated_at: Schema.Date,
})
type Row = typeof Row.Type
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row))
const columns = `id, key, draft, published, coalesce(draft = published, false) as in_sync,
  published_at, published_revision_id, updated_at`

type PagesError = Forbidden | CmsNotFound

/** Pages: drafts, publishing and preview. Every method checks the actor's permission itself. */
export class Pages extends Context.Service<
  Pages,
  {
    readonly list: () => Effect.Effect<
      { rows: ReadonlyArray<PageSummary>; total: number },
      Forbidden
    >
    readonly get: (id: string) => Effect.Effect<Page, PagesError>
    readonly create: (
      draft: PageDocument,
    ) => Effect.Effect<Page, Forbidden | CmsInvalid | CmsConflict>
    readonly saveDraft: (
      id: string,
      draft: PageDocument,
    ) => Effect.Effect<Page, PagesError | CmsInvalid | CmsConflict>
    readonly remove: (id: string) => Effect.Effect<void, PagesError | CmsConflict>
    /** Copies the draft to published, records a revision and purges the page's tags. */
    readonly publish: (id: string) => Effect.Effect<Page, PagesError | CmsInvalid | CmsConflict>
    readonly unpublish: (id: string) => Effect.Effect<Page, PagesError>
    /** The draft in one content locale (default: the default locale). */
    readonly preview: (id: string, locale?: string) => Effect.Effect<PagePreview, PagesError>
  }
>()('@opulonjs/cms/Pages') {
  static readonly layer = (definitions: CmsDefinitions) =>
    Layer.effect(
      Pages,
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const locales = yield* ContentLocales
        const defaultLocale = locales[0]!
        const cache = yield* CachePurge
        const background = yield* Background

        const title = (row: Row) => {
          const own = row.draft.locales[defaultLocale]
          const system = row.key === null ? undefined : definitions.systemPages[row.key]
          return own?.seo.title || labelText(system?.label, 'en') || own?.path || 'Untitled'
        }
        const toSummary = (row: Row): PageSummary => ({
          id: row.id,
          systemKey: row.key,
          title: title(row),
          path: row.draft.locales[defaultLocale]?.path ?? '',
          status: row.published === null ? 'draft' : row.in_sync ? 'published' : 'changed',
          updatedAt: row.updated_at.toISOString(),
          publishedAt: row.published_at?.toISOString() ?? null,
        })
        const toPage = (row: Row): Page => ({
          ...toSummary(row),
          draft: row.draft,
          published: row.published,
          publishedRevisionId: row.published_revision_id,
        })
        const subject = (row: Row) => ({ type: 'page', id: row.id, label: title(row) })

        const find = (id: string, lock = false) =>
          Effect.gen(function* () {
            if (!uuid.test(id)) return yield* new CmsNotFound({ id })
            const [row] = yield* decodeRows(
              yield* sql`select ${sql.literal(columns)} from cms.document
                where id = ${id} and kind = 'page' ${sql.literal(lock ? 'for update' : '')}`,
            )
            return row ?? (yield* new CmsNotFound({ id }))
          })

        /** System pages always exist: created (as drafts) the first time pages are listed. */
        const ensureSystemPages = Effect.gen(function* () {
          const keys = Object.keys(definitions.systemPages)
          if (keys.length === 0) return
          const existing = yield* sql<{ key: string }>`select key from cms.document
            where kind = 'page' and key in ${sql.in(keys)}`
          for (const key of keys.filter((k) => !existing.some((row) => row.key === k))) {
            const paths = definitions.systemPages[key]!.paths
            const draft: PageDocument = {
              locales: Object.fromEntries(
                locales.map((locale) => {
                  const path = paths[locale] ?? ''
                  return [locale, { ...emptyLocale(path), available: path !== '' }]
                }),
              ),
              sections: [],
            }
            yield* sql`insert into cms.document (id, kind, key, draft)
              values (${crypto.randomUUID()}, 'page', ${key}, ${JSON.stringify(draft)}::jsonb)
              on conflict (key) where kind = 'page' and key is not null do nothing`
          }
        })

        /** Fails when another page uses one of the document's paths (draft or published). */
        const checkPaths = (id: string | null, document: PageDocument) =>
          Effect.gen(function* () {
            const wanted = Object.entries(document.locales).filter(([, l]) => l.path !== '')
            if (wanted.length === 0) return
            const paths = [...new Set(wanted.map(([, l]) => l.path))]
            const taken = yield* sql<{ locale: string; path: string }>`
              select l.key as locale, l.value->>'path' as path
              from cms.document d cross join jsonb_each(d.draft->'locales') l
              where d.kind = 'page' and d.id is distinct from ${id}
                and l.value->>'path' in ${sql.in(paths)}
              union
              select locale, path from cms.path
              where document_id is distinct from ${id} and path in ${sql.in(paths)}`
            const clash = wanted.find(([locale, l]) =>
              taken.some((t) => t.locale === locale && t.path === l.path),
            )
            if (clash)
              return yield* new CmsConflict({
                reason: 'path_taken',
                message: `Another page already uses the ${clash[0]} path "${clash[1].path}".`,
              })
          })

        const purge = (id: string) =>
          Background.afterCommit(cache.purge(pageTags(id))).pipe(
            Effect.provideService(Background, background),
          )

        const withSql = Effect.provideService(SqlClient, sql)

        return {
          list: Effect.fn('Pages.list')(
            function* () {
              yield* requirePermission('cms.pages.view')
              yield* ensureSystemPages
              const rows = yield* decodeRows(
                yield* sql`select ${sql.literal(columns)} from cms.document where kind = 'page'
                  order by key is null, key, updated_at desc, id`,
              )
              return { rows: rows.map(toSummary), total: rows.length }
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            withSql,
          ),

          get: Effect.fn('Pages.get')(
            function* (id: string) {
              yield* requirePermission('cms.pages.view')
              return toPage(yield* find(id))
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            withSql,
          ),

          create: Effect.fn('Pages.create')(
            function* (input: PageDocument) {
              yield* requirePermission('cms.pages.edit')
              const draft = yield* normalizeDocument(definitions, locales, input)
              return yield* withTransaction(
                Effect.gen(function* () {
                  yield* checkPaths(null, draft)
                  const [row] = yield* decodeRows(
                    yield* sql`insert into cms.document (id, kind, draft)
                      values (${crypto.randomUUID()}, 'page', ${JSON.stringify(draft)}::jsonb)
                      returning ${sql.literal(columns)}`,
                  )
                  return toPage(row!)
                }),
              )
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            withSql,
          ),

          saveDraft: Effect.fn('Pages.saveDraft')(
            function* (id: string, input: PageDocument) {
              yield* requirePermission('cms.pages.edit')
              const draft = yield* normalizeDocument(definitions, locales, input)
              return yield* withTransaction(
                Effect.gen(function* () {
                  yield* find(id, true)
                  yield* checkPaths(id, draft)
                  const [row] = yield* decodeRows(
                    yield* sql`update cms.document
                      set draft = ${JSON.stringify(draft)}::jsonb, updated_at = now()
                      where id = ${id} returning ${sql.literal(columns)}`,
                  )
                  return toPage(row!)
                }),
              )
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            withSql,
          ),

          remove: Effect.fn('Pages.remove')(
            function* (id: string) {
              yield* requirePermission('cms.pages.edit')
              yield* withTransaction(
                Effect.gen(function* () {
                  const row = yield* find(id, true)
                  if (row.key !== null)
                    return yield* new CmsConflict({
                      reason: 'system_page',
                      message: 'System pages can be edited but not deleted.',
                    })
                  yield* sql`delete from cms.document where id = ${id}`
                  yield* Audit.record({ action: 'cms.page.deleted', subject: subject(row) })
                  if (row.published !== null) yield* purge(id)
                }),
              )
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            withSql,
          ),

          publish: Effect.fn('Pages.publish')(
            function* (id: string) {
              yield* requirePermission('cms.pages.publish')
              const actor = yield* CurrentActor
              return yield* withTransaction(
                Effect.gen(function* () {
                  const row = yield* find(id, true)
                  // Again, as the definitions may have changed since the draft was saved.
                  const draft = yield* normalizeDocument(definitions, locales, row.draft)
                  yield* checkRequired(definitions, defaultLocale, draft)
                  yield* checkPaths(id, draft)
                  const document = JSON.stringify(draft)
                  const revisionId = crypto.randomUUID()
                  yield* sql`insert into cms.revision
                    (id, document_id, reason, document, created_by, created_by_name)
                    values (${revisionId}, ${id}, 'publish', ${document}::jsonb,
                      ${actor.kind === 'user' ? actor.id : null}, ${actor.name ?? 'Anonymous'})`
                  const [published] = yield* decodeRows(
                    yield* sql`update cms.document set draft = ${document}::jsonb,
                      published = ${document}::jsonb, published_at = now(),
                      published_revision_id = ${revisionId}
                      where id = ${id} returning ${sql.literal(columns)}`,
                  )
                  yield* sql`delete from cms.path where document_id = ${id}`
                  for (const [locale, l] of Object.entries(draft.locales))
                    if (l.available && l.path !== '')
                      yield* sql`insert into cms.path (locale, path, document_id)
                        values (${locale}, ${l.path}, ${id})`
                  yield* Audit.record({
                    action: 'cms.page.published',
                    subject: subject(published!),
                    context: { revisionId },
                  })
                  yield* purge(id)
                  return toPage(published!)
                }),
              )
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            withSql,
          ),

          unpublish: Effect.fn('Pages.unpublish')(
            function* (id: string) {
              yield* requirePermission('cms.pages.publish')
              return yield* withTransaction(
                Effect.gen(function* () {
                  const row = yield* find(id, true)
                  if (row.published === null) return toPage(row)
                  const [after] = yield* decodeRows(
                    yield* sql`update cms.document set published = null, published_at = null,
                      published_revision_id = null
                      where id = ${id} returning ${sql.literal(columns)}`,
                  )
                  yield* sql`delete from cms.path where document_id = ${id}`
                  yield* Audit.record({ action: 'cms.page.unpublished', subject: subject(after!) })
                  yield* purge(id)
                  return toPage(after!)
                }),
              )
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            withSql,
          ),

          preview: Effect.fn('Pages.preview')(
            function* (id: string, requested?: string) {
              yield* requirePermission('cms.pages.view')
              const row = yield* find(id)
              const locale = requested && locales.includes(requested) ? requested : defaultLocale
              const own = row.draft.locales[locale] ?? emptyLocale()
              return {
                id: row.id,
                locale,
                path: own.path,
                seo: own.seo,
                sections: row.draft.sections.map((s) =>
                  localizeSection(definitions, s, locale, defaultLocale),
                ),
              }
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            withSql,
          ),
        }
      }),
    )
}
