import { CachePurge, type WorkersCache, workersCachePurge } from '@opulonjs/cms/server'
import { Effect, Fiber } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { expect, test } from 'vitest'

/** A fake Workers Cache (`ctx.cache`): records purges and answers with `reply`. */
const fakeCache = (reply: () => ReturnType<WorkersCache['purge']>) => {
  const purged: Array<Array<string>> = []
  const cache: WorkersCache = {
    purge: (options) => {
      purged.push(options.tags)
      return reply()
    },
  }
  return { cache, purged }
}

const purge = (ctx: { cache?: WorkersCache }, tags: Array<string>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cache = yield* CachePurge
      yield* cache.purge(tags)
    }).pipe(Effect.provide(workersCachePurge(ctx))),
  )

const ok = async () => ({ success: true, errors: [] })

test("purges tags through the Worker's own cache, 100 tags per call", async () => {
  const fake = fakeCache(ok)
  const tags = Array.from({ length: 150 }, (_, i) => `cms:page:${i}`)
  await purge({ cache: fake.cache }, tags)
  expect(fake.purged).toEqual([tags.slice(0, 100), tags.slice(100)])
})

test('does nothing where the invocation has no Workers Cache', async () => {
  await expect(purge({}, ['cms'])).resolves.toBeUndefined()
})

test('a failed purge is logged, never failing the caller, and not retried', async () => {
  const down = fakeCache(() => Promise.reject(new Error('cache down')))
  await expect(purge({ cache: down.cache }, ['cms'])).resolves.toBeUndefined()
  expect(down.purged).toHaveLength(1)
})

test('a stalled purge ends at its deadline', async () => {
  const called = Promise.withResolvers<void>()
  const stalled = fakeCache(() => {
    called.resolve()
    return new Promise(() => {})
  })
  await Effect.runPromise(
    Effect.gen(function* () {
      const cache = yield* CachePurge
      const fiber = yield* Effect.forkChild(cache.purge(['cms']))
      yield* Effect.promise(() => called.promise)
      yield* TestClock.adjust('11 seconds')
      yield* Fiber.join(fiber)
    }).pipe(
      Effect.provide(workersCachePurge({ cache: stalled.cache })),
      Effect.provide(TestClock.layer()),
    ),
  )
  expect(stalled.purged).toHaveLength(1)
})

const refusedReply = async () => ({
  success: false,
  errors: [{ code: 1, message: 'rate limited' }],
})

/** Purges `cms` under the test clock, advancing it `steps` times by 12 seconds. */
const purgeOverTime = (cache: WorkersCache, steps: number) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const purger = yield* CachePurge
      const fiber = yield* Effect.forkChild(purger.purge(['cms']))
      for (let i = 0; i < steps; i++) yield* TestClock.adjust('12 seconds')
      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(workersCachePurge({ cache })), Effect.provide(TestClock.layer())),
  )

test('a refused (rate-limited) purge is retried as a token refills (12 s), at most twice', async () => {
  let calls = 0
  const flaky = fakeCache(() => (calls++ === 0 ? refusedReply() : ok()))
  await purgeOverTime(flaky.cache, 2)
  expect(flaky.purged).toEqual([['cms'], ['cms']])

  // Still refused after both retries: logged, the caller does not fail.
  const refused = fakeCache(refusedReply)
  await expect(purgeOverTime(refused.cache, 4)).resolves.toBeUndefined()
  expect(refused.purged).toHaveLength(3)
})
