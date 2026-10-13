import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { cookieHeader, makeHost, pauseInserts, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

async function signedIn(o: Parameters<typeof seedUser>[1]) {
  const user = await seedUser(db.url, o)
  return { ...user, cookie: await host.signIn(user.email, user.password) }
}

const act = (cookie: string, userId: string, action: 'deactivate' | 'reactivate') =>
  host.request('POST', `/users/users/${userId}/${action}`, { cookie })

interface Listed {
  id: string
  name: string
  email: string
  locale: string | null
  deactivated: boolean
  roleIds: string[]
}
const listed = async (cookie: string, id: string) => {
  const response = await host.request('GET', '/users/users', { cookie })
  expect(response.status).toBe(200)
  return (response.body as { users: Listed[] }).users.find((u) => u.id === id)
}

test('a deactivated user loses their sessions and is listed as deactivated, never deleted', async () => {
  const manager = await signedIn({ permissions: ['users.manage', 'demo.notes.view'] })
  const member = await signedIn({ permissions: ['demo.notes.view'], name: 'Mia' })
  expect((await act(manager.cookie, member.id, 'deactivate')).status).toBe(204)

  expect((await host.request('GET', '/me', { cookie: member.cookie })).status).toBe(401)
  expect(
    (
      await host.request('POST', '/users/auth/sign-in', {
        body: { email: member.email, password: member.password },
      })
    ).status,
  ).toBe(401)
  expect(await listed(manager.cookie, member.id)).toMatchObject({
    name: 'Mia',
    email: member.email,
    deactivated: true,
    roleIds: [expect.any(String)],
  })

  expect((await act(manager.cookie, member.id, 'reactivate')).status).toBe(204)
  // Sessions were revoked, not paused: the old cookie stays dead after reactivation.
  expect((await host.request('GET', '/me', { cookie: member.cookie })).status).toBe(401)
  const again = await host.signIn(member.email, member.password)
  expect((await host.me(again)).permissions).toEqual(['demo.notes.view'])
  expect((await listed(manager.cookie, member.id))?.deactivated).toBe(false)
})

test('nobody deactivates themselves or a user who holds more than they do', async () => {
  const manager = await signedIn({ permissions: ['users.manage'] })
  expect(await act(manager.cookie, manager.id, 'deactivate')).toMatchObject({
    status: 403,
    body: { _tag: 'Refused', reason: 'self_lockout' },
  })
  const owner = await signedIn({ superAdmin: true })
  expect(await act(manager.cookie, owner.id, 'deactivate')).toMatchObject({
    status: 403,
    body: { _tag: 'Refused', reason: 'outranked' },
  })
  expect((await host.request('GET', '/me', { cookie: owner.cookie })).status).toBe(200)
  expect((await act(owner.cookie, manager.id, 'deactivate')).status).toBe(204)
  expect((await host.request('GET', '/me', { cookie: manager.cookie })).status).toBe(401)
})

test('deactivation needs users.manage and an existing user', async () => {
  const member = await signedIn({ permissions: ['demo.notes.view'] })
  const other = await seedUser(db.url)
  expect((await act(member.cookie, other.id, 'deactivate')).status).toBe(403)
  expect((await host.request('POST', `/users/users/${other.id}/deactivate`)).status).toBe(401)
  const manager = await signedIn({ permissions: ['users.manage'] })
  expect((await act(manager.cookie, 'no-such-user', 'deactivate')).status).toBe(404)
})

test('deactivation and reactivation are audited', async () => {
  const owner = await signedIn({ superAdmin: true })
  const member = await seedUser(db.url)
  await act(owner.cookie, member.id, 'deactivate')
  await act(owner.cookie, member.id, 'deactivate')
  await act(owner.cookie, member.id, 'reactivate')
  const events = await sqlQuery<{ action: string; subject_id: string }>(
    db.url,
    `select action, subject_id from core.audit_event
     where actor_id = $1 and action <> 'users.signed_in' order by id`,
    [owner.id],
  )
  // A repeated deactivation changes nothing and records nothing.
  expect(events).toEqual([
    { action: 'users.deactivated', subject_id: member.id },
    { action: 'users.reactivated', subject_id: member.id },
  ])
})

test('users pick their own admin locale; managers set it for others', async () => {
  const member = await signedIn({ permissions: [] })
  const setLocale = (cookie: string, id: string, locale: string | null) =>
    host.request('PUT', `/users/users/${id}/locale`, { cookie, body: { locale } })

  expect((await setLocale(member.cookie, member.id, 'sk')).status).toBe(204)
  expect((await host.me(member.cookie)).locale).toBe('sk')
  expect((await setLocale(member.cookie, member.id, 'not a locale!')).status).toBe(400)

  const other = await seedUser(db.url)
  expect((await setLocale(member.cookie, other.id, 'sk')).status).toBe(403)
  const manager = await signedIn({ permissions: ['users.manage'] })
  expect((await setLocale(manager.cookie, member.id, null)).status).toBe(204)
  expect((await host.me(member.cookie)).locale).toBeNull()

  const [event] = await sqlQuery<{ changes: unknown }>(
    db.url,
    `select changes from core.audit_event where action = 'users.locale_changed'
     and actor_id = $1`,
    [manager.id],
  )
  expect(event?.changes).toEqual([{ field: 'locale', from: 'sk', to: null }])
})

test('a sign-in racing a deactivation never yields a session, even after reactivation', async () => {
  const manager = await signedIn({ superAdmin: true })
  const member = await seedUser(db.url, { permissions: ['demo.notes.view'] })
  // The sign-in passed every check and waits just before its session insert.
  await using barrier = await pauseInserts(db.url, 'users.session', `new.user_id = '${member.id}'`)
  const signingIn = host.request('POST', '/users/auth/sign-in', {
    body: { email: member.email, password: member.password },
  })
  await barrier.reached()
  expect((await act(manager.cookie, member.id, 'deactivate')).status).toBe(204)
  await barrier.release()
  const cookie = cookieHeader((await signingIn).headers)
  expect((await act(manager.cookie, member.id, 'reactivate')).status).toBe(204)
  expect((await host.request('GET', '/me', { cookie })).status).toBe(401)
})
