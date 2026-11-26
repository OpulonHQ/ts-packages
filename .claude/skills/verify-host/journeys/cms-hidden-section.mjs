import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const api = async (method, path, data) => {
    const response = await page.request.fetch(`${base}/api/cms${path}`, { method, data, headers: { Origin: base } })
    check(response.status() === 200, `${method} /api/cms${path} ${response.status()} ${response.status() === 200 ? "" : await response.text()}`)
    return response.json()
  }
  const path = `/hidden-${run}`
  const created = await api('POST', '/pages', {
    locales: { en: { path, available: true, seo: { title: `Hidden ${run}`, description: '', image: null, noindex: false } } },
    sections: [
      { id: crypto.randomUUID(), type: 'hero', data: { title: { en: `Hero ${run}` } } },
      { id: crypto.randomUUID(), type: 'stats', data: { count: 187, note: 'Tradizione legale' } },
    ],
  })
  await api("POST", `/pages/${created.id}/publish?version=${created.version}`)
  const resolve = async () => (await page.request.get(`${base}/api/cms/resolve?path=${encodeURIComponent(path)}`)).json()
  const types = async () => (await resolve()).sections.map((s) => s.type).join(',')
  check((await types()) === 'hero,stats', 'published page resolves hero and stats')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/admin/cms/pages/${created.id}`)
  const frame = page.locator('iframe[title="Live preview of the page"]').contentFrame()
  await frame.locator('h1').filter({ hasText: `Hero ${run}` }).waitFor()
  const outline = page.getByRole('navigation', { name: 'Page outline' })
  await outline.getByRole('button', { name: /^2\. Stats/ }).click()
  const toggle = page.getByRole('region', { name: '2. Stats' }).getByRole('switch', { name: 'Hide on the site' })
  await toggle.waitFor()
  await shot('stats-visible')

  await toggle.click()
  await outline.getByRole('button', { name: /^2\. Stats/ }).filter({ hasText: 'Hidden' }).waitFor()
  check(true, 'outline marks Stats as Hidden')
  const marked = frame.locator('[data-cms-hidden]')
  await marked.filter({ hasText: 'Tradizione legale' }).waitFor()
  const style = await marked.evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, label: getComputedStyle(el, '::before').content }))
  check(style.outline === 'dashed' && style.label === '"Hidden on the site"', `preview keeps Stats, marked (${style.outline}, ${style.label})`)
  await shot('stats-hidden-preview')

  await toggle.click()
  await frame.locator('[data-cms-hidden]').waitFor({ state: 'detached' })
  check(true, 'showing it again removes the preview marker')
  await toggle.click()

  const save = page.waitForResponse((r) => r.url().includes(`/api/cms/pages/${created.id}/draft?`) && r.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save draft' }).click()
  check((await save).status() === 200, 'Save draft: PUT .../draft 200')
  await page.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor()
  const saved = await api('GET', `/pages/${created.id}`)
  check(saved.status === 'changed' && saved.draft.sections[1].hidden === true && saved.draft.sections[0].hidden === undefined, `draft stores hidden only on Stats, status ${saved.status}`)
  check((await types()) === 'hero,stats', 'site still shows Stats until publish')

  const publish = page.waitForResponse((r) => r.url().includes(`/api/cms/pages/${created.id}/publish?`))
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  check((await publish).status() === 200, 'Publish: POST .../publish 200')
  await page.getByRole('status').filter({ hasText: 'Published.' }).waitFor()
  check((await types()) === 'hero', 'after publish the Read API leaves Stats out')
  await shot('published-hidden')

  await toggle.click()
  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Published.' }).waitFor()
  const back = await api('GET', `/pages/${created.id}`)
  check((await types()) === 'hero,stats' && back.draft.sections[1].hidden === undefined, 'showing and publishing brings Stats back, no hidden key stored')
}
