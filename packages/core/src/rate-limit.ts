import { Duration, Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

/** The answer to one hit; `retryAfter` is whole seconds until the key's window ends (at least 1). */
export type RateLimitHit =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfter: number }

const Counted = Schema.Struct({ hits: Schema.Number, retry_after: Schema.Number })

export const RateLimit = {
  /**
   * Counts one hit on `key` and allows the first `limit` hits per `window`. The window starts at
   * the key's first hit; refused hits count too and do not extend it. Name the limit in the key
   * (`contact:<ip>`, `sign-in:<email>:<ip>`): one key has one limit and window. Only a SHA-256 of
   * the key is stored. Hit before opening a transaction: a rollback would undo the hit.
   */
  hit: Effect.fn('RateLimit.hit')(function* (key: string, limit: number, window: Duration.Input) {
    const sql = yield* SqlClient
    const seconds = Duration.toSeconds(Duration.fromInputUnsafe(window))
    const [row] = yield* sql`
      insert into core.rate_limit as r (key, hits, expires_at)
      values (sha256(convert_to(${key}, 'UTF8')), 1, now() + make_interval(secs => ${seconds}))
      on conflict (key) do update set
        hits = case when r.expires_at <= now() then 1 else r.hits + 1 end,
        expires_at = case when r.expires_at <= now() then excluded.expires_at
          else r.expires_at end
      returning hits, ceil(extract(epoch from expires_at - now()))::int as retry_after`
    const counted = yield* Schema.decodeUnknownEffect(Counted)(row)
    const hit: RateLimitHit =
      counted.hits <= limit
        ? { allowed: true }
        : { allowed: false, retryAfter: counted.retry_after }
    return hit
  }, Effect.orDie),
  sweep: Effect.fn('RateLimit.sweep')(function* () {
    const sql = yield* SqlClient
    yield* sql`delete from core.rate_limit where expires_at <= now()`
  }),
}
