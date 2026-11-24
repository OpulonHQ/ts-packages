import { expect, test } from 'vitest'
import { runOpulon } from '../../../test/opulon.ts'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedRole, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

const importUsers = (users: ReadonlyArray<Record<string, unknown>>) =>
  runOpulon(
    [
      'demo',
      'import-users',
      '--server',
      'fixtures/host/server/opulon.ts',
      '--users',
      JSON.stringify(users),
    ],
    { DATABASE_URL_DIRECT: db.url },
  )

const laravelHash = '$2y$12$WhA9TIrkx7zcl/eiDtXkJOsQcBrN0PtwA3DlxH1k76aJKDjSLHAoq'
const laravelPassword = 'laravel secret 1'

const emails = async () =>
  (await sqlQuery<{ email: string }>(db.url, 'select email from users."user" order by email')).map(
    (row) => row.email,
  )

test('imported users sign in with their old password and hold the roles they were given', async () => {
  const notes = await seedRole(db.url, ['demo.notes.view'])
  const { stdout } = await importUsers([
    { email: 'Editor@Old.test', name: 'Editor', passwordHash: laravelHash, roleIds: [notes] },
    { email: 'owner@old.test', name: 'Owner', passwordHash: laravelHash, roleIds: ['super_admin'] },
  ])
  expect(stdout).toContain('imported 2 user(s)')

  const editor = await host.me(await host.signIn('editor@old.test', laravelPassword))
  expect(editor.user).toMatchObject({ name: 'Editor', email: 'editor@old.test' })
  expect(editor.permissions).toEqual(['demo.notes.view'])
  const owner = await host.me(await host.signIn('owner@old.test', laravelPassword))
  expect(owner.permissions).toEqual(owner.permissionCatalog)

  expect(
    await sqlQuery(
      db.url,
      `select actor_kind, subject_label from core.audit_event
        where action = 'users.imported' order by subject_label`,
    ),
  ).toEqual([
    { actor_kind: 'system', subject_label: 'editor@old.test' },
    { actor_kind: 'system', subject_label: 'owner@old.test' },
  ])
})

test('an import that cannot be completed creates no user and names the address', async () => {
  const existing = await seedUser(db.url, { email: 'taken@old.test' })
  const before = await emails()
  const valid = { email: 'fine@old.test', name: 'Fine', passwordHash: laravelHash, roleIds: [] }
  for (const [user, message] of [
    [{ ...valid, email: 'not-an-address' }, /not-an-address: not an email address/],
    [
      {
        ...valid,
        email: 'argon@old.test',
        passwordHash: '$argon2id$v=19$m=65536,t=4,p=1$c2FsdA$aGFzaA',
      },
      /argon@old\.test: the password hash is neither bcrypt nor pbkdf2v1/,
    ],
    [{ ...valid, email: 'role@old.test', roleIds: ['no-such-role'] }, /unknown role no-such-role/],
    [{ ...valid, email: existing.email }, /taken@old\.test: a user with this address exists/],
  ] as const) {
    await expect(importUsers([valid, user])).rejects.toThrow(message)
    expect(await emails()).toEqual(before)
  }
})
