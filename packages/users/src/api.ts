// Client-safe: the users HttpApi groups and key catalogs, imported by the admin build too.
import { Authorization, Policy, Public } from '@opulonjs/core/api'
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import { BadRequest, Conflict, Forbidden, Unauthorized } from 'effect/http-api/HttpApiError'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'

export const usersPermissions = ['users.manage'] as const

export const usersAuditActions = [
  { key: 'users.signed_in', subject: 'user' },
  { key: 'users.sign_in_failed', subject: 'user' },
  { key: 'users.signed_out', subject: 'user' },
  { key: 'users.invited', subject: 'invitation' },
  { key: 'users.invitation_accepted', subject: 'user' },
  { key: 'users.password_reset_requested', subject: 'user' },
  { key: 'users.password_reset', subject: 'user' },
] as const

/** Id of the built-in role that holds every permission. */
export const superAdminRole = 'super_admin'

/** Too many attempts from this client; retry after `retryAfter` seconds. */
export class TooManyRequests extends Schema.TaggedError<TooManyRequests>()(
  'TooManyRequests',
  { retryAfter: Schema.Number },
  { httpApiStatus: 429 },
) {}

/** The invitation or reset token is unknown, used or expired. */
export class InvalidToken extends Schema.TaggedError<InvalidToken>()(
  'InvalidToken',
  {},
  { httpApiStatus: 400 },
) {}

const Email = Schema.String.check(Schema.isMaxLength(254))
/** Better Auth's limits: 8 to 128 characters. */
const Password = Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(128))
const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))

/** Sign-in, sign-out, password reset and invitation acceptance: reachable without a session. */
export const UsersAuthGroup = HttpApiGroup.make('users.auth')
  .add(
    HttpApiEndpoint.post('signIn', '/auth/sign-in', {
      payload: Schema.Struct({
        email: Email,
        password: Schema.String.check(Schema.isMaxLength(128)),
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: [Unauthorized, TooManyRequests],
    }),
  )
  .add(HttpApiEndpoint.post('signOut', '/auth/sign-out'))
  .add(
    HttpApiEndpoint.post('requestPasswordReset', '/auth/request-password-reset', {
      payload: Schema.Struct({ email: Email }),
      error: TooManyRequests,
    }),
  )
  .add(
    HttpApiEndpoint.post('resetPassword', '/auth/reset-password', {
      payload: Schema.Struct({ token: Token, password: Password }),
      error: [InvalidToken, TooManyRequests],
    }),
  )
  .add(
    HttpApiEndpoint.post('invitation', '/invitations/inspect', {
      payload: Schema.Struct({ token: Token }),
      success: Schema.Struct({ email: Schema.String }),
      error: InvalidToken,
    }),
  )
  .add(
    HttpApiEndpoint.post('acceptInvitation', '/invitations/accept', {
      payload: Schema.Struct({
        token: Token,
        name: Schema.String.check(
          Schema.isTrimmed(),
          Schema.isMinLength(1),
          Schema.isMaxLength(200),
        ),
        password: Password,
      }),
      error: [InvalidToken, Conflict],
    }),
  )
  .annotate(Public, true)

/** Staff-only users endpoints. */
export const UsersGroup = HttpApiGroup.make('users')
  .add(
    HttpApiEndpoint.post('invite', '/invitations', {
      payload: Schema.Struct({ email: Email, roleIds: Schema.Array(Schema.String) }),
      success: Schema.Struct({ id: Schema.String }),
      error: [BadRequest, Conflict, Forbidden],
    }).annotate(Policy, 'users.manage'),
  )
  .middleware(Authorization)
