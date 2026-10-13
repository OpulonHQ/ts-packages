import { UserList } from '@opulonjs/users/api'
import { Schema } from 'effect'
import { beforeAll, expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)
let cookie: string

beforeAll(async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  cookie = await host.signIn(owner.email, owner.password)
  await sqlQuery(
    db.url,
    `insert into users."user" (id, name, email, email_verified)
    select 'paging-' || n, 'Paging ' || lpad(n::text, 2, '0'),
      'paging-' || lpad(n::text, 2, '0') || '@example.test', true
    from generate_series(1, 31) n`,
  )
})

const list = async (query: string) => {
  const response = await host.request('GET', `/users/users?${query}`, { cookie })
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(UserList)(response.body)
}

test('users page on the server and retain the filtered total on an empty page', async () => {
  const first = await list('search=Paging&perPage=10&sort=name&direction=asc')
  const second = await list('search=Paging&page=2&perPage=10&sort=name&direction=asc')
  expect(first.users.map((u) => u.name)).toEqual(
    Array.from({ length: 10 }, (_, n) => `Paging ${String(n + 1).padStart(2, '0')}`),
  )
  expect(second.users.map((u) => u.name)).toEqual(
    Array.from({ length: 10 }, (_, n) => `Paging ${String(n + 11).padStart(2, '0')}`),
  )
  expect(first).toMatchObject({ total: 31, roles: [{ id: 'super_admin', name: 'Super admin' }] })
  expect(await list('search=Paging&page=5&perPage=10')).toMatchObject({ users: [], total: 31 })
  expect(
    (await list('search=%20PAGING-31%20&sort=email&direction=desc')).users.map((u) => u.email),
  ).toEqual(['paging-31@example.test'])
})

test.each([
  'page=0',
  'page=1.5',
  'perPage=0',
  'perPage=101',
  'page=402',
  'page=102&perPage=100',
  'sort=roleIds',
  'direction=oops',
  `search=${'a'.repeat(501)}`,
])('users reject invalid or excessive query %s', async (query) => {
  expect((await host.request('GET', `/users/users?${query}`, { cookie })).status).toBe(400)
})

test('users paging remains forbidden to signed-in staff without users.manage', async () => {
  const staff = await seedUser(db.url, { permissions: [] })
  const denied = await host.signIn(staff.email, staff.password)
  expect(
    (await host.request('GET', '/users/users?search=Paging&page=2', { cookie: denied })).status,
  ).toBe(403)
})

test('a user beyond the first page remains reachable by exact id', async () => {
  const result = await list('id=paging-31')
  expect(result).toMatchObject({ total: 1, users: [{ id: 'paging-31', name: 'Paging 31' }] })
  expect((await list('id=missing')).users).toEqual([])
})

test('default user order keeps deactivated staff last while an explicit name sort stays alphabetical', async () => {
  expect((await host.request('POST', '/users/users/paging-1/deactivate', { cookie })).status).toBe(
    204,
  )
  try {
    const result = await list('search=Paging&perPage=100')
    expect(result.users.map((user) => user.name)).toEqual([
      ...Array.from({ length: 30 }, (_, n) => `Paging ${String(n + 2).padStart(2, '0')}`),
      'Paging 01',
    ])
    expect(result.users.at(-1)).toMatchObject({ name: 'Paging 01', deactivated: true })
    expect((await list('search=Paging&perPage=100&sort=name&direction=asc')).users[0]?.name).toBe(
      'Paging 01',
    )
  } finally {
    expect(
      (await host.request('POST', '/users/users/paging-1/reactivate', { cookie })).status,
    ).toBe(204)
  }
})
