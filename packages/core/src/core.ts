import { Effect } from 'effect'
import * as HttpEffect from 'effect/http/HttpEffect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { CoreGroup, corePermissions } from './api.ts'
import { purgeAudit } from './audit.ts'
import { CurrentUser } from './authz.ts'
import { BuildId, Composed } from './compose.ts'
import createAuditEvent from './migrations/0001_create_audit_event.ts'
import { defineModule } from './module.ts'

export interface CoreOptions {
  readonly audit?: {
    /** Days an audit event is kept. Default 365. */
    readonly retentionDays?: number
    /** Days after which an event's IP and user agent are nulled. Default 90. */
    readonly ipRetentionDays?: number
  }
}

/** Core's own module: the audit log, its retention task and `/me`. Every host lists it. */
export const core = (options: CoreOptions = {}) =>
  defineModule({
    id: 'core',
    groups: [CoreGroup],
    handlers: (api) =>
      HttpApiBuilder.group(api, 'core', (h) =>
        Effect.gen(function* () {
          const composed = yield* Composed
          return h.handle('me', () =>
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
              }
            }),
          )
        }),
      ),
    migrations: { '0001_create_audit_event': createAuditEvent },
    permissions: corePermissions,
    tasks: [
      {
        name: 'audit_purge',
        every: '1d',
        run: purgeAudit({
          retentionDays: options.audit?.retentionDays ?? 365,
          ipRetentionDays: options.audit?.ipRetentionDays ?? 90,
        }),
      },
    ],
  })
