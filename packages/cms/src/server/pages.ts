import { ContentLocales, requirePermission } from '@opulonjs/core'
import { Context, Effect, Layer } from 'effect'
import type { Forbidden } from 'effect/http-api/HttpApiError'
import { SqlClient } from 'effect/sql/SqlClient'
import {
  CmsConflict,
  type CmsDefinitions,
  type PageRevision,
  type RevisionList,
  type CmsInvalid,
  type CmsNotFound,
  labelText,
  type Page,
  PageDocument,
  type PagePreview,
  type PageSummary,
} from '../api.ts'
import { checkRequired, emptyLocale, localizeSection, normalizeDocument } from './document.ts'
import { type DocumentRow, documentState, makeDocuments } from './documents.ts'

/** Cache-Tags of one page's public responses. */
export const pageTags = (id: string) => [`cms:page:${id}`]

type PagesError = Forbidden | CmsNotFound

/** Pages: drafts, publishing and preview. Every method checks the actor's permission itself. */
export class Pages extends Context.Service<
  Pages,
  {
    readonly list: () => Effect.Effect<
      { rows: ReadonlyArray<PageSummary>; total: number },
      Forbidden
    >
    readonly listRevisions: (id: string, page?: number) => Effect.Effect<RevisionList, PagesError>
    readonly getRevision: (
      id: string,
      revisionId: string,
    ) => Effect.Effect<PageRevision, PagesError>
    readonly restoreRevision: (
      id: string,
      revisionId: string,
    ) => Effect.Effect<Page, PagesError | CmsInvalid | CmsConflict>
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

        const title = (row: DocumentRow<PageDocument>) => {
          const own = row.draft.locales[defaultLocale]
          const system = row.key === null ? undefined : definitions.systemPages[row.key]
          return own?.seo.title || labelText(system?.label, 'en') || own?.path || 'Untitled'
        }
        const toSummary = (row: DocumentRow<PageDocument>): PageSummary => ({
          id: row.id,
          systemKey: row.key,
          title: title(row),
          path: row.draft.locales[defaultLocale]?.path ?? '',
          ...documentState(row),
        })
        const toPage = (row: DocumentRow<PageDocument>): Page => ({
          ...toSummary(row),
          draft: row.draft,
          published: row.published,
          publishedRevisionId: row.publishedRevisionId,
        })

        const documents = (yield* makeDocuments)<PageDocument>({
          kind: 'page',
          schema: PageDocument,
          permissions: {
            view: 'cms.pages.view',
            edit: 'cms.pages.edit',
            publish: 'cms.pages.publish',
          },
          actions: {
            restored: 'cms.page.restored',
            published: 'cms.page.published',
            unpublished: 'cms.page.unpublished',
            deleted: 'cms.page.deleted',
          },
          subject: (row) => ({ type: 'page', id: row.id, label: title(row) }),
          tags: (row) => pageTags(row.id),
          normalize: (_key, document) => normalizeDocument(definitions, locales, document),
          checkRequired: (_key, document) => checkRequired(definitions, defaultLocale, document),
          routes: (document) => document.locales,
          beforeRemove: (row) =>
            row.key === null
              ? Effect.void
              : Effect.fail(
                  new CmsConflict({
                    reason: 'system_page',
                    message: 'System pages can be edited but not deleted.',
                  }),
                ),
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
        }).pipe(Effect.orDie)

        return {
          listRevisions: (id, page) => documents.listRevisions(id, page),
          getRevision: (id, revisionId) => documents.getRevision(id, revisionId),
          restoreRevision: (id, revisionId) =>
            documents.restoreRevision(id, revisionId).pipe(Effect.map(toPage)),
          list: () =>
            Effect.gen(function* () {
              yield* requirePermission('cms.pages.view')
              yield* ensureSystemPages
              const rows = yield* documents.list(null)
              return { rows: rows.map(toSummary), total: rows.length }
            }),
          get: (id) => documents.get(id).pipe(Effect.map(toPage)),
          create: (draft) => documents.create(null, draft).pipe(Effect.map(toPage)),
          saveDraft: (id, draft) => documents.saveDraft(id, draft).pipe(Effect.map(toPage)),
          remove: (id) => documents.remove(id),
          publish: (id) => documents.publish(id).pipe(Effect.map(toPage)),
          unpublish: (id) => documents.unpublish(id).pipe(Effect.map(toPage)),
          preview: (id, requested) =>
            Effect.gen(function* () {
              const row = yield* documents.get(id)
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
            }),
        }
      }),
    )
}
