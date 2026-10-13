import { format } from 'node:util'
import { expect, test, vi } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, randomIp, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

const signIn = (email: string, password: string, ip?: string) =>
  host.request('POST', '/users/auth/sign-in', { body: { email, password }, ...(ip ? { ip } : {}) })

test('signs in with email and password: an httpOnly, Secure, SameSite=Lax session cookie', async () => {
  const user = await seedUser(db.url, { email: 'eva@example.test', name: 'Eva' })
  const response = await signIn('Eva@Example.test', user.password)
  expect(response).toMatchObject({ status: 200, body: { id: user.id } })
  expect(response.headers.get('cache-control')).toBe('no-store')
  const [cookie] = response.headers.getSetCookie()
  expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/)
  expect(cookie).toMatch(/; HttpOnly/i)
  expect(cookie).toMatch(/; Secure/i)
  expect(cookie).toMatch(/; SameSite=Lax/i)
  expect(cookie).toMatch(/; Path=\//i)
  // The session token stays in the httpOnly cookie, never in a body scripts can read.
  expect(JSON.stringify(response.body)).not.toContain(cookie!.split('=')[1]!.split('.')[0])
})

test('/me reflects the signed-in user, with only composed permissions', async () => {
  const user = await seedUser(db.url, {
    name: 'Jana',
    locale: 'sk',
    permissions: ['demo.notes.view', 'gone.module.key'],
  })
  const cookie = await host.signIn(user.email, user.password)
  expect((await host.request('GET', '/me', { cookie })).body).toMatchObject({
    user: { id: user.id, name: 'Jana', email: user.email },
    locale: 'sk',
    permissions: ['demo.notes.view'],
  })
  expect((await host.request('GET', '/demo/notes', { cookie })).status).toBe(200)
  expect((await host.request('GET', '/emails/log', { cookie })).status).toBe(403)
})

test('a Super admin holds every composed permission', async () => {
  const user = await seedUser(db.url, { superAdmin: true })
  const cookie = await host.signIn(user.email, user.password)
  const me = await host.me(cookie)
  expect(me.permissions).toEqual(me.permissionCatalog)
  expect(me.permissions).toContain('users.manage')
})

test('a wrong password and an unknown email fail alike, without a cookie', async () => {
  const user = await seedUser(db.url)
  const wrong = await signIn(user.email, 'not the password')
  const unknown = await signIn('nobody@example.test', 'whatever password')
  expect(wrong.status).toBe(401)
  expect(unknown.status).toBe(401)
  expect(wrong.body).toEqual(unknown.body)
  expect(wrong.headers.getSetCookie()).toEqual([])
})

test('there is no public sign-up, nor any other Better Auth endpoint', async () => {
  const body = { email: 'new@example.test', password: 'long enough password', name: 'New' }
  for (const path of [
    '/users/auth/sign-up/email',
    '/users/auth/sign-up',
    '/users/auth/update-user',
  ])
    expect((await host.request('POST', path, { body })).status).toBe(404)
  expect(
    await sqlQuery(db.url, `select 1 from users."user" where email = 'new@example.test'`),
  ).toEqual([])
})

test('a deactivated user cannot sign in, and their open session stops working', async () => {
  const user = await seedUser(db.url)
  const cookie = await host.signIn(user.email, user.password)
  await sqlQuery(db.url, 'update users."user" set deactivated_at = now() where id = $1', [user.id])
  expect((await host.request('GET', '/me', { cookie })).status).toBe(401)
  const again = await signIn(user.email, user.password)
  expect(again.status).toBe(401)
  expect(again.headers.getSetCookie()).toEqual([])
})

test('sign-out clears the cookie and ends the session', async () => {
  const user = await seedUser(db.url)
  const cookie = await host.signIn(user.email, user.password)
  const out = await host.request('POST', '/users/auth/sign-out', { cookie })
  expect(out.status).toBe(204)
  expect(out.headers.getSetCookie().join()).toMatch(/session_token=;/)
  expect((await host.request('GET', '/me', { cookie })).status).toBe(401)
})

test('sign-in attempts are rate limited per client address', async () => {
  const user = await seedUser(db.url)
  const ip = randomIp()
  for (let i = 0; i < 5; i++)
    expect((await signIn(user.email, 'wrong password', ip)).status).toBe(401)
  const limited = await signIn(user.email, user.password, ip)
  expect(limited.status).toBe(429)
  expect(limited.body).toMatchObject({ _tag: 'TooManyRequests' })
  // Within the 60 s window: pg returns the bigint last_request as a string, which once made
  // Better Auth concatenate instead of add.
  const { retryAfter } = limited.body as { retryAfter: number }
  expect(retryAfter).toBeGreaterThanOrEqual(1)
  expect(retryAfter).toBeLessThanOrEqual(60)
  expect((await signIn(user.email, user.password)).status).toBe(200)
})

