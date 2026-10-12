import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import worker, { type Env } from '../worker.ts'

const db = useTestDatabase()

// Stands in for the ASSETS binding serving fixtures/host/public (html_handling "none").
const files: Record<string, string> = {
  '/admin/index.html': '<!doctype html><title>admin</title>',
  '/admin/assets/index-abc123.js': 'console.log(1)',
  '/admin/favicon.svg': '<svg/>',
}
const assets: Env['ASSETS'] = {
  fetch: async (request) => {
    const body = files[new URL(request.url).pathname]
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(body)
  },
}

const env = (): Env => ({
  HYPERDRIVE: { connectionString: db.url },
  DEMO_TOKEN: 'test-token',
  OPULON_BUILD_ID: 'build-1',
  ASSETS: assets,
})

async function request(path: string, headers: Record<string, string> = {}) {
  const pending: Array<Promise<unknown>> = []
  const response = await worker.fetch(new Request(`https://host.test${path}`, { headers }), env(), {
    waitUntil: (p) => pending.push(p),
  })
  const text = await response.text()
  await Promise.all(pending)
  const json = response.headers.get('content-type')?.includes('json')
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: json ? JSON.parse(text) : text,
  }
}

test('serves the demo module under /api/<module id> behind its policy', async () => {
  expect(await request('/api/demo/notes', { authorization: 'Bearer test-token' })).toMatchObject({
    status: 200,
    body: [{ id: 1, body: 'hello from demo' }],
  })
})

test('rejects a request without a user', async () => {
  expect((await request('/api/demo/notes')).status).toBe(401)
})

test('the cron runs the demo task as the system actor, and its afterCommit work lands', async () => {
  await worker.scheduled(
    { scheduledTime: Date.parse('2026-10-13T10:05:00Z'), cron: '*/5 * * * *' },
    env(),
  )
  expect(await request('/api/demo/ticks', { authorization: 'Bearer test-token' })).toMatchObject({
    status: 200,
    body: [{ actor: 'system', confirmed: true }],
  })
})

test('serves nothing outside the API prefix and /admin', async () => {
  expect((await request('/demo/notes', { authorization: 'Bearer test-token' })).status).toBe(404)
})

test('/me returns the build id and the enabled module ids, never cached', async () => {
  expect(await request('/api/me')).toEqual({
    status: 200,
    cacheControl: 'private, no-store',
    body: { buildId: 'build-1', modules: ['demo'] },
  })
})

test('/admin/** falls back to index.html with no-store', async () => {
  for (const path of ['/admin', '/admin/', '/admin/demo/notes', '/admin/index.html']) {
    expect(await request(path)).toEqual({
      status: 200,
      cacheControl: 'no-store',
      body: files['/admin/index.html'],
    })
  }
})

test('hashed /admin/assets/* are immutable; other admin files are served as they are', async () => {
  expect(await request('/admin/assets/index-abc123.js')).toEqual({
    status: 200,
    cacheControl: 'public, max-age=31536000, immutable',
    body: 'console.log(1)',
  })
  expect((await request('/admin/assets/missing.js')).status).toBe(404)
  expect(await request('/admin/favicon.svg')).toMatchObject({ status: 200, body: '<svg/>' })
})
