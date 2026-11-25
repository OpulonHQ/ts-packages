import { afterEach, expect, test, vi } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import type { Env } from '../worker.ts'
import { dummy, stubSiteverify } from './support/turnstile.ts'
import { makeHost, randomIp, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const guarded = (env: Partial<Env> = {}) =>
  makeHost(() => db.url, {
    env: {
      USERS_TURNSTILE: 'true',
      USERS_TURNSTILE_SECRET: dummy.passSecret,
      USERS_TURNSTILE_HOSTNAMES: 'host.test',
      ...env,
    },
  })
const host = guarded()
const unguarded = makeHost(() => db.url)

type Host = ReturnType<typeof makeHost>
const signIn = (
  on: Host,
  body: { email: string; password: string; turnstileToken?: string },
  ip?: string,
) => on.request('POST', '/users/auth/sign-in', { body, ...(ip ? { ip } : {}) })
const requestReset = (on: Host, body: { email: string; turnstileToken?: string }) =>
  on.request('POST', '/users/auth/request-password-reset', { body })

const events = (action: string) =>
  sqlQuery(db.url, 'select 1 from core.audit_event where action = $1', [action])

afterEach(() => {
  vi.unstubAllGlobals()
})

test('with the check on, a sign-in without a token is refused before the password is looked at', async () => {
  const calls = stubSiteverify()
  const user = await seedUser(db.url)
  const ip = randomIp()

  const right = await signIn(host, { email: user.email, password: user.password }, ip)
  expect(right).toMatchObject({ status: 403, body: { _tag: 'TurnstileFailed' } })
  expect(right.headers.getSetCookie()).toEqual([])

  // A wrong password answers the same, is not audited as a failed sign-in and uses no attempt.
  for (let i = 0; i < 6; i++)
    expect(
      (await signIn(host, { email: user.email, password: 'not the password' }, ip)).status,
    ).toBe(403)
  expect(await events('users.sign_in_failed')).toEqual([])
  expect(calls).toEqual([])

  const withToken = await signIn(
    host,
    { email: user.email, password: user.password, turnstileToken: dummy.token },
    ip,
  )
  expect(withToken).toMatchObject({ status: 200, body: { id: user.id } })
  expect(withToken.headers.getSetCookie()[0]).toMatch(/session_token=/)
})

test("siteverify gets the secret, the token and the client's address", async () => {
  const calls = stubSiteverify()
  const user = await seedUser(db.url)
  const ip = randomIp()
  await signIn(
    host,
    { email: user.email, password: user.password, turnstileToken: dummy.token },
    ip,
  )
  expect(calls.map((form) => Object.fromEntries(form))).toEqual([
    { secret: dummy.passSecret, response: dummy.token, remoteip: ip },
  ])
})

test("Cloudflare's always-fail secret refuses every token", async () => {
  stubSiteverify()
  const user = await seedUser(db.url)
  const failing = guarded({ USERS_TURNSTILE_SECRET: dummy.failSecret })
  expect(
    await signIn(failing, {
      email: user.email,
      password: user.password,
      turnstileToken: dummy.token,
    }),
  ).toMatchObject({ status: 403, body: { _tag: 'TurnstileFailed' } })
})

test('with a real secret, the token must be for the sign-in action and an allowed hostname', async () => {
  const user = await seedUser(db.url)
  const real = guarded({
    USERS_TURNSTILE_SECRET: 'a-real-secret',
    USERS_TURNSTILE_HOSTNAMES: 'host.test, admin.host.test',
  })
  const attempt = async (answer: { hostname: string; action: string }) => {
    stubSiteverify(() => Response.json({ success: true, 'error-codes': [], ...answer }))
    const response = await signIn(real, {
      email: user.email,
      password: user.password,
      turnstileToken: 'a-real-token',
    })
    return response.status
  }
  expect(await attempt({ hostname: 'host.test', action: 'request-password-reset' })).toBe(403)
  expect(await attempt({ hostname: 'evil.test', action: 'sign-in' })).toBe(403)
  expect(await attempt({ hostname: 'example.com', action: 'sign-in' })).toBe(403)
  expect(await attempt({ hostname: 'admin.host.test', action: 'sign-in' })).toBe(200)
})

test('a missing secret or hostname list refuses a valid token without asking siteverify', async () => {
  const calls = stubSiteverify()
  const user = await seedUser(db.url)
  const body = { email: user.email, password: user.password, turnstileToken: dummy.token }
  for (const env of [
    { USERS_TURNSTILE_SECRET: undefined },
    { USERS_TURNSTILE_SECRET: '' },
    { USERS_TURNSTILE_HOSTNAMES: undefined },
    { USERS_TURNSTILE_HOSTNAMES: ' , ' },
  ] as ReadonlyArray<Partial<Env>>)
    expect((await signIn(guarded(env), body)).status).toBe(403)
  expect(calls).toEqual([])
})

test('a siteverify that fails or answers nonsense refuses the sign-in', async () => {
  const user = await seedUser(db.url)
  const body = { email: user.email, password: user.password, turnstileToken: dummy.token }
  for (const answer of [
    () => new Response('upstream error', { status: 500 }),
    () => new Response('<html>', { status: 200 }),
    () => Response.json({ success: 'true' }),
    () => Promise.reject(new Error('network down')),
  ]) {
    stubSiteverify(answer)
    expect((await signIn(host, body)).status).toBe(403)
  }
})

test('a password-reset request needs a token for its own action', async () => {
  stubSiteverify()
  const user = await seedUser(db.url)
  const sent = host.mailer.sent.length

  expect(await requestReset(host, { email: user.email })).toMatchObject({
    status: 403,
    body: { _tag: 'TurnstileFailed' },
  })
  expect(host.mailer.sent.length).toBe(sent)

  expect(
    (await requestReset(host, { email: user.email, turnstileToken: dummy.token })).status,
  ).toBe(204)
  expect(host.mailer.sent.length).toBe(sent + 1)

  const real = guarded({ USERS_TURNSTILE_SECRET: 'a-real-secret' })
  stubSiteverify(() =>
    Response.json({ success: true, 'error-codes': [], hostname: 'host.test', action: 'sign-in' }),
  )
  expect(
    (await requestReset(real, { email: user.email, turnstileToken: 'a-real-token' })).status,
  ).toBe(403)
  stubSiteverify(() =>
    Response.json({
      success: true,
      'error-codes': [],
      hostname: 'host.test',
      action: 'request-password-reset',
    }),
  )
  expect(
    (await requestReset(real, { email: user.email, turnstileToken: 'a-real-token' })).status,
  ).toBe(204)
})

test('with the check off, sign-in and reset requests need no token and never ask siteverify', async () => {
  const calls = stubSiteverify()
  const user = await seedUser(db.url)
  for (const on of [unguarded, guarded({ USERS_TURNSTILE: 'false' })]) {
    expect((await signIn(on, { email: user.email, password: user.password })).status).toBe(200)
    expect(
      (await signIn(on, { email: user.email, password: user.password, turnstileToken: 'ignored' }))
        .status,
    ).toBe(200)
    expect((await signIn(on, { email: user.email, password: 'not the password' })).status).toBe(401)
    expect((await requestReset(on, { email: user.email })).status).toBe(204)
  }
  expect(calls).toEqual([])
})
