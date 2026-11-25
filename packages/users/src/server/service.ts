import {
  type Actor,
  Audit,
  type AuditInput,
  Background,
  Composed,
  CurrentActor,
  CurrentUser,
  requirePermission,
  type User,
  withTransaction,
} from '@opulonjs/core'
import { EmailService } from '@opulonjs/emails/server'
import { Context, Data, Effect, Layer } from 'effect'
import {
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
  Unauthorized,
} from 'effect/http-api/HttpApiError'
import { SqlClient } from 'effect/sql/SqlClient'
import {
  type InvitationInfo,
  InvalidToken,
  Refused,
  TooManyRequests,
  type TurnstileFailed,
  type TurnstileNotConfigured,
  WrongPassword,
} from '../api.ts'
import { type Access, canGrant, loadAccess, lockAccessWrites } from './access.ts'
import { type AuthResult, BetterAuth, signInRateLimitKey } from './auth.ts'
import {
  adminLink,
  createInvitation,
  hashToken,
  isEmailAddress,
  normalizeEmail,
} from './invitations.ts'
import { hashPassword, isBcryptHash, verifyPassword } from './password.ts'
import { authenticate, foreignOrigin } from './session.ts'
import { invitationEmail, passwordResetEmail } from './templates.ts'
import { requireTurnstile } from './turnstile.ts'

const userActor = (u: { readonly id: string; readonly name: string }): Actor => ({
  kind: 'user',
  id: u.id,
  name: u.name,
  permissions: [],
})

/** Auth events are best-effort (TSPACK-14): Better Auth's writes are not in our transaction. */
const auditBestEffort = (input: AuditInput, actor?: Actor) =>
  (actor
    ? Effect.provideService(Audit.record(input), CurrentActor, actor)
    : Audit.record(input)
  ).pipe(Effect.catchCause((cause) => Effect.logError(`audit ${input.action} failed`, cause)))

/** Better Auth answered 5xx; its error code only, since the message can quote user input. */
class BetterAuthServerError extends Data.TaggedError('BetterAuthServerError')<{
  readonly status: number
  readonly code: string
}> {}
const errorCode = (body: unknown) =>
  typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : 'none'
const tooMany = (result: AuthResult) => new TooManyRequests({ retryAfter: result.retryAfter ?? 60 })

/** Sign-in, sessions, password reset and invitations; implements core's auth ports. */
export class Users extends Context.Service<
  Users,
  {
    /**
     * The signed-in, active user of a request with its permissions, and the refreshed session
     * cookie when Better Auth extended the session; undefined when signed out.
     */
    readonly authenticate: (
      headers: Headers,
      method: string,
    ) => Effect.Effect<
      | {
          readonly user: User
          readonly sessionId: string
          /** The session confirmed its password within `USERS_PASSWORD_CONFIRM_WINDOW`. */
          readonly passwordConfirmed: boolean
          readonly setCookies: ReadonlyArray<string>
        }
      | undefined
    >
    /**
     * Confirms the request's session with its user's password, so the session passes sensitive
     * endpoints for the configured window. Rate limited per client address like sign-in; a
     * wrong password is audited.
     */
    readonly confirmPassword: (
      headers: Headers,
      password: string,
    ) => Effect.Effect<void, Unauthorized | WrongPassword | TooManyRequests>
    /**
     * Sets the password of the request's user, who proves the current one; their other sessions
     * end and the request's stays. Shares the confirmation's rate limit and wrong-password event.
     */
    readonly changePassword: (
      headers: Headers,
      input: { readonly currentPassword: string; readonly newPassword: string },
    ) => Effect.Effect<void, Unauthorized | WrongPassword | TooManyRequests>
    readonly signIn: (
      headers: Headers,
      input: {
        readonly email: string
        readonly password: string
        readonly turnstileToken?: string | undefined
      },
    ) => Effect.Effect<
      AuthResult & { readonly userId: string },
      Unauthorized | TooManyRequests | TurnstileFailed | TurnstileNotConfigured
    >
    readonly signOut: (headers: Headers) => Effect.Effect<AuthResult>
    readonly requestPasswordReset: (
      headers: Headers,
      email: string,
      turnstileToken?: string,
    ) => Effect.Effect<void, TooManyRequests | TurnstileFailed | TurnstileNotConfigured>
    readonly resetPassword: (
      headers: Headers,
      input: { readonly token: string; readonly password: string },
    ) => Effect.Effect<void, InvalidToken | TooManyRequests>
    /** The invited address of a pending invitation. */
    readonly invitation: (token: string) => Effect.Effect<{ readonly email: string }, InvalidToken>
    /**
     * Creates the invitee's user with the password and roles; counts as email verification.
     * Rate limited per client address (`cf-connecting-ip` of `headers`).
     */
    readonly acceptInvitation: (
      headers: Headers,
      input: { readonly token: string; readonly name: string; readonly password: string },
    ) => Effect.Effect<void, InvalidToken | Conflict | TooManyRequests>
    /** Invites `email` with roles, emailing the link. Needs `users.manage`. */
    readonly invite: (input: {
      readonly email: string
      readonly roleIds: ReadonlyArray<string>
    }) => Effect.Effect<
      { readonly id: string },
      BadRequest | Conflict | Forbidden | Refused,
      CurrentUser
    >
    /** Invitations not yet accepted, newest first, expired ones included. Needs `users.manage`. */
    readonly invitations: () => Effect.Effect<
      { readonly invitations: ReadonlyArray<InvitationInfo> },
      Forbidden,
      CurrentUser
    >
    /** Deletes an open invitation, so its link stops working. Needs `users.manage`. */
    readonly revokeInvitation: (
      id: string,
    ) => Effect.Effect<void, NotFound | Forbidden | Refused, CurrentUser>
    /**
     * Invites the address of an open invitation again with its roles: a new link is emailed and
     * the old one stops working. Needs `users.manage`.
     */
    readonly resendInvitation: (
      id: string,
    ) => Effect.Effect<
      { readonly id: string },
      NotFound | Conflict | Forbidden | Refused,
      CurrentUser
    >
  }
