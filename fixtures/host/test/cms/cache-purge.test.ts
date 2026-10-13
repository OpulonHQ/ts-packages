import { CachePurger } from '@opulonjs/core'
import { type WorkersCache, workersCachePurge } from '@opulonjs/core/workers'
import { Effect } from 'effect'
import { expect, test } from 'vitest'

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

const purge = (ctx: { cache?: WorkersCache } | undefined, tags: Array<string>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cache = yield* CachePurger
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

test('does nothing when there is no Workers invocation context', async () => {
  await expect(purge(undefined, ['cms'])).resolves.toBeUndefined()
})

test('an invocation without Workers Cache fails closed', async () => {
  await expect(purge({}, ['cms'])).rejects.toMatchObject({
    _tag: 'CachePurgeFailed',
    reason: 'failed',
  })
})

test('an adapter rejection fails the port so the outbox can retain it', async () => {
  const down = fakeCache(() => Promise.reject(new Error('cache down')))
  await expect(purge({ cache: down.cache }, ['cms'])).rejects.toMatchObject({
    _tag: 'CachePurgeFailed',
    reason: 'failed',
  })
  expect(down.purged).toHaveLength(1)
})

test('a refused purge fails the port without retrying inside the invocation', async () => {
  const refused = fakeCache(async () => ({
    success: false,
    errors: [{ code: 1, message: 'rate limited' }],
  }))
  await expect(purge({ cache: refused.cache }, ['cms'])).rejects.toMatchObject({
    _tag: 'CachePurgeFailed',
    reason: 'refused',
  })
  expect(refused.purged).toHaveLength(1)
})
