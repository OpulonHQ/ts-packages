import { authorization, defineModule, withTransaction } from '@opulonjs/core'
import { Effect, Layer } from 'effect'
import * as Cookies from 'effect/http/Cookies'
import * as HttpEffect from 'effect/http/HttpEffect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { SqlClient } from 'effect/sql/SqlClient'
import {
  superAdminRole,
  UsersAuthGroup,
  usersAuditActions,
  UsersGroup,
  usersPermissions,
} from '../api.ts'
import { BetterAuth } from './auth.ts'
import { createInvitation } from './invitations.ts'
import createUsers from './migrations/0001_create_users.ts'
import { UserManagement } from './manage.ts'
import { Users } from './service.ts'
import { invitationEmail, passwordResetEmail } from './templates.ts'

export { usersConfig } from './auth.ts'
export { hashPassword, verifyPassword } from './password.ts'
export { UserManagement } from './manage.ts'
export { Users } from './service.ts'
export { invitationEmail, passwordResetEmail } from './templates.ts'

const requestHeaders = Effect.map(HttpServerRequest, (r) => ({
  headers: new Headers(r.headers),
  method: r.method,
}))

/** Passes Better Auth's Set-Cookie headers (session cookie set or cleared) to the response. */
const setCookies = (cookies: ReadonlyArray<string>) =>
  cookies.length === 0
    ? Effect.void
    : HttpEffect.appendPreResponseHandler((_request, response) =>
        Effect.succeed(HttpServerResponse.mergeCookies(response, Cookies.fromSetCookie(cookies))),
      )

const noStore = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeader(response, 'cache-control', 'no-store')),
)

/** `opulon users invite-super-admin --email <address>`: the first way into a fresh deploy. */
const inviteSuperAdmin = (email: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const address = email.trim().toLowerCase()
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address))
      return yield* Effect.fail(new Error(`not an email address: ${email}`))
    const [holder] = yield* sql`select 1 from users.user_role ur
      join users."user" u on u.id = ur.user_id
      where ur.role_id = ${superAdminRole} and u.deactivated_at is null limit 1`
    if (holder)
      return yield* Effect.fail(
        new Error('a Super admin already exists; invite further users from the admin'),
      )
    const invitation = yield* withTransaction(
      createInvitation({ email: address, roleIds: [superAdminRole], invitedBy: null }),
    )
    return `Super admin invitation for ${address} (valid 7 days, shown once):\n${invitation.link}`
  })

/**
 * The users module: staff sign-in and sessions through Better Auth (login and sessions only),
 * invitations, password reset, and core's Authorization middleware from the session. Needs
 * `emails` and Config `USERS_BASE_URL` and `USERS_AUTH_SECRET`.
 */
export const users = () =>
  defineModule({
    id: 'users',
    dependsOn: ['emails'],
    groups: [UsersAuthGroup, UsersGroup],
    handlers: (api) =>
      Layer.mergeAll(
        HttpApiBuilder.group(api, 'users.auth', (h) =>
          Effect.gen(function* () {
            const users = yield* Users
            return h
              .handle('signIn', ({ payload }) =>
                Effect.gen(function* () {
                  const { headers } = yield* requestHeaders
                  const result = yield* users.signIn(headers, payload)
                  yield* setCookies(result.setCookies)
                  yield* noStore
                  return { id: result.userId }
                }),
              )
              .handle('signOut', () =>
                Effect.gen(function* () {
                  const { headers } = yield* requestHeaders
                  yield* setCookies((yield* users.signOut(headers)).setCookies)
                  yield* noStore
                }),
              )
              .handle('requestPasswordReset', ({ payload }) =>
                Effect.flatMap(requestHeaders, ({ headers }) =>
                  users.requestPasswordReset(headers, payload.email),
                ),
              )
              .handle('resetPassword', ({ payload }) =>
                Effect.flatMap(requestHeaders, ({ headers }) =>
                  users.resetPassword(headers, payload),
                ),
              )
              .handle('invitation', ({ payload }) => users.invitation(payload.token))
              .handle('acceptInvitation', ({ payload }) => users.acceptInvitation(payload))
          }),
        ),
        HttpApiBuilder.group(api, 'users', (h) =>
          Effect.gen(function* () {
            const users = yield* Users
            const manage = yield* UserManagement
            return h
              .handle('invite', ({ payload }) => users.invite(payload))
              .handle('users', () => manage.users())
              .handle('assignRoles', ({ params, payload }) =>
                manage.assignRoles(params.id, payload.roleIds),
              )
              .handle('deactivate', ({ params }) => manage.setActive(params.id, false))
              .handle('reactivate', ({ params }) => manage.setActive(params.id, true))
              .handle('setLocale', ({ params, payload }) =>
                manage.setLocale(params.id, payload.locale),
              )
              .handle('roles', () => manage.roles())
              .handle('createRole', ({ payload }) => manage.createRole(payload))
              .handle('updateRole', ({ params, payload }) => manage.updateRole(params.id, payload))
          }),
        ),
      ),
    layer: authorization((request) =>
      Effect.gen(function* () {
        const users = yield* Users
        const signedIn = yield* users.authenticate(new Headers(request.headers), request.method)
        if (signedIn && signedIn.setCookies.length > 0)
          HttpEffect.appendPreResponseHandlerUnsafe(request, (_request, response) =>
            Effect.succeed(
              HttpServerResponse.mergeCookies(response, Cookies.fromSetCookie(signedIn.setCookies)),
            ),
          )
        return signedIn?.user
      }),
    ).pipe(
      Layer.provideMerge(Layer.merge(Users.layer, UserManagement.layer)),
      Layer.provide(BetterAuth.layer),
    ),
    migrations: { '0001_create_users': createUsers },
    permissions: usersPermissions,
    auditActions: usersAuditActions,
    contributes: [invitationEmail, passwordResetEmail],
    commands: {
      'invite-super-admin': {
        description: 'invites the first Super admin: --email <address>; prints the link',
        options: { email: { type: 'string' } },
        run: ({ email }) =>
          typeof email === 'string'
            ? inviteSuperAdmin(email)
            : Effect.fail(new Error('--email <address> is required')),
      },
    },
  })
