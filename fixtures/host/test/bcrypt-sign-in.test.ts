import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, randomIp, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

const signIn = (email: string, password: string, ip?: string) =>
  host.request('POST', '/users/auth/sign-in', { body: { email, password }, ...(ip ? { ip } : {}) })

const storedHash = async (userId: string) =>
  (
    await sqlQuery<{ password: string }>(
      db.url,
      'select password from users.account where user_id = $1',
      [userId],
    )
  )[0]!.password

const laravel = {
  password: 'laravel secret 1',
  passwordHash: '$2y$12$WhA9TIrkx7zcl/eiDtXkJOsQcBrN0PtwA3DlxH1k76aJKDjSLHAoq',
}

test.each([
  {
    variant: '$2a$',
    password: 'legacy secret a',
    passwordHash: '$2a$04$abcdefghijklmnopqrstuuS2t9x.Qrw7dAC.XlbTjWsb6fRbDkekO',
  },
  {
    variant: '$2b$',
    password: 'legacy secret b',
    passwordHash: '$2b$04$ABCDEFGHIJKLMNOPQRSTUu2uTi8c2SvmZuO3QGkGMBqlbvwnVFTB2',
  },
  { variant: '$2y$', ...laravel },
])(
  'a user with a $variant bcrypt hash signs in with their existing password, which upgrades the hash',
  async ({ password, passwordHash }) => {
    const user = await seedUser(db.url, { password, passwordHash })

    const first = await signIn(user.email, password)
    expect(first).toMatchObject({ status: 200, body: { id: user.id } })
    expect(await storedHash(user.id)).toMatch(/^pbkdf2v1:/)

    const cookie = await host.signIn(user.email, password)
    expect((await host.me(cookie)).user.id).toBe(user.id)
    expect((await signIn(user.email, 'not the password')).status).toBe(401)
  },
)

test('the session of the upgrading sign-in keeps working', async () => {
  const user = await seedUser(db.url, laravel)
  const cookie = await host.signIn(user.email, laravel.password)
  expect(await storedHash(user.id)).toMatch(/^pbkdf2v1:/)
  expect((await host.me(cookie)).user.id).toBe(user.id)
})

test('two first sign-ins at once both succeed', async () => {
  const user = await seedUser(db.url, laravel)
  const both = await Promise.all([
    signIn(user.email, laravel.password),
    signIn(user.email, laravel.password),
  ])
  expect(both.map((r) => r.status)).toEqual([200, 200])
  expect(await storedHash(user.id)).toMatch(/^pbkdf2v1:/)
  expect((await signIn(user.email, laravel.password)).status).toBe(200)
})

test('a wrong password against a bcrypt hash fails like any other and counts toward the rate limit', async () => {
  const user = await seedUser(db.url, laravel)
  const ip = randomIp()
  const wrong = await signIn(user.email, 'not the password', ip)
  const unknown = await signIn('nobody@example.test', 'whatever password')
  expect(wrong.status).toBe(401)
  expect(wrong.body).toEqual(unknown.body)
  expect(wrong.headers.getSetCookie()).toEqual([])
  for (let i = 0; i < 4; i++)
    expect((await signIn(user.email, 'not the password', ip)).status).toBe(401)
  expect((await signIn(user.email, laravel.password, ip)).status).toBe(429)
  expect(await storedHash(user.id)).toBe(laravel.passwordHash)
})

test('a sign-in with a hash in the current format leaves it as it is', async () => {
  const user = await seedUser(db.url)
  const before = await storedHash(user.id)
  expect((await signIn(user.email, user.password)).status).toBe(200)
  expect(await storedHash(user.id)).toBe(before)
})
