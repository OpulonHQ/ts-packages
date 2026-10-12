import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import worker, { type Env } from '../worker.ts'
import { memoryBucket } from './memory-bucket.ts'

const db = useTestDatabase()

async function me(headers: Record<string, string> = {}) {
  const env: Env = {
    HYPERDRIVE: { connectionString: db.url },
    DEMO_TOKEN: 'test-token',
    OPULON_BUILD_ID: 'build-1',
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    MEDIA_BUCKET: memoryBucket(),
  }
  const response = await worker.fetch(new Request('https://host.test/api/me', { headers }), env, {
    waitUntil: () => {},
  })
  const text = await response.text()
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: text ? JSON.parse(text) : undefined,
  }
}

test('/me is staff-only', async () => {
  expect((await me()).status).toBe(401)
  expect((await me({ authorization: 'Bearer wrong' })).status).toBe(401)
})

test('/me returns the user, locale, permissions, modules, catalog and build id, never cached', async () => {
  expect(await me({ authorization: 'Bearer test-token' })).toEqual({
    status: 200,
    cacheControl: 'private, no-store',
    body: {
      buildId: 'build-1',
      user: { id: 'demo-user', name: 'Demo User', email: 'demo@example.test' },
      locale: 'sk',
      permissions: [
        'demo.notes.view',
        'emails.log.view',
        'media.view',
        'media.upload',
        'media.archive',
        'cms.pages.view',
        'cms.pages.edit',
        'cms.pages.publish',
      ],
      modules: ['core', 'emails', 'media', 'cms', 'demo'],
      permissionCatalog: [
        'core.audit.view',
        'emails.log.view',
        'emails.templates.manage',
        'media.view',
        'media.upload',
        'media.archive',
        'cms.pages.view',
        'cms.pages.edit',
        'cms.pages.publish',
        'demo.notes.view',
      ],
      contentLocales: ['en', 'it'],
    },
  })
})
