import * as PgClient from '@effect/sql-pg/PgClient'
import { betterAuth } from 'better-auth'
import { Config, Context, Effect, Layer, Option, Redacted } from 'effect'
import { PostgresDialect } from 'kysely'
import pg from 'pg'
import { hashPassword, sha256Hex, verifyPassword } from './password.ts'
import { rateLimitTable, tables } from './schema.ts'

/** The host's public origin, e.g. `https://example.com`: cookies, CSRF checks, emailed links. */
export const usersBaseUrl = Config.String('USERS_BASE_URL')

/** Users' Config keys, read from the Worker env (module-prefixed). */
export const usersConfig = Config.all({
  baseUrl: usersBaseUrl,
  /** Signs session cookies; at least 32 random characters. */
  secret: Config.Redacted('USERS_AUTH_SECRET'),
})

/** What one Better Auth call produced, besides its response. */
export interface AuthResult {
  readonly status: number
  readonly body: unknown
  /** Set-Cookie headers to pass to the client. */
  readonly setCookies: ReadonlyArray<string>
  /** Seconds until a rate-limited client may retry (429 only). */
  readonly retryAfter?: number | undefined
  /** A reset email is due: Better Auth created a reset token for this user. */
  readonly resetRequested?: { readonly userId: string; readonly token: string }
  /** The password of this user was reset. */
  readonly passwordReset?: string
}

// Better Auth endpoints are reached only through users' own HttpApi endpoints, which build the
// request; this base path is internal and never mounted.
const basePath = '/auth'

/**
 * Better Auth, for login and sessions only (TSPACK-2): its own `pg` Pool over the same database
 * URL as the SqlClient (Hyperdrive on Workers), built lazily per request and closed with it.
 */
export class BetterAuth extends Context.Service<
  BetterAuth,
  {
    /** POSTs `body` to a Better Auth endpoint (`/sign-in/email`, ...) with the client's headers. */
    readonly post: (path: string, headers: Headers, body: unknown) => Effect.Effect<AuthResult>
    /** The session's user id (cookie cache off: always a database read), and refreshed cookies. */
    readonly session: (
      headers: Headers,
    ) => Effect.Effect<
      { readonly userId: string; readonly setCookies: ReadonlyArray<string> } | undefined
    >
  }
