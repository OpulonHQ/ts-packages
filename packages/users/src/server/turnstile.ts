import { verifyTurnstile } from '@opulonjs/core/turnstile'
import { Config, Effect, Option, Redacted } from 'effect'
import { TurnstileFailed, TurnstileNotConfigured } from '../api.ts'

const turnstileConfig = Config.all({
  enabled: Config.Boolean('USERS_TURNSTILE').pipe(Config.withDefault(false)),
  secret: Config.option(Config.Redacted('USERS_TURNSTILE_SECRET')),
  hostnames: Config.String('USERS_TURNSTILE_HOSTNAMES').pipe(Config.withDefault('')),
})

export const requireTurnstile = Effect.fn('Users.requireTurnstile')(function* (
  headers: Headers,
  action: 'sign-in' | 'request-password-reset',
  token: string | undefined,
) {
  const config = yield* Effect.orDie(turnstileConfig)
  if (!config.enabled) {
    if (token === undefined) return
    yield* Effect.logError(`turnstile ${action}: a token arrived but USERS_TURNSTILE is off`)
    return yield* new TurnstileNotConfigured()
  }
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
  if (result.reason === 'not-configured') {
    yield* Effect.logError(
      `turnstile ${action}: USERS_TURNSTILE is on without a secret or hostnames`,
    )
    return yield* new TurnstileNotConfigured()
  }
  if (result.reason === 'unavailable') yield* Effect.logError(`turnstile ${action}: unavailable`)
  return yield* new TurnstileFailed()
})
