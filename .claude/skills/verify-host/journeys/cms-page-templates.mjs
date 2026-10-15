// New page -> pick the fixture's `Landing page` template -> the editor shows its sections and
// values -> path, available -> Save draft -> Publish -> the Read API serves the template's sections.
// ui.sh journeys/cms-page-templates.mjs email=<user with cms rights> password=<password>
import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const path = `/template-${run}`
  await page.goto(`${base}/admin/cms/pages`)
  await page.getByRole('button', { name: 'New page' }).click()
  const dialog = page.getByRole('dialog')
  const landing = dialog.getByRole('button', { name: /^Landing page/ })
  await landing.waitFor()
  check(await dialog.getByRole('button', { name: /^Blank page/ }).isVisible(), 'picker offers Blank page')
  const landingText = await landing.textContent()
  check(landingText.includes('Sections: Hero, Stats, Rich text'), `picker lists the template's sections: ${landingText}`)
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
  await shot('template-picker')

  const create = page.waitForResponse((r) => r.url().endsWith('/api/cms/pages') && r.request().method() === 'POST')
  await landing.click()
  const created = await create
  const sent = created.request().postDataJSON().sections
  check(created.status() === 200, 'Landing page: POST /api/cms/pages 200')
  check(
    sent.length === 3 && new Set(sent.map((s) => s.id)).size === 3,
    `three sections with fresh ids: ${sent.map((s) => `${s.type}:${s.id}`).join(', ')}`,
  )
  await page.waitForURL(/\/admin\/cms\/pages\/[0-9a-f-]{36}/)
  const id = page.url().split('/').pop()

  const title = page.locator('[name="sections.0.title.en"]')
  await title.waitFor()
  const titleValue = await title.inputValue()
  check(titleValue === 'Welcome', `hero title prefilled: ${titleValue}`)
  const count = page.locator('[name="sections.1.count"]')
  const countValue = await count.inputValue()
  check(countValue === '120', `stats count prefilled: ${countValue}`)
  await page.getByText('Tell visitors what you offer.').waitFor()
  check(true, 'rich text body prefilled')
  await title.scrollIntoViewIfNeeded()
  await shot('editor-hero-prefilled')
  await count.scrollIntoViewIfNeeded()
  await shot('editor-stats-rich-text-prefilled')

  await page.getByRole('textbox', { name: 'Path' }).fill(path)
  await page.getByRole('switch', { name: 'Available in this language' }).click()
  await page.getByRole('textbox', { name: 'SEO title' }).fill(`Template ${run}`)
  const draft = page.waitForResponse((r) => r.url().includes(`/api/cms/pages/${id}/draft?`) && r.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save draft' }).click()
  check((await draft).status() === 200, 'Save draft: PUT .../draft 200')
  await page.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor()

  const publish = page.waitForResponse((r) => r.url().includes(`/api/cms/pages/${id}/publish?`))
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  check((await publish).status() === 200, 'Publish: POST .../publish 200')
  await page.getByRole('status').filter({ hasText: 'Published.' }).waitFor()
  await shot('published')

  const resolved = await page.request.get(`${base}/api/cms/resolve?path=${encodeURIComponent(path)}`)
  const body = JSON.stringify(await resolved.json())
  check(resolved.status() === 200, `GET /api/cms/resolve?path=${path} ${resolved.status()}`)
  check(
    body.includes('"Welcome"') && body.includes('Tell visitors what you offer.'),
    `Read API serves the template copy: ${body.slice(0, 400)}`,
  )
}
