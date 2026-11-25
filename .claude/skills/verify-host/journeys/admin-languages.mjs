import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const me = async () => (await (await page.request.get(`${base}/api/me`)).json()).locale
  const choose = async (userMenu, language, name) => {
    await page.getByRole('button', { name: userMenu }).click()
    await page.getByRole('menuitem', { name: language }).click()
    const offered = await page.getByRole('menuitemcheckbox').allTextContents()
    const saved = page.waitForResponse((r) => r.url().endsWith('/locale') && r.request().method() === 'PUT')
    await page.getByRole('menuitemcheckbox', { name }).click()
    return { offered: offered.map((text) => text.trim()), status: (await saved).status() }
  }

  await page.goto(`${base}/admin/`)
  await page.getByRole('link', { name: 'Dashboard' }).waitFor()
  await shot('english')

  const italian = await choose('User menu', 'Language', 'Italiano')
  check(
    italian.offered.join(',') === 'English,Slovenčina,Italiano',
    `language menu offers the host's list: ${italian.offered.join(', ')}`,
  )
  check(italian.status === 204 || italian.status === 200, `PUT locale it: ${italian.status}`)
  await page.getByRole('link', { name: 'Bacheca' }).waitFor()
  check((await page.locator('html').getAttribute('lang')) === 'it', 'html lang is it')
  check((await me()) === 'it', 'GET /api/me holds locale it')
  for (const name of ['Utenti', 'Pagine', 'Media', 'Registro email'])
    check((await page.getByRole('link', { name, exact: true }).count()) > 0, `package nav entry in Italian: ${name}`)
  check(
    (await page.getByRole('link', { name: 'Notes', exact: true }).count()) > 0,
    'the demo host module has no Italian catalog and shows English: Notes',
  )
  check(
    (await page.getByText('demo.nav.notes').count()) === 0,
    'no message key is shown for the demo module',
  )
  check(
    (await page.getByRole('button', { name: 'Comprimi barra laterale' }).count()) > 0,
    'Nuxt UI text in Italian: Comprimi barra laterale',
  )
  await shot('italian-dashboard')

  await page.goto(`${base}/admin/users`)
  await page.getByRole('heading', { name: 'Utenti' }).waitFor()
  await page.getByRole('button', { name: 'Invita' }).waitFor()
  await shot('italian-users')

  await page.goto(`${base}/admin/account`)
  await page.getByRole('heading', { name: 'Il mio account' }).waitFor()
  const picker = page.getByRole('group', { name: 'Lingua dell’amministrazione' })
  const buttons = (await picker.getByRole('button').allTextContents()).map((text) => text.trim())
  check(
    buttons.join(',') === 'Predefinita,English,Slovenčina,Italiano',
    `account language picker: ${buttons.join(', ')}`,
  )
  check(
    (await picker.getByRole('button', { name: 'Italiano', pressed: true }).count()) === 1,
    'Italiano is the pressed language',
  )
  await shot('italian-account')

  const english = await choose('Menu utente', 'Lingua', 'English')
  check(english.status === 204 || english.status === 200, `PUT locale en: ${english.status}`)
  await page.getByRole('heading', { name: 'My account' }).waitFor()
  check((await me()) === 'en', 'GET /api/me holds locale en again')
}
