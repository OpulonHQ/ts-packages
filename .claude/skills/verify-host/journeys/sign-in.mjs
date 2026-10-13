// Signed out, /admin/ redirects to sign-in; valid credentials land back in the shell, signed in.
// ui.sh journeys/sign-in.mjs email=<address> password=<password>
export default async ({ page, base, shot, args, check }) => {
  await page.context().clearCookies()
  await page.goto(`${base}/admin/`)
  await page.getByRole('button', { name: 'Sign in' }).waitFor()
  check(page.url().includes('/admin/sign-in'), `signed out /admin/ lands on ${new URL(page.url()).pathname}`)
  await shot('sign-in')
  await page.getByLabel('Email').fill(args.email)
  await page.getByLabel('Password').fill(args.password)
  await shot('sign-in-filled')
  const signIn = page.waitForResponse((r) => r.url().endsWith('/api/users/auth/sign-in'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  check((await signIn).status() === 200, 'POST /api/users/auth/sign-in 200')
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'))
  await page.getByRole('link', { name: 'Dashboard' }).waitFor()
  await page.getByText(args.email).waitFor()
  await shot('signed-in')
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/me')
    return { status: r.status, body: await r.json() }
  })
  check(me.status === 200 && me.body.user?.email === args.email, `GET /api/me 200 as ${me.body.user?.email}`)
}
