// Wrong password is refused; Forgot your password? queues a users.password_reset email.
// ui.sh journeys/forgot-password.mjs email=<existing user>
export default async ({ page, base, shot, args, check }) => {
  await page.context().clearCookies()
  await page.goto(`${base}/admin/`)
  await page.getByRole('button', { name: 'Sign in' }).waitFor()
  await page.getByLabel('Email').fill(args.email)
  await page.getByLabel('Password').fill('not the password')
  const signIn = page.waitForResponse((r) => r.url().endsWith('/api/users/auth/sign-in'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  check((await signIn).status() === 401, 'wrong password: POST /api/users/auth/sign-in 401')
  await page.getByRole('alert').filter({ hasText: 'The email or password is wrong.' }).waitFor()
  check(page.url().includes('/admin/sign-in'), 'still on sign-in')
  await shot('wrong-password')
  check((await page.evaluate(() => fetch('/api/me').then((r) => r.status))) === 401, 'GET /api/me 401')

  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  await page.waitForURL(/\/admin\/forgot-password/)
  await page.getByLabel('Email').fill(args.email)
  const reset = page.waitForResponse((r) => r.url().endsWith('/api/users/auth/request-password-reset'))
  await page.getByRole('button', { name: 'Send the link' }).click()
  check((await reset).status() === 204, 'POST /api/users/auth/request-password-reset 204')
  await page.getByRole('status').filter({ hasText: 'an email with the link is on its way' }).waitFor()
  await shot('reset-requested')
}
