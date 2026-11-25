export default async ({ page, base, shot, args, check }) => {
  const passes = (args.secret ?? 'pass') === 'pass'
  await page.context().clearCookies()
  await page.goto(`${base}/admin/`)
  const submit = page.getByRole('button', { name: 'Sign in' })
  await submit.waitFor()
  const script = page.locator('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]')
  check((await script.count()) === 1, 'the sign-in screen loads the Turnstile script once')

  const bare = await page.request.post(`${base}/api/users/auth/sign-in`, {
    headers: { origin: base },
    data: { email: args.email, password: args.password },
  })
  check(
    bare.status() === 403 && (await bare.json())._tag === 'TurnstileFailed',
    `sign-in without a token, right password: ${bare.status()} ${await bare.text()}`,
  )
  const reset = await page.request.post(`${base}/api/users/auth/request-password-reset`, {
    headers: { origin: base },
    data: { email: args.email },
  })
  check(reset.status() === 403, `reset request without a token: ${reset.status()}`)

  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  check(true, 'the widget produced a token: Sign in is enabled')
  await page.getByLabel('Email').fill(args.email)
  await page.getByLabel('Password').fill(args.password)
  await shot('turnstile-sign-in')
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/users/auth/sign-in'))
  await submit.click()
  const response = await answer
  check(
    Boolean(response.request().postDataJSON().turnstileToken),
    'the sign-in request carries turnstileToken',
  )
  if (passes) {
    check(response.status() === 200, `sign-in with the widget's token: ${response.status()}`)
    await page.getByRole('link', { name: 'Dashboard' }).waitFor()
    await shot('turnstile-signed-in')
  } else {
    check(response.status() === 403, `always-fail secret: sign-in ${response.status()}`)
    await page
      .getByRole('alert')
      .filter({ hasText: 'The check that you are human did not pass. Try again.' })
      .waitFor()
    check(page.url().includes('/admin/sign-in'), 'still on sign-in')
    await shot('turnstile-refused')
  }

  if (!passes) return
  await page.context().clearCookies()
  await page.goto(`${base}/admin/forgot-password`)
  const send = page.getByRole('button', { name: 'Send the link' })
  await send.waitFor()
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  await page.getByLabel('Email').fill(args.email)
  const requested = page.waitForResponse((r) =>
    r.url().endsWith('/api/users/auth/request-password-reset'),
  )
  await send.click()
  check((await requested).status() === 204, 'reset request with the widget token: 204')
  await page.getByRole('status').filter({ hasText: 'an email with the link is on its way' }).waitFor()
  await shot('turnstile-reset-requested')
}
