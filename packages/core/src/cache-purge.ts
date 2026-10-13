import { Cause, Context, Data, Effect, Exit, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { Background } from './background.ts'

export class CachePurgeFailed extends Data.TaggedError('CachePurgeFailed')<{
  readonly reason: 'refused' | 'failed' | 'timeout'
  readonly detail: string
}> {}

/** Host cache port. A refusal or adapter error must fail the effect. */
export const CachePurger = Context.Reference<{
  readonly purge: (tags: ReadonlyArray<string>) => Effect.Effect<void, CachePurgeFailed>
}>('@opulonjs/core/CachePurger', { defaultValue: () => ({ purge: () => Effect.void }) })

const maxAttempts = 3
const sweepBatch = 50
const attemptDeadline = '20 seconds'
const leaseMinutes = 5

const Claimed = Schema.Struct({
  id: Schema.String,
  tags: Schema.Array(Schema.String),
})
const decodeClaims = Schema.decodeUnknownEffect(Schema.Array(Claimed))

const attempt = Effect.fn('CachePurge.attempt')(function* (id?: string) {
  const sql = yield* SqlClient
  const purger = yield* CachePurger
  const claimed = yield* decodeClaims(
    yield* sql`
    update core.cache_purge set attempts = attempts + 1, reason = null, error = null,
      next_attempt_at = now() + make_interval(mins => ${leaseMinutes})
    where id in (
      select id from core.cache_purge
      where next_attempt_at <= now() and attempts < ${maxAttempts}
        and created_at > now() - interval '1 hour'
        ${id === undefined ? sql.literal('') : sql`and id = ${id}`}
      order by next_attempt_at, id limit ${sweepBatch} for update skip locked
    ) returning id, tags`,
  ).pipe(Effect.orDie)
  if (claimed.length === 0) return
  const ids = claimed.map((row) => row.id)
  const tags = [...new Set(claimed.flatMap((row) => row.tags))]
  const exit = yield* Effect.exit(
    purger.purge(tags).pipe(
      Effect.timeoutOrElse({
        duration: attemptDeadline,
        orElse: () =>
          Effect.fail(
            new CachePurgeFailed({
              reason: 'timeout',
              detail: 'Cache purge timed out after 20 seconds.',
            }),
          ),
      }),
    ),
  )
  if (Exit.isSuccess(exit)) {
    yield* sql`delete from core.cache_purge where id in ${sql.in(ids)}`
    return
  }
  const error = Cause.findErrorOption(exit.cause)
  const reason =
    Option.isSome(error) && error.value instanceof CachePurgeFailed ? error.value.reason : 'failed'
  const diagnostic = Cause.pretty(exit.cause).slice(0, 2000)
  yield* sql`update core.cache_purge set reason = ${reason}, error = ${diagnostic}
    where id in ${sql.in(ids)}`
  yield* Effect.logWarning('cache purge attempt failed', { ids, reason })
})

const Pending = Schema.Struct({
  id: Schema.String,
  tags: Schema.Array(Schema.String),
  attempts: Schema.Number,
  state: Schema.Literals(['queued', 'failed']),
  reason: Schema.NullOr(Schema.Literals(['refused', 'failed', 'timeout', 'interrupted'])),
  stale_until: Schema.Date,
})
const decodePending = Schema.decodeUnknownEffect(Schema.Array(Pending))
const Summary = Schema.Struct({
  total: Schema.Number,
  failed: Schema.Number,
  stale_until: Schema.NullOr(Schema.Date),
})
const messages = {
  refused: 'Cache purge was refused.',
  failed: 'Cache purge failed.',
  timeout: 'Cache purge timed out.',
  interrupted: 'Cache purge was interrupted.',
}

export const CachePurge = {
  /** Status across all active rows, including failures beyond the bounded editor list. */
  summary: Effect.fn('CachePurge.summary')(function* () {
    const sql = yield* SqlClient
    const [row] = yield* sql`
      select count(*)::int as total,
        count(*) filter (where attempts >= ${maxAttempts} and (reason is not null or next_attempt_at <= now()))::int as failed,
        max(created_at + interval '1 hour') as stale_until
      from core.cache_purge where created_at > now() - interval '1 hour'`
    const summary = yield* Schema.decodeUnknownEffect(Summary)(row).pipe(Effect.orDie)
    return {
      total: summary.total,
      failed: summary.failed,
      staleUntil: summary.stale_until?.toISOString() ?? null,
    }
  }),
  /** Persists tags in the caller's transaction and attempts them after its outermost commit. */
  afterCommit: Effect.fn('CachePurge.afterCommit')(function* (tags: ReadonlyArray<string>) {
    if (tags.length === 0) return
    const sql = yield* SqlClient
    const rows = yield* Schema.decodeUnknownEffect(
      Schema.Array(Schema.Struct({ id: Schema.String })),
    )(
      yield* sql`insert into core.cache_purge (tags)
        values (array(select jsonb_array_elements_text(${JSON.stringify([...new Set(tags)])}::jsonb))) returning id`,
    ).pipe(Effect.orDie)
    for (const row of rows) yield* Background.afterCommit(attempt(row.id))
  }),
  /** Retries at most 50 due rows. Three attempts include interrupted and immediate attempts. */
  sweep: Effect.fn('CachePurge.sweep')(function* () {
    const sql = yield* SqlClient
    yield* sql`delete from core.cache_purge where id in (
      select id from core.cache_purge where created_at <= now() - interval '1 hour'
      order by created_at limit ${sweepBatch} for update skip locked
    )`
    yield* sql`update core.cache_purge set reason = 'interrupted',
      error = 'The final cache purge attempt was interrupted.'
      where id in (
        select id from core.cache_purge where attempts >= ${maxAttempts}
          and reason is null and next_attempt_at <= now()
        order by next_attempt_at limit ${sweepBatch} for update skip locked
      )`
    yield* attempt()
  }),
  /** Bounded editor summary. Diagnostics stay in storage; failures remain for one hour. */
  pending: Effect.fn('CachePurge.pending')(function* () {
    const sql = yield* SqlClient
    const rows = yield* decodePending(
      yield* sql`
      select id, tags, attempts,
        case when attempts >= ${maxAttempts} and (reason is not null or next_attempt_at <= now())
          then 'failed' else 'queued' end as state,
        case when attempts >= ${maxAttempts} and reason is null and next_attempt_at <= now()
          then 'interrupted' else reason end as reason,
        created_at + interval '1 hour' as stale_until
      from core.cache_purge where created_at > now() - interval '1 hour'
      order by created_at desc, id limit ${sweepBatch}`,
    ).pipe(Effect.orDie)
    return rows.map((row) => ({
      id: row.id,
      tags: row.tags,
      attempts: row.attempts,
      state: row.state,
      error: row.reason === null ? null : messages[row.reason],
      staleUntil: row.stale_until.toISOString(),
    }))
  }),
}
