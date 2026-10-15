import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const api = async (method, path, data) => {
    const response = await page.request.fetch(`${base}/api/cms${path}`, { method, data, headers: { Origin: base } })
    check(response.status() === 200, `${method} /api/cms${path} ${response.status()}`)
    return response.json()
  }
  const hero = { id: crypto.randomUUID(), type: 'hero', data: { title: { en: `Live hero ${run}` }, tone: 'dark' } }
  const stats = { id: crypto.randomUUID(), type: 'stats', data: { count: 7, note: 'Stats note' } }
  const path = `/live-${run}`
  const created = await api('POST', '/pages', {
    locales: { en: { path, available: true, seo: { title: `Live ${run}`, description: '', image: null, noindex: false } } },
    sections: [hero, stats],
  })
  const stored = async () => (await api('GET', `/pages/${created.id}`)).draft

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/admin/cms/pages/${created.id}`)
  const iframe = page.locator('iframe[title="Live preview of the page"]')
  const frame = iframe.contentFrame()
  await frame.locator('h1').filter({ hasText: `Live hero ${run}` }).waitFor()
  check(
    (await iframe.getAttribute('src')) === `${base}/site/?preview=${created.id}&locale=en`,
    `frame src ${base}/site/?preview=${created.id}&locale=en renders the draft hero`,
  )
  const outline = page.getByRole('navigation', { name: 'Page outline' })
  const preview = page.getByRole('region', { name: 'Preview', exact: true })
  const inputs = page.getByRole('region', { name: '1. Hero' })
  const [o, p, i] = [await outline.boundingBox(), await preview.boundingBox(), await inputs.boundingBox()]
  check(o.x < p.x && p.x < i.x && Math.abs(o.y - p.y) < 40 && Math.abs(p.y - i.y) < 40, `desktop: outline, preview and inputs side by side (x ${Math.round(o.x)} < ${Math.round(p.x)} < ${Math.round(i.x)})`)
  await shot('desktop-three-panes')

  const title = page.locator('input[name="sections.0.title.en"]')
  await title.fill(`Edited hero ${run}`)
  await frame.locator('h1').filter({ hasText: `Edited hero ${run}` }).waitFor()
  check(true, 'typing in the hero title updates the frame without saving')
  check((await stored()).sections[0].data.title.en === `Live hero ${run}`, 'stored draft still has the old title (nothing saved)')
  await shot('edited-not-saved')

  await frame.locator('[data-cms-field="note"]').click()
  await page.getByRole('region', { name: '2. Stats' }).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'sections.1.note')
  check(true, 'clicking the stats note in the frame selects Stats and focuses its note input')
  await shot('frame-click-focus')
  await page.keyboard.type(' typed after click')
  await frame.locator('[data-cms-field="note"]').filter({ hasText: 'Stats note typed after click' }).waitFor()
  check(true, 'typing into the focused input updates the frame')

  await outline.getByRole('button', { name: /^1\. Hero/ }).focus()
  await page.keyboard.press('Enter')
  await inputs.waitFor()
  check(true, 'keyboard: Enter on the outline entry selects the section')

  await outline.getByRole('button', { name: 'Section type' }).click()
  await page.getByRole('option', { name: 'Rich text', exact: true }).click()
  await outline.getByRole('button', { name: 'Add section', exact: true }).click()
  await page.getByRole('region', { name: '3. Rich text' }).waitFor()
  const editor = page.getByRole('region', { name: '3. Rich text' }).locator('.tiptap').first()
  await editor.click()
  await page.keyboard.type(`Rich ${run}`)
  await frame.locator('.cms-rich-text').filter({ hasText: `Rich ${run}` }).waitFor()
  check(true, 'an added rich text section shows in the frame as it is typed')
  await shot('added-rich-text')

  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  const narrow = await iframe.boundingBox()
  check(narrow.width <= 390, `mobile toggle: frame ${Math.round(narrow.width)}px wide`)
  await shot('mobile-frame')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()

  const save = page.waitForResponse((r) => r.url().includes(`/api/cms/pages/${created.id}/draft?`) && r.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save draft' }).click()
  check((await save).status() === 200, 'Save draft: PUT .../draft 200')
  await page.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor()
  const saved = await stored()
  check(
    saved.sections[0].data.title.en === `Edited hero ${run}` && saved.sections[1].data.note === 'Stats note typed after click' && saved.sections[2].type === 'rich_text',
    'stored draft has the edited title, note and the added rich text section',
  )

  const publish = page.waitForResponse((r) => r.url().includes(`/api/cms/pages/${created.id}/publish?`))
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  check((await publish).status() === 200, 'Publish: POST .../publish 200')
  await page.getByRole('status').filter({ hasText: 'Published.' }).waitFor()
  const resolved = await page.request.get(`${base}/api/cms/resolve?path=${encodeURIComponent(path)}`)
  const body = await resolved.json()
  check(resolved.status() === 200 && body.sections?.[0]?.data?.title === `Edited hero ${run}`, `Read API serves the published edit at ${path}`)

  await outline.getByRole('button', { name: 'Page settings', exact: true }).click()
  check((await page.locator('input[name="locales.en.path"]').inputValue()) === path, 'Page settings shows the page path input')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await frame.locator('h1').filter({ hasText: `Edited hero ${run}` }).waitFor()
  const [so, sp, si] = [await outline.boundingBox(), await preview.boundingBox(), await inputs.boundingBox()]
  check(so.y < sp.y && sp.y < si.y && so.width <= 390 && sp.width <= 390, `phone: panes stacked (y ${Math.round(so.y)} < ${Math.round(sp.y)} < ${Math.round(si.y)})`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(overflow <= 0, `phone: no horizontal scroll (overflow ${overflow}px)`)
  await shot('phone-stacked')
}
