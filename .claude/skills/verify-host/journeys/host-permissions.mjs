import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const role = `Order desk ${Date.now().toString(36)}`

  await page.goto(`${base}/admin/roles`)
  await page.getByRole('button', { name: 'New role' }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill(role)
  await page.getByRole('group', { name: 'Shop' }).getByRole('checkbox', { name: 'View orders' }).check()
  await shot('host-permission-checked')
  const saved = page.waitForResponse((r) => r.url().includes('/api/users/roles') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Save' }).click()
  check((await saved).status() === 200, `POST /api/users/roles ${(await saved).status()}`)
  await page.getByRole('status').filter({ hasText: 'The role is saved.' }).waitFor()
  await page.getByRole('row', { name: new RegExp(`${role}.*View orders`) }).waitFor()
  await shot('role-with-host-permission')

  const roles = await page.evaluate(() => fetch('/api/users/roles').then((r) => r.json()))
  const stored = roles.roles.find((r) => r.name === role)?.permissions.join()
  check(stored === 'shop.orders.view', `GET /api/users/roles: "${role}" stores ${stored}`)

  const read = (path) => page.evaluate((p) => fetch(p).then(async (r) => ({ status: r.status, body: await r.text() })), path)
  const orders = await read('/shop/orders')
  check(orders.status === 200, `GET /shop/orders signed in: ${orders.status} ${orders.body}`)
  const staff = JSON.parse((await read('/shop/staff')).body)
  check(staff.user?.permissions.includes('shop.orders.view'), `GET /shop/staff: ${staff.user?.email} holds shop.orders.view`)

  const signedOut = await fetch(`${base}/shop/orders`)
  const refusal = await signedOut.text()
  check(signedOut.status === 401 && refusal === '{"_tag":"Unauthorized"}', `GET /shop/orders signed out: ${signedOut.status} ${refusal}`)
}
