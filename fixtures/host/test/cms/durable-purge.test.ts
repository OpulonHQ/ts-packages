import { expect, test } from 'vitest'
import { page, useCmsHost } from './helpers.ts'

let failing = true
const host = useCmsHost(undefined, async () => {
  if (failing) throw new Error('adapter failed with secret-token')
  return { success: true, errors: [] }
})

const refused = useCmsHost(undefined, async () => ({
  success: false,
  errors: [{ code: 1, message: 'secret provider diagnostic' }],
}))
let down = true
const concurrent = useCmsHost(undefined, async () => {
  if (down) throw new Error('offline')
  await new Promise((resolve) => setTimeout(resolve, 40))
  return { success: true, errors: [] }
})

test('core exposes safe purge status to media-only staff and rejects anonymous reads', async () => {
  const created = await refused.create(page({ en: '/media-status' }))
  expect((await refused.publish(created.body.id)).status).toBe(200)
  const response = await refused.fetchAs(['media.upload'])('https://host.test/api/cache-purges')
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toMatchObject({
    summary: { total: 1, failed: 0, staleUntil: expect.any(String) },
    rows: [
      {
        id: expect.any(String),
        attempts: 1,
        state: 'queued',
        error: 'Cache purge was refused.',
        staleUntil: expect.any(String),
      },
    ],
  })
  expect(Object.keys(body.rows[0]).sort()).toEqual([
    'attempts',
    'error',
    'id',
    'staleUntil',
    'state',
  ])
  expect(JSON.stringify(body)).not.toContain('secret provider diagnostic')
  expect((await refused.publicFetch('https://host.test/api/cache-purges')).status).toBe(401)
})

test('core denies purge status access to staff without a producer access permission', async () => {
  for (const permissions of [[], ['media.view']]) {
    expect((await refused.fetchAs(permissions)('https://host.test/api/cache-purges')).status).toBe(
      403,
    )
  }
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
  for (const permission of ['cms.collections.view', 'cms.site.view', 'cms.redirects.view']) {
    const allowed = await host.call<{ rows: unknown[] }>('GET', '/cache-purges', {
      as: [permission],
    })
    expect(allowed.status).toBe(200)
    expect(allowed.body.rows[0]).not.toHaveProperty('tags')
  }
  expect((await host.call('GET', '/cache-purges', { as: [] })).status).toBe(403)
  expect((await host.call('GET', '/cache-purges', { as: null })).status).toBe(401)
  await host.sweep()
  expect(host.purged).toHaveLength(1)
  failing = false
  await host.query("update core.cache_purge set next_attempt_at = now() - interval '1 second'")
  await host.sweep()
  expect((await host.call<{ rows: unknown[] }>('GET', '/cache-purges')).body.rows).toEqual([])
})

test('refusals stop after three attempts and remain visible until cached answers expire', async () => {
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
