import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedUser } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

test('/me is staff-only', async () => {
  expect((await host.request('GET', '/me')).status).toBe(401)
  const garbage = '__Secure-better-auth.session_token=forged.value'
  expect((await host.request('GET', '/me', { cookie: garbage })).status).toBe(401)
})

test('/me returns the user, locale, permissions, modules, catalog and build id, never cached', async () => {
  const user = await seedUser(db.url, {
    name: 'Demo User',
    email: 'demo@example.test',
    locale: 'sk',
    permissions: ['demo.notes.view', 'emails.log.view'],
  })
  const cookie = await host.signIn(user.email, user.password)
  const response = await host.request('GET', '/me', { cookie })
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response).toMatchObject({
    status: 200,
    body: {
      buildId: 'build-1',
      user: { id: user.id, name: 'Demo User', email: 'demo@example.test' },
      locale: 'sk',
      permissions: ['emails.log.view', 'demo.notes.view'],
      modules: ['core', 'emails', 'users', 'media', 'cms', 'demo'],
      permissionCatalog: [
        'core.audit.view',
        'emails.log.view',
        'emails.templates.manage',
        'users.manage',
        'users.roles.manage',
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
