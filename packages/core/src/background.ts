import { Context, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

/** The innermost open transaction (or savepoint) and the work queued in it. */
class OpenTransaction extends Context.Service<
  OpenTransaction,
  {
    readonly queue: Array<Effect.Effect<void>>
    readonly connection: SqlClient['transactionService']
  }
>()('@opulonjs/core/OpenTransaction') {}

/** Runs work after the response; the Workers adapter keeps the invocation alive until it settles. */
export class Background extends Context.Service<
  Background,
  { readonly run: (work: Effect.Effect<void>) => void }
>()('@opulonjs/core/Background') {
  /**
   * Queues `work` to run after the outermost transaction commits, on a fresh connection. A
   * rollback (of the transaction or of the savepoint it was queued in) discards it. Outside a
   * transaction it runs after the response. Failures are logged, never surfaced to the caller.
   */
  static readonly afterCommit = <E, R>(work: Effect.Effect<void, E, R>) =>
    Effect.gen(function* () {
      const tx = yield* Effect.serviceOption(OpenTransaction)
      // Captured now so the work keeps its services, minus the transaction it was queued in.
      const context = yield* Effect.context<R>()
      // Safe: only the transaction internals are dropped, and `work` cannot name them in R.
      const detached = (
        Option.isSome(tx) ? Context.omit(tx.value.connection, OpenTransaction)(context) : context
      ) as Context.Context<R>
      const job = work.pipe(
        Effect.provideContext(detached),
        Effect.catchCause((cause) => Effect.logError('afterCommit work failed', cause)),
      )
      if (Option.isSome(tx)) tx.value.queue.push(job)
      else (yield* Background).run(job)
    })
}

/**
 * Runs `effect` in a transaction; nested calls use savepoints. The only way modules open a
 * transaction, because it owns the afterCommit queue: a released savepoint hands its work to the
 * parent, a rollback drops it, and the outermost commit hands it to Background.
 */
export const withTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const parent = yield* Effect.serviceOption(OpenTransaction)
    const queue: Array<Effect.Effect<void>> = []
    const result = yield* sql.withTransaction(
      Effect.provideService(effect, OpenTransaction, { queue, connection: sql.transactionService }),
    )
    if (Option.isSome(parent)) parent.value.queue.push(...queue)
    else if (queue.length > 0) {
      // afterCommit's type requires Background, so it is present whenever work was queued.
      const background = yield* Effect.serviceOption(Background)
      for (const job of queue)
        if (Option.isSome(background)) background.value.run(job)
        else yield* job
    }
    return result
  })