>()('@opulonjs/users/Users') {
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const auth = yield* BetterAuth
      const mail = yield* EmailService
      const background = yield* Background
      const withSql = Effect.provideService(SqlClient, sql)

      /** The active user's access; undefined for unknown or deactivated users. */
      const loadUser = (id: string) =>
        loadAccess(id).pipe(
          Effect.map((access) => (access?.active ? access : undefined)),
          withSql,
        )

      const userIdByEmail = (email: string) =>
        sql<{ id: string; name: string }>`select id, name from users."user"
          where email = ${normalizeEmail(email)}`.pipe(
          Effect.map((rows) => rows[0]),
          Effect.orDie,
        )

      const pendingInvitation = (tokenHash: string) =>
        Effect.gen(function* () {
          const [row] = yield* sql<{ email: string }>`select email from users.invitation
            where token_hash = ${tokenHash} and accepted_at is null
              and expires_at > now()`.pipe(Effect.orDie)
          if (!row) return yield* new InvalidToken()
          return row
        })

      /**
       * A fixed-window limit per client address for our own public endpoints, in Better Auth's
       * database rate_limit table (its rules cover sign-in and password reset); `path` keeps the
       * keys apart from Better Auth's.
       */
      const throttle = Effect.fn('Users.throttle')(function* (
        headers: Headers,
        path: string,
        rule: { readonly window: number; readonly max: number },
      ) {
        const now = Date.now()
        const expired = now - rule.window * 1000
        const [row] = yield* sql<{ count: number; since: string }>`
          insert into users.rate_limit as r (id, key, count, last_request)
          values (${crypto.randomUUID()}, ${signInRateLimitKey(headers, path)}, 1, ${now})
          on conflict (key) do update set
            count = case when r.last_request <= ${expired} then 1 else r.count + 1 end,
            last_request = case when r.last_request <= ${expired} then ${now}
              else r.last_request end
          returning count, last_request::text as since`.pipe(Effect.orDie)
        if (row && row.count > rule.max)
          return yield* new TooManyRequests({
            retryAfter: Math.max(1, Math.ceil((Number(row.since) - expired) / 1000)),
          })
      })

      const failOnServerError = (result: AuthResult) =>
        result.status >= 500
          ? Effect.die(
              new BetterAuthServerError({ status: result.status, code: errorCode(result.body) }),
            )
          : Effect.void

      const withPassword = Effect.fn('Users.withPassword')(function* (
        headers: Headers,
        password: string,
      ) {
        const signedIn = yield* authenticate(headers, 'POST').pipe(
          Effect.provideService(BetterAuth, auth),
        )
        if (!signedIn) return yield* new Unauthorized()
        yield* throttle(headers, '/password-confirmation', { window: 60, max: 5 })
        const { user } = signedIn
        const [account] = yield* sql<{ password: string | null }>`
          select password from users.account
          where user_id = ${user.id} and provider_id = 'credential'`.pipe(Effect.orDie)
        const hash = account?.password
        if (!hash || !(yield* Effect.promise(() => verifyPassword({ hash, password })))) {
          yield* auditBestEffort(
            {
              action: 'users.password_confirmation_failed',
              subject: { type: 'user', id: user.id, label: user.email },
            },
            userActor(user),
          )
          return yield* new WrongPassword()
        }
        return signedIn
      }, withSql)

      type GrantedRole = { readonly id: string; readonly permissions: ReadonlyArray<string> }
      const rolesById = (ids: ReadonlyArray<string>) =>
        sql<GrantedRole>`select id, to_jsonb(permissions) as permissions from users.role
          where id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`

      const asManager = <A, E, R>(
        change: (self: Access, catalog: ReadonlyArray<string>) => Effect.Effect<A, E, R>,
      ) =>
        Effect.gen(function* () {
          yield* requirePermission('users.manage')
          const me = yield* CurrentUser
          const catalog = (yield* Composed).permissions
          return yield* withTransaction(
            Effect.gen(function* () {
              yield* lockAccessWrites
              const self = yield* loadUser(me.id)
              if (!self?.user.permissions.includes('users.manage')) return yield* new Forbidden()
              return yield* change(self, catalog)
            }),
          ).pipe(
            Effect.provideService(Background, background),
            Effect.catchTag('SqlError', Effect.die),
          )
        }).pipe(withSql)

      const grantable = (
        self: Access,
        roles: ReadonlyArray<GrantedRole>,
        catalog: ReadonlyArray<string>,
      ) =>
        roles.every((role) => canGrant(self, role, catalog))
          ? Effect.void
          : Effect.fail(new Refused({ reason: 'escalation' }))

      const openInvitation = Effect.fn('Users.openInvitation')(function* (id: string) {
        const [open] = yield* sql<{ email: string; roleIds: ReadonlyArray<string> }>`
          select email, to_jsonb(role_ids) as "roleIds" from users.invitation
          where id = ${id} and accepted_at is null`
        if (!open) return yield* new NotFound()
        return { email: open.email, roles: yield* rolesById(open.roleIds) }
      })

      const sendInvitation = Effect.fn('Users.sendInvitation')(function* (
        self: Access,
        catalog: ReadonlyArray<string>,
        email: string,
        roles: ReadonlyArray<GrantedRole>,
      ) {
        yield* grantable(self, roles, catalog)
        if (yield* userIdByEmail(email)) return yield* new Conflict()
        const invitation = yield* createInvitation({
          email,
          roleIds: roles.map((role) => role.id),
          invitedBy: self.user.id,
        })
        yield* mail.send(invitationEmail, {
          to: email,
          vars: { link: invitation.link },
          about: { type: 'invitation', id: invitation.id },
        })
        return { id: invitation.id }
      })

      return Users.of({
        authenticate: (headers, method) =>
          authenticate(headers, method).pipe(Effect.provideService(BetterAuth, auth), withSql),

        confirmPassword: Effect.fn('Users.confirmPassword')(function* (headers, password) {
          const signedIn = yield* withPassword(headers, password)
          yield* sql`update users.session
            set password_confirmed_at = to_timestamp(${Date.now()}::double precision / 1000)
            where id = ${signedIn.sessionId}`.pipe(Effect.orDie)
        }),

        changePassword: Effect.fn('Users.changePassword')(function* (headers, input) {
          const { user, sessionId } = yield* withPassword(headers, input.currentPassword)
          const hash = yield* Effect.promise(() => hashPassword(input.newPassword))
          yield* withTransaction(
            Effect.gen(function* () {
              yield* sql`update users.account set password = ${hash}, updated_at = now()
                where user_id = ${user.id} and provider_id = 'credential'`
              yield* sql`delete from users.session
                where user_id = ${user.id} and id <> ${sessionId}`
              yield* Audit.record({
                action: 'users.password_changed',
                subject: { type: 'user', id: user.id, label: user.email },
              }).pipe(Effect.provideService(CurrentActor, userActor(user)))
            }),
          ).pipe(Effect.catchTag('SqlError', Effect.die))
        }, withSql),

        signIn: Effect.fn('Users.signIn')(function* (headers, input) {
          // Login CSRF: another site must not sign a visitor in to an account it controls.
          if (yield* foreignOrigin(headers)) return yield* new Unauthorized()
          yield* requireTurnstile(headers, 'sign-in', input.turnstileToken)
          const email = normalizeEmail(input.email)
          const { verifiedHash: verified, ...result } = yield* auth.post(
            '/sign-in/email',
            headers,
            { email, password: input.password },
          )
          yield* failOnServerError(result)
          if (result.status === 429) return yield* tooMany(result)
          const known = yield* userIdByEmail(email)
          if (result.status !== 200 || !known) {
            yield* auditBestEffort({
              action: 'users.sign_in_failed',
              ...(known ? { subject: { type: 'user', id: known.id, label: email } } : {}),
              context: { email: email.slice(0, 254) },
            })
            return yield* new Unauthorized()
          }
          if (verified !== undefined && isBcryptHash(verified)) {
            const upgraded = yield* Effect.promise(() => hashPassword(input.password))
            yield* sql`update users.account set password = ${upgraded}, updated_at = now()
              where user_id = ${known.id} and provider_id = 'credential'
                and password = ${verified}`.pipe(Effect.orDie)
          }
          yield* auditBestEffort(
            { action: 'users.signed_in', subject: { type: 'user', id: known.id, label: email } },
            userActor(known),
          )
          return { ...result, userId: known.id }
        }, withSql),

        signOut: Effect.fn('Users.signOut')(function* (headers) {
          const session = headers.get('cookie') ? yield* auth.session(headers) : undefined
          const result = yield* auth.post('/sign-out', headers, {})
          yield* failOnServerError(result)
          if (session && result.status === 200) {
            const known = (yield* loadUser(session.userId))?.user
            yield* auditBestEffort(
              { action: 'users.signed_out', subject: { type: 'user', id: session.userId } },
              known ? userActor(known) : undefined,
            )
          }
          return result
        }, withSql),

        requestPasswordReset: Effect.fn('Users.requestPasswordReset')(function* (
          headers,
          email,
          turnstileToken,
        ) {
          yield* requireTurnstile(headers, 'request-password-reset', turnstileToken)
          const result = yield* auth.post('/request-password-reset', headers, {
            email: normalizeEmail(email),
          })
          yield* failOnServerError(result)
          if (result.status === 429) return yield* tooMany(result)
          const requested = result.resetRequested
          if (!requested) return
          // After the response, so an existing address answers as fast as an unknown one.
          yield* Background.afterCommit(
            withTransaction(
              Effect.gen(function* () {
                const [user] = yield* sql<{ name: string; email: string; locale: string | null }>`
                  select name, email, admin_locale as locale from users."user"
                  where id = ${requested.userId} and deactivated_at is null`
                if (!user) return
                yield* mail.send(passwordResetEmail, {
                  to: user.email,
                  locale: user.locale,
                  vars: {
                    name: user.name,
                    link: yield* adminLink('reset-password', requested.token),
                  },
                  about: { type: 'user', id: requested.userId },
                })
                yield* Audit.record({
                  action: 'users.password_reset_requested',
                  subject: { type: 'user', id: requested.userId, label: user.email },
                })
              }),
            ),
          ).pipe(Effect.provideService(Background, background))
        }, withSql),

        resetPassword: Effect.fn('Users.resetPassword')(function* (headers, input) {
          const result = yield* auth.post('/reset-password', headers, {
            token: input.token,
            newPassword: input.password,
          })
          yield* failOnServerError(result)
          if (result.status === 429) return yield* tooMany(result)
          if (result.status !== 200 || !result.passwordReset) return yield* new InvalidToken()
          const known = yield* loadUser(result.passwordReset)
          yield* auditBestEffort(
            { action: 'users.password_reset', subject: { type: 'user', id: result.passwordReset } },
            known ? userActor(known.user) : undefined,
          )
        }, withSql),

        invitation: Effect.fn('Users.invitation')(function* (token) {
          return yield* pendingInvitation(yield* hashToken(token))
        }),

        acceptInvitation: Effect.fn('Users.acceptInvitation')(function* (headers, input) {
          yield* throttle(headers, '/invitations/accept', { window: 60, max: 5 })
          const tokenHash = yield* hashToken(input.token)
          // A cheap lookup first: unknown tokens never cost a password hash.
          yield* pendingInvitation(tokenHash)
          const password = yield* Effect.promise(() => hashPassword(input.password))
          yield* withTransaction(
            Effect.gen(function* () {
              // The shared lock first, as every users/roles/invitation write takes it: granting
              // a role (Super admin's row is the lock) after locking the invitation would
              // deadlock with a re-invite that holds the lock and replaces this invitation.
              yield* lockAccessWrites
              const [invitation] = yield* sql<{ id: string; email: string }>`
                select id, email from users.invitation
                where token_hash = ${tokenHash} and accepted_at is null and expires_at > now()
                for update`
              if (!invitation) return yield* new InvalidToken()
              if (yield* userIdByEmail(invitation.email)) return yield* new Conflict()
              const id = crypto.randomUUID()
              yield* sql`insert into users."user" (id, name, email, email_verified)
                values (${id}, ${input.name}, ${invitation.email}, true)`
              yield* sql`insert into users.account (id, account_id, provider_id, user_id, password,
                  updated_at)
                values (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${password}, now())`
              // An invitation grants roles, not a snapshot of their permissions: a role edited
              // since applies to the invitee as to every holder (the edit passed the escalation
              // guard itself), so nothing is re-checked here. Deleted roles are skipped.
              yield* sql`insert into users.user_role (user_id, role_id)
                select ${id}, r.id from users.invitation i join users.role r on r.id = any(i.role_ids)
                where i.id = ${invitation.id}`
              yield* sql`update users.invitation set accepted_at = now(), accepted_user_id = ${id}
                where id = ${invitation.id}`
              yield* Audit.record({
                action: 'users.invitation_accepted',
                subject: { type: 'user', id, label: invitation.email },
                context: { invitationId: invitation.id },
              }).pipe(Effect.provideService(CurrentActor, userActor({ id, name: input.name })))
            }),
          ).pipe(Effect.catchTag('SqlError', Effect.die))
        }, withSql),

        invite: Effect.fn('Users.invite')(function* (input) {
          const email = normalizeEmail(input.email)
          if (!isEmailAddress(email)) return yield* new BadRequest()
          const roleIds = [...new Set(input.roleIds)]
          return yield* asManager((self, catalog) =>
            Effect.gen(function* () {
              const roles = yield* rolesById(roleIds)
              if (roles.length !== roleIds.length) return yield* new BadRequest()
              return yield* sendInvitation(self, catalog, email, roles)
            }),
          )
        }),

        invitations: Effect.fn('Users.invitations')(function* () {
          yield* requirePermission('users.manage')
          const invitations = yield* sql<InvitationInfo>`
            select i.id, i.email, to_json(i.created_at) #>> '{}' as "createdAt",
              to_json(i.expires_at) #>> '{}' as "expiresAt", i.expires_at <= now() as expired,
              coalesce((select jsonb_agg(r.id order by r.id) from users.role r
                where r.id = any(i.role_ids)), '[]'::jsonb) as "roleIds"
            from users.invitation i where i.accepted_at is null
            order by i.created_at desc, i.id`.pipe(Effect.orDie)
          return { invitations }
        }),

        revokeInvitation: Effect.fn('Users.revokeInvitation')(function* (id) {
          return yield* asManager((self, catalog) =>
            Effect.gen(function* () {
              const open = yield* openInvitation(id)
              yield* grantable(self, open.roles, catalog)
              yield* sql`delete from users.invitation where id = ${id}`
              yield* Audit.record({
                action: 'users.invitation_revoked',
                subject: { type: 'invitation', id, label: open.email },
              })
            }),
          )
        }),

        resendInvitation: Effect.fn('Users.resendInvitation')(function* (id) {
          return yield* asManager((self, catalog) =>
            Effect.flatMap(openInvitation(id), (open) =>
              sendInvitation(self, catalog, open.email, open.roles),
            ),
          )
        }),
      })
    }),
  )
}
