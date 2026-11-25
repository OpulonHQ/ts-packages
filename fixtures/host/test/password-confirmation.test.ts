import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, origin, randomIp, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

const required = { _tag: 'PasswordConfirmationRequired' }

async function signedIn(permissions: ReadonlyArray<string> = ['demo.notes.view']) {
  const user = await seedUser(db.url, { name: 'Nora', permissions })
  return { ...user, cookie: await host.signIn(user.email, user.password) }
}

const confirm = (cookie: string, password: string, ip?: string) =>
  host.request('POST', '/users/password-confirmation', {
    cookie,
    body: { password },
    ...(ip ? { ip } : {}),
  })

const stamp = (cookie: string, on = host) => on.request('POST', '/demo/stamps', { cookie })

const confirmedAgo = (userId: string, interval: string) =>
  sqlQuery(
    db.url,
    `update users.session set password_confirmed_at = now() - $2::interval where user_id = $1`,
    [userId, interval],
  )

test('a sensitive endpoint is refused until the session confirms its password, then runs', async () => {
  const user = await signedIn()
  const refused = await stamp(user.cookie)
  expect(refused.status).toBe(403)
  expect(refused.body).toEqual(required)
  expect(await sqlQuery(db.url, 'select body from demo.note')).toEqual([])

  expect((await confirm(user.cookie, user.password)).status).toBe(204)
  const served = await stamp(user.cookie)
  expect(served.status).toBe(200)
  expect(served.body).toMatchObject({ body: 'Stamped by Nora' })
  expect((await host.request('GET', '/demo/notes', { cookie: user.cookie })).status).toBe(200)
})

test('a sensitive endpoint checks the permission before the confirmation', async () => {
  const user = await signedIn([])
  expect((await confirm(user.cookie, user.password)).status).toBe(204)
  expect((await stamp(user.cookie)).body).toEqual({ _tag: 'Forbidden' })
})

test('a confirmation belongs to the session that made it', async () => {
  const user = await signedIn()
  const other = await host.signIn(user.email, user.password)
  expect((await confirm(user.cookie, user.password)).status).toBe(204)
  expect((await stamp(user.cookie)).status).toBe(200)
  expect((await stamp(other)).body).toEqual(required)
})

test('a confirmation lasts 5 minutes by default', async () => {
  const user = await signedIn()
  expect((await confirm(user.cookie, user.password)).status).toBe(204)
  await confirmedAgo(user.id, '4 minutes')
  expect((await stamp(user.cookie)).status).toBe(200)
  await confirmedAgo(user.id, '6 minutes')
  expect((await stamp(user.cookie)).body).toEqual(required)
})

test('the host sets how long a confirmation lasts', async () => {
  const longer = makeHost(() => db.url, { env: { USERS_PASSWORD_CONFIRM_WINDOW: '10 minutes' } })
  const user = await signedIn()
  expect((await confirm(user.cookie, user.password)).status).toBe(204)
  await confirmedAgo(user.id, '6 minutes')
  expect((await stamp(user.cookie)).body).toEqual(required)
  expect((await stamp(user.cookie, longer)).status).toBe(200)
  await confirmedAgo(user.id, '11 minutes')
  expect((await stamp(user.cookie, longer)).body).toEqual(required)
})

test('a wrong password confirms nothing and is audited with the user, IP and user agent', async () => {
  const user = await signedIn()
  const wrong = await confirm(user.cookie, 'not the password', '10.7.7.7')
  expect(wrong.status).toBe(403)
  expect(wrong.body).toEqual({ _tag: 'WrongPassword' })
  expect((await stamp(user.cookie)).body).toEqual(required)

  const events = await sqlQuery(
    db.url,
    `select actor_kind, actor_id, subject_type, subject_id, ip, user_agent, row_to_json(e)::text as row
     from core.audit_event e where action = 'users.password_confirmation_failed'`,
  )
  expect(events).toEqual([
    expect.objectContaining({
      actor_kind: 'user',
      actor_id: user.id,
      subject_type: 'user',
      subject_id: user.id,
      ip: '10.7.7.7',
      user_agent: 'vitest',
    }),
  ])
  expect(events[0]!.row).not.toContain('not the password')
})

test('confirmation attempts are rate limited per client address, as sign-in is', async () => {
  const user = await signedIn()
  const ip = randomIp()
  for (let i = 0; i < 5; i++)
    expect((await confirm(user.cookie, 'not the password', ip)).status).toBe(403)
  const limited = await confirm(user.cookie, user.password, ip)
  expect(limited.status).toBe(429)
  const { _tag, retryAfter } = limited.body as { _tag: string; retryAfter: number }
  expect(_tag).toBe('TooManyRequests')
  expect(retryAfter).toBeGreaterThanOrEqual(1)
  expect(retryAfter).toBeLessThanOrEqual(60)
  expect((await stamp(user.cookie)).body).toEqual(required)
  expect((await confirm(user.cookie, user.password)).status).toBe(204)
})

test('confirming needs a session, and a request from another origin has none', async () => {
  const user = await signedIn()
  expect((await confirm('', user.password)).status).toBe(401)
  const foreign = await host.request('POST', '/users/password-confirmation', {
    cookie: user.cookie,
    body: { password: user.password },
    headers: { origin: 'https://evil.test' },
  })
  expect(foreign.status).toBe(401)
  expect((await stamp(user.cookie)).body).toEqual(required)
})

test('a host route outside the composed API makes the same check', async () => {
  const user = await signedIn(['shop.orders.view', 'demo.notes.view'])
  const refund = () =>
    host.fetch(
      new Request(`${origin}/shop/refunds`, {
        method: 'POST',
        headers: { origin, cookie: user.cookie },
      }),
    )
  const answer = async (response: Response) => ({
    status: response.status,
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    body: await response.text(),
  })
  const composed = await answer(
    await host.fetch(
      new Request(`${origin}/api/demo/stamps`, {
        method: 'POST',
        headers: { origin, cookie: user.cookie },
      }),
    ),
  )
  expect(composed.status).toBe(403)
  expect(JSON.parse(composed.body)).toEqual(required)
  expect(await answer(await refund())).toEqual(composed)

  expect((await confirm(user.cookie, user.password)).status).toBe(204)
  const served = await refund()
  expect(served.status).toBe(200)
  expect(await served.json()).toEqual({ refundedBy: user.id })
})
