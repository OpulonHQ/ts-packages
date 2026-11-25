const notSetUp = 'The check that you are human is not set up correctly. Contact an administrator.'
const didNotLoad =
  'The check that you are human did not load. Check your connection or content blocker.'
const cloudflare = '**/challenges.cloudflare.com/**'
const signInUrl = '/api/users/auth/sign-in'
const resetUrl = '/api/users/auth/request-password-reset'

export default async ({ page, base, shot, args, check }) => {
  const mode = args.mode ?? 'pass'
  const alert = (text) => page.getByRole('alert').filter({ hasText: text })
  const enabled = () =>
    page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  const post = (path, data) => page.request.post(base + path, { headers: { origin: base }, data })

  const open = async (path, button) => {
    await page.context().clearCookies()
    await page.goto(`${base}/admin/${path}`)
    await page.getByRole('button', { name: button }).waitFor()
  }
  const submitSignIn = async () => {
    await page.getByLabel('Email').fill(args.email)
    await page.getByLabel('Password').fill(args.password)
    const answer = page.waitForResponse((r) => r.url().endsWith(signInUrl))
    await page.getByRole('button', { name: 'Sign in' }).click()
    return answer
  }
  const submitReset = async () => {
    await page.getByLabel('Email').fill(args.email)
    const answer = page.waitForResponse((r) => r.url().endsWith(resetUrl))
    await page.getByRole('button', { name: 'Send the link' }).click()
    return answer
  }
  const refusedAsSetup = async (response, what) => {
    const body = await response.json()
    check(response.status() === 403, `${what}: ${response.status()} ${body._tag}`)
    await alert(notSetUp).waitFor()
    check(true, `${what}: the screen says the check is not set up`)
  }

  if (mode === 'blocked') {
    await page.route(cloudflare, (route) => route.abort())
    for (const [path, button] of [
      ['sign-in', 'Sign in'],
      ['forgot-password', 'Send the link'],
    ]) {
      await open(path, button)
      await alert(didNotLoad).waitFor()
      check(await page.getByRole('button', { name: button }).isDisabled(), `${path}: blocked script, submit disabled, the screen says why`)
      await shot(`turnstile-blocked-${path}`)
    }
    await page.unroute(cloudflare)
    await page.getByRole('button', { name: 'Try again' }).click()
    await enabled()
    check((await alert(didNotLoad).count()) === 0, 'Try again loaded the widget: submit enabled, message gone')
    await shot('turnstile-retried')
    return
  }

  if (mode === 'no-site-key') {
    await open('sign-in', 'Sign in')
    check((await page.locator('script[src*="challenges.cloudflare.com"]').count()) === 0, 'no widget on the screen')
    await refusedAsSetup(await submitSignIn(), 'guard on, no site key, sign-in')
    await shot('turnstile-no-site-key-sign-in')
    await open('forgot-password', 'Send the link')
    await refusedAsSetup(await submitReset(), 'guard on, no site key, reset request')
    await shot('turnstile-no-site-key-reset')
    return
  }

  if (mode === 'guard-off') {
    const bare = await post(signInUrl, { email: args.email, password: args.password })
    check(bare.status() === 200, `guard off, sign-in without a token: ${bare.status()}`)
    await open('sign-in', 'Sign in')
    await enabled()
    await refusedAsSetup(await submitSignIn(), 'site key in the admin, guard off, sign-in')
    check((await page.evaluate(() => fetch('/api/me').then((r) => r.status))) === 401, 'not signed in')
    await shot('turnstile-guard-off-sign-in')
    await open('forgot-password', 'Send the link')
    await enabled()
    await refusedAsSetup(await submitReset(), 'site key in the admin, guard off, reset request')
    await shot('turnstile-guard-off-reset')
    return
  }

  await open('sign-in', 'Sign in')
  const script = page.locator('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]')
  check((await script.count()) === 1, 'the sign-in screen loads the Turnstile script once')
  const bare = await post(signInUrl, { email: args.email, password: args.password })
  check(
    bare.status() === 403 && (await bare.json())._tag === 'TurnstileFailed',
    `sign-in without a token, right password: ${bare.status()} ${await bare.text()}`,
  )
  const reset = await post(resetUrl, { email: args.email })
  check(reset.status() === 403, `reset request without a token: ${reset.status()}`)

  await enabled()
  check(true, 'the widget produced a token: Sign in is enabled')
  await shot('turnstile-sign-in')
  const response = await submitSignIn()
  check(Boolean(response.request().postDataJSON().turnstileToken), 'the sign-in request carries turnstileToken')
  if (mode === 'fail') {
    check(response.status() === 403, `always-fail secret: sign-in ${response.status()}`)
    await alert('The check that you are human did not pass. Try again.').waitFor()
    check(page.url().includes('/admin/sign-in'), 'still on sign-in')
    await shot('turnstile-refused')
    return
  }
  check(response.status() === 200, `sign-in with the widget's token: ${response.status()}`)
  await page.getByRole('link', { name: 'Dashboard' }).waitFor()
  await shot('turnstile-signed-in')

  await open('forgot-password', 'Send the link')
  await enabled()
  check((await submitReset()).status() === 204, 'reset request with the widget token: 204')
  await page.getByRole('status').filter({ hasText: 'an email with the link is on its way' }).waitFor()
  await shot('turnstile-reset-requested')
}
