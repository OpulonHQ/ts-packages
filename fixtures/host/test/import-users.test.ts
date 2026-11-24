import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { runOpulon } from '../../../test/opulon.ts'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedRole, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

const dir = mkdtempSync(join(tmpdir(), 'import-users-'))
afterAll(() => rmSync(dir, { recursive: true }))

const importUsers = (users: ReadonlyArray<Record<string, unknown>>) => {
  const file = join(dir, `${randomUUID()}.json`)
  writeFileSync(file, JSON.stringify(users))
  return runOpulon(
    ['demo', 'import-users', '--server', 'fixtures/host/server/opulon.ts', '--file', file],
    { DATABASE_URL_DIRECT: db.url },
  )
}

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
  const refused = [
    [
      { ...valid, email: 'not-an-address' },
      /user 2 \(not-an-address\): not an email address sign-in accepts/,
    ],
    [
      {
        ...valid,
        email: 'argon@old.test',
        passwordHash: '$argon2id$v=19$m=65536,t=4,p=1$c2FsdA$aGFzaA',
      },
      /user 2 \(argon@old\.test\): the password hash is neither bcrypt nor pbkdf2v1/,
    ],
    [
      { ...valid, email: 'role@old.test', roleIds: ['no-such-role'] },
      /user 2 \(role@old\.test\): unknown role no-such-role/,
    ],
    [
      { ...valid, email: existing.email },
      /user 2 \(taken@old\.test\): a user with this address exists/,
    ],
  ] as const
  await Promise.all(
    refused.map(([user, message]) => expect(importUsers([valid, user])).rejects.toThrow(message)),
  )
  expect(await emails()).toEqual(before)
}, 30_000)

test.each([
  [
    'an address with a non-ASCII domain',
    { email: 'info@müller.de' },
    /user 1 \(info@müller\.de\): not an email address sign-in accepts/,
  ],
  [
    'an address with a punycode top-level domain',
    { email: 'vera@example.xn--p1ai' },
    /user 1 \(vera@example\.xn--p1ai\): not an email address sign-in accepts/,
  ],
  [
    'a truncated pbkdf2v1 hash',
    { passwordHash: 'pbkdf2v1:AAAA' },
    /user 1 \(row@old\.test\): the password hash is neither bcrypt nor pbkdf2v1/,
  ],
  [
    'a pbkdf2v1 prefix with no payload',
    { passwordHash: 'pbkdf2v1:' },
    /user 1 \(row@old\.test\): the password hash is neither bcrypt nor pbkdf2v1/,
  ],
  [
    'a row without roleIds',
    { roleIds: undefined },
    /user 1 \(row@old\.test\): Missing key at \["roleIds"\]/,
  ],
])(
  'an import refuses %s, which could not sign in or has no stated roles',
  async (_, row, message) => {
    const before = await emails()
    await expect(
      importUsers([
        { email: 'row@old.test', name: 'Row', passwordHash: laravelHash, roleIds: [], ...row },
      ]),
    ).rejects.toThrow(message)
    expect(await emails()).toEqual(before)
  },
)
