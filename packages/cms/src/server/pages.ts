import { ContentLocales, requirePermission } from '@opulonjs/core'
import { MediaLibrary } from '@opulonjs/media/server'
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
import { availableLocales, emptyLocale, listLocale } from '../localize.ts'
import { publicPath } from '../public.ts'
import { checkRequired, normalizeDocument } from './document.ts'
import { type DocumentRow, documentState, makeDocuments } from './documents.ts'
import { resolveContent } from './read.ts'

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
      version: number,
    ) => Effect.Effect<Page, PagesError | CmsInvalid | CmsConflict>
    readonly get: (id: string) => Effect.Effect<Page, PagesError>
    readonly create: (
      draft: PageDocument,
    ) => Effect.Effect<Page, Forbidden | CmsInvalid | CmsConflict>
    readonly saveDraft: (
      id: string,
      version: number,
      draft: PageDocument,
    ) => Effect.Effect<Page, PagesError | CmsInvalid | CmsConflict>
    readonly remove: (id: string) => Effect.Effect<void, PagesError | CmsConflict>
    /** Copies the draft to published, records a revision and purges the page's tags. */
    readonly publish: (
      id: string,
      version: number,
    ) => Effect.Effect<Page, PagesError | CmsInvalid | CmsConflict>
    readonly unpublish: (id: string) => Effect.Effect<Page, PagesError>
    /** The draft in one content locale (default: the default locale), as the Read API
     *  renders a published page. */
    readonly preview: (id: string, locale?: string) => Effect.Effect<PagePreview, PagesError>
    /** An unsaved draft of the page, rendered as `preview` renders the saved one. */
    readonly previewDraft: (
      id: string,
      draft: PageDocument,
      locale?: string,
    ) => Effect.Effect<PagePreview, PagesError>
  }
>()('@opulonjs/cms/Pages') {
  static readonly layer = (definitions: CmsDefinitions) =>
    Layer.effect(
      Pages,
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const locales = yield* ContentLocales
        const media = yield* MediaLibrary

        const render = (id: string, draft: PageDocument, requested: string | undefined) =>
          Effect.gen(function* () {
            const locale = requested && locales.includes(requested) ? requested : locales[0]!
            const own = draft.locales[locale] ?? emptyLocale()
            const sections = draft.sections.flatMap((section) => {
              const group = Object.hasOwn(definitions.sections, section.type)
                ? definitions.sections[section.type]
                : undefined
              return group ? [{ section, group }] : []
            })
            const content = yield* resolveContent(
              locale,
              sections.map(({ section, group }) => ({ group, data: section.data })),
            )
            return {
              id,
              locale,
              path: own.path,
              seo: own.seo,
              sections: sections.map(({ section }, i) => ({ ...section, data: content.data[i]! })),
            }
          }).pipe(
            Effect.provideService(SqlClient, sql),
            Effect.provideService(MediaLibrary, media),
            Effect.provideService(ContentLocales, locales),
          )

        const toSummary = (row: DocumentRow<PageDocument>): PageSummary => {
          const available = availableLocales(locales, row.draft.locales, true)
          const shown = listLocale(locales, available)
          const own = row.draft.locales[shown]
          const system = row.key === null ? undefined : definitions.systemPages[row.key]
          return {
            id: row.id,
            systemKey: row.key,
            title: own?.seo.title || labelText(system?.label, 'en') || own?.path || 'Untitled',
            path: own?.path ? publicPath(locales, shown, own.path) : '',
            locales: available,
            ...documentState(row),
          }
        }
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
          subject: (row) => ({ type: 'page', id: row.id, label: toSummary(row).title }),
          tags: (row) => pageTags(row.id),
          normalize: (_key, document) => normalizeDocument(definitions, locales, document),
          checkRequired: (_key, document) => checkRequired(definitions, locales, document),
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
          restoreRevision: (id, revisionId, version) =>
            documents.restoreRevision(id, revisionId, version).pipe(Effect.map(toPage)),
          list: () =>
            Effect.gen(function* () {
              yield* requirePermission('cms.pages.view')
              yield* ensureSystemPages
              const rows = yield* documents.list(null)
              return { rows: rows.map(toSummary), total: rows.length }
            }),
          get: (id) => documents.get(id).pipe(Effect.map(toPage)),
          create: (draft) => documents.create(null, draft).pipe(Effect.map(toPage)),
          saveDraft: (id, version, draft) =>
            documents.saveDraft(id, version, draft).pipe(Effect.map(toPage)),
          remove: (id) => documents.remove(id),
          publish: (id, version) => documents.publish(id, version).pipe(Effect.map(toPage)),
          unpublish: (id) => documents.unpublish(id).pipe(Effect.map(toPage)),
          preview: (id, requested) =>
            documents.get(id).pipe(Effect.flatMap((row) => render(id, row.draft, requested))),
          previewDraft: (id, draft, requested) =>
            documents.get(id).pipe(Effect.flatMap(() => render(id, draft, requested))),
        }
      }),
    )
}