>()('@opulonjs/users/BetterAuth') {
  static readonly layer = Layer.effect(
    BetterAuth,
    Effect.gen(function* () {
      const client = yield* Effect.serviceOption(PgClient.PgClient)
      let pool: pg.Pool | undefined
      yield* Effect.addFinalizer(() =>
        pool ? Effect.promise(() => pool!.end()).pipe(Effect.ignore) : Effect.void,
      )

      const getPool = Effect.suspend(() => {
        if (pool) return Effect.succeed(pool)
        const url = Option.flatMapNullishOr(client, (c) => c.config.url)
        if (Option.isNone(url))
          return Effect.die(
            new Error('@opulonjs/users needs a PgClient configured with a url (PgFromHyperdrive)'),
          )
        // Hyperdrive pools connections, so one per request is enough.
        pool = new pg.Pool({
          connectionString: Redacted.value(url.value),
          max: 1,
          connectionTimeoutMillis: 10_000,
          // int8 as a number: Better Auth does arithmetic on rate_limit.last_request (epoch ms,
          // well within 2^53), and the default string made it concatenate retry-after values.
          types: {
            getTypeParser: (oid: number, format?: 'text' | 'binary') =>
              oid === pg.types.builtins.INT8 && (format ?? 'text') === 'text'
                ? Number
                : pg.types.getTypeParser(oid, format),
          },
        })
        // An idle connection the server closes must not crash the isolate; the next query
        // through the pool reconnects or fails on its own.
        pool.on('error', () => {})
        return Effect.succeed(pool)
      })

      // One instance per call: the callbacks report into this call's result only.
      const make = Effect.fn('BetterAuth.make')(function* (report: {
        resetRequested?: { userId: string; token: string }
        passwordReset?: string
      }) {
        const config = yield* Effect.orDie(usersConfig)
        const pool = yield* getPool
        const origin = new URL(config.baseUrl).origin
        // The stored hash this call's sign-in verified; its session carries it as a stamp.
        let verifiedHash: string | undefined
        return betterAuth({
          database: {
            dialect: new PostgresDialect({ pool }),
            type: 'postgres',
            schemaName: 'users',
          },
          ...tables,
          baseURL: origin,
          basePath,
          secret: Redacted.value(config.secret),
          trustedOrigins: [origin],
          telemetry: { enabled: false },
          emailAndPassword: {
            enabled: true,
            disableSignUp: true,
            password: {
              hash: hashPassword,
              verify: async (input) => {
                const ok = await verifyPassword(input)
                if (ok) verifiedHash = input.hash
                return ok
              },
            },
            resetPasswordTokenExpiresIn: 60 * 60,
            revokeSessionsOnPasswordReset: true,
            sendResetPassword: async ({ user, token }) => {
              report.resetRequested = { userId: user.id, token }
            },
            onPasswordReset: async ({ user }) => {
              report.passwordReset = user.id
            },
          },
          // Off (TSPACK-10): every request reads the session, so revocation is immediate.
          session: {
            ...tables.session,
            cookieCache: { enabled: false },
            additionalFields: {
              passwordStamp: {
                type: 'string',
                fieldName: 'password_stamp',
                required: false,
                input: false,
                returned: false,
              },
            },
          },
          verification: { ...tables.verification, storeIdentifier: 'hashed' },
          // Database storage: shared by every isolate, unlike the default memory store.
          rateLimit: {
            enabled: true,
            storage: 'database',
            ...rateLimitTable,
            customRules: {
              '/sign-in/email': { window: 60, max: 5 },
              '/request-password-reset': { window: 60, max: 3 },
              '/reset-password': { window: 60, max: 5 },
            },
          },
          advanced: {
            ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
            useSecureCookies: origin.startsWith('https:'),
          },
          // Migration 0002's insert trigger creates the session only for an active user whose
          // password is still the verified one, atomically with deactivation and reset.
          databaseHooks: {
            session: {
              create: {
                before: async (session) =>
                  verifiedHash === undefined
                    ? false
                    : { data: { ...session, passwordStamp: await sha256Hex(verifiedHash) } },
              },
            },
          },
        })
      })

      return BetterAuth.of({
        post: Effect.fn('BetterAuth.post')(function* (path, headers, body) {
          const report: {
            resetRequested?: { userId: string; token: string }
            passwordReset?: string
          } = {}
          const auth = yield* make(report)
          const config = yield* Effect.orDie(usersConfig)
          const forwarded = new Headers(headers)
          forwarded.delete('content-length')
          forwarded.set('content-type', 'application/json')
          const response = yield* Effect.promise(() =>
            auth.handler(
              new Request(new URL(`${basePath}${path}`, config.baseUrl), {
                method: 'POST',
                headers: forwarded,
                body: JSON.stringify(body),
              }),
            ),
          )
          const text = yield* Effect.promise(() => response.text())
          return {
            status: response.status,
            body: text ? (JSON.parse(text) as unknown) : undefined,
            setCookies: response.headers.getSetCookie(),
            retryAfter: Number(response.headers.get('x-retry-after')) || undefined,
            ...report,
          }
        }),
        session: Effect.fn('BetterAuth.session')(function* (headers) {
          const auth = yield* make({})
          const result = yield* Effect.promise(() =>
            auth.api.getSession({ headers, returnHeaders: true }),
          )
          if (!result.response) return undefined
          return {
            userId: result.response.user.id,
            setCookies: result.headers.getSetCookie(),
          }
        }),
      })
    }),
  )
}
