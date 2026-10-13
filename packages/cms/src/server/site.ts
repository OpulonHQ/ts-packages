import { ContentLocales } from '@opulonjs/core'
import { Context, Effect, Layer } from 'effect'
import type { Forbidden } from 'effect/http-api/HttpApiError'
import { SqlClient } from 'effect/sql/SqlClient'
import {
  type CmsConflict,
  type CmsDefinitions,
  type MenuRevision,
  type SettingsRevision,
  type RevisionList,
  CmsInvalid,
  CmsNotFound,
  labelText,
  publicPath,
  type Link,
  type Menu,
  MenuDocument,
  type MenuItem,
  type MenuPreview,
  type MenuSummary,
  type ResolvedMenuItem,
  SettingsDocument,
  type SettingsPreview,
  type SiteSettings,
} from '../api.ts'
import { cacheTags } from './cache.ts'
import { checkFields, cleanData, linkProblem, localizeData, uuid } from './document.ts'
import { type DocumentRow, documentState, makeDocuments } from './documents.ts'

const noConflict = <A, E, R>(effect: Effect.Effect<A, E | CmsConflict, R>) =>
  effect.pipe(Effect.catchTag('CmsConflict', Effect.die))

/** Cache-Tag of the public site response (settings and menus). */
export const siteTags = ['cms:site']

const settingsKey = 'site'
const maxMenuItems = 200
const maxLabel = 100

/**
 * Resolves links to hrefs in one content locale: a page or item to its published public path
 * there (locale-prefixed, see `publicPath`), a system page by key to its page's, a URL as is.
 * Null when the target is not published (or not available) in the locale. `tags` are the
 * Cache-Tags whose purge changes an href: the targets', or `cms:routes` for a system page that
 * does not exist yet.
 */
export const resolveLinks = (links: ReadonlyArray<Link>, locale: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const locales = yield* ContentLocales
    const ids = [
      ...new Set(links.flatMap((l) => (l.type === 'page' || l.type === 'item' ? [l.id] : []))),
    ].filter((id) => uuid.test(id))
    const keys = [...new Set(links.flatMap((l) => (l.type === 'system' ? [l.key] : [])))]
    const byId = new Map(
      ids.length === 0
        ? []
        : (yield* sql<{ document_id: string; path: string }>`select document_id, path
              from cms.path where locale = ${locale} and document_id in ${sql.in(ids)}`).map(
            (r) => [r.document_id, publicPath(locales, locale, r.path)],
          ),
    )
    const systemPages =
      keys.length === 0
        ? []
        : yield* sql<{ key: string; id: string; path: string | null }>`
            select d.key, d.id, p.path from cms.document d
            left join cms.path p on p.document_id = d.id and p.locale = ${locale}
            where d.kind = 'page' and d.key in ${sql.in(keys)}`
    const byKey = new Map(
      systemPages.map((r) => [r.key, r.path === null ? null : publicPath(locales, locale, r.path)]),
    )
    const tags = new Set<string>()
    for (const link of links)
      if (link.type === 'page') tags.add(cacheTags.page(link.id))
      else if (link.type === 'item') tags.add(cacheTags.item(link.id))
      else if (link.type === 'system') {
        const target = systemPages.find((r) => r.key === link.key)
        tags.add(target ? cacheTags.page(target.id) : cacheTags.routes)
      }
    return {
      href: (link: Link): string | null =>
        link.type === 'url'
          ? link.url
          : link.type === 'system'
            ? (byKey.get(link.key) ?? null)
            : (byId.get(link.id) ?? null),
      tags: [...tags],
    }
  })

/** Every link of a menu, nested ones included. */
export const allLinks = (items: ReadonlyArray<MenuItem>): ReadonlyArray<Link> =>
  items.flatMap((item) => [item.link, ...allLinks(item.children)])

/** Menu items in one locale: labels resolved (falling back to `fallback`), links to hrefs. */
export const resolveMenuItems = (
  items: ReadonlyArray<MenuItem>,
  locale: string,
  fallback: string,
  href: (link: Link) => string | null,
): ReadonlyArray<ResolvedMenuItem> =>
  items.map((item) => ({
    id: item.id,
    label: item.label[locale] ?? item.label[fallback] ?? '',
    link: item.link,
    href: href(item.link),
    children: resolveMenuItems(item.children, locale, fallback, href),
  }))

type Failure = Forbidden | CmsNotFound

/** The site settings singleton: global SEO and host fields, with draft and publishing. */
export class Settings extends Context.Service<
  Settings,
  {
    readonly listRevisions: (page?: number) => Effect.Effect<RevisionList, Failure>
    readonly getRevision: (revisionId: string) => Effect.Effect<SettingsRevision, Failure>
    readonly restoreRevision: (
      revisionId: string,
    ) => Effect.Effect<SiteSettings, Failure | CmsInvalid>
    readonly get: () => Effect.Effect<SiteSettings, Forbidden>
    readonly saveDraft: (
      draft: SettingsDocument,
    ) => Effect.Effect<SiteSettings, Forbidden | CmsInvalid>
    readonly publish: () => Effect.Effect<SiteSettings, Forbidden | CmsInvalid>
    readonly unpublish: () => Effect.Effect<SiteSettings, Forbidden>
    readonly preview: (locale?: string) => Effect.Effect<SettingsPreview, Forbidden>
  }
