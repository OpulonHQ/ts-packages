import { expect, test } from 'vitest'
import { createTestDatabase, useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

async function signedIn(o: Parameters<typeof seedUser>[1]) {
  const user = await seedUser(db.url, o)
  return { ...user, cookie: await host.signIn(user.email, user.password) }
}

const createRole = (cookie: string, name: string, permissions: ReadonlyArray<string>) =>
  host.request('POST', '/users/roles', { cookie, body: { name, permissions } })
const updateRole = (cookie: string, id: string, name: string, permissions: ReadonlyArray<string>) =>
  host.request('PUT', `/users/roles/${id}`, { cookie, body: { name, permissions } })
const assign = (cookie: string, userId: string, roleIds: ReadonlyArray<string>) =>
  host.request('PUT', `/users/users/${userId}/roles`, { cookie, body: { roleIds } })

/** Creates a role as a fresh Super admin; resolves with its id. */
async function role(permissions: ReadonlyArray<string>) {
  const owner = await signedIn({ superAdmin: true })
  const response = await createRole(owner.cookie, `role ${crypto.randomUUID()}`, permissions)
  expect(response.status).toBe(200)
  return (response.body as { id: string }).id
}

const refused = (reason: string) => ({ status: 403, body: { _tag: 'Refused', reason } })

const superAdmins = async () =>
  (
    await sqlQuery<{ n: number }>(
      db.url,
      `select count(*)::int as n from users.user_role ur join users."user" u on u.id = ur.user_id
       where ur.role_id = 'super_admin' and u.deactivated_at is null`,
    )
  )[0]!.n

test('roles grant catalog permissions; a user holding several gets all of them', async () => {
  const owner = await signedIn({ superAdmin: true })
  const notes = await createRole(owner.cookie, 'Notes', ['demo.notes.view'])
  const log = await createRole(owner.cookie, 'Email log', ['emails.log.view'])
  expect([notes.status, log.status]).toEqual([200, 200])
  const ids = [notes, log].map((r) => (r.body as { id: string }).id)

  const member = await signedIn({ permissions: [] })
  expect((await assign(owner.cookie, member.id, ids)).status).toBe(204)
  expect((await host.me(member.cookie)).permissions.toSorted()).toEqual([
    'demo.notes.view',
    'emails.log.view',
  ])

  const list = await host.request('GET', '/users/roles', { cookie: owner.cookie })
  expect(list.status).toBe(200)
  expect((list.body as { roles: unknown[] }).roles).toEqual(
    expect.arrayContaining([
      { id: 'super_admin', name: 'Super admin', permissions: [], builtIn: true, holders: 1 },
      { id: ids[0], name: 'Notes', permissions: ['demo.notes.view'], builtIn: false, holders: 1 },
    ]),
  )
})

test('a role name is unique and a permission no module declares is refused', async () => {
  const owner = await signedIn({ superAdmin: true })
  expect((await createRole(owner.cookie, 'Twin', [])).status).toBe(200)
  expect((await createRole(owner.cookie, 'Twin', [])).status).toBe(409)
  expect((await createRole(owner.cookie, 'Ghost', ['gone.key'])).status).toBe(400)
  expect((await createRole(owner.cookie, ' ', [])).status).toBe(400)
})

test('undeclared keys already stored on a role grant nothing and survive an edit', async () => {
  const owner = await signedIn({ superAdmin: true })
  const id = await role(['demo.notes.view'])
  await sqlQuery(
    db.url,
    `update users.role set permissions = permissions || '{gone.key}' where id = $1`,
    [id],
  )
  const member = await signedIn({ permissions: [] })
  await assign(owner.cookie, member.id, [id])
  expect((await host.me(member.cookie)).permissions).toEqual(['demo.notes.view'])
  expect((await updateRole(owner.cookie, id, 'Renamed', ['emails.log.view'])).status).toBe(204)
  const [row] = await sqlQuery<{ permissions: string[] }>(
    db.url,
    'select permissions from users.role where id = $1',
    [id],
  )
  expect(row!.permissions.toSorted()).toEqual(['emails.log.view', 'gone.key'])
})

test('managing roles needs users.roles.manage; anonymous requests get 401', async () => {
  expect((await host.request('GET', '/users/roles')).status).toBe(401)
  const manager = await signedIn({ permissions: ['users.manage'] })
  expect((await host.request('GET', '/users/roles', { cookie: manager.cookie })).status).toBe(403)
  expect((await createRole(manager.cookie, 'Nope', [])).status).toBe(403)
})

test('nobody creates or edits a role beyond their own permissions', async () => {
  const keeper = await signedIn({ permissions: ['users.roles.manage', 'demo.notes.view'] })
  expect(await createRole(keeper.cookie, 'Up', ['emails.log.view'])).toMatchObject(
    refused('escalation'),
  )
  expect((await createRole(keeper.cookie, 'Same', ['demo.notes.view'])).status).toBe(200)
  const stronger = await role(['emails.log.view'])
  // Neither adding a permission they lack nor touching a role that holds one.
  expect(await updateRole(keeper.cookie, stronger, 'Down', [])).toMatchObject(refused('escalation'))
  const weaker = await role([])
  expect(await updateRole(keeper.cookie, weaker, 'Up', ['emails.log.view'])).toMatchObject(
    refused('escalation'),
  )
})

test('Super admin cannot be edited and holds every permission', async () => {
  const owner = await signedIn({ superAdmin: true })
  expect(await updateRole(owner.cookie, 'super_admin', 'Root', [])).toMatchObject(
    refused('built_in'),
  )
  const me = await host.me(owner.cookie)
  expect(me.permissions).toEqual(me.permissionCatalog)
  expect(me.permissions).toEqual(
    expect.arrayContaining(['users.manage', 'users.roles.manage', 'emails.templates.manage']),
  )
  expect((await updateRole(owner.cookie, 'no-such-role', 'X', [])).status).toBe(404)
})

test('only a Super admin assigns Super admin, and only within their own permissions', async () => {
  const manager = await signedIn({ permissions: ['users.manage', 'demo.notes.view'] })
  const member = await signedIn({ permissions: [] })
  expect(await assign(manager.cookie, member.id, ['super_admin'])).toMatchObject(
    refused('escalation'),
  )
  expect(await assign(manager.cookie, member.id, [await role(['emails.log.view'])])).toMatchObject(
    refused('escalation'),
  )
  expect((await assign(manager.cookie, member.id, ['no-such-role'])).status).toBe(400)
  expect((await assign(manager.cookie, 'no-such-user', [])).status).toBe(404)
  expect((await assign(manager.cookie, member.id, [await role(['demo.notes.view'])])).status).toBe(
    204,
  )

  const owner = await signedIn({ superAdmin: true })
  expect((await assign(owner.cookie, member.id, ['super_admin'])).status).toBe(204)
  expect((await host.me(member.cookie)).permissions).toContain('users.roles.manage')
})

test('nobody changes the roles of a user who holds more than they do', async () => {
  const manager = await signedIn({ permissions: ['users.manage'] })
  const owner = await signedIn({ superAdmin: true })
  expect(await assign(manager.cookie, owner.id, [])).toMatchObject(refused('outranked'))
  const editor = await signedIn({ permissions: ['emails.log.view'] })
  expect(await assign(manager.cookie, editor.id, [])).toMatchObject(refused('outranked'))
  expect(await superAdmins()).toBeGreaterThan(0)
})

test('nobody removes their own right to manage users or roles', async () => {
  const manager = await signedIn({ permissions: ['users.manage', 'users.roles.manage'] })
  expect(await assign(manager.cookie, manager.id, [])).toMatchObject(refused('self_lockout'))
  const [own] = await sqlQuery<{ role_id: string }>(
    db.url,
    'select role_id from users.user_role where user_id = $1',
    [manager.id],
  )
  expect(await updateRole(manager.cookie, own!.role_id, 'Less', ['users.manage'])).toMatchObject(
    refused('self_lockout'),
  )
  expect((await host.me(manager.cookie)).permissions.toSorted()).toEqual([
    'users.manage',
    'users.roles.manage',
  ])
})

test('Super admin cannot be removed from its last holder', async () => {
  // A fresh database: the shared one holds Super admins from other tests.
  const own = await createTestDatabase()
  try {
    const solo = makeHost(() => own.url)
    const first = await seedUser(own.url, { superAdmin: true })
    const cookie = await solo.signIn(first.email, first.password)
    const keep = await solo.request('POST', '/users/roles', {
      cookie,
      body: { name: 'Managers', permissions: ['users.manage', 'users.roles.manage'] },
    })
    const managers = (keep.body as { id: string }).id
    // Still holding users.* through another role, so only the last-holder rule stops it.
    expect(
      await solo.request('PUT', `/users/users/${first.id}/roles`, {
        cookie,
        body: { roleIds: [managers] },
      }),
    ).toMatchObject(refused('last_super_admin'))

    const second = await seedUser(own.url, { superAdmin: true })
    expect(
      (
        await solo.request('PUT', `/users/users/${first.id}/roles`, {
          cookie,
          body: { roleIds: [managers] },
        })
      ).status,
    ).toBe(204)
    const other = await solo.signIn(second.email, second.password)
    expect(
      await solo.request('POST', `/users/users/${second.id}/deactivate`, { cookie: other }),
    ).toMatchObject(refused('self_lockout'))
  } finally {
    await own.drop()
  }
})

test('two Super admins demoting each other at once leave one Super admin', async () => {
  const own = await createTestDatabase()
  try {
    const duo = makeHost(() => own.url)
    const a = await seedUser(own.url, { superAdmin: true })
    const b = await seedUser(own.url, { superAdmin: true })
    const [ca, cb] = [await duo.signIn(a.email, a.password), await duo.signIn(b.email, b.password)]
    const results = await Promise.all([
      duo.request('PUT', `/users/users/${b.id}/roles`, { cookie: ca, body: { roleIds: [] } }),
      duo.request('PUT', `/users/users/${a.id}/roles`, { cookie: cb, body: { roleIds: [] } }),
    ])
    expect(results.map((r) => r.status).toSorted()).toEqual([204, 403])
    const [row] = await sqlQuery<{ n: number }>(
      own.url,
      `select count(*)::int as n from users.user_role where role_id = 'super_admin'`,
    )
    expect(row?.n).toBe(1)
  } finally {
    await own.drop()
  }
})

test('role changes and role assignments are audited', async () => {
  const owner = await signedIn({ superAdmin: true, name: 'Olga Owner' })
  const created = await createRole(owner.cookie, 'Audited', ['demo.notes.view'])
  const id = (created.body as { id: string }).id
  await updateRole(owner.cookie, id, 'Audited 2', [])
  const member = await signedIn({ permissions: [] })
  await assign(owner.cookie, member.id, [id])

  const events = await sqlQuery<{ action: string; subject_id: string; changes: unknown }>(
    db.url,
    `select action, subject_id, changes from core.audit_event
     where actor_id = $1 order by occurred_at, id`,
    [owner.id],
  )
  expect(events.filter((e) => e.action !== 'users.signed_in')).toEqual([
    {
      action: 'users.role_created',
      subject_id: id,
      changes: [
        { field: 'name', from: null, to: 'Audited' },
        { field: 'permissions', from: null, to: 'demo.notes.view' },
      ],
    },
    {
      action: 'users.role_updated',
      subject_id: id,
      changes: [
        { field: 'name', from: 'Audited', to: 'Audited 2' },
        { field: 'permissions', from: 'demo.notes.view', to: '' },
      ],
    },
    {
      action: 'users.roles_assigned',
      subject_id: member.id,
      changes: [{ field: 'roles', from: expect.any(String), to: 'Audited 2' }],
    },
  ])
})
