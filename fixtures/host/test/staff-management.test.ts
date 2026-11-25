import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, randomIp, seedRole, seedUser, sqlQuery, tokenFrom } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

async function signedIn(o: Parameters<typeof seedUser>[1]) {
  const user = await seedUser(db.url, o)
  return { ...user, cookie: await host.signIn(user.email, user.password) }
}

const refused = (reason: string) => ({ status: 403, body: { _tag: 'Refused', reason } })
const alive = async (cookie: string) => (await host.request('GET', '/me', { cookie })).status

const events = (actorId: string) =>
  sqlQuery<{ action: string; subject_id: string; changes: unknown }>(
    db.url,
    `select action, subject_id, changes from core.audit_event
     where actor_id = $1 and action <> 'users.signed_in' order by occurred_at, id`,
    [actorId],
  )

const editUser = (cookie: string, id: string, body: { name: string; email: string }) =>
  host.request('PUT', `/users/users/${id}`, { cookie, body })

test('a user manager edits a name and an email; the email change ends that user sessions', async () => {
  const manager = await signedIn({ permissions: ['users.manage', 'demo.notes.view'] })
  const member = await signedIn({ permissions: ['demo.notes.view'], name: 'Mia' })

  expect(
    (await editUser(manager.cookie, member.id, { name: 'Mia Nova', email: member.email })).status,
  ).toBe(204)
  expect((await host.me(member.cookie)).user.name).toBe('Mia Nova')

  const email = `Mia-${member.id.slice(0, 8)}@Example.test`
  expect((await editUser(manager.cookie, member.id, { name: 'Mia Nova', email })).status).toBe(204)
  expect(await alive(member.cookie)).toBe(401)
  expect(
    (
      await host.request('POST', '/users/auth/sign-in', {
        body: { email: member.email, password: member.password },
      })
    ).status,
  ).toBe(401)
  const again = await host.signIn(email.toLowerCase(), member.password)
  expect((await host.me(again)).user).toMatchObject({
    name: 'Mia Nova',
    email: email.toLowerCase(),
  })

  expect(await events(manager.id)).toEqual([
    {
      action: 'users.updated',
      subject_id: member.id,
      changes: [{ field: 'name', from: 'Mia', to: 'Mia Nova' }],
    },
    {
      action: 'users.updated',
      subject_id: member.id,
      changes: [{ field: 'email', from: member.email, to: email.toLowerCase() }],
    },
  ])
})

test('an edited email stays unique, and a bad address or blank name is refused', async () => {
  const manager = await signedIn({ permissions: ['users.manage'] })
  const member = await signedIn({ permissions: [] })
  const other = await seedUser(db.url)
  const name = 'Test User'
  expect(
    (await editUser(manager.cookie, member.id, { name, email: other.email.toUpperCase() })).status,
  ).toBe(409)
  expect((await editUser(manager.cookie, member.id, { name, email: 'nope' })).status).toBe(400)
  expect(
    (await editUser(manager.cookie, member.id, { name: ' ', email: member.email })).status,
  ).toBe(400)
  expect(await alive(member.cookie)).toBe(200)
  expect((await host.me(member.cookie)).user.email).toBe(member.email)
})

test('editing a user needs users.manage and a user the actor outranks', async () => {
  const member = await signedIn({ permissions: ['demo.notes.view'] })
  const other = await seedUser(db.url)
  const body = { name: 'X', email: other.email }
  expect((await host.request('PUT', `/users/users/${other.id}`, { body })).status).toBe(401)
  expect((await editUser(member.cookie, other.id, body)).status).toBe(403)
  const manager = await signedIn({ permissions: ['users.manage'] })
  expect((await editUser(manager.cookie, 'no-such-user', body)).status).toBe(404)
  const owner = await seedUser(db.url, { superAdmin: true })
  expect(await editUser(manager.cookie, owner.id, { name: 'X', email: owner.email })).toMatchObject(
    refused('outranked'),
  )
})

interface Invitation {
  id: string
  email: string
  roleIds: string[]
  expired: boolean
}
const invite = (cookie: string, email: string, roleIds: ReadonlyArray<string> = []) =>
  host.request('POST', '/users/invitations', { cookie, body: { email, roleIds } })
const invitations = async (cookie: string) => {
  const response = await host.request('GET', '/users/invitations', { cookie })
  expect(response.status).toBe(200)
  return (response.body as { invitations: Invitation[] }).invitations
}
const inspect = async (token: string) =>
  (await host.request('POST', '/users/invitations/inspect', { body: { token } })).status

