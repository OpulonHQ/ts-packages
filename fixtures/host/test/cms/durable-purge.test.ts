import { expect, test } from 'vitest'
import { page, useCmsHost } from './helpers.ts'

let failing = true
const host = useCmsHost(undefined, async () => {
  if (failing) throw new Error('adapter failed with secret-token')
  return { success: true, errors: [] }
})

test('failed purges survive the request, are editor-readable, and a scheduled retry clears them', async () => {
  const created = await host.create(page({ en: '/durable-purge' }))
  expect((await host.publish(created.body.id)).status).toBe(200)
  const pending = await host.call<{
    rows: Array<{ state: string; attempts: number; error: string }>
  }>('GET', '/cache-purges', { as: ['cms.pages.view'] })
  expect(pending.status).toBe(200)
  expect(pending.body.rows).toMatchObject([
    { state: 'queued', attempts: 1, error: 'Cache purge failed.' },
  ])
  expect(JSON.stringify(pending.body)).not.toContain('secret-token')
  expect((await host.call('GET', '/cache-purges', { as: [] })).status).toBe(403)
  expect((await host.call('GET', '/cache-purges', { as: null })).status).toBe(401)
  failing = false
  await host.query("update core.cache_purge set next_attempt_at = now() - interval '1 second'")
  await host.sweep()
  expect((await host.call<{ rows: unknown[] }>('GET', '/cache-purges')).body.rows).toEqual([])
})

test('refusals stop after three attempts and remain visible until cached answers expire', async () => {
  const refused = useCmsHost(undefined, async () => ({
    success: false,
    errors: [{ code: 1, message: 'secret provider diagnostic' }],
  }))
  const created = await refused.create(page({ en: '/refused-purge' }))
  expect((await refused.publish(created.body.id)).status).toBe(200)
  for (let i = 0; i < 3; i++) {
    await refused.query("update core.cache_purge set next_attempt_at = now() - interval '1 second'")
    await refused.sweep()
  }
  expect(refused.purged).toHaveLength(3)
  const pending = await refused.call<{
    rows: Array<{ state: string; attempts: number; error: string; staleUntil: string }>
  }>('GET', '/cache-purges')
  expect(pending.body.rows).toMatchObject([
    { state: 'failed', attempts: 3, error: 'Cache purge was refused.' },
  ])
  expect(new Date(pending.body.rows[0]!.staleUntil).getTime()).toBeGreaterThan(Date.now())
  await refused.query("update core.cache_purge set created_at = now() - interval '1 hour 1 second'")
  await refused.sweep()
  expect((await refused.call<{ rows: unknown[] }>('GET', '/cache-purges')).body.rows).toEqual([])
})

test('concurrent scheduled retries claim a failed purge only once', async () => {
  let down = true
  const concurrent = useCmsHost(undefined, async () => {
    if (down) throw new Error('offline')
    await new Promise((resolve) => setTimeout(resolve, 40))
    return { success: true, errors: [] }
  })
  const created = await concurrent.create(page({ en: '/concurrent-purge' }))
  await concurrent.publish(created.body.id)
  down = false
  await concurrent.query(
    "update core.cache_purge set next_attempt_at = now() - interval '1 second'",
  )
  await Promise.all([concurrent.sweep(), concurrent.sweep()])
  expect(concurrent.purged).toHaveLength(2)
  expect((await concurrent.call<{ rows: unknown[] }>('GET', '/cache-purges')).body.rows).toEqual([])
})
