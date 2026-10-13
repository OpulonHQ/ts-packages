import { CachePurge, cloudflareCachePurge } from '@opulonjs/cms/server'
import { ConfigProvider, Effect, Fiber, Layer } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { expect, test } from 'vitest'

/** A fake Cloudflare API: records requests and answers with `reply`. Never a real zone. */
const fakeCloudflare = (reply: () => Response) => {
  const requests: Array<{ url: string; auth: string | null; tags: Array<string> }> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    requests.push({
      url: request.url,
      auth: request.headers.get('authorization'),
      tags: ((await request.json()) as { tags: Array<string> }).tags,
    })
    return reply()
  }
  return { fetch, requests }
}

const purge = (env: Record<string, string>, fetch: typeof globalThis.fetch, tags: Array<string>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cache = yield* CachePurge
      yield* cache.purge(tags)
    }).pipe(
      Effect.provide(
        cloudflareCachePurge({ fetch }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
        ),
      ),
    ),
  )

const env = { CMS_CLOUDFLARE_ZONE_ID: 'zone-1', CMS_CLOUDFLARE_API_TOKEN: 'secret-token' }
const ok = () => Response.json({ success: true, errors: [], result: {} })

test('purges tags through the zone purge_cache endpoint, 100 tags per request', async () => {
  const api = fakeCloudflare(ok)
  const tags = Array.from({ length: 150 }, (_, i) => `cms:page:${i}`)
  await purge(env, api.fetch, tags)
  expect(api.requests).toEqual([
    {
      url: 'https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache',
      auth: 'Bearer secret-token',
      tags: tags.slice(0, 100),
    },
    expect.objectContaining({ tags: tags.slice(100) }),
  ])
})

test('does nothing until a zone and a token are configured', async () => {
  const api = fakeCloudflare(ok)
  await purge({ CMS_CLOUDFLARE_ZONE_ID: 'zone-1' }, api.fetch, ['cms'])
  expect(api.requests).toEqual([])
})

test('a refused or failed purge is logged, never failing the caller', async () => {
  const refused = fakeCloudflare(() => Response.json({ success: false }, { status: 403 }))
  await expect(purge(env, refused.fetch, ['cms'])).resolves.toBeUndefined()
  const down: typeof globalThis.fetch = () => Promise.reject(new Error('network down'))
  await expect(purge(env, down, ['cms'])).resolves.toBeUndefined()
  expect(refused.requests).toHaveLength(1)
})

test('one deadline covers the answer body too: a stalled body is cancelled and the purge ends', async () => {
  const called = Promise.withResolvers<void>()
  let cancelled = false
  const stalled: typeof globalThis.fetch = async () => {
    called.resolve()
    return new Response(new ReadableStream({ cancel: () => void (cancelled = true) }))
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const cache = yield* CachePurge
      const fiber = yield* Effect.forkChild(cache.purge(['cms']))
      yield* Effect.promise(() => called.promise)
      yield* TestClock.adjust('11 seconds')
      yield* Fiber.join(fiber)
    }).pipe(
      Effect.provide(
        cloudflareCachePurge({ fetch: stalled }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
        ),
      ),
      Effect.provide(TestClock.layer()),
    ),
  )
  expect(cancelled).toBe(true)
})
