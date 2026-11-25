import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { staff } from '../server/staff.ts'
import { makeHost, origin, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

async function signedIn(o: Parameters<typeof seedUser>[1]) {
  const user = await seedUser(db.url, o)
  return { ...user, cookie: await host.signIn(user.email, user.password) }
}

const send = (
  path: string,
  o: { cookie?: string; method?: string; origin?: string | null } = {},
) => {
  const headers = new Headers()
  if (o.origin !== null) headers.set('origin', o.origin ?? origin)
  if (o.cookie) headers.set('cookie', o.cookie)
  return host.fetch(new Request(`${origin}${path}`, { method: o.method ?? 'GET', headers }))
}

const answer = async (response: Response) => ({
  status: response.status,
  contentType: response.headers.get('content-type'),
  cacheControl: response.headers.get('cache-control'),
  body: await response.text(),
})

test('a host route reads the signed-in staff user and their permissions, or none', async () => {
  const signedOut = await send('/shop/staff')
  expect(signedOut.status).toBe(200)
  expect(await signedOut.json()).toEqual({ user: null })

  const forged = await send('/shop/staff', {
    cookie: '__Secure-better-auth.session_token=forged.value',
  })
  expect(await forged.json()).toEqual({ user: null })

  const member = await signedIn({
    name: 'Olga',
    locale: 'sk',
    permissions: ['shop.orders.view', 'demo.notes.view'],
  })
  const response = await send('/shop/staff', { cookie: member.cookie })
  expect(await response.json()).toEqual({
    user: {
      id: member.id,
      name: 'Olga',
      email: member.email,
      locale: 'sk',
      permissions: ['demo.notes.view', 'shop.orders.view'],
    },
  })
})

test('a host route requiring a permission answers a missing session like the composed API', async () => {
  const composed = await answer(await send('/api/me'))
  expect(composed.status).toBe(401)
  expect(await answer(await send('/shop/orders'))).toEqual(composed)
})

test('a host route requiring a permission answers a missing permission like the composed API', async () => {
  const member = await signedIn({ permissions: [] })
  const composed = await answer(await send('/api/demo/notes', { cookie: member.cookie }))
  expect(composed.status).toBe(403)
  expect(await answer(await send('/shop/orders', { cookie: member.cookie }))).toEqual(composed)
})

test('a host route requiring a permission serves a user who holds it', async () => {
  const member = await signedIn({ permissions: ['shop.orders.view'] })
  const response = await send('/shop/orders', { cookie: member.cookie })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ viewer: member.id, orders: [] })
})

test('a deactivated user is signed out of a host route on the next request', async () => {
  const owner = await signedIn({ superAdmin: true })
  const member = await signedIn({ permissions: ['shop.orders.view'] })
  expect((await send('/shop/orders', { cookie: member.cookie })).status).toBe(200)

  const deactivated = await host.request('POST', `/users/users/${member.id}/deactivate`, {
    cookie: owner.cookie,
  })
  expect(deactivated.status).toBe(204)
  expect((await send('/shop/orders', { cookie: member.cookie })).status).toBe(401)
  expect(await (await send('/shop/staff', { cookie: member.cookie })).json()).toEqual({
    user: null,
  })
})

test('a removed role closes a host route on the next request', async () => {
  const owner = await signedIn({ superAdmin: true })
  const member = await signedIn({ permissions: ['shop.orders.view'] })
  expect((await send('/shop/orders', { cookie: member.cookie })).status).toBe(200)

  const unassigned = await host.request('PUT', `/users/users/${member.id}/roles`, {
    cookie: owner.cookie,
    body: { roleIds: [] },
  })
  expect(unassigned.status).toBe(204)
  expect((await send('/shop/orders', { cookie: member.cookie })).status).toBe(403)
})

test('a mutating host request from another origin counts as signed out, as on the composed API', async () => {
  const member = await signedIn({ permissions: ['shop.orders.view', 'demo.notes.view'] })
  const foreign = { cookie: member.cookie, method: 'POST', origin: 'https://evil.test' }
  expect((await send('/api/demo/pings', foreign)).status).toBe(401)
  expect((await send('/shop/orders', foreign)).status).toBe(401)
  expect((await send('/shop/orders', { cookie: member.cookie, method: 'POST' })).status).toBe(200)
  expect(
    (await send('/shop/orders', { cookie: member.cookie, origin: 'https://evil.test' })).status,
  ).toBe(200)
})

test('a host permission key is in the catalog, grantable through a role and held by Super admin', async () => {
  const owner = await signedIn({ superAdmin: true })
  const me = await host.me(owner.cookie)
  expect(me.permissionCatalog).toContain('shop.orders.view')
  expect(me.permissions).toContain('shop.orders.view')

  const role = await host.request('POST', '/users/roles', {
    cookie: owner.cookie,
    body: { name: 'Orders', permissions: ['shop.orders.view'] },
  })
  expect(role.status).toBe(200)
  const member = await signedIn({ permissions: [] })
  const assigned = await host.request('PUT', `/users/users/${member.id}/roles`, {
    cookie: owner.cookie,
    body: { roleIds: [(role.body as { id: string }).id] },
  })
  expect(assigned.status).toBe(204)
  expect((await send('/shop/orders', { cookie: member.cookie })).status).toBe(200)
})

test('a host route passes on the session cookie Better Auth refreshed, on a refusal too', async () => {
  const age = (userId: string) =>
    sqlQuery(
      db.url,
      `update users.session set expires_at = now() + interval '1 hour' where user_id = $1`,
      [userId],
    )
  const member = await signedIn({ permissions: ['shop.orders.view'] })
  await age(member.id)
  const served = await send('/shop/orders', { cookie: member.cookie })
  expect(served.status).toBe(200)
  expect(served.headers.getSetCookie().join()).toMatch(/session_token=.+Max-Age=604800/i)

  const outsider = await signedIn({ permissions: [] })
  await age(outsider.id)
  const refused = await send('/shop/orders', { cookie: outsider.cookie })
  expect(refused.status).toBe(403)
  expect(refused.headers.getSetCookie().join()).toMatch(/session_token=.+Max-Age=604800/i)
})

test('requiring a key outside the composed catalog refuses even a Super admin', async () => {
  const owner = await signedIn({ superAdmin: true })
  const env = host.env()
  const request = new Request(`${origin}/anything`, { headers: { cookie: owner.cookie } })
  expect(await staff.require(request, env, 'signedIn')).toMatchObject({
    ok: true,
    user: { id: owner.id },
  })
  const check = await staff.require(request, env, 'shop.orders.delete')
  expect(check.ok ? 200 : check.response.status).toBe(403)
})
