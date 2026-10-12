import { expect, test } from 'vitest'
import { runOpulon } from '../../../test/opulon.ts'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, origin } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

const bootstrap = (...args: Array<string>) =>
  runOpulon(
    ['users', 'invite-super-admin', '--server', 'fixtures/host/server/opulon.ts', ...args],
    {
      DATABASE_URL_DIRECT: db.url,
      USERS_BASE_URL: origin,
    },
  )

test('the bootstrap CLI prints a Super admin invitation link that signs in with every permission', async () => {
  const { stdout } = await bootstrap('--email', 'Owner@Example.test')
  const link = /https:\/\/host\.test\/admin\/accept-invitation#token=(\S+)/.exec(stdout)
  expect(link).not.toBeNull()
  const token = decodeURIComponent(link![1]!)

  const accepted = await host.request('POST', '/users/invitations/accept', {
    body: { token, name: 'Owner', password: 'owner password 1' },
  })
  expect(accepted.status).toBe(204)
  const cookie = await host.signIn('owner@example.test', 'owner password 1')
  const me = await host.me(cookie)
  expect(me.user).toMatchObject({ name: 'Owner', email: 'owner@example.test' })
  expect(me.permissions).toEqual(me.permissionCatalog)
})

test('refuses once a Super admin exists, and without an address', async () => {
  await expect(bootstrap('--email', 'second@example.test')).rejects.toThrow(
    /a Super admin already exists/,
  )
  await expect(bootstrap()).rejects.toThrow(/--email <address> is required/)
})

test('lists the module commands for an unknown one', async () => {
  await expect(
    runOpulon(['users', 'nope', '--server', 'fixtures/host/server/opulon.ts'], {
      DATABASE_URL_DIRECT: db.url,
    }),
  ).rejects.toThrow(/opulon users invite-super-admin/)
})
