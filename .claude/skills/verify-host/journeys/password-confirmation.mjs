import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, args, check } = ctx
  await signedIn(ctx)
  const post = (path) =>
    page.evaluate((p) => fetch(p, { method: 'POST' }).then(async (r) => ({ status: r.status, body: await r.text() })), path)

  await page.goto(`${base}/admin/demo/notes`)
  await page.getByRole('button', { name: 'Add a stamped note' }).waitFor()
  const before = await page.getByRole('cell', { name: /^Stamped by/ }).count()

  const hostRoute = await post('/shop/refunds')
  check(
    hostRoute.status === 403 && hostRoute.body === '{"_tag":"PasswordConfirmationRequired"}',
    `POST /shop/refunds unconfirmed: ${hostRoute.status} ${hostRoute.body}`,
  )

  const refused = page.waitForResponse((r) => r.url().endsWith('/api/demo/stamps'))
  await page.getByRole('button', { name: 'Add a stamped note' }).click()
  check((await refused).status() === 403, `POST /api/demo/stamps unconfirmed: ${(await refused).status()}`)
  const dialog = page.getByRole('dialog', { name: 'Confirm your password' })
  await dialog.waitFor()
  await shot('password-prompt')

  const wrong = page.waitForResponse((r) => r.url().endsWith('/api/users/password-confirmation'))
  await dialog.getByRole('textbox', { name: 'Password' }).fill('not the password')
  await dialog.getByRole('button', { name: 'Confirm' }).click()
  check((await wrong).status() === 403, `wrong password: ${(await wrong).status()}`)
  await dialog.getByRole('alert').filter({ hasText: 'The password is wrong.' }).waitFor()
  await shot('wrong-password')

  const served = page.waitForResponse((r) => r.url().endsWith('/api/demo/stamps') && r.status() === 200)
  await dialog.getByRole('textbox', { name: 'Password' }).fill(args.password)
  await dialog.getByRole('button', { name: 'Confirm' }).click()
  await served
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('cell', { name: /^Stamped by/ }).nth(before).waitFor()
  await shot('stamped-after-confirmation')

  const again = page.waitForResponse((r) => r.url().endsWith('/api/demo/stamps'))
  await page.getByRole('button', { name: 'Add a stamped note' }).click()
  check((await again).status() === 200, `second stamp within the window: ${(await again).status()}, no dialog`)
  await page.getByRole('cell', { name: /^Stamped by/ }).nth(before + 1).waitFor()
  check((await dialog.count()) === 0, 'no password dialog for the second stamp')

  const refund = await post('/shop/refunds')
  check(refund.status === 200, `POST /shop/refunds confirmed: ${refund.status} ${refund.body}`)
}
