import { defineModule } from '@opulonjs/core'
import { Effect } from 'effect'
import * as HttpEffect from 'effect/http/HttpEffect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { cmsAuditActions, type CmsDefinitions, CmsGroup, cmsPermissions } from '../api.ts'
import createDocument from './migrations/0001_create_document.ts'
import { Pages } from './pages.ts'

export interface CmsOptions {
  /** The host's definitions file (`defineCms`), shared with `cmsAdmin({ definitions })`. */
  readonly definitions: CmsDefinitions
}

const noStore = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeader(response, 'cache-control', 'private, no-store')),
)

/**
 * The cms module (TSPACK-11): pages built from the host's section types, with drafts,
 * publishing, revisions and preview under `/api/cms`. Depends on media (media fields hold media
 * ids). Provides `Pages` to later modules.
 */
export const cms = (options: CmsOptions) =>
  defineModule({
    id: 'cms',
    dependsOn: ['media'],
    groups: [CmsGroup],
    handlers: (api) =>
      HttpApiBuilder.group(api, 'cms', (h) =>
        Effect.gen(function* () {
          const pages = yield* Pages
          return h
            .handle('listPages', () => pages.list())
            .handle('getPage', ({ params }) => pages.get(params.id))
            .handle('createPage', ({ payload }) => pages.create(payload))
            .handle('saveDraft', ({ params, payload }) => pages.saveDraft(params.id, payload))
            .handle('deletePage', ({ params }) => pages.remove(params.id))
            .handle('publishPage', ({ params }) => pages.publish(params.id))
            .handle('unpublishPage', ({ params }) => pages.unpublish(params.id))
            .handle('previewPage', ({ params, query }) =>
              noStore.pipe(Effect.andThen(pages.preview(params.id, query.locale))),
            )
        }),
      ),
    layer: Pages.layer(options.definitions),
    migrations: { '0001_create_document': createDocument },
    permissions: cmsPermissions,
    auditActions: cmsAuditActions,
  })
