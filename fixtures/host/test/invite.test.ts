import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedRole, seedUser, sqlQuery, tokenFrom } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

async function signedIn(o: Parameters<typeof seedUser>[1]) {
  const user = await seedUser(db.url, o)
  return { ...user, cookie: await host.signIn(user.email, user.password) }
}

/** Invites `email` as `inviter` and resolves with the token from the captured email. */
async function invite(cookie: string, email: string, roleIds: ReadonlyArray<string> = []) {
  const sent = host.mailer.sent.length
  const response = await host.request('POST', '/users/invitations', {
    cookie,
    body: { email, roleIds },
  })
  expect(response.status).toBe(200)
  const mail = host.mailer.sent[sent]!
  expect(mail.to).toEqual([email.toLowerCase()])
  return tokenFrom(mail.html)
}

const accept = (token: string, password = 'invitee password 1') =>
  host.request('POST', '/users/invitations/accept', {
    body: { token, name: 'Ivan Invitee', password },
  })

test('an invitee sets a password through the emailed link, then signs in with the roles', async () => {
  const admin = await signedIn({ superAdmin: true })
  const editor = await seedRole(db.url, ['demo.notes.view'])
  const token = await invite(admin.cookie, 'Ivan@Example.test', [editor])
  const mail = host.mailer.sent.at(-1)!
  expect(mail.html).toContain('https://host.test/admin/accept-invitation#token=')

  expect(
    await host.request('POST', '/users/invitations/inspect', { body: { token } }),
  ).toMatchObject({ status: 200, body: { email: 'ivan@example.test' } })
  expect((await accept(token)).status).toBe(204)

  const cookie = await host.signIn('ivan@example.test', 'invitee password 1')
  expect((await host.request('GET', '/me', { cookie })).body).toMatchObject({
    user: { name: 'Ivan Invitee', email: 'ivan@example.test' },
    permissions: ['demo.notes.view'],
  })
})

test('an invitation link works once', async () => {
  const admin = await signedIn({ superAdmin: true })
  const token = await invite(admin.cookie, 'once@example.test')
  expect((await accept(token)).status).toBe(204)
  expect(await accept(token, 'another password')).toMatchObject({
    status: 400,
    body: { _tag: 'InvalidToken' },
  })
  expect(
    (await host.request('POST', '/users/invitations/inspect', { body: { token } })).status,
  ).toBe(400)
})

test('an expired or replaced invitation link is refused', async () => {
  const admin = await signedIn({ superAdmin: true })
  const first = await invite(admin.cookie, 'late@example.test')
  const second = await invite(admin.cookie, 'late@example.test')
  expect((await accept(first)).status).toBe(400)
  await sqlQuery(
    db.url,
    `update users.invitation set expires_at = now() - interval '1 second' where email = $1`,
    ['late@example.test'],
  )
  expect((await accept(second)).status).toBe(400)
  expect((await accept('made-up-token')).status).toBe(400)
})

test('a short password or blank name is refused before anything is created', async () => {
  const admin = await signedIn({ superAdmin: true })
  const token = await invite(admin.cookie, 'short@example.test')
  expect((await accept(token, 'short')).status).toBe(400)
  const blank = await host.request('POST', '/users/invitations/accept', {
    body: { token, name: ' ', password: 'long enough password' },
  })
  expect(blank.status).toBe(400)
  expect((await accept(token)).status).toBe(204)
})

test('inviting needs users.manage; anonymous requests get 401', async () => {
  const body = { email: 'x@example.test', roleIds: [] }
  expect((await host.request('POST', '/users/invitations', { body })).status).toBe(401)
  const reader = await signedIn({ permissions: ['demo.notes.view'] })
  expect(
    (await host.request('POST', '/users/invitations', { cookie: reader.cookie, body })).status,
  ).toBe(403)
})

test('nobody grants Super admin unless they are one, nor a permission they lack', async () => {
  const manager = await signedIn({ permissions: ['users.manage', 'demo.notes.view'] })
  const request = (roleIds: ReadonlyArray<string>) =>
    host.request('POST', '/users/invitations', {
      cookie: manager.cookie,
      body: { email: 'new@example.test', roleIds },
    })
  expect((await request(['super_admin'])).status).toBe(403)
  expect((await request([await seedRole(db.url, ['emails.log.view'])])).status).toBe(403)
  expect((await request(['no-such-role'])).status).toBe(400)
  // Keys no composed module declares grant nothing, so they do not block the invitation.
  expect((await request([await seedRole(db.url, ['demo.notes.view', 'gone.key'])])).status).toBe(
    200,
  )
  expect(host.mailer.sent.at(-1)?.to).toEqual(['new@example.test'])
})

test('an address that already belongs to a user cannot be invited', async () => {
  const admin = await signedIn({ superAdmin: true })
  const existing = await seedUser(db.url)
  const response = await host.request('POST', '/users/invitations', {
    cookie: admin.cookie,
    body: { email: existing.email.toUpperCase(), roleIds: [] },
  })
  expect(response.status).toBe(409)
})

test('an invalid address is refused and no email is sent', async () => {
  const admin = await signedIn({ superAdmin: true })
  const sent = host.mailer.sent.length
  const bad = await host.request('POST', '/users/invitations', {
    cookie: admin.cookie,
    body: { email: 'not-an-address', roleIds: [] },
  })
  expect(bad.status).toBe(400)
  expect(host.mailer.sent.length).toBe(sent)
})
