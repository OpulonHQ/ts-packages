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
import { Context, Effect, Layer } from 'effect'
import { BadRequest, Conflict, Forbidden, Unauthorized } from 'effect/http-api/HttpApiError'
import { SqlClient } from 'effect/sql/SqlClient'
import { InvalidToken, Refused, TooManyRequests } from '../api.ts'
import { canGrant, loadAccess, lockAccessWrites } from './access.ts'
import { type AuthResult, BetterAuth, usersConfig } from './auth.ts'
import { adminLink, createInvitation, hashToken } from './invitations.ts'
import { hashPassword } from './password.ts'
import { invitationEmail, passwordResetEmail } from './templates.ts'

const addressPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const normalizeEmail = (email: string) => email.trim().toLowerCase()

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
      { readonly user: User; readonly setCookies: ReadonlyArray<string> } | undefined
    >
    readonly signIn: (
      headers: Headers,
      input: { readonly email: string; readonly password: string },
    ) => Effect.Effect<AuthResult & { readonly userId: string }, Unauthorized | TooManyRequests>
    readonly signOut: (headers: Headers) => Effect.Effect<AuthResult>
    readonly requestPasswordReset: (
      headers: Headers,
      email: string,
    ) => Effect.Effect<void, TooManyRequests>
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
          values (${crypto.randomUUID()}, ${`${headers.get('cf-connecting-ip') ?? ''}${path}`},
            1, ${now})
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
              new Error(`Better Auth answered ${result.status}: ${JSON.stringify(result.body)}`),
            )
          : Effect.void

      return Users.of({
        authenticate: Effect.fn('Users.authenticate')(function* (headers, method) {
          if (!headers.get('cookie')) return undefined
          // CSRF: a state-changing request must come from the host's own origin, if it says.
          const origin = headers.get('origin')
          if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            const config = yield* Effect.orDie(usersConfig)
            if (origin !== new URL(config.baseUrl).origin) return undefined
          }
          const session = yield* auth.session(headers)
          if (!session) return undefined
          const loaded = yield* loadUser(session.userId)
          return loaded && { user: loaded.user, setCookies: session.setCookies }
        }),

        signIn: Effect.fn('Users.signIn')(function* (headers, input) {
          const email = normalizeEmail(input.email)
          const result = yield* auth.post('/sign-in/email', headers, {
            email,
            password: input.password,
          })
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

        requestPasswordReset: Effect.fn('Users.requestPasswordReset')(function* (headers, email) {
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
          yield* requirePermission('users.manage')
          const inviter = yield* CurrentUser
          const email = normalizeEmail(input.email)
          if (!addressPattern.test(email)) return yield* new BadRequest()
          const roleIds = [...new Set(input.roleIds)]
          const catalog = (yield* Composed).permissions
          return yield* withTransaction(
            Effect.gen(function* () {
              // Under the users/roles lock, the inviter and the roles are read as of now.
              yield* lockAccessWrites
              const self = yield* loadUser(inviter.id)
              if (!self?.user.permissions.includes('users.manage')) return yield* new Forbidden()
              const roles = yield* sql<{ id: string; permissions: ReadonlyArray<string> }>`
                select id, to_jsonb(permissions) as permissions from users.role
                where id in (select jsonb_array_elements_text(${JSON.stringify(roleIds)}::jsonb))`
              if (roles.length !== roleIds.length) return yield* new BadRequest()
              // Escalation guard (TSPACK-10): an invitation grants its roles on acceptance.
              if (roles.some((role) => !canGrant(self, role, catalog)))
                return yield* new Refused({ reason: 'escalation' })
              if (yield* userIdByEmail(email)) return yield* new Conflict()
              const invitation = yield* createInvitation({ email, roleIds, invitedBy: inviter.id })
              yield* mail.send(invitationEmail, {
                to: email,
                vars: { link: invitation.link },
                about: { type: 'invitation', id: invitation.id },
              })
              return { id: invitation.id }
            }),
          ).pipe(
            Effect.provideService(Background, background),
            Effect.catchTag('SqlError', Effect.die),
          )
        }, withSql),
      })
    }),
  )
}
