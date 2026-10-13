import { ContentLocales } from '@opulonjs/core'
import { Context, Effect, Layer } from 'effect'
import type { Forbidden } from 'effect/http-api/HttpApiError'
import {
  type CmsConflict,
  type CmsDefinitions,
  type ItemRevision,
  type RevisionList,
  CmsInvalid,
  CmsNotFound,
  type Collection,
  type Item,
  ItemDocument,
  type ItemPreview,
  type ItemSummary,
  labelText,
  titleFieldOf,
} from '../api.ts'
import { checkFields, cleanData, cleanLocales, emptyLocale, localizeData } from './document.ts'
import { type DocumentRow, documentState, makeDocuments } from './documents.ts'

/** Cache-Tags of one item's public responses and of its collection's lists. */
export const itemTags = (id: string, collection: string) => [
  `cms:item:${id}`,
  `cms:collection:${collection}`,
]

type Failure = Forbidden | CmsNotFound

/** Collection items: drafts, publishing and preview. Every method checks permissions itself. */
export class Items extends Context.Service<
  Items,
  {
    readonly list: (
      collection: string,
    ) => Effect.Effect<{ rows: ReadonlyArray<ItemSummary>; total: number }, Failure>
    readonly listRevisions: (id: string, page?: number) => Effect.Effect<RevisionList, Failure>
    readonly getRevision: (id: string, revisionId: string) => Effect.Effect<ItemRevision, Failure>
    readonly restoreRevision: (
      id: string,
      revisionId: string,
    ) => Effect.Effect<Item, Failure | CmsInvalid | CmsConflict>
    readonly get: (id: string) => Effect.Effect<Item, Failure>
    readonly create: (
      collection: string,
      draft: ItemDocument,
    ) => Effect.Effect<Item, Failure | CmsInvalid | CmsConflict>
    readonly saveDraft: (
      id: string,
      draft: ItemDocument,
    ) => Effect.Effect<Item, Failure | CmsInvalid | CmsConflict>
    readonly remove: (id: string) => Effect.Effect<void, Failure>
    readonly publish: (id: string) => Effect.Effect<Item, Failure | CmsInvalid | CmsConflict>
    readonly unpublish: (id: string) => Effect.Effect<Item, Failure>
    readonly preview: (id: string, locale?: string) => Effect.Effect<ItemPreview, Failure>
  }
>()('@opulonjs/cms/Items') {
  static readonly layer = (definitions: CmsDefinitions) =>
    Layer.effect(
      Items,
      Effect.gen(function* () {
        const locales = yield* ContentLocales
        const defaultLocale = locales[0]!
        const collectionOf = (key: string | null): Collection | undefined =>
          key !== null && Object.hasOwn(definitions.collections, key)
            ? definitions.collections[key]
            : undefined
        const known = (key: string | null) =>
          Effect.fromNullishOr(collectionOf(key)).pipe(
            Effect.mapError(() => new CmsNotFound({ id: key ?? '' })),
          )

        const title = (row: DocumentRow<ItemDocument>) => {
          const collection = collectionOf(row.key)
          const field = collection && titleFieldOf(collection)
          const value =
            collection && field !== undefined
              ? localizeData(collection, row.draft.data, defaultLocale, defaultLocale)[field]
              : undefined
          const own = row.draft.locales[defaultLocale]
          const text = typeof value === 'string' ? value : ''
          return text || own?.seo.title || own?.path || 'Untitled'
        }
        const toSummary = (row: DocumentRow<ItemDocument>): ItemSummary => ({
          id: row.id,
          collection: row.key ?? '',
          title: title(row),
          path: row.draft.locales[defaultLocale]?.path ?? '',
          ...documentState(row),
        })
        const toItem = (row: DocumentRow<ItemDocument>): Item => ({
          ...toSummary(row),
          draft: row.draft,
          published: row.published,
          publishedRevisionId: row.publishedRevisionId,
        })
        const inCollection = <A, E>(
          key: string | null,
          f: (collection: Collection) => Effect.Effect<A, E>,
        ) =>
          Effect.gen(function* () {
            const collection = collectionOf(key)

            // A collection removed from the definitions leaves items nothing validates.
            if (!collection)
              return yield* new CmsInvalid({ message: `Unknown collection "${key}".` })
            return yield* f(collection).pipe(
              Effect.mapError((error) =>
                error instanceof CmsInvalid
                  ? new CmsInvalid({
                      message: `${labelText(collection.label, 'en')}: ${error.message}`,
                    })
                  : error,
              ),
            )
          })

        const documents = (yield* makeDocuments)<ItemDocument>({
          kind: 'item',
          schema: ItemDocument,
          permissions: {
            view: 'cms.collections.view',
            edit: 'cms.collections.edit',
            publish: 'cms.collections.publish',
          },
          actions: {
            restored: 'cms.item.restored',
            published: 'cms.item.published',
            unpublished: 'cms.item.unpublished',
            deleted: 'cms.item.deleted',
          },
          subject: (row) => ({ type: 'item', id: row.id, label: title(row) }),
          tags: (row) => itemTags(row.id, row.key ?? ''),
          normalize: (key, document) =>
            inCollection(key, (collection) =>
              Effect.gen(function* () {
                const itemLocales = yield* cleanLocales(
                  locales,
                  document.locales,
                  collection.routed ?? false,
                )
                const data = yield* cleanData(definitions, collection, document.data, locales)
                return {
                  locales: itemLocales,
                  data,
                }
              }),
            ),
          checkRequired: (key, document) =>
            inCollection(key, (collection) =>
              checkFields(collection, defaultLocale, document.data),
            ),
          routes: (document) => document.locales,
        })

        return {
          listRevisions: (id, page) => documents.listRevisions(id, page),
          getRevision: (id, revisionId) => documents.getRevision(id, revisionId),
          restoreRevision: (id, revisionId) =>
            documents.restoreRevision(id, revisionId).pipe(Effect.map(toItem)),
          list: (collection) =>
            known(collection).pipe(
              Effect.andThen(documents.list(collection)),
              Effect.map((rows) => ({ rows: rows.map(toSummary), total: rows.length })),
            ),
          get: (id) => documents.get(id).pipe(Effect.map(toItem)),
          create: (collection, draft) =>
            known(collection).pipe(
              Effect.andThen(documents.create(collection, draft)),
              Effect.map(toItem),
            ),
          saveDraft: (id, draft) => documents.saveDraft(id, draft).pipe(Effect.map(toItem)),

          // Only system pages refuse deletion.
          remove: (id) => documents.remove(id).pipe(Effect.catchTag('CmsConflict', Effect.die)),
          publish: (id) => documents.publish(id).pipe(Effect.map(toItem)),
          unpublish: (id) => documents.unpublish(id).pipe(Effect.map(toItem)),
          preview: (id, requested) =>
            Effect.gen(function* () {
              const row = yield* documents.get(id)
              const locale = requested && locales.includes(requested) ? requested : defaultLocale
              const own = row.draft.locales[locale] ?? emptyLocale()
              const collection = collectionOf(row.key)
              return {
                id: row.id,
                collection: row.key ?? '',
                locale,
                path: own.path,
                seo: own.seo,
                data: collection
                  ? localizeData(collection, row.draft.data, locale, defaultLocale)
                  : {},
              }
            }),
        }
      }),
    )
}