test('open invitations are listed until accepted, expired ones marked', async () => {
  const owner = await signedIn({ superAdmin: true })
  const role = await seedRole(db.url, ['demo.notes.view'])
  const run = owner.id.slice(0, 8)
  await invite(owner.cookie, `open-${run}@example.test`, [role])
  await invite(owner.cookie, `old-${run}@example.test`)
  await invite(owner.cookie, `done-${run}@example.test`)
  const token = tokenFrom(host.mailer.sent.at(-1)!.html)
  await host.request('POST', '/users/invitations/accept', {
    body: { token, name: 'Done', password: 'invitee password 1' },
  })
  await sqlQuery(
    db.url,
    `update users.invitation set expires_at = now() - interval '1 second' where email = $1`,
    [`old-${run}@example.test`],
  )

  const mine = (await invitations(owner.cookie)).filter((i) => i.email.includes(run))
  expect(mine).toEqual([
    expect.objectContaining({ email: `old-${run}@example.test`, roleIds: [], expired: true }),
    expect.objectContaining({ email: `open-${run}@example.test`, roleIds: [role], expired: false }),
  ])
})

test('a revoked invitation leaves the list and its link stops working', async () => {
  const owner = await signedIn({ superAdmin: true })
  const email = `revoked-${owner.id.slice(0, 8)}@example.test`
  const created = await invite(owner.cookie, email)
  const { id } = created.body as { id: string }
  const token = tokenFrom(host.mailer.sent.at(-1)!.html)
  expect(await inspect(token)).toBe(200)

  const revoke = () => host.request('DELETE', `/users/invitations/${id}`, { cookie: owner.cookie })
  expect((await revoke()).status).toBe(204)
  expect(await inspect(token)).toBe(400)
  expect((await invitations(owner.cookie)).map((i) => i.email)).not.toContain(email)
  expect((await revoke()).status).toBe(404)
  expect(await events(owner.id)).toEqual([
    expect.objectContaining({ action: 'users.invited', subject_id: id }),
    expect.objectContaining({ action: 'users.invitation_revoked', subject_id: id }),
  ])
})

test('an invitation sent again emails a new link and the old link stops working', async () => {
  const owner = await signedIn({ superAdmin: true })
  const role = await seedRole(db.url, ['demo.notes.view'])
  const email = `again-${owner.id.slice(0, 8)}@example.test`
  const { id } = (await invite(owner.cookie, email, [role])).body as { id: string }
  const first = tokenFrom(host.mailer.sent.at(-1)!.html)
  await sqlQuery(
    db.url,
    `update users.invitation set expires_at = now() - interval '1 second' where id = $1`,
    [id],
  )

  const sent = host.mailer.sent.length
  const resent = await host.request('POST', `/users/invitations/${id}/resend`, {
    cookie: owner.cookie,
  })
  expect(resent.status).toBe(200)
  expect(host.mailer.sent).toHaveLength(sent + 1)
  expect(host.mailer.sent.at(-1)!.to).toEqual([email])
  const second = tokenFrom(host.mailer.sent.at(-1)!.html)
  expect(await inspect(first)).toBe(400)
  expect(await inspect(second)).toBe(200)
  expect((await invitations(owner.cookie)).filter((i) => i.email === email)).toEqual([
    expect.objectContaining({ id: (resent.body as { id: string }).id, roleIds: [role] }),
  ])
  expect((await events(owner.id)).map((e) => e.action)).toEqual(['users.invited', 'users.invited'])
  expect(
    (await host.request('POST', `/users/invitations/${id}/resend`, { cookie: owner.cookie }))
      .status,
  ).toBe(404)
})

test('invitations are managed with users.manage, within the manager own permissions', async () => {
  const owner = await signedIn({ superAdmin: true })
  const email = `guarded-${owner.id.slice(0, 8)}@example.test`
  const { id } = (await invite(owner.cookie, email, ['super_admin'])).body as { id: string }
  expect((await host.request('GET', '/users/invitations')).status).toBe(401)
  const reader = await signedIn({ permissions: ['demo.notes.view'] })
  for (const [method, path] of [
    ['GET', '/users/invitations'],
    ['DELETE', `/users/invitations/${id}`],
    ['POST', `/users/invitations/${id}/resend`],
  ] as const)
    expect((await host.request(method, path, { cookie: reader.cookie })).status).toBe(403)

  const manager = await signedIn({ permissions: ['users.manage'] })
  expect(
    await host.request('DELETE', `/users/invitations/${id}`, { cookie: manager.cookie }),
  ).toMatchObject(refused('escalation'))
  expect(
    await host.request('POST', `/users/invitations/${id}/resend`, { cookie: manager.cookie }),
  ).toMatchObject(refused('escalation'))
  expect((await invitations(manager.cookie)).map((i) => i.email)).toContain(email)
})

const deleteRole = (cookie: string, id: string) =>
  host.request('DELETE', `/users/roles/${id}`, { cookie })

