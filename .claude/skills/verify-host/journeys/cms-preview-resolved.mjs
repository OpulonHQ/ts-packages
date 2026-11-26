import signedIn from './signed-in.mjs'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const headers = { Origin: base }
  const api = async (method, path, data) => {
    const response = await page.request.fetch(`${base}/api/cms${path}`, { method, data, headers })
    check(response.status() === 200, `${method} /api/cms${path} ${response.status()}`)
    return response.json()
  }
  const locale = (path) => ({ path, available: true, seo: { title: '', description: '', image: null, noindex: false } })

  const upload = await page.request.post(`${base}/api/media/items`, {
    headers,
    multipart: { file: { name: 'dot.png', mimeType: 'image/png', buffer: png } },
  })
  check(upload.status() === 200, `POST /api/media/items ${upload.status()}`)
  const media = (await upload.json()).id

  const targetPath = `/resolved-target-${run}`
  const target = await api('POST', '/pages', { locales: { en: locale(targetPath) }, sections: [] })
  await api('POST', `/pages/${target.id}/publish?version=${target.version}`)
  const created = await api('POST', '/pages', {
    locales: { en: locale(`/resolved-${run}`) },
    sections: [
      {
        id: crypto.randomUUID(),
        type: 'cards',
        data: { heading: { en: 'Cards' }, cards: [{ id: crypto.randomUUID(), data: { title: { en: 'A' } } }] },
      },
      { id: crypto.randomUUID(), type: 'hero', data: { title: { en: 'Hero' }, image: media } },
    ],
  })

  const saved = await api('GET', `/pages/${created.id}/preview`)
  check(
    saved.sections[1].data.image?.id === media && saved.sections[1].data.image.url === `/media/${media}/1/dot.png`,
    `GET preview resolves the hero's media id to ResolvedMedia (url ${saved.sections[1].data.image?.url})`,
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/admin/cms/pages/${created.id}`)
  const frame = page.locator('iframe[title="Live preview of the page"]').contentFrame()
  const card = frame.locator('[data-cms-field="cards"] li').first()
  await card.filter({ hasText: /^A$/ }).waitFor()
  check((await card.locator('a').count()) === 0, 'opened: the card has no link, so the frame shows plain text')
  await shot('opened-without-link')

  const item = page.getByRole('region', { name: '1. Cards' }).getByRole('group', { name: 'Cards', exact: true }).locator('ol > li').first()
  const choose = async (label, option) => {
    await item.getByLabel(label, { exact: true }).click()
    await page.getByRole('option', { name: option, exact: true }).click()
  }
  const live = page.waitForResponse(
    (r) => r.url().includes(`/api/cms/pages/${created.id}/preview`) && r.request().method() === 'POST',
  )
  await choose('Links to', 'URL')
  await item.getByRole('textbox', { name: 'URL' }).fill(`/typed-${run}`)
  await card.locator(`a[href="/typed-${run}"]`).waitFor()
  check(true, `unsaved URL link: the frame renders <a href="/typed-${run}">A</a>`)
  const answer = await live
  check(answer.status() === 200, `the editor's POST .../preview answered ${answer.status()}`)
  const posted = await answer.json()
  check(
    posted.sections[1].data.image?.url === `/media/${media}/1/dot.png`,
    'the live preview answer carries the hero image as ResolvedMedia',
  )
  await shot('unsaved-url-link-resolved')

  await choose('Links to', 'Page')
  await choose('Target', targetPath)
  await card.locator(`a[href="${targetPath}"]`).waitFor()
  check(true, `unsaved page link: the frame renders <a href="${targetPath}">A</a>, resolved to the target's public path`)
  await shot('unsaved-page-link-resolved')

  const stored = await api('GET', `/pages/${created.id}`)
  check(stored.draft.sections[0].data.cards[0].data.link === undefined, 'nothing was saved: the stored card still has no link')
}
