import { Effect } from 'effect'
import { loadAccess } from './access.ts'
import { BetterAuth, usersConfig } from './auth.ts'

export const foreignOrigin = (headers: Headers) =>
  Effect.map(Effect.orDie(usersConfig), (config) => {
    const origin = headers.get('origin')
    return origin !== null && origin !== new URL(config.baseUrl).origin
  })

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