test('a state-changing request from another origin is not authenticated (CSRF)', async () => {
  const user = await seedUser(db.url, { permissions: ['users.manage'] })
  const cookie = await host.signIn(user.email, user.password)
  const body = { email: 'x@example.test', roleIds: [] }
  const foreign = await host.request('POST', '/users/invitations', {
    cookie,
    body,
    headers: { origin: 'https://evil.test' },
  })
  expect(foreign.status).toBe(401)
  expect((await host.request('POST', '/users/invitations', { cookie, body })).status).toBe(200)
})

test('a tampered session cookie is rejected', async () => {
  const user = await seedUser(db.url)
  const cookie = await host.signIn(user.email, user.password)
  // Change the token's last character (to one it is not: a no-op tamper made this flaky).
  const tampered = cookie.replace(
    /=([^.]+)\./,
    (_, token: string) => `=${token.slice(0, -1)}${token.endsWith('x') ? 'y' : 'x'}.`,
  )
  expect(tampered).not.toBe(cookie)
  expect((await host.request('GET', '/me', { cookie: tampered })).status).toBe(401)
})

test('an active session is extended, and the browser gets the refreshed cookie', async () => {
  const user = await seedUser(db.url)
  const cookie = await host.signIn(user.email, user.password)
  // A session last refreshed more than a day ago (the update age) is extended to 7 days.
  await sqlQuery(
    db.url,
    `update users.session set expires_at = now() + interval '1 hour' where user_id = $1`,
    [user.id],
  )
  const response = await host.request('GET', '/me', { cookie })
  expect(response.status).toBe(200)
  expect(response.headers.getSetCookie().join()).toMatch(/session_token=.+Max-Age=604800/i)
  const [session] = await sqlQuery<{ days: number }>(
    db.url,
    `select extract(epoch from expires_at - now()) / 86400 as days from users.session
     where user_id = $1`,
    [user.id],
  )
  expect(Number(session!.days)).toBeGreaterThan(6.9)
})

/** Everything written to the console while `fn` runs. */
async function consoleOf(fn: () => Promise<unknown>) {
  const logged: Array<string> = []
  // As the console prints them: an error's message and stack included.
  const capture = (...args: Array<unknown>) => void logged.push(format(...args))
  const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(capture),
  )
  try {
    await fn()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return logged.join('\n')
}

// Database errors whose messages quote the user, as Postgres errors quote rejected values: one
// where the session is written, one where sign-in reads the credential (a join).
const failures = {
  'writing the session': {
    code: 'P0042',
    setup: `create function users.fail_session() returns trigger language plpgsql as $$
        begin raise exception 'no session for %', new.user_id using errcode = 'P0042'; end $$;
      create trigger fail_session before insert on users.session
        for each row execute function users.fail_session()`,
    teardown: `drop trigger fail_session on users.session; drop function users.fail_session()`,
  },
  'reading the credential': {
    code: '22P02', // invalid_text_representation, quoting the user id
    setup: `alter table users.account rename to account_real;
      create view users.account as select * from users.account_real where user_id::int > 0`,
    teardown: `drop view users.account; alter table users.account_real rename to account`,
  },
}

test.each(Object.entries(failures))(
  'a sign-in failing in %s answers 500 and logs the cause, without user data',
  async (_, failure) => {
    const user = await seedUser(db.url)
    await sqlQuery(db.url, failure.setup)
    let status = 0
    const log = await consoleOf(async () => {
      status = (await signIn(user.email, user.password)).status
    }).finally(() => sqlQuery(db.url, failure.teardown))
    expect(status).toBe(500)
    expect(log).toContain('request failed')
    expect(log).toContain(failure.code)
    expect(log).not.toContain(user.id)
    expect(log).not.toContain(user.email)
  },
)

test("Better Auth's log lines reach our log without their messages", async () => {
  const user = await seedUser(db.url)
  const log = await consoleOf(() => signIn(user.email, 'wrong password'))
  expect(log).toContain('better-auth')
  // Its messages can quote request data (an origin, a URL); this one is fixed text.
  expect(log).not.toContain('Invalid password')
})
