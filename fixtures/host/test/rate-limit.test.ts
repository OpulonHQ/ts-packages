import { RateLimit } from '@opulonjs/core'
import { PgFromHyperdrive } from '@opulonjs/core/workers'
import { Effect } from 'effect'
import type { SqlClient } from 'effect/sql/SqlClient'
import { expect, test } from 'vitest'
import { adminQuery } from '../../../test/postgres/admin.ts'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, origin, seedUser } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

const run = <A>(effect: Effect.Effect<A, unknown, SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(PgFromHyperdrive({ connectionString: db.url }))))

const within = (seconds: number) =>
  expect.toSatisfy((retryAfter: number) => retryAfter >= 1 && retryAfter <= seconds)

const endWindows = () =>
  adminQuery(db.url, `update core.rate_limit set expires_at = now() - interval '1 second'`)

test('a key is allowed up to its limit per window, then refused with the seconds until the window ends', async () => {
  const hits = await run(
    Effect.gen(function* () {
      return [
        yield* RateLimit.hit('contact:203.0.113.1', 2, '10 minutes'),
        yield* RateLimit.hit('contact:203.0.113.1', 2, '10 minutes'),
        yield* RateLimit.hit('contact:203.0.113.1', 2, '10 minutes'),
        yield* RateLimit.hit('contact:203.0.113.2', 2, '10 minutes'),
      ]
    }),
  )
  expect(hits).toEqual([
    { allowed: true },
    { allowed: true },
    { allowed: false, retryAfter: within(600) },
    { allowed: true },
  ])
})

test('a key is allowed again once its window ended', async () => {
  const hit = RateLimit.hit('sign-in:a@example.test:203.0.113.1', 1, '1 minute')
  expect(await run(Effect.all([hit, hit]))).toEqual([
    { allowed: true },
    { allowed: false, retryAfter: within(60) },
  ])
  await endWindows()
  expect(await run(Effect.all([hit, hit]))).toEqual([
    { allowed: true },
    { allowed: false, retryAfter: within(60) },
  ])
})

test('concurrent hits on one key are counted exactly', async () => {
  const hits = await run(
    Effect.all(
      Array.from({ length: 40 }, () => RateLimit.hit('booking:203.0.113.1', 15, '1 minute')),
      { concurrency: 'unbounded' },
    ),
  )
  expect(hits.filter((hit) => hit.allowed)).toHaveLength(15)
})

test('the cron removes entries whose window ended and keeps the others', async () => {
  await adminQuery(db.url, 'delete from core.rate_limit')
  await run(RateLimit.hit('ended', 1, '1 minute'))
  await endWindows()
  await run(RateLimit.hit('running', 1, '1 minute'))
  await host.worker.scheduled(
    { scheduledTime: Date.parse('2026-10-13T10:05:00Z'), cron: '*/5 * * * *' },
    host.env(),
  )
  expect(await adminQuery(db.url, 'select hits from core.rate_limit')).toEqual([{ hits: 1 }])
  expect(await run(RateLimit.hit('running', 1, '1 minute'))).toMatchObject({ allowed: false })
})

test("the fixture's /contact route answers 429 with Retry-After after 3 posts a minute from one address", async () => {
  const post = (ip: string) =>
    host.fetch(
      new Request(`${origin}/contact`, { method: 'POST', headers: { 'cf-connecting-ip': ip } }),
    )
  const answers = []
  for (let i = 0; i < 4; i++) answers.push(await post('203.0.113.7'))
  expect(answers.map((r) => r.status)).toEqual([204, 204, 204, 429])
  expect(Number(answers[3]!.headers.get('retry-after'))).toEqual(within(60))
  expect((await post('203.0.113.8')).status).toBe(204)
})

test("the demo module's ping endpoint answers 429 after 3 pings a minute from one user", async () => {
  const user = await seedUser(db.url, { permissions: ['demo.notes.view'] })
  const cookie = await host.signIn(user.email, user.password)
  const answers = []
  for (let i = 0; i < 4; i++) answers.push(await host.request('POST', '/demo/pings', { cookie }))
  expect(answers.map((r) => r.status)).toEqual([204, 204, 204, 429])
  expect(answers[3]!.body).toEqual({ _tag: 'TooManyRequests', retryAfter: within(60) })
})
