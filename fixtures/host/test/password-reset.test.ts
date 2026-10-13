import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import {
  cookieHeader,
  makeHost,
  pauseInserts,
  randomIp,
  seedUser,
  sqlQuery,
  tokenFrom,
} from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

const requestReset = (email: string, ip?: string) =>
  host.request('POST', '/users/auth/request-password-reset', {
    body: { email },
    ...(ip ? { ip } : {}),
  })

const reset = (token: string, password: string) =>
  host.request('POST', '/users/auth/reset-password', { body: { token, password } })

test('a user resets the password through the emailed link; old sessions end', async () => {
  const user = await seedUser(db.url, { name: 'Rita', locale: 'sk' })
  const before = await host.signIn(user.email, user.password)
  const sent = host.mailer.sent.length

  expect((await requestReset(user.email.toUpperCase())).status).toBe(204)
  const mail = host.mailer.sent[sent]!
  expect(mail).toMatchObject({ to: [user.email], subject: 'Obnovenie hesla' })
  expect(mail.html).toContain('https://host.test/admin/reset-password#token=')

  expect((await reset(tokenFrom(mail.html), 'brand new password')).status).toBe(204)
  expect((await host.request('GET', '/me', { cookie: before })).status).toBe(401)
  await expect(host.signIn(user.email, user.password)).rejects.toThrow('401')
  await host.signIn(user.email, 'brand new password')
})

test('a reset link works once, and made-up tokens are refused', async () => {
  const user = await seedUser(db.url)
  await requestReset(user.email)
  const token = tokenFrom(host.mailer.sent.at(-1)!.html)
  expect((await reset(token, 'first new password')).status).toBe(204)
  expect(await reset(token, 'second new password')).toMatchObject({
    status: 400,
    body: { _tag: 'InvalidToken' },
  })
  expect((await reset('made-up-token', 'third new password')).status).toBe(400)
})

test('the reset token is stored hashed', async () => {
  const user = await seedUser(db.url)
  await requestReset(user.email)
  const token = tokenFrom(host.mailer.sent.at(-1)!.html)
  const rows = await sqlQuery<{ identifier: string }>(
    db.url,
    'select identifier from users.verification',
  )
  expect(rows.length).toBeGreaterThan(0)
  for (const { identifier } of rows) expect(identifier).not.toContain(token)
})

test('an unknown or deactivated address gets the same answer and no email', async () => {
  const deactivated = await seedUser(db.url)
  await sqlQuery(db.url, 'update users."user" set deactivated_at = now() where id = $1', [
    deactivated.id,
  ])
  const sent = host.mailer.sent.length
  const unknown = await requestReset('nobody@example.test')
  const inactive = await requestReset(deactivated.email)
  expect(unknown).toMatchObject({ status: 204, body: '' })
  expect(inactive).toMatchObject({ status: 204, body: '' })
  expect(host.mailer.sent.length).toBe(sent)
})

test('reset requests are rate limited per client address', async () => {
  const ip = randomIp()
  for (let i = 0; i < 3; i++) expect((await requestReset('x@example.test', ip)).status).toBe(204)
  expect((await requestReset('x@example.test', ip)).status).toBe(429)
})

test('confirming a reset is rate limited per client address', async () => {
  const ip = randomIp()
  const confirm = () =>
    host.request('POST', '/users/auth/reset-password', {
      body: { token: 'not-a-token', password: 'brand new password' },
      ip,
    })
  for (let i = 0; i < 5; i++) expect((await confirm()).status).toBe(400)
  expect((await confirm()).status).toBe(429)
})

test('a sign-in with the old password racing a reset never yields a working session', async () => {
  const user = await seedUser(db.url)
  const sent = host.mailer.sent.length
  await requestReset(user.email)
  const token = tokenFrom(host.mailer.sent[sent]!.html)
  // The sign-in verified the old password and waits just before its session insert.
  await using barrier = await pauseInserts(db.url, 'users.session', `new.user_id = '${user.id}'`)
  const signingIn = host.request('POST', '/users/auth/sign-in', {
    body: { email: user.email, password: user.password },
  })
  await barrier.reached()
  expect((await reset(token, 'brand new password')).status).toBe(204)
  await barrier.release()
  const cookie = cookieHeader((await signingIn).headers)
  expect((await host.request('GET', '/me', { cookie })).status).toBe(401)
})
