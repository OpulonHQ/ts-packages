import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  let gate
  let held = 0
  await page.route('**/api/me', async (route) => {
    if (!gate || route.request().method() !== 'GET') return route.continue()
    const release = gate
    gate = undefined
    const response = await route.fetch()
    held++
    await release.promise
    await route.fulfill({ response })
  })
  const state = () =>
    page.evaluate(() => {
      const { provides } = document.querySelector('[data-v-app]').__vue_app__._context
      const admin = Object.getOwnPropertySymbols(provides)
        .map((key) => provides[key])
        .find((value) => value && typeof value === 'object' && 'status' in value && 'me' in value)
      return { status: admin.status.value, user: admin.me.value?.user.email ?? null, locale: admin.me.value?.locale ?? null }
    })
  const chooseLanguage = async (menu, language, name, lang) => {
    await page.getByRole('button', { name: menu }).click()
    await page.getByRole('menuitem', { name: language }).click()
    await page.getByRole('menuitemcheckbox', { name }).click()
    await page.waitForFunction((l) => document.documentElement.lang === l, lang)
  }

  await page.goto(`${base}/admin/`)
  await page.getByRole('button', { name: /^(User menu|Používateľské menu)$/ }).waitFor()
  if ((await page.evaluate(() => document.documentElement.lang)) !== 'en') {
    await chooseLanguage('Používateľské menu', 'Jazyk', 'English', 'en')
  }
  await shot('signed-in-en')

  const gateForLocale = Promise.withResolvers()
  gate = gateForLocale
  let before = held
  await page.locator('nav a[href="/admin/demo/notes"]').first().click()
  while (held === before) await page.waitForTimeout(20)
  check(true, 'deploy check answered by the server (locale en) and held from the shell')
  await chooseLanguage('User menu', 'Language', 'Slovenčina', 'sk')
  check((await state()).locale === 'sk', 'language change to sk applied while the check is held')
  gateForLocale.resolve()
  await page.waitForTimeout(500)
  const afterLocale = await state()
  await shot('locale-after-late-check')
  check(afterLocale.locale === 'sk', `late deploy check keeps the new language: me.locale=${afterLocale.locale}`)
  const saved = await (await page.request.get(`${base}/api/me`)).json()
  check(saved.locale === 'sk', `server saved locale ${saved.locale}`)
  await chooseLanguage('Používateľské menu', 'Jazyk', 'English', 'en')

  const gateForSignOut = Promise.withResolvers()
  gate = gateForSignOut
  before = held
  await page.locator('nav a[href="/admin/"]').first().click()
  while (held === before) await page.waitForTimeout(20)
  check(true, 'deploy check answered by the server (signed in) and held from the shell')
  await page.getByRole('button', { name: 'User menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.getByRole('textbox', { name: 'Password' }).waitFor()
  check((await state()).status === 'signedOut', 'signed out while the check is held')
  gateForSignOut.resolve()
  await page.waitForTimeout(500)
  const afterSignOut = await state()
  await shot('signed-out-after-late-check')
  check(
    afterSignOut.status === 'signedOut' && afterSignOut.user === null,
    `late deploy check leaves the user signed out: status=${afterSignOut.status} user=${afterSignOut.user}`,
  )
}
