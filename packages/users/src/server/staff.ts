import { Composed, type ComposedServer, holdsPolicy, type User } from '@opulonjs/core'
import { envConfig, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Effect, Layer } from 'effect'
import { BetterAuth } from './auth.ts'
import { authenticate } from './session.ts'

/** A signed-in staff user, as a host route outside the composed API sees it. */
export interface StaffSession {
  readonly user: User
  /** The session confirmed its password within `USERS_PASSWORD_CONFIRM_WINDOW`. */
  readonly passwordConfirmed: boolean
  /**
   * Set-Cookie values to append to the route's response: the refreshed session cookie when the
   * session was extended, else empty.
   */
  readonly setCookies: ReadonlyArray<string>
}

/** The session when the check passed, else the response to answer with. */
export type StaffCheck =
  ({ readonly ok: true } & StaffSession) | { readonly ok: false; readonly response: Response }

const refusal = (
  tag: 'Unauthorized' | 'Forbidden' | 'PasswordConfirmationRequired',
  setCookies: ReadonlyArray<string> = [],
) => {
  const response = Response.json(
    { _tag: tag },
    {
      status: tag === 'Unauthorized' ? 401 : 403,
      headers: { 'cache-control': 'private, no-store' },
    },
  )
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie)
  return response
}

/**
 * The staff session and permissions for host routes outside the composed API (a Nitro or
 * plain-fetch route next to `/api`), as Promises. `server` is the host's composed server;
 * `database` picks the Hyperdrive binding from the env, which also holds `USERS_BASE_URL` and
 * `USERS_AUTH_SECRET`. Every call reads the session and the user's roles from Postgres, so a
 * deactivated user or a removed role applies on the next request. It rejects when Postgres
 * cannot be reached. Pass the request as received: a mutating request from another origin
 * counts as signed out, as on the composed API.
 */
export const staffAccess = <Env extends object>(
  server: Pick<ComposedServer, 'composed'>,
  options: { readonly database: (env: Env) => { readonly connectionString: string } },
) => {
  const session = (request: Request, env: Env): Promise<StaffSession | undefined> =>
    Effect.runPromise(
      authenticate(new Headers(request.headers), request.method).pipe(
        Effect.map(
          (found) =>
            found && {
              user: found.user,
              passwordConfirmed: found.passwordConfirmed,
              setCookies: found.setCookies,
            },
        ),
        Effect.provide(
          Layer.mergeAll(
            BetterAuth.layer.pipe(Layer.provideMerge(PgFromHyperdrive(options.database(env)))),
            Layer.succeed(Composed, server.composed),
            envConfig(env),
          ),
        ),
      ),
    )
  return {
    /** The signed-in staff user of `request` with their permissions, or undefined. */
    session,
    /**
     * Requires `permission` (a catalog key, or `signedIn`) and, with `sensitive`, a password
     * confirmation within the window. A refusal carries the composed API's answer: 401 without
     * a session, 403 without the permission, 403 `PasswordConfirmationRequired` without a
     * recent confirmation.
     */
    async require(
      request: Request,
      env: Env,
      permission: string,
      { sensitive = false }: { readonly sensitive?: boolean } = {},
    ): Promise<StaffCheck> {
      const staff = await session(request, env)
      if (!staff) return { ok: false, response: refusal('Unauthorized') }
      if (!holdsPolicy(staff.user, permission))
        return { ok: false, response: refusal('Forbidden', staff.setCookies) }
      if (sensitive && !staff.passwordConfirmed)
        return {
          ok: false,
          response: refusal('PasswordConfirmationRequired', staff.setCookies),
        }
      return { ok: true, ...staff }
    },
  }
}
