import { defineModule } from '@opulonjs/core'
import { Effect, Layer } from 'effect'
import * as HttpEffect from 'effect/http/HttpEffect'
import type * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type * as HttpApi from 'effect/http-api/HttpApi'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { cacheTagHeader } from '../public.ts'
import {
  cmsAuditActions,
  type CmsDefinitions,
  CmsGroup,
  cmsPermissions,
  CmsReadGroup,
  readCacheControl,
} from '../api.ts'
import { Items } from './collections.ts'
import createDocument from './migrations/0001_create_document.ts'
import createRedirect from './migrations/0002_create_redirect.ts'
import singletons from './migrations/0003_singletons.ts'
import { Pages } from './pages.ts'
import { makeReader, type Tagged } from './read.ts'
import { Redirects } from './redirects.ts'
import { Menus, Settings } from './site.ts'
import { documentsSource, makeSitemaps } from './sitemap.ts'

export interface CmsOptions {
  /** The host's definitions file (`defineCms`), shared with `cmsAdmin({ definitions })`. */
  readonly definitions: CmsDefinitions
}

const noStore = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeader(response, 'cache-control', 'private, no-store')),
)
/** Previews read drafts: answered `private, no-store`. */
const preview = <A, E, R>(effect: Effect.Effect<A, E, R>) => noStore.pipe(Effect.andThen(effect))

/** Read API answers are edge-cached under their Cache-Tags (successful ones only). */
const cached = <A, E, R>(effect: Effect.Effect<Tagged<A>, E, R>) =>
  Effect.gen(function* () {
    const { body, tags } = yield* effect
    const tag = cacheTagHeader(tags)
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        response.status === 200
          ? HttpServerResponse.setHeaders(response, {
              'cache-control': readCacheControl,
              'cache-tag': tag,
            })
          : response,
      ),
    )
    return body
  })

/** The origin public URLs (the sitemaps') are built on: the request's. */
const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.originalUrl, 'http://localhost').origin

/**
 * The cms module (TSPACK-11): pages built from the host's section types, collection items,
 * site settings and menus, with drafts, publishing, revisions and preview under `/api/cms`.
 * Depends on media (media fields hold media ids). Provides `Pages`, `Items`, `Settings`,
 * `Menus` and `Redirects` (with `lookup` for the Read API) to later modules.
 */
export const cms = (options: CmsOptions) =>
  defineModule({
    id: 'cms',
    dependsOn: ['media'],
    groups: [CmsGroup, CmsReadGroup],
    handlers: (api) =>
      Layer.merge(
        HttpApiBuilder.group(api, 'cms.read', (h) =>
          Effect.gen(function* () {
            const reader = yield* makeReader(options.definitions)
            const sitemaps = yield* makeSitemaps
            return h
              .handle('resolve', ({ query }) => cached(reader.resolve(query.path)))
              .handle('site', ({ query }) => cached(reader.site(query.locale)))
              .handle('collection', ({ params, query }) =>
                cached(reader.collection(params.collection, query)),
              )
              .handle('sitemapIndex', ({ request }) => {
                // The children are served next to the index, under whatever API prefix the
                // host mounted cms at: `<prefix>/cms/sitemaps/<file>`.
                const url = new URL(request.originalUrl, 'http://localhost')
                const children = url.pathname.replace(/sitemap\.xml$/, 'sitemaps/')
                return cached(sitemaps.index(url.origin, children))
              })
              .handle('sitemap', ({ params, request }) =>
                cached(sitemaps.file(originOf(request), params.file)),
              )
          }),
        ),
        handlers(api),
      ),
    layer: Layer.mergeAll(
      Pages.layer(options.definitions),
      Items.layer(options.definitions),
      Settings.layer(options.definitions),
      Menus.layer(options.definitions),
    ).pipe(Layer.provideMerge(Redirects.layer)),
    contributes: [
      documentsSource('cms.pages', 'page'),
      ...Object.entries(options.definitions.collections)
        .filter(([, c]) => c.routed)
        // Their own namespace: a collection may be named like a cms source (`pages`).
        .map(([key]) => documentsSource(`cms.items.${key}`, 'item', key)),
    ],
    migrations: {
      '0001_create_document': createDocument,
      '0002_create_redirect': createRedirect,
      '0003_singletons': singletons,
    },
    permissions: cmsPermissions,
    auditActions: cmsAuditActions,
  })

/** The editor (admin) endpoints. */
const handlers = (api: HttpApi.HttpApi<'opulon', typeof CmsGroup | typeof CmsReadGroup>) =>
  HttpApiBuilder.group(api, 'cms', (h) =>
    Effect.gen(function* () {
      const pages = yield* Pages
      const items = yield* Items
      const settings = yield* Settings
      const menus = yield* Menus
      const redirects = yield* Redirects
      return h
        .handle('listPages', () => pages.list())
        .handle('getPage', ({ params }) => pages.get(params.id))
        .handle('createPage', ({ payload }) => pages.create(payload))
        .handle('saveDraft', ({ params, payload }) => pages.saveDraft(params.id, payload))
        .handle('deletePage', ({ params }) => pages.remove(params.id))
        .handle('publishPage', ({ params }) => pages.publish(params.id))
        .handle('unpublishPage', ({ params }) => pages.unpublish(params.id))
        .handle('previewPage', ({ params, query }) =>
          preview(pages.preview(params.id, query.locale)),
        )
        .handle('listItems', ({ params }) => items.list(params.collection))
        .handle('createItem', ({ params, payload }) => items.create(params.collection, payload))
        .handle('getItem', ({ params }) => items.get(params.id))
        .handle('saveItemDraft', ({ params, payload }) => items.saveDraft(params.id, payload))
        .handle('deleteItem', ({ params }) => items.remove(params.id))
        .handle('publishItem', ({ params }) => items.publish(params.id))
        .handle('unpublishItem', ({ params }) => items.unpublish(params.id))
        .handle('previewItem', ({ params, query }) =>
          preview(items.preview(params.id, query.locale)),
        )
        .handle('getSettings', () => settings.get())
        .handle('saveSettingsDraft', ({ payload }) => settings.saveDraft(payload))
        .handle('publishSettings', () => settings.publish())
        .handle('unpublishSettings', () => settings.unpublish())
        .handle('previewSettings', ({ query }) => preview(settings.preview(query.locale)))
        .handle('listMenus', () => menus.list())
        .handle('getMenu', ({ params }) => menus.get(params.key))
        .handle('saveMenuDraft', ({ params, payload }) => menus.saveDraft(params.key, payload))
        .handle('publishMenu', ({ params }) => menus.publish(params.key))
        .handle('unpublishMenu', ({ params }) => menus.unpublish(params.key))
        .handle('previewMenu', ({ params, query }) =>
          preview(menus.preview(params.key, query.locale)),
        )
        .handle('listRedirects', () => redirects.list())
        .handle('createRedirect', ({ payload }) => redirects.create(payload))
        .handle('updateRedirect', ({ params, payload }) => redirects.update(params.id, payload))
        .handle('deleteRedirect', ({ params }) => redirects.remove(params.id))
        .handle('importRedirects', ({ payload }) => redirects.importCsv(payload.csv))
    }),
  )
