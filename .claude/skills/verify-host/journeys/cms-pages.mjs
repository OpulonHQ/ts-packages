// New page -> Blank page -> path, available, SEO title -> Save draft -> Publish -> the Read API serves it.
// ui.sh journeys/cms-pages.mjs email=<user with cms rights> password=<password>
import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const path = `/verify-${run}`
  await page.goto(`${base}/admin/cms/pages`)
  const create = page.waitForResponse((r) => r.url().endsWith('/api/cms/pages') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'New page' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Blank page/ }).click()
  check((await create).status() === 200, 'New page: POST /api/cms/pages 200')
  await page.waitForURL(/\/admin\/cms\/pages\/[0-9a-f-]{36}/)
  const id = page.url().split('/').pop()

  await page.getByRole('textbox', { name: 'Path' }).fill(path)
  await page.getByRole('switch', { name: 'Available in this language' }).click()
  await page.getByRole('textbox', { name: 'SEO title' }).fill(`Verify ${run}`)
  await shot('page-filled')
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
  const tags = (resolved.headers()['cache-tag'] ?? '').split(',')
  check(
    resolved.status() === 200 && tags.includes('cms') && tags.includes(`cms:page:${id}`),
    `GET /api/cms/resolve?path=${path} ${resolved.status()}, Cache-Tag ${tags.join(',')}, ${resolved.headers()['cache-control']}`,
  )
  await page.goto(`${base}/admin/cms/pages`)
  await page.getByRole('row').filter({ hasText: `Verify ${run}` }).filter({ hasText: 'Published' }).waitFor()
  await shot('pages-list')
}
