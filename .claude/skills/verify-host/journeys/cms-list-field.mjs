import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const request = (method, path, data) =>
    page.request.fetch(`${base}/api/cms${path}`, { method, data, headers: { Origin: base } })
  const api = async (method, path, data) => {
    const response = await request(method, path, data)
    check(response.status() === 200, `${method} /api/cms${path} ${response.status()}`)
    return response.json()
  }
  const locale = (path) => ({ path, available: true, seo: { title: '', description: '', image: null, noindex: false } })

  const targetPath = `/list-target-${run}`
  const target = await api('POST', '/pages', { locales: { en: locale(targetPath) }, sections: [] })
  await api('POST', `/pages/${target.id}/publish?version=${target.version}`)
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()]
  const path = `/list-${run}`
  const created = await api('POST', '/pages', {
    locales: { en: locale(path) },
    sections: [
      {
        id: crypto.randomUUID(),
        type: 'cards',
        data: {
          heading: { en: `Cards ${run}` },
          cards: [
            { id: a, data: { title: { en: 'A' }, link: { type: 'page', id: target.id } } },
            { id: b, data: { title: { en: 'B' } } },
          ],
        },
      },
    ],
  })
  const stored = () => api('GET', `/pages/${created.id}`)
  const first = await api('POST', `/pages/${created.id}/publish?version=${created.version}`)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/admin/cms/pages/${created.id}`)
  const frame = page.locator('iframe[title="Live preview of the page"]').contentFrame()
  const shownItems = frame.locator('[data-cms-field="cards"] li')
  const shows = async (titles, what) => {
    for (const [index, title] of titles.entries())
      await shownItems.nth(index).filter({ hasText: new RegExp(`^${title}$`) }).waitFor()
    await shownItems.nth(titles.length).waitFor({ state: 'detached' })
    check(true, `${what}: the live preview shows ${titles.join(', ')}`)
  }
  const inputs = page.getByRole('region', { name: '1. Cards' })
  const list = inputs.getByRole('group', { name: 'Cards', exact: true })
  const rows = list.locator('ol > li')
  await shows(['A', 'B'], 'opened')
  await shot('list-opened')

  await list.getByRole('button', { name: 'Add item', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'sections.0.cards.2.title.en')
  await page.keyboard.type('C')
  await shows(['A', 'B', 'C'], 'add')
  check((await stored()).draft.sections[0].data.cards.length === 2, 'the stored draft still has two items (nothing saved)')

  await list.getByRole('button', { name: 'Move item 3 up', exact: true }).focus()
  await page.keyboard.press('Enter')
  await shows(['A', 'C', 'B'], 'keyboard reorder (Enter on Move item 3 up)')
  check(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Move item 2 up'),
    'focus follows the moved item to its Move up button',
  )
  await shot('list-reordered-by-keyboard')

  await page.setViewportSize({ width: 1440, height: 3000 })
  await rows.nth(0).locator('[draggable="true"]').dragTo(rows.nth(1), { targetPosition: { x: 40, y: 20 } })
  await shows(['C', 'A', 'B'], 'drag reorder (item 1 dropped on item 2)')
  await shot('list-reordered-by-drag')
  await page.setViewportSize({ width: 1440, height: 900 })

  await list.getByRole('button', { name: 'Remove item 3', exact: true }).click()
  await shows(['C', 'A'], 'remove')

  await frame.locator('[data-cms-field="cards"]').click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'sections.0.cards.0.title.en')
  check(true, 'a click on the list in the frame focuses the first item field')

  const saving = (action) =>
    page.waitForResponse((r) => r.url().includes(`/api/cms/pages/${created.id}/${action}?`) && r.request().method() !== 'GET')
  let response = saving('draft')
  await page.getByRole('button', { name: 'Save draft' }).click()
  check((await response).status() === 200, 'Save draft: PUT .../draft 200')
  await page.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor()
  const saved = (await stored()).draft.sections[0].data.cards
  check(
    saved.length === 2 && saved[0].data.title.en === 'C' && saved[1].id === a && saved[1].data.title.en === 'A',
    'the stored draft has C then A, and A kept its id',
  )

  response = saving('publish')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  check((await response).status() === 200, 'Publish: POST .../publish 200')
  await page.getByRole('status').filter({ hasText: 'Published.' }).waitFor()
  const resolved = await page.request.get(`${base}/api/cms/resolve?path=${encodeURIComponent(path)}`)
  const cards = (await resolved.json()).sections?.[0]?.data?.cards ?? []
  check(
    resolved.status() === 200 && cards.length === 2 && cards[0].data.title === 'C' && cards[1].id === a && cards[1].data.link?.href === targetPath,
    `Read API serves C then A at ${path}, the link inside A resolved to ${targetPath}`,
  )
  check(
    (resolved.headers()['cache-tag'] ?? '').split(',').includes(`cms:page:${target.id}`),
    `the Read API answer carries the Cache-Tag of the linked page (cms:page:${target.id})`,
  )

  await list.getByRole('button', { name: 'Add item', exact: true }).click()
  response = saving('draft')
  await page.getByRole('button', { name: 'Save draft' }).click()
  check((await response).status() === 200, 'Save draft with an empty third item: 200')
  await page.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor()
  response = saving('publish')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  check((await response).status() === 400, 'Publish with an untitled item: 400')
  await page.getByRole('alert').filter({ hasText: '"Cards", item 3: "Title" is required in en.' }).waitFor()
  check(true, 'the editor sees which item and field block the publish')
  await shot('list-publish-refused')

  const before = await stored()
  const restored = await api('POST', `/pages/${created.id}/revisions/${first.publishedRevisionId}/restore?version=${before.version}`)
  const back = restored.draft.sections[0].data.cards
  check(
    back.length === 2 && back[0].id === a && back[0].data.title.en === 'A' && back[1].id === b && back[1].data.title.en === 'B',
    'restoring the first revision brings back A then B with their ids',
  )
  await page.reload()
  await shows(['A', 'B'], 'after restore')
  await shot('list-restored')

  await page.getByRole('radiogroup', { name: 'Content language' }).getByText('Italian', { exact: true }).click()
  const add = list.getByRole('button', { name: 'Add item', exact: true })
  for (const index of [2, 3]) {
    await add.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      (name) => document.activeElement?.getAttribute('name') === name,
      `sections.0.cards.${index}.title.it`,
    )
    check(true, `Italian shown: Enter on Add item focuses item ${index + 1}'s Italian Title`)
  }
  check(await add.isDisabled(), 'Add item is disabled at the maximum of 4, and focus is in the new item')
  await shot('list-added-by-keyboard-in-italian')
}
