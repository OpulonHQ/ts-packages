import { verifyTurnstile } from '@opulonjs/core/turnstile'
import { Config, Effect, Option, Redacted } from 'effect'
import { TurnstileFailed } from '../api.ts'

/** The sign-in guard's Config keys, read from the Worker env. Off unless `USERS_TURNSTILE` is true. */
export const turnstileConfig = Config.all({
  enabled: Config.Boolean('USERS_TURNSTILE').pipe(Config.withDefault(false)),
  secret: Config.option(Config.Redacted('USERS_TURNSTILE_SECRET')),
  /** Comma-separated hostnames the admin is served from, e.g. `example.com,www.example.com`. */
  hostnames: Config.String('USERS_TURNSTILE_HOSTNAMES').pipe(Config.withDefault('')),
})

export const requireTurnstile = Effect.fn('Users.requireTurnstile')(function* (
  headers: Headers,
  action: 'sign-in' | 'request-password-reset',
  token: string | undefined,
) {
  const config = yield* Effect.orDie(turnstileConfig)
  if (!config.enabled) return
  const result = yield* Effect.promise(() =>
    verifyTurnstile({
      secret: Option.getOrUndefined(Option.map(config.secret, Redacted.value)),
      hostnames: config.hostnames.split(','),
      action,
      token,
      remoteIp: headers.get('cf-connecting-ip') ?? undefined,
    }),
  )
  if (result.ok) return
  if (result.reason === 'not-configured' || result.reason === 'unavailable')
    yield* Effect.logError(`turnstile ${action}: ${result.reason}`)
  return yield* new TurnstileFailed()
})
