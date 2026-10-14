// Client-safe: the users HttpApi groups and key catalogs, imported by the admin build too.
import { Authorization, ListQuery, listOffsetWithinLimit, Policy, Public } from '@opulonjs/core/api'
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import {
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
  Unauthorized,
} from 'effect/http-api/HttpApiError'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'

export const usersPermissions = ['users.manage', 'users.roles.manage'] as const

export const usersAuditActions = [
  { key: 'users.signed_in', subject: 'user' },
  { key: 'users.sign_in_failed', subject: 'user' },
  { key: 'users.signed_out', subject: 'user' },
  { key: 'users.invited', subject: 'invitation' },
  { key: 'users.invitation_accepted', subject: 'user' },
  { key: 'users.password_reset_requested', subject: 'user' },
  { key: 'users.password_reset', subject: 'user' },
  { key: 'users.role_created', subject: 'role' },
  { key: 'users.role_updated', subject: 'role' },
  { key: 'users.roles_assigned', subject: 'user' },
  { key: 'users.deactivated', subject: 'user' },
  { key: 'users.reactivated', subject: 'user' },
  { key: 'users.locale_changed', subject: 'user' },
] as const

/** Id of the built-in role that holds every permission. */
export const superAdminRole = 'super_admin'

/**
 * A users or roles change the guard refuses (TSPACK-10): `escalation` grants a permission (or
 * Super admin) the actor does not hold; `outranked` acts on a user holding more than the actor;
 * `self_lockout` would take the actor's own right to manage users or roles, or deactivate them;
 * `last_super_admin` would leave no active Super admin; `built_in` edits Super admin.
 */
export class Refused extends Schema.TaggedError<Refused>()(
  'Refused',
  {
    reason: Schema.Literals([
      'escalation',
      'outranked',
      'self_lockout',
      'last_super_admin',
      'built_in',
    ]),
  },
  { httpApiStatus: 403 },
) {}

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
      error: [InvalidToken, Conflict, TooManyRequests],
    }),
  )
  .annotate(Public, true)

/** An admin locale tag such as `en`, `sk` or `pt-BR`. */
const AdminLocale = Schema.String.check(Schema.isPattern(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/))

export const UserInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  locale: Schema.NullOr(Schema.String),
  deactivated: Schema.Boolean,
  roleIds: Schema.Array(Schema.String),
})
export type UserInfo = typeof UserInfo.Type

export const RoleInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Stored keys; Super admin stores none and holds the whole catalog. */
  permissions: Schema.Array(Schema.String),
  builtIn: Schema.Boolean,
  /** Active users holding the role. */
  holders: Schema.Number,
})
export type RoleInfo = typeof RoleInfo.Type

/** One page of users, its match count, and the roles to assign (names only). */
export const UserList = Schema.Struct({
  users: Schema.Array(UserInfo),
  total: Schema.Number,
  roles: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
})
export type UserList = typeof UserList.Type

export const UserQuery = Schema.Struct({
  ...ListQuery.fields,
  sort: Schema.optionalKey(Schema.Literals(['name', 'email', 'deactivated'])),
  id: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
}).check(Schema.makeFilter(listOffsetWithinLimit))
export type UserQuery = typeof UserQuery.Type

export const RoleList = Schema.Struct({ roles: Schema.Array(RoleInfo) })

const RoleInput = Schema.Struct({
  name: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100)),
  permissions: Schema.Array(Schema.String.check(Schema.isMaxLength(200))).check(
    Schema.isMaxLength(500),
  ),
})

/** Staff-only users endpoints. */
export const UsersGroup = HttpApiGroup.make('users')
  .add(
    HttpApiEndpoint.post('invite', '/invitations', {
      payload: Schema.Struct({ email: Email, roleIds: Schema.Array(Schema.String) }),
      success: Schema.Struct({ id: Schema.String }),
      error: [BadRequest, Conflict, Forbidden, Refused],
    }).annotate(Policy, 'users.manage'),
  )
  .add(
    HttpApiEndpoint.get('users', '/users', { query: UserQuery, success: UserList }).annotate(
      Policy,
      'users.manage',
    ),
  )
  .add(
    HttpApiEndpoint.put('assignRoles', '/users/:id/roles', {
      params: { id: Schema.String },
      payload: Schema.Struct({ roleIds: Schema.Array(Schema.String) }),
      error: [BadRequest, NotFound, Forbidden, Refused],
    }).annotate(Policy, 'users.manage'),
  )
  .add(
    HttpApiEndpoint.post('deactivate', '/users/:id/deactivate', {
      params: { id: Schema.String },
      error: [NotFound, Forbidden, Refused],
    }).annotate(Policy, 'users.manage'),
  )
  .add(
    HttpApiEndpoint.post('reactivate', '/users/:id/reactivate', {
      params: { id: Schema.String },
      error: [NotFound, Forbidden, Refused],
    }).annotate(Policy, 'users.manage'),
  )
  .add(
    // Signed-in: everyone sets their own; another user's needs users.manage (checked inside).
    HttpApiEndpoint.put('setLocale', '/users/:id/locale', {
      params: { id: Schema.String },
      payload: Schema.Struct({ locale: Schema.NullOr(AdminLocale) }),
      error: [NotFound, Forbidden, Refused],
    }).annotate(Policy, 'signedIn'),
  )
  .add(
    HttpApiEndpoint.get('roles', '/roles', { success: RoleList }).annotate(
      Policy,
      'users.roles.manage',
    ),
  )
  .add(
    HttpApiEndpoint.post('createRole', '/roles', {
      payload: RoleInput,
      success: Schema.Struct({ id: Schema.String }),
      error: [BadRequest, Conflict, Forbidden, Refused],
    }).annotate(Policy, 'users.roles.manage'),
  )
  .add(
    HttpApiEndpoint.put('updateRole', '/roles/:id', {
      params: { id: Schema.String },
      payload: RoleInput,
      error: [BadRequest, Conflict, NotFound, Forbidden, Refused],
    }).annotate(Policy, 'users.roles.manage'),
  )
  .middleware(Authorization)
