import { Effect } from 'effect'
import * as HttpEffect from 'effect/http/HttpEffect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { Forbidden } from 'effect/http-api/HttpApiError'
import { CoreGroup, corePermissions } from './api.ts'
import { purgeAudit } from './audit.ts'
import { listAudit } from './audit-query.ts'
import { CurrentUser } from './authz.ts'
import { CachePurge } from './cache-purge.ts'
import { CachePurgeStatusAccess } from './cache-purge-access.ts'
import { BuildId, Composed, ContentLocales } from './compose.ts'
import createAuditEvent from './migrations/0001_create_audit_event.ts'
import createCachePurge from './migrations/0002_create_cache_purge.ts'
import { defineModule } from './module.ts'

export interface CoreOptions {
  readonly audit?: {
    /** Days an audit event is kept. Default 365. */
    readonly retentionDays?: number
    /** Days after which IP and user agent are masked on reads and nulled. Default 90. */
    readonly ipRetentionDays?: number
  }
}

/** Core's own module: the audit log, its retention task and `/me`. Every host lists it. */
export const core = (options: CoreOptions = {}) => {
  const ipRetentionDays = options.audit?.ipRetentionDays ?? 90
  return defineModule({
    id: 'core',
    groups: [CoreGroup],
    handlers: (api) =>
      HttpApiBuilder.group(api, 'core', (h) =>
        Effect.gen(function* () {
          const composed = yield* Composed
          const contentLocales = yield* ContentLocales
          const purgeAccess = yield* CachePurgeStatusAccess.collect
          return h
            .handle('cachePurges', () =>
              Effect.gen(function* () {
                const user = yield* CurrentUser
                if (!purgeAccess.some(({ key }) => user.permissions.includes(key)))
                  return yield* new Forbidden()
                return {
                  summary: yield* CachePurge.summary().pipe(Effect.orDie),
                  rows: (yield* CachePurge.pending().pipe(Effect.orDie)).map(
                    ({ id, attempts, state, error, staleUntil }) => ({
                      id,
                      attempts,
                      state,
                      error,
                      staleUntil,
                    }),
                  ),
                }
              }),
            )
            .handle('audit', ({ query }) =>
              Effect.gen(function* () {
                yield* HttpEffect.appendPreResponseHandler((_request, response) =>
                  Effect.succeed(
                    HttpServerResponse.setHeader(response, 'cache-control', 'private, no-store'),
                  ),
                )
                return yield* listAudit({ query, ipRetentionDays })
              }),
            )
            .handle('me', () =>
              Effect.gen(function* () {
                const user = yield* CurrentUser
                yield* HttpEffect.appendPreResponseHandler((_request, response) =>
                  Effect.succeed(
                    HttpServerResponse.setHeader(response, 'cache-control', 'private, no-store'),
                  ),
                )
                return {
                  buildId: yield* BuildId,
                  user: { id: user.id, name: user.name, email: user.email },
                  locale: user.locale,
                  permissions: user.permissions,
                  modules: composed.modules,
                  permissionCatalog: composed.permissions,
                  contentLocales,
                }
              }),
            )
        }),
      ),
    migrations: {
      '0001_create_audit_event': createAuditEvent,
      '0002_create_cache_purge': createCachePurge,
    },
    permissions: corePermissions,
    tasks: [
      { name: 'cache_purge_sweep', every: '5m', run: CachePurge.sweep() },
      {
        name: 'audit_purge',
        every: '1d',
        run: purgeAudit({
          retentionDays: options.audit?.retentionDays ?? 365,
          ipRetentionDays,
        }),
      },
    ],
  })
}
