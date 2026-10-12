import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import worker from '../worker.ts'

const db = useTestDatabase()

async function request(path: string, headers: Record<string, string> = {}) {
  const pending: Array<Promise<unknown>> = []
  const env = { HYPERDRIVE: { connectionString: db.url }, DEMO_TOKEN: 'test-token' }
  const response = await worker.fetch(new Request(`https://host.test${path}`, { headers }), env, {
    waitUntil: (p) => pending.push(p),
  })
  const body = await response.text()
  await Promise.all(pending)
  return { status: response.status, body: body ? JSON.parse(body) : undefined }
}

test('serves the demo module under /api/<module id> behind its policy', async () => {
  expect(await request('/api/demo/notes', { authorization: 'Bearer test-token' })).toEqual({
    status: 200,
    body: [{ id: 1, body: 'hello from demo' }],
  })
})

test('rejects a request without a user', async () => {
  expect((await request('/api/demo/notes')).status).toBe(401)
})

test('serves nothing outside the API prefix', async () => {
  expect((await request('/demo/notes', { authorization: 'Bearer test-token' })).status).toBe(404)
})