test('a role nobody holds is deleted; a held or built-in role is not', async () => {
  const owner = await signedIn({ superAdmin: true })
  const created = await host.request('POST', '/users/roles', {
    cookie: owner.cookie,
    body: { name: `Spare ${owner.id}`, permissions: ['demo.notes.view'] },
  })
  const { id } = created.body as { id: string }
  const member = await seedUser(db.url)
  const assign = (roleIds: ReadonlyArray<string>) =>
    host.request('PUT', `/users/users/${member.id}/roles`, {
      cookie: owner.cookie,
      body: { roleIds },
    })

  expect((await assign([id])).status).toBe(204)
  expect((await deleteRole(owner.cookie, id)).status).toBe(409)
  await host.request('POST', `/users/users/${member.id}/deactivate`, { cookie: owner.cookie })
  expect((await deleteRole(owner.cookie, id)).status).toBe(409)
  expect((await assign([])).status).toBe(204)

  expect(await deleteRole(owner.cookie, 'super_admin')).toMatchObject(refused('built_in'))
  expect((await deleteRole(owner.cookie, id)).status).toBe(204)
  expect((await deleteRole(owner.cookie, id)).status).toBe(404)
  const list = await host.request('GET', '/users/roles', { cookie: owner.cookie })
  expect((list.body as { roles: Array<{ id: string }> }).roles.map((r) => r.id)).not.toContain(id)
  expect((await events(owner.id)).at(-1)).toEqual({
    action: 'users.role_deleted',
    subject_id: id,
    changes: [
      { field: 'name', from: `Spare ${owner.id}`, to: null },
      { field: 'permissions', from: 'demo.notes.view', to: null },
    ],
  })
})

test('deleting a role needs users.roles.manage and every permission the role grants', async () => {
  const role = await seedRole(db.url, ['emails.log.view'])
  expect((await host.request('DELETE', `/users/roles/${role}`)).status).toBe(401)
  const manager = await signedIn({ permissions: ['users.manage'] })
  expect((await deleteRole(manager.cookie, role)).status).toBe(403)
  const keeper = await signedIn({ permissions: ['users.roles.manage'] })
  expect(await deleteRole(keeper.cookie, role)).toMatchObject(refused('escalation'))
})

const changePassword = (
  cookie: string,
  currentPassword: string,
  newPassword: string,
  ip?: string,
) =>
  host.request('PUT', '/users/password', {
    cookie,
    body: { currentPassword, newPassword },
    ...(ip ? { ip } : {}),
  })

test('a user changes their own password with the current one; other sessions end', async () => {
  const user = await signedIn({ permissions: [] })
  const other = await host.signIn(user.email, user.password)
  expect((await changePassword(user.cookie, user.password, 'a brand new password')).status).toBe(
    204,
  )

  expect(await alive(user.cookie)).toBe(200)
  expect(await alive(other)).toBe(401)
  expect(
    (
      await host.request('POST', '/users/auth/sign-in', {
        body: { email: user.email, password: user.password },
      })
    ).status,
  ).toBe(401)
  await host.signIn(user.email, 'a brand new password')
  expect(await events(user.id)).toEqual([
    { action: 'users.password_changed', subject_id: user.id, changes: null },
  ])
  const [row] = await sqlQuery<{ row: string }>(
    db.url,
    `select row_to_json(e)::text as row from core.audit_event e
     where action = 'users.password_changed' and actor_id = $1`,
    [user.id],
  )
  expect(row!.row).not.toContain('a brand new password')
})

test('a wrong current password or a short new one changes nothing', async () => {
  const user = await signedIn({ permissions: [] })
  const wrong = await changePassword(user.cookie, 'not the password', 'a brand new password')
  expect(wrong).toMatchObject({ status: 403, body: { _tag: 'WrongPassword' } })
  expect((await changePassword(user.cookie, user.password, 'short')).status).toBe(400)
  expect((await changePassword('', user.password, 'a brand new password')).status).toBe(401)
  await host.signIn(user.email, user.password)
  expect((await events(user.id)).map((e) => e.action)).toEqual([
    'users.password_confirmation_failed',
  ])
})

test('changing the password needs no password confirmation, and its attempts are rate limited', async () => {
  const user = await signedIn({ permissions: ['demo.notes.view'] })
  expect((await host.request('POST', '/demo/stamps', { cookie: user.cookie })).body).toEqual({
    _tag: 'PasswordConfirmationRequired',
  })
  const ip = randomIp()
  for (let i = 0; i < 5; i++)
    expect(
      (await changePassword(user.cookie, 'not the password', 'a brand new password', ip)).status,
    ).toBe(403)
  expect(
    (await changePassword(user.cookie, user.password, 'a brand new password', ip)).status,
  ).toBe(429)
  expect((await changePassword(user.cookie, user.password, 'a brand new password')).status).toBe(
    204,
  )
})
