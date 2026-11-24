import { Effect } from 'effect'
import { loadAccess } from './access.ts'
import { BetterAuth, usersConfig } from './auth.ts'

/** CSRF: the request says it comes from another origin than the host's own. */
export const foreignOrigin = (headers: Headers) =>
  Effect.map(Effect.orDie(usersConfig), (config) => {
    const origin = headers.get('origin')
    return origin !== null && origin !== new URL(config.baseUrl).origin
  })

/**
 * The signed-in, active user of a request with its permissions, and the refreshed session
 * cookie when Better Auth extended the session; undefined when signed out. One rule for the
 * composed API's Authorization middleware and for host routes (`staffAccess`).
 */
export const authenticate = Effect.fn('Users.authenticate')(function* (
  headers: Headers,
  method: string,
) {
  if (!headers.get('cookie')) return undefined
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && (yield* foreignOrigin(headers)))
    return undefined
  const session = yield* (yield* BetterAuth).session(headers)
  if (!session) return undefined
  const access = yield* loadAccess(session.userId)
  return access?.active ? { user: access.user, setCookies: session.setCookies } : undefined
})
