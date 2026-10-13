import { Background, CachePurge, CachePurger, withTransaction } from '@opulonjs/core'
import { PgFromHyperdrive } from '@opulonjs/core/workers'
import { Effect, Fiber, Layer } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { beforeEach, expect, test } from 'vitest'
import { adminQuery } from '../../../test/postgres/admin.ts'
import { useTestDatabase } from '../../../test/postgres/index.ts'

const db = useTestDatabase()
beforeEach(() => adminQuery(db.url, 'delete from core.cache_purge'))

test('rollback removes durable purges and discards their after-commit attempts', async () => {
  const jobs: Array<Effect.Effect<void>> = []
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* withTransaction(
        Effect.gen(function* () {
          yield* CachePurge.afterCommit(['media:rollback', 'media'])
          yield* Effect.fail('rollback')
        }),
      ).pipe(Effect.ignore)
      expect(yield* CachePurge.pending()).toEqual([])
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          PgFromHyperdrive({ connectionString: db.url }),
          Layer.succeed(Background, { run: (job) => jobs.push(job) }),
        ),
      ),
    ),
  )
  expect(jobs).toEqual([])
})

test('a stalled purge ends at 20 seconds and remains queued for a durable retry', async () => {
  const called = Promise.withResolvers<void>()
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* CachePurge.afterCommit(['media:timeout', 'media'])
      const fiber = yield* Effect.forkChild(CachePurge.sweep())
      yield* Effect.promise(() => called.promise)
      yield* TestClock.adjust('20 seconds')
      yield* Fiber.join(fiber)
      expect(yield* CachePurge.pending()).toMatchObject([
        { attempts: 1, state: 'queued', error: 'Cache purge timed out.' },
      ])
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          PgFromHyperdrive({ connectionString: db.url }),
          Layer.succeed(Background, { run: () => {} }),
          Layer.succeed(CachePurger, {
            purge: () =>
              Effect.promise(() => {
                called.resolve()
                return new Promise<void>(() => {})
              }),
          }),
          TestClock.layer(),
        ),
      ),
    ),
  )
})

test('an expired lease on the final interrupted attempt is visible and never retried', async () => {
  await adminQuery(
    db.url,
    `insert into core.cache_purge (tags, attempts, next_attempt_at)
    values (array['media:interrupted', 'media'], 3, now() - interval '1 second')`,
  )
  let calls = 0
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* CachePurge.sweep()
      expect(yield* CachePurge.pending()).toMatchObject([
        { state: 'failed', attempts: 3, error: 'Cache purge was interrupted.' },
      ])
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          PgFromHyperdrive({ connectionString: db.url }),
          Layer.succeed(CachePurger, {
            purge: () =>
              Effect.sync(() => {
                calls++
              }),
          }),
        ),
      ),
    ),
  )
  expect(calls).toBe(0)
})

test('one sweep batches at most 50 due rows, leaving the rest durable', async () => {
  const calls: Array<ReadonlyArray<string>> = []
  await Effect.runPromise(
    Effect.gen(function* () {
      for (let i = 0; i < 51; i++) yield* CachePurge.afterCommit([`media:${i}`, 'media'])
      yield* CachePurge.sweep()
      expect(yield* CachePurge.pending()).toMatchObject([{ attempts: 0, state: 'queued' }])
      yield* CachePurge.sweep()
      expect(yield* CachePurge.pending()).toEqual([])
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          PgFromHyperdrive({ connectionString: db.url }),
          Layer.succeed(Background, { run: () => {} }),
          Layer.succeed(CachePurger, {
            purge: (tags) =>
              Effect.sync(() => {
                calls.push(tags)
              }),
          }),
        ),
      ),
    ),
  )
  expect(calls).toHaveLength(2)
  expect(calls[0]).toHaveLength(51)
  expect(calls[1]).toHaveLength(2)
})

test('the bounded editor list cannot hide an older exhausted failure from the status summary', async () => {
  await adminQuery(
    db.url,
    `insert into core.cache_purge (tags, attempts, reason, created_at)
    values (array['media:old'], 3, 'failed', now() - interval '10 minutes')`,
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      for (let i = 0; i < 51; i++) yield* CachePurge.afterCommit([`media:new-${i}`])
      expect(yield* CachePurge.pending()).toHaveLength(50)
      expect(yield* CachePurge.summary()).toMatchObject({ total: 52, failed: 1 })
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          PgFromHyperdrive({ connectionString: db.url }),
          Layer.succeed(Background, { run: () => {} }),
        ),
      ),
    ),
  )
})