>()('@opulonjs/cms/Settings') {
  static readonly layer = (definitions: CmsDefinitions) =>
    Layer.effect(
      Settings,
      Effect.gen(function* () {
        const locales = yield* ContentLocales
        const defaultLocale = locales[0]!
        const toSettings = (row: DocumentRow<SettingsDocument>): SiteSettings => ({
          ...documentState(row),
          draft: row.draft,
          published: row.published,
          publishedRevisionId: row.publishedRevisionId,
        })
        const documents = (yield* makeDocuments)<SettingsDocument>({
          kind: 'settings',
          schema: SettingsDocument,
          singleton: { empty: { data: {} } },
          permissions: {
            view: 'cms.site.view',
            edit: 'cms.site.edit',
            publish: 'cms.site.publish',
          },
          actions: {
            restored: 'cms.settings.restored',
            published: 'cms.settings.published',
            unpublished: 'cms.settings.unpublished',
          },
          subject: (row) => ({ type: 'settings', id: row.id, label: 'Site settings' }),
          tags: () => siteTags,
          normalize: (_key, document) =>
            cleanData(definitions, definitions.settings, document.data, locales).pipe(
              Effect.map((data) => ({ data })),
            ),
          checkRequired: (_key, document) =>
            checkFields(definitions.settings, defaultLocale, document.data),
        })

        const orDie = <A, E>(effect: Effect.Effect<A, E | CmsNotFound>) =>
          effect.pipe(Effect.catchTag('CmsNotFound', Effect.die))
        return {
          listRevisions: (page) => documents.listRevisions(settingsKey, page),
          getRevision: (revisionId) => documents.getRevision(settingsKey, revisionId),
          restoreRevision: (revisionId) =>
            documents
              .restoreRevision(settingsKey, revisionId)
              .pipe(noConflict, Effect.map(toSettings)),
          get: () => orDie(documents.get(settingsKey)).pipe(Effect.map(toSettings)),
          saveDraft: (draft) =>
            orDie(documents.saveDraft(settingsKey, draft)).pipe(noConflict, Effect.map(toSettings)),
          publish: () =>
            orDie(documents.publish(settingsKey)).pipe(noConflict, Effect.map(toSettings)),
          unpublish: () => orDie(documents.unpublish(settingsKey)).pipe(Effect.map(toSettings)),
          preview: (requested) =>
            Effect.gen(function* () {
              const row = yield* orDie(documents.get(settingsKey))
              const locale = requested && locales.includes(requested) ? requested : defaultLocale
              return {
                locale,
                data: localizeData(definitions.settings, row.draft.data, locale, defaultLocale),
              }
            }),
        }
      }),
    )
}

/** Menus declared by key in the definitions: nested links with labels per locale. */
export class Menus extends Context.Service<
  Menus,
  {
    readonly list: () => Effect.Effect<
      { rows: ReadonlyArray<MenuSummary>; total: number },
      Forbidden
    >
    readonly listRevisions: (key: string, page?: number) => Effect.Effect<RevisionList, Failure>
    readonly getRevision: (key: string, revisionId: string) => Effect.Effect<MenuRevision, Failure>
    readonly restoreRevision: (
      key: string,
      revisionId: string,
    ) => Effect.Effect<Menu, Failure | CmsInvalid>
    readonly get: (key: string) => Effect.Effect<Menu, Failure>
    readonly saveDraft: (
      key: string,
      draft: MenuDocument,
    ) => Effect.Effect<Menu, Failure | CmsInvalid>
    readonly publish: (key: string) => Effect.Effect<Menu, Failure | CmsInvalid>
    readonly unpublish: (key: string) => Effect.Effect<Menu, Failure>
    /** The draft in one locale, links resolved against what is published. */
    readonly preview: (key: string, locale?: string) => Effect.Effect<MenuPreview, Failure>
  }
>()('@opulonjs/cms/Menus') {
  static readonly layer = (definitions: CmsDefinitions) =>
    Layer.effect(
      Menus,
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const locales = yield* ContentLocales
        const defaultLocale = locales[0]!
        const invalid = (message: string) => new CmsInvalid({ message })

        const toSummary = (row: DocumentRow<MenuDocument>): MenuSummary => ({
          key: row.key ?? '',
          ...documentState(row),
        })
        const toMenu = (row: DocumentRow<MenuDocument>): Menu => ({
          ...toSummary(row),
          draft: row.draft,
          published: row.published,
          publishedRevisionId: row.publishedRevisionId,
        })

        const normalize = (key: string | null, document: MenuDocument) =>
          Effect.gen(function* () {
            const menu = key === null ? undefined : definitions.menus[key]
            if (!menu) return yield* invalid(`Unknown menu "${key}".`)
            const depth = menu.depth ?? 3
            let count = 0
            const clean = (
              items: ReadonlyArray<MenuItem>,
              level: number,
              prefix: string,
            ): Effect.Effect<ReadonlyArray<MenuItem>, CmsInvalid> =>
              Effect.forEach(items, (item, index) =>
                Effect.gen(function* () {
                  const at = `${prefix}${index + 1}`
                  if (++count > maxMenuItems)
                    return yield* invalid(`A menu holds at most ${maxMenuItems} items.`)
                  if (level > depth)
                    return yield* invalid(
                      `"${labelText(menu.label, 'en')}" nests at most ${depth} level${depth === 1 ? '' : 's'}.`,
                    )
                  const problem = linkProblem(definitions, item.link)
                  if (problem) return yield* invalid(`Menu item ${at}: ${problem}`)
                  const label = Object.fromEntries(
                    locales
                      .map((locale) => [
                        locale,
                        (item.label[locale] ?? '').trim().slice(0, maxLabel),
                      ])
                      .filter(([, text]) => text !== ''),
                  )
                  return {
                    id: uuid.test(item.id) ? item.id : crypto.randomUUID(),
                    label,
                    link:
                      item.link.type === 'url'
                        ? { type: 'url', url: item.link.url.trim() }
                        : item.link,
                    children: yield* clean(item.children, level + 1, `${at}.`),
                  } satisfies MenuItem
                }),
              )
            return { items: yield* clean(document.items, 1, '') }
          })

        const checkLabels = (
          items: ReadonlyArray<MenuItem>,
          prefix: string,
        ): Effect.Effect<void, CmsInvalid> =>
          Effect.forEach(
            items,
            (item, index) =>
              item.label[defaultLocale]
                ? checkLabels(item.children, `${prefix}${index + 1}.`)
                : Effect.fail(
                    invalid(`Menu item ${prefix}${index + 1} needs a label in ${defaultLocale}.`),
                  ),
            { discard: true },
          )

        const documents = (yield* makeDocuments)<MenuDocument>({
          kind: 'menu',
          schema: MenuDocument,
          singleton: { empty: { items: [] } },
          permissions: {
            view: 'cms.site.view',
            edit: 'cms.site.edit',
            publish: 'cms.site.publish',
          },
          actions: {
            restored: 'cms.menu.restored',
            published: 'cms.menu.published',
            unpublished: 'cms.menu.unpublished',
          },
          subject: (row) => ({
            type: 'menu',
            id: row.id,
            label: labelText(definitions.menus[row.key ?? '']?.label, 'en') || (row.key ?? ''),
          }),
          tags: () => siteTags,
          normalize,
          checkRequired: (_key, document) => checkLabels(document.items, ''),
        })
        const declared = (key: string) =>
          Object.hasOwn(definitions.menus, key)
            ? Effect.void
            : Effect.fail(new CmsNotFound({ id: key }))

        return {
          listRevisions: (key, page) =>
            declared(key).pipe(Effect.andThen(documents.listRevisions(key, page))),
          getRevision: (key, revisionId) =>
            declared(key).pipe(Effect.andThen(documents.getRevision(key, revisionId))),
          restoreRevision: (key, revisionId) =>
            declared(key)
              .pipe(Effect.andThen(documents.restoreRevision(key, revisionId)))
              .pipe(noConflict, Effect.map(toMenu)),
          list: () =>
            Effect.forEach(Object.keys(definitions.menus), (key) => documents.get(key)).pipe(
              Effect.catchTag('CmsNotFound', Effect.die),
              Effect.map((rows) => ({ rows: rows.map(toSummary), total: rows.length })),
            ),
          get: (key) => declared(key).pipe(Effect.andThen(documents.get(key)), Effect.map(toMenu)),
          saveDraft: (key, draft) =>
            declared(key).pipe(
              Effect.andThen(documents.saveDraft(key, draft)),
              noConflict,
              Effect.map(toMenu),
            ),
          publish: (key) =>
            declared(key).pipe(
              Effect.andThen(documents.publish(key)),
              noConflict,
              Effect.map(toMenu),
            ),
          unpublish: (key) =>
            declared(key).pipe(Effect.andThen(documents.unpublish(key)), Effect.map(toMenu)),
          preview: (key, requested) =>
            Effect.gen(function* () {
              yield* declared(key)
              const row = yield* documents.get(key)
              const locale = requested && locales.includes(requested) ? requested : defaultLocale
              const { href } = yield* resolveLinks(allLinks(row.draft.items), locale).pipe(
                Effect.provideService(SqlClient, sql),
                Effect.orDie,
              )
              return {
                key,
                locale,
                items: resolveMenuItems(row.draft.items, locale, defaultLocale, href),
              }
            }),
        }
      }),
    )
}
